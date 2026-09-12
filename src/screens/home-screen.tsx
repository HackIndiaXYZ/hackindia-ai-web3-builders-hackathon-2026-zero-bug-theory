/* --------------------------------------------------------------------------
 * HomeScreen — the landing experience.
 * --------------------------------------------------------------------------
 * Seven bands, in order:
 *   1. Hero            — display headline, dual CTA, framed optical guide
 *   2. Continuity      — your last scan, or a designed first-run invitation
 *   3. HeroShowcase    — the six-chapter product story (skiper40 stack)
 *   4. How it works    — the numbered Capture / Analyse / Screen sequence
 *   5. TrustStrip      — honest, architecture-level claims
 *   6. Faq             — what the screen can and cannot tell you
 *   7. Closing CTA     — plus the standing not-a-diagnosis footer
 *
 * Visual identity is inherited from the original hero: editorial display type,
 * hairline borders, teal primary, uppercase tracked eyebrows, and the framed
 * optical-guide motif built from the `.home-hero*` utilities.
 *
 * Motion: one shared stagger, driven by variants, collapsed to zero-duration
 * under `prefers-reduced-motion` via `useReducedMotion`.
 * -------------------------------------------------------------------------- */

import { useMemo } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'
import {
  ArrowRight,
  Camera,
  CircleCheck,
  Clock,
  Eye,
  Gauge,
  History,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Stat } from '@/components/ui/stat'
import { EyeGuide } from '@/src/components/eye-guide'
import { Faq } from '@/src/components/faq'
import { HeroShowcase } from '@/src/components/hero-showcase'
import { TrustStrip } from '@/src/components/trust-strip'
import { formatRelativeTime } from '@/src/lib/format'
import { historyStats } from '@/src/lib/history'
import { riskClasses, riskColorToken } from '@/src/lib/risk-style'
import type { ScanAnalysis } from '@/src/lib/types'

/* -------------------------------------------------------------------------- */
/* Static content                                                             */
/* -------------------------------------------------------------------------- */

const HERO_FACTS = [
  { icon: Clock, value: '~30s', label: 'per scan' },
  { icon: Gauge, value: '5', label: 'signals read' },
  { icon: ShieldCheck, value: '0', label: 'photos stored' },
] as const

const STEPS = [
  {
    index: '01',
    icon: Camera,
    title: 'Capture',
    body: 'Pull the lower lid down in bright, indirect light and fill the guide frame with the inner surface. The shutter only arms once light, focus and framing all read as ready.',
    outcome: 'You get a frame worth scoring — not a dark guess.',
  },
  {
    index: '02',
    icon: ScanEye,
    title: 'Analyse',
    body: 'The frame is sampled pixel by pixel on your device. Pallor, redness, saturation, vascular texture and illumination are each measured and normalised to a 0–100 reading.',
    outcome: 'You see every signal and the weight it carries.',
  },
  {
    index: '03',
    icon: ShieldCheck,
    title: 'Screen',
    body: 'The readings blend into one score, one of three risk bands, and a confidence figure that falls when the capture is marginal. A frame that is too dark is refused, not fudged.',
    outcome: 'You get something specific to take to a clinician.',
  },
] as const

const FIRST_RUN_TIPS = [
  { icon: Sun, title: 'Find bright, indirect light', body: 'A window works. Direct sun and coloured bulbs both distort the reading.' },
  { icon: Eye, title: 'Expose the inner lower lid', body: 'Gently pull the lid down until the moist inner surface fills the guide frame.' },
  { icon: Camera, title: 'Hold still, glasses off', body: 'About 15–20 cm away. No filters, no beauty mode, no colour enhancement.' },
] as const

/* -------------------------------------------------------------------------- */
/* Motion                                                                     */
/* -------------------------------------------------------------------------- */

function useHeroMotion() {
  const reduceMotion = useReducedMotion() ?? false

  return useMemo(() => {
    const container: Variants = {
      hidden: {},
      show: {
        transition: {
          staggerChildren: reduceMotion ? 0 : 0.085,
          delayChildren: reduceMotion ? 0 : 0.04,
        },
      },
    }

    const item: Variants = {
      hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 22 },
      show: {
        opacity: 1,
        y: 0,
        transition: { duration: reduceMotion ? 0 : 0.6, ease: 'easeOut' },
      },
    }

    const frame: Variants = {
      hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.95 },
      show: {
        opacity: 1,
        scale: 1,
        transition: { duration: reduceMotion ? 0 : 0.85, delay: reduceMotion ? 0 : 0.2, ease: 'easeOut' },
      },
    }

    return { container, item, frame, reduceMotion }
  }, [reduceMotion])
}

