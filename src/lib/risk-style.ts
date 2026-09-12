import type { Decision, RiskLevel } from '@/src/lib/types'

/**
 * Presentation layer for a model decision: colour token, copy, and ready-made
 * Tailwind class strings.
 *
 * This file used to describe the three bands of a local colour heuristic (Low /
 * Moderate / Elevated Risk). That heuristic is gone. The model returns one of
 * three decisions — `lower_risk`, `higher_risk`, `uncertain` — and `uncertain`
 * is a genuine refusal to call it, not a middle band. The copy below is written
 * so that distinction survives translation into a colour.
 *
 * All class strings are written as complete literals so the Tailwind v4 scanner
 * can see them — never build these by interpolating a token.
 */

/**
 * The palette token, deliberately still a three-value union.
 *
 * `Uncertain` maps onto `moderate` (amber) rather than getting a fourth token
 * because `Badge variant={token}` and `Progress tone={token}` only accept these
 * three, and several screens pass the token straight through. Amber is the
 * "we cannot say" colour here — the honesty lives in the label and the copy,
 * which say *inconclusive*, never *moderate risk*.
 */
export type RiskToken = 'risk' | 'moderate' | 'safe'

/** The wire decision -> the label shown to a person. */
export function riskLevelForDecision(decision: Decision): RiskLevel {
  if (decision === 'higher_risk') return 'Higher risk'
  if (decision === 'uncertain') return 'Uncertain'
  return 'Lower risk'
}

export function riskColorToken(level: RiskLevel): RiskToken {
  if (level === 'Higher risk') return 'risk'
  if (level === 'Uncertain') return 'moderate'
  return 'safe'
}

/**
 * Two-to-four word headline for the result screen.
 *
 * `Lower risk` deliberately does NOT read as an all-clear: the threshold is
 * tuned for sensitivity rather than certainty, and mild anaemia commonly
 * produces no visible conjunctival pallor at all — which faq.tsx and
 * learn-screen.tsx both say outright. `Uncertain` names the non-answer instead
 * of dressing it up as a middling one.
 */
export function riskHeadline(level: RiskLevel): string {
  if (level === 'Higher risk') return 'Worth Getting Checked'
  if (level === 'Uncertain') return 'This One Was Inconclusive'
  return 'No Pallor Signal Today'
}

/**
 * One-paragraph, non-diagnostic explanation of the decision.
 *
 * Each of these explains the decision in terms of the thing that actually
 * produced it — a calibrated probability compared against a sensitivity-tuned
 * operating threshold — because that is the only account of the result this app
 * can honestly give. None of them claims a measurement of haemoglobin, and none
 * of them quotes an accuracy figure: the model has no external validation.
 */
export function riskExplanation(level: RiskLevel): string {
  if (level === 'Higher risk') {
    return 'The calibrated screening probability for this capture landed at or above the model’s operating threshold. That threshold sits well below a half: it is tuned so the model would rather flag a photo that turns out fine than stay quiet about one that does not. This is a prompt to get a haemoglobin test, not a finding about your blood.'
  }
  if (level === 'Uncertain') {
    return 'The model declined to call this one. The probability landed inside the uncertainty margin either side of the threshold, or the two candidate models reached opposite conclusions about the same capture. Treat it as no answer rather than a middling one — it is neither reassurance nor a warning.'
  }
  return 'The calibrated screening probability for this capture landed below the model’s operating threshold, and outside the uncertainty margin around it. That is not a clean bill of health: mild anaemia often shows no visible pallor at all, and this model has never been checked against real blood results, so symptoms still matter far more than this number.'
}

/** Three to four concrete, safe next steps. */
export function riskAdvice(level: RiskLevel): string[] {
  if (level === 'Higher risk') {
    return [
      'Book a haemoglobin (CBC) blood test — it is inexpensive, fast and definitive.',
      'Note any tiredness, breathlessness, dizziness, cold hands or heavy periods to mention to your clinician.',
      'Do not start iron supplements on your own; the wrong dose can cause harm and can mask the real cause.',
      'Seek care promptly if you have chest pain, fainting, a racing heart or visible blood loss.',
    ]
  }
  if (level === 'Uncertain') {
    return [
      'Do not read this either way. An inconclusive screen is not a negative result, and it is not a positive one.',
      'Re-scan in bright, indirect daylight, with the lower lid pulled well down and the camera steady — borderline captures are usually borderline photographs.',
      'If two or three careful attempts stay inconclusive, stop re-scanning and ask a clinician for a haemoglobin test instead.',
      'If you already feel unusually tired, breathless or dizzy, act on the symptoms and skip straight to the blood test.',
    ]
  }
  return [
    'Trust symptoms over any screening result — fatigue, breathlessness or dizziness still deserve a real test.',
    'Keep a baseline: re-scan every few weeks so you can see a direction rather than a single snapshot.',
    'Maintain iron-rich meals — lentils, beans, leafy greens, eggs, red meat or fortified cereal — with a vitamin C source to keep absorption high.',
    'If a clinician is already tracking your haemoglobin, their numbers are the ones that count.',
  ]
}

/**
 * Ready-to-use Tailwind classes for a token.
 * - `text` / `bg` / `border` / `ring` are tinted surface + accent classes.
 * - `fill` is the full-opacity accent, for meter fills and solid chips.
 */
export function riskClasses(token: RiskToken): {
  text: string
  bg: string
  border: string
  ring: string
  fill: string
} {
  if (token === 'risk') {
    return {
      text: 'text-risk',
      bg: 'bg-risk/10',
      border: 'border-risk/30',
      ring: 'ring-risk/30',
      fill: 'bg-risk',
    }
  }
  if (token === 'moderate') {
    return {
      text: 'text-moderate',
      bg: 'bg-moderate/10',
      border: 'border-moderate/30',
      ring: 'ring-moderate/30',
      fill: 'bg-moderate',
    }
  }
  return {
    text: 'text-safe',
    bg: 'bg-safe/10',
    border: 'border-safe/30',
    ring: 'ring-safe/30',
    fill: 'bg-safe',
  }
}
