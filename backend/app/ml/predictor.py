"""Deterministic AnemiaScan V4 model runtime.

The implementation mirrors the trusted bundle's ``inference.py`` while
accepting already-read image bytes from FastAPI. Only static files under the
configured model-assets directory are loaded; uploaded files are never treated
as checkpoints or persisted to disk.
"""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any

import cv2
import joblib
import numpy as np
import torch
from PIL import Image
from torch import nn
from torchvision import transforms
from torchvision.models import convnext_tiny, efficientnet_b3, vit_b_16
from torchvision.transforms import InterpolationMode

MODEL_VERSION = "anemiascan-v4-eff-conv-vit"
MODEL_ASSETS_DIR = Path(__file__).resolve().parent / "model_assets"
CORRECTED_OPERATING_THRESHOLD = 0.24259322528166496
UNCERTAINTY_MARGIN = 0.06909162763627245
WARNING = (
    "Research screening result only. Confirm using a CBC/hemoglobin test and "
    "professional evaluation."
)
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 40_000_000

REQUIRED_MODEL_FILES = {
    "base_models/efficientnet_b3_best.pth",
    "base_models/convnext_tiny_best.pth",
    "vit_b16_best.pth",
    "stacking_model.joblib",
    "train_only_scalers.npz",
    "runtime_config.json",
    "metrics.json",
    "inference.py",
}


class ModelUnavailableError(RuntimeError):
    """The trusted V4 bundle is missing, incompatible, or failed to load."""


class InvalidImageError(ValueError):
    """The uploaded bytes are not a supported, safely sized image."""


def _strip_bad_png_iccp(raw: bytes) -> bytes:
    """Drop a malformed PNG iCCP chunk without changing other image bytes."""

    signature = b"\x89PNG\r\n\x1a\n"
    if not raw.startswith(signature):
        return raw
    output = bytearray(signature)
    position = len(signature)
    while position + 12 <= len(raw):
        length = int.from_bytes(raw[position : position + 4], "big")
        end = position + 12 + length
        if end > len(raw):
            return raw
        chunk_type = raw[position + 4 : position + 8]
        if chunk_type != b"iCCP":
            output.extend(raw[position:end])
        position = end
        if chunk_type == b"IEND":
            break
    return bytes(output)


def decode_rgb(raw_bytes: bytes) -> np.ndarray:
    """Decode PNG/JPEG bytes with OpenCV and normalize grayscale/BGR/BGRA to RGB."""

    if not raw_bytes:
        raise InvalidImageError("The uploaded image is empty.")
    raw = _strip_bad_png_iccp(raw_bytes)
    decoded = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if decoded is None:
        raise InvalidImageError("OpenCV could not decode the uploaded PNG or JPEG image.")
    if decoded.ndim == 2:
        rgb = cv2.cvtColor(decoded, cv2.COLOR_GRAY2RGB)
    elif decoded.ndim == 3 and decoded.shape[2] == 4:
        rgb = cv2.cvtColor(decoded, cv2.COLOR_BGRA2RGB)
    elif decoded.ndim == 3 and decoded.shape[2] == 3:
        rgb = cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
    else:
        raise InvalidImageError(f"Unsupported decoded image shape: {decoded.shape}.")
    height, width = rgb.shape[:2]
    if height <= 0 or width <= 0:
        raise InvalidImageError("The decoded image has invalid dimensions.")
    if max(height, width) > MAX_IMAGE_DIMENSION or height * width > MAX_IMAGE_PIXELS:
        raise InvalidImageError(
            f"Decoded image dimensions {width}x{height} exceed the safety limit."
        )
    return np.ascontiguousarray(rgb, dtype=np.uint8)


def quality_report(rgb: np.ndarray) -> dict[str, Any]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    brightness = float(gray.mean())
    blur = float(cv2.Laplacian(gray, cv2.CV_32F).var())
    clipped = float(((gray <= 3) | (gray >= 252)).mean())
    failures: list[str] = []
    if min(rgb.shape[:2]) < 96:
        failures.append("roi_too_small")
    if brightness < 12:
        failures.append("extremely_dark")
    if brightness > 245:
        failures.append("extremely_bright")
    if clipped > 0.80:
        failures.append("severely_clipped")
    return {
        "accepted": not failures,
        "brightness": brightness,
        "blur_variance": blur,
        "clipped_fraction": clipped,
        "failures": failures,
    }


def _gray_entropy(gray: np.ndarray) -> float:
    histogram = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
    probability = histogram / max(float(histogram.sum()), 1.0)
    probability = probability[probability > 0]
    return float(-(probability * np.log2(probability)).sum() / 8.0)


