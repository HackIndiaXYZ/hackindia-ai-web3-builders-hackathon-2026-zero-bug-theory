import { cn } from '@/lib/utils'

/**
 * Skeleton — a loading placeholder with a light sweep.
 *
 * The sweep is a child element driven by the shared `.animate-shimmer`
 * keyframes, which the stylesheet already neutralises under
 * `prefers-reduced-motion`; the muted block alone still reads as "loading".
 * Hidden from assistive tech by default — announce loading state on the
 * surrounding region instead.
 */
function Skeleton({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'relative isolate overflow-hidden rounded-lg bg-muted',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="animate-shimmer pointer-events-none absolute inset-0 block bg-linear-to-r from-transparent via-foreground/10 to-transparent"
      />
      {children}
    </div>
  )
}

export { Skeleton }
