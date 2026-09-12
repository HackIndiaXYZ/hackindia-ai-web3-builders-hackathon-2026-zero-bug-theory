/* --------------------------------------------------------------------------
 * TrendChart — hand-rolled inline SVG for screening probability over time.
 * --------------------------------------------------------------------------
 * No charting library: a measured container, a linear scale, one path for the
 * line and one for the area. The container width is observed so the chart can
 * be drawn in real pixel units — that keeps stroke weights and label sizes
 * identical at 390px and at 1280px, which a scaled viewBox cannot do.
 * A viewBox + preserveAspectRatio are still declared so the very first paint
 * (before measurement) is correctly proportioned rather than collapsed.
 *
 * The y-axis is the CALIBRATED SCREENING PROBABILITY, 0 to 1. It used to be the
 * 0–100 score of a local colour heuristic, shaded into three bands at 35 and 65
 * — numbers that belonged to a heuristic which no longer exists. The shading is
 * now the model's real decision geometry: the operating threshold, and the
 * uncertainty margin either side of it inside which the model declines to call
 * a result. When no scan in the series carries a threshold, nothing is shaded:
 * an unlabelled axis is better than an invented boundary.
 *
 * Interaction: every point is a real <button> in an overlay, so hover, tap,
 * Tab, and Arrow keys all reach the same readout. The visible readout is
 * decorative (aria-hidden) because each button already carries the full
 * description as its accessible name.
 * -------------------------------------------------------------------------- */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { clamp, formatDateTime, formatProbability, formatRelativeTime } from '@/src/lib/format'
import { riskColorToken } from '@/src/lib/risk-style'
import type { RiskToken } from '@/src/lib/risk-style'
import type { ScanAnalysis } from '@/src/lib/types'

/* -------------------------------------------------------------------------- */
/* Layout constants                                                           */
/* -------------------------------------------------------------------------- */

const PAD = { top: 14, right: 14, bottom: 26, left: 34 } as const
const FALLBACK_WIDTH = 360

const POINT_FILL: Record<RiskToken, string> = {
  risk: 'fill-risk',
  moderate: 'fill-moderate',
  safe: 'fill-safe',
}

const DOT_BG: Record<RiskToken, string> = {
  risk: 'bg-risk',
  moderate: 'bg-moderate',
  safe: 'bg-safe',
}

const TEXT_TONE: Record<RiskToken, string> = {
  risk: 'text-risk',
  moderate: 'text-moderate',
  safe: 'text-safe',
}

/* -------------------------------------------------------------------------- */
/* Reading the series                                                         */
/* -------------------------------------------------------------------------- */

/** The headline probability for one scan, read defensively. */
function probabilityOf(scan: ScanAnalysis): number {
  const direct = Number(scan.screeningProbability)
  if (Number.isFinite(direct)) return clamp(direct, 0, 1)
  const fromModel = Number(scan.modelOutput?.screeningProbability)
  return Number.isFinite(fromModel) ? clamp(fromModel, 0, 1) : 0
}

/**
 * The decision geometry to shade behind the series.
 *
 * Taken from the most recent scan that carries one, because the threshold is a
 * property of the model version that scored a scan and could in principle move
 * between releases. Returns null when nothing in the series has one — in which
 * case the chart draws no bands at all rather than guessing a boundary.
 */
function decisionGeometry(
  series: ScanAnalysis[],
): { threshold: number; margin: number } | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const threshold = Number(series[index].modelOutput?.operatingThreshold)
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) continue
    const rawMargin = Number(series[index].modelOutput?.uncertaintyMargin)
    const margin = Number.isFinite(rawMargin) ? clamp(rawMargin, 0, 1) : 0
    return { threshold, margin }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Measurement                                                                */
/* -------------------------------------------------------------------------- */

function useMeasuredWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const read = () => setWidth(node.getBoundingClientRect().width)
    read()

    if (typeof ResizeObserver === 'undefined') {
      if (typeof window === 'undefined') return
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }

    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])

  return width > 0 ? width : FALLBACK_WIDTH
}

/** '12 Mar 2026, 14:32' -> '12 Mar 2026' */
function dayLabel(epochMs: number): string {
  return formatDateTime(epochMs).split(',')[0]
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyTrend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-5 py-9 text-center',
        className,
      )}
    >
      <svg
        viewBox="0 0 120 44"
        className="h-11 w-28 text-muted-foreground/45"
        role="img"
        aria-label="An empty trend line, waiting for your first scans"
      >
        <path
          d="M4 34 C 22 30, 30 14, 48 18 S 74 34, 92 12 L 116 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="4 5"
        />
      </svg>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">No trend yet</p>
        <p className="mx-auto max-w-xs text-xs leading-relaxed text-balance text-muted-foreground">
          A single scan is a snapshot. Two or three, taken days apart in similar light, start to
          show a direction — and direction is the part worth acting on.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface TrendChartProps {
  /** Newest-first history, exactly as `loadHistory()` returns it. */
  items: ScanAnalysis[]
  className?: string
}

