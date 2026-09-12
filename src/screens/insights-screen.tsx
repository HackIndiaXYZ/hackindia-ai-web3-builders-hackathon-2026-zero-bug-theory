/* --------------------------------------------------------------------------
 * InsightsScreen — the explainability surface.
 * --------------------------------------------------------------------------
 * WHAT THIS SCREEN USED TO SAY, AND WHY IT WAS WRONG
 * -------------------------------------------------
 * It opened with "Every number on the result screen comes from arithmetic you
 * can follow", described the weights, bands and a 1.15× expansion curve of a
 * local colour heuristic as though that heuristic were the product, and carried
 * a model card whose badges read "Works offline", "On-device only" and "No
 * account, no upload", with a row stating "Execution: Entirely on-device,
 * synchronous arithmetic, no network call".
 *
 * Every one of those was false. The photo is uploaded to a server, the server
 * runs two convolutional encoders and a calibrated stacker on it, and a
 * signed-in account is required. The heuristic that the page described has been
 * deleted outright.
 *
 * What the page says now is the real pipeline, in the order it runs, and a
 * model card fetched live from `GET /inference/model` so the version, the hash
 * and the asset digests on screen are the ones the running service reports
 * rather than a number typed into this file. Where the server cannot be
 * reached, the screen says so instead of substituting a plausible value.
 *
 * The ROI overlay is drawn from the REAL bounding box the localiser returned,
 * in the coordinates of the frame that was submitted. It is still not a
 * saliency map, and the copy says so: the model is handed a masked region, not
 * a per-pixel importance field.
 * -------------------------------------------------------------------------- */