def engineered_features(rgb: np.ndarray) -> np.ndarray:
    """Extract the bundle's exact 32 RGB/HSV/LAB/brightness/texture features."""

    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    values: list[float] = []
    for channel in cv2.split(rgb):
        values += [
            channel.mean() / 255,
            channel.std() / 255,
            np.percentile(channel, 25) / 255,
            np.percentile(channel, 75) / 255,
        ]
    for channel, scale in zip(cv2.split(hsv), (179, 255, 255)):
        values += [channel.mean() / scale, channel.std() / scale]
    for channel in cv2.split(lab):
        values += [channel.mean() / 255, channel.std() / 255]
    laplacian = cv2.Laplacian(gray, cv2.CV_32F)
    horizontal = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    vertical = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    sobel = cv2.magnitude(horizontal, vertical)
    values += [
        gray.mean() / 255,
        gray.std() / 255,
        np.percentile(gray, 10) / 255,
        np.percentile(gray, 90) / 255,
        np.clip(laplacian.var() / 5000, 0, 1),
        np.clip(sobel.mean() / 255, 0, 1),
        _gray_entropy(gray),
        (hsv[:, :, 1] > 180).mean(),
    ]
    result = np.asarray(values, dtype=np.float32)
    if result.shape != (32,) or not np.isfinite(result).all():
        raise RuntimeError("The engineered-feature pipeline did not produce 32 finite values.")
    return result


