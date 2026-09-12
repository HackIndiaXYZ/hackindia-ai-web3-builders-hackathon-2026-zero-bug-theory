import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const STAGES = ['Checking', 'Understanding', 'Screening']
const STAGE_DURATION = 950

export function ProcessingScreen({
  imageDataUrl,
  onDone,
}: {
  imageDataUrl: string
  onDone: () => void
}) {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const timers = STAGES.map((_, i) =>
      setTimeout(() => setStage(i), i * STAGE_DURATION),
    )
    const done = setTimeout(onDone, STAGES.length * STAGE_DURATION + 400)
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(done)
    }
  }, [onDone])

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-10 bg-background px-8">
      <div className="relative h-56 w-56">
        <div className="absolute inset-0 overflow-hidden rounded-[42%] border border-white/10">
          {imageDataUrl && (
            <img
              src={imageDataUrl || '/placeholder.svg'}
              alt=""
              className="h-full w-full object-cover opacity-80"
              style={{ transform: 'scaleX(-1)' }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-primary/20" />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(rgba(94,234,212,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,0.18) 1px, transparent 1px)',
              backgroundSize: '14px 14px',
            }}
          />
          <div className="absolute left-0 h-1/3 w-full bg-gradient-to-b from-transparent via-primary/60 to-transparent animate-scan-sweep" />
        </div>
        <div className="absolute -inset-3 rounded-[46%] border border-primary/30 animate-breathe-ring" />
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          {STAGES.map((label, i) => (
            <span
              key={label}
              className={cn(
                'h-1.5 rounded-full transition-all duration-500',
                i === stage ? 'w-6 bg-primary' : 'w-1.5 bg-white/15',
              )}
            />
          ))}
        </div>
        <p className="text-lg font-medium text-foreground transition-opacity duration-300">
          {STAGES[stage]}…
        </p>
        <p className="text-sm text-muted-foreground">AnemiaScan AI is reading the signals</p>
      </div>
    </div>
  )
}
