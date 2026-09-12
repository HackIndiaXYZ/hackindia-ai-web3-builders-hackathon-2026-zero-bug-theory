/* --------------------------------------------------------------------------
 * skiper40 — 3D perspective card-stack carousel
 * --------------------------------------------------------------------------
 * PROVENANCE: this is an ORIGINAL implementation of the `skiper40` pattern,
 * not the official registry file. `npx shadcn add @skiper-ui/skiper40` could
 * not be run here because skiper-ui.com is blocked by this environment's
 * egress policy and the registry item is not mirrored on npm, so the official
 * source was unreachable. It is written in the Skiper UI house style —
 * self-contained under components/ui, motion/react driven, Tailwind-only
 * styling, a typed item model plus an exported card — and should be replaced
 * with the official source if the registry ever becomes reachable.
 *
 * Dependencies are deliberately limited to react, motion/react, lucide-react
 * and the local `cn` helper.
 * -------------------------------------------------------------------------- */

import * as React from 'react'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type PanInfo,
  type Transition,
} from 'motion/react'
import { ChevronLeft, ChevronRight, MoveHorizontal, Pause, Play } from 'lucide-react'

import { cn } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

export interface Skiper40Item {
  id: string
  title: string
  subtitle?: string
  caption?: string
  image?: string
  /** Any CSS colour. Tints this card's glow, edge light and floor reflection. */
  accent?: string
}

interface Skiper40Props {
  items: Skiper40Item[]
  className?: string
  /** Advance on a timer. Pauses on hover, focus, drag and hidden tabs. */
  autoplay?: boolean
  /** Autoplay dwell time per card, in milliseconds. Default 4600. */
  interval?: number
  /** Fired on mount and on every index change. */
  onIndexChange?: (i: number) => void
}

interface Skiper40CardProps {
  item: Skiper40Item
  className?: string
}

/** Custom-property carriers — CSSProperties has no index signature for `--*`. */
type AccentStyle = React.CSSProperties & { '--skiper-accent'?: string }

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

/** How many cards are drawn either side of the active one. */
const NEIGHBOURS = 2
const DEFAULT_INTERVAL = 4600
const MIN_INTERVAL = 1400
const FALLBACK_WIDTH = 340

/** Soft horizontal falloff so clipped neighbours do not end on a hard edge. */
const EDGE_MASK =
  'linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%)'

