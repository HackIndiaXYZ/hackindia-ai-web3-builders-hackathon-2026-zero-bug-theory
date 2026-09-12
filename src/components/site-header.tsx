/* --------------------------------------------------------------------------
 * SiteHeader — sticky app chrome.
 * --------------------------------------------------------------------------
 * Transparent while you are at the top of a screen so the hero artwork can run
 * edge to edge, then frosted the moment the page moves so text never collides
 * with content scrolling underneath it.
 *
 * Two layouts out of one markup tree: from `md` the section links live here;
 * below that they move to BottomNav and the header keeps only identity, the
 * theme control and the scan CTA. Nothing has a fixed width, the wordmark is
 * allowed to truncate, and the row never wraps — so a 390px viewport can't be
 * pushed into a sideways scroll.
 *
 * The doctor portal is a separate workspace with its own full-bleed header
 * (see DoctorPortal), so its link lives in the overflow of section links
 * rather than getting bottom-nav real estate of its own.
 * -------------------------------------------------------------------------- */

import { useEffect, useState } from 'react'
import { BookOpen, History, Link2, LogOut, ScanEye, Stethoscope } from 'lucide-react'
import type { User } from 'firebase/auth'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/src/components/app-logo'
import { HowItWorksSheet } from '@/src/components/how-it-works-sheet'
import { ThemeToggle } from '@/src/components/theme-toggle'
import type { ScreenId } from '@/src/lib/types'

export interface SiteHeaderProps {
  onHome: () => void
  onLearn: () => void
  onBlockchain: () => void
  onHistory: () => void
  onScan: () => void
  onDoctorPortal: () => void
  /** Drives `aria-current` so assistive tech knows where it is. */
  active: ScreenId
  /** Saved scan count, surfaced next to the History link. */
  historyCount?: number
  /**
   * The signed-in Firebase user, or null. Only the doctor portal requires
   * sign-in — the scanner itself is the public landing-page flow and stays
   * reachable without any auth, so this header renders in both states.
   */
  user: User | null
  onSignOut: () => void
  className?: string
}

export function SiteHeader({
  onHome,
  onLearn,
  onBlockchain,
  onHistory,
  onScan,
  onDoctorPortal,
  active,
  historyCount = 0,
  user,
  onSignOut,
  className,
}: SiteHeaderProps) {
  const [lifted, setLifted] = useState(false)

  useEffect(() => {
    let frame = 0
    const read = () => {
      frame = 0
      setLifted(window.scrollY > 8)
    }
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <header
      className={cn(
        'safe-top sticky top-0 z-50 w-full transition-[background-color,box-shadow,border-color] duration-300',
        lifted
          ? 'glass rounded-none border-x-0 border-t-0 border-b border-border/70 shadow-soft'
          : 'border-b border-transparent bg-transparent',
        className,
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6 lg:px-10">
        <button
          type="button"
          onClick={onHome}
          aria-label="AnemiaScan — go to the home screen"
          aria-current={active === 'home' ? 'page' : undefined}
          className="ring-focus -ml-1 flex min-w-0 shrink items-center gap-2.5 rounded-xl px-1 py-1 text-left"
        >
          <AppLogo className="size-7 shrink-0 sm:size-8" />
          <span className="flex min-w-0 flex-col items-start gap-0.5 leading-none">
            <span className="truncate text-[15px] font-semibold tracking-tight text-foreground sm:text-base">
              AnemiaScan
            </span>
            <span className="hidden text-[9.5px] font-medium tracking-[0.16em] text-muted-foreground uppercase sm:block">
              Screening aid
            </span>
          </span>
        </button>

        <nav aria-label="Sections" className="ml-3 hidden items-center gap-0.5 md:flex lg:ml-6">
          <HeaderLink
            label="Learn"
            icon={BookOpen}
            onSelect={onLearn}
            current={active === 'learn'}
          />
          <HeaderLink
            label="History"
            icon={History}
            onSelect={onHistory}
            current={active === 'history'}
            count={historyCount}
          />
          <HeaderLink
            label="Proof & care"
            icon={Link2}
            onSelect={onBlockchain}
            current={active === 'blockchain'}
          />
          <HowItWorksSheet>
            <button
              type="button"
              className="ring-focus inline-flex h-9 items-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              How it works
            </button>
          </HowItWorksSheet>
          <HeaderLink
            label="Doctor portal"
            icon={Stethoscope}
            onSelect={onDoctorPortal}
            current={active === 'doctor'}
          />
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          <Button
            size="lg"
            onClick={onScan}
            aria-current={active === 'scan' ? 'page' : undefined}
            className="h-9 rounded-full px-3 text-[13px] font-semibold sm:px-4 sm:text-sm"
          >
            <ScanEye className="size-4" data-icon="inline-start" aria-hidden="true" />
            Scan
          </Button>
          {user && (
            <button
              type="button"
              onClick={onSignOut}
              title={`Sign out ${user.displayName ?? user.email ?? ''}`}
              aria-label="Sign out"
              className="ring-focus inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

/* -------------------------------------------------------------------------- */

function HeaderLink({
  label,
  icon: Icon,
  onSelect,
  current,
  count = 0,
}: {
  label: string
  icon: typeof BookOpen
  onSelect: () => void
  current: boolean
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'ring-focus inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
        current
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
      {count > 0 && (
        <span
          className={cn(
            'ml-0.5 rounded-full px-1.5 text-[10px] leading-4 font-semibold tabular-nums',
            current ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {Math.min(count, 99)}
          <span className="sr-only"> saved scans</span>
        </span>
      )}
    </button>
  )
}
