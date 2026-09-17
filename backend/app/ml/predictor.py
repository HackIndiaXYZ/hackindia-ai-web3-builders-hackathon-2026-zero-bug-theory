"""Deterministic AnemiaScan V4 ONNX model runtime.

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
import onnxruntime as ort
from PIL import Image

MODEL_VERSION = "anemiascan-v4-onnx-int8"
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
    "efficientnet_b3.onnx",
    "convnext_tiny.onnx",
    "vit_b16.onnx",
    "stacking_model.joblib",
    "train_only_scalers.npz",
    "runtime_config.json",
    "metrics.json",
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


def numpy_image_transform(image: Image.Image, resize: int, crop: int, interpolation: int) -> np.ndarray:
    """Replicates torchvision transforms without torch."""
    width, height = image.size
    if width < height:
        new_width = resize
        new_height = int(resize * height / width)
    else:
        new_height = resize
        new_width = int(resize * width / height)
        
    img = image.resize((new_width, new_height), resample=interpolation)
    
    left = (new_width - crop) / 2
    top = (new_height - crop) / 2
    right = (new_width + crop) / 2
    bottom = (new_height + crop) / 2
    img = img.crop((left, top, right, bottom))
    
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = np.transpose(arr, (2, 0, 1))
    
    mean = np.array(IMAGENET_MEAN, dtype=np.float32).reshape(3, 1, 1)
    std = np.array(IMAGENET_STD, dtype=np.float32).reshape(3, 1, 1)
    arr = (arr - mean) / std
    
    return np.expand_dims(arr, axis=0).astype(np.float32)


def build_stacker_input(
    efficientnet_logit: float,
    convnext_logit: float,
    vit_logit: float,
    standardized_features: np.ndarray,
) -> np.ndarray:
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


class AnemiaScanV4Predictor:
    def __init__(self, bundle_directory: Path = MODEL_ASSETS_DIR):
        self.root = Path(bundle_directory).resolve()
        self._execution_lock = threading.Lock()

        manifest_path = self.root / "model_manifest.json"
        if not manifest_path.is_file():
            raise ModelUnavailableError(
                "AnemiaScan V4 ONNX assets are not installed."
            )
        self.manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        actual_hash = _required_content_hash(self.root)
        if self.manifest.get("model_hash") != actual_hash:
            raise ModelUnavailableError("V4 ONNX model files do not match the installed SHA-256 manifest.")
        self.model_hash = "0x" + actual_hash

        self.runtime = json.loads((self.root / "runtime_config.json").read_text(encoding="utf-8"))
        self.metrics = json.loads((self.root / "metrics.json").read_text(encoding="utf-8"))
        self._validate_runtime()

        with np.load(self.root / "train_only_scalers.npz") as scalers:
            self.feature_mean = scalers["feature_mean"].astype(np.float32)
            self.feature_std = scalers["feature_std"].astype(np.float32)

        # Load ONNX Models with aggressive low-memory settings
        providers = ["CPUExecutionProvider"]
        sess_options = ort.SessionOptions()
        sess_options.intra_op_num_threads = 1
        sess_options.inter_op_num_threads = 1
        sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
        sess_options.enable_cpu_mem_arena = False
        sess_options.enable_mem_pattern = False
        
        self.efficientnet = ort.InferenceSession(str(self.root / "efficientnet_b3.onnx"), providers=providers, sess_options=sess_options)
        self.convnext = ort.InferenceSession(str(self.root / "convnext_tiny.onnx"), providers=providers, sess_options=sess_options)
        self.vit = ort.InferenceSession(str(self.root / "vit_b16.onnx"), providers=providers, sess_options=sess_options)

        self.stacker = joblib.load(self.root / "stacking_model.joblib")

    def _validate_runtime(self) -> None:
        expected_order = ["efficientnet_logit", "convnext_logit", "vit_logit"] + [
            f"feature_{index:02d}" for index in range(32)
        ]
        if self.runtime.get("selected_candidate") != "calibrated_logistic_stacker":
            raise ModelUnavailableError("V4 runtime does not select calibrated_logistic_stacker.")
        if self.runtime.get("stacker_input_order") != expected_order:
            raise ModelUnavailableError("V4 runtime stacker order is incompatible.")
        
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

    def _predict_accepted(self, rgb: np.ndarray, quality: dict[str, Any]) -> dict[str, Any]:
        image = Image.fromarray(rgb)
        
        eff_tensor = numpy_image_transform(image, 320, 300, Image.Resampling.BICUBIC)
        conv_tensor = numpy_image_transform(image, 236, 224, Image.Resampling.BILINEAR)
        vit_tensor = numpy_image_transform(image, 236, 224, Image.Resampling.BILINEAR)

        efficientnet_logit = float(self.efficientnet.run(None, {"input": eff_tensor})[0].flatten()[0])
        convnext_logit = float(self.convnext.run(None, {"input": conv_tensor})[0].flatten()[0])
        vit_logit = float(self.vit.run(None, {"input": vit_tensor})[0].flatten()[0])
        
        logits = np.asarray([efficientnet_logit, convnext_logit, vit_logit])
        if not np.isfinite(logits).all():
            raise RuntimeError("A V4 base model produced NaN or infinity.")

        features = engineered_features(rgb)
        standardized = ((features - self.feature_mean) / self.feature_std).astype(np.float32)
        stacker_input = build_stacker_input(
            efficientnet_logit, convnext_logit, vit_logit, standardized
        )
        scaled_input = self.stacker["scaler"].transform(stacker_input)

        raw_probability = float(self.stacker["model"].predict_proba(scaled_input)[0, 1])
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
    # ONNX runs on CPU by default for our setup
    global _predictor
    if _predictor is None:
        with _predictor_lock:
            if _predictor is None:
                _predictor = AnemiaScanV4Predictor()
    return _predictor

def reset_predictor_for_tests() -> None:
    global _predictor
    with _predictor_lock:
        _predictor = None
