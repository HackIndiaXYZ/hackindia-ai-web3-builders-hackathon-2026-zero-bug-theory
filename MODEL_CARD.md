# Model card — AnemiaScan V3.1 (`anemiascan-v3.1+roi1+gate1`)

> **This is not a medical device.** It is a research prototype that estimates a
> *risk signal* for anaemia from a photograph of the palpebral conjunctiva (the
> inner surface of the lower eyelid). It has no regulatory clearance from any
> authority, it has not been clinically validated, and **its performance is
> unknown**: the training data, the split, and any evidence that the split was
> made at the patient level are not in this repository and could not be
> verified. Only a haemoglobin blood test (CBC) can confirm or rule out
> anaemia. Nothing this system outputs should change a clinical decision.

It does not measure haemoglobin. It cannot. No haemoglobin value, range or
g/dL figure is produced anywhere in the system, and any interface that shows
one is wrong.

## 1. Identity

| | |
|---|---|
| Model version | `anemiascan-v3.1+roi1+gate1` |
| Model hash (on-chain) | `0xcf19f102b46fa64f7260836c426cd29c05f994331a2be0c67964456e5f018c4d` |
| Task | Binary screening: anaemia risk, higher vs lower, with an explicit *uncertain* outcome |
| Input | One still image of an everted lower eyelid; the service locates and masks the conjunctiva itself |
| Output | A calibrated probability in `[0, 1]` plus one of `lower_risk` / `higher_risk` / `uncertain`, or a refusal to score at all |
| Selected candidate | `logistic_stacker` |
| Operating threshold | `0.20755079254891556` |
| Uncertainty margin | `0.040521640384822644` |
| Target sensitivity behind that threshold | `0.9` (stated in `thresholds.json`; **not** a measured sensitivity for this system — see §8) |
| Served by | `POST /inference/predict`; identity readable at `GET /inference/model` |

The version suffix `+roi1+gate1` marks that two stages were added around the
vendor bundle in this repository — a conjunctiva localiser and an
in-distribution gate (§5.2, §5.3). The suffix is bumped whenever any of the
three parts change.

## 2. Intended use

A research and demonstration screening **aid**. The intended reading of a
`higher_risk` result is "this photograph is worth following up with a blood
test", and nothing stronger.

Intended users are the developers and reviewers of this prototype, and
hackathon judges evaluating it. It is not intended for patients acting on it
alone, for clinicians using it as an input to care, or for any deployment that
substitutes for a laboratory test.

## 3. Out of scope

Do not use this model to:

- diagnose anaemia, exclude anaemia, or grade its severity;
- estimate, report or imply a haemoglobin concentration;
- triage, prioritise, or decide who receives testing or treatment;
- screen populations, or generate any statistic about a population;
- substitute for a CBC, a clinical examination, or a clinician's judgement;
- support any claim of accuracy, sensitivity or specificity (§8).

It is also out of scope for images that are not a close-up of an everted lower
eyelid. The system refuses those rather than scoring them (§6).

## 4. What it outputs, and what those numbers mean

**`screening_probability`** — a calibrated probability in `[0, 1]` that the
image belongs to the "anaemic" class as that class was labelled in training.
It is the headline number. It is **not** a confidence, not a severity, not a
percentage score out of 100, and not a haemoglobin proxy. Its calibration was
fitted on the bundle's own held-out split (§8), so treating it as a true
posterior probability for any new population is unwarranted.

**`decision`** — exactly one of:

| Decision | Meaning |
|---|---|
| `lower_risk` | Calibrated probability below the operating threshold by more than the uncertainty margin, with both candidates agreeing |
| `higher_risk` | Calibrated probability above the operating threshold by more than the margin, with both candidates agreeing |
| `uncertain` | A first-class outcome, not a midpoint: the probability sits within the margin of the threshold, **or** the two candidate models disagree about which side of their own thresholds it falls on |
| `recapture_required` | No result was produced. A gate refused the image and returned reasons (§6). Delivered as HTTP 422, never as a score |

`uncertain` must never be presented as "moderate risk". It means the system
could not separate the two classes for this image, which is a statement about
the system, not about the person.

**`quality_bps`** — a measured capture-quality score in basis points
(0-10000), computed from brightness, focus, clipping, ROI framing and distance
from the training distribution (§5.6). It describes the *photograph*, not the
risk, and it is not a confidence in the result.

