# AnemiaScan backend

FastAPI service for the AnemiaScan V4 inference endpoint, screening
commitments, MST Testnet anchoring, and CarePool/CarePass bookkeeping.

## Setup

Use Python 3.11. On Windows, from this directory:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\pip.exe install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1
.\.venv\Scripts\pip.exe install -r requirements.txt
Copy-Item .env.example .env
```

On macOS/Linux, replace `.venv\Scripts\` with `.venv/bin/`. Installing the
CPU-only PyTorch wheels first avoids downloading a CUDA build. Set
`ML_DEVICE=auto` (default), `cpu`, or `cuda`; `auto` selects CUDA only when it
is available.

## Install the trusted V4 model

Do not copy arbitrary checkpoints into the application. Run the installer once:

```powershell
.\.venv\Scripts\python.exe scripts\install_v4_bundle.py G:\path\to\anemiascan_v4_eff_conv_vit_bundle.zip
```

It validates ZIP paths, CRCs, size, the runtime configuration, exact 35-value
stacker order, corrected threshold, uncertainty margin, preprocessing, and
benchmark metadata. It extracts only these files into the gitignored
`app/ml/model_assets/` directory and records a deterministic content manifest:

```text
base_models/efficientnet_b3_best.pth
base_models/convnext_tiny_best.pth
vit_b16_best.pth
stacking_model.joblib
train_only_scalers.npz
runtime_config.json
metrics.json
inference.py
```

The runtime then verifies the manifest and strict-loads all three checkpoints.
It never loads an uploaded pickle, joblib file, or checkpoint. The old
`anemiafusionnet_v3_1_gated.pth` is not part of the V4 path.

## Inference flow and API

At startup, the process-wide thread-safe singleton loads EfficientNet-B3,
ConvNeXt-Tiny, and ViT-B/16 in evaluation mode. Each accepted PNG/JPEG request
is decoded through OpenCV and converted to RGB, quality-gated, transformed with
the bundle's exact resize/crop and ImageNet normalization, and run under
`torch.inference_mode()`. The three logits are followed by the exact 32
standardized engineered features. The saved 35-input scaler/logistic stacker
and Platt calibration produce the screening probability.

```text
POST /api/anemia/analyze
Content-Type: multipart/form-data
Field: image
```

The response uses stable camelCase fields and includes the decision, screening
probability, corrected operating threshold, quality measurements, model
version/hash, warning, and metrics read from `metrics.json` under the label
`Internal development benchmark`. Quality failure returns
`recapture_required` with no probability. The image is processed transiently
and is not persisted by this endpoint.

`POST /registry/screenings` remains available for the existing commitment and
MST flow. `INFERENCE_PROVIDER=mock` remains an explicit CI/offline option for
that legacy registry route only; the public V4 analysis endpoint never returns
mock medical results.

## Run and test

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
.\.venv\Scripts\python.exe -m pytest -q
```

Interactive docs are at `http://localhost:8000/docs`. `GET /health` checks the
configured chain when MST settings are present. Chain addresses and signer
configuration are optional for the non-persisting V4 analysis endpoint; see
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for that separate flow.
