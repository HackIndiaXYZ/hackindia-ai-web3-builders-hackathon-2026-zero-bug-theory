/* --------------------------------------------------------------------------
 * ResultScreen — what the user sees the second a scan lands.
 * --------------------------------------------------------------------------
 * Everything on this screen is built around one rule: a screening result is not
 * a diagnosis, and the interface must never let that distinction blur.
 *
 * WHAT THIS SCREEN USED TO DO, AND WHY IT HAD TO CHANGE
 * ----------------------------------------------------
 * It showed a "screening score X/100", a "confidence" figure that was hardcoded
 * to 100 for every server-scored scan, five colour "signals" from a local
 * heuristic, and an "illustrative haemoglobin interval" in g/dL. The heuristic
 * has been deleted, and the haemoglobin interval went with it: this tool cannot
 * measure haemoglobin, so it must not print a g/dL range anywhere.
 *
 * What replaces them is what the model actually produced:
 *   - the CALIBRATED SCREENING PROBABILITY (0..1) as the headline, labelled as
 *     a probability rather than a score or a confidence,
 *   - the OPERATING THRESHOLD it was compared against, in context, because a
 *     threshold of ≈0.2076 is the only reason a probability of 0.25 reads as
 *     higher risk — it is tuned for sensitivity, not a 50% coin flip,
 *   - `uncertain` as a first-class outcome with its own voice, never collapsed
 *     into a middle "moderate" band,
 *   - both candidate probabilities and the disagreement / near-threshold flags,
 *   - the fusion gate weights,
 *   - the MEASURED capture quality, which genuinely varies scan to scan,
 *   - what the ROI localiser found, and
 *   - the provenance the backend has always returned and this screen has never
 *     rendered: the commitment, the scan-id hash, the model hash and version,
 *     and the on-chain anchor.
 *
 * The optional Gemini explanation is fetched after paint and the whole section
 * stays hidden when the server says it is unavailable. No explanation text is
 * ever generated here.
 *
 * Layout: single column at 390px, two columns from `lg`. Every animation is
 * gated on `prefers-reduced-motion`.
 * -------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Copy,
  Crosshair,
  ExternalLink,
  GitCompareArrows,
  Hash,
  History,
  Info,
  Layers,
  Link2,
  RotateCcw,
  Scale,
  Send,
  Share2,
  ShieldAlert,
  ShieldQuestion,
  Sparkles,
  Stethoscope,
  Sun,
  TriangleAlert,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Stat } from '@/components/ui/stat'
import { Disclosure } from '@/src/components/disclosure'
import { RiskGauge } from '@/src/components/risk-gauge'
import {
  MeasureBars,
  candidateRows,
  distributionBudgetRow,
  fusionGateRows,
} from '@/src/components/signal-bars'
import { fetchExplanation, type Explanation } from '@/src/lib/api'
import { auth } from '@/src/lib/firebase'
import {
  clamp,
  formatDateTime,
  formatFixed,
  formatPercent,
  formatProbability,
  formatRelativeTime,
  humaniseKey,
} from '@/src/lib/format'
import {
  riskAdvice,
  riskClasses,
  riskColorToken,
  riskExplanation,
  riskHeadline,
} from '@/src/lib/risk-style'
import type { ScanAnalysis } from '@/src/lib/types'

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Below this measured capture quality the screen leads with a "treat this as
 * provisional" card.
 *
 * This is a PRESENTATION cutoff and nothing more. The server has its own
 * accept/refuse gates — quality, ROI and in-distribution — and a capture that
 * failed any of them never reaches this screen at all. Nothing here weakens or
 * second-guesses those.
 */
const LOW_QUALITY = 55

const CONFOUNDERS = [
  {
    title: 'Light colour',
    body: 'Warm bulbs, screen light and coloured lamps shift white balance, and a shifted white balance shifts every colour feature the model reads. Bright, indirect daylight is the condition the training images most resemble.',
  },
  {
    title: 'Camera processing',
    body: 'Beauty mode, HDR and auto-enhance rewrite saturation and contrast before the app ever sees the frame. A plain, unfiltered capture is worth far more than a flattering one.',
  },
  {
    title: 'The eye itself',
    body: 'Recent rubbing, crying, allergy or irritation all raise redness independently of haemoglobin — which can make a pale conjunctiva look healthier than it is.',
  },
  {
    title: 'Who you are',
    body: 'The model has no calibration for age, pregnancy, altitude, skin tone or chronic illness, and it has never been validated against blood results outside its own training data. Two people with identical haemoglobin can score differently, and that is a limitation, not a feature.',
  },
] as const

