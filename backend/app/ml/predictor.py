"""AnemiaScan V3.1 calibrated bundle — in-process inference runtime.

Ported from the vendor bundle's own `inference.py` (see
`model_assets/BUNDLE_README.md` and `model_assets/inference_contract.json`
for provenance). The only real change from the vendor copy is that
`decode_rgb` and `AnemiaScanV31Predictor.predict_bytes` operate on raw bytes
already in memory instead of reading a file from disk — the FastAPI layer
never writes the uploaded image to disk, only holds it in memory for the
duration of one request (see app/inference.py's module docstring).

Input must be an already segmented palpebral/conjunctiva ROI. This is a
screening prototype, not a diagnosis — see `quality_report`'s
recapture-required gate and the warning string every prediction carries.
"""

from functools import lru_cache
from pathlib import Path
import json

import cv2
import joblib
import numpy as np
import torch
from PIL import Image
from torch import nn
from torchvision import transforms
from torchvision.models import convnext_tiny, efficientnet_b3
from torchvision.transforms import InterpolationMode


IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
EPS = 1e-6

MODEL_ASSETS_DIR = Path(__file__).resolve().parent / "model_assets"


def strip_bad_png_iccp(raw):
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


def decode_rgb(raw_bytes):
    """Decode an in-memory image (no disk I/O) into an RGB uint8 array."""
    raw = strip_bad_png_iccp(raw_bytes)
    decoded = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if decoded is None:
        raise ValueError("OpenCV could not decode the uploaded image")
    if decoded.ndim == 2:
        rgb = cv2.cvtColor(decoded, cv2.COLOR_GRAY2RGB)
    elif decoded.shape[2] == 4:
        rgb = cv2.cvtColor(decoded, cv2.COLOR_BGRA2RGB)
    elif decoded.shape[2] == 3:
        rgb = cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
    else:
        raise ValueError(f"Unsupported image shape: {decoded.shape}")
    return np.ascontiguousarray(rgb, dtype=np.uint8)


def gray_entropy(gray):
    histogram = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
    probability = histogram / max(float(histogram.sum()), 1.0)
    probability = probability[probability > 0]
    return float(-(probability * np.log2(probability)).sum() / 8.0)


def engineered_features(rgb):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    values = []
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
    sx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    sy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    sobel = cv2.magnitude(sx, sy)
    values += [
        gray.mean() / 255,
        gray.std() / 255,
        np.percentile(gray, 10) / 255,
        np.percentile(gray, 90) / 255,
        np.clip(laplacian.var() / 5000, 0, 1),
        np.clip(sobel.mean() / 255, 0, 1),
        gray_entropy(gray),
        (hsv[:, :, 1] > 180).mean(),
    ]
    result = np.asarray(values, dtype=np.float32)
    if result.shape != (32,) or not np.isfinite(result).all():
        raise RuntimeError(f"Invalid engineered features: {result}")
    return result


def quality_report(rgb):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    brightness = float(gray.mean())
    blur = float(cv2.Laplacian(gray, cv2.CV_32F).var())
    clipped = float(((gray <= 3) | (gray >= 252)).mean())
    failures = []
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


