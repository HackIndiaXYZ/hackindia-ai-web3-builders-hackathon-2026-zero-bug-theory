import { Check } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

interface EyeGuideProps {
  ready: boolean
  className?: string
  /**
   * Hero artwork rather than a live reticle. Drops `role="img"` and its
   * capture-coaching label so a screen reader on the landing page is not read
   * instructions for a camera that is not running.
   */
  decorative?: boolean
}

/**
 * The aperture is a centred square of this fraction of the component's box, and
 * the dashed ROI rectangle is drawn inside it at analyze.ts's exact ROI
 * (x 18%, y 26%, w 64%, h 48%).
 *
 * scan-screen.tsx imports this to project the on-screen reticle back into the
 * video's pixel space, so the captured square really is the contents of the
 * dashed box. Keep it in step with the `h-[78%] w-[78%]` aperture class below.
 */
export const EYE_GUIDE_APERTURE_RATIO = 0.78

/**
 * Corner brackets, drawn as four quarter-frames so they read as a camera
 * reticle rather than as a rotated hairline.
 */
const CORNERS = [
  'left-0 top-0 rounded-tl-[12px] border-l-2 border-t-2',
  'right-0 top-0 rounded-tr-[12px] border-r-2 border-t-2',
  'left-0 bottom-0 rounded-bl-[12px] border-l-2 border-b-2',
  'right-0 bottom-0 rounded-br-[12px] border-r-2 border-b-2',
] as const

/* Every colour below is mixed from a palette token rather than baked as an RGBA
 * literal. The component is rendered on the dark viewfinder AND, at `ready`, as
 * the landing hero's centrepiece on a near-white panel — hardcoded teal-300 and
 * near-black made the dashed ROI, the conjunctiva band and the LOWER LID label
 * vanish in the light theme while the iris stayed a hard blue-black disc. */
const mixPrimary = (percent: number) =>
  `color-mix(in oklab, var(--primary) ${percent}%, transparent)`
const mixForeground = (percent: number) =>
  `color-mix(in oklab, var(--foreground) ${percent}%, transparent)`

/**
 * The capture reticle.
 *
 * The dashed inner rectangle is not decoration: it mirrors the analyser's
 * region of interest, and scan-screen.tsx crops to exactly this box, so
 * whatever the user lines up inside it is what gets measured.
 *
 * `ready` is the composite of every live capture check. On lock the brackets
 * pull in, the reticle warms to the primary colour, the sweep stops and an
 * "Aligned" pill appears. All motion is skipped under prefers-reduced-motion.
 */
