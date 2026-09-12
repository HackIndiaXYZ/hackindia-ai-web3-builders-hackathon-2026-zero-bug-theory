/* --------------------------------------------------------------------------
 * RiskGauge — the hero readout for a calibrated screening probability.
 * --------------------------------------------------------------------------
 * A 270° radial arc drawn in a unit viewBox, so it stays crisp at any `size`.
 * The arc is a single path stroked repeatedly (track + zones + value); the
 * value stroke is revealed with `stroke-dasharray`, driven by the same animated
 * number the centre label prints. One source of truth, so the ring and the
 * digits can never disagree.
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 * ---------------------------------
 * This gauge used to plot a 0–100 "score" from a local colour heuristic and
 * marked its band edges at 0.35 and 0.65 of the sweep. Those numbers belonged
 * to a heuristic that no longer exists, and they were actively misleading next
 * to a real model result: the model's operating threshold is ≈0.2076, so a
 * calibrated probability of 0.25 — a `higher_risk` decision — drew deep inside
 * the old "low" arc while the label underneath said otherwise.
 *
 * The axis is now the probability itself, 0 at the start of the sweep and 1 at
 * the end, and the only marks on it are real: the operating threshold, the
 * uncertainty margin around it, and a muted tick at 0.50 that exists purely to
 * show the threshold is NOT a coin flip. Everything the ring asserts is a
 * number the server sent.
 *
 * Colour comes exclusively from the risk tokens via `riskClasses`, so the
 * gauge re-tints itself in light and dark without any per-theme branching.
 *
 * Motion: the count-up and the arc sweep are skipped entirely under
 * `prefers-reduced-motion` — the gauge renders at its final value on the
 * first paint instead.
 * -------------------------------------------------------------------------- */

import { useEffect, useId, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'
import { clamp, formatProbability } from '@/src/lib/format'
import { riskClasses, riskColorToken } from '@/src/lib/risk-style'
import type { RiskLevel } from '@/src/lib/types'

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

const VB = 100
const CENTRE = VB / 2
const RADIUS = 39
const TRACK_WIDTH = 7
/** Degrees, measured clockwise on screen. 135° is bottom-left, +270° ends bottom-right. */
const START_ANGLE = 135
const SWEEP = 270
/** Length of the 270° arc in user units — the dash cycle for the value stroke. */
const ARC_LENGTH = 2 * Math.PI * RADIUS * (SWEEP / 360)

/**
 * A reference mark at p = 0.50, drawn muted and unlabelled.
 *
 * It is here for one reason: people read any probability gauge as though the
 * midpoint were the decision boundary. Showing where the midpoint actually is,
 * next to a threshold sitting far below it, makes the sensitivity tuning
 * visible without a sentence of explanation.
 */
const MIDPOINT = 0.5

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CENTRE + radius * Math.cos(rad), y: CENTRE + radius * Math.sin(rad) }
}

