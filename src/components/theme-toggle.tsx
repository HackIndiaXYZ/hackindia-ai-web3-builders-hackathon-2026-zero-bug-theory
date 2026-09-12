/* --------------------------------------------------------------------------
 * ThemeToggle — light / dark / system in one control.
 * --------------------------------------------------------------------------
 * One button that cycles the three states, because a phone header has no room
 * for a segmented control and a cycle is one tap instead of two. The current
 * state is always visible (icon, plus a text label from `lg` up) and always
 * announced: the accessible name says where you are and where the next press
 * takes you, and a polite live region confirms the change for screen readers
 * who never see the icon swap.
 *
 * Persistence, the `dark` class on <html> and the <meta name="theme-color">
 * entries are all theme.ts's job — the chrome colour pair lives there once, as
 * THEME_COLOR, so boot and this control can never drift apart. `applyTheme`
 * already syncs the metas; the explicit call below keeps the 'system' case
 * honest, where each entry hands itself back to its own media query.
 * -------------------------------------------------------------------------- */

import { useCallback, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  syncThemeColor,
  type Theme,
} from '@/src/lib/theme'

/** The cycle order. Light -> dark -> follow the OS -> back to light. */
const ORDER: Theme[] = ['light', 'dark', 'system']

const PRESENTATION: Record<Theme, { label: string; icon: LucideIcon; hint: string }> = {
  light: { label: 'Light', icon: Sun, hint: 'Light theme' },
  dark: { label: 'Dark', icon: Moon, hint: 'Dark theme' },
  system: { label: 'System', icon: Monitor, hint: 'Matches your device' },
}

export function ThemeToggle({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion()
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const [announcement, setAnnouncement] = useState('')

  const nextTheme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]

  const cycle = useCallback(() => {
    const target = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    applyTheme(target)
    syncThemeColor(target)
    setTheme(target)
    setAnnouncement(
      target === 'system'
        ? `Theme now follows your device, currently ${resolveTheme(target)}.`
        : `${PRESENTATION[target].label} theme on.`,
    )
  }, [theme])

  const current = PRESENTATION[theme]
  const upcoming = PRESENTATION[nextTheme]
  const Icon = current.icon

  return (
    <>
      <button
        type="button"
        onClick={cycle}
        aria-label={`Theme: ${current.label}. ${current.hint}. Press to switch to ${upcoming.label}.`}
        title={`Theme: ${current.label} — switch to ${upcoming.label}`}
        className={cn(
          'ring-focus group inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border/70 bg-card/55 px-2.5 text-muted-foreground transition-colors',
          'hover:border-primary/35 hover:bg-card hover:text-foreground',
          'lg:px-3',
          className,
        )}
      >
        <span className="relative grid size-4 shrink-0 place-items-center">
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={theme}
              className="absolute inset-0 grid place-items-center"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, rotate: -75, scale: 0.6 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 75, scale: 0.6 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <Icon className="size-4" aria-hidden="true" />
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="hidden text-xs font-medium tracking-tight lg:inline">{current.label}</span>
      </button>

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  )
}