function clampNumber(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Positive modulo — correct for negative indices and any count >= 1. */
function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

/**
 * Shortest signed distance from `active` to `index` around the ring, so a card
 * can travel off one side and reappear on the other. Guards the 1-item case
 * (always 0) and stays stable for 2 items (the other card sits at +1 or -1,
 * never both, so it is never drawn twice).
 */
function relativeOffset(index: number, active: number, count: number): number {
  if (count <= 1) return 0
  let delta = index - active
  const half = count / 2
  if (delta > half) delta -= count
  else if (delta < -half) delta += count
  return delta
}

/** Stack metrics derived from the measured stage width. */
function stackMetrics(width: number) {
  const w = width > 0 ? width : FALLBACK_WIDTH
  return {
    spread: clampNumber(w * 0.3, 76, 190),
    depth: clampNumber(w * 0.22, 58, 150),
    rotate: w < 420 ? 17 : 23,
  }
}

/* -------------------------------------------------------------------------- */
/* Card                                                                      */
/* -------------------------------------------------------------------------- */

export function Skiper40Card({ item, className }: Skiper40CardProps) {
  const accent = item.accent ?? 'var(--primary)'
  const style: AccentStyle = { '--skiper-accent': accent }

  return (
    <article
      style={style}
      className={cn(
        'grain relative isolate flex aspect-[3/4] w-full flex-col justify-end overflow-hidden rounded-[28px]',
        'border border-black/10 bg-card text-card-foreground',
        'shadow-[0_28px_70px_-34px_rgba(8,12,20,0.55)]',
        'dark:border-white/10 dark:shadow-[0_34px_80px_-30px_rgba(0,0,0,0.85)]',
        className,
      )}
    >
      {/* Artwork, or a generated accent field when no image is supplied. */}
      {item.image ? (
        <img
          src={item.image}
          alt=""
          aria-hidden="true"
          draggable={false}
          loading="lazy"
          decoding="async"
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage: [
              'radial-gradient(115% 85% at 18% 4%, color-mix(in oklab, var(--skiper-accent) 62%, transparent) 0%, transparent 62%)',
              'radial-gradient(95% 75% at 92% 22%, color-mix(in oklab, var(--skiper-accent) 28%, transparent) 0%, transparent 58%)',
              'linear-gradient(168deg, color-mix(in oklab, var(--skiper-accent) 16%, #0b1016) 0%, #080c12 78%)',
            ].join(', '),
          }}
        />
      )}

      {/* Legibility scrim — keeps the card readable in both themes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/45 to-black/5"
      />

      {/* Accent edge light + inner hairline. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[28px]"
        style={{
          boxShadow: [
            'inset 0 1px 0 0 rgba(255,255,255,0.22)',
            'inset 0 0 0 1px color-mix(in oklab, var(--skiper-accent) 26%, transparent)',
            'inset 0 -70px 90px -70px color-mix(in oklab, var(--skiper-accent) 70%, transparent)',
          ].join(', '),
        }}
      />

      <div className="relative z-10 flex flex-col gap-2 p-5 sm:p-6">
        {item.caption ? (
          <span
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-2xs font-medium tracking-[0.14em] text-white/90 uppercase backdrop-blur-sm"
            style={{
              borderColor:
                'color-mix(in oklab, var(--skiper-accent) 46%, transparent)',
            }}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ backgroundColor: 'var(--skiper-accent)' }}
            />
            {item.caption}
          </span>
        ) : null}

        <h3 className="text-balance text-display-xs text-white sm:text-display-sm">
          {item.title}
        </h3>

        {item.subtitle ? (
          <p className="max-w-[34ch] text-pretty text-sm leading-relaxed text-white/72">
            {item.subtitle}
          </p>
        ) : null}
      </div>
    </article>
  )
}

/* -------------------------------------------------------------------------- */
/* Carousel                                                                   */
/* -------------------------------------------------------------------------- */

export function Skiper40({
  items,
  className,
  autoplay = false,
  interval = DEFAULT_INTERVAL,
  onIndexChange,
}: Skiper40Props) {
  const count = items.length
  const reduceMotion = useReducedMotion() ?? false

  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const pressXRef = React.useRef<number | null>(null)

  const [index, setIndex] = React.useState(0)
  const [stageWidth, setStageWidth] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const [hovering, setHovering] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const [userPaused, setUserPaused] = React.useState(false)
  const [tabVisible, setTabVisible] = React.useState(true)

  /* ---- pointer parallax (whole stack tilts as one rigid body) ---------- */
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const tiltY = useSpring(useTransform(pointerX, [-1, 1], [9, -9]), {
    stiffness: 140,
    damping: 18,
  })
  const tiltX = useSpring(useTransform(pointerY, [-1, 1], [-6, 6]), {
    stiffness: 140,
    damping: 18,
  })

  /* ---- keep the index valid if the item list changes ------------------- */
  React.useEffect(() => {
    setIndex((prev) => (count === 0 ? 0 : Math.min(prev, count - 1)))
  }, [count])

  /* ---- report the active index without re-firing on identity churn ---- */
  const notifyRef = React.useRef(onIndexChange)
  React.useEffect(() => {
    notifyRef.current = onIndexChange
  }, [onIndexChange])
  React.useEffect(() => {
    notifyRef.current?.(index)
  }, [index])

  /* ---- measure the stage so the 3D offsets scale with the viewport ---- */
  React.useEffect(() => {
    const node = stageRef.current
    if (!node) return

    if (typeof ResizeObserver === 'undefined') {
      setStageWidth(node.clientWidth)
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setStageWidth(entry.contentRect.width)
    })
    observer.observe(node)
    setStageWidth(node.clientWidth)

    return () => observer.disconnect()
  }, [])

  /* ---- pause autoplay in background tabs ------------------------------ */
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const sync = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  /* ---- navigation ----------------------------------------------------- */
  const goTo = React.useCallback(
    (next: number) => setIndex(() => wrapIndex(next, count)),
    [count],
  )
  const goNext = React.useCallback(
    () => setIndex((prev) => wrapIndex(prev + 1, count)),
    [count],
  )
  const goPrev = React.useCallback(
    () => setIndex((prev) => wrapIndex(prev - 1, count)),
    [count],
  )

  /* ---- autoplay ------------------------------------------------------- */
  const dwell = Math.max(MIN_INTERVAL, interval)
  const canAutoplay = autoplay && count > 1 && !reduceMotion
  const paused = dragging || hovering || focused || userPaused || !tabVisible
  const playing = canAutoplay && !paused

  React.useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setIndex((prev) => wrapIndex(prev + 1, count))
    }, dwell)
    return () => window.clearInterval(timer)
  }, [playing, dwell, count])

  /* ---- interaction handlers ------------------------------------------- */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        goNext()
        break
      case 'ArrowLeft':
        event.preventDefault()
        goPrev()
        break
      case 'Home':
        event.preventDefault()
        goTo(0)
        break
      case 'End':
        event.preventDefault()
        goTo(count - 1)
        break
      default:
        break
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType !== 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    pointerX.set(
      clampNumber(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
    )
    pointerY.set(
      clampNumber(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1),
    )
  }

  const resetPointer = () => {
    pointerX.set(0)
    pointerY.set(0)
  }

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    setDragging(false)
    if (count < 2) return
    // Velocity-aware snap: a short flick counts as much as a long slow drag.
    const travel = info.offset.x + info.velocity.x * 0.18
    const threshold = Math.max(48, (stageWidth || FALLBACK_WIDTH) * 0.16)
    if (travel <= -threshold) goNext()
    else if (travel >= threshold) goPrev()
  }

  /* ---- derived render data -------------------------------------------- */
  const { spread, depth, rotate } = stackMetrics(stageWidth)

  const transition: Transition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 220, damping: 26, mass: 0.9 }

  const active = count > 0 ? items[wrapIndex(index, count)] : undefined
  const activeAccent = active?.accent ?? 'var(--primary)'
  const showDots = count > 1 && count <= 12

  const visible = items
    .map((item, i) => ({ item, i, offset: relativeOffset(i, index, count) }))
    .filter((slot) => Math.abs(slot.offset) <= NEIGHBOURS)

  if (count === 0) return null

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured highlights"
      className={cn('relative w-full select-none', className)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false)
        resetPointer()
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return
        setFocused(false)
      }}
    >
      {/* ---- focus host: kept unmasked so the focus ring stays visible -- */}
      <div
        tabIndex={0}
        role="group"
        aria-label={`Card stack, ${count} ${count === 1 ? 'card' : 'cards'}. Use the left and right arrow keys to browse.`}
        onKeyDown={handleKeyDown}
        className="ring-focus relative w-full rounded-[32px]"
      >
        {/* ---- viewport: clips + softens the receding neighbours ------- */}
        <div
          className="relative w-full overflow-hidden rounded-[32px]"
          style={{ WebkitMaskImage: EDGE_MASK, maskImage: EDGE_MASK }}
        >
          {/* Accent floor reflection — remounts per card for a soft crossfade. */}
          <div
            key={`glow-${index}`}
            aria-hidden="true"
            className="animate-fade-in pointer-events-none absolute inset-x-10 bottom-3 h-20 blur-2xl"
            style={{
              background: `radial-gradient(52% 50% at 50% 50%, ${activeAccent} 0%, transparent 72%)`,
              opacity: 0.3,
            }}
          />

          {/* Perspective root. Every element between here and a 3D-transformed
            card must keep transform-style: preserve-3d, or the stack flattens. */}
          <div
            ref={stageRef}
            onPointerMove={handlePointerMove}
            onPointerLeave={resetPointer}
            className="relative h-[clamp(300px,88vw,380px)] w-full sm:h-[420px] lg:h-[464px]"
            style={{ perspective: '1400px' }}
          >
            <motion.div
              className={cn(
                'absolute inset-0 touch-pan-y [transform-style:preserve-3d]',
                count > 1 && 'cursor-grab active:cursor-grabbing',
              )}
              style={{ rotateX: tiltX, rotateY: tiltY }}
              drag={count > 1 ? 'x' : false}
              dragDirectionLock
              dragMomentum={false}
              dragElastic={0.16}
              dragConstraints={{ left: 0, right: 0 }}
              onDragStart={() => setDragging(true)}
              onDragEnd={handleDragEnd}
            >
              {visible.map(({ item, i, offset }) => {
                const distance = Math.abs(offset)
                const isActive = offset === 0
                const flat = reduceMotion

                return (
                  <div
                    key={`${item.id}-${i}`}
                    aria-hidden={isActive ? undefined : true}
                    role={isActive ? undefined : 'presentation'}
                    className="pointer-events-none absolute inset-0 flex items-center justify-center [transform-style:preserve-3d]"
                    style={{ zIndex: 30 - distance }}
                  >
                    <motion.div
                      initial={false}
                      animate={{
                        x: offset * spread,
                        z: flat ? 0 : -distance * depth,
                        rotateY: flat ? 0 : offset * rotate,
                        scale: 1 - distance * 0.11,
                        opacity: distance === 0 ? 1 : distance === 1 ? 0.74 : 0.42,
                      }}
                      transition={transition}
                      onPointerDown={(event) => {
                        pressXRef.current = event.clientX
                      }}
                      onClick={(event) => {
                        const start = pressXRef.current
                        pressXRef.current = null
                        if (isActive) return
                        // Swallow the click that ends a drag gesture.
                        if (start !== null && Math.abs(event.clientX - start) > 8)
                          return
                        goTo(i)
                      }}
                      /* A neighbour card's click is a pointer-only shortcut, not
                         the keyboard path: the focus host above handles arrow
                         keys and the prev/next buttons below are real buttons,
                         so this stays a presentational div rather than becoming
                         a second, aria-hidden tab stop. */
                      className={cn(
                        'pointer-events-auto aspect-[3/4] h-full max-w-[86vw] [backface-visibility:hidden] [transform-style:preserve-3d]',
                        !isActive && 'cursor-pointer',
                      )}
                    >
                      <motion.div
                        initial={false}
                        animate={{
                          filter: `blur(${distance * 1.8}px) brightness(${1 - distance * 0.12}) saturate(${1 - distance * 0.1})`,
                        }}
                        transition={transition}
                        className="h-full w-full"
                      >
                        <Skiper40Card item={item} className="h-full w-full" />
                      </motion.div>
                    </motion.div>
                  </div>
                )
              })}
            </motion.div>
          </div>
        </div>
      </div>

      {/* ---- live region ---------------------------------------------- */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {active ? `Card ${index + 1} of ${count}: ${active.title}` : ''}
      </p>

      {/* ---- controls -------------------------------------------------- */}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={goPrev}
          disabled={count < 2}
          aria-label="Previous card"
          className="ring-focus glass inline-flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>

        {showDots ? (
          <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
            {items.map((item, i) => {
              const isActive = i === index
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Go to card ${i + 1}: ${item.title}`}
                  aria-current={isActive}
                  /* h-11 + px-2 gives a 44px-tall hit target even though the
                     visible dot is only 6px tall — the row is absolutely
                     positioned content inside a fixed-height control, so the
                     extra height costs no layout. */
                  className="ring-focus group/dot inline-flex h-11 items-center justify-center rounded-full px-2"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'block h-1.5 rounded-full transition-all duration-300',
                      isActive
                        ? 'w-7 bg-primary'
                        : 'w-1.5 bg-foreground/25 group-hover/dot:bg-foreground/45',
                    )}
                  />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <span className="metric text-xs text-muted-foreground">
              {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={goNext}
          disabled={count < 2}
          aria-label="Next card"
          className="ring-focus glass inline-flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/10 disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      {/* ---- status strip ---------------------------------------------- */}
      <div className="mt-3 flex items-center gap-3">
        {showDots ? (
          <span className="metric shrink-0 text-xs text-muted-foreground">
            {String(index + 1).padStart(2, '0')}
            <span className="opacity-50"> / {String(count).padStart(2, '0')}</span>
          </span>
        ) : null}

        <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
          <MoveHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Swipe, drag or use the arrow keys</span>
        </span>

        {canAutoplay ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="hidden h-[3px] w-14 overflow-hidden rounded-full bg-foreground/12 sm:block"
            >
              {playing ? (
                <motion.span
                  key={`bar-${index}`}
                  className="block h-full origin-left rounded-full bg-primary"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: dwell / 1000, ease: 'linear' }}
                />
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setUserPaused((prev) => !prev)}
              aria-pressed={userPaused}
              aria-label={userPaused ? 'Resume autoplay' : 'Pause autoplay'}
              className="ring-focus inline-flex size-10 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:text-foreground"
            >
              {userPaused ? (
                <Play className="size-3.5" aria-hidden="true" />
              ) : (
                <Pause className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
