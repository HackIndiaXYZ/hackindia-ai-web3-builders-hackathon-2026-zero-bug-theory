import { cn } from '@/lib/utils'

interface EyeGuideProps {
  ready: boolean
  className?: string
}

export function EyeGuide({ ready, className }: EyeGuideProps) {
  return (
    <div className={cn('relative flex items-center justify-center', className)}>
      <div
        className={cn(
          'absolute h-full w-full rounded-[46%] border-2 transition-colors duration-500 animate-breathe-ring',
          ready ? 'border-primary/70' : 'border-white/15',
        )}
      />
      <div
        className={cn(
          'relative flex h-[78%] w-[78%] items-center justify-center overflow-hidden rounded-[46%] border transition-all duration-500',
          ready
            ? 'border-primary/80 shadow-[0_0_60px_-8px_var(--primary)]'
            : 'border-white/20',
        )}
      >
        <svg
          viewBox="0 0 200 120"
          className="h-full w-full"
          role="img"
          aria-label="Eye alignment guide"
        >
          <path
            d="M4 60 C 40 4, 160 4, 196 60 C 160 116, 40 116, 4 60 Z"
            fill="none"
            stroke={ready ? 'var(--primary)' : 'rgba(255,255,255,0.35)'}
            strokeWidth="2.5"
            className="transition-all duration-500"
          />
          <circle
            cx="100"
            cy="60"
            r="26"
            fill={ready ? 'var(--accent)' : 'rgba(255,255,255,0.06)'}
            className="transition-all duration-500"
          />
          <circle cx="100" cy="60" r="13" fill="rgba(10,12,16,0.55)" />
        </svg>

        <div className="pointer-events-none absolute inset-x-0 top-0 h-full">
          <div className="absolute left-0 h-px w-full bg-gradient-to-r from-transparent via-primary/80 to-transparent animate-scan-sweep" />
        </div>
      </div>

      {[
        'top-1 left-1',
        'top-1 right-1 rotate-90',
        'bottom-1 left-1 -rotate-90',
        'bottom-1 right-1 rotate-180',
      ].map((pos) => (
        <span
          key={pos}
          className={cn(
            'absolute h-5 w-5 border-t-2 border-l-2 transition-colors duration-500',
            pos,
            ready ? 'border-primary' : 'border-white/40',
          )}
        />
      ))}
    </div>
  )
}