/* -------------------------------------------------------------------------- */
/* Plain-text summary (share / copy)                                          */
/* -------------------------------------------------------------------------- */

function buildSummary(analysis: ScanAnalysis): string {
  const model = analysis.modelOutput
  const lines: string[] = [
    'AnemiaScan — screening summary',
    formatDateTime(analysis.createdAt),
    '',
    `Decision: ${analysis.riskLevel}`,
    `Calibrated screening probability: ${formatProbability(analysis.screeningProbability)} (${formatPercent(
      analysis.screeningProbability,
    )})`,
    `Operating threshold: ${formatProbability(model.operatingThreshold)} — tuned for sensitivity, not a 50% midpoint`,
    `Uncertainty margin: ±${formatProbability(model.uncertaintyMargin)}`,
    `Measured capture quality: ${Math.round(analysis.captureQuality)}/100`,
  ]

  const candidates = Object.entries(model.candidateProbabilities ?? {})
  if (candidates.length) {
    lines.push('', 'Candidate models:')
    candidates.forEach(([key, probability]) => {
      const threshold = model.candidateThresholds?.[key]
      const selected = key === model.selectedModel ? ' [selected]' : ''
      lines.push(
        `  ${key}: ${formatProbability(Number(probability))}${
          Number.isFinite(Number(threshold))
            ? ` (its threshold ${formatProbability(Number(threshold))})`
            : ''
        }${selected}`,
      )
    })
    lines.push(
      `  Candidates disagreed: ${model.modelDisagreement ? 'yes' : 'no'}`,
      `  Inside the uncertainty margin: ${model.nearThreshold ? 'yes' : 'no'}`,
    )
  }

  const gates = Object.entries(model.fusionGateWeights ?? {})
  if (gates.length) {
    lines.push(
      '',
      `Fusion gate weights: ${gates
        .map(([key, weight]) => `${key} ${formatPercent(Number(weight))}`)
        .join(', ')}`,
    )
  }

  if (analysis.roi) {
    lines.push(
      '',
      `Conjunctiva located automatically: ${analysis.roi.located ? 'yes' : 'no'}`,
      `Fraction of the frame identified as conjunctiva: ${formatPercent(analysis.roi.coverage, 2)}`,
    )
  }

  lines.push(
    '',
    'Provenance:',
    `  model: ${model.modelVersion || '—'} (selected candidate ${model.selectedModel || '—'})`,
    `  model hash: ${analysis.modelHash ?? '—'}`,
    `  commitment: ${analysis.commitment ?? '—'}`,
    `  scan id hash: ${analysis.scanIdHash ?? '—'}`,
    `  on-chain: ${
      analysis.registeredOnChain
        ? `registered${analysis.chainTxStatus ? ` (${analysis.chainTxStatus})` : ''}${
            analysis.chainTxHash ? ` tx ${analysis.chainTxHash}` : ''
          }`
        : 'not registered'
    }`,
  )

  if (analysis.isSynthetic) {
    lines.push('', `DEMO RESULT — ${analysis.demoNotice || 'synthetic output, not a real model run.'}`)
  }

  lines.push(
    '',
    'What this is: a research screening model that scores a photo of the inner lower eyelid and returns a calibrated probability.',
    'What this is not: a diagnosis, a haemoglobin measurement, or a substitute for a blood test.',
    'The model has no external clinical validation and no regulatory clearance. Only a haemoglobin (CBC) blood test can establish anaemia. Please discuss any concern with a clinician.',
    'The photo was uploaded to the AnemiaScan server for analysis; a signed-in account is required to run a scan.',
  )

  return lines.join('\n')
}

/** A machine-readable stamp for <time>, or nothing when the date is unusable. */
function isoStamp(epochMs: number): string | undefined {
  const date = new Date(epochMs)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

type ShareState = 'idle' | 'shared' | 'copied' | 'manual'

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError'
}

/**
 * The current Firebase ID token, or null.
 *
 * The explainer endpoint is authenticated like every other inference route, so
 * the token is read here rather than threaded down as a prop — App.tsx already
 * owns the auth listener and this screen only ever needs a fresh token at the
 * moment it asks.
 */
