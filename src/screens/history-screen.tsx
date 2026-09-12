/* --------------------------------------------------------------------------
 * HistoryScreen — the local record of every scan on this device.
 * --------------------------------------------------------------------------
 * A single scan is a snapshot; the point of this screen is direction. It opens
 * with the trend, then the summary statistics, then the individual scans —
 * filterable by outcome, each one openable, each one deletable, with a two-step
 * confirmation on anything destructive.
 *
 * These ROWS have never left the device: the whole screen is a read of one
 * localStorage key, it needs no connection, and "Clear all" genuinely deletes
 * it. The photos the rows describe are a different matter — each one was
 * uploaded over HTTPS to be scored, held in memory for that single request and
 * never written to disk on our side. The copies kept here are the only ones
 * that persist anywhere.
 * -------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronRight,
  ImageOff,
  Info,
  ListFilter,
  LockKeyhole,
  Minus,
  ScanLine,
  ShieldAlert,
  Stethoscope,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Stat } from '@/components/ui/stat'
import { TrendChart } from '@/src/components/trend-chart'
import { formatDateTime, formatRelativeTime } from '@/src/lib/format'
import { riskAdvice, riskClasses, riskColorToken } from '@/src/lib/risk-style'
import type { RiskLevel, ScanAnalysis } from '@/src/lib/types'

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

type BandFilter = 'all' | RiskLevel

/* The model's three outcomes, not bands on a scale. `Uncertain` is a real
   answer — the probability landed inside the margin around the operating
   threshold, or the two candidate models disagreed — so it gets a filter of
   its own rather than being quietly folded into a middle band. */
const FILTERS: ReadonlyArray<{ id: BandFilter; label: string }> = [
  { id: 'all', label: 'All scans' },
  { id: 'Lower risk', label: 'Lower' },
  { id: 'Higher risk', label: 'Higher' },
  { id: 'Uncertain', label: 'Uncertain' },
]

const EMPTY_REASONS = [
  {
    icon: TrendingDown,
    title: 'Direction beats a single number',
    body: 'One probability can be a lighting artefact. Three taken in similar light start to describe a direction you can actually act on.',
  },
  {
    icon: LockKeyhole,
    title: 'Stored only on this device',
    body: 'History lives in this browser’s local storage only — it isn’t synced to your account or any server. Clearing it here deletes it for good.',
  },
  {
    icon: Camera,
    title: 'Thirty scans, eight photos',
    body: 'The newest thirty scans keep their result and the newest eight keep their photo, so the record stays small and fast.',
  },
] as const

/* -------------------------------------------------------------------------- */
/* Trend chip                                                                 */
/* -------------------------------------------------------------------------- */