**`probability_bps`** — the calibrated probability in basis points, for the
on-chain commitment, where a float cannot be committed reproducibly.

## 5. Architecture and inference pipeline

`POST /inference/predict` runs these stages in order. Any stage may refuse,
and a refusal never falls through to a score.

```
bytes -> decode -> capture-quality gate -> ROI localisation + masking
      -> capture-quality gate on the ROI -> 32 engineered features
      -> train-only standardisation -> in-distribution gate
      -> EfficientNet-B3 + ConvNeXt-Tiny encoders -> encoder-range gate
      -> logistic stacker + gated fusion net -> Platt calibration
      -> decision rule -> commitment -> (optional) on-chain anchor
```

### 5.1 Capture-quality gate

`predictor.quality_report`. Rejects a frame whose shorter side is under 96px
(`roi_too_small`), mean brightness below 12 (`extremely_dark`) or above 245
(`extremely_bright`), or more than 80% of pixels at the black/white rails
(`severely_clipped`). When a mask is supplied the statistics are computed over
tissue pixels only, so the intentionally-black background of a segmented ROI is
not counted as clipping.

### 5.2 ROI localisation (`backend/app/ml/roi.py`)

The bundle's own README states that its input "must be a segmented
palpebral/conjunctiva ROI" and that "a separate ROI localization stage is
required for arbitrary smartphone eye photographs". This repository supplies
that stage.

**It is a colour-geometry localiser, not a learned segmenter.** No segmentation
model and no ROI masks ship with the bundle. Instead, the expected input
distribution was recovered from `train_only_scalers.npz`, which records the
mean and standard deviation of all 32 engineered features over the training
ROIs. Those moments show the training inputs were masked segmentations on a
black ground — the 25th percentile of all three RGB channels is identically
0.0355 (9.1/255) while `gray_p90` is 0.5311 — and they give the tissue chroma
once the black background is deconvolved out of the recorded means.

Tissue is then selected per pixel on redness-over-yellowness (LAB `a - b`), the
axis haemoglobin drives, with a floor of 1.5 derived from that deconvolution
and checked across the pallor range; plus an absolute `a*` floor of 132 (which
excludes a blue iris, whose `a - b` is high only because `b*` is low) and a
saturation/value window (which excludes sclera, pupil and lashes). The largest
connected component is kept, interior holes are filled, the edge is feathered
so the mask boundary does not inject spurious high-frequency energy, and the
crop is centred on a black square canvas to match the training format.

The located region must clear 4.5% frame coverage and 96px on its shorter side,
or the stage reports `roi_coverage_low`, `no_roi_detected` or `roi_too_small`.

**Limitation.** This stage has **not** been measured against annotated ROI
masks — none exist in this repository — so its localisation accuracy is
unknown. Its thresholds were derived from the training moments and checked
against hand-measured colour patches across the pallor range, which is evidence
that it does not collapse on pale tissue (the clinically important case), but
that is not a validation. It is not itself clinically validated either.

### 5.3 Engineered features and the in-distribution gate (`backend/app/ml/gate.py`)

32 features are computed on the masked ROI: per-channel mean/std/p25/p75 for
RGB (12), mean/std for HSV (6) and LAB (6), gray mean/std/p10/p90 (4), and
normalised Laplacian variance, normalised Sobel magnitude, Shannon entropy and
saturated-pixel fraction (4). They are standardised by the bundle's train-only
scalers, so each value is a z-score against the distribution the model was
actually fitted on.

Every gate threshold is derived from those same training moments, not chosen by
hand:

| Check | Trigger | Reason code |
|---|---|---|
| Structural degeneracy | `gray_std` < 0.02, entropy < 0.05, Sobel < 0.005, or raw Laplacian variance < 8.0 | `degenerate_input` |
| Tissue chroma | abs(z) > 8 on LAB `a_mean` or `b_mean` | `implausible_chroma` |
| Excess high frequency | Sobel z > 6, entropy z > 5, or saturated-fraction z > 10 | `excess_high_frequency` |
| Global distance from training | sum of z-squared > 220 | `out_of_distribution` |
| Encoder range | abs(z) > 6 on either base logit, or embedding absmax > 50 | `encoder_out_of_range` |
| Saturated output | raw stacker probability pinned at a bound | `probability_saturated` |

