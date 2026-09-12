/* --------------------------------------------------------------------------
 * HowItWorksSheet — the 30-second explainer.
 * --------------------------------------------------------------------------
 * Reachable from the header and from the phone tab bar, so it has to answer the
 * three questions people actually ask before pointing a camera at their own eye:
 * what do I do, what happens to my photo, and what does the answer mean.
 *
 * A bottom sheet on a phone, a centred dialog from `sm` up. Base UI owns the
 * focus trap, the Escape handling, the scroll lock and the aria wiring; this
 * file owns the content and the motion, and the motion is CSS transitions keyed
 * off Base UI's data-[starting-style]/data-[ending-style] hooks so the
 * reduced-motion override in index.css can neutralise all of it.
 * -------------------------------------------------------------------------- */

import { Dialog } from '@base-ui/react/dialog'
import { Camera, Eye, Lightbulb, ShieldCheck, Sparkles, Stethoscope, X } from 'lucide-react'

const steps = [
  {
    icon: Eye,
    title: 'Expose the inner rim',
    body: 'Look up, then gently pull the skin below your lashes down until the moist inner rim of the lower lid shows.',
  },
  {
    icon: Camera,
    title: 'Let the checks go green',
    body: 'Hold the phone 15-20 cm away in even, indirect light. Framing, focus and brightness each have to pass before the shutter releases.',
  },
  {
    icon: Sparkles,
    title: 'Scored by a real AI model',
    body: 'Five colour and texture signals — pallor, redness, saturation, texture and illumination — are measured, sent securely, and scored by a trained model on our server.',
  },
  {
    icon: Stethoscope,
    title: 'Read it as a prompt, not a verdict',
    body: 'You get a risk band with a confidence figure. An elevated band is a reason to get a blood test, never a diagnosis by itself.',
  },
]

const tips = [
  'Daylight near a window beats overhead lighting.',
  'Remove glasses and clear away stray lashes or hair.',
  'Take a second scan if any capture check stayed amber.',
]

export function HowItWorksSheet({ children }: { children: React.ReactElement }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={children} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="glass fixed inset-x-3 bottom-3 z-50 max-h-[86dvh] overflow-y-auto overscroll-contain rounded-3xl p-5 outline-none transition-[opacity,transform] duration-300 data-[ending-style]:translate-y-3 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-3 data-[starting-style]:opacity-0 sm:inset-3 sm:m-auto sm:h-fit sm:w-full sm:max-w-md sm:p-6">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden"
          />

          <div className="mb-1 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-lg font-semibold tracking-tight text-foreground">
                How AnemiaScan works
              </Dialog.Title>
              <Dialog.Description className="text-sm leading-relaxed text-muted-foreground">
                Four steps, about thirty seconds, one free account.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close the how it works panel"
              className="ring-focus -mt-1.5 -mr-1.5 shrink-0 rounded-full p-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>

          <ol className="mt-5 flex flex-col gap-4">
            {steps.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3.5">
                <span className="relative grid size-9 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary">
                  <step.icon className="size-4" aria-hidden="true" />
                  <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-primary text-[9px] leading-none font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-5 rounded-2xl border border-border/70 bg-muted/30 p-3.5">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-foreground uppercase">
              <Lightbulb className="size-3.5 text-moderate" aria-hidden="true" />
              Get a cleaner scan
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {tips.map((tip) => (
                <li
                  key={tip}
                  className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground"
                >
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-safe" aria-hidden="true" />
            <span>
              Frames are analysed in memory and never saved to disk. AnemiaScan is a screening aid,
              not a diagnostic device — only a blood test can confirm anaemia.
            </span>
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
