/* --------------------------------------------------------------------------
 * MeasureBars — the explainability primitive.
 * --------------------------------------------------------------------------
 * This component used to render the five "signals" of a local colour heuristic
 * (pallor, saturation, vascularity, …), each with a hand-picked weight and a
 * hand-picked polarity. That heuristic has been deleted: the browser computes
 * no medical quantity any more. Every number here is now something the SERVER
 * reported about the inference it actually ran.
 *
 * What it draws is a small set of meters, each with:
 *   - a fill, positioned on a track whose scale the builder decides,
 *   - an optional MARKER on the same track (a decision threshold, or the value
 *     an in-distribution capture is expected to produce), because a lone bar
 *     with no reference point tells a reader nothing, and
 *   - a plain-language hint that says what the number is and what it is not.
 *
 * The builders below are the only place these rows are constructed, so no
 * screen can quietly invent a quantity that the model never produced.
 *
 * Each row's hint opens on hover or focus and can be pinned open by click /
 * Enter / Space; the meter itself is an accessible progressbar via the shared
 * `Progress` primitive.
 * -------------------------------------------------------------------------- */

import { useId, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { clamp, formatPercent, formatProbability, humaniseKey } from '@/src/lib/format'
import type { RiskToken } from '@/src/lib/risk-style'
import type { GateReport, ModelOutput } from '@/src/lib/types'

/* -------------------------------------------------------------------------- */
/* Row model                                                                  */
/* -------------------------------------------------------------------------- */

export type MeasureTone = RiskToken | 'primary'

export interface MeasureRow {
  key: string
  label: string
  /** Optional short qualifier printed next to the label, e.g. 'selected'. */
  tag?: string
  /** 0..1 — where the fill ends on the track. */
  fraction: number
  /** The value as the reader should see it. Already formatted by the builder. */
  readout: string
  tone: MeasureTone
  /** A reference mark on the same track: a threshold, or an expected value. */
  marker?: { fraction: number; label: string }
  /** What this number is, and what it is not. Plain language, never a claim. */
  hint: string
}

const TONE_TEXT: Record<MeasureTone, string> = {
  primary: 'text-primary',
  risk: 'text-risk',
  moderate: 'text-moderate',
  safe: 'text-safe',
}

/* -------------------------------------------------------------------------- */
/* Builders — the only sanctioned sources of a row                            */
/* -------------------------------------------------------------------------- */

/**
 * What each candidate actually is. Keyed by the names the inference contract
 * uses; an unrecognised key falls back to a description that claims nothing,
 * because inventing an architecture for a model we do not recognise would be
 * exactly the sort of confident fiction this rewrite exists to remove.
 */
const CANDIDATE_NOTES: Record<string, string> = {
  logistic_stacker:
    'A logistic regression stacked on top of the two image encoders’ outputs and the 32 engineered colour features, then Platt-calibrated so the number it emits behaves like a probability rather than a raw score.',
  regularized_gated_fusion:
    'A gated fusion head that decides per image how much to trust each encoder and the colour features, averaged across its ensemble and Platt-calibrated the same way.',
}

/**
 * One row per candidate model, each against its OWN threshold.
 *
 * The two candidates do not share a threshold — 0.2076 and 0.1855 — so a single
 * shared marker would misplace one of them. When the two land on opposite sides
 * of their respective thresholds the service reports `model_disagreement` and
 * the decision becomes `uncertain`; these rows are how that becomes visible.
 */
export function candidateRows(model: ModelOutput): MeasureRow[] {
  const entries = Object.entries(model.candidateProbabilities ?? {})
  return entries.map(([key, raw]) => {
    const probability = clamp(Number(raw), 0, 1)
    const threshold = Number(model.candidateThresholds?.[key])
    const hasThreshold = Number.isFinite(threshold)
    const over = hasThreshold && probability >= threshold
    const selected = key === model.selectedModel
    return {
      key,
      label: humaniseKey(key),
      tag: selected ? 'selected' : undefined,
      fraction: probability,
      readout: formatProbability(probability),
      tone: over ? 'risk' : 'safe',
      marker: hasThreshold
        ? { fraction: clamp(threshold, 0, 1), label: `threshold ${formatProbability(threshold)}` }
        : undefined,
      hint: `${CANDIDATE_NOTES[key] ?? 'One of the candidate models the service scored this capture with.'} ${
        hasThreshold
          ? `Its own operating threshold is ${formatProbability(threshold)}, so this reading sits ${
              over ? 'at or above' : 'below'
            } it.`
          : ''
      }${
        selected
          ? ' This is the candidate the running configuration selects, so its reading is the headline probability.'
          : ' It is scored alongside the selected candidate as a cross-check, and does not set the result on its own.'
      }`,
    }
  })
}

/** Human labels for the three branches the gated fusion head weights. */
const FUSION_BRANCH_NOTES: Record<string, string> = {
  efficientnet: 'The EfficientNet-B3 image encoder.',
  convnext: 'The ConvNeXt-Tiny image encoder.',
  colour_features: 'The 32 engineered colour, texture and exposure statistics.',
}

/**
 * The fusion gate weights: how much the gated head leaned on each branch for
 * THIS image, averaged over its ensemble. They are softmax weights, so they sum
 * to 1 and a bar is genuinely a share.
 */
export function fusionGateRows(model: ModelOutput): MeasureRow[] {
  const entries = Object.entries(model.fusionGateWeights ?? {})
  return entries.map(([key, raw]) => {
    const weight = clamp(Number(raw), 0, 1)
    return {
      key,
      label: humaniseKey(key),
      fraction: weight,
      readout: formatPercent(weight, 1),
      tone: 'primary',
      hint: `${FUSION_BRANCH_NOTES[key] ?? 'One branch of the gated fusion head.'} The gate produced this share for this particular capture; the three shares sum to 100%. A weight is an attention share inside one model, not evidence about you — it says where the model looked, never what it found.`,
    }
  })
}

/**
 * The in-distribution gate's budget against its limit.
 *
 * `distributionBudget` is the sum of squared z-scores across the 32 engineered
 * features, so an input that looks like the training ROIs lands near 32 and the
 * service refuses anything past `distributionBudgetLimit`. Showing the raw pair
 * is the honest way to say "this capture was inside the range the model was
 * fitted on, and by how much".
 */
export function distributionBudgetRow(gate: GateReport): MeasureRow | null {
  const limit = Number(gate.distributionBudgetLimit)
  const budget = Number(gate.distributionBudget)
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(budget)) return null

  const ratio = clamp(budget / limit, 0, 1)
  const tone: MeasureTone = ratio >= 0.75 ? 'risk' : ratio >= 0.45 ? 'moderate' : 'safe'
  // 32 features, each contributing an expected squared z-score of 1.
  const expected = 32

  return {
    key: 'distribution-budget',
    label: 'Distance from the training distribution',
    fraction: ratio,
    readout: `${budget.toFixed(1)} / ${limit.toFixed(0)}`,
    tone,
    marker:
      expected < limit
        ? { fraction: expected / limit, label: `typical ${expected}` }
        : undefined,
    hint: `The sum of squared z-scores across the 32 engineered features, measured against the statistics of the 648 training ROIs. A capture that looks like the training data lands near ${expected}; anything past ${limit.toFixed(
      0,
    )} is refused outright rather than scored. This describes the photograph’s similarity to the training set — not your health.`,
  }
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function MeasureBarRow({
  row,
  open,
  pinned,
  reduceMotion,
  onPinnedChange,
  onHoverChange,
}: {
  row: MeasureRow
  /** Visually revealed — pinned, hovered or focused. */
  open: boolean
  /** Explicitly pinned by the user. This, and only this, is `aria-expanded`. */
  pinned: boolean
  reduceMotion: boolean
  onPinnedChange: (pinned: boolean) => void
  onHoverChange: (hovering: boolean) => void
}) {
  const hintId = useId()
  const pct = clamp(row.fraction, 0, 1) * 100

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
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{row.label}</span>
            {row.tag ? (
              <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-semibold text-primary">
                {row.tag}
              </span>
            ) : null}
          </span>
          {row.marker ? (
            <span className="text-2xs text-muted-foreground tabular-nums">{row.marker.label}</span>
          ) : null}
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn('metric text-sm font-semibold tabular-nums', TONE_TEXT[row.tone])}>
            {row.readout}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 text-muted-foreground transition-transform duration-300',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>

      {/* The marker has to live OUTSIDE `Progress` — that element clips its
          children so it can round the fill — hence the relative wrapper. */}
      <div className="relative mt-2.5">
        <Progress value={pct} tone={row.tone} label={`${row.label} reading`} className="h-1.5" />
        {row.marker ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 h-3.5 w-px -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${clamp(row.marker.fraction, 0, 1) * 100}%` }}
          />
        ) : null}
      </div>

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
          {row.hint}
        </p>
      </motion.div>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface MeasureBarsProps {
  rows: MeasureRow[]
  /** Shown when there is nothing to draw. Say why, do not draw a placeholder. */
  emptyLabel?: string
  className?: string
}

export function MeasureBars({ rows, emptyLabel, className }: MeasureBarsProps) {
  const reduceMotion = useReducedMotion() ?? false
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [hovered, setHovered] = useState<string | null>(null)
  const keys = useMemo(() => rows.map((row) => row.key), [rows])

  if (!rows.length) {
    return (
      <p
        className={cn(
          'rounded-2xl border border-dashed border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        {emptyLabel ?? 'The server reported no figures for this scan.'}
      </p>
    )
  }

  const allPinned = pinned.size === rows.length

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
        {rows.map((row) => (
          <MeasureBarRow
            key={row.key}
            row={row}
            open={pinned.has(row.key) || hovered === row.key}
            pinned={pinned.has(row.key)}
            reduceMotion={reduceMotion}
            onPinnedChange={(next) => togglePin(row.key, next)}
            onHoverChange={(hovering) =>
              setHovered((current) => (hovering ? row.key : current === row.key ? null : current))
            }
          />
        ))}
      </ol>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setPinned(allPinned ? new Set<string>() : new Set(keys))}
          className="ring-focus rounded-full border border-border bg-background/60 px-2.5 py-2 text-2xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {allPinned ? 'Hide explanations' : 'Explain every figure'}
        </button>
      </div>
    </div>
  )
}