This gate exists because the operating threshold is deliberately low, so
without it almost anything off-target read as elevated risk: on the real
predictor a flat grey square returned `higher_risk` at p=0.984 and uniform
noise at p=0.998. A constant-colour image has exactly zero variance, gradient
and entropy as a matter of arithmetic and a photograph cannot, which is why the
degeneracy floors are the primary catch and carry roughly a 10x margin on both
sides. The global budget is a deliberately loose backstop (220 against an
in-distribution 30.3, expectation 32.0) because the 32 features are strongly
correlated and the true null tail is much heavier than a chi-square on 32
degrees of freedom would suggest.

**Limitation.** These are plausibility checks on the input, not accuracy
guarantees on the output. Passing every gate means the image looks like the
kind of thing the model was fitted on. It says nothing about whether the
resulting probability is correct.

### 5.4 The two candidates

Both read the same two encoders and the same 32 features.

**Base encoders.** `efficientnet_b3` (resize 320 bicubic, centre-crop 300) and
`convnext_tiny` (resize 236 bilinear, centre-crop 224), both with ImageNet
normalisation and replaced classifier heads. Each contributes one logit and a
pooled embedding (1536-d and 768-d respectively).

**Candidate A — `logistic_stacker` (selected).** A `StandardScaler` plus a
`LogisticRegression` (liblinear, `max_iter=3000`) over a 34-dimensional vector:
the two base logits followed by the 32 engineered features. The scaler was
fitted on 648 training samples. This is the candidate that produces every
result the service returns.

**Candidate B — `regularized_gated_fusion` (`AnemiaFusionNetV31`).** A gated
fusion network with three branches — the EfficientNet embedding, the ConvNeXt
embedding, and the 32 engineered features — each projected to 64 dimensions.
A small gating network over the concatenated context emits a 3-way softmax that
reweights the branches before a shared head. The checkpoint ships **three
independently seeded heads** (seeds 11, 47, 101); their raw sigmoid outputs are
averaged before calibration. The averaged gate weights are returned as
`fusion_gate_weights` for inspection.

Candidate B is not the selected model. It is run on every request solely as a
**disagreement detector**: if the two candidates land on opposite sides of
their own thresholds, the decision becomes `uncertain`.

### 5.5 Calibration and the decision rule

Both candidates are Platt-scaled (`p' = sigmoid(a * logit(p) + b)`), with
parameters recorded in `calibration.json`:

| Candidate | Coefficient | Intercept | Threshold |
|---|---|---|---|
| `logistic_stacker` | 0.4174691353350448 | 0.22520197874437697 | 0.20755079254891556 |
| `regularized_gated_fusion` | 0.30488082994822013 | 0.15774667152381366 | 0.1854661003399828 |

The decision rule, exactly as implemented:

```
close        = |p_selected - threshold_selected| <= 0.040521640384822644
disagreement = (p_selected >= threshold_selected) != (p_other >= threshold_other)
decision     = "uncertain"   if close or disagreement
             = "higher_risk" if p_selected >= threshold_selected
             = "lower_risk"  otherwise
```

The threshold of 0.2076 is far below 0.5. `thresholds.json` records that it was
chosen against a `target_sensitivity` of 0.9 — deliberately biased towards
catching positives at the cost of false alarms. Two consequences follow, and
both are real: a large fraction of captures will read `higher_risk`, and that
label therefore carries much less information than its name suggests.

### 5.6 Capture-quality score

`gate.quality_score_bps` combines five measured terms into 0-10000: brightness
distance from the tissue-bearing range (weight 0.22), focus as Laplacian
variance against the training mean of ~1650 (0.26), clipping headroom against
the 0.80 limit (0.14), ROI framing against 0.45 coverage (0.16), and typicality
as distance from the training distribution against the 220 budget (0.22). All
five inputs are measured; none is synthesised. This replaced a hardcoded 10000
that was reported for every accepted capture and permanently committed
on-chain.

## 6. Refusals — the recapture contract

A refused capture returns **HTTP 422**, never a score, with
`detail = { decision: "recapture_required", reasons: [...], message, quality,
roi, gate }`. The reason codes are stable:

