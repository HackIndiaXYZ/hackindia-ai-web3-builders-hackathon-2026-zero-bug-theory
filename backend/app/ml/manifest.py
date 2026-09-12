"""Weights-derived model identity.

The on-chain `modelHash` used to be `keccak256("ANEMIASCAN_V3_1_CALIBRATED_
LOGISTIC_STACKER")` — a keccak of a fixed text tag. That constant is the same
whatever bytes are actually sitting in `model_assets/`, so it could not detect a
swapped, corrupted or silently-retrained checkpoint. Anchoring it on-chain
proved only that *someone said* "V3.1", which is not tamper evidence.

This module derives the identity from the artefacts themselves: every file the
runtime loads is hashed, the (path, sha256) pairs are serialised in a canonical
sorted form, and the model hash is keccak256 of that manifest. Change one byte
of one checkpoint — or one threshold in runtime_config.json — and the hash
changes, so a commitment anchored under the old hash no longer corresponds to
the model that produced it.

The same manifest doubles as the provenance record in MODEL_CARD.md and is what
`contracts/scripts/registerModel.ts` registers, so the chain, the card and the
running service cannot silently disagree.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

from eth_utils import keccak

MODEL_ASSETS_DIR = Path(__file__).resolve().parent / "model_assets"

# Every file the predictor actually opens at runtime. Listed explicitly rather
# than globbed so that adding a stray file to the directory cannot change the
# model's identity, and so a missing file is a loud error rather than a
# quietly-different hash.
MANIFEST_FILES: tuple[str, ...] = (
    "runtime_config.json",
    "train_only_scalers.npz",
    "stacking_model.joblib",
    "anemiafusionnet_v3_1_gated.pth",
    "base_models/efficientnet_b3_best.pth",
    "base_models/convnext_tiny_best.pth",
)

# Domain separator, so this hash can never collide with a commitment hash or
# any other keccak in the system.
MANIFEST_SCHEMA_TAG = "ANEMIASCAN_MODEL_MANIFEST_V1"


def _sha256_stream(path: Path) -> str:
    """Raw-byte digest, streamed so a 100MB+ checkpoint is never fully
    materialised in memory just to be hashed."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _asset_digest(path: Path) -> tuple[str, int]:
    """The `(sha256, byte-length)` pair this asset's identity is derived from.

    A `.json` config is re-parsed and re-serialised in a canonical form
    (sorted keys, fixed separators) before hashing, so the model hash reflects
    the VALUES the runtime reads and not incidental encoding: a Windows
    checkout with `core.autocrlf=true` rewrites a newly git-tracked text
    file's line endings on checkout, which silently changed this hash for
    every clone/OS combination even though every threshold and calibration
    parameter was byte-for-byte identical. Measured: this shifted
    runtime_config.json from 953 LF-terminated bytes to 985 CRLF-terminated
    bytes (32 lines, +1 byte each) with the JSON values unchanged.

    The length returned here matters just as much as the digest: it is the
    length of the CANONICAL text, not `path.stat().st_size` — the raw on-disk
    size is exactly as encoding-sensitive as the un-canonicalised bytes were,
    and it is embedded in `canonical_manifest_text()` alongside the digest, so
    reporting the raw size would leak the same non-determinism straight back
    into the hashed manifest even with a stable digest.

    Binary weights (`.pth`/`.joblib`/`.npz`) are never subject to that
    translation and are streamed and hashed as raw bytes, so a 111MB
    checkpoint is never fully loaded into memory; their reported length is the
    real on-disk size.
    """
    if path.suffix == ".json":
        parsed = json.loads(path.read_text(encoding="utf-8"))
        canonical = json.dumps(parsed, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest(), len(canonical)
    return _sha256_stream(path), path.stat().st_size


def build_manifest(assets_dir: Path | None = None) -> dict:
    """Hash every runtime asset. Raises if one is missing."""
    root = Path(assets_dir) if assets_dir is not None else MODEL_ASSETS_DIR
    files = []
    for relative in sorted(MANIFEST_FILES):
        path = root / relative
        if not path.is_file():
            raise FileNotFoundError(
                f"model asset missing: {relative} (looked in {root}). "
                "The bundle is required for INFERENCE_PROVIDER=real; see "
                "backend/app/ml/model_assets/BUNDLE_README.md."
            )
        sha256, byte_length = _asset_digest(path)
        files.append(
            {
                "path": relative,
                "sha256": sha256,
                "bytes": byte_length,
            }
        )
    return {"schema": MANIFEST_SCHEMA_TAG, "files": files}


def canonical_manifest_text(manifest: dict) -> str:
    """The exact bytes that get hashed. Stable, sorted, newline-terminated."""
    lines = [manifest["schema"]]
    lines += [f"{entry['path']} {entry['sha256']} {entry['bytes']}" for entry in manifest["files"]]
    return "\n".join(lines) + "\n"


def model_hash_for(manifest: dict) -> str:
    return "0x" + keccak(text=canonical_manifest_text(manifest)).hex()


@lru_cache
def get_model_identity() -> tuple[str, str]:
    """`(model_hash, canonical_manifest_text)` for the installed bundle."""
    manifest = build_manifest()
    return model_hash_for(manifest), canonical_manifest_text(manifest)


def get_model_hash() -> str:
    return get_model_identity()[0]


def main() -> None:
    """`python -m app.ml.manifest [--json out.json]` — print the model identity.

    contracts/scripts/registerModel.ts reads the JSON form so the hash it
    registers on AnemiaRegistry is derived from the same bytes the backend
    loads, rather than being retyped by hand.
    """
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, default=None, help="write the manifest here")
    arguments = parser.parse_args()

    manifest = build_manifest()
    model_hash = model_hash_for(manifest)
    payload = {
        **manifest,
        "model_hash": model_hash,
        "canonical_text": canonical_manifest_text(manifest),
    }

    if arguments.json:
        arguments.json.parent.mkdir(parents=True, exist_ok=True)
        arguments.json.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"model_hash = {model_hash}")
    for entry in manifest["files"]:
        print(f"  {entry['sha256']}  {entry['bytes']:>10,}  {entry['path']}")
    if arguments.json:
        print(f"\nwrote {arguments.json}")


if __name__ == "__main__":
    main()
