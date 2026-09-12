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

from . import gate as gating
from .roi import locate_conjunctiva

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
EPS = 1e-6

MODEL_ASSETS_DIR = Path(__file__).resolve().parent / "model_assets"

# Identifies the inference stack (weights + ROI localiser + gates) in every
# API response and in the model card. Bump the suffix when any of those change.
MODEL_VERSION = "anemiascan-v3.1+roi1+gate1"

RESEARCH_WARNING = (
    "Research screening result only; obtain a CBC/hemoglobin test and "
    "professional evaluation for diagnosis."
)

# The four decisions the inference contract declares, mapped to the label the
# UI shows. "uncertain" is a first-class outcome, not a synonym for moderate:
# it means the calibrated probability sits within the uncertainty margin of the
# operating threshold, or the two candidate models disagree.
RISK_CATEGORY = {
    "lower_risk": "Lower risk",
    "higher_risk": "Higher risk",
    "uncertain": "Uncertain",
    "recapture_required": "Recapture required",
}


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


def quality_report(rgb, mask=None):
    """Capture-quality gate.

    `mask` restricts the brightness / blur / clipping statistics to the tissue
    pixels of a segmented ROI. This matters because a masked ROI is
    deliberately black outside the tissue, and counting that background as
    "clipped" made the gate reject its own correctly-segmented output: after
    padding a located lid strip to a square, ~79% of the canvas is black, which
    sailed past the 0.80 severely_clipped limit and refused the palest (most
    clinically important) captures. With no mask the behaviour is unchanged, so
    the raw submitted frame is still gated exactly as before.
    """
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    if mask is not None:
        selected = np.asarray(mask).astype(bool)
        if selected.shape != gray.shape:
            selected = (
                cv2.resize(
                    selected.astype(np.uint8),
                    (gray.shape[1], gray.shape[0]),
                    interpolation=cv2.INTER_NEAREST,
                ).astype(bool)
            )
        if not selected.any():
            selected = np.ones_like(gray, dtype=bool)
        values = gray[selected]
        brightness = float(values.mean())
        clipped = float(((values <= 3) | (values >= 252)).mean())
        # Laplacian needs spatial context, so measure it on the tissue
        # bounding box rather than on a scattered pixel selection.
        ys, xs = np.nonzero(selected)
        blur = float(
            cv2.Laplacian(
                gray[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1], cv2.CV_32F
            ).var()
        )
    else:
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

        # The stacker's own StandardScaler was fitted on the 648 training
        # samples, so its first two entries are the mean and sd of the two base
        # logits over the training set. gate.check_encoders uses them to tell
        # an in-range encoder output from one that has left the fitted manifold
        # (uniform noise drives the EfficientNet logit to -3997, a z of -120).
        stacker_scaler = self.stacker["scaler"]
        self.logit_mean = np.asarray(stacker_scaler.mean_[:2], dtype=np.float64)
        self.logit_scale = np.asarray(stacker_scaler.scale_[:2], dtype=np.float64)

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

    @staticmethod
    def _rejected(quality, roi_report, gate_report):
        """A gate refused the image: return a reason, never a score."""
        return {
            "decision": "recapture_required",
            "quality": quality,
            "roi": roi_report.as_dict() if roi_report is not None else None,
            "gate": gate_report.as_dict(),
            "screening_probability": None,
            "recapture_reasons": list(gate_report.failures),
            "message": gate_report.message(),
            "model_version": MODEL_VERSION,
            "warning": (
                "Input failed the conjunctiva plausibility / in-distribution "
                "check. Do not return an anemia prediction."
            ),
        }

    @torch.inference_mode()
    def predict_bytes(self, raw_bytes, *, localise=True):
        """Score one in-memory image.

        Pipeline order, matching the documented spec:
          1. decode
          2. capture-quality gate on the submitted frame
          3. conjunctiva ROI localisation + masking (roi.py) -- the stage the
             bundle README says is required for smartphone eye photographs
          4. capture-quality gate on the located ROI
          5. engineered features + train-only scaling
          6. in-distribution gate on those features (gate.py)
          7. base encoders, then an encoder-range gate
          8. fusion, calibration, thresholded decision

        Any gate can return `recapture_required` with a named reason. Set
        `localise=False` only when the caller already holds a segmented ROI
        (the CLI, and the gate unit tests).
        """
        rgb = decode_rgb(raw_bytes)
        quality = quality_report(rgb)
        if not quality["accepted"]:
            return {
                "decision": "recapture_required",
                "quality": quality,
                "roi": None,
                "gate": None,
                "screening_probability": None,
                "recapture_reasons": list(quality["failures"]),
                "message": gating.RECAPTURE_MESSAGES.get(
                    quality["failures"][0], "Input quality failed. Please retake the scan."
                ),
                "model_version": MODEL_VERSION,
                "warning": "Input quality failed. Do not return an anemia prediction.",
            }

        if localise:
            located, roi_report = locate_conjunctiva(rgb)
            if located is None:
                reasons = roi_report.failures or ["no_roi_detected"]
                return {
                    "decision": "recapture_required",
                    "quality": quality,
                    "roi": roi_report.as_dict(),
                    "gate": None,
                    "screening_probability": None,
                    "recapture_reasons": list(reasons),
                    "message": gating.RECAPTURE_MESSAGES.get(
                        reasons[0], "No conjunctiva was found in that photo."
                    ),
                    "model_version": MODEL_VERSION,
                    "warning": "No conjunctiva ROI located. Do not return an anemia prediction.",
                }
            rgb = located
            # Measure ROI quality over tissue pixels only -- the background is
            # black by design, and counting it as clipped would reject our own
            # correctly-segmented output.
            quality = quality_report(rgb, mask=roi_report.mask)
            if not quality["accepted"]:
                return {
                    "decision": "recapture_required",
                    "quality": quality,
                    "roi": roi_report.as_dict(),
                    "gate": None,
                    "screening_probability": None,
                    "recapture_reasons": list(quality["failures"]),
                    "message": gating.RECAPTURE_MESSAGES.get(
                        quality["failures"][0], "Input quality failed. Please retake the scan."
                    ),
                    "model_version": MODEL_VERSION,
                    "warning": "Input quality failed. Do not return an anemia prediction.",
                }
        else:
            roi_report = None

        image = Image.fromarray(rgb)
        b3_tensor = self.transform_b3(image).unsqueeze(0).to(self.device)
        conv_tensor = self.transform_convnext(image).unsqueeze(0).to(self.device)
        feature_raw = engineered_features(rgb)
        feature_scaled = ((feature_raw - self.feature_mean) / self.feature_std).astype(
            np.float32
        )

        # -- gate 6: is this plausibly a conjunctiva ROI at all? --------------
        gate_report = gating.check_features(
            feature_raw,
            feature_scaled,
            laplacian_variance=quality["blur_variance"],
        )
        if not gate_report.accepted:
            return self._rejected(quality, roi_report, gate_report)

        eff_embedding = self.efficientnet.encode(b3_tensor)
        conv_embedding = self.convnext.encode(conv_tensor)
        eff_logit = self.efficientnet.classify_embedding(eff_embedding)
        conv_logit = self.convnext.classify_embedding(conv_embedding)

        if not all(
            torch.isfinite(value).all()
            for value in (eff_embedding, conv_embedding, eff_logit, conv_logit)
        ):
            raise RuntimeError("Base encoder produced NaN/Inf")

        # -- gate 7: did the encoders stay inside their fitted range? --------
        gate_report = gating.check_encoders(
            gate_report,
            efficientnet_logit=float(eff_logit.item()),
            convnext_logit=float(conv_logit.item()),
            efficientnet_absmax=float(eff_embedding.abs().max().item()),
            convnext_absmax=float(conv_embedding.abs().max().item()),
            logit_mean=self.logit_mean,
            logit_scale=self.logit_scale,
        )
        if not gate_report.accepted:
            return self._rejected(quality, roi_report, gate_report)

        stacker_input = np.concatenate(
            [
                np.array([float(eff_logit.item()), float(conv_logit.item())]),
                feature_scaled,
            ]
        ).reshape(1, -1)
        stacker_input = self.stacker["scaler"].transform(stacker_input)
        logistic_raw = self.stacker["model"].predict_proba(stacker_input)[:, 1]
        # apply_calibration clips its input to [EPS, 1-EPS] before taking the
        # logit, so a raw probability that has saturated to exactly 0.0 or 1.0
        # emerges as a hard bound (0.00390 / 0.99751) rather than a meaningful
        # value. Two completely different garbage inputs used to report the
        # identical 0.9975 for this reason. Detect it and refuse instead.
        raw_saturated = bool(
            float(logistic_raw[0]) <= EPS or float(logistic_raw[0]) >= 1.0 - EPS
        )
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

        # A saturated raw probability is not a confident answer, it is an
        # unreadable one. Refuse rather than report a clipped bound.
        if raw_saturated and selected_name == "logistic_stacker":
            gate_report.failures.append("probability_saturated")
            gate_report.accepted = False
            return self._rejected(quality, roi_report, gate_report)

        average_gates = dict(
            zip(
                ["efficientnet", "convnext", "colour_features"],
                np.mean(gate_values, axis=0).astype(float).tolist(),
            )
        )
        quality_bps = gating.quality_score_bps(
            brightness=float(quality["brightness"]),
            laplacian_variance=float(quality["blur_variance"]),
            clipped_fraction=float(quality["clipped_fraction"]),
            roi_coverage=(roi_report.coverage if roi_report is not None else 1.0),
            distribution_budget=gate_report.distribution_budget,
        )

        return {
            "decision": decision,
            "risk_category": RISK_CATEGORY[decision],
            "screening_probability": selected_probability,
            "selected_model": selected_name,
            "operating_threshold": selected_threshold,
            "uncertainty_margin": float(self.thresholds["uncertainty_margin"]),
            "candidate_probabilities": probabilities,
            "candidate_thresholds": {
                "logistic_stacker": float(self.thresholds["logistic_stacker"]),
                "regularized_gated_fusion": float(
                    self.thresholds["regularized_gated_fusion"]
                ),
            },
            "model_disagreement": bool(disagreement),
            "near_threshold": bool(close),
            "quality": quality,
            "quality_bps": quality_bps,
            "roi": roi_report.as_dict() if roi_report is not None else None,
            "gate": gate_report.as_dict(),
            "average_gates": average_gates,
            "fusion_gate_weights": average_gates,
            "model_version": MODEL_VERSION,
            "recapture_reasons": [],
            "warning": RESEARCH_WARNING,
        }

    def predict(self, roi_image_path, *, localise=True):
        """File-path convenience wrapper (CLI / debugging) around predict_bytes."""
        return self.predict_bytes(Path(roi_image_path).read_bytes(), localise=localise)


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