`roi_too_small`, `roi_coverage_low`, `no_roi_detected`, `extremely_dark`,
`extremely_bright`, `severely_clipped`, `out_of_focus`, `degenerate_input`,
`implausible_chroma`, `excess_high_frequency`, `out_of_distribution`,
`encoder_out_of_range`, `probability_saturated`.

Refusing is a feature. An off-target photograph gets a named reason and an
instruction, not a risk score.

## 7. Provenance

The on-chain `modelHash` is derived from the artefacts themselves, not from a
name. Every file the runtime loads is SHA-256'd, the triples are serialised in
canonical sorted form under the domain separator
`ANEMIASCAN_MODEL_MANIFEST_V1`, and the model hash is `keccak256` of that text.
Change one byte of one checkpoint — or one threshold in `runtime_config.json` —
and the hash changes, so a commitment anchored under the old hash no longer
corresponds to the model that produced it.

The four `.json` config files are re-parsed and re-serialised in a canonical
form (sorted keys, fixed separators) before hashing, rather than hashed as raw
file bytes. Without that, the hash was sensitive to something with no bearing
on the model at all: a Windows checkout with `core.autocrlf=true` rewrites a
newly git-tracked text file's line endings on checkout, which silently moved
`runtime_config.json` from 953 LF-terminated bytes to 985 CRLF-terminated
bytes — same thresholds, same calibration parameters, different hash on every
clone depending on the checkout OS. The binary weights (`.pth`/`.joblib`/
`.npz`) are never subject to that translation and are hashed as raw bytes.

| File | SHA-256 | Bytes |
|---|---|---|
| `anemiafusionnet_v3_1_gated.pth` | `9d79f6895e62a88b205d00ce762baab3372513d7e44549d295f2b6dc422f61dc` | 2,228,149 |
| `base_models/convnext_tiny_best.pth` | `bab72ce32214c2467f42a2ae160b466ae648e2d876730ca200e33cfa3befefde` | 111,340,831 |
| `base_models/efficientnet_b3_best.pth` | `ecc634d155874e0918ea4a69619529afd8884abb2d7cd26fb5afe3e08c615065` | 44,893,933 |
| `runtime_config.json` | `def0d460107d1ac1170c7cbbe42562f12e7669ffd8315ff37f6b307e49fa9fdd` | 763 (canonical) |
| `stacking_model.joblib` | `031369214deda7cf8d39ba3a8d5d3eecb5e880e877d12bd3dd75dc4bdab01169` | 2,353 |
| `train_only_scalers.npz` | `9518077ee855d206c5cf3e3c0d88081ac407ca3fc201404a66843a6e7024353b` | 1,846 |

```
model_hash = keccak256(
  "ANEMIASCAN_MODEL_MANIFEST_V1\n" +
  "<path> <sha256> <bytes>\n" for each file, sorted by path
)
           = 0xcf19f102b46fa64f7260836c426cd29c05f994331a2be0c67964456e5f018c4d
```

Reproduce it from an installed bundle with `python -m app.ml.manifest` in
`backend/`; write it out for the chain with
`python -m app.ml.manifest --json ../contracts/model-manifest.json`, then
`npm run register-model:testnet` in `contracts/`. `registerModel.ts` re-derives
the hash from `canonical_text` rather than trusting the JSON, so a hand-edited
manifest fails loudly instead of anchoring a hash no running model can
reproduce.