def image_transform(resize: int, crop: int, interpolation: InterpolationMode):
    return transforms.Compose(
        [
            transforms.Resize(resize, interpolation=interpolation),
            transforms.CenterCrop(crop),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )


class BaseTransferClassifier(nn.Module):
    def __init__(self, name: str):
        super().__init__()
        self.name = name
        if name == "efficientnet_b3":
            self.net = efficientnet_b3(weights=None)
            dimension = self.net.classifier[-1].in_features
            self.net.classifier = nn.Sequential(
                nn.Dropout(0.35),
                nn.Linear(dimension, 256),
                nn.GELU(),
                nn.Dropout(0.2),
                nn.Linear(256, 1),
            )
        elif name == "convnext_tiny":
            self.net = convnext_tiny(weights=None)
            dimension = self.net.classifier[-1].in_features
            self.net.classifier[-1] = nn.Sequential(
                nn.Dropout(0.30), nn.Linear(dimension, 1)
            )
        else:
            raise ValueError(name)

    def encode(self, image: torch.Tensor) -> torch.Tensor:
        value = self.net.features(image)
        value = self.net.avgpool(value)
        if self.name == "convnext_tiny":
            value = self.net.classifier[0](value)
        return torch.flatten(value, 1)

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        embedding = self.encode(image)
        if self.name == "efficientnet_b3":
            return self.net.classifier(embedding).flatten()
        return self.net.classifier[-1](embedding).flatten()


class ViTB16Binary(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = vit_b_16(weights=None)
        self.net.heads.head = nn.Sequential(
            nn.LayerNorm(768), nn.Dropout(0.30), nn.Linear(768, 1)
        )

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.net(image).flatten()


def build_stacker_input(
    efficientnet_logit: float,
    convnext_logit: float,
    vit_logit: float,
    standardized_features: np.ndarray,
) -> np.ndarray:
    """Build [Eff, ConvNeXt, ViT, feature_00..feature_31] exactly."""

    values = np.concatenate(
        [
            np.asarray(
                [efficientnet_logit, convnext_logit, vit_logit], dtype=np.float64
            ),
            np.asarray(standardized_features, dtype=np.float64),
        ]
    )
    if values.shape != (35,) or not np.isfinite(values).all():
        raise RuntimeError("The stacker input must contain exactly 35 finite values.")
    return values.reshape(1, 35)


def decision_from_probability(probability: float) -> tuple[str, bool]:
    """Apply the corrected operating point and its inclusive uncertainty band."""

    if not np.isfinite(probability) or not 0 <= probability <= 1:
        raise ValueError("The calibrated screening probability must be finite and in [0, 1].")
    uncertain = abs(probability - CORRECTED_OPERATING_THRESHOLD) <= UNCERTAINTY_MARGIN
    if uncertain:
        return "uncertain", True
    return (
        "higher_risk" if probability >= CORRECTED_OPERATING_THRESHOLD else "lower_risk",
        False,
    )


def _required_content_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for relative in sorted(REQUIRED_MODEL_FILES):
        path = root / relative
        if not path.is_file():
            raise ModelUnavailableError(f"Missing required V4 model artifact: {relative}")
        encoded_name = relative.encode("utf-8")
        digest.update(len(encoded_name).to_bytes(4, "big"))
        digest.update(encoded_name)
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _resolve_device(requested: str | None) -> torch.device:
    value = (requested or "auto").lower()
    if value not in {"auto", "cpu", "cuda"}:
        raise ModelUnavailableError("ML_DEVICE must be auto, cpu, or cuda.")
    if value == "cuda" and not torch.cuda.is_available():
        raise ModelUnavailableError("ML_DEVICE=cuda was requested but CUDA is unavailable.")
    return torch.device("cuda" if value == "cuda" or (value == "auto" and torch.cuda.is_available()) else "cpu")


class AnemiaScanV4Predictor:
    """One process-wide, strict-loaded V4 predictor with serialized execution."""

    def __init__(self, bundle_directory: Path = MODEL_ASSETS_DIR, device: str | None = "auto"):
        self.root = Path(bundle_directory).resolve()
        self.device = _resolve_device(device)
        self._execution_lock = threading.Lock()

        manifest_path = self.root / "model_manifest.json"
        if not manifest_path.is_file():
            raise ModelUnavailableError(
                "AnemiaScan V4 assets are not installed. Run scripts/install_v4_bundle.py."
            )
        self.manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        actual_hash = _required_content_hash(self.root)
        if self.manifest.get("model_hash") != actual_hash:
            raise ModelUnavailableError("V4 model files do not match the installed SHA-256 manifest.")
        self.model_hash = "0x" + actual_hash

        self.runtime = json.loads((self.root / "runtime_config.json").read_text(encoding="utf-8"))
        self.metrics = json.loads((self.root / "metrics.json").read_text(encoding="utf-8"))
        self._validate_runtime()

        with np.load(self.root / "train_only_scalers.npz") as scalers:
            self.feature_mean = scalers["feature_mean"].astype(np.float32)
            self.feature_std = scalers["feature_std"].astype(np.float32)
        if (
            self.feature_mean.shape != (32,)
            or self.feature_std.shape != (32,)
            or not np.isfinite(self.feature_mean).all()
            or not np.isfinite(self.feature_std).all()
            or np.any(self.feature_std <= 0)
        ):
            raise ModelUnavailableError("train_only_scalers.npz is incompatible with 32 V4 features.")

        self.efficientnet = self._load_base("efficientnet_b3")
        self.convnext = self._load_base("convnext_tiny")
        self.vit = ViTB16Binary()
        vit_checkpoint = self._load_checkpoint(self.root / "vit_b16_best.pth")
        self.vit.load_state_dict(vit_checkpoint["state_dict"], strict=True)
        self.vit = self.vit.float().to(self.device).eval()

        self.stacker = joblib.load(self.root / "stacking_model.joblib")
        if not isinstance(self.stacker, dict) or not {"scaler", "model"}.issubset(self.stacker):
            raise ModelUnavailableError("stacking_model.joblib has an incompatible structure.")
        for component_name in ("scaler", "model"):
            count = getattr(self.stacker[component_name], "n_features_in_", None)
            if count != 35:
                raise ModelUnavailableError(
                    f"The saved stacker {component_name} expects {count!r} inputs instead of 35."
                )

        self.efficientnet_transform = image_transform(320, 300, InterpolationMode.BICUBIC)
        self.convnext_transform = image_transform(236, 224, InterpolationMode.BILINEAR)
        self.vit_transform = image_transform(236, 224, InterpolationMode.BILINEAR)

    def _validate_runtime(self) -> None:
        expected_order = ["efficientnet_logit", "convnext_logit", "vit_logit"] + [
            f"feature_{index:02d}" for index in range(32)
        ]
        if self.runtime.get("selected_candidate") != "calibrated_logistic_stacker":
            raise ModelUnavailableError("V4 runtime does not select calibrated_logistic_stacker.")
        if self.runtime.get("stacker_input_order") != expected_order:
            raise ModelUnavailableError("V4 runtime stacker order is incompatible.")
        bundled_threshold = float(self.runtime.get("selected_threshold", -1))
        if abs(bundled_threshold - CORRECTED_OPERATING_THRESHOLD) > 0.000002:
            raise ModelUnavailableError("V4 runtime threshold is incompatible with the corrected threshold.")
        if float(self.runtime.get("uncertainty_margin", -1)) != UNCERTAINTY_MARGIN:
            raise ModelUnavailableError("V4 runtime uncertainty margin is incompatible.")
        calibration = self.runtime.get("calibration")
        if not isinstance(calibration, dict) or not all(
            np.isfinite(float(calibration.get(name, np.nan)))
            for name in ("coefficient", "intercept")
        ):
            raise ModelUnavailableError("V4 Platt calibration parameters are invalid.")
        benchmark = self.metrics.get("internal_benchmark")
        if not isinstance(benchmark, dict) or int(benchmark.get("n", 0)) <= 0:
            raise ModelUnavailableError("V4 internal benchmark metrics are missing.")

    @staticmethod
    def _load_checkpoint(path: Path) -> dict[str, Any]:
        checkpoint = torch.load(path, map_location="cpu", weights_only=False)
        if not isinstance(checkpoint, dict) or not isinstance(checkpoint.get("state_dict"), dict):
            raise ModelUnavailableError(f"Checkpoint {path.name} has no state_dict.")
        return checkpoint

    def _load_base(self, name: str) -> BaseTransferClassifier:
        checkpoint = self._load_checkpoint(self.root / "base_models" / f"{name}_best.pth")
        model = BaseTransferClassifier(name)
        model.load_state_dict(checkpoint["state_dict"], strict=True)
        return model.float().to(self.device).eval()

    def internal_benchmark(self) -> dict[str, Any]:
        benchmark = self.metrics["internal_benchmark"]
        return {
            "label": "Internal development benchmark",
            "samples": int(benchmark["n"]),
            "accuracy": float(benchmark["accuracy"]),
            "sensitivity": float(benchmark["sensitivity"]),
            "specificity": float(benchmark["specificity"]),
            "auroc": float(benchmark["roc_auc"]),
            "f1": float(benchmark["f1"]),
            "confusion_matrix": {
                "tn": int(benchmark["tn"]),
                "fp": int(benchmark["fp"]),
                "fn": int(benchmark["fn"]),
                "tp": int(benchmark["tp"]),
            },
        }

    def predict_bytes(self, raw_bytes: bytes) -> dict[str, Any]:
        rgb = decode_rgb(raw_bytes)
        quality = quality_report(rgb)
        if not quality["accepted"]:
            return {
                "decision": "recapture_required",
                "screening_probability": None,
                "operating_threshold": CORRECTED_OPERATING_THRESHOLD,
                "uncertain": False,
                "quality": quality,
                "warning": WARNING,
            }
        with self._execution_lock:
            return self._predict_accepted(rgb, quality)

    @torch.inference_mode()
    def _predict_accepted(self, rgb: np.ndarray, quality: dict[str, Any]) -> dict[str, Any]:
        image = Image.fromarray(rgb)
        efficientnet_tensor = self.efficientnet_transform(image).unsqueeze(0).to(self.device)
        convnext_tensor = self.convnext_transform(image).unsqueeze(0).to(self.device)
        vit_tensor = self.vit_transform(image).unsqueeze(0).to(self.device)

        efficientnet_logit = float(self.efficientnet(efficientnet_tensor).item())
        convnext_logit = float(self.convnext(convnext_tensor).item())
        vit_logit = float(self.vit(vit_tensor).item())
        logits = np.asarray([efficientnet_logit, convnext_logit, vit_logit])
        if not np.isfinite(logits).all():
            raise RuntimeError("A V4 base model produced NaN or infinity.")

        features = engineered_features(rgb)
        standardized = ((features - self.feature_mean) / self.feature_std).astype(np.float32)
        stacker_input = build_stacker_input(
            efficientnet_logit, convnext_logit, vit_logit, standardized
        )
        scaled_input = self.stacker["scaler"].transform(stacker_input)
        if np.asarray(scaled_input).shape != (1, 35) or not np.isfinite(scaled_input).all():
            raise RuntimeError("The saved stacker scaler produced an invalid 35-value input.")

        raw_probability = float(self.stacker["model"].predict_proba(scaled_input)[0, 1])
        if not np.isfinite(raw_probability):
            raise RuntimeError("The logistic stacker produced a non-finite probability.")
        clipped = float(np.clip(raw_probability, 1e-6, 1 - 1e-6))
        raw_logit = np.log(clipped / (1 - clipped))
        calibration = self.runtime["calibration"]
        calibrated = float(
            1
            / (
                1
                + np.exp(
                    -(
                        float(calibration["coefficient"]) * raw_logit
                        + float(calibration["intercept"])
                    )
                )
            )
        )
        if not np.isfinite(calibrated) or not 0 <= calibrated <= 1:
            raise RuntimeError("Platt calibration produced an invalid probability.")

        decision, uncertain = decision_from_probability(calibrated)
        return {
            "decision": decision,
            "screening_probability": calibrated,
            "operating_threshold": CORRECTED_OPERATING_THRESHOLD,
            "uncertain": uncertain,
            "quality": quality,
            "warning": WARNING,
        }


_predictor: AnemiaScanV4Predictor | None = None
_predictor_lock = threading.Lock()


def get_predictor(device: str = "auto") -> AnemiaScanV4Predictor:
    global _predictor
    if _predictor is None:
        with _predictor_lock:
            if _predictor is None:
                _predictor = AnemiaScanV4Predictor(device=device)
    return _predictor


def reset_predictor_for_tests() -> None:
    global _predictor
    with _predictor_lock:
        _predictor = None