export function EyeGuide({ ready, className, decorative = false }: EyeGuideProps) {
  const reduceMotion = useReducedMotion()
  const lockTransition = reduceMotion
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 210, damping: 24 } as const)

  const stroke = ready ? 'var(--primary)' : mixForeground(38)
  const faint = ready ? mixPrimary(40) : mixForeground(20)
  const irisCore = ready ? mixPrimary(34) : mixForeground(14)
  const irisEdge = mixForeground(55)

  const labelProps = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({
        role: 'img',
        'aria-label': ready
          ? 'Alignment guide: lower eyelid is framed and in focus'
          : 'Alignment guide: centre your everted lower eyelid inside the frame',
      } as const)

  return (
    <div
      className={cn('relative flex items-center justify-center', className)}
      data-ready={ready || undefined}
    >
      {/* Soft lock halo */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -inset-[8%] rounded-[48%] transition-opacity duration-700',
          ready
            ? 'opacity-100 shadow-[0_0_90px_-16px_var(--primary)]'
            : 'opacity-0 shadow-none',
        )}
      />

      {/* Outer breathing ring (CSS animation already respects reduced motion) */}
      <div
        aria-hidden="true"
        className={cn(
          'animate-breathe-ring pointer-events-none absolute inset-0 rounded-[46%] border-2 transition-colors duration-500',
          ready ? 'border-primary/60' : 'border-foreground/15',
        )}
      />

      {/* Aperture — a centred square of EYE_GUIDE_APERTURE_RATIO of this box */}
      <div
        className={cn(
          'relative flex h-[78%] w-[78%] items-center justify-center overflow-hidden rounded-[46%] border transition-all duration-500',
          ready
            ? 'border-primary/80 shadow-[0_0_60px_-10px_var(--primary)]'
            : 'border-foreground/20',
        )}
      >
        <svg viewBox="0 0 200 200" className="h-full w-full" {...labelProps}>
          <defs>
            <radialGradient id="eye-guide-iris" cx="50%" cy="42%" r="62%">
              <stop offset="0%" stopColor={irisCore} />
              <stop offset="100%" stopColor={irisEdge} />
            </radialGradient>
            <linearGradient id="eye-guide-lid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ready ? mixPrimary(34) : mixForeground(12)} />
              <stop offset="100%" stopColor={mixPrimary(4)} />
            </linearGradient>
          </defs>

          {/* Analyser region of interest */}
          <rect
            x="36"
            y="52"
            width="128"
            height="96"
            rx="16"
            fill="none"
            stroke={faint}
            strokeWidth="1.5"
            strokeDasharray="5 9"
            className="transition-all duration-500"
          />

          {/* Eye aperture outline */}
          <path
            d="M14 100 C 48 44, 152 44, 186 100 C 152 156, 48 156, 14 100 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinejoin="round"
            className="transition-all duration-500"
          />

          {/* The conjunctiva band — the tissue we actually read */}
          <path
            d="M30 110 C 62 150, 138 150, 170 110 C 138 136, 62 136, 30 110 Z"
            fill="url(#eye-guide-lid)"
            className="transition-all duration-500"
          />
          <path
            d="M14 100 C 48 156, 152 156, 186 100"
            fill="none"
            stroke={ready ? 'var(--primary)' : mixForeground(55)}
            strokeWidth="3"
            strokeLinecap="round"
            className="transition-all duration-500"
          />

          {/* Iris + pupil */}
          <circle
            cx="100"
            cy="96"
            r="28"
            fill="url(#eye-guide-iris)"
            stroke={faint}
            strokeWidth="1"
            className="transition-all duration-500"
          />
          <circle cx="100" cy="96" r="12" fill={mixForeground(60)} />

          {/* Edge ticks — a crosshair without covering the subject */}
          <g stroke={stroke} strokeWidth="2" strokeLinecap="round" className="transition-all duration-500">
            <line x1="100" y1="18" x2="100" y2="32" />
            <line x1="100" y1="168" x2="100" y2="182" />
            <line x1="18" y1="100" x2="32" y2="100" />
            <line x1="168" y1="100" x2="182" y2="100" />
          </g>

          {/* Full-strength token + an opacity attribute, so the label clears AA
              in both palettes instead of carrying a pre-baked teal alpha. */}
          <text
            x="100"
            y="174"
            textAnchor="middle"
            fontSize="8"
            letterSpacing="2.4"
            fill={ready ? 'var(--primary)' : 'var(--foreground)'}
            opacity={ready ? 0.95 : 0.6}
            className="transition-all duration-500"
          >
            LOWER LID
          </text>
        </svg>

        {/* Searching sweep — stops once the frame is locked */}
        {!ready && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="animate-scan-sweep absolute left-0 h-px w-full bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
          </div>
        )}
      </div>

      {/* Corner brackets pull inwards on lock */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        animate={{ scale: ready ? 0.97 : 1.05 }}
        initial={false}
        transition={lockTransition}
      >
        {CORNERS.map((position) => (
          <span
            key={position}
            aria-hidden="true"
            className={cn(
              'absolute h-6 w-6 transition-colors duration-500',
              position,
              ready ? 'border-primary' : 'border-foreground/45',
            )}
          />
        ))}
      </motion.div>

      <AnimatePresence initial={false}>
        {ready && (
          <motion.div
            key="aligned"
            aria-hidden={decorative || undefined}
            className="pointer-events-none absolute -bottom-3 flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-2xs font-medium text-primary backdrop-blur-md"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6, scale: reduceMotion ? 1 : 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 6, scale: reduceMotion ? 1 : 0.92 }}
            transition={{ duration: reduceMotion ? 0 : 0.24 }}
          >
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
            Aligned
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
