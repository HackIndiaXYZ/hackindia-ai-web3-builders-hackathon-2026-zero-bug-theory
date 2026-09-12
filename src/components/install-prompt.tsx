/* --------------------------------------------------------------------------
 * InstallPrompt — a quiet, honest install affordance.
 * --------------------------------------------------------------------------
 * Chromium fires `beforeinstallprompt` only when the page is genuinely
 * installable and not already installed. This component does nothing until that
 * happens, which means desktop Safari, Firefox, in-app browsers and anyone who
 * already installed the PWA never see a dead "Install" button.
 *
 * The deferred event is single-use: once `prompt()` has been called the stored
 * event is thrown away. A dismissal is remembered so the card never nags twice,
 * and it waits a beat after the event so it does not land on top of the
 * first-run consent notice.
 * -------------------------------------------------------------------------- */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Download, WifiOff, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/src/components/app-logo'

const STORAGE_KEY = 'anemiascan.install.v1'

/** Not in lib.dom yet — this is the Chromium install-prompt event shape. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

function wasHandled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

function remember(outcome: 'installed' | 'dismissed'): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, outcome)
  } catch {
    /* storage unavailable — worst case the card can appear once more */
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
  } catch {
    /* matchMedia unsupported */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function InstallPrompt({
  enabled = true,
  className,
}: {
  /** App passes false while the first-run consent notice still owns the screen. */
  enabled?: boolean
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (wasHandled() || isStandalone()) return

    let revealTimer = 0

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      // Chromium can dispatch this more than once — a deferred event dropped
      // without prompt() resolving, or a history-state change, and this app
      // pushes a history entry on every screen transition. Clearing first means
      // only one timer is ever outstanding, so the cleanup can actually cancel
      // it instead of leaving earlier ones to fire after unmount.
      window.clearTimeout(revealTimer)
      deferredRef.current = event as BeforeInstallPromptEvent
      revealTimer = window.setTimeout(() => setReady(true), 1800)
    }

    const onInstalled = () => {
      deferredRef.current = null
      remember('installed')
      setReady(false)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.clearTimeout(revealTimer)
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    const event = deferredRef.current
    if (!event) {
      setReady(false)
      return
    }
    setBusy(true)
    try {
      await event.prompt()
      const choice = await event.userChoice
      remember(choice.outcome === 'accepted' ? 'installed' : 'dismissed')
    } catch {
      /* the browser refused or the event went stale — drop it either way */
      remember('dismissed')
    } finally {
      // The deferred event may only be used once.
      deferredRef.current = null
      setBusy(false)
      setReady(false)
    }
  }, [])

  const dismiss = useCallback(() => {
    deferredRef.current = null
    remember('dismissed')
    setReady(false)
  }, [])

  if (!ready || !enabled) return null

  return (
    <motion.aside
      aria-label="Install AnemiaScan"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0.18 : 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'glass fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-sm items-start gap-3 rounded-2xl p-3.5 shadow-lift',
        'md:right-6 md:left-auto md:mx-0',
        className,
      )}
    >
      <AppLogo className="mt-0.5 size-8 shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight text-foreground">Install AnemiaScan</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Opens full screen from your home screen. Your saved scans stay readable with no
          connection — a new scan needs one to reach our AI model.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <Button
            size="lg"
            onClick={install}
            disabled={busy}
            className="h-9 rounded-full px-3.5 text-[13px] font-semibold"
          >
            <Download className="size-4" data-icon="inline-start" aria-hidden="true" />
            {busy ? 'Opening…' : 'Install app'}
          </Button>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <WifiOff className="size-3.5" aria-hidden="true" />
            Offline history
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss the install suggestion"
        className="ring-focus -mt-1.5 -mr-1.5 shrink-0 rounded-full p-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </motion.aside>
  )
}