function trendCopy(trend: number, count: number): { label: string; hint: string } {
  if (count < 2) return { label: '—', hint: 'Needs at least two scans to compare.' }
  if (trend <= -3) {
    return {
      label: `${trend}`,
      hint: 'Your latest scan came in below your earlier average — a lower probability is the reassuring direction for this screen, not evidence that your haemoglobin changed.',
    }
  }
  if (trend >= 3) {
    return {
      label: `+${trend}`,
      hint: 'Your latest scan came in above your earlier average. Re-scan in good light before reading much into it.',
    }
  }
  return { label: trend > 0 ? `+${trend}` : `${trend}`, hint: 'Essentially flat against your earlier average.' }
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function HistoryRow({
  scan,
  isLatest,
  pendingDelete,
  onOpen,
  onRequestDelete,
  onConfirmDelete,
}: {
  scan: ScanAnalysis
  isLatest: boolean
  pendingDelete: boolean
  onOpen: () => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
}) {
  const token = riskColorToken(scan.riskLevel)
  const tone = riskClasses(token)
  const stamp = formatDateTime(scan.createdAt)

  return (
    <li className="card-hover flex items-stretch gap-1 rounded-2xl border border-border bg-card/70 p-2 pr-2.5">
      <button
        type="button"
        onClick={onOpen}
        className="ring-focus flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left"
      >
        {scan.imageDataUrl ? (
          <img
            src={scan.imageDataUrl}
            alt=""
            className="size-14 shrink-0 rounded-xl border border-border object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/50 text-muted-foreground"
          >
            <ImageOff className="size-4" />
          </span>
        )}

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                'metric inline-flex items-baseline gap-0.5 rounded-full border px-2 py-0.5 text-xs font-semibold',
                tone.border,
                tone.bg,
                tone.text,
              )}
            >
              {Math.round(scan.screeningProbability * 100)}
              <span className="text-[0.625rem] font-medium opacity-70">%</span>
            </span>
            <span className="truncate text-sm font-medium text-foreground">{scan.riskLevel}</span>
            {isLatest ? <Badge variant="secondary">Latest</Badge> : null}
          </span>
          {/* Two lines, not one truncated line: at 390px the row has roughly
              188px of text width, which clipped "quality NN/100" — the one
              number that says whether the capture was readable at all. */}
          <span className="text-2xs text-muted-foreground">
            {formatRelativeTime(scan.createdAt)} · quality {Math.round(scan.captureQuality)}/100
          </span>
          <span className="truncate text-2xs text-muted-foreground">{stamp}</span>
        </span>

        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>

      {pendingDelete ? (
        <Button
          variant="destructive"
          size="lg"
          onClick={onConfirmDelete}
          aria-label={`Confirm deleting the scan from ${stamp}`}
          className="h-auto shrink-0 self-stretch rounded-xl px-3 text-xs"
        >
          Delete?
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onRequestDelete}
          aria-label={`Delete the scan from ${stamp}`}
          className="shrink-0 self-center rounded-xl text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

interface HistoryScreenProps {
  items: ScanAnalysis[]
  onBack: () => void
  onStart: () => void
  onOpen: (analysis: ScanAnalysis) => void
  onDelete: (id: string) => void
  onClear: () => void
}

export function HistoryScreen({
  items,
  onBack,
  onStart,
  onOpen,
  onDelete,
  onClear,
}: HistoryScreenProps) {
  const reduceMotion = useReducedMotion() ?? false
  const [filter, setFilter] = useState<BandFilter>('all')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  /* Removing a row unmounts the button focus was sitting on, which drops focus
   * to <body> with nothing announced. Both destructive paths therefore move
   * focus to a heading and say what happened. */
  const [announcement, setAnnouncement] = useState('')
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const emptyHeadingRef = useRef<HTMLHeadingElement>(null)
  const focusEmptyRef = useRef(false)

  const ordered = useMemo(
    () => [...items].sort((a, b) => b.createdAt - a.createdAt),
    [items],
  )
  /* Summarised here rather than through historyStats(): every figure on this
     screen is the server's calibrated probability rendered as a percentage, not
     the 0–100 "screening score" the deleted local heuristic used to emit. */
  const stats = useMemo(() => {
    const empty = {
      count: 0,
      average: 0,
      latest: null as number | null,
      trend: 0,
      bestLevel: null as RiskLevel | null,
    }
    if (!ordered.length) return empty

    const mean = (values: number[]) =>
      Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    const percents = ordered.map((scan) => Math.round(scan.screeningProbability * 100))
    const earlier = percents.slice(1)

    let lowest = ordered[0]
    for (const scan of ordered) {
      if (scan.screeningProbability < lowest.screeningProbability) lowest = scan
    }

    return {
      count: ordered.length,
      average: mean(percents),
      latest: percents[0],
      trend: earlier.length ? percents[0] - mean(earlier) : 0,
      bestLevel: lowest.riskLevel,
    }
  }, [ordered])
  const counts = useMemo(() => {
    const map: Record<RiskLevel, number> = {
      'Lower risk': 0,
      'Higher risk': 0,
      Uncertain: 0,
    }
    for (const scan of ordered) map[scan.riskLevel] += 1
    return map
  }, [ordered])

  const visible = useMemo(
    () => (filter === 'all' ? ordered : ordered.filter((scan) => scan.riskLevel === filter)),
    [ordered, filter],
  )

  // a pending row delete expires on its own, so a mis-tap never stays armed
  useEffect(() => {
    if (!pendingDelete) return
    const timer = window.setTimeout(() => setPendingDelete(null), 4500)
    return () => window.clearTimeout(timer)
  }, [pendingDelete])

  // the armed row may disappear (deleted elsewhere, list replaced)
  useEffect(() => {
    if (pendingDelete && !ordered.some((scan) => scan.id === pendingDelete)) {
      setPendingDelete(null)
    }
  }, [ordered, pendingDelete])

  useEffect(() => {
    if (!ordered.length) setConfirmClear(false)
  }, [ordered.length])

  const handleDelete = useCallback(
    (scan: ScanAnalysis) => {
      setPendingDelete(null)
      const last = ordered.length <= 1
      focusEmptyRef.current = last
      onDelete(scan.id)
      setAnnouncement(
        last
          ? 'Scan deleted. Your history is now empty.'
          : `Scan deleted. ${ordered.length - 1} ${ordered.length - 1 === 1 ? 'scan' : 'scans'} left.`,
      )
      if (!last) listHeadingRef.current?.focus({ preventScroll: true })
    },
    [onDelete, ordered.length],
  )

  const handleClearAll = useCallback(() => {
    setConfirmClear(false)
    setPendingDelete(null)
    focusEmptyRef.current = true
    onClear()
    setAnnouncement('All scans deleted. Your history is now empty.')
  }, [onClear])

  /* The empty-state heading only exists after the list branch unmounts, so the
   * focus move has to wait for that render. */
  useEffect(() => {
    if (!focusEmptyRef.current || ordered.length) return
    focusEmptyRef.current = false
    emptyHeadingRef.current?.focus({ preventScroll: true })
  }, [ordered.length])

  const variants: Variants = {
    hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.45, ease: 'easeOut' },
    },
  }

  const trend = trendCopy(stats.trend, stats.count)
  const TrendIcon = stats.count < 2 ? Minus : stats.trend > 0 ? TrendingUp : TrendingDown
  const trendTone =
    stats.count < 2 ? 'text-muted-foreground' : stats.trend > 2 ? 'text-risk' : stats.trend < -2 ? 'text-safe' : 'text-muted-foreground'

  const higherRiskCount = counts['Higher risk']
  const latestHigherRisk = ordered[0]?.riskLevel === 'Higher risk'
  const showClinicianCallout = higherRiskCount > 0 || latestHigherRisk

  return (
    <div className="flex flex-1 flex-col">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* ---- masthead ---------------------------------------------------- */}
      <header className="relative isolate overflow-hidden border-b border-border/70 bg-card/40">
        <div aria-hidden="true" className="grain pointer-events-none absolute inset-0" />
        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 pt-6 pb-8 lg:px-10">
          <Button
            variant="ghost"
            size="lg"
            onClick={onBack}
            className="h-10 w-fit rounded-full px-3.5 text-muted-foreground"
          >
            <ArrowLeft className="size-4" data-icon="inline-start" aria-hidden="true" />
            Back
          </Button>

          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-2xs font-medium tracking-[0.18em] text-primary uppercase">
              <ScanLine className="size-3.5" aria-hidden="true" />
              Your record
            </span>
            <h1 className="display text-display-sm text-foreground sm:text-display">
              Scan history
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
              {ordered.length
                ? `${ordered.length} ${ordered.length === 1 ? 'scan' : 'scans'} stored in this browser, and readable with or without a connection. Screening probabilities are only meaningful in series — compare like with like, in similar light, days apart.`
                : 'Nothing stored yet. Every scan you take is saved here, in this browser only, so you can watch the direction rather than a single number.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <LockKeyhole className="size-3" aria-hidden="true" />
              Stored on this device
            </Badge>
            {stats.bestLevel ? (
              <Badge variant="secondary">Lowest outcome recorded: {stats.bestLevel}</Badge>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 lg:px-10 lg:py-10">
        {ordered.length === 0 ? (
          /* ---- empty state --------------------------------------------- */
          <motion.div variants={variants} initial="hidden" animate="show">
            <Card className="overflow-hidden">
              <CardContent className="flex flex-col gap-6 py-8">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-14 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary"
                  >
                    <ScanLine className="size-6" />
                  </span>
                  <h2
                    ref={emptyHeadingRef}
                    tabIndex={-1}
                    className="display text-display-xs text-foreground outline-none"
                  >
                    No scans yet
                  </h2>
                  <p className="max-w-md text-sm leading-relaxed text-balance text-muted-foreground">
                    A scan takes about thirty seconds: good light, lower lid gently pulled down, one
                    steady frame, then a moment while the server scores it. Your first one becomes
                    the baseline everything after it is read against.
                  </p>
                </div>

                <TrendChart items={[]} />

                <ul className="grid list-none gap-4 sm:grid-cols-3">
                  {EMPTY_REASONS.map((reason) => (
                    <li key={reason.title} className="flex flex-col gap-1.5">
                      <span
                        aria-hidden="true"
                        className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground"
                      >
                        <reason.icon className="size-4" />
                      </span>
                      <span className="text-sm font-medium text-foreground">{reason.title}</span>
                      <span className="text-xs leading-relaxed text-pretty text-muted-foreground">
                        {reason.body}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    size="lg"
                    onClick={onStart}
                    className="h-12 rounded-full px-6 text-base sm:w-fit"
                  >
                    <Camera className="size-4" data-icon="inline-start" aria-hidden="true" />
                    Start your first scan
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onBack}
                    className="h-12 rounded-full px-6 text-base sm:w-fit"
                  >
                    Back to home
                    <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <>
            <h2 className="sr-only">Overview</h2>

            {/* ---- trend ------------------------------------------------- */}
            <motion.div variants={variants} initial="hidden" animate="show">
              <Card>
                <CardHeader>
                  <CardTitle>Probability over time</CardTitle>
                  <CardDescription>
                    Lower is the reassuring direction. Hover, tap or use the arrow keys to read any
                    single scan.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TrendChart items={ordered} />
                </CardContent>
              </Card>
            </motion.div>

            {/* ---- stats ------------------------------------------------- */}
            <motion.div variants={variants} initial="hidden" animate="show">
              <Card>
                <CardContent className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                  <Stat label="Scans" value={`${stats.count}`} hint="Kept on this device" />
                  <Stat
                    label="Average"
                    value={`${stats.average}%`}
                    hint="Mean screening probability across every stored scan"
                  />
                  <Stat
                    label="Latest"
                    value={stats.latest === null ? '—' : `${stats.latest}%`}
                    hint={ordered[0] ? formatRelativeTime(ordered[0].createdAt) : undefined}
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                      Trend
                    </span>
                    <span
                      className={cn(
                        'metric inline-flex items-center gap-1 text-xl leading-none font-semibold',
                        trendTone,
                      )}
                    >
                      <TrendIcon className="size-4" aria-hidden="true" />
                      {trend.label}
                    </span>
                    <span className="text-xs leading-snug text-balance text-muted-foreground">
                      {trend.hint}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* ---- filters + list ---------------------------------------- */}
            <motion.section
              variants={variants}
              initial="hidden"
              animate="show"
              aria-labelledby="history-list-heading"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  ref={listHeadingRef}
                  id="history-list-heading"
                  tabIndex={-1}
                  className="text-base font-semibold tracking-tight text-foreground outline-none"
                >
                  Every scan
                </h2>
                <div
                  role="group"
                  aria-label="Filter scans by outcome"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <ListFilter
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {FILTERS.map((item) => {
                    const count = item.id === 'all' ? ordered.length : counts[item.id]
                    const active = filter === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setFilter(item.id)}
                        className={cn(
                          'ring-focus rounded-full border px-2.5 py-2 text-2xs font-medium transition-colors',
                          active
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-border bg-background/60 text-muted-foreground hover:border-primary/30 hover:text-foreground',
                        )}
                      >
                        {item.label}
                        <span className="pl-1 tabular-nums opacity-70">{count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* This screen renders outcomes, an average and a trend, so the
                  clinician path has to exist here too — not only on the result
                  screen the user may never scroll back to. */}
              {showClinicianCallout ? (
                <div className="flex items-start gap-3 rounded-2xl border border-risk/30 bg-risk/5 px-4 py-3.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-chip-sm border border-risk/25 bg-risk/10 text-risk"
                  >
                    <Stethoscope className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-sm leading-snug font-medium text-foreground">
                      {latestHigherRisk
                        ? 'Your most recent scan came back as Higher risk.'
                        : `${higherRiskCount} of your stored ${higherRiskCount === 1 ? 'scan' : 'scans'} came back as Higher risk.`}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {riskAdvice('Higher risk')[0]} A photograph cannot confirm or rule out
                      anaemia, whichever direction this list is moving.
                    </p>
                  </div>
                </div>
              ) : null}

              {visible.length ? (
                <ul className="flex list-none flex-col gap-2.5">
                  {visible.map((scan) => (
                    <HistoryRow
                      key={scan.id}
                      scan={scan}
                      isLatest={scan.id === ordered[0].id}
                      pendingDelete={pendingDelete === scan.id}
                      onOpen={() => onOpen(scan)}
                      onRequestDelete={() => setPendingDelete(scan.id)}
                      onConfirmDelete={() => handleDelete(scan)}
                    />
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-4 py-6">
                  <p className="text-sm text-muted-foreground">
                    No stored scans came back with this outcome.
                  </p>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setFilter('all')}
                    className="h-9 rounded-full px-4"
                  >
                    Show all scans
                  </Button>
                </div>
              )}

              <p className="inline-flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                Opening a scan restores its full result and insights. Photos are kept only for the
                newest eight scans; older entries keep their result but drop the image.
              </p>

              {/* Every other destination carries this line. A screen of colour
                  statistics plotted over time is the easiest place in the app to
                  mistake for a health trajectory, so it carries it too. */}
              <p className="inline-flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
                <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                AnemiaScan is a screening aid — not a diagnosis and not a haemoglobin measurement.
                These probabilities describe photographs, not your blood. Only a blood test can
                confirm anaemia.
              </p>
            </motion.section>

            {/* ---- danger zone ------------------------------------------- */}
            <motion.div variants={variants} initial="hidden" animate="show">
              {/* CardTitle renders an h3, and the h2 above keeps the order intact */}
              <Card className="border-destructive/25">
                <CardHeader>
                  <CardTitle className="text-sm">Clear this device&rsquo;s history</CardTitle>
                  <CardDescription className="text-xs">
                    Deletes all {ordered.length} stored {ordered.length === 1 ? 'scan' : 'scans'} and
                    every retained photo from this browser. There is no copy anywhere else, so this
                    cannot be undone.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {confirmClear ? (
                    <div className="flex flex-col gap-3">
                      <Separator />
                      <p
                        role="alert"
                        className="text-sm font-medium text-foreground"
                      >
                        Delete all {ordered.length} {ordered.length === 1 ? 'scan' : 'scans'}
                        {' '}permanently?
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        <Button
                          variant="destructive"
                          size="lg"
                          onClick={handleClearAll}
                          className="h-10 rounded-full px-4"
                        >
                          <Trash2 className="size-4" data-icon="inline-start" aria-hidden="true" />
                          Yes, delete everything
                        </Button>
                        <Button
                          variant="outline"
                          size="lg"
                          onClick={() => setConfirmClear(false)}
                          className="h-10 rounded-full px-4"
                        >
                          Keep my history
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => setConfirmClear(true)}
                      className="h-10 rounded-full px-4 text-destructive"
                    >
                      <Trash2 className="size-4" data-icon="inline-start" aria-hidden="true" />
                      Clear all history
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={onStart} className="h-12 rounded-full px-6 text-base sm:w-fit">
                <Camera className="size-4" data-icon="inline-start" aria-hidden="true" />
                New scan
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={onBack}
                className="h-12 rounded-full px-6 text-base sm:w-fit"
              >
                <ArrowLeft className="size-4" data-icon="inline-start" aria-hidden="true" />
                Back
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
