/* --------------------------------------------------------------------------
 * SignalBars — the explainability primitive.
 * --------------------------------------------------------------------------
 * Renders `SignalBreakdown[]` as a ranked set of meters, ordered by how much
 * each signal actually pushed the blended score (weight × concern), not by the
 * raw reading.
 *
 * The five signals do NOT share a polarity — a high `pallor` reading is the
 * concerning direction while a high reading on the other four is reassuring —
 * so every row states its direction explicitly and is tinted by concern rather
 * than by magnitude. Getting that wrong would be actively misleading, which is
 * why `signalConcern` lives here as the single place the polarity is encoded.
 *
 * Each row's plain-language hint opens on hover or focus and can be pinned open
 * by click / Enter / Space; the meter itself is an accessible progressbar via
 * the shared `Progress` primitive.
 * -------------------------------------------------------------------------- */

import { useId, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown, Minus, TrendingDown, TrendingUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { clamp } from '@/src/lib/format'
import type { RiskToken } from '@/src/lib/risk-style'
import type { SignalBreakdown, SignalKey } from '@/src/lib/types'

/* -------------------------------------------------------------------------- */
/* Polarity + ranking                                                         */
/* -------------------------------------------------------------------------- */

/** Signals where a HIGH reading is the concerning direction. */
const HIGH_IS_CONCERNING: ReadonlySet<SignalKey> = new Set<SignalKey>(['pallor'])

/**
 * Convert a raw 0..100 reading into 0..100 "concern", matching the polarity the
 * analyser blends with: pallor rises with concern, the other four fall with it.
 */
export function signalConcern(signal: SignalBreakdown): number {
  const value = clamp(signal.value, 0, 100)
  return HIGH_IS_CONCERNING.has(signal.key) ? value : 100 - value
}

function toneForConcern(concern: number): RiskToken {
  if (concern >= 62) return 'risk'
  if (concern >= 38) return 'moderate'
  return 'safe'
}

export interface RankedSignal {
  signal: SignalBreakdown
  /** 0..100 — how far this reading sits in the concerning direction. */
  concern: number
  /** Approximate points this signal added to the blended score. */
  points: number
  tone: RiskToken
  /** True when a high reading is the worrying one. */
  highIsConcerning: boolean
}

/** Sort by contribution to the score (weight × concern), strongest first. */
export function rankSignals(signals: SignalBreakdown[]): RankedSignal[] {
  return signals
    .map((signal) => {
      const concern = signalConcern(signal)
      const weight = clamp(signal.weight, 0, 1)
      return {
        signal,
        concern,
        points: Math.round(weight * concern),
        tone: toneForConcern(concern),
        highIsConcerning: HIGH_IS_CONCERNING.has(signal.key),
      }
    })
    .sort((a, b) => {
      const byPoints = b.points - a.points
      if (byPoints !== 0) return byPoints
      return b.signal.weight - a.signal.weight
    })
}

function readingWord(concern: number): string {
  if (concern >= 62) return 'Needs attention'
  if (concern >= 38) return 'Borderline'
  return 'Reassuring'
}

const TONE_TEXT: Record<RiskToken, string> = {
  risk: 'text-risk',
  moderate: 'text-moderate',
  safe: 'text-safe',
}

const TONE_CHIP: Record<RiskToken, string> = {
  risk: 'border-risk/25 bg-risk/10 text-risk',
  moderate: 'border-moderate/25 bg-moderate/10 text-moderate-strong',
  safe: 'border-safe/25 bg-safe/10 text-safe',
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function SignalRow({
  ranked,
  rank,
  open,
  pinned,
  reduceMotion,
  onPinnedChange,
  onHoverChange,
}: {
  ranked: RankedSignal
  rank: number
  /** Visually revealed — pinned, hovered or focused. */
  open: boolean
  /** Explicitly pinned by the user. This, and only this, is `aria-expanded`. */
  pinned: boolean
  reduceMotion: boolean
  onPinnedChange: (pinned: boolean) => void
  onHoverChange: (hovering: boolean) => void
}) {
  const { signal, concern, points, tone, highIsConcerning } = ranked
  const hintId = useId()
  const value = Math.round(clamp(signal.value, 0, 100))
  const weightPct = Math.round(clamp(signal.weight, 0, 1) * 100)
  const DirectionIcon = highIsConcerning ? TrendingUp : TrendingDown

  return (
    <li
      className={cn(
        'rounded-2xl border border-border bg-card/60 px-3.5 py-3 transition-colors sm:px-4',
        open && 'border-border/80 bg-muted/35',
      )}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      {/* `aria-expanded` tracks `pinned`, never the hover/focus reveal. Driving
          it from `open` meant a pointer resting on the row already forced it
          true, so the first click reported (and performed) a collapse, and the
          attribute never changed while the pointer stayed put. Hover and focus
          only affect the visual reveal — they no longer mutate expanded state. */}
      <button
        type="button"
        aria-expanded={pinned}
        aria-controls={hintId}
        onClick={() => onPinnedChange(!pinned)}
        onFocus={() => onHoverChange(true)}
        onBlur={() => onHoverChange(false)}
        className="ring-focus -m-1 flex w-full items-start gap-3 rounded-xl p-1 text-left"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[0.625rem] font-semibold text-muted-foreground tabular-nums"
        >
          {rank}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{signal.label}</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold',
                TONE_CHIP[tone],
              )}
            >
              <DirectionIcon className="size-2.5" aria-hidden="true" />
              {readingWord(concern)}
            </span>
          </span>
          <span className="text-2xs text-muted-foreground">
            {highIsConcerning ? 'Higher is concerning' : 'Higher is reassuring'} · weight{' '}
            <span className="tabular-nums">{weightPct}%</span> · adds ≈
            <span className="tabular-nums">{points}</span> pts
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn('metric text-sm font-semibold', TONE_TEXT[tone])}>{value}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 text-muted-foreground transition-transform duration-300',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>

      <Progress
        value={value}
        tone={tone}
        label={`${signal.label} reading`}
        className="mt-2.5 h-1.5"
      />

      {/* A single always-mounted panel: clipped when closed, so the hint text
          stays reachable by assistive tech without duplicating the node. */}
      <motion.div
        id={hintId}
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.26, ease: 'easeOut' }}
        className="overflow-hidden"
      >
        <p className="pt-2.5 text-xs leading-relaxed text-pretty text-muted-foreground">
          {signal.hint}
        </p>
      </motion.div>

    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface SignalBarsProps {
  signals: SignalBreakdown[]
  className?: string
}

