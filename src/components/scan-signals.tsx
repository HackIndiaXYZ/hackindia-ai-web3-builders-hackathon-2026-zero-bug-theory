import { Check, CircleAlert } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

/**
 * One live capture check shown during a scan.
 *
 * `ok` is driven by a real measurement taken off the camera frame (never a
 * timer), and `hint` is the one-line coaching sentence we surface while that
 * check is still failing.
 */
export interface ScanSignal {
  label: string
  ok: boolean
  hint?: string
}

/**
 * The chip row under the capture reticle: one pill per capture check, plus the
 * hint for the first check that still needs attention.
 *
 * Screen readers get an explicit pass/fail word per chip and a summary count,
 * so the row is meaningful without colour. The visible hint intentionally has
 * no live region of its own — ScanScreen owns the single aria-live coach line,
 * so announcements never double up.
 */
export function ScanSignals({
  signals,
  className,
}: {
  signals: ScanSignal[]
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const readyCount = signals.reduce((total, signal) => total + (signal.ok ? 1 : 0), 0)
  const pending = signals.find((signal) => !signal.ok && signal.hint)

  return (
    <div className={cn('flex w-full flex-col items-center gap-2.5', className)}>
      <ul
        role="list"
        aria-label="Capture quality checks"
        className="flex flex-wrap items-center justify-center gap-1.5"
      >
        {signals.map((signal) => (
          <li
            key={signal.label}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium backdrop-blur-md transition-colors duration-300',
              signal.ok
                ? 'border-primary/45 bg-primary/15 text-primary'
                : 'border-white/10 bg-white/5 text-white/55',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors duration-300',
                signal.ok ? 'bg-primary text-primary-foreground' : 'bg-white/20',
              )}
            >
              <AnimatePresence initial={false}>
                {signal.ok && (
                  <motion.span
                    key="tick"
                    className="flex"
                    initial={{ scale: reduceMotion ? 1 : 0.2, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: reduceMotion ? 1 : 0.2, opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.22 }}
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <span>{signal.label}</span>
            <span className="sr-only">{signal.ok ? ' ready' : ' needs attention'}</span>
          </li>
        ))}
      </ul>

      <p className="sr-only">
        {readyCount} of {signals.length} capture checks ready.
      </p>

      <AnimatePresence mode="wait" initial={false}>
        {pending?.hint && (
          <motion.p
            key={pending.label}
            className="flex max-w-[20rem] items-start gap-1.5 px-2 text-center text-xs leading-relaxed text-white/60"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
          >
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-moderate" aria-hidden="true" />
            <span className="text-left">{pending.hint}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
