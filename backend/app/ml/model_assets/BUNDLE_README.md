# AnemiaScan V3.1 calibrated bundle

Selected validation-locked candidate: **logistic_stacker**

This bundle contains both V3.1 candidates, the exact base checkpoints,
train-only scalers, calibration parameters, validation-selected thresholds,
and the inference contract.

> **Correction to the vendor text.** The original line also claimed
> "predictions, metrics". Neither is present as a file: `inference_contract.json`
> is the only one of the three that exists in this directory. There is no
> prediction dump and no metrics file, so nothing written below can be checked
> from the JSON in this bundle. (Some numbers *are* embedded inside the `.pth`
> checkpoints; what they are and why they do not establish performance is set
> out in `../../../../MODEL_CARD.md`, which is the authoritative provenance and
> limitations record for this bundle.)

Input must be a segmented palpebral/conjunctiva ROI. A separate ROI
localization stage is required for arbitrary smartphone eye photographs.
Outputs are screening categories, not diagnoses.

Current test metrics are an internal development benchmark because that split
has already been examined during earlier iterations. Independent patient-level
external validation is required.
