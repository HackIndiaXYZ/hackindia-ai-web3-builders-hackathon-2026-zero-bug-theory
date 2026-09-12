"""Optional Gemini explainer (spec layer 8).

Turns the model's numeric output into a short plain-language explanation. It is
strictly an EXPLAINER: it is handed the already-computed decision and is asked
to describe it. It never sees the image, it is never asked to make or revise a
clinical judgement, and its answer cannot change the score, the category or
anything written to the database or the chain.

If no API key is configured the feature reports itself unavailable and the UI
hides the section. It never invents an explanation locally — a fabricated
rationale attached to a real medical-adjacent number would be worse than no
explanation at all.
"""

from __future__ import annotations

import logging

import httpx

from .config import get_settings

logger = logging.getLogger("anemiascan.gemini")

API_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

SYSTEM_INSTRUCTION = """\
You explain the output of AnemiaScan, a research screening tool that estimates \
anaemia RISK from a photograph of the palpebral conjunctiva (the inner lower \
eyelid). You are given numbers that have already been computed. Your job is to \
describe them in plain language.

Rules you must follow exactly:
- Never diagnose. This is a screening signal, not a diagnosis, and you must not \
imply otherwise.
- Never state or estimate a haemoglobin value, and never imply the tool measures one.
- Never contradict, re-rank or re-interpret the decision you were given.
- Always say that only a blood test (CBC/haemoglobin) can confirm or rule out anaemia.
- Do not invent findings. You cannot see the image; describe only the supplied numbers.
- If the decision is "uncertain", say plainly that the result was inconclusive and why.
- Write 2 to 4 short sentences, second person, calm and non-alarming. No lists, \
no headings, no markdown.
"""


class ExplainerUnavailable(RuntimeError):
    """No API key, or the upstream call failed."""


def is_configured() -> bool:
    return bool(get_settings().gemini_api_key)


def _prompt(payload: dict) -> str:
    probability = payload["screening_probability"]
    threshold = payload["operating_threshold"]
    lines = [
        f"Decision: {payload['decision']} ({payload['risk_category']}).",
        f"Calibrated screening probability: {probability:.3f}.",
        f"Operating threshold: {threshold:.4f} (chosen for ~90% sensitivity).",
        f"Uncertainty margin around the threshold: {payload['uncertainty_margin']:.4f}.",
        f"The two candidate models produced: {payload['candidate_probabilities']}.",
        f"The models disagreed: {payload['model_disagreement']}.",
        f"The probability sits within the uncertainty margin: {payload['near_threshold']}.",
        f"Capture quality score: {payload['quality_bps'] / 100:.0f} out of 100.",
    ]
    if payload.get("roi"):
        roi = payload["roi"]
        lines.append(
            f"The conjunctiva was located automatically, covering "
            f"{roi.get('coverage', 0) * 100:.0f}% of the submitted frame."
        )
    lines.append(
        "Explain this result to the person who was scanned, following your rules."
    )
    return "\n".join(lines)


def explain(payload: dict) -> str:
    """Ask Gemini to describe an already-computed screening result."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ExplainerUnavailable("GEMINI_API_KEY is not configured")

    url = API_URL_TEMPLATE.format(model=settings.gemini_model)
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": [{"role": "user", "parts": [{"text": _prompt(payload)}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 300,
            "candidateCount": 1,
        },
    }

    try:
        response = httpx.post(
            url,
            json=body,
            headers={"x-goog-api-key": settings.gemini_api_key},
            timeout=settings.gemini_timeout_seconds,
        )
    except httpx.HTTPError as err:
        raise ExplainerUnavailable(f"Gemini request failed: {err}") from err

    if response.status_code != 200:
        # Surface the upstream reason without leaking the API key.
        detail = response.text[:400]
        raise ExplainerUnavailable(
            f"Gemini returned HTTP {response.status_code}: {detail}"
        )

    try:
        data = response.json()
        candidate = data["candidates"][0]
        text = "".join(
            part.get("text", "") for part in candidate["content"]["parts"]
        ).strip()
    except (KeyError, IndexError, ValueError) as err:
        raise ExplainerUnavailable(f"Unexpected Gemini response shape: {err}") from err

    if not text:
        raise ExplainerUnavailable("Gemini returned an empty explanation")
    return text
