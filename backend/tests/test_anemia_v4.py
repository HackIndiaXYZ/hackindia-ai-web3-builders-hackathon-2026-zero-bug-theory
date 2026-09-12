import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.ml.predictor import (
    CORRECTED_OPERATING_THRESHOLD,
    UNCERTAINTY_MARGIN,
    build_stacker_input,
    decode_rgb,
    decision_from_probability,
    engineered_features,
    get_predictor,
    quality_report,
)


def _image_bytes(mode: str, size: tuple[int, int], color, image_format: str) -> bytes:
    output = io.BytesIO()
    Image.new(mode, size, color=color).save(output, format=image_format)
    return output.getvalue()


@pytest.mark.parametrize(
    ("mode", "color", "expected"),
    [
        ("RGB", (10, 20, 30), (10, 20, 30)),
        ("L", 100, (100, 100, 100)),
        ("RGBA", (10, 20, 30, 127), (10, 20, 30)),
    ],
)
def test_decode_rgb_grayscale_and_rgba(mode, color, expected) -> None:
    rgb = decode_rgb(_image_bytes(mode, (128, 128), color, "PNG"))
    assert rgb.shape == (128, 128, 3)
    assert tuple(rgb[0, 0]) == expected


def test_exact_feature_and_stacker_contract() -> None:
    rgb = decode_rgb(_image_bytes("RGB", (128, 128), (100, 80, 70), "PNG"))
    features = engineered_features(rgb)
    assert features.shape == (32,)
    assert np.isfinite(features).all()

    stacker = build_stacker_input(0.1, -0.2, 0.3, features)
    assert stacker.shape == (1, 35)
    assert np.isfinite(stacker).all()


def test_model_input_shapes_and_strict_loaded_eval_models() -> None:
    predictor = get_predictor("cpu")
    image = Image.new("RGB", (333, 287), color=(120, 80, 70))
    assert predictor.efficientnet_transform(image).shape == (3, 300, 300)
    assert predictor.convnext_transform(image).shape == (3, 224, 224)
    assert predictor.vit_transform(image).shape == (3, 224, 224)
    # Construction reaches this point only after strict=True state-dict loads.
    assert not predictor.efficientnet.training
    assert not predictor.convnext.training
    assert not predictor.vit.training


def test_corrected_threshold_and_all_scoring_decisions() -> None:
    threshold = CORRECTED_OPERATING_THRESHOLD
    margin = UNCERTAINTY_MARGIN
    assert decision_from_probability(threshold) == ("uncertain", True)
    assert decision_from_probability(threshold - margin) == ("uncertain", True)
    assert decision_from_probability(threshold + margin) == ("uncertain", True)
    assert decision_from_probability(np.nextafter(threshold - margin, -np.inf)) == (
        "lower_risk",
        False,
    )
    assert decision_from_probability(np.nextafter(threshold + margin, np.inf)) == (
        "higher_risk",
        False,
    )
    with pytest.raises(ValueError):
        decision_from_probability(float("nan"))