def inference_transform(size):
    resize_size = 320 if size == 300 else 236
    interpolation = (
        InterpolationMode.BICUBIC if size == 300 else InterpolationMode.BILINEAR
    )
    return transforms.Compose(
        [
            transforms.Resize(resize_size, interpolation=interpolation),
            transforms.CenterCrop(size),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )


class BaseTransferClassifier(nn.Module):
    def __init__(self, name):
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
            self.embedding_dim = dimension
        elif name == "convnext_tiny":
            self.net = convnext_tiny(weights=None)
            dimension = self.net.classifier[-1].in_features
            self.net.classifier[-1] = nn.Sequential(
                nn.Dropout(0.30), nn.Linear(dimension, 1)
            )
            self.embedding_dim = dimension
        else:
            raise ValueError(name)

    def encode(self, image):
        if self.name == "efficientnet_b3":
            value = self.net.features(image)
            value = self.net.avgpool(value)
            return torch.flatten(value, 1)
        value = self.net.features(image)
        value = self.net.avgpool(value)
        value = self.net.classifier[0](value)
        return torch.flatten(value, 1)

    def classify_embedding(self, embedding):
        if self.name == "efficientnet_b3":
            return self.net.classifier(embedding).flatten()
        return self.net.classifier[-1](embedding).flatten()


class AnemiaFusionNetV31(nn.Module):
    def __init__(
        self,
        efficientnet_dim=1536,
        convnext_dim=768,
        feature_dim=32,
        projection_dim=64,
    ):
        super().__init__()
        self.efficientnet_branch = nn.Sequential(
            nn.LayerNorm(efficientnet_dim),
            nn.Linear(efficientnet_dim, projection_dim),
            nn.GELU(),
            nn.Dropout(0.50),
        )
        self.convnext_branch = nn.Sequential(
            nn.LayerNorm(convnext_dim),
            nn.Linear(convnext_dim, projection_dim),
            nn.GELU(),
            nn.Dropout(0.50),
        )
        self.feature_branch = nn.Sequential(
            nn.Linear(feature_dim, 64),
            nn.GELU(),
            nn.Dropout(0.45),
            nn.Linear(64, projection_dim),
            nn.GELU(),
            nn.Dropout(0.25),
        )
        self.gate = nn.Sequential(
            nn.Linear(projection_dim * 3, 64),
            nn.GELU(),
            nn.Dropout(0.35),
            nn.Linear(64, 3),
        )
        self.head = nn.Sequential(
            nn.LayerNorm(projection_dim * 3),
            nn.Linear(projection_dim * 3, 64),
            nn.GELU(),
            nn.Dropout(0.50),
            nn.Linear(64, 1),
        )

    def forward(self, efficientnet_embedding, convnext_embedding, features):
        branches = [
            self.efficientnet_branch(efficientnet_embedding),
            self.convnext_branch(convnext_embedding),
            self.feature_branch(features),
        ]
        context = torch.cat(branches, dim=1)
        gates = torch.softmax(self.gate(context), dim=1)
        gated = torch.cat(
            [branch * gates[:, i : i + 1] for i, branch in enumerate(branches)],
            dim=1,
        )
        return self.head(gated).flatten(), gates


def sigmoid_np(value):
    value = np.clip(np.asarray(value, dtype=float), -40, 40)
    return 1 / (1 + np.exp(-value))


def apply_calibration(raw_probability, config):
    raw = np.clip(np.asarray(raw_probability, dtype=float), EPS, 1 - EPS)
    logits = np.log(raw / (1 - raw))
    if config["method"] == "identity":
        return raw
    if config["method"] == "temperature":
        return sigmoid_np(logits / float(config["parameters"]["temperature"]))
    if config["method"] == "platt":
        parameters = config["parameters"]
        return sigmoid_np(
            float(parameters["coefficient"]) * logits
            + float(parameters["intercept"])
        )
    raise ValueError(f"Unknown calibration method: {config}")


class AnemiaScanV31Predictor:
    def __init__(self, bundle_directory, device=None):
        self.root = Path(bundle_directory)
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )
        self.runtime = json.loads((self.root / "runtime_config.json").read_text())
        self.thresholds = self.runtime["thresholds"]
        self.calibration = self.runtime["calibration"]
        scalers = np.load(self.root / "train_only_scalers.npz")
        self.feature_mean = scalers["feature_mean"].astype(np.float32)
        self.feature_std = scalers["feature_std"].astype(np.float32)

        self.efficientnet = self._load_base("efficientnet_b3")
        self.convnext = self._load_base("convnext_tiny")
        self.stacker = joblib.load(self.root / self.runtime["stacker_model"])

        gated_checkpoint = torch.load(
            self.root / self.runtime["gated_model"],
            map_location="cpu",
            weights_only=False,
        )
        architecture = gated_checkpoint["architecture"]
        self.gated_heads = []
        for state in gated_checkpoint["head_state_dicts"]:
            head = AnemiaFusionNetV31(
                architecture["efficientnet_dim"],
                architecture["convnext_dim"],
                architecture["feature_dim"],
                architecture["projection_dim"],
            )
            head.load_state_dict(state, strict=True)
            self.gated_heads.append(head.to(self.device).eval())

        self.transform_b3 = inference_transform(300)
        self.transform_convnext = inference_transform(224)

    def _load_base(self, name):
        relative = self.runtime["base_models"][name]
        checkpoint = torch.load(
            self.root / relative, map_location="cpu", weights_only=False
        )
        if checkpoint.get("model_name") != name:
            raise RuntimeError(f"Wrong {name} checkpoint")
        model = BaseTransferClassifier(name)
        model.load_state_dict(checkpoint["state_dict"], strict=True)
        return model.float().to(self.device).eval()

    @torch.inference_mode()
    def predict_bytes(self, raw_bytes):
        rgb = decode_rgb(raw_bytes)
        quality = quality_report(rgb)
        if not quality["accepted"]:
            return {
                "decision": "recapture_required",
                "quality": quality,
                "screening_probability": None,
                "warning": "Input quality failed. Do not return an anemia prediction.",
            }

        image = Image.fromarray(rgb)
        b3_tensor = self.transform_b3(image).unsqueeze(0).to(self.device)
        conv_tensor = self.transform_convnext(image).unsqueeze(0).to(self.device)
        feature_raw = engineered_features(rgb)
        feature_scaled = ((feature_raw - self.feature_mean) / self.feature_std).astype(
            np.float32
        )

        eff_embedding = self.efficientnet.encode(b3_tensor)
        conv_embedding = self.convnext.encode(conv_tensor)
        eff_logit = self.efficientnet.classify_embedding(eff_embedding)
        conv_logit = self.convnext.classify_embedding(conv_embedding)

        if not all(
            torch.isfinite(value).all()
            for value in (eff_embedding, conv_embedding, eff_logit, conv_logit)
        ):
            raise RuntimeError("Base encoder produced NaN/Inf")

        stacker_input = np.concatenate(
            [
                np.array([float(eff_logit.item()), float(conv_logit.item())]),
                feature_scaled,
            ]
        ).reshape(1, -1)
        stacker_input = self.stacker["scaler"].transform(stacker_input)
        logistic_raw = self.stacker["model"].predict_proba(stacker_input)[:, 1]
        logistic_probability = float(
            apply_calibration(
                logistic_raw, self.calibration["logistic_stacker"]
            )[0]
        )

        feature_tensor = torch.from_numpy(feature_scaled).unsqueeze(0).to(self.device)
        gated_raw = []
        gate_values = []
        for head in self.gated_heads:
            output, gates = head(eff_embedding, conv_embedding, feature_tensor)
            gated_raw.append(float(torch.sigmoid(output).item()))
            gate_values.append(gates.cpu().numpy()[0])
        gated_probability = float(
            apply_calibration(
                [float(np.mean(gated_raw))],
                self.calibration["regularized_gated_fusion"],
            )[0]
        )

        probabilities = {
            "logistic_stacker": logistic_probability,
            "regularized_gated_fusion": gated_probability,
        }
        selected_name = self.runtime["selected_candidate"]
        selected_probability = probabilities[selected_name]
        selected_threshold = float(self.thresholds["selected_threshold"])
        other_name = (
            "regularized_gated_fusion"
            if selected_name == "logistic_stacker"
            else "logistic_stacker"
        )
        other_threshold = float(self.thresholds[other_name])
        disagreement = (selected_probability >= selected_threshold) != (
            probabilities[other_name] >= other_threshold
        )
        close = (
            abs(selected_probability - selected_threshold)
            <= float(self.thresholds["uncertainty_margin"])
        )
        if close or disagreement:
            decision = "uncertain"
        elif selected_probability >= selected_threshold:
            decision = "higher_risk"
        else:
            decision = "lower_risk"

        return {
            "decision": decision,
            "screening_probability": selected_probability,
            "selected_model": selected_name,
            "operating_threshold": selected_threshold,
            "candidate_probabilities": probabilities,
            "model_disagreement": bool(disagreement),
            "quality": quality,
            "average_gates": dict(
                zip(
                    ["efficientnet", "convnext", "colour_features"],
                    np.mean(gate_values, axis=0).astype(float).tolist(),
                )
            ),
            "warning": (
                "Research screening result only; obtain a CBC/hemoglobin test and "
                "professional evaluation for diagnosis."
            ),
        }

    def predict(self, roi_image_path):
        """File-path convenience wrapper (CLI / debugging) around predict_bytes."""
        return self.predict_bytes(Path(roi_image_path).read_bytes())


@lru_cache
def get_predictor(device="cpu"):
    """Loads the ~150MB of weights exactly once per process."""
    return AnemiaScanV31Predictor(MODEL_ASSETS_DIR, device=device)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("roi_image")
    parser.add_argument("--device", default=None)
    arguments = parser.parse_args()
    predictor = AnemiaScanV31Predictor(MODEL_ASSETS_DIR, device=arguments.device)
    print(json.dumps(predictor.predict(arguments.roi_image), indent=2))
