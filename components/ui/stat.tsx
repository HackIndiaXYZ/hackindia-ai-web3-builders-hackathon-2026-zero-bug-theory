import { cn } from '@/lib/utils'

type StatProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  label: string
  value: string
  hint?: string
}

/** Stat — a compact metric block: quiet caption, confident number, optional aside. */
function Stat({ label, value, hint, className, ...props }: StatProps) {
  return (
    <div
      data-slot="stat"
      className={cn('flex min-w-0 flex-col gap-1', className)}
      {...props}
    >
      <span
        data-slot="stat-label"
        className="text-2xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
      >
        {label}
      </span>
      <span
        data-slot="stat-value"
        className="text-xl leading-none font-semibold tracking-tight tabular-nums"
      >
        {value}
      </span>
      {hint ? (
        <span
          data-slot="stat-hint"
          className="text-xs leading-snug text-muted-foreground text-balance"
        >
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export { Stat }
