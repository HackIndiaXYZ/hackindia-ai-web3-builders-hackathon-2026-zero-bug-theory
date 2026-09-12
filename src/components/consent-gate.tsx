/* --------------------------------------------------------------------------
 * ConsentGate — the first-run understanding check.
 * --------------------------------------------------------------------------
 * A screening tool that shows a number has an obligation to say, once and
 * plainly, what that number is and is not before anyone sees it. This overlay
 * does exactly three things: it states what the app measures, it states that
 * the photo is analysed in memory and never saved to disk, and it states that
 * nothing here is a diagnosis. Then it asks for one explicit tick.
 *
 * It appears exactly once per browser. The acknowledgement is written to
 * localStorage under a versioned key, every access is guarded, and a browser
 * that refuses storage simply shows the notice again next visit — which is the
 * safe direction to fail in.
 *
 * Modal behaviour is hand-rolled rather than delegated, because this overlay
 * must not be dismissible by clicking away: focus is trapped inside the panel,
 * Tab and Shift+Tab cycle, background scrolling is locked, and Escape closes
 * the panel only once the acknowledgement has actually been ticked.
 * -------------------------------------------------------------------------- */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Check, Lock, ScanEye, ShieldCheck, Stethoscope } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/src/components/app-logo'

const STORAGE_KEY = 'anemiascan.consent.v1'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const POINTS = [
  {
    icon: ScanEye,
    title: 'What it does',
    body: 'It measures colour and texture signals in a photo of your inner lower eyelid and turns them into an anaemia risk band with a confidence figure.',
  },
  {
    icon: Lock,
    title: 'Your photo is never stored',
    body: 'The frame is sent securely for analysis, processed in memory and then discarded — never saved to disk. A free account is required to use the app, but your scan history lives only in this browser’s storage.',
  },
  {
    icon: Stethoscope,
    title: 'It is not a diagnosis',
    body: 'Only a blood test can confirm anaemia. Treat an elevated result as a reason to speak to a clinician, and never change medication or treatment based on a scan.',
  },
]

/** True once this browser has acknowledged the screening notice. */
export function hasAcknowledged(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === 'accepted'
  } catch {
    return false
  }
}

function rememberConsent(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, 'accepted')
  } catch {
    /* private mode or a full quota — the notice simply shows again next visit */
  }
}