import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'
import {
  ArrowLeft,
  CircleAlert,
  Cpu,
  Crop,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  Focus,
  ImageOff,
  Layers,
  Lock,
  Microscope,
  Scale,
  ScanLine,
  Server,
  ShieldAlert,
  ShieldQuestion,
  Split,
  Sun,
  TriangleAlert,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { MeasureBars, distributionBudgetRow } from '@/src/components/signal-bars'
import { fetchModelInfo, type ModelInfo } from '@/src/lib/api'
import {
  clamp,
  formatDateTime,
  formatFixed,
  formatPercent,
  formatProbability,
  humaniseKey,
  shortHash,
} from '@/src/lib/format'
import { riskClasses, riskColorToken } from '@/src/lib/risk-style'
import type { RiskToken } from '@/src/lib/risk-style'
import type { ScanAnalysis } from '@/src/lib/types'

const TONE_VAR: Record<RiskToken, string> = {
  risk: '--risk',
  moderate: '--moderate',
  safe: '--safe',
}

/* -------------------------------------------------------------------------- */
/* The pipeline, in the order it runs                                         */
/* -------------------------------------------------------------------------- */

const PIPELINE = [
  {
    icon: Lock,
    title: 'Upload, authenticated',
    body: 'The captured frame is sent to the AnemiaScan server with a signed-in account’s ID token. There is no on-device model: without a network connection and a valid sign-in, no scan happens at all. The server holds the image in memory for the length of one request and never writes it to disk.',
  },
  {
    icon: Sun,
    title: 'Capture gate',
    body: 'Brightness, sharpness (Laplacian variance) and the fraction of clipped pixels are measured first. A frame that is extremely dark, extremely bright, severely clipped or out of focus is refused with a named reason instead of being scored.',
  },
  {
    icon: Crosshair,
    title: 'ROI localisation',
    body: 'The conjunctiva is located on redness-over-yellowness — the LAB colour axis haemoglobin actually drives — with the threshold derived from the training set’s own feature moments rather than hand-picked. Pixels must also clear an absolute redness floor and a saturation/value window, which is what separates conjunctiva from sclera, iris, lashes and skin. The region is then masked to black outside its largest connected component, reproducing the masked-segmentation format the network was fitted on.',
  },
  {
    icon: Scale,
    title: 'In-distribution gate',
    body: 'Thirty-two engineered colour, texture and exposure features are computed from the masked region and compared against the mean and standard deviation of the 648 training ROIs. The sum of squared z-scores is a budget with a hard ceiling, and separate checks cover implausible chroma, excessive high-frequency content and encoder outputs drifting outside their fitted range. Anything out of distribution is refused, not scored.',
  },
  {
    icon: Microscope,
    title: 'Feature extraction',
    body: 'Two convolutional encoders read the masked region — EfficientNet-B3 and ConvNeXt-Tiny — producing an embedding and a logit each. Those sit alongside the same 32 engineered colour features, so the model sees both learned representation and explicit colour statistics.',
  },
  {
    icon: Split,
    title: 'Two candidates, scored in parallel',
    body: 'A logistic stacker takes the two encoder logits plus the 32 features. A regularised gated-fusion head instead learns, per image, how much to weight each encoder and the colour features, and its ensemble is averaged. Both are scored on every capture.',
  },
  {
    icon: Cpu,
    title: 'Platt calibration',
    body: 'Each candidate’s raw output is passed through its own Platt calibration — a logistic fit on held-out data — so the number that comes out behaves like a probability rather than an arbitrary score. A raw probability that saturates to the numerical bounds is treated as unreadable and refused, not reported as near-certainty.',
  },
  {
    icon: ShieldQuestion,
    title: 'Threshold, margin, decision',
    body: 'The selected candidate’s calibrated probability is compared against an operating threshold tuned for sensitivity, not against 0.5. Inside an uncertainty margin either side of that threshold — or when the two candidates land on opposite sides of their own thresholds — the result is `uncertain` rather than a guess.',
  },
] as const

const DECISIONS = [
  {
    key: 'lower_risk',
    label: 'Lower risk',
    body: 'The calibrated probability sat below the threshold and outside the uncertainty margin. Not an all-clear — mild anaemia often shows no visible pallor at all.',
  },
  {
    key: 'higher_risk',
    label: 'Higher risk',
    body: 'The calibrated probability sat at or above the threshold and outside the uncertainty margin. A prompt to get a haemoglobin test, not a finding about anyone’s blood.',
  },
  {
    key: 'uncertain',
    label: 'Uncertain',
    body: 'The probability fell inside the uncertainty margin, or the two candidates disagreed. This is a refusal to call it — never a middle band, and never “moderate risk”.',
  },
  {
    key: 'recapture_required',
    label: 'Recapture required',
    body: 'A quality, ROI or in-distribution gate rejected the frame before any probability was produced. The app shows the named reasons and asks for another photograph; it never receives a score to display.',
  },
] as const

/* -------------------------------------------------------------------------- */
/* Model card content                                                         */
/* -------------------------------------------------------------------------- */

const NOT_DOES = [
  'Diagnose anaemia, or rule it out. Only a haemoglobin blood test can do either.',
  'Measure haemoglobin. It returns a probability, never a g/dL value — and it never estimates one.',
  'Identify a cause or a type — iron deficiency, B12, thalassaemia, blood loss and chronic disease all look the same to a camera.',
  'Calibrate for who you are. There is no adjustment for age, pregnancy, altitude, skin tone, medication or chronic illness.',
  'Claim clinical validation or regulatory clearance. It has neither, in any jurisdiction.',
  'Work offline. Inference runs on the server; the browser captures the photo and renders the answer.',
  'Replace monitoring. If a clinician is tracking your haemoglobin, their numbers are the ones that count.',
] as const

const LIMITATIONS = [
  {
    icon: ScanLine,
    title: 'No external validation',
    body: 'The thresholds and the calibration were fitted on this model’s own dataset and its held-out split. Nothing about it has been checked against blood results from an outside cohort, in a prospective study, or under any regulator’s review. Every performance property it has is a property of its own data.',
  },
  {
    icon: Sun,
    title: 'Light is the dominant confounder',
    body: 'White balance decides colour, and colour is what this model reads. Warm bulbs, screen glow and coloured lamps all shift the reading, and direct sun or flash blows out highlights that then read as pallor. The in-distribution gate catches the extreme cases; it cannot catch a modest, consistent tint.',
  },
  {
    icon: Focus,
    title: 'Phone cameras edit before you see the frame',
    body: 'HDR, beauty mode, scene detection and auto-enhance rewrite saturation and local contrast in the pipeline. The model sees the processed result and cannot tell which parts came from the tissue and which from the phone.',
  },
  {
    icon: Crop,
    title: 'One frame, one located region',
    body: 'A single still is scored, and the region is found by a colour rule rather than a learned segmenter. If the lid is not everted enough the rule can latch onto something else that is red — inner lip, irritated skin — and the gates will not always notice.',
  },
  {
    icon: Database,
    title: 'A small training set',
    body: 'The feature statistics the gates rely on come from 648 training ROIs. That is enough to describe what a typical input looks like; it is not enough to represent the range of people, cameras and conditions this app can be pointed at.',
  },
] as const

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

interface InsightsScreenProps {
  analysis: ScanAnalysis
  onBack: () => void
}

export function InsightsScreen({ analysis, onBack }: InsightsScreenProps) {
  const reduceMotion = useReducedMotion() ?? false
  const [overlay, setOverlay] = useState(true)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
  const [modelInfoState, setModelInfoState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  )

  const model = analysis.modelOutput
  const token = riskColorToken(analysis.riskLevel)
  const tone = riskClasses(token)
  const captureQuality = Math.round(clamp(analysis.captureQuality, 0, 100))

  const budgetRow = useMemo(
    () => (analysis.gate ? distributionBudgetRow(analysis.gate) : null),
    [analysis.gate],
  )

  /* The model card is fetched live rather than hardcoded, so the identity on
     screen is whatever the running service reports. A failed fetch is shown as
     a failed fetch — there is no fallback constant to fall back to, because a
     stale hash printed confidently is worse than no hash at all. */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const info = await fetchModelInfo()
      if (cancelled) return
      setModelInfo(info)
      setModelInfoState(info ? 'ready' : 'unavailable')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* The real bounding box the localiser returned, normalised into the submitted
     frame's own coordinates. Drawn only when both the box and the frame size
     are present — a rectangle guessed from nothing is exactly the kind of
     decorative fiction this screen exists to remove. */
  const roiBox = useMemo(() => {
    const roi = analysis.roi
    if (!roi || !roi.bbox || roi.bbox.length !== 4 || roi.sourceSize.length !== 2) return null
    const [sourceW, sourceH] = roi.sourceSize
    if (!(sourceW > 0) || !(sourceH > 0)) return null
    const [x, y, w, h] = roi.bbox
    return {
      left: clamp((x / sourceW) * 100, 0, 100),
      top: clamp((y / sourceH) * 100, 0, 100),
      width: clamp((w / sourceW) * 100, 0, 100),
      height: clamp((h / sourceH) * 100, 0, 100),
      aspect: `${sourceW} / ${sourceH}`,
    }
  }, [analysis.roi])

  const variants: Variants = {
    hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.45, ease: 'easeOut' },
    },
  }

  const glow = `radial-gradient(circle at 50% 52%, color-mix(in oklab, var(${TONE_VAR[token]}) 55%, transparent) 0%, color-mix(in oklab, var(${TONE_VAR[token]}) 22%, transparent) 42%, transparent 72%)`

  /* Live values where the endpoint answered, the values that came back with
     this scan where it did not. Each is labelled for which it is. */
  const liveThreshold = modelInfo?.operatingThreshold ?? null
  const liveMargin = modelInfo?.uncertaintyMargin ?? null
  const targetSensitivity = modelInfo?.targetSensitivity ?? null

  return (
    <div className="flex flex-1 flex-col">
      {/* ---- masthead ---------------------------------------------------- */}
      <header className="relative isolate overflow-hidden border-b border-border/70 bg-card/40">
        <div aria-hidden="true" className="grain pointer-events-none absolute inset-0" />
        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 pt-6 pb-8 lg:px-10">
          <Button
            variant="ghost"
            size="lg"
            onClick={onBack}
            className="h-10 w-fit rounded-full px-3.5 text-muted-foreground"
          >
            <ArrowLeft className="size-4" data-icon="inline-start" aria-hidden="true" />
            Back to result
          </Button>

          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-2xs font-medium tracking-[0.18em] text-primary uppercase">
              <Layers className="size-3.5" aria-hidden="true" />
              Explainability
            </span>
            <h1 className="display text-display-sm text-foreground sm:text-display">
              How this result was actually produced
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
              Every number on your result came back from the AnemiaScan server — nothing medical is
              computed in this browser. Here is what happens to a photograph, in the order it
              happens, the model card as the running service reports it, and a straight account of
              what this model cannot do.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={token}>
              {formatProbability(analysis.screeningProbability)} · {analysis.riskLevel}
            </Badge>
            <Badge variant="outline">Capture quality {captureQuality}/100</Badge>
            <Badge variant="secondary">{formatDateTime(analysis.createdAt)}</Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-12">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
          {/* ---- capture + located region ------------------------------ */}
          <motion.div
            variants={variants}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-6"
          >
            <h2 className="sr-only">The capture and what was measured from it</h2>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crosshair className="size-4 text-primary" aria-hidden="true" />
                  The region the localiser found
                </CardTitle>
                <CardDescription>
                  {roiBox
                    ? 'The rectangle is the bounding box the ROI localiser returned, drawn in the coordinates of the frame that was submitted. The model is handed that region with everything outside the tissue mask blacked out — so this is a bounding box, not a heat map of where a model “looked”.'
                    : 'This scan carries no bounding box, so no region is drawn over the photograph. Nothing is sketched in its place.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {analysis.imageDataUrl ? (
                  <div
                    className="relative w-full overflow-hidden rounded-2xl border border-border bg-muted"
                    style={{ aspectRatio: roiBox?.aspect ?? '1 / 1' }}
                  >
                    <img
                      src={analysis.imageDataUrl}
                      alt="The captured photo of the inside of the lower eyelid that produced this screening result"
                      className="h-full w-full object-cover"
                    />

                    {overlay && roiBox ? (
                      <>
                        {/* everything outside the located region, dimmed */}
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute rounded-lg border border-dashed border-white/70"
                          style={{
                            left: `${roiBox.left}%`,
                            top: `${roiBox.top}%`,
                            width: `${roiBox.width}%`,
                            height: `${roiBox.height}%`,
                            boxShadow: '0 0 0 9999px rgba(6, 10, 18, 0.55)',
                          }}
                        />
                        {/* tone-coded glow over the located tissue */}
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute opacity-70"
                          style={{
                            left: `${roiBox.left}%`,
                            top: `${roiBox.top}%`,
                            width: `${roiBox.width}%`,
                            height: `${roiBox.height}%`,
                            background: glow,
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[0.625rem] font-medium text-white"
                        >
                          Located region · {roiBox.width.toFixed(0)}% × {roiBox.height.toFixed(0)}%
                          of the frame
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/40 px-6 text-center">
                    <ImageOff className="size-7 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">Photo not retained</p>
                    <p className="text-xs leading-relaxed text-balance text-muted-foreground">
                      Only the most recent captures keep their image on this device. The figures
                      below are stored in full — the pixels were dropped to keep local storage
                      small.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    aria-pressed={overlay}
                    onClick={() => setOverlay((value) => !value)}
                    disabled={!analysis.imageDataUrl || !roiBox}
                    className="h-10 rounded-full px-4"
                  >
                    {overlay ? (
                      <EyeOff className="size-4" data-icon="inline-start" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" data-icon="inline-start" aria-hidden="true" />
                    )}
                    {overlay ? 'Hide overlay' : 'Show overlay'}
                  </Button>
                  {analysis.roi ? (
                    <span className="text-2xs text-muted-foreground">
                      {formatPercent(analysis.roi.coverage, 2)} of the frame read as conjunctiva
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {/* ---- what the capture measured --------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Focus className="size-4 text-primary" aria-hidden="true" />
                  Capture quality, measured
                </CardTitle>
                <CardDescription>
                  The server derives one 0–100 figure from these, plus how much conjunctiva it
                  found and how close the frame sat to the training distribution. They describe the
                  photograph — not you, and not the certainty of the result.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {analysis.quality ? (
                  <dl className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-sm font-medium text-foreground">Mean brightness</dt>
                      <dd className="metric text-sm font-semibold text-foreground tabular-nums">
                        {formatFixed(analysis.quality.brightness, 1)}
                        <span className="pl-1 text-2xs font-medium text-muted-foreground">/255</span>
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-sm font-medium text-foreground">
                        Sharpness
                        <span className="pl-1.5 text-2xs font-normal text-muted-foreground">
                          Laplacian variance
                        </span>
                      </dt>
                      <dd className="metric text-sm font-semibold text-foreground tabular-nums">
                        {analysis.quality.blurVariance === null
                          ? '—'
                          : formatFixed(analysis.quality.blurVariance, 1)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-sm font-medium text-foreground">Clipped pixels</dt>
                      <dd className="metric text-sm font-semibold text-foreground tabular-nums">
                        {analysis.quality.clippedFraction === null
                          ? '—'
                          : formatPercent(analysis.quality.clippedFraction, 2)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    This scan carries no capture-quality report.
                  </p>
                )}

                <Separator />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      Composite capture quality
                    </span>
                    <span className="text-2xs leading-relaxed text-muted-foreground">
                      Computed on the server, returned in basis points. It varies from scan to scan
                      — it is not a fixed value.
                    </span>
                  </div>
                  <span className={cn('metric shrink-0 text-xl font-semibold', tone.text)}>
                    {captureQuality}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* ---- the in-distribution gate ---------------------------- */}
            {analysis.gate ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="size-4 text-primary" aria-hidden="true" />
                    How familiar this capture looked
                  </CardTitle>
                  <CardDescription>
                    Before scoring anything, the server checks that the located region resembles the
                    data the model was fitted on. These are that check’s own numbers.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {budgetRow ? <MeasureBars rows={[budgetRow]} /> : null}

                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        RMS z-score
                      </dt>
                      <dd className="metric text-lg font-semibold text-foreground tabular-nums">
                        {formatFixed(analysis.gate.rmsZ, 3)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Largest single z-score
                      </dt>
                      <dd className="metric text-lg font-semibold text-foreground tabular-nums">
                        {formatFixed(analysis.gate.maxAbsZ, 3)}
                      </dd>
                    </div>
                  </dl>

                  {analysis.gate.worstFeatures.length ? (
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-semibold text-foreground">
                        Features furthest from the training mean
                      </h4>
                      <ul className="flex list-none flex-col gap-1.5">
                        {analysis.gate.worstFeatures.slice(0, 5).map((item) => (
                          <li
                            key={item.feature}
                            className="flex items-baseline justify-between gap-3 text-xs"
                          >
                            <span className="font-mono text-muted-foreground">{item.feature}</span>
                            <span className="metric font-semibold text-foreground tabular-nums">
                              {item.z > 0 ? '+' : ''}
                              {formatFixed(item.z, 2)} σ
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-2xs leading-relaxed text-muted-foreground">
                        A large z-score here means the photograph was unusual for this model, not
                        that anything is unusual about you.
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </motion.div>

          {/* ---- pipeline, decisions and model card -------------------- */}
          <div className="flex flex-col gap-6">
            <h2 className="sr-only">The pipeline, the decisions and the model card</h2>

            <motion.div variants={variants} initial="hidden" animate="show">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="size-4 text-primary" aria-hidden="true" />
                    What happens to a photograph
                  </CardTitle>
                  <CardDescription>
                    Eight stages, in order, all of them server-side. Any one of the first four can
                    stop the scan and ask for a new photograph instead of returning a result.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="flex list-none flex-col gap-4">
                    {PIPELINE.map((step, index) => (
                      <li key={step.title} className="flex gap-3">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground"
                        >
                          <step.icon className="size-3.5" />
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-xs font-semibold text-foreground">
                            <span className="text-muted-foreground tabular-nums">
                              {index + 1}.{' '}
                            </span>
                            {step.title}
                          </span>
                          <span className="text-xs leading-relaxed text-pretty text-muted-foreground">
                            {step.body}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </motion.div>

            {/* ---- the four outcomes ---------------------------------- */}
            <motion.div variants={variants} initial="hidden" animate="show">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Split className="size-4 text-primary" aria-hidden="true" />
                    The four possible outcomes
                  </CardTitle>
                  <CardDescription>
                    The decision is a comparison against a threshold that is tuned for sensitivity —
                    {liveThreshold !== null
                      ? ` ${formatProbability(liveThreshold)} in the running service`
                      : ` ${formatProbability(model.operatingThreshold)} for this scan`}
                    , nowhere near 0.5 — with a margin of ±
                    {formatProbability(liveMargin ?? model.uncertaintyMargin)} either side of it
                    inside which the model declines to answer.
                    {targetSensitivity !== null
                      ? ` The service reports that threshold was chosen for a target sensitivity of ${formatPercent(
                          targetSensitivity,
                          0,
                        )} on its own evaluation data.`
                      : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="flex list-none flex-col gap-3">
                    {DECISIONS.map((item) => {
                      const current = item.key === model.decision
                      return (
                        <li
                          key={item.key}
                          className={cn(
                            'flex flex-col gap-1 rounded-2xl border px-3.5 py-3',
                            current ? cn(tone.border, tone.bg) : 'border-border bg-card/50',
                          )}
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'text-sm font-semibold',
                                current ? tone.text : 'text-foreground',
                              )}
                            >
                              {item.label}
                            </span>
                            <code className="font-mono text-[0.625rem] text-muted-foreground">
                              {item.key}
                            </code>
                            {current ? <Badge variant={token}>this scan</Badge> : null}
                          </span>
                          <span className="text-xs leading-relaxed text-pretty text-muted-foreground">
                            {item.body}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>

            {/* ---- model card ----------------------------------------- */}
            <motion.section
              variants={variants}
              initial="hidden"
              animate="show"
              aria-labelledby="model-card-heading"
            >
              <Card>
                <CardHeader>
                  <CardTitle id="model-card-heading" className="flex items-center gap-2">
                    <Cpu className="size-4 text-primary" aria-hidden="true" />
                    Model card
                  </CardTitle>
                  <CardDescription>
                    Read live from the running service, so the version and hashes below are the ones
                    that would score your next capture — not values typed into this page. The model
                    hash is a keccak of the weights manifest: hash every file the runtime loads,
                    then hash the sorted list. Change one byte of one checkpoint and it changes.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  {modelInfoState === 'loading' ? (
                    <p className="text-sm text-muted-foreground">Asking the service…</p>
                  ) : null}

                  {modelInfoState === 'unavailable' ? (
                    <div className="flex gap-2.5 rounded-2xl border border-moderate/30 bg-moderate/5 px-3.5 py-3">
                      <CircleAlert
                        className="mt-0.5 size-4 shrink-0 text-moderate"
                        aria-hidden="true"
                      />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        The model endpoint could not be reached, so the live card is unavailable.
                        The values shown are the ones returned with this scan when it was run, and
                        nothing has been substituted for the rest.
                      </p>
                    </div>
                  ) : null}

                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Version
                      </dt>
                      <dd className="text-sm leading-snug text-pretty text-foreground">
                        {modelInfo?.modelVersion ?? model.modelVersion ?? '—'}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Architecture
                      </dt>
                      <dd className="text-sm leading-snug text-pretty text-foreground">
                        EfficientNet-B3 + ConvNeXt-Tiny encoders, 32 engineered colour features, a
                        logistic stacker and a gated fusion head
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Selected candidate
                      </dt>
                      <dd className="text-sm leading-snug text-pretty text-foreground">
                        {humaniseKey(modelInfo?.selectedCandidate ?? model.selectedModel ?? '')}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Calibration
                      </dt>
                      <dd className="text-sm leading-snug text-pretty text-foreground">
                        Platt scaling, fitted per candidate
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Operating threshold
                      </dt>
                      <dd className="metric text-sm leading-snug text-foreground tabular-nums">
                        {formatProbability(liveThreshold ?? model.operatingThreshold)} · margin ±
                        {formatProbability(liveMargin ?? model.uncertaintyMargin)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Execution
                      </dt>
                      <dd className="text-sm leading-snug text-pretty text-foreground">
                        Server-side, over an authenticated request. The image is held in memory for
                        one request and never written to disk.
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5 sm:col-span-2">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Model hash
                      </dt>
                      <dd className="font-mono text-[0.6875rem] leading-relaxed break-all text-foreground">
                        {modelInfo?.modelHash || analysis.modelHash || '—'}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      <Server className="size-3" aria-hidden="true" />
                      Server-side inference
                    </Badge>
                    <Badge variant="outline">
                      <Lock className="size-3" aria-hidden="true" />
                      Sign-in required
                    </Badge>
                    <Badge variant="outline">Photo uploaded, held in memory only</Badge>
                    {modelInfo?.provider === 'mock' ? (
                      <Badge variant="moderate">Demo provider — synthetic results</Badge>
                    ) : null}
                  </div>

                  {modelInfo?.notice ? (
                    <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
                      {modelInfo.notice}
                    </p>
                  ) : null}

                  {modelInfo?.assets?.length ? (
                    <>
                      <Separator />
                      <div className="flex flex-col gap-2">
                        <h4 className="text-sm font-semibold text-foreground">
                          The files that make up that hash
                        </h4>
                        <ul className="flex list-none flex-col gap-2">
                          {modelInfo.assets.map((asset) => (
                            <li key={asset.path} className="flex flex-col gap-0.5">
                              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <span className="font-mono text-xs text-foreground">
                                  {asset.path}
                                </span>
                                <span className="text-2xs text-muted-foreground tabular-nums">
                                  {formatBytes(asset.bytes)}
                                </span>
                              </span>
                              <span
                                title={asset.sha256}
                                className="font-mono text-[0.625rem] text-muted-foreground"
                              >
                                sha256 {shortHash(asset.sha256, 12, 10)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  ) : null}

                  <Separator />

                  <div className="flex flex-col gap-3">
                    <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ShieldAlert className="size-4 text-risk" aria-hidden="true" />
                      What it does not do
                    </h3>
                    <ul className="flex list-none flex-col gap-2">
                      {NOT_DOES.map((item) => (
                        <li
                          key={item}
                          className="flex gap-2 text-xs leading-relaxed text-pretty text-muted-foreground"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-[0.42rem] size-1.5 shrink-0 rounded-full bg-risk/70"
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Separator />

                  <div className="flex flex-col gap-3">
                    <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <TriangleAlert className="size-4 text-moderate" aria-hidden="true" />
                      Known limitations
                    </h3>
                    <ul className="flex list-none flex-col gap-3">
                      {LIMITATIONS.map((item) => (
                        <li key={item.title} className="flex gap-3">
                          <span
                            aria-hidden="true"
                            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground"
                          >
                            <item.icon className="size-3.5" />
                          </span>
                          <span className="flex flex-col gap-0.5">
                            <span className="text-xs font-semibold text-foreground">
                              {item.title}
                            </span>
                            <span className="text-xs leading-relaxed text-pretty text-muted-foreground">
                              {item.body}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </motion.section>
          </div>
        </div>

        <motion.p
          variants={variants}
          initial="hidden"
          animate="show"
          className="text-xs leading-relaxed text-pretty text-muted-foreground"
        >
          AnemiaScan is a screening aid, not a diagnostic device, and it is not a substitute for
          professional medical advice. If anything here worries you — or if you feel unwell
          regardless of the result — ask a clinician for a haemoglobin blood test.
        </motion.p>

        <div className="flex">
          <Button
            variant="outline"
            size="lg"
            onClick={onBack}
            className="h-11 w-full rounded-full sm:w-fit sm:px-6"
          >
            <ArrowLeft className="size-4" data-icon="inline-start" aria-hidden="true" />
            Back to result
          </Button>
        </div>
      </div>
    </div>
  )
}