/* -------------------------------------------------------------------------- */
/* Continuity band                                                            */
/* -------------------------------------------------------------------------- */

function LastScanBand({
  history,
  onStart,
  onViewHistory,
}: {
  history: ScanAnalysis[]
  onStart: () => void
  onViewHistory: () => void
}) {
  const latest = history[0]
  const stats = historyStats(history)
  const token = riskColorToken(latest.riskLevel)
  const tone = riskClasses(token)
  const improving = stats.trend < 0

  return (
    <Card className="card-hover overflow-hidden">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-2xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Picking up where you left off
          </span>
          <CardTitle className="text-display-xs">Your most recent screen</CardTitle>
        </div>
        <Badge variant={token} className="shrink-0 self-start text-xs">
          {latest.riskLevel}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className={cn('metric text-display-lg leading-none', tone.text)}>
                {Math.round(latest.riskScore)}
              </span>
              <span className="text-sm text-muted-foreground">/ 100 screening score</span>
            </div>
            <Progress
              value={latest.riskScore}
              tone={token}
              label={`Screening score ${Math.round(latest.riskScore)} out of 100`}
            />
            {/* The g/dL figure is deliberately NOT printed here. On the result
                screen it carries a title, a "Not a lab value" badge and a full
                description; dropped into a metrics row next to two genuine
                measurements it reads as a measured value with the caveat
                trailing. The card links straight through to the fenced version. */}
            <p className="text-xs text-muted-foreground">
              Captured {formatRelativeTime(latest.createdAt)} ·{' '}
              {Math.round(latest.confidence)}% confidence · illustrative haemoglobin band only,
              not a measurement
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-x-8 gap-y-4 sm:justify-end">
            <Stat label="Scans kept" value={String(stats.count)} />
            <Stat label="Average" value={String(stats.average)} hint="across all scans" />
            <Stat
              label="Vs baseline"
              value={`${stats.trend > 0 ? '+' : ''}${stats.trend}`}
              hint={
                stats.trend === 0
                  ? 'holding steady'
                  : improving
                    ? 'lower than before'
                    : 'higher than before'
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/70 pt-5">
          <Button size="lg" onClick={onStart} className="h-11 rounded-full px-5">
            Scan again
            <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={onViewHistory}
            className="h-11 rounded-full px-5"
          >
            <History className="size-4" data-icon="inline-start" aria-hidden="true" />
            View history
          </Button>
          <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
            {stats.trend === 0 ? null : improving ? (
              <TrendingDown className="size-3.5 text-safe" aria-hidden="true" />
            ) : (
              <TrendingUp className="size-3.5 text-moderate" aria-hidden="true" />
            )}
            {stats.count > 1
              ? 'A direction of travel is more meaningful than any single scan.'
              : 'Scan again in a few days to start a trend line.'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function FirstRunBand({ onStart, onLearn }: { onStart: () => void; onLearn: () => void }) {
  return (
    <Card className="card-hover overflow-hidden">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-2xs font-medium tracking-[0.2em] text-primary uppercase">
            First scan
          </span>
          <CardTitle className="text-display-xs">Three things, then you are ready</CardTitle>
        </div>
        <Badge variant="outline" className="shrink-0 self-start text-xs">
          <Clock className="size-3" aria-hidden="true" />
          About 30 seconds
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <ul className="grid gap-4 sm:grid-cols-3">
          {FIRST_RUN_TIPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/70 bg-background/40 p-4">
              <span className="flex items-center gap-2">
                <span className="inline-flex size-7 items-center justify-center rounded-chip-sm border border-primary/25 bg-primary/10 text-primary">
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="metric text-2xs text-muted-foreground">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </span>
              <span className="text-sm leading-snug font-semibold tracking-tight text-foreground">
                {title}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/70 pt-5">
          <Button size="lg" onClick={onStart} className="h-11 rounded-full px-5">
            Begin your first scan
            <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="lg" onClick={onLearn} className="h-11 rounded-full px-5">
            Read the guide first
          </Button>
          <span className="text-2xs text-muted-foreground">
            Nothing is saved until you finish a scan.
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

interface HomeScreenProps {
  onStart: () => void
  onViewHistory: () => void
  onLearn: () => void
  history: ScanAnalysis[]
}

export function HomeScreen({ onStart, onViewHistory, onLearn, history }: HomeScreenProps) {
  const { container, item, frame } = useHeroMotion()
  const hasHistory = history.length > 0

  return (
    <div className="flex flex-1 flex-col">
      {/* ---------------------------------------------------------------- 1 */}
      <section className="home-hero relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="animate-aurora pointer-events-none absolute inset-0 opacity-70"
        />
        <div className="home-hero-grid pointer-events-none absolute inset-0" />
        <div className="home-hero-orbit pointer-events-none absolute top-1/2 left-1/2 h-[min(72vw,42rem)] w-[min(72vw,42rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/15" />
        <div className="grain pointer-events-none absolute inset-0" />

        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="relative z-10 mx-auto grid w-full max-w-6xl gap-14 px-6 pt-16 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-20 lg:px-10 lg:pt-24 lg:pb-28"
        >
          <div className="flex max-w-2xl flex-col items-start gap-7 text-left">
            <motion.span
              variants={item}
              className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-2xs font-medium tracking-[0.18em] text-primary uppercase"
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              AI-powered screening / 01
            </motion.span>

            <motion.h1
              variants={item}
              className="display text-[2.85rem] leading-[0.95] text-foreground sm:text-display-xl lg:text-[5.4rem]"
            >
              See the signal
              <span className="gradient-text block">before it hides.</span>
            </motion.h1>

            <motion.p
              variants={item}
              className="max-w-lg text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg"
            >
              AnemiaScan reads the inside of your lower eyelid — the one place your capillaries show
              through unpigmented tissue — and a real AI model turns its colour into a screening
              score. Your photo is analysed securely in about half a minute and is never stored.
            </motion.p>

            <motion.div variants={item} className="flex flex-wrap items-center gap-3 pt-1">
              <Button size="lg" onClick={onStart} className="h-12 rounded-full px-7 text-base">
                Begin a scan
                <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={onLearn}
                className="h-12 rounded-full px-6 text-base"
              >
                How it works
              </Button>
            </motion.div>

            <motion.dl variants={item} className="flex flex-wrap gap-x-8 gap-y-3">
              {HERO_FACTS.map(({ icon: Icon, value, label }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <dt className="sr-only">{label}</dt>
                  <dd className="flex items-baseline gap-1.5">
                    <span className="metric text-lg font-semibold text-foreground">{value}</span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </dd>
                </div>
              ))}
            </motion.dl>

            <motion.p
              variants={item}
              className="max-w-md border-l-2 border-primary/40 pl-4 text-xs leading-relaxed text-muted-foreground"
            >
              <strong className="font-semibold text-foreground">
                This is a screening aid, not a diagnosis.
              </strong>{' '}
              It cannot measure haemoglobin and it is not a medical device. Only a blood test can
              confirm anaemia — take any result to a clinician.
            </motion.p>
          </div>

          <motion.div
            variants={frame}
            className="relative flex min-h-[25rem] items-center justify-center lg:min-h-[34rem]"
          >
            <div className="absolute top-3 right-0 hidden text-right text-2xs tracking-[0.24em] text-muted-foreground uppercase sm:block">
              Optical signal
              <br />
              Conjunctiva / live
            </div>

            <div className="home-guide-frame relative flex aspect-square w-[min(78vw,26rem)] items-center justify-center border border-primary/25 bg-background/70 p-8 shadow-[0_0_80px_-35px_var(--primary)] backdrop-blur-sm sm:p-12 lg:w-[30rem]">
              <div className="absolute inset-4 border border-border" />
              <span className="absolute top-1/2 left-0 h-px w-8 bg-primary" />
              <span className="absolute top-1/2 right-0 h-px w-8 bg-primary" />
              <span className="absolute top-0 left-1/2 h-8 w-px bg-primary" />
              <span className="absolute bottom-0 left-1/2 h-8 w-px bg-primary" />
              <EyeGuide ready decorative className="relative h-full w-full" />
              <span className="absolute bottom-5 left-5 text-2xs tracking-[0.2em] text-primary uppercase">
                Ready to capture
              </span>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ---------------------------------------------------------------- 2 */}
      <section
        aria-labelledby="continuity-heading"
        className="w-full border-t border-border/70 bg-card/25"
      >
        <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-10 lg:py-14">
          {/* A real h2, not just an aria-label: the cards below use CardTitle,
              which renders an h3, so without this the outline jumped h1 -> h3. */}
          <h2 id="continuity-heading" className="sr-only">
            {hasHistory ? 'Your most recent scan' : 'Getting started'}
          </h2>
          {hasHistory ? (
            <LastScanBand history={history} onStart={onStart} onViewHistory={onViewHistory} />
          ) : (
            <FirstRunBand onStart={onStart} onLearn={onLearn} />
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- 3 */}
      <HeroShowcase className="border-t border-border/70" />

      {/* ---------------------------------------------------------------- 4 */}
      <section
        aria-labelledby="steps-heading"
        className="w-full border-t border-border/70 bg-card/25 py-16 lg:py-24"
      >
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-10">
          <div className="flex max-w-2xl flex-col gap-3">
            <span className="text-2xs font-medium tracking-[0.22em] text-primary uppercase">
              Three steps / 03
            </span>
            <h2 id="steps-heading" className="display text-display-sm text-foreground sm:text-display">
              Capture, analyse, screen
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Just your camera and a free account. The whole sequence happens between opening the
              camera and reading the result.
            </p>
          </div>

          <ol className="relative mt-12 grid gap-px overflow-hidden rounded-3xl border border-border bg-border lg:grid-cols-3">
            {STEPS.map(({ index, icon: Icon, title, body, outcome }) => (
              <li key={title} className="card-hover flex flex-col gap-4 bg-card px-6 py-8 lg:px-8 lg:py-10">
                <div className="flex items-center justify-between gap-4">
                  <span className="inline-flex size-11 items-center justify-center rounded-chip border border-primary/30 bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span
                    aria-hidden="true"
                    className="metric text-display-sm leading-none text-muted-foreground/35"
                  >
                    {index}
                  </span>
                </div>

                <h3 className="text-sm font-semibold tracking-[0.14em] text-foreground uppercase">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>

                <p className="mt-auto flex items-start gap-2 border-t border-border/70 pt-4 text-xs leading-relaxed text-foreground/80">
                  <CircleCheck className="mt-px size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {outcome}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- 5 */}
      <TrustStrip />

      {/* ---------------------------------------------------------------- 6 */}
      <Faq onLearn={onLearn} />

      {/* ---------------------------------------------------------------- 7 */}
      <section
        aria-labelledby="closing-heading"
        className="home-hero relative isolate overflow-hidden border-t border-border/70"
      >
        <div
          aria-hidden="true"
          className="animate-aurora pointer-events-none absolute inset-0 opacity-60"
        />
        <div className="grain pointer-events-none absolute inset-0" />

        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center lg:px-10 lg:py-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-2xs font-medium tracking-[0.18em] text-primary uppercase">
            <Eye className="size-3.5" aria-hidden="true" />
            Ready when you are
          </span>

          <h2
            id="closing-heading"
            className="display text-display-sm text-balance text-foreground sm:text-display-lg"
          >
            Half a minute now, a real answer sooner
          </h2>

          <p className="max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
            Anaemia is common, quietly draining and very treatable once it is found. A screen will
            not find it for you — but it can be the reason you finally book the blood test that
            does.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button size="lg" onClick={onStart} className="h-12 rounded-full px-7 text-base">
              Begin a scan
              <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={onLearn}
              className="h-12 rounded-full px-6 text-base"
            >
              Learn about conjunctival pallor
            </Button>
          </div>
        </div>
      </section>

      <footer className="w-full border-t border-border/70 bg-card/30">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <p className="max-w-2xl text-2xs leading-relaxed text-muted-foreground">
            AnemiaScan is an educational screening aid that estimates risk from the colour of the
            palpebral conjunctiva. It is not a diagnosis, not a haemoglobin measurement and not a
            medical device. Never delay or replace professional care because of a result here.
          </p>
          <nav aria-label="Home footer" className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onLearn}
              className="rounded-full px-3 text-muted-foreground"
            >
              Learn
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewHistory}
              className="rounded-full px-3 text-muted-foreground"
            >
              History
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onStart}
              className="rounded-full px-3 text-primary"
            >
              Scan
            </Button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