export function ConsentGate({ onAccept }: { onAccept?: () => void }) {
  const reduceMotion = useReducedMotion()
  const [open, setOpen] = useState(() => !hasAcknowledged())
  const [agreed, setAgreed] = useState(false)
  const [nudge, setNudge] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const checkboxRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const uid = useId()
  const titleId = `consent-title-${uid}`
  const bodyId = `consent-body-${uid}`
  const hintId = `consent-hint-${uid}`

  const accept = useCallback(() => {
    rememberConsent()
    setOpen(false)
    onAccept?.()
  }, [onAccept])

  /* Scroll lock + initial focus + focus restoration ------------------------ */
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusTimer = window.setTimeout(() => {
      checkboxRef.current?.focus()
    }, 60)

    return () => {
      window.clearTimeout(focusTimer)
      root.style.overflow = previousOverflow
      // Hand focus back to whatever opened the notice, when that is something
      // real. On a cold first load nothing opened it — document.activeElement
      // was <body> — so focus would otherwise be dropped on <body> as the
      // "I understand" button unmounts. Fall back to the page's own first
      // heading (or the main landmark) so the keyboard user lands somewhere.
      const restore = restoreFocusRef.current
      if (restore && restore !== document.body && restore.isConnected) {
        restore.focus()
        return
      }
      const main = document.getElementById('main-content')
      const fallback = main?.querySelector<HTMLElement>('h1, h2') ?? main
      if (!fallback) return
      const borrowed = !fallback.hasAttribute('tabindex')
      if (borrowed) fallback.setAttribute('tabindex', '-1')
      fallback.focus({ preventScroll: true })
      if (borrowed) {
        fallback.addEventListener('blur', () => fallback.removeAttribute('tabindex'), {
          once: true,
        })
      }
    }
  }, [open])

  /* Focus containment ------------------------------------------------------
     Tab cycling is handled in the keydown trap below, but focus can also land
     outside the panel without a keypress (a click on the backdrop drops focus
     on <body>), so anything that focuses outside gets pulled straight back. */
  useEffect(() => {
    if (!open) return
    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current
      const target = event.target
      if (!panel || !(target instanceof Node) || panel.contains(target)) return
      checkboxRef.current?.focus()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [open])

  /* Focus trap ------------------------------------------------------------- */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (agreed) {
          accept()
        } else {
          setNudge(true)
          checkboxRef.current?.focus()
        }
        return
      }

      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      )
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [accept, agreed],
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto overscroll-contain bg-background/80 p-3 backdrop-blur-md sm:items-center sm:p-6"
      onKeyDown={onKeyDown}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.985 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduceMotion ? 0.18 : 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="glass grain relative my-auto flex w-full max-w-lg flex-col gap-5 rounded-3xl p-5 shadow-lift sm:p-7"
      >
        <div className="relative z-10 flex items-center gap-3">
          <AppLogo className="size-9 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
              Before you start
            </p>
            <h2
              id={titleId}
              className="text-balance text-lg leading-tight font-semibold tracking-tight text-foreground sm:text-xl"
            >
              AnemiaScan screens for risk. It does not diagnose.
            </h2>
          </div>
        </div>

        <p id={bodyId} className="relative z-10 text-sm leading-relaxed text-muted-foreground">
          Read these three things once. They are the whole contract between you and this app.
        </p>

        <ul className="relative z-10 flex flex-col gap-3">
          {POINTS.map((point) => (
            <li
              key={point.title}
              className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card/60 p-3.5"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-chip-sm border border-primary/25 bg-primary/10 text-primary">
                <point.icon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{point.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {point.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <label
          className={cn(
            'relative z-10 flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors',
            agreed
              ? 'border-safe/40 bg-safe/10'
              : nudge
                ? 'border-moderate/50 bg-moderate/10'
                : 'border-border bg-card/50 hover:border-primary/30',
          )}
        >
          <span className="relative mt-0.5 grid size-5 shrink-0 place-items-center">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={agreed}
              onChange={(event) => {
                setAgreed(event.target.checked)
                if (event.target.checked) setNudge(false)
              }}
              aria-describedby={hintId}
              className="peer size-5 cursor-pointer appearance-none rounded-md border border-border bg-background transition-colors checked:border-safe checked:bg-safe focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            />
            <Check
              aria-hidden="true"
              className="pointer-events-none absolute size-3.5 text-background opacity-0 transition-opacity peer-checked:opacity-100"
            />
          </span>
          <span className="text-[13px] leading-relaxed text-foreground">
            I understand that AnemiaScan estimates anaemia <strong>risk</strong> from an eyelid
            photo, that it is not a medical diagnosis, and that a clinician and a blood test are the
            only way to confirm a result.
          </span>
        </label>

        <p
          id={hintId}
          aria-live="polite"
          className={cn(
            'relative z-10 -mt-2 text-xs leading-relaxed',
            nudge && !agreed ? 'text-moderate' : 'text-muted-foreground',
          )}
        >
          {nudge && !agreed
            ? 'Please tick the box above to confirm you understand, then continue.'
            : 'Ticking this is required once. You can revisit the details any time from “How it works”.'}
        </p>

        <div className="relative z-10 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0 text-safe" aria-hidden="true" />
            Sent securely, analysed in memory, never saved to disk.
          </p>
          <Button
            size="lg"
            disabled={!agreed}
            onClick={accept}
            className="h-10 w-full rounded-full px-5 text-sm font-semibold sm:w-auto"
          >
            I understand — continue
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