export function TrendChart({ items, className }: TrendChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const areaGradientId = useId()
  const width = useMeasuredWidth(wrapRef)
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [active, setActive] = useState<number | null>(null)

  // oldest -> newest, so time runs left to right
  const series = useMemo(
    () => [...items].sort((a, b) => a.createdAt - b.createdAt),
    [items],
  )

  const geometry = useMemo(() => decisionGeometry(series), [series])

  const height = Math.round(clamp(width * 0.5, 172, 240))
  const plotW = Math.max(1, width - PAD.left - PAD.right)
  const plotH = Math.max(1, height - PAD.top - PAD.bottom)

  const xFor = useCallback(
    (index: number) =>
      series.length <= 1
        ? PAD.left + plotW / 2
        : PAD.left + (index / (series.length - 1)) * plotW,
    [series.length, plotW],
  )
  const yFor = useCallback(
    (probability: number) => PAD.top + (1 - clamp(probability, 0, 1)) * plotH,
    [plotH],
  )

  const points = useMemo(
    () =>
      series.map((scan, index) => ({
        scan,
        probability: probabilityOf(scan),
        x: xFor(index),
        y: yFor(probabilityOf(scan)),
        token: riskColorToken(scan.riskLevel),
      })),
    [series, xFor, yFor],
  )

  const focusPoint = useCallback((index: number) => {
    const target = buttonRefs.current[index]
    if (target) target.focus()
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = points.length - 1
      let next: number | null = null
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(last, index + 1)
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, index - 1)
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = last
      if (next === null || next === index) return
      event.preventDefault()
      setActive(next)
      focusPoint(next)
    },
    [points.length, focusPoint],
  )

  if (!series.length) return <EmptyTrend className={className} />

  const shownIndex = active !== null && active < points.length ? active : points.length - 1
  const shown = points[shownIndex]
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(PAD.top + plotH).toFixed(2)} L ${points[0].x.toFixed(2)} ${(PAD.top + plotH).toFixed(2)} Z`
      : ''
  const spacing = points.length > 1 ? plotW / (points.length - 1) : plotW
  const hitSize = Math.round(clamp(spacing, 20, 36))
  const pointRadius = points.length > 16 ? 2.6 : points.length > 8 ? 3.2 : 4

  const uncertainFloor = geometry ? clamp(geometry.threshold - geometry.margin, 0, 1) : 0
  const uncertainCeiling = geometry ? clamp(geometry.threshold + geometry.margin, 0, 1) : 0

  /* Bands are only drawn when the series actually carries a threshold. Each is
     a real region of the decision rule, not a presentational band. */
  const bands = geometry
    ? [
        { key: 'higher', from: uncertainCeiling, to: 1, className: 'fill-risk/10' },
        {
          key: 'uncertain',
          from: uncertainFloor,
          to: uncertainCeiling,
          className: 'fill-moderate/14',
        },
        { key: 'lower', from: 0, to: uncertainFloor, className: 'fill-safe/10' },
      ]
    : []

  /* Axis ticks: the ends, the real threshold, and 0.50 — the last of these so a
     reader can see that the decision boundary is nowhere near the midpoint. */
  const ticks = Array.from(
    new Set([0, ...(geometry ? [geometry.threshold] : []), 0.5, 1]),
  ).sort((a, b) => a - b)

  return (
    <figure className={cn('m-0 flex flex-col gap-3', className)}>
      {/* readout — duplicates the focused point's accessible name, so hidden */}
      <figcaption
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
      >
        <span className="flex items-baseline gap-2">
          <span className={cn('metric text-xl font-semibold', TEXT_TONE[shown.token])}>
            {formatProbability(shown.probability)}
          </span>
          <span className="text-xs font-medium text-foreground">{shown.scan.riskLevel}</span>
        </span>
        <span className="text-2xs text-muted-foreground">
          {formatRelativeTime(shown.scan.createdAt)} · {dayLabel(shown.scan.createdAt)}
          {shownIndex === points.length - 1 ? ' · latest' : ''}
        </span>
      </figcaption>

      <div ref={wrapRef} className="relative w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height={height}
          className="block"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* decision zones */}
          {bands.map((band) => {
            const top = yFor(band.to)
            const bottom = yFor(band.from)
            return (
              <rect
                key={band.key}
                x={PAD.left}
                y={top}
                width={plotW}
                height={Math.max(0, bottom - top)}
                className={band.className}
              />
            )
          })}

          {/* axis gridlines + labels */}
          {ticks.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                y1={yFor(value)}
                x2={PAD.left + plotW}
                y2={yFor(value)}
                className={
                  geometry && value === geometry.threshold ? 'stroke-foreground/45' : 'stroke-border'
                }
                strokeWidth={1}
                strokeDasharray={value === 0 || value === 1 ? undefined : '3 4'}
              />
              <text
                x={PAD.left - 6}
                y={yFor(value) + 3.5}
                textAnchor="end"
                fontSize={10}
                className="fill-muted-foreground"
              >
                {value === 0 || value === 1 ? value.toFixed(0) : value.toFixed(2)}
              </text>
            </g>
          ))}

          {/* area + line */}
          <g className="text-primary">
            {areaPath ? <path d={areaPath} fill={`url(#${areaGradientId})`} /> : null}
            {points.length > 1 ? (
              <path
                d={linePath}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </g>

          {/* active guide */}
          <line
            x1={shown.x}
            y1={PAD.top}
            x2={shown.x}
            y2={PAD.top + plotH}
            className="stroke-foreground/25"
            strokeWidth={1}
            strokeDasharray="2 3"
          />

          {/* points */}
          {points.map((point, index) => (
            <g key={point.scan.id}>
              <circle
                cx={point.x}
                cy={point.y}
                r={index === shownIndex ? pointRadius + 3.5 : 0}
                className={cn(POINT_FILL[point.token], 'opacity-25')}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={index === shownIndex ? pointRadius + 1 : pointRadius}
                className={POINT_FILL[point.token]}
                stroke="var(--card)"
                strokeWidth={1.5}
              />
            </g>
          ))}

          {/* x extremes */}
          <text
            x={PAD.left}
            y={height - 8}
            fontSize={10}
            textAnchor="start"
            className="fill-muted-foreground"
          >
            {dayLabel(series[0].createdAt)}
          </text>
          {series.length > 1 ? (
            <text
              x={PAD.left + plotW}
              y={height - 8}
              fontSize={10}
              textAnchor="end"
              className="fill-muted-foreground"
            >
              {dayLabel(series[series.length - 1].createdAt)}
            </text>
          ) : null}
        </svg>

        {/* keyboard- and pointer-reachable hit targets, one per point */}
        <div
          role="group"
          aria-label={`Calibrated screening probability over time, ${series.length} ${
            series.length === 1 ? 'scan' : 'scans'
          }. Use the arrow keys to move between scans.`}
          className="absolute inset-0"
        >
          {points.map((point, index) => (
            <button
              key={point.scan.id}
              ref={(node) => {
                buttonRefs.current[index] = node
              }}
              type="button"
              onFocus={() => setActive(index)}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive((current) => (current === index ? null : current))}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className="ring-focus absolute rounded-full"
              style={{
                left: `${(point.x / width) * 100}%`,
                top: `${(point.y / height) * 100}%`,
                width: hitSize,
                height: hitSize,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <span className="sr-only">
                {`${dayLabel(point.scan.createdAt)} — screening probability ${formatProbability(
                  point.probability,
                )}, ${point.scan.riskLevel}, ${formatRelativeTime(point.scan.createdAt)}`}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* legend — the real decision rule, or an honest note that it is unknown */}
      {geometry ? (
        <ul className="flex list-none flex-wrap items-center gap-x-4 gap-y-1.5">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2 rounded-full', DOT_BG.risk)} />
            <span className="text-2xs text-muted-foreground">
              Higher risk ≥ {formatProbability(geometry.threshold)}
            </span>
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2 rounded-full', DOT_BG.moderate)} />
            <span className="text-2xs text-muted-foreground">
              Uncertain {formatProbability(uncertainFloor)}–{formatProbability(uncertainCeiling)}
            </span>
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2 rounded-full', DOT_BG.safe)} />
            <span className="text-2xs text-muted-foreground">
              Lower risk &lt; {formatProbability(uncertainFloor)}
            </span>
          </li>
        </ul>
      ) : (
        <p className="text-2xs leading-relaxed text-muted-foreground">
          These scans carry no operating threshold, so no decision boundary is drawn.
        </p>
      )}

      <p className="text-2xs leading-relaxed text-muted-foreground">
        {series.length === 1
          ? 'One scan recorded. Scan again in a few days, in similar light, to turn this point into a trend.'
          : 'Each point is the calibrated screening probability the model returned for that capture — not a haemoglobin measurement, and not a measure of how ill anyone is.'}
      </p>
    </figure>
  )
}