def test_quality_gate_rejects_extreme_clipping() -> None:
    white = np.full((128, 128, 3), 255, dtype=np.uint8)
    quality = quality_report(white)
    assert quality["accepted"] is False
    assert "extremely_bright" in quality["failures"]
    assert "severely_clipped" in quality["failures"]


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def test_real_v4_endpoint_valid_roi(client: TestClient) -> None:
    roi = _image_bytes("RGB", (300, 300), (180, 90, 90), "JPEG")
    response = client.post(
        "/api/anemia/analyze", files={"image": ("roi.jpg", roi, "image/jpeg")}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["modelVersion"] == "anemiascan-v4-eff-conv-vit"
    assert body["decision"] in {"higher_risk", "lower_risk", "uncertain"}
    assert 0 <= body["screeningProbability"] <= 1
    assert body["operatingThreshold"] == pytest.approx(CORRECTED_OPERATING_THRESHOLD)
    assert body["quality"]["accepted"] is True
    assert body["modelHash"].startswith("0x") and len(body["modelHash"]) == 66
    assert body["benchmark"]["label"] == "Internal development benchmark"
    assert body["benchmark"]["samples"] == 139


def test_real_v4_endpoint_rejects_unreadable_file(client: TestClient) -> None:
    response = client.post(
        "/api/anemia/analyze",
        files={"image": ("broken.jpg", b"not an image", "image/jpeg")},
    )
    assert response.status_code == 422


def test_real_v4_endpoint_rejects_unsupported_mime(client: TestClient) -> None:
    response = client.post(
        "/api/anemia/analyze",
        files={"image": ("roi.webp", b"not-used", "image/webp")},
    )
    assert response.status_code == 422


def test_real_v4_endpoint_requires_recapture_for_clipped_roi(client: TestClient) -> None:
    roi = _image_bytes("RGB", (128, 128), "white", "PNG")
    response = client.post(
        "/api/anemia/analyze", files={"image": ("clipped.png", roi, "image/png")}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["decision"] == "recapture_required"
    assert body["screeningProbability"] is None
    assert body["quality"]["accepted"] is False
    assert "severely_clipped" in body["quality"]["failures"]


def test_predictor_is_process_singleton() -> None:
    assert get_predictor("cpu") is get_predictor("cpu")


def test_decode_rejects_empty_bytes() -> None:
    from app.ml.predictor import InvalidImageError

    with pytest.raises(InvalidImageError, match="empty"):
        decode_rgb(b"")


def test_decode_rejects_oversized_dimensions(monkeypatch) -> None:
    from app.ml.predictor import InvalidImageError
    import app.ml.predictor as predictor_mod

    monkeypatch.setattr(predictor_mod, "MAX_IMAGE_DIMENSION", 100)
    image_bytes = _image_bytes("RGB", (128, 128), (100, 100, 100), "PNG")
    with pytest.raises(InvalidImageError, match="safety limit"):
        decode_rgb(image_bytes)


def test_quality_gate_all_failure_reasons() -> None:
    # 1. roi_too_small (< 96)
    small = np.full((64, 64, 3), 100, dtype=np.uint8)
    q_small = quality_report(small)
    assert "roi_too_small" in q_small["failures"]

    # 2. extremely_dark (< 12)
    dark = np.full((128, 128, 3), 5, dtype=np.uint8)
    q_dark = quality_report(dark)
    assert "extremely_dark" in q_dark["failures"]

    # 3. extremely_bright (> 245)
    bright = np.full((128, 128, 3), 250, dtype=np.uint8)
    q_bright = quality_report(bright)
    assert "extremely_bright" in q_bright["failures"]

    # 4. severely_clipped (> 0.80)
    clipped = np.full((128, 128, 3), 1, dtype=np.uint8)
    q_clipped = quality_report(clipped)
    assert "severely_clipped" in q_clipped["failures"]


def test_real_v4_endpoint_rejects_oversized_payload(client: TestClient, monkeypatch) -> None:
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "ml_max_upload_bytes", 50)
    roi = _image_bytes("RGB", (128, 128), (180, 90, 90), "JPEG")
    response = client.post(
        "/api/anemia/analyze", files={"image": ("roi.jpg", roi, "image/jpeg")}
    )
    assert response.status_code == 413


def test_v4_response_exact_camelcase_schema(client: TestClient) -> None:
    roi = _image_bytes("RGB", (300, 300), (180, 90, 90), "JPEG")
    response = client.post(
        "/api/anemia/analyze", files={"image": ("roi.jpg", roi, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    expected_top_keys = {
        "modelVersion",
        "modelHash",
        "decision",
        "screeningProbability",
        "operatingThreshold",
        "uncertain",
        "quality",
        "benchmark",
        "warning",
    }
    assert set(data.keys()) == expected_top_keys
    expected_quality_keys = {
        "accepted",
        "brightness",
        "blurVariance",
        "clippedFraction",
        "failures",
    }
    assert set(data["quality"].keys()) == expected_quality_keys
    expected_benchmark_keys = {
        "label",
        "samples",
        "accuracy",
        "sensitivity",
        "specificity",
        "auroc",
        "f1",
        "confusionMatrix",
    }
    assert set(data["benchmark"].keys()) == expected_benchmark_keys
    expected_confusion_keys = {"tn", "fp", "fn", "tp"}
    assert set(data["benchmark"]["confusionMatrix"].keys()) == expected_confusion_keys