**Verify these digests before running the weights.** The weights are not
committed to this repository (111MB exceeds GitHub's hard file limit), so they
arrive out of band; the table above is what a correct bundle must hash to.

## 8. Evidence — read this before believing any number

### 8.1 What is not in this repository

- **The training data.** No images, no labels, no manifest of either.
- **The split.** There is no record of how train/validation/test were divided,
  and **no evidence anywhere that the split was made at the patient level**.
  If several photographs of the same eye or the same person landed on both
  sides of the split, every number below is optimistic by an unknown amount.
  This is the most common way conjunctiva-photo anaemia models are reported too
  favourably, and it cannot be ruled out here.
- **The training code.** Only inference code was ported.
- **Any metrics file.** The bundle contains no predictions dump and no metrics
  JSON. The bundle README's claim that it contains "predictions, metrics" is
  incorrect, and has been corrected in place.
- **Any external validation.** None has been performed, by the bundle's authors
  or here.

### 8.2 The deployed model has no reported performance at all

`stacking_model.joblib` — the artefact that produces **every** result the
service returns — contains exactly two objects: a fitted `StandardScaler` and a
fitted `LogisticRegression`. It carries **no metrics of any kind**: no AUC, no
sensitivity, no specificity, no calibration error, no `n`.

There is therefore **no reported performance figure for the model that is
actually deployed**, at any threshold, on any split. Not a poor one — none.

### 8.3 The numbers that do exist, and why they prove nothing here

Three of the `.pth` checkpoints carry embedded `metrics` dictionaries. They are
reproduced verbatim below for provenance, because omitting them would be its
own kind of dishonesty — not because they support any claim about this system.

Recorded dataset identity, identical in both base checkpoints:
`dataset_version = "AnemiaScan-V2-combined"`, `dataset_sources = {"CP-AnemiC":
710, "EYES-DEFY-ANEMIA": 216}` (926 images in total; the stacker's scaler
reports having seen 648 samples and both evaluation splits below report
n = 139, which is consistent with a 648/139/139 image-level division). Class
mapping: `{"non_anemic": 0, "anemic": 1}`.

| Checkpoint | Split | n | ROC AUC | Sensitivity | Specificity | Threshold |
|---|---|---|---|---|---|---|
| `efficientnet_b3_best.pth` | validation | 139 | 0.8544 | 0.9091 | 0.5161 | 0.1521 |
| `efficientnet_b3_best.pth` | test | 139 | 0.9064 | 0.8961 | 0.6935 | 0.1521 |
| `convnext_tiny_best.pth` | validation | 139 | 0.8919 | 0.8961 | 0.6290 | 0.0100 |
| `convnext_tiny_best.pth` | test | 139 | 0.9269 | 0.9351 | 0.6774 | 0.0100 |
| `anemiafusionnet_v3_1_gated.pth` | validation | 139 | 0.8976 | 0.9481 | 0.4677 | 0.1855 |
| `anemiafusionnet_v3_1_gated.pth` | internal benchmark | 139 | 0.9198 | 0.9481 | 0.5806 | 0.1855 |

Every one of these must be discounted, for reasons that compound:

1. **None of them describes the deployed model.** The first four rows are a
   single encoder each; the last two are candidate B, which is run only as a
   disagreement detector. The selected `logistic_stacker` appears nowhere.
2. **The "test" split is not a test split.** The bundle's own README says
   plainly: *"Current test metrics are an internal development benchmark
   because that split has already been examined during earlier iterations.
   Independent patient-level external validation is required."* A split used
   during model selection has stopped being held out.
3. **Patient-level separation is unverified** (§8.1). With 139 evaluation
   images drawn from source datasets of 710 and 216 images, repeated subjects
   are plausible and not excluded.
4. **n = 139 is small.** A sensitivity of 0.9481 is 73 of 77 positives; four
   more misses would take it to 0.90. Confidence intervals on every figure here
   are wide, and none was reported.
5. **Each figure is computed at that checkpoint's own threshold**, none of
   which is the 0.2076 this service operates at.
6. **The specificity figures are low** (0.4677-0.6935; the fusion candidate
   labels roughly half of non-anaemic validation images as positive). Whatever
   else is uncertain, the false-positive rate of this family of models on its
   own development data is high by design, and the deployed threshold is more
   aggressive still.
7. **Nothing here is independently reproducible.** Without the data, none of
   these numbers can be recomputed or audited.

**The honest summary: the deployed model's accuracy is unknown, and the
surrounding evidence is development-set self-report on a split its own authors
say was already examined.** Do not quote any figure in that table as this
system's performance.

### 8.4 Generalisation that was never measured

No stratified evaluation exists for any of the following, so the model's
behaviour on each is simply unknown:

- **Skin tone and periorbital pigmentation.** Nothing in the bundle records the
  skin-tone distribution of the training set, and no subgroup analysis was
  performed. Conjunctival pallor assessment is known to be affected by
  pigmentation, and a colour-based model trained on an unrecorded distribution
  may fail unevenly across it.
- **Lighting.** Colour temperature, mixed sources, flash, shade and glare all
  move the exact LAB chroma that both the model and the localiser depend on.
  The in-distribution gate limits *how far* an input may drift, but there is no
  measurement of how accuracy varies within that envelope.
- **Camera and sensor.** Phones apply different white balance, tone curves and
  denoising before the JPEG is written. The training capture devices are not
  recorded.
- **Disease spectrum.** No record of anaemia severity distribution, aetiology,
  or of comorbidities that change conjunctival appearance (jaundice,
  conjunctivitis, polycythaemia, recent eye drops, contact lenses).
- **Demographics.** Age, sex, pregnancy status and geography are unrecorded and
  unanalysed.
- **Capture protocol.** The training ROIs were pre-segmented by some unrecorded
  process; the localiser in §5.2 approximates that process but was never
  compared against it.

### 8.5 Components built here that are also unvalidated

The ROI localiser (§5.2), the in-distribution gate (§5.3) and the
capture-quality score (§5.6) were written in this repository and calibrated
against the bundle's own training moments and hand-measured colour patches.
They are engineering safeguards, not validated instruments. They have never
been evaluated against annotated ground truth, because none exists here.

## 9. What would be required before claiming performance

At minimum: a prospective, patient-level, external validation set with paired
same-visit CBC haemoglobin as ground truth; a preregistered analysis plan with
the threshold fixed in advance; ROC AUC, sensitivity and specificity *with
confidence intervals* at the deployed operating point; calibration curves and
Brier/ECE on that external set; and subgroup breakdowns by skin tone, capture
device, lighting condition and anaemia severity. None of that has been done.
Until it is, the correct description of this system's accuracy is "unknown".

## 10. Safety and failure modes

- **False negatives.** A `lower_risk` result does not rule out anaemia. On the
  evidence available (§8) the false-negative rate is unknown. The interface
  must never present `lower_risk` as reassurance that testing is unnecessary.
- **False positives.** The threshold is tuned towards sensitivity and the
  development-set specificity is low, so `higher_risk` will be common and often
  wrong. Its cost is anxiety and unnecessary testing — real harms, and the
  reason the label is "higher risk" rather than "anaemic".
- **`uncertain` results.** Expected and normal. Presented as an inconclusive
  reading, never as a middle severity.
- **Off-target images.** Refused with a reason (§6) rather than scored. No gate
  may be weakened or bypassed to produce a result.
- **Missing weights.** The service returns 503 rather than falling back to
  anything. With `INFERENCE_PROVIDER=mock`, results are synthetic, carry
  `is_synthetic = true`, and must be shown with the DEMO MODE notice.
- **Explanations.** `POST /inference/explain` (optional, Gemini) describes an
  already-computed result. It never sees the image, cannot change any number,
  and is instructed never to diagnose and never to state a haemoglobin value.
  With no API key configured it reports itself unavailable rather than
  inventing text.

## 11. Privacy

The photograph **is uploaded to the server**. It is held in memory for the
duration of one request and never written to disk; only its digest is stored.
Sign-in is required: `POST /inference/predict` verifies a Firebase ID token on
every call, including the `aud` claim. The Firebase uid authorises the request
and is deliberately *not* persisted with the screening record, so scan rows
stay unlinked from identity. No raw image, no name, no contact detail and no
haemoglobin value ever reaches the database or the chain — only hashes, the
risk/recommendation codes and the basis-point integers. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full privacy boundary.

Any statement that this tool runs on-device, uploads nothing, works offline for
scanning, or needs no account is false.

## 12. Version history

| Version | Change |
|---|---|
| `anemiascan-v3.1+roi1+gate1` | Current. The V3.1 calibrated bundle plus the conjunctiva localiser (`roi.py`), the in-distribution and encoder-range gates (`gate.py`), the measured capture-quality score, and a weights-derived model hash replacing the previous `keccak256("ANEMIASCAN_V3_1_CALIBRATED_LOGISTIC_STACKER")` text tag |

Sources for everything above: `backend/app/ml/predictor.py`,
`backend/app/ml/roi.py`, `backend/app/ml/gate.py`, `backend/app/ml/manifest.py`,
`backend/app/ml/model_assets/{runtime_config,thresholds,calibration,inference_contract}.json`,
`backend/app/ml/model_assets/BUNDLE_README.md`, the metadata embedded in the
`.pth` checkpoints, and `contracts/model-manifest.json`.
