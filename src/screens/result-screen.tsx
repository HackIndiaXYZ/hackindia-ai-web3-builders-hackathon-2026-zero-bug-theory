/* --------------------------------------------------------------------------
 * ResultScreen — what the user sees the second a scan lands.
 * --------------------------------------------------------------------------
 * Everything on this screen is built around one rule: a screening score is not
 * a diagnosis, and the interface must never let that distinction blur. So the
 * gauge is labelled "score", the haemoglobin figure is labelled as an
 * illustrative interval and never as a measurement, low-confidence captures say
 * so before they say anything else, and the non-diagnostic notice is a
 * first-class card rather than small print.
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
  Droplet,
  History,
  Info,
  RotateCcw,
  Send,
  Share2,
  ShieldAlert,
  Layers,
  Link2,
  Sparkles,
  Stethoscope,
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
import { SignalBars, rankSignals } from '@/src/components/signal-bars'
import { clamp, formatDateTime, formatRelativeTime } from '@/src/lib/format'
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

/** Below this, the capture is too uncertain to lean on. */
const LOW_CONFIDENCE = 55

/** Scale ends for the illustrative haemoglobin ruler, in g/dL. */
const HB_MIN = 6
const HB_MAX = 18
const HB_TICKS = [8, 10, 12, 14, 16] as const

const CONFOUNDERS = [
  {
    title: 'Light colour',
    body: 'Warm bulbs, screen light and coloured lamps shift white balance, and a shifted white balance shifts every colour reading. Bright, indirect daylight is the only condition this screen is tuned for.',
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
    body: 'This heuristic has no calibration for age, pregnancy, altitude, skin tone or chronic illness. Two people with identical haemoglobin can score differently, and that is a limitation, not a feature.',
  },
] as const

/* -------------------------------------------------------------------------- */
/* Plain-text summary (share / copy)                                          */
/* -------------------------------------------------------------------------- */

