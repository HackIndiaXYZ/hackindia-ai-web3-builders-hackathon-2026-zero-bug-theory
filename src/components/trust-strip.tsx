/* --------------------------------------------------------------------------
 * TrustStrip — honest, architecture-level claims about how AnemiaScan runs.
 * --------------------------------------------------------------------------
 * Every claim here is a statement about THIS app's implementation: the real
 * screening call is scored by a trained model on our backend, the photo is
 * processed in memory and never written to disk, and history lives in
 * localStorage on this device. Nothing here asserts a certification, a
 * clinical trial, a partner or a user count, because none of those exist.
 *
 * Layout: a gentle, pausable marquee on narrow screens (where six cards would
 * otherwise stack into a dead column) and a static hairline grid from `md` up.
 * Only one of the two is ever in the accessibility tree, because the other is
 * `display: none` at that breakpoint.
 * -------------------------------------------------------------------------- */

import type { LucideIcon } from 'lucide-react'
import { CloudOff, Cpu, ShieldCheck, Timer, UserRoundX, WifiOff } from 'lucide-react'

import { cn } from '@/lib/utils'
import { SkiperMarquee } from '@/components/ui/skiper-marquee'

interface TrustClaim {
  icon: LucideIcon
  title: string
  body: string
}

const CLAIMS: TrustClaim[] = [
  {
    icon: Cpu,
    title: 'A real trained AI model',
    body: 'Your photo is scored by an actual trained model on our server — not a marketing black box, and not a guess.',
  },
  {
    icon: CloudOff,
    title: 'Processed, never stored',
    body: 'The photo is analysed in memory for one request, then discarded. Only a hash and the coded result are kept — never the image.',
  },
  {
    icon: UserRoundX,
    title: 'Just a free account',
    body: 'One quick sign-up, no payment, no clinical exam. Past scans are kept in this browser only, and you can wipe them in one tap.',
  },
  {
    icon: WifiOff,
    title: 'History works offline',
    body: 'Installable as a PWA. Past scans stay readable with no connection; a new scan needs one to reach the model.',
  },
  {
    icon: Timer,
    title: 'About 30 seconds',
    body: 'Frame your lower eyelid, capture, read the result. Roughly half a minute, start to finish.',
  },
  {
    icon: ShieldCheck,
    title: 'Screening, never a diagnosis',
    body: 'The result is a calibrated probability, the threshold it was judged against, and what it cannot see. A blood test is the real answer.',
  },
]

function ClaimChip({ claim }: { claim: TrustClaim }) {
  const { icon: Icon, title, body } = claim
  return (
    <div className="mr-3 flex w-[17.5rem] shrink-0 items-start gap-3 rounded-2xl border border-border bg-card/70 px-4 py-3.5">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-chip-sm border border-primary/25 bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm leading-snug font-semibold tracking-tight text-foreground">
          {title}
        </span>
        <span className="text-2xs leading-relaxed text-muted-foreground">{body}</span>
      </span>
    </div>
  )
}

export function TrustStrip({ className }: { className?: string }) {
  return (
    <section
      aria-labelledby="trust-heading"
      className={cn('relative w-full border-y border-border/70 bg-card/25 py-14 lg:py-20', className)}
    >
      <div className="mx-auto w-full max-w-6xl px-6 lg:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex max-w-xl flex-col gap-2">
            <span className="text-2xs font-medium tracking-[0.22em] text-primary uppercase">
              How it is built / 04
            </span>
            <h2
              id="trust-heading"
              className="display text-display-sm text-foreground sm:text-display"
            >
              Private by architecture, not by promise
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            The result comes from a real trained AI model on our server: the photo goes up over
            HTTPS, is scored in memory and is never written to disk. Your scan history stays in
            this browser, where it reads offline and wipes in one tap.
          </p>
        </div>
      </div>

      {/* Narrow screens: a slow band with its own pause control — hover and
          focus-within never fire on the touch devices this branch renders on. */}
      <div className="mt-9 md:hidden">
        <SkiperMarquee speed={46} className="px-6" label="list of privacy claims">
          {CLAIMS.map((claim) => (
            <ClaimChip key={claim.title} claim={claim} />
          ))}
        </SkiperMarquee>
      </div>

      {/* md and up: a calm hairline grid. */}
      <div className="mx-auto mt-10 hidden w-full max-w-6xl px-6 md:block lg:px-10">
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border bg-border lg:grid-cols-3">
          {CLAIMS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="card-hover flex flex-col gap-3 border-0 bg-card px-6 py-7"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-chip border border-primary/25 bg-primary/10 text-primary">
                <Icon className="size-[1.15rem]" aria-hidden="true" />
              </span>
              <h3 className="text-sm leading-snug font-semibold tracking-tight text-foreground">
                {title}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
