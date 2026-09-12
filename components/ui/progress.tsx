import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const progressIndicatorVariants = cva(
  'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-[var(--ease-spring)]',
  {
    variants: {
      tone: {
        primary: 'bg-primary',
        risk: 'bg-risk',
        moderate: 'bg-moderate',
        safe: 'bg-safe',
      },
    },
    defaultVariants: {
      tone: 'primary',
    },
  },
)

type ProgressProps = Omit<
  React.ComponentProps<'div'>,
  'role' | 'children' | 'aria-valuenow' | 'aria-valuemin' | 'aria-valuemax'
> &
  VariantProps<typeof progressIndicatorVariants> & {
    /** 0..100 — anything outside the range is clamped. */
    value: number
    /** Accessible name for the bar. Omit only when an adjacent label is wired up via aria-labelledby. */
    label?: string
  }

/**
 * Progress — a clamped, accessible meter.
 *
 * The fill animates its width, but only when the user has not asked for
 * reduced motion (`motion-safe:`), so the bar snaps straight to its value for
 * anyone with the OS preference set.
 */
function Progress({
  className,
  value,
  tone = 'primary',
  label,
  ...props
}: ProgressProps) {
  const safe = Number.isFinite(value) ? value : 0
  const pct = Math.min(100, Math.max(0, safe))
  const rounded = Math.round(pct)

  // a progressbar must have an accessible name; only fall back to a generic one
  // when the caller has supplied no naming mechanism at all.
  const named =
    props['aria-label'] != null || props['aria-labelledby'] != null
  const accessibleName = label ?? (named ? undefined : 'Progress')

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-label={accessibleName}
      aria-valuenow={rounded}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${rounded}%`}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-muted',
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={progressIndicatorVariants({ tone })}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export { Progress, progressIndicatorVariants }
