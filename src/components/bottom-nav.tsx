/* --------------------------------------------------------------------------
 * BottomNav — the phone-only tab bar.
 * --------------------------------------------------------------------------
 * On a phone the header only carries identity, the theme control and the scan
 * CTA, so navigation lives down here inside thumb reach. It is a real tab list:
 * a <nav> landmark, a list, one button per destination, `aria-current="page"`
 * on the tab you are on, and labels that are always visible (icon-only tab bars
 * are one of the most common accessibility regressions in mobile web apps).
 *
 * Scan is the centre cell and deliberately the loudest thing on screen — it is
 * the one action the whole product exists for.
 *
 * Hidden from `md` up (the header takes over) and never rendered at all on the
 * immersive capture screens, which App.tsx controls.
 * -------------------------------------------------------------------------- */

import { motion, useReducedMotion } from 'motion/react'
import { BookOpen, History, House, Info, ScanEye, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { HowItWorksSheet } from '@/src/components/how-it-works-sheet'
import type { ScreenId } from '@/src/lib/types'

export interface BottomNavProps {
  active: ScreenId
  onHome: () => void
  onScan: () => void
  onHistory: () => void
  onLearn: () => void
  /** Shown as a small count on the History tab. */
  historyCount?: number
  className?: string
}

interface TabDescriptor {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  /** Screens that should light this tab up. */
  matches: ScreenId[]
  badge?: number
}

export function BottomNav({
  active,
  onHome,
  onScan,
  onHistory,
  onLearn,
  historyCount = 0,
  className,
}: BottomNavProps) {
  const reduceMotion = useReducedMotion()

  const tabs: TabDescriptor[] = [
    { id: 'home', label: 'Home', icon: House, onSelect: onHome, matches: ['home'] },
    { id: 'learn', label: 'Learn', icon: BookOpen, onSelect: onLearn, matches: ['learn'] },
    {
      id: 'history',
      label: 'History',
      icon: History,
      onSelect: onHistory,
      matches: ['history'],
      badge: historyCount,
    },
  ]

  const scanActive = active === 'scan' || active === 'processing'

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 md:hidden',
        className,
      )}
    >
      <ul className="mx-auto grid w-full max-w-md grid-cols-5 items-stretch gap-0.5 px-1.5 pt-1.5 pb-1">
        {tabs.slice(0, 2).map((tab) => (
          <TabButton key={tab.id} tab={tab} active={active} reduceMotion={reduceMotion} />
        ))}

        <li className="flex items-start justify-center">
          <button
            type="button"
            onClick={onScan}
            aria-label="Start a new eyelid scan"
            aria-current={scanActive ? 'page' : undefined}
            className="ring-focus group relative flex w-full flex-col items-center gap-1 rounded-2xl px-1 py-1.5"
          >
            <span
              className={cn(
                'relative grid size-11 place-items-center rounded-chip bg-linear-to-br from-primary to-chart-3 text-primary-foreground shadow-glow transition-transform',
                'motion-safe:group-active:scale-95',
              )}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-2xl bg-primary/40 blur-md"
              />
              <ScanEye className="size-5" aria-hidden="true" />
            </span>
            <span className="text-[10px] leading-none font-semibold tracking-tight text-foreground">
              Scan
            </span>
          </button>
        </li>

        {tabs.slice(2).map((tab) => (
          <TabButton key={tab.id} tab={tab} active={active} reduceMotion={reduceMotion} />
        ))}

        <li>
          <HowItWorksSheet>
            <button
              type="button"
              className="ring-focus flex w-full flex-col items-center gap-1 rounded-2xl px-1 py-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Info className="size-5" aria-hidden="true" />
              <span className="text-[10px] leading-none font-medium tracking-tight">Guide</span>
            </button>
          </HowItWorksSheet>
        </li>
      </ul>
    </nav>
  )
}

/* -------------------------------------------------------------------------- */

function TabButton({
  tab,
  active,
  reduceMotion,
}: {
  tab: TabDescriptor
  active: ScreenId
  reduceMotion: boolean | null
}) {
  const isActive = tab.matches.includes(active)
  const Icon = tab.icon
  const badge = tab.badge && tab.badge > 0 ? Math.min(tab.badge, 99) : 0

  return (
    <li className="relative">
      <button
        type="button"
        onClick={tab.onSelect}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'ring-focus relative flex w-full flex-col items-center gap-1 rounded-2xl px-1 py-2 transition-colors',
          isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span className="relative">
          <Icon className="size-5" aria-hidden="true" />
          {badge > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-primary px-1 text-[9px] leading-4 font-semibold text-primary-foreground"
            >
              {badge}
            </span>
          )}
        </span>
        <span className="text-[10px] leading-none font-medium tracking-tight">
          {tab.label}
          {badge > 0 && <span className="sr-only">, {badge} saved scans</span>}
        </span>

        {isActive &&
          (reduceMotion ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary"
            />
          ) : (
            <motion.span
              layoutId="bottom-nav-indicator"
              aria-hidden="true"
              className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          ))}
      </button>
    </li>
  )
}