function buildSummary(analysis: ScanAnalysis): string {
  const ranked = rankSignals(analysis.signals)
  const lines: string[] = [
    'AnemiaScan — screening summary',
    formatDateTime(analysis.createdAt),
    '',
    `Screening score: ${analysis.riskScore}/100 (${analysis.riskLevel})`,
    `Capture confidence: ${analysis.confidence}/100`,
    `Illustrative haemoglobin interval: ${analysis.hbRange.low.toFixed(1)}-${analysis.hbRange.high.toFixed(1)} g/dL (illustrative only, NOT a blood test)`,
    `Capture quality: light ${analysis.quality.light}/100, focus ${analysis.quality.focus}/100, framing ${analysis.quality.framing}/100`,
  ]

  if (ranked.length) {
    lines.push('', 'Signals, ranked by contribution to the score:')
    ranked.forEach((item, index) => {
      const direction = item.highIsConcerning ? 'higher is concerning' : 'higher is reassuring'
      lines.push(
        `  ${index + 1}. ${item.signal.label}: ${item.signal.value}/100 (${direction}, weight ${Math.round(
          item.signal.weight * 100,
        )}%)`,
      )
    })
  }

  lines.push(
    '',
    'What this is: a screening aid that measures colour, saturation and texture in a photo of the inner lower eyelid.',
    'What this is not: a diagnosis, a haemoglobin measurement, or a substitute for a blood test.',
    'Only a haemoglobin (CBC) blood test can establish anaemia. Please discuss any concern with a clinician.',
    'Scored by AnemiaScan’s AI model — the photo was analysed in memory and never stored.',
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

/* -------------------------------------------------------------------------- */
/* Illustrative haemoglobin ruler                                             */
/* -------------------------------------------------------------------------- */

function HbRuler({ low, high, fill }: { low: number; high: number; fill: string }) {
  const span = HB_MAX - HB_MIN
  const start = clamp(((low - HB_MIN) / span) * 100, 0, 100)
  const end = clamp(((high - HB_MIN) / span) * 100, 0, 100)
  const width = Math.max(2.5, end - start)

  return (
    <div aria-hidden="true" className="flex flex-col gap-1.5">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {HB_TICKS.map((tick) => (
          <span
            key={tick}
            className="absolute top-0 h-full w-px bg-background/80"
            style={{ left: `${((tick - HB_MIN) / span) * 100}%` }}
          />
        ))}
        <span
          className={cn('absolute top-0 h-full rounded-full opacity-90', fill)}
          style={{ left: `${start}%`, width: `${width}%` }}
        />
      </div>
      <div className="flex justify-between text-[0.625rem] text-muted-foreground tabular-nums">
        <span>{HB_MIN}</span>
        {HB_TICKS.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
        <span>{HB_MAX}</span>
      </div>
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
  const token = riskColorToken(analysis.riskLevel)
  const tone = riskClasses(token)
  const advice = riskAdvice(analysis.riskLevel)

  const ranked = useMemo(() => rankSignals(analysis.signals), [analysis.signals])
  const topSignals = useMemo(() => ranked.slice(0, 3).map((item) => item.signal), [ranked])
  const summary = useMemo(() => buildSummary(analysis), [analysis])

  const lowConfidence = analysis.confidence < LOW_CONFIDENCE
  const [shareState, setShareState] = useState<ShareState>('idle')
  const manualRef = useRef<HTMLTextAreaElement | null>(null)
  const [patientLabel, setPatientLabel] = useState('')
  const [sentToDoctor, setSentToDoctor] = useState(false)

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
              <RiskGauge score={analysis.riskScore} level={analysis.riskLevel} size={244} />
            </motion.div>

            <div className="flex min-w-0 flex-col gap-4 text-center lg:text-left">
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                  <Badge variant={token}>{analysis.riskLevel}</Badge>
                  <Badge variant="outline">Screening only</Badge>
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
                  <span className="text-xs font-medium text-foreground">
                    Confidence in this capture
                  </span>
                  <span className="metric text-sm font-semibold text-foreground">
                    {analysis.confidence}
                    <span className="text-2xs font-medium text-muted-foreground">/100</span>
                  </span>
                </div>
                <Progress
                  value={analysis.confidence}
                  tone={lowConfidence ? 'moderate' : 'primary'}
                  label="Confidence in this capture"
                  className="h-1.5"
                />
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  Confidence describes the photo, not your health: lighting, focus and framing decide
                  how much the five signals are worth.
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ---- body -------------------------------------------------------- */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10 lg:px-10 lg:py-12">
        {/* This h2 sits ABOVE the low-confidence card on purpose: CardTitle
            renders an h3, so leaving the heading below it produced h1 -> h3 ->
            h2 on exactly the branch a screen-reader user most needs to navigate
            cleanly. */}
        <h2 className="sr-only">Your reading in detail</h2>

        {/* low-confidence warning comes before anything interpretive */}
        {lowConfidence ? (
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="border-moderate/30 bg-moderate/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-moderate">
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  Treat this result as provisional
                </CardTitle>
                <CardDescription>
                  Confidence came out at {analysis.confidence}/100, which is low. At that level the
                  score says more about the photo than about you — a dim, soft or off-centre frame
                  flattens exactly the colour differences this screen depends on.
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

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {/* ---- illustrative haemoglobin ------------------------------- */}
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Droplet className="size-4 text-primary" aria-hidden="true" />
                  Illustrative haemoglobin interval
                </CardTitle>
                <CardDescription>
                  Where this score would sit on a haemoglobin scale, if the relationship held
                  perfectly. It does not — this is an illustration of the band, not a measurement of
                  your blood.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-end justify-between gap-3">
                  <p className={cn('metric text-display-xs font-semibold', tone.text)}>
                    {analysis.hbRange.low.toFixed(1)}
                    <span className="px-1 text-muted-foreground">–</span>
                    {analysis.hbRange.high.toFixed(1)}
                    <span className="pl-1.5 text-xs font-medium text-muted-foreground">g/dL</span>
                  </p>
                  <Badge variant="outline">Not a lab value</Badge>
                </div>

                <HbRuler low={analysis.hbRange.low} high={analysis.hbRange.high} fill={tone.fill} />

                <Separator />

                <ul className="flex list-none flex-col gap-2">
                  <li className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    The interval widens as capture confidence drops, because an uncertain photo
                    honestly supports a wider range.
                  </li>
                  <li className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                    <Stethoscope
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    A laboratory haemoglobin test costs little, takes minutes, and replaces every
                    number on this screen with a real one.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </motion.div>

          {/* ---- top signals -------------------------------------------- */}
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" aria-hidden="true" />
                  What moved the score most
                </CardTitle>
                <CardDescription>
                  The three strongest contributors of the five measured signals. Tap a row for the
                  plain-language reading.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <SignalBars signals={topSignals} />
                <Button
                  variant="outline"
                  size="lg"
                  onClick={onViewInsights}
                  className="h-10 w-full rounded-full"
                >
                  All five signals and the model card
                  <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* ---- next steps --------------------------------------------- */}
        <motion.div variants={sectionVariants} initial="hidden" animate="show">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-primary" aria-hidden="true" />
                Sensible next steps
              </CardTitle>
              <CardDescription>
                General guidance for this band, not personal medical advice. Nothing here replaces a
                clinician who can examine you.
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
                  AnemiaScan measures colour and texture in a photograph. It has no access to your
                  blood, no clinical validation, and no regulatory clearance of any kind. It cannot
                  confirm or rule out anaemia, it cannot tell you why a reading looks the way it
                  does, and it must never be used to start, stop or change treatment. A low score is
                  not reassurance if you feel unwell, and a high score is not a diagnosis if you
                  feel fine — in both cases the next step is a conversation with a clinician and a
                  haemoglobin blood test.
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
            AnemiaScan looks at colour signals in the palpebral conjunctiva — the moist lining
            inside your lower eyelid. It is one of the few places where a blood-rich membrane sits
            directly under a thin, unpigmented surface, so its colour tracks perfusion rather than
            skin tone. As haemoglobin falls, that tissue trends from a deep pink-red toward pale
            pink. This scan measures how far your capture sits from the saturated end of that range,
            alongside vascular detail and exposure quality. It is a colour statistic, computed on
            your device, and it is not a blood test.
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

          {analysis.demoNotice ? (
            <Disclosure label="Model & privacy">{analysis.demoNotice}</Disclosure>
          ) : null}
        </motion.div>

        {/* ---- on-chain registration, when the backend anchored this scan --- */}
        {analysis.registeredOnChain && analysis.explorerUrl ? (
          <motion.div variants={sectionVariants} initial="hidden" animate="show">
            <Card className="border-primary/25 bg-primary/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-foreground">
                    Screening commitment anchored on-chain
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A hash of this screening was registered so the result can later be verified
                    without exposing the underlying image.
                    {analysis.chainTxStatus ? ` Status: ${analysis.chainTxStatus}.` : ''}
                  </p>
                </div>
                <a
                  href={analysis.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  View on explorer →
                </a>
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
              View signal insights
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
                  rows={10}
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
              label="Score"
              value={`${analysis.riskScore}/100`}
              hint="Higher means more anaemia-like signals"
            />
            <Stat
              label="Confidence"
              value={`${analysis.confidence}/100`}
              hint="Quality of this capture, not of your health"
            />
            <Stat
              label="Signals measured"
              value={`${analysis.signals.length}`}
              hint="Colour, saturation, texture and exposure"
            />
          </div>

          <p className="text-2xs leading-relaxed text-muted-foreground">
            Your photo is analysed securely and never stored — only the score is kept. History
            stays in this browser, and a free account is required to use AnemiaScan.
          </p>
        </motion.section>
      </div>
    </div>
  )
}