async function currentIdToken(): Promise<string | null> {
  const user = auth?.currentUser
  if (!user) return null
  try {
    return await user.getIdToken()
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* Provenance row                                                             */
/* -------------------------------------------------------------------------- */

function ProvenanceRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="flex flex-col gap-0.5">
        <code className="font-mono text-[0.6875rem] leading-relaxed break-all text-foreground">
          {value}
        </code>
        {note ? <span className="text-2xs leading-relaxed text-muted-foreground">{note}</span> : null}
      </dd>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                    */
/* -------------------------------------------------------------------------- */

interface ResultScreenProps {
  analysis: ScanAnalysis
  onViewInsights: () => void
  onScanAgain: () => void
  onViewHistory: () => void
  onViewBlockchain: () => void
  /** Routes this screening to the in-app doctor review queue (prototype). */
  onSendToDoctor: (patientLabel: string) => void
}

export function ResultScreen({
  analysis,
  onViewInsights,
  onScanAgain,
  onViewHistory,
  onViewBlockchain,
  onSendToDoctor,
}: ResultScreenProps) {
  const reduceMotion = useReducedMotion() ?? false
  const model = analysis.modelOutput
  const token = riskColorToken(analysis.riskLevel)
  const tone = riskClasses(token)
  const advice = riskAdvice(analysis.riskLevel)

  const probability = clamp(analysis.screeningProbability, 0, 1)
  const threshold = clamp(model.operatingThreshold, 0, 1)
  const margin = clamp(model.uncertaintyMargin, 0, 1)
  const distance = probability - threshold
  const captureQuality = Math.round(clamp(analysis.captureQuality, 0, 100))
  const lowQuality = captureQuality < LOW_QUALITY
  const isUncertain = model.decision === 'uncertain'

  const summary = useMemo(() => buildSummary(analysis), [analysis])
  const candidates = useMemo(() => candidateRows(model), [model])
  const gateWeights = useMemo(() => fusionGateRows(model), [model])
  const budgetRow = useMemo(
    () => (analysis.gate ? distributionBudgetRow(analysis.gate) : null),
    [analysis.gate],
  )

  const [shareState, setShareState] = useState<ShareState>('idle')
  const manualRef = useRef<HTMLTextAreaElement | null>(null)
  const [patientLabel, setPatientLabel] = useState('')
  const [sentToDoctor, setSentToDoctor] = useState(false)
  const [explanation, setExplanation] = useState<Explanation | null>(null)

  /* The optional Gemini explainer. It describes an already-computed result and
     can never change one, so it is fetched after paint and the whole section is
     omitted when the server says it is unavailable. Nothing is written locally
     to fill the gap. */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const idToken = await currentIdToken()
      const result = await fetchExplanation({
        model,
        qualityBps: analysis.qualityBps ?? Math.round(clamp(analysis.captureQuality, 0, 100) * 100),
        roi: analysis.roi ?? null,
        idToken,
      })
      if (!cancelled) setExplanation(result)
    })()
    return () => {
      cancelled = true
    }
  }, [model, analysis.qualityBps, analysis.captureQuality, analysis.roi])

  // transient confirmation; the manual fallback stays until dismissed
  useEffect(() => {
    if (shareState !== 'shared' && shareState !== 'copied') return
    const timer = window.setTimeout(() => setShareState('idle'), 2800)
    return () => window.clearTimeout(timer)
  }, [shareState])

  useEffect(() => {
    if (shareState !== 'manual') return
    const node = manualRef.current
    if (!node) return
    node.focus()
    node.select()
  }, [shareState])

  const handleShare = useCallback(async () => {
    // 1. the native share sheet, when the platform has one
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'AnemiaScan screening summary', text: summary })
        setShareState('shared')
        return
      } catch (error) {
        // a cancelled sheet is not a failure — leave the button as it was
        if (isAbortError(error)) return
      }
    }

    // 2. the clipboard
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(summary)
        setShareState('copied')
        return
      } catch {
        /* fall through to the always-works path */
      }
    }

    // 3. always-works path: show the text, focused and selected
    setShareState('manual')
  }, [summary])

  const sectionVariants: Variants = {
    hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.45, ease: 'easeOut' },
    },
  }

  const shareLabel =
    shareState === 'shared'
      ? 'Summary shared'
      : shareState === 'copied'
        ? 'Copied to clipboard'
        : 'Share summary'

  return (
    <div className="flex flex-1 flex-col">
      {/* ---- hero -------------------------------------------------------- */}
      <header className="home-hero relative isolate overflow-hidden border-b border-border/70">
        <div
          aria-hidden="true"
          className="animate-aurora pointer-events-none absolute inset-0 opacity-55"
        />
        <div aria-hidden="true" className="home-hero-grid pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="grain pointer-events-none absolute inset-0" />

        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-7 px-6 pt-8 pb-12 lg:px-10 lg:pt-10 lg:pb-16">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-2xs font-medium tracking-[0.18em] text-primary uppercase">
              <Activity className="size-3.5" aria-hidden="true" />
              Screening result
            </span>
            <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Clock3 className="size-3.5" aria-hidden="true" />
              <time dateTime={isoStamp(analysis.createdAt)}>
                {formatRelativeTime(analysis.createdAt)} · {formatDateTime(analysis.createdAt)}
              </time>
            </span>
          </div>

          <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:gap-12">
            <motion.div
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' }}
              className="shrink-0"
            >
              <RiskGauge
                probability={probability}
                threshold={threshold}
                uncertaintyMargin={margin}
                level={analysis.riskLevel}
                size={244}
              />
            </motion.div>

            <div className="flex min-w-0 flex-col gap-4 text-center lg:text-left">
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                  <Badge variant={token}>{analysis.riskLevel}</Badge>
                  <Badge variant="outline">Screening only</Badge>
                  {analysis.isSynthetic ? <Badge variant="moderate">Demo result</Badge> : null}
                </div>
                <h1 className="display text-display-sm text-foreground sm:text-display">
                  {riskHeadline(analysis.riskLevel)}
                </h1>
              </div>

              <p className="text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
                {riskExplanation(analysis.riskLevel)}
              </p>

              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card/70 p-3.5 text-left">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-foreground">Capture quality</span>
                  <span className="metric text-sm font-semibold text-foreground">
                    {captureQuality}
                    <span className="text-2xs font-medium text-muted-foreground">/100</span>
                  </span>
                </div>
                <Progress
                  value={captureQuality}
                  tone={lowQuality ? 'moderate' : 'primary'}
                  label="Measured capture quality"
                  className="h-1.5"
                />
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  Measured by the server from the frame’s brightness, sharpness, clipped pixels,
                  how much conjunctiva it found and how close the capture sat to the training
                  distribution. It describes the photograph, not your health — and it is not a
                  confidence in the result.
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ---- body -------------------------------------------------------- */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10 lg:px-10 lg:py-12">
        {/* This h2 sits ABOVE the warning cards on purpose: CardTitle renders an
            h3, so leaving the heading below them produced h1 -> h3 -> h2 on
            exactly the branch a screen-reader user most needs to navigate
            cleanly. */}
        <h2 className="sr-only">Your reading in detail</h2>

        {/* `uncertain` gets its own card, first, in its own voice. It is not a
            middle band and it must never be presented as one. */}
        {isUncertain ? (
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="border-moderate/30 bg-moderate/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-moderate">
                  <ShieldQuestion className="size-4" aria-hidden="true" />
                  The model declined to call this one
                </CardTitle>
                <CardDescription>
                  {model.nearThreshold && model.modelDisagreement
                    ? `The probability landed inside the ±${formatProbability(
                        margin,
                      )} uncertainty margin around the threshold, and the two candidate models reached opposite conclusions about the same capture.`
                    : model.modelDisagreement
                      ? 'The two candidate models reached opposite conclusions about the same capture, each against its own threshold.'
                      : `The probability landed inside the ±${formatProbability(
                          margin,
                        )} uncertainty margin around the operating threshold, which is too close to call.`}{' '}
                  An inconclusive screen is not a negative result and it is not a positive one.
                  Reading it as either would be the one mistake that matters here.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2.5">
                <Button size="lg" onClick={onScanAgain} className="h-10 rounded-full px-4">
                  <RotateCcw className="size-4" data-icon="inline-start" aria-hidden="true" />
                  Try another capture
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={onViewInsights}
                  className="h-10 rounded-full px-4"
                >
                  How the decision is made
                  <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}

        {/* low capture quality comes before anything interpretive */}
        {lowQuality ? (
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="border-moderate/30 bg-moderate/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-moderate">
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  Treat this result as provisional
                </CardTitle>
                <CardDescription>
                  Capture quality was measured at {captureQuality}/100, which is low. The server
                  still accepted the frame, but a dim, soft or off-centre photograph flattens
                  exactly the colour differences the model reads — so the result says more about
                  the picture than it does about you.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2.5">
                <Button size="lg" onClick={onScanAgain} className="h-10 rounded-full px-4">
                  <RotateCcw className="size-4" data-icon="inline-start" aria-hidden="true" />
                  Retake in better light
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={onViewInsights}
                  className="h-10 rounded-full px-4"
                >
                  See what limited it
                  <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}

        {/* ---- the decision, in the open ------------------------------- */}
        <motion.div variants={sectionVariants} initial="hidden" animate="show">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="size-4 text-primary" aria-hidden="true" />
                Why this reading became “{analysis.riskLevel}”
              </CardTitle>
              <CardDescription>
                One comparison decides the outcome: the calibrated probability against the
                operating threshold, with an uncertainty margin either side of it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                    Calibrated probability
                  </dt>
                  <dd className={cn('metric text-xl font-semibold tabular-nums', tone.text)}>
                    {formatProbability(probability)}
                    <span className="pl-1.5 text-2xs font-medium text-muted-foreground">
                      {formatPercent(probability)}
                    </span>
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                    Operating threshold
                  </dt>
                  <dd className="metric text-xl font-semibold text-foreground tabular-nums">
                    {formatProbability(threshold)}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                    Uncertainty margin
                  </dt>
                  <dd className="metric text-xl font-semibold text-foreground tabular-nums">
                    ±{formatProbability(margin)}
                  </dd>
                </div>
              </dl>

              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                This capture scored {formatProbability(probability)}, which is{' '}
                {formatProbability(Math.abs(distance))} {distance >= 0 ? 'above' : 'below'} the
                threshold of {formatProbability(threshold)}.
                That threshold is deliberately set far below 0.5. It is tuned for sensitivity —
                the model is built to err towards flagging a capture that turns out to be fine
                rather than staying quiet about one that is not — so a probability that looks
                “low” next to a coin flip can still be a higher-risk decision. Calibration means
                the number behaves like a probability on the data this model was fitted to; it is
                not a percentage of how anaemic anyone is, and it is not a confidence score.
              </p>

              {model.nearThreshold || model.modelDisagreement ? (
                <div className="flex flex-wrap gap-2">
                  {model.nearThreshold ? (
                    <Badge variant="moderate">
                      <Info className="size-3" aria-hidden="true" />
                      Inside the uncertainty margin
                    </Badge>
                  ) : null}
                  {model.modelDisagreement ? (
                    <Badge variant="moderate">
                      <GitCompareArrows className="size-3" aria-hidden="true" />
                      Candidate models disagreed
                    </Badge>
                  ) : null}
                </div>
              ) : null}

              <Separator />

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Both candidates, each against its own threshold
                </h3>
                <MeasureBars
                  rows={candidates}
                  emptyLabel="The server reported no candidate probabilities for this scan."
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {/* ---- fusion gate weights ------------------------------------ */}
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="size-4 text-primary" aria-hidden="true" />
                  Where the fusion head put its weight
                </CardTitle>
                <CardDescription>
                  The gated fusion candidate decides per image how much to lean on each of its
                  three inputs. These shares sum to 100% and describe this capture only.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <MeasureBars
                  rows={gateWeights}
                  emptyLabel="The server reported no fusion gate weights for this scan."
                />
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  A gate weight is an attention share inside one model. It says where the model
                  looked — never what it found, and never anything about you.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* ---- ROI ---------------------------------------------------- */}
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crosshair className="size-4 text-primary" aria-hidden="true" />
                  Finding the conjunctiva
                </CardTitle>
                <CardDescription>
                  The model was fitted on masked conjunctiva segmentations, so the server locates
                  and masks that tissue before scoring anything. A frame with no plausible region
                  is refused rather than scored.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {analysis.roi ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={analysis.roi.located ? 'safe' : 'moderate'}>
                        {analysis.roi.located ? 'Located automatically' : 'Not located'}
                      </Badge>
                      <Badge variant="outline">{analysis.roi.method}</Badge>
                    </div>
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                          Frame identified as conjunctiva
                        </dt>
                        <dd className="metric text-lg font-semibold text-foreground tabular-nums">
                          {formatPercent(analysis.roi.coverage, 2)}
                        </dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                          Masked out of the crop
                        </dt>
                        <dd className="metric text-lg font-semibold text-foreground tabular-nums">
                          {formatPercent(analysis.roi.maskedFraction, 2)}
                        </dd>
                      </div>
                      {analysis.roi.sourceSize.length === 2 ? (
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                            Submitted frame
                          </dt>
                          <dd className="text-sm text-foreground tabular-nums">
                            {analysis.roi.sourceSize[0]} × {analysis.roi.sourceSize[1]} px
                          </dd>
                        </div>
                      ) : null}
                      {analysis.roi.roiSize.length === 2 ? (
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                            Region passed to the model
                          </dt>
                          <dd className="text-sm text-foreground tabular-nums">
                            {analysis.roi.roiSize[0]} × {analysis.roi.roiSize[1]} px
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    <p className="text-2xs leading-relaxed text-muted-foreground">
                      Tissue is selected on redness-over-yellowness — the colour axis haemoglobin
                      actually drives — with the threshold derived from the training set’s own
                      statistics rather than hand-picked. Coverage is the share of the whole
                      submitted frame, so a tightly cropped eyelid legitimately reads low.
                    </p>
                  </>
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    This scan carries no ROI report, so there is nothing to show here. Nothing is
                    inferred in its place.
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* ---- measured capture quality, in detail --------------------- */}
        {analysis.quality || budgetRow ? (
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sun className="size-4 text-primary" aria-hidden="true" />
                  What the capture itself measured
                </CardTitle>
                <CardDescription>
                  The raw figures behind the {captureQuality}/100 quality score, plus how far this
                  frame sat from the data the model was fitted on.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {analysis.quality ? (
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Mean brightness
                      </dt>
                      <dd className="metric text-lg font-semibold text-foreground tabular-nums">
                        {formatFixed(analysis.quality.brightness, 1)}
                        <span className="pl-1 text-2xs font-medium text-muted-foreground">
                          /255
                        </span>
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Sharpness
                      </dt>
                      <dd className="metric text-lg font-semibold text-foreground tabular-nums">
                        {analysis.quality.blurVariance === null
                          ? '—'
                          : formatFixed(analysis.quality.blurVariance, 1)}
                        <span className="pl-1 text-2xs font-medium text-muted-foreground">
                          Laplacian variance
                        </span>
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Clipped pixels
                      </dt>
                      <dd className="metric text-lg font-semibold text-foreground tabular-nums">
                        {analysis.quality.clippedFraction === null
                          ? '—'
                          : formatPercent(analysis.quality.clippedFraction, 2)}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                {budgetRow ? (
                  <>
                    {analysis.quality ? <Separator /> : null}
                    <MeasureBars rows={[budgetRow]} />
                  </>
                ) : null}
              </CardContent>
            </Card>
          </motion.div>
        ) : null}

        {/* ---- optional Gemini explanation ---------------------------- */}
        {explanation?.available && explanation.explanation ? (
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" aria-hidden="true" />
                  A plain-language reading of this result
                </CardTitle>
                <CardDescription>
                  Written by a language model from the figures above, after the decision was made.
                  It explains the result; it cannot change it, and it is not medical advice.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-pretty whitespace-pre-line text-muted-foreground">
                  {explanation.explanation}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}

        {/* ---- next steps --------------------------------------------- */}
        <motion.div variants={sectionVariants} initial="hidden" animate="show">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-primary" aria-hidden="true" />
                Sensible next steps
              </CardTitle>
              <CardDescription>
                General guidance for this outcome, not personal medical advice. Nothing here
                replaces a clinician who can examine you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex list-none flex-col gap-3">
                {advice.map((item, index) => (
                  <li key={item} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.625rem] font-semibold tabular-nums',
                        tone.border,
                        tone.bg,
                        tone.text,
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="text-sm leading-relaxed text-pretty text-muted-foreground">
                      {item}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </motion.div>

        {/* ---- the notice that matters -------------------------------- */}
        <motion.div variants={sectionVariants} initial="hidden" animate="show">
          <Card className="border-primary/25 bg-primary/5">
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary"
              >
                <ShieldAlert className="size-5" />
              </span>
              <div className="flex flex-col gap-2">
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  A screening signal, not a diagnosis
                </h2>
                <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                  AnemiaScan scores colour and texture in a photograph. It has no access to your
                  blood, no clinical validation, and no regulatory clearance of any kind. It cannot
                  confirm or rule out anaemia, it cannot tell you why a reading looks the way it
                  does, and it must never be used to start, stop or change treatment. A low
                  probability is not reassurance if you feel unwell, and a high one is not a
                  diagnosis if you feel fine — in both cases the next step is a conversation with a
                  clinician and a haemoglobin blood test.
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Urgent symptoms — chest pain, fainting, breathlessness at rest, a racing heart or
                  visible blood loss — need immediate medical care, whatever this screen says.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ---- explainers --------------------------------------------- */}
        <motion.div
          variants={sectionVariants}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-3"
        >
          <Disclosure label="Why does an eyelid photo say anything at all?">
            The model reads the palpebral conjunctiva — the moist lining inside your lower eyelid.
            It is one of the few places where a blood-rich membrane sits directly under a thin,
            unpigmented surface, so its colour tracks perfusion rather than skin tone. As
            haemoglobin falls, that tissue trends from a deep pink-red toward pale pink. The server
            locates and masks that tissue, then two image encoders and a set of engineered colour
            statistics are combined into a single calibrated probability. It is a statistical
            reading of a photograph, and it is not a blood test.
          </Disclosure>

          <Disclosure label="What could skew this result?">
            <ul className="flex list-none flex-col gap-3">
              {CONFOUNDERS.map((item) => (
                <li key={item.title} className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-foreground">{item.title}</span>
                  <span className="text-xs leading-relaxed">{item.body}</span>
                </li>
              ))}
            </ul>
          </Disclosure>

          <Disclosure label="Where did my photo go?">
            The photo was uploaded to the AnemiaScan server over an encrypted connection and
            scored there — this is not on-device analysis, and a signed-in account is required to
            run a scan. The server holds the image in memory for the length of one request and
            never writes it to disk; what it keeps is the numeric result and a hash commitment.
            The copy of the photo shown in your history lives in this browser, on this device, and
            is removed when you clear your history.
          </Disclosure>

          {analysis.demoNotice ? (
            <Disclosure label="Model & demo notice">{analysis.demoNotice}</Disclosure>
          ) : null}
        </motion.div>

        {/* ---- provenance --------------------------------------------- */}
        <motion.section
          variants={sectionVariants}
          initial="hidden"
          animate="show"
          aria-labelledby="result-provenance-heading"
        >
          <Card>
            <CardHeader>
              <CardTitle id="result-provenance-heading" className="flex items-center gap-2">
                <Hash className="size-4 text-primary" aria-hidden="true" />
                Provenance
              </CardTitle>
              <CardDescription>
                Which model produced this result, and the hashes that let it be checked later
                without anyone having to reveal the photograph.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{model.modelVersion || 'model version unknown'}</Badge>
                <Badge variant="outline">
                  Candidate: {model.selectedModel ? humaniseKey(model.selectedModel) : '—'}
                </Badge>
                {analysis.isSynthetic ? <Badge variant="moderate">Synthetic / demo</Badge> : null}
              </div>

              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {analysis.modelHash ? (
                  <ProvenanceRow
                    label="Model hash"
                    value={analysis.modelHash}
                    note="A keccak hash of the weights manifest — every checkpoint, scaler and threshold file the runtime loads. Change one byte of one file and this value changes, so it cannot be faked by relabelling a model."
                  />
                ) : null}
                {analysis.commitment ? (
                  <ProvenanceRow
                    label="Commitment"
                    value={analysis.commitment}
                    note="A hash binding this result to its inputs. It can be verified later without exposing the image or the result itself."
                  />
                ) : null}
                {analysis.scanIdHash ? (
                  <ProvenanceRow
                    label="Scan ID hash"
                    value={analysis.scanIdHash}
                    note="The identifier this screening is recorded under."
                  />
                ) : null}
                {analysis.chainTxHash ? (
                  <ProvenanceRow label="Transaction" value={analysis.chainTxHash} />
                ) : null}
              </dl>
            </CardContent>
          </Card>
        </motion.section>

        {/* ---- on-chain registration ----------------------------------
            Shown whenever the backend says it registered the commitment. This
            card used to be gated on `explorerUrl` as well, so a scan that was
            genuinely anchored on a chain with no configured explorer silently
            claimed nothing had happened. The link is the optional part, not the
            registration. */}
        {analysis.registeredOnChain ? (
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="border-primary/25 bg-primary/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Link2 className="size-4 text-primary" aria-hidden="true" />
                    Screening commitment anchored on-chain
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A hash of this screening was registered so the result can later be verified
                    without exposing the underlying image.
                    {analysis.chainTxStatus ? ` Status: ${analysis.chainTxStatus}.` : ''}
                    {!analysis.explorerUrl
                      ? ' No block explorer is configured for this network, so there is no link to follow.'
                      : ''}
                  </p>
                </div>
                {analysis.explorerUrl ? (
                  <a
                    href={analysis.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ring-focus inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    View on explorer
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </CardContent>
            </Card>
          </motion.div>
        ) : null}

        {/* ---- actions ------------------------------------------------- */}
        <motion.section
          variants={sectionVariants}
          initial="hidden"
          animate="show"
          aria-labelledby="result-actions-heading"
          className="flex flex-col gap-4"
        >
          <h2 id="result-actions-heading" className="sr-only">
            What next
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button size="lg" onClick={onViewInsights} className="h-12 rounded-full px-5 text-base">
              <Layers className="size-4" data-icon="inline-start" aria-hidden="true" />
              How the model works
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={onScanAgain}
              className="h-12 rounded-full px-5 text-base"
            >
              <RotateCcw className="size-4" data-icon="inline-start" aria-hidden="true" />
              Scan again
            </Button>
          </div>

          <Button
            variant="outline"
            size="lg"
            onClick={onViewBlockchain}
            className="h-11 w-full rounded-full px-5"
          >
            <Link2 className="size-4" data-icon="inline-start" aria-hidden="true" />
            View private blockchain proof & care options
          </Button>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="ghost"
              size="lg"
              onClick={onViewHistory}
              className="h-11 rounded-full px-5"
            >
              <History className="size-4" data-icon="inline-start" aria-hidden="true" />
              Compare with history
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                void handleShare()
              }}
              className="h-11 rounded-full px-5"
            >
              {shareState === 'shared' || shareState === 'copied' ? (
                <Check className="size-4" data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Share2 className="size-4" data-icon="inline-start" aria-hidden="true" />
              )}
              {shareLabel}
            </Button>
          </div>

          <p aria-live="polite" className="sr-only">
            {shareState === 'shared'
              ? 'Summary shared.'
              : shareState === 'copied'
                ? 'Summary copied to the clipboard.'
                : shareState === 'manual'
                  ? 'Sharing is unavailable in this browser. The summary text is shown below, selected and ready to copy.'
                  : ''}
          </p>

          {shareState === 'manual' ? (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Copy className="size-4 text-primary" aria-hidden="true" />
                  Copy the summary manually
                </CardTitle>
                <CardDescription>
                  This browser offers neither a share sheet nor clipboard access. The full text is
                  selected below — copy it with your keyboard or a long-press.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <textarea
                  ref={manualRef}
                  readOnly
                  rows={12}
                  value={summary}
                  aria-label="Screening summary text"
                  className="ring-focus w-full resize-y rounded-xl border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground"
                />
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setShareState('idle')}
                  className="h-10 w-fit rounded-full px-4"
                >
                  Done
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope className="size-4 text-primary" aria-hidden="true" />
                Send this report to a doctor
              </CardTitle>
              <CardDescription>
                A clinician can review this AI-assisted screening and leave guidance in the doctor
                portal. Nothing here is an automated recommendation, and no diagnosis is generated.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sentToDoctor ? (
                <p className="flex items-center gap-2 text-sm font-medium text-safe">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Report sent to the doctor review queue.
                </p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    onSendToDoctor(patientLabel.trim() || 'Current patient')
                    setSentToDoctor(true)
                  }}
                  className="flex flex-col gap-2 sm:flex-row"
                >
                  <label htmlFor="doctor-patient-label" className="sr-only">
                    Patient name or ID (optional)
                  </label>
                  <input
                    id="doctor-patient-label"
                    value={patientLabel}
                    onChange={(event) => setPatientLabel(event.target.value)}
                    placeholder="Patient name or ID (optional)"
                    className="ring-focus h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none"
                  />
                  <Button type="submit" className="h-10 rounded-lg px-4">
                    <Send className="size-4" data-icon="inline-start" aria-hidden="true" />
                    Send for review
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Probability"
              value={formatProbability(probability)}
              hint="Calibrated, on a 0–1 scale. Not a score and not a confidence."
            />
            <Stat
              label="Threshold"
              value={formatProbability(threshold)}
              hint={`Sensitivity-tuned decision boundary, ±${formatProbability(margin)} margin`}
            />
            <Stat
              label="Capture quality"
              value={`${captureQuality}/100`}
              hint="Measured from this photograph, not from your health"
            />
          </div>

          <p className="text-2xs leading-relaxed text-muted-foreground">
            Your photo was uploaded to the AnemiaScan server for analysis, held in memory for the
            length of the request and not written to disk. A free account is required to run a
            scan. The result and the photo shown in your history are stored in this browser only.
          </p>
        </motion.section>
      </div>
    </div>
  )
}
