import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ScanSignal {
  label: string
  ok: boolean
}

export function ScanSignals({ signals }: { signals: ScanSignal[] }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {signals.map((signal) => (
        <div
          key={signal.label}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-all duration-300',
            signal.ok
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-white/10 bg-white/5 text-white/50',
          )}
        >
          <span
            className={cn(
              'flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors duration-300',
              signal.ok ? 'bg-primary text-primary-foreground' : 'bg-white/15',
            )}
          >
            {signal.ok && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
          </span>
          {signal.label}
        </div>
      ))}
    </div>
  )
}
