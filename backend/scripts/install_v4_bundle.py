"""Safely install the trusted AnemiaScan V4 inference bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESTINATION = BACKEND_ROOT / "app" / "ml" / "model_assets"
MAX_UNCOMPRESSED_BYTES = 1_000_000_000
CORRECTED_THRESHOLD = 0.24259322528166496
UNCERTAINTY_MARGIN = 0.06909162763627245

REQUIRED_FILES = {
    "efficientnet_b3.onnx",
    "convnext_tiny.onnx",
    "vit_b16.onnx",
    "stacking_model.joblib",
    "train_only_scalers.npz",
    "runtime_config.json",
    "metrics.json",
}


class BundleValidationError(ValueError):
    """Raised when an archive is unsafe or is not the required V4 bundle."""


def _validated_members(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    members: dict[str, zipfile.ZipInfo] = {}
    total_size = 0
    for member in archive.infolist():
        path = PurePosixPath(member.filename.replace("\\", "/"))
        mode = member.external_attr >> 16
        if path.is_absolute() or ".." in path.parts or any(":" in part or "\x00" in part for part in path.parts):
            raise BundleValidationError(f"Unsafe archive path: {member.filename!r}")
        if mode and stat.S_ISLNK(mode):
            raise BundleValidationError(f"Symlink entries are not allowed: {member.filename!r}")
        if member.flag_bits & 0x1:
            raise BundleValidationError(f"Encrypted entries are not allowed: {member.filename!r}")
        if member.is_dir():
            continue
        normalized = path.as_posix()
        key = normalized.casefold()
        if key in members:
            raise BundleValidationError(f"Duplicate archive path: {member.filename!r}")
        members[key] = member
        total_size += member.file_size
    if total_size > MAX_UNCOMPRESSED_BYTES:
        raise BundleValidationError("The archive exceeds the 1 GB uncompressed safety limit.")
    missing = sorted(name for name in REQUIRED_FILES if name.casefold() not in members)
    if missing:
        raise BundleValidationError("Missing required V4 files: " + ", ".join(missing))
    if "anemiafusionnet_v3_1_gated.pth" in members:
        raise BundleValidationError("The V3.1 gated checkpoint must not be installed in the V4 path.")
    bad_member = archive.testzip()
    if bad_member is not None:
        raise BundleValidationError(f"ZIP CRC validation failed for {bad_member!r}.")
    return members


def _validate_configuration(root: Path) -> tuple[dict, dict]:
    runtime = json.loads((root / "runtime_config.json").read_text(encoding="utf-8"))
    metrics = json.loads((root / "metrics.json").read_text(encoding="utf-8"))
    expected_order = ["efficientnet_logit", "convnext_logit", "vit_logit"] + [
        f"feature_{index:02d}" for index in range(32)
    ]
    if runtime.get("selected_candidate") != "calibrated_logistic_stacker":
        raise BundleValidationError("runtime_config.json does not select calibrated_logistic_stacker.")
    if runtime.get("stacker_input_order") != expected_order:
        raise BundleValidationError("runtime_config.json does not define the required 35-value stacker order.")
    bundled_threshold = float(runtime.get("selected_threshold", -1))
    if abs(bundled_threshold - CORRECTED_THRESHOLD) > 0.000002:
        raise BundleValidationError(
            f"Bundle threshold {bundled_threshold!r} is incompatible with corrected threshold {CORRECTED_THRESHOLD!r}."
        )
    if float(runtime.get("uncertainty_margin", -1)) != UNCERTAINTY_MARGIN:
        raise BundleValidationError("runtime_config.json has an unexpected uncertainty margin.")
    preprocessing = runtime.get("preprocessing", {})
    expected_preprocessing = {
        "efficientnet_b3": (320, 300),
        "convnext_tiny": (236, 224),
        "vit_b16": (236, 224),
    }
    for model, (resize, crop) in expected_preprocessing.items():
        actual = preprocessing.get(model, {})
        if (actual.get("resize"), actual.get("crop"), actual.get("normalization")) != (resize, crop, "ImageNet"):
            raise BundleValidationError(f"Unexpected preprocessing configuration for {model}.")
    benchmark = metrics.get("internal_benchmark")
    if not isinstance(benchmark, dict) or int(benchmark.get("n", 0)) <= 0:
        raise BundleValidationError("metrics.json has no internal development benchmark.")
    return runtime, metrics


def _model_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for relative in sorted(REQUIRED_FILES):
        encoded_name = relative.encode("utf-8")
        digest.update(len(encoded_name).to_bytes(4, "big"))
        digest.update(encoded_name)
        with (root / relative).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def install_bundle(source: Path, destination: Path = DEFAULT_DESTINATION) -> dict:
    source = source.expanduser().resolve()
    destination = destination.resolve()
    if not source.is_file() or not zipfile.is_zipfile(source):
        raise BundleValidationError(f"Not a readable ZIP archive: {source}")
    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite existing model assets: {destination}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    # Create the final directory only after all archive metadata checks pass.
    # On any extraction/configuration failure the except block removes it.
    # This avoids Windows ACL problems caused by renaming freshly-created
    # staging directories across security contexts.
    staging = destination
    staging.mkdir()
    try:
        with zipfile.ZipFile(source) as archive:
            members = _validated_members(archive)
            for relative in REQUIRED_FILES:
                member = members[relative.casefold()]
                target = staging / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source_handle, target.open("wb") as destination_handle:
                    shutil.copyfileobj(source_handle, destination_handle)

        runtime, metrics = _validate_configuration(staging)
        manifest = {
            "model_version": "anemiascan-v4-onnx-int8",
            "model_hash": _model_hash(staging),
            "hash_algorithm": "sha256-required-path-and-content-v1",
            "selected_candidate": runtime["selected_candidate"],
            "bundled_threshold": runtime["selected_threshold"],
            "corrected_operating_threshold": CORRECTED_THRESHOLD,
            "uncertainty_margin": UNCERTAINTY_MARGIN,
            "internal_benchmark_samples": metrics["internal_benchmark"]["n"],
        }
        (staging / "model_manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return manifest
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_path", type=Path)
    arguments = parser.parse_args()
    try:
        manifest = install_bundle(arguments.zip_path)
    except (BundleValidationError, FileExistsError, OSError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