export function SignalBars({ signals, className }: SignalBarsProps) {
  const reduceMotion = useReducedMotion() ?? false
  const ranked = useMemo(() => rankSignals(signals), [signals])
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [hovered, setHovered] = useState<string | null>(null)

  if (!ranked.length) {
    return (
      <p
        className={cn(
          'rounded-2xl border border-dashed border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        No signal readings were recorded for this scan.
      </p>
    )
  }

  const allPinned = pinned.size === ranked.length

  const togglePin = (key: string, next: boolean) => {
    setPinned((current) => {
      const draft = new Set(current)
      if (next) draft.add(key)
      else draft.delete(key)
      return draft
    })
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ol className="flex list-none flex-col gap-2.5">
        {ranked.map((item, index) => (
          <SignalRow
            key={item.signal.key}
            ranked={item}
            rank={index + 1}
            open={pinned.has(item.signal.key) || hovered === item.signal.key}
            pinned={pinned.has(item.signal.key)}
            reduceMotion={reduceMotion}
            onPinnedChange={(next) => togglePin(item.signal.key, next)}
            onHoverChange={(hovering) =>
              setHovered((current) =>
                hovering ? item.signal.key : current === item.signal.key ? null : current,
              )
            }
          />
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Minus className="size-3" aria-hidden="true" />
          Ranked by contribution to the score
        </p>
        <button
          type="button"
          onClick={() =>
            setPinned(
              allPinned ? new Set<string>() : new Set(ranked.map((item) => item.signal.key)),
            )
          }
          className="ring-focus rounded-full border border-border bg-background/60 px-2.5 py-2 text-2xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {allPinned ? 'Hide explanations' : 'Explain every signal'}
        </button>
      </div>
    </div>
  )
}
