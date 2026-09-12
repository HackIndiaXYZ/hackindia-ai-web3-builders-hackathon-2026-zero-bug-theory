/* --------------------------------------------------------------------------
 * InsightsScreen — the explainability surface.
 * --------------------------------------------------------------------------
 * The promise of this screen is that nothing about the score stays hidden: the
 * exact region that was sampled, all five readings with their weights and
 * polarity, the capture-quality figures that set confidence, and a model card
 * that states plainly what the heuristic is and what it categorically is not.
 *
 * A deliberate honesty constraint: the overlay is presented as the SAMPLING
 * WINDOW, not as a saliency or attention heat map. The analyser is a
 * deterministic colour statistic over a fixed region — it produces no
 * pixel-level importance map — so claiming one would be a pretty lie.
 * -------------------------------------------------------------------------- */

import { useMemo, useState } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'
import {
  ArrowLeft,
  Cpu,
  Crop,
  Eye,
  EyeOff,
  Focus,
  ImageOff,
  Layers,
  ScanLine,
  ShieldAlert,
  Sun,
  TriangleAlert,
  WifiOff,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { SignalBars, rankSignals } from '@/src/components/signal-bars'
import { clamp, formatDateTime } from '@/src/lib/format'
import { riskClasses, riskColorToken } from '@/src/lib/risk-style'
import type { RiskToken } from '@/src/lib/risk-style'
import type { ScanAnalysis } from '@/src/lib/types'

/* -------------------------------------------------------------------------- */
/* Sampling window                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The analyser's region of interest, in normalised frame coordinates. Mirrors
 * the constant inside `analyze.ts` so the overlay shows the real sampled window
 * rather than a decorative rectangle.
 */
const ROI = { x: 0.18, y: 0.26, w: 0.64, h: 0.48 } as const

const TONE_VAR: Record<RiskToken, string> = {
  risk: '--risk',
  moderate: '--moderate',
  safe: '--safe',
}

/* -------------------------------------------------------------------------- */
/* Weight mix                                                                 */
/* -------------------------------------------------------------------------- */

const MIX_COLORS = [
  'bg-chart-1',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
  'bg-chart-2',
] as const

const MIX_DOTS = MIX_COLORS

/* -------------------------------------------------------------------------- */
/* Model card content                                                         */
/* -------------------------------------------------------------------------- */

const NOT_DOES = [
  'Diagnose anaemia, or rule it out. Only a haemoglobin blood test can do either.',
  'Measure haemoglobin. The g/dL interval on the result screen is an illustration of the band, mapped from a colour score.',
  'Identify a cause or a type — iron deficiency, B12, thalassaemia, blood loss and chronic disease all look the same to a camera.',
  'Calibrate for who you are. There is no adjustment for age, pregnancy, altitude, skin tone, medication or chronic illness.',
  'Claim clinical validation or regulatory clearance. It has neither, in any jurisdiction.',
  'Replace monitoring. If a clinician is tracking your haemoglobin, their numbers are the ones that count.',
] as const

const LIMITATIONS = [
  {
    icon: Sun,
    title: 'Light is the dominant confounder',
    body: 'White balance decides colour. Warm bulbs, screen glow and coloured lamps all shift the reading, and direct sun or flash blows out highlights that then read as pallor. Every reading is measured relative to the frame’s own exposure to blunt this, but relative is not immune.',
  },
  {
    icon: Focus,
    title: 'Phone cameras edit before you see the frame',
    body: 'HDR, beauty mode, scene detection and auto-enhance rewrite saturation and local contrast in the pipeline. The analyser sees the processed result and cannot tell which parts came from the tissue and which from the algorithm.',
  },
  {
    icon: Crop,
    title: 'One frame, one fixed window',
    body: 'A single still is sampled across a fixed central band. If the lid is not everted enough, or the frame is off-centre, the window includes skin, lashes or sclera — the framing figure catches most of that, not all of it.',
  },
  {
    icon: ScanLine,
    title: 'No ground truth anywhere in the loop',
    body: 'Thresholds and weights were chosen to behave sensibly and produce a usable spread, not fitted to measured haemoglobin from a cohort. Nothing in this app has ever been compared against a blood result.',
  },
] as const

/* -------------------------------------------------------------------------- */
/* Quality copy                                                               */
/* -------------------------------------------------------------------------- */

function qualityVerdict(value: number): { word: string; tone: 'primary' | 'moderate' | 'risk' } {
  if (value >= 70) return { word: 'Good', tone: 'primary' }
  if (value >= 45) return { word: 'Usable', tone: 'moderate' }
  return { word: 'Weak', tone: 'risk' }
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

  const token = riskColorToken(analysis.riskLevel)
  const tone = riskClasses(token)
  const ranked = useMemo(() => rankSignals(analysis.signals), [analysis.signals])

  const mix = useMemo(
    () =>
      ranked.map((item, index) => ({
        key: item.signal.key,
        label: item.signal.label,
        weight: Math.round(clamp(item.signal.weight, 0, 1) * 100),
        color: MIX_COLORS[index % MIX_COLORS.length],
        dot: MIX_DOTS[index % MIX_DOTS.length],
      })),
    [ranked],
  )

  const qualityRows = [
    {
      key: 'light',
      icon: Sun,
      label: 'Light',
      value: analysis.quality.light,
      body: 'Exposure quality, penalising both crushed shadows and blown highlights.',
    },
    {
      key: 'focus',
      icon: Focus,
      label: 'Focus',
      value: analysis.quality.focus,
      body: 'Sharpness of the centre patch, faded out in near-black frames where the only detail is sensor noise.',
    },
    {
      key: 'framing',
      icon: Crop,
      label: 'Framing',
      value: analysis.quality.framing,
      body: 'How much of the sampled window looks like conjunctival tissue, plus how evenly the frame is lit.',
    },
  ] as const

  const variants: Variants = {
    hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.45, ease: 'easeOut' },
    },
  }

  const glow = `radial-gradient(circle at 50% 52%, color-mix(in oklab, var(${TONE_VAR[token]}) 55%, transparent) 0%, color-mix(in oklab, var(${TONE_VAR[token]}) 22%, transparent) 42%, transparent 72%)`

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
              Exactly how this score was produced
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
              Every number on the result screen comes from arithmetic you can follow. Here is the
              region that was sampled, the five readings and their weights, the capture quality that
              set the confidence figure, and a straight account of what this heuristic cannot do.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={token}>
              {analysis.riskScore}/100 · {analysis.riskLevel}
            </Badge>
            <Badge variant="outline">Confidence {analysis.confidence}/100</Badge>
            <Badge variant="secondary">{formatDateTime(analysis.createdAt)}</Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-12">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
          {/* ---- capture + sampling window ----------------------------- */}
          <motion.div variants={variants} initial="hidden" animate="show" className="flex flex-col gap-6">
            <h2 className="sr-only">The capture and its quality</h2>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crop className="size-4 text-primary" aria-hidden="true" />
                  The sampled frame
                </CardTitle>
                <CardDescription>
                  The shaded rectangle is the window the analyser reads — the middle 64% of the
                  frame horizontally and 48% vertically. It is a fixed sampling region, not a heat
                  map of where a model “looked”.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {analysis.imageDataUrl ? (
                  <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border bg-muted">
                    <img
                      src={analysis.imageDataUrl}
                      alt="The captured photo of the inside of the lower eyelid that produced this screening score"
                      className="h-full w-full object-cover"
                    />

                    {overlay ? (
                      <>
                        {/* everything outside the sampling window, dimmed */}
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute rounded-lg border border-dashed border-white/70"
                          style={{
                            left: `${ROI.x * 100}%`,
                            top: `${ROI.y * 100}%`,
                            width: `${ROI.w * 100}%`,
                            height: `${ROI.h * 100}%`,
                            boxShadow: '0 0 0 9999px rgba(6, 10, 18, 0.55)',
                          }}
                        />
                        {/* tone-coded glow over the sampled tissue */}
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute opacity-70"
                          style={{
                            left: `${ROI.x * 100}%`,
                            top: `${ROI.y * 100}%`,
                            width: `${ROI.w * 100}%`,
                            height: `${ROI.h * 100}%`,
                            background: glow,
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[0.625rem] font-medium text-white"
                        >
                          Sampling window · {Math.round(ROI.w * 100)}% × {Math.round(ROI.h * 100)}%
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/40 px-6 text-center">
                    <ImageOff className="size-7 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">Photo not retained</p>
                    <p className="text-xs leading-relaxed text-balance text-muted-foreground">
                      Only the most recent captures keep their image on this device. The readings
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
                    disabled={!analysis.imageDataUrl}
                    className="h-10 rounded-full px-4"
                  >
                    {overlay ? (
                      <EyeOff className="size-4" data-icon="inline-start" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" data-icon="inline-start" aria-hidden="true" />
                    )}
                    {overlay ? 'Hide overlay' : 'Show overlay'}
                  </Button>
                  <span className="text-2xs text-muted-foreground">
                    Mean frame brightness {Math.round(analysis.brightness)}/255
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* ---- capture quality ------------------------------------- */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Focus className="size-4 text-primary" aria-hidden="true" />
                  Capture quality
                </CardTitle>
                <CardDescription>
                  These three figures decide the confidence number. They describe the photograph —
                  not you.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {qualityRows.map((row) => {
                  const verdict = qualityVerdict(row.value)
                  return (
                    <div key={row.key} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <row.icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          {row.label}
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <span className="text-2xs text-muted-foreground">{verdict.word}</span>
                          <span className="metric text-sm font-semibold text-foreground">
                            {row.value}
                          </span>
                        </span>
                      </div>
                      <Progress
                        value={row.value}
                        tone={verdict.tone}
                        label={`${row.label} quality`}
                        className="h-1.5"
                      />
                      <p className="text-2xs leading-relaxed text-muted-foreground">{row.body}</p>
                    </div>
                  )
                })}

                <Separator />

                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">Confidence</span>
                    <span className="text-2xs text-muted-foreground">
                      34% light, 30% focus, 22% framing, 14% texture — minus a penalty for clipped
                      pixels.
                    </span>
                  </div>
                  <span className={cn('metric shrink-0 text-xl font-semibold', tone.text)}>
                    {analysis.confidence}
                  </span>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ---- signals + model card ---------------------------------- */}
          <div className="flex flex-col gap-6">
            <h2 className="sr-only">Signals, weighting and the model card</h2>
            <motion.div variants={variants} initial="hidden" animate="show">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ScanLine className="size-4 text-primary" aria-hidden="true" />
                    All five signals
                  </CardTitle>
                  <CardDescription>
                    Ranked by how much each reading pushed the score. Polarity is not shared: a high
                    pallor reading is the concerning direction, while a high reading on the other
                    four is the reassuring one.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SignalBars signals={analysis.signals} />
                </CardContent>
              </Card>
            </motion.div>

            {/* ---- how they combine ------------------------------------ */}
            <motion.div variants={variants} initial="hidden" animate="show">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="size-4 text-primary" aria-hidden="true" />
                    How the five combine
                  </CardTitle>
                  <CardDescription>
                    Fixed weights, summing to 100%. The weighted mean is then expanded 1.15× around
                    the midpoint — a presentation curve that spreads the bands apart, adding no new
                    information — and clamped to 3–97.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div
                    aria-hidden="true"
                    className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                  >
                    {mix.map((item) => (
                      <span
                        key={item.key}
                        className={cn('h-full', item.color)}
                        style={{ width: `${item.weight}%` }}
                      />
                    ))}
                  </div>
                  <ul className="flex list-none flex-wrap gap-x-4 gap-y-2">
                    {mix.map((item) => (
                      <li key={item.key} className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={cn('size-2 rounded-full', item.dot)}
                        />
                        <span className="text-2xs text-muted-foreground">
                          {item.label}{' '}
                          <span className="font-semibold text-foreground tabular-nums">
                            {item.weight}%
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-2xs leading-relaxed text-muted-foreground">
                    Bands: 0–34 Low Risk, 35–64 Moderate Risk, 65–100 Elevated Risk. A frame whose
                    mean brightness falls below 55/255 is refused outright rather than scored.
                  </p>
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
                    The whole specification, in the open. There are no hidden model weights here
                    because there is no model — it is a transparent, deterministic image statistic.
                    This is a supplementary local estimate, shown for insight only — the risk band
                    on your result came from AnemiaScan's real server-side AI model, not this
                    heuristic.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {[
                      ['Version', 'AnemiaScan Screen v1.0'],
                      ['Type', 'Deterministic colour & texture heuristic'],
                      ['Inputs', 'One still frame from the device camera'],
                      ['Sampling', 'Up to a 96 × 96 point grid, plus a 72 px centre patch for sharpness'],
                      ['Region', 'Central band: 64% of width, 48% of height'],
                      ['Outputs', 'Score 0–100, band, confidence, five signals, illustrative Hb interval'],
                      ['Determinism', 'Identical input always gives an identical score — no random term'],
                      ['Execution', 'Entirely on-device, synchronous arithmetic, no network call'],
                    ].map(([term, value]) => (
                      <div key={term} className="flex flex-col gap-0.5">
                        <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                          {term}
                        </dt>
                        <dd className="text-sm leading-snug text-foreground text-pretty">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="safe">
                      <WifiOff className="size-3" aria-hidden="true" />
                      Works offline
                    </Badge>
                    <Badge variant="safe">
                      <Cpu className="size-3" aria-hidden="true" />
                      On-device only
                    </Badge>
                    <Badge variant="outline">No account, no upload</Badge>
                  </div>

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
          regardless of the score — ask a clinician for a haemoglobin blood test.
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