function arcPath(radius: number): string {
  const start = polar(START_ANGLE, radius)
  const end = polar(START_ANGLE + SWEEP, radius)
  const largeArc = SWEEP > 180 ? 1 : 0
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`
}

/**
 * Dash attributes that reveal only the [from, to] slice of the arc, where both
 * bounds are fractions of the full sweep.
 */
function arcSlice(from: number, to: number): { strokeDasharray: string; strokeDashoffset: number } {
  const a = clamp(from, 0, 1)
  const b = clamp(to, 0, 1)
  const length = Math.max(0, b - a) * ARC_LENGTH
  return {
    strokeDasharray: `${length.toFixed(3)} ${ARC_LENGTH.toFixed(3)}`,
    strokeDashoffset: -(a * ARC_LENGTH),
  }
}

/* -------------------------------------------------------------------------- */
/* Animated number                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Eases a number toward `target` with requestAnimationFrame.
 * When `animate` is false it snaps, which is what reduced-motion users get.
 *
 * Callers pass the value in per-mille (0..1000) rather than 0..1, because the
 * "already close enough, just snap" test below is in the target's own units and
 * every 0..1 probability would clear it on the first frame.
 */
function useCountUp(target: number, animate: boolean, duration = 950): number {
  const [display, setDisplay] = useState(() => (animate ? 0 : target))
  const currentRef = useRef(animate ? 0 : target)

  useEffect(() => {
    const canAnimate = animate && typeof requestAnimationFrame === 'function'

    if (!canAnimate || Math.abs(target - currentRef.current) < 0.5) {
      currentRef.current = target
      setDisplay(target)
      return
    }

    const from = currentRef.current
    let frame = 0
    let startTs = 0

    const tick = (ts: number) => {
      if (!startTs) startTs = ts
      const t = clamp((ts - startTs) / duration, 0, 1)
      // cubic ease-out: fast commitment, gentle settle
      const eased = 1 - Math.pow(1 - t, 3)
      const next = from + (target - from) * eased
      currentRef.current = next
      setDisplay(next)
      if (t < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, animate, duration])

  return display
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface RiskGaugeProps {
  /** The calibrated screening probability, 0..1. Clamped. */
  probability: number
  /** The operating threshold this decision was made against, 0..1. */
  threshold: number
  /** Half-width of the uncertainty band either side of the threshold, 0..1. */
  uncertaintyMargin?: number
  level: RiskLevel
  /** Rendered edge length in px. Typography scales with it. */
  size?: number
  className?: string
}

export function RiskGauge({
  probability,
  threshold,
  uncertaintyMargin = 0,
  level,
  size = 240,
  className,
}: RiskGaugeProps) {
  const reduceMotion = useReducedMotion() ?? false
  const value = clamp(probability, 0, 1)
  const cut = clamp(threshold, 0, 1)
  const margin = clamp(uncertaintyMargin, 0, 1)
  const animated = useCountUp(Math.round(value * 1000), !reduceMotion)

  const token = riskColorToken(level)
  const tone = riskClasses(token)
  const gradientId = useId()

  const fraction = clamp(animated / 1000, 0, 1)
  const shown = formatProbability(fraction)
  const track = arcPath(RADIUS)

  const bandLow = clamp(cut - margin, 0, 1)
  const bandHigh = clamp(cut + margin, 0, 1)

  // typography scales off `size` so a 120px chip and a 280px hero both read well
  const numberSize = Math.max(20, Math.round(size * 0.2))
  const levelSize = Math.max(10, Math.min(15, Math.round(size * 0.063)))
  const captionSize = Math.max(9, Math.min(11, Math.round(size * 0.044)))

  return (
    <div
      role="img"
      aria-label={`Calibrated screening probability ${formatProbability(value)} on a scale of 0 to 1, against an operating threshold of ${formatProbability(
        cut,
      )}. Decision: ${level}. The threshold is tuned for sensitivity, so it sits well below 0.5 — it is not a midpoint.`}
      className={cn('relative shrink-0 select-none', className)}
      style={{ width: size, height: size, maxWidth: '100%' }}
    >
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* unfilled track */}
        <path
          d={track}
          fill="none"
          strokeLinecap="butt"
          strokeWidth={TRACK_WIDTH}
          className="stroke-muted"
        />

        {/* the zone at or above the threshold — where a reading is called higher risk */}
        <path
          d={track}
          fill="none"
          strokeLinecap="butt"
          strokeWidth={TRACK_WIDTH}
          className="stroke-risk/20"
          {...arcSlice(cut, 1)}
        />

        {/* the uncertainty margin either side of it — where the model declines to call it */}
        <path
          d={track}
          fill="none"
          strokeLinecap="butt"
          strokeWidth={TRACK_WIDTH}
          className="stroke-moderate/30"
          {...arcSlice(bandLow, bandHigh)}
        />

        {/* muted midpoint reference: 0.50 is NOT the decision boundary */}
        {(() => {
          const angle = START_ANGLE + SWEEP * MIDPOINT
          const inner = polar(angle, RADIUS - TRACK_WIDTH / 2)
          const outer = polar(angle, RADIUS + TRACK_WIDTH / 2)
          return (
            <line
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              strokeWidth={1}
              className="stroke-muted-foreground/45"
              strokeDasharray="1.5 1.5"
            />
          )
        })()}

        {/* soft halo behind the value arc */}
        <g className={tone.text}>
          <path
            d={track}
            fill="none"
            strokeLinecap="round"
            strokeWidth={TRACK_WIDTH + 7}
            stroke="currentColor"
            opacity={0.14}
            strokeDasharray={`${(ARC_LENGTH * fraction).toFixed(3)} ${ARC_LENGTH.toFixed(3)}`}
          />
          <path
            d={track}
            fill="none"
            strokeLinecap="round"
            strokeWidth={TRACK_WIDTH}
            stroke={`url(#${gradientId})`}
            strokeDasharray={`${(ARC_LENGTH * fraction).toFixed(3)} ${ARC_LENGTH.toFixed(3)}`}
          />
        </g>

        {/* the operating threshold, drawn last so nothing paints over it */}
        {(() => {
          const angle = START_ANGLE + SWEEP * cut
          const inner = polar(angle, RADIUS - TRACK_WIDTH / 2 - 2.6)
          const outer = polar(angle, RADIUS + TRACK_WIDTH / 2 + 2.6)
          return (
            <line
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              strokeWidth={2}
              strokeLinecap="round"
              className="stroke-foreground"
            />
          )
        })()}
      </svg>

      {/* centre readout — real, selectable text rather than <text> in the SVG */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-[16%] text-center">
        <span
          className="font-medium tracking-[0.14em] text-muted-foreground uppercase"
          style={{ fontSize: captionSize, lineHeight: 1.3 }}
        >
          Probability
        </span>
        <span
          className={cn('metric font-semibold', tone.text)}
          style={{ fontSize: numberSize, lineHeight: 1.05 }}
        >
          {shown}
        </span>
        <span
          className={cn('font-semibold tracking-tight text-balance', tone.text)}
          style={{ fontSize: levelSize, lineHeight: 1.2 }}
        >
          {level}
        </span>
        <span
          className="text-muted-foreground tabular-nums"
          style={{ fontSize: captionSize, lineHeight: 1.3 }}
        >
          threshold {formatProbability(cut)}
        </span>
      </div>
    </div>
  )
}
