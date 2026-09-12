/* --------------------------------------------------------------------------
 * skiper-marquee — seamless infinite horizontal marquee
 * --------------------------------------------------------------------------
 * A companion to skiper40, written in the same house style: self-contained,
 * Tailwind-only, dependency-light (react, motion/react, '@/lib/utils').
 *
 * How the seam works: the children are rendered twice inside one `w-max` flex
 * track. The design-system keyframe behind `.animate-marquee` translates the
 * track by exactly -50%, which is one full copy, so the loop point is
 * invisible. Duration is driven by the `--marquee-duration` custom property.
 *
 * Two accessibility requirements, both real rather than decorative:
 *
 *   - WCAG 2.2.2 (Level A) — motion that runs for more than five seconds in
 *     parallel with other content needs a mechanism to pause, stop or hide it.
 *     Hover and focus-within are NOT that mechanism on a touch device, and this
 *     component is used inside a `md:hidden` branch, i.e. exactly where neither
 *     fires. So it ships a real pause/play button.
 *   - Under `prefers-reduced-motion: reduce` the marquee stops being a marquee:
 *     a single copy is rendered inside a horizontally scrollable region, so the
 *     content stays reachable instead of being frozen half off-screen.
 * -------------------------------------------------------------------------- */

import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { Pause, Play } from 'lucide-react'

import { cn } from '@/lib/utils'

interface SkiperMarqueeProps {
  children: React.ReactNode
  className?: string
  /** Seconds for one full cycle. Larger is slower. Default 32. */
  speed?: number
  /** Travel right-to-left (default) or left-to-right. */
  reverse?: boolean
  /** Freeze while hovered or while a child holds focus. Default true. */
  pauseOnHover?: boolean
  /**
   * Accessible name for the pause control, so a page with two marquees does not
   * present two identically named buttons.
   */
  label?: string
}

/** Custom-property carrier — CSSProperties has no index signature for `--*`. */
type MarqueeStyle = React.CSSProperties & { '--marquee-duration'?: string }

/** Softens both ends so items enter and leave instead of popping. */
const EDGE_MASK =
  'linear-gradient(to right, transparent 0%, #000 7%, #000 93%, transparent 100%)'

export function SkiperMarquee({
  children,
  className,
  speed = 32,
  reverse = false,
  pauseOnHover = true,
  label = 'scrolling list',
}: SkiperMarqueeProps) {
  const reduceMotion = useReducedMotion() ?? false
  const [paused, setPaused] = React.useState(false)
  const duration = Math.max(4, Number.isFinite(speed) ? speed : 32)

  // Reduced motion: no animation, no duplicated copy, but still fully
  // browsable by touch, trackpad and keyboard.
  if (reduceMotion) {
    return (
      <div
        role="group"
        aria-label="Scrollable list"
        tabIndex={0}
        className={cn(
          'ring-focus no-scrollbar relative w-full overflow-x-auto overscroll-x-contain',
          className,
        )}
      >
        <div className="flex w-max shrink-0 items-center">{children}</div>
      </div>
    )
  }

  const style: MarqueeStyle = { '--marquee-duration': `${duration}s` }

  return (
    <div className={cn('relative flex w-full flex-col gap-2', className)}>
      <div
        className="group relative w-full overflow-hidden"
        style={{ WebkitMaskImage: EDGE_MASK, maskImage: EDGE_MASK }}
      >
        <div
          style={{
            ...style,
            animationDirection: reverse ? 'reverse' : 'normal',
          }}
          className={cn(
            'animate-marquee flex w-max shrink-0 items-center',
            paused && '[animation-play-state:paused]',
            pauseOnHover &&
              'group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]',
          )}
        >
          {/* Copy 1 — the real content. */}
          <div className="flex shrink-0 items-center">{children}</div>
          {/* Copy 2 — visual continuation only, hidden from assistive tech. */}
          <div className="flex shrink-0 items-center" aria-hidden="true">
            {children}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setPaused((prev) => !prev)}
          aria-pressed={paused}
          aria-label={paused ? `Resume the ${label}` : `Pause the ${label}`}
          className="ring-focus inline-flex size-10 items-center justify-center rounded-full border border-border/70 bg-card/60 text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground"
        >
          {paused ? (
            <Play className="size-3.5" aria-hidden="true" />
          ) : (
            <Pause className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  )
}
