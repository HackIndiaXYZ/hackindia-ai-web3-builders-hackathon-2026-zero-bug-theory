import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Badge — a compact, pill-shaped status label.
 *
 * The three semantic variants (`risk` / `moderate` / `safe`) are tinted rather
 * than solid so they stay legible on both the light card (near-white) and the
 * dark card (deep blue-black) without any per-theme overrides in callers.
 */
const badgeVariants = cva(
  "inline-flex w-fit max-w-full shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 text-2xs font-semibold text-ellipsis whitespace-nowrap transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-background/60 text-foreground',
        risk: 'border-risk/25 bg-risk/10 text-risk dark:bg-risk/15',
        // `--moderate-strong` is the AA-safe amber: deepened in the light
        // palette (the raw token only reaches 4.34:1 on its own tint) and
        // aliased straight back to `--moderate` in the dark one.
        moderate: 'border-moderate/25 bg-moderate/10 text-moderate-strong dark:bg-moderate/15',
        safe: 'border-safe/25 bg-safe/10 text-safe dark:bg-safe/15',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
