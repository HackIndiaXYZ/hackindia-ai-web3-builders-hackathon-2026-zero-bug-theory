/* --------------------------------------------------------------------------
 * RiskGauge — the hero readout for a screening score.
 * --------------------------------------------------------------------------
 * A 270° radial arc drawn in a unit viewBox, so it stays crisp at any `size`.
 * The arc is a single path stroked twice (track + value); the value stroke is
 * revealed with `stroke-dasharray`, driven by the same animated number the
 * centre label prints. One source of truth, so the ring and the digits can
 * never disagree.
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
import { clamp } from '@/src/lib/format'
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

/** The two band thresholds the analyser uses, as a fraction of the sweep. */
const BAND_TICKS = [0.35, 0.65] as const

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

/* -------------------------------------------------------------------------- */
/* Animated number                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Eases a number toward `target` with requestAnimationFrame.
 * When `animate` is false it snaps, which is what reduced-motion users get.
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
  /** 0..100 screening score. Clamped. */
  score: number
  level: RiskLevel
  /** Rendered edge length in px. Typography scales with it. */
  size?: number
  className?: string
}

export function RiskGauge({ score, level, size = 240, className }: RiskGaugeProps) {
  const reduceMotion = useReducedMotion() ?? false
  const target = Math.round(clamp(score, 0, 100))
  const animated = useCountUp(target, !reduceMotion)

  const token = riskColorToken(level)
  const tone = riskClasses(token)
  const gradientId = useId()

  const fraction = clamp(animated, 0, 100) / 100
  const shown = Math.round(animated)
  const track = arcPath(RADIUS)

  // typography scales off `size` so a 120px chip and a 280px hero both read well
  const numberSize = Math.max(22, Math.round(size * 0.235))
  const unitSize = Math.max(10, Math.round(size * 0.072))
  const levelSize = Math.max(10, Math.min(15, Math.round(size * 0.063)))
  const captionSize = Math.max(9, Math.min(11, Math.round(size * 0.046)))

  return (
    <div
      role="img"
      aria-label={`Screening score ${target} out of 100 — ${level}. Higher scores mean more anaemia-like signals in the capture.`}
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
          strokeLinecap="round"
          strokeWidth={TRACK_WIDTH}
          className="stroke-muted"
        />

        {/* band threshold ticks — where Low becomes Moderate becomes Elevated */}
        {BAND_TICKS.map((t) => {
          const angle = START_ANGLE + SWEEP * t
          const inner = polar(angle, RADIUS - TRACK_WIDTH / 2 - 0.2)
          const outer = polar(angle, RADIUS + TRACK_WIDTH / 2 + 0.2)
          return (
            <line
              key={t}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              strokeWidth={1.4}
              strokeLinecap="round"
              className="stroke-background/90"
            />
          )
        })}

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
      </svg>

      {/* centre readout — real, selectable text rather than <text> in the SVG */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-[18%] text-center">
        <span
          className="text-2xs font-medium tracking-[0.16em] text-muted-foreground uppercase"
          style={{ fontSize: captionSize }}
        >
          Score
        </span>
        <span className={cn('metric flex items-baseline font-semibold', tone.text)}>
          <span style={{ fontSize: numberSize, lineHeight: 1 }}>{shown}</span>
          <span
            className="pl-0.5 font-medium text-muted-foreground"
            style={{ fontSize: unitSize, lineHeight: 1 }}
          >
            /100
          </span>
        </span>
        <span
          className={cn('font-semibold tracking-tight text-balance', tone.text)}
          style={{ fontSize: levelSize, lineHeight: 1.2 }}
        >
          {level}
        </span>
      </div>
    </div>
  )
}
