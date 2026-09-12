/* --------------------------------------------------------------------------
 * Faq — an accessible, animated accordion of real questions.
 * --------------------------------------------------------------------------
 * Pattern: each question is an <h3> containing the only interactive element (a
 * <button aria-expanded aria-controls>), and each answer is a labelled region.
 * Closed panels are unmounted rather than merely visually collapsed, so they
 * never linger in the accessibility tree or take focus. Multiple panels may be
 * open at once, and a single control expands or collapses the whole set.
 *
 * Copy rule: every answer stays inside what an image-based screen can honestly
 * claim. No accuracy percentages, no citations, no regulatory language, and no
 * haemoglobin figure — this tool photographs tissue, it does not measure blood.
 * -------------------------------------------------------------------------- */

import * as React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, BookOpen, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface FaqEntry {
  id: string
  question: string
  /** Paragraphs. Rendered in order; keep each one short enough to scan. */
  answer: string[]
}

const ENTRIES: FaqEntry[] = [
  {
    id: 'what-it-measures',
    question: 'What is AnemiaScan actually measuring?',
    answer: [
      'It measures colour, not blood. When you capture your lower eyelid, the photo is uploaded over HTTPS; our server locates the exposed palpebral conjunctiva inside it, checks the crop is something the model can actually read, and scores that crop with a trained two-CNN ensemble.',
      'What comes back is a calibrated screening probability — how anaemia-like this photograph looks — judged against a fixed operating threshold to give one of three outcomes: lower risk, higher risk, or uncertain when the probability sits too close to that threshold to call. No haemoglobin figure appears anywhere in the app, because nothing here can measure one.',
    ],
  },
  {
    id: 'why-eyelid',
    question: 'Why the inside of the eyelid and not, say, a fingertip?',
    answer: [
      'The palpebral conjunctiva is one of the few places where a thin, transparent membrane sits directly over a dense capillary bed with no pigmented skin in the way. That means the colour you see is close to the colour of the blood underneath it.',
      'Clinicians have inspected conjunctival pallor at the bedside for a very long time, and because the site is largely free of melanin, it behaves more consistently across skin tones than a palm or a nail bed. That is exactly why it is the site an image-based screen would choose.',
    ],
  },
  {
    id: 'accuracy',
    question: 'How accurate is it?',
    answer: [
      'We will not give you a number, because an honest one does not exist for this build. AnemiaScan runs a real trained model, but not one validated against laboratory haemoglobin results in a clinical study. Eyelid-pallor screening is an active research area, and the published work in that area does not transfer to this model running on an unknown phone camera in unknown light.',
      'What the app does instead is show its work: the calibrated probability, the fixed threshold it was judged against, the measured quality of your capture, and an explicit uncertain outcome when the two are too close to separate. Treat a result as a prompt to get tested, never as a number to act on.',
    ],
  },
  {
    id: 'lighting',
    question: 'What lighting and framing give a usable scan?',
    answer: [
      'Bright, indirect daylight is the best case — near a window, facing the light, with nothing coloured bouncing onto your face. Avoid direct sun (it blows out the highlights), avoid coloured LEDs and avoid a screen as your light source, because both shift white balance and the app reads colour.',
      'Hold the camera roughly 15–20 cm away, gently pull the lower lid down so the moist inner surface is clearly exposed, fill the guide frame with it, and hold still until the frame reads as ready. Take glasses off, skip beauty filters and skip any app that auto-enhances colour.',
    ],
  },
  {
    id: 'privacy',
    question: 'Is my photo uploaded anywhere?',
    answer: [
      'Yes — the captured photo is sent securely to AnemiaScan’s backend, where a real trained AI model analyses it in memory. The image is never written to disk or a database; only a sha256 hash of it and your coded result — the outcome, the screening probability and the capture-quality score — are kept.',
      'Scan history itself is stored in this browser only, using local storage, and the Clear history action removes it immediately. Using AnemiaScan does require a free account, but your history is not synced to it or shared with a third party.',
    ],
  },
  {
    id: 'higher-risk-result',
    question: 'My result says Higher risk. What should I do?',
    answer: [
      'Book a haemoglobin test — a full blood count is cheap, fast and definitive, and it is the only thing that can confirm or rule out anaemia. Bring the screening result and any symptoms you have noticed: fatigue that rest does not fix, breathlessness on stairs, dizziness, cold hands, pica, or heavy periods.',
      'Do not start iron supplements on your own. The wrong dose can cause real harm, and self-treating can mask a cause that needs finding — blood loss, a malabsorption problem or a vitamin deficiency all look similar from the outside. And if you have chest pain, fainting, a racing heart or visible blood loss, treat that as urgent and seek care now.',
    ],
  },
  {
    id: 'lower-risk-result',
    question: 'My result says Lower risk. Am I in the clear?',
    answer: [
      'Not necessarily. A photo can only see the colour of one small patch of tissue at one moment. Early or mild anaemia can look completely normal, and a well-lit, slightly overexposed capture can push the probability down.',
      'Symptoms outrank any screening result. If you feel unusually tired, breathless or lightheaded, ask for a blood test regardless of what this app said.',
    ],
  },
  {
    id: 'uncertain-result',
    question: 'My result says Uncertain. Did the scan fail?',
    answer: [
      'No — the scan worked and the model declined to call it. Uncertain means the calibrated probability landed inside the margin around the operating threshold, or the two candidate models disagreed with each other. Saying so is more useful than rounding a coin-flip to whichever answer happens to be nearer.',
      'Read it as neither reassurance nor alarm. Re-scan in bright, indirect daylight to see whether it settles, and let your symptoms decide whether to ask for a blood test — they outrank anything this app reports.',
    ],
  },
  {
    id: 'limits',
    question: 'Who should not rely on this at all?',
    answer: [
      'Anyone who is pregnant, an infant or young child, someone with a known blood disorder such as thalassaemia or sickle cell disease, anyone on dialysis or in cancer treatment, and anyone with an eye infection, conjunctivitis, recent eye injury or eye surgery. In all of those cases the tissue colour, the risk itself or both fall well outside anything this model was trained on.',
      'The same goes for anyone acting on a result in place of care. This is a nudge toward a blood test, and it is only useful if the nudge leads to one.',
    ],
  },
]

interface FaqProps {
  className?: string
  /** Optional deep link into the educational screen. */
  onLearn?: () => void
}

export function Faq({ className, onLearn }: FaqProps) {
  const reduceMotion = useReducedMotion() ?? false
  const [open, setOpen] = React.useState<string[]>([ENTRIES[0].id])

  const allOpen = open.length === ENTRIES.length

  const toggle = React.useCallback((id: string) => {
    setOpen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const toggleAll = React.useCallback(() => {
    setOpen((prev) => (prev.length === ENTRIES.length ? [] : ENTRIES.map((e) => e.id)))
  }, [])

  return (
    <section
      aria-labelledby="faq-heading"
      className={cn('w-full py-16 lg:py-24', className)}
    >
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16 lg:px-10">
        <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <span className="text-2xs font-medium tracking-[0.22em] text-primary uppercase">
            Questions / 05
          </span>
          <h2 id="faq-heading" className="display text-display-sm text-foreground sm:text-display">
            What this can — and cannot — tell you
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Screening tools earn trust by being specific about their limits. These are the answers we
            would want before pointing a camera at our own eye.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              variant="outline"
              size="lg"
              onClick={toggleAll}
              className="h-10 rounded-full px-4 text-xs"
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
            {onLearn ? (
              <Button
                variant="ghost"
                size="lg"
                onClick={onLearn}
                className="h-10 rounded-full px-4 text-xs text-primary"
              >
                <BookOpen className="size-4" data-icon="inline-start" aria-hidden="true" />
                Read the full guide
                <ArrowRight className="size-3.5" data-icon="inline-end" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>

        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {ENTRIES.map((entry) => {
            const isOpen = open.includes(entry.id)
            const buttonId = `faq-trigger-${entry.id}`
            const panelId = `faq-panel-${entry.id}`

            return (
              <li key={entry.id} className="min-w-0">
                <h3 className="m-0">
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggle(entry.id)}
                    className="ring-focus flex w-full items-start justify-between gap-4 rounded-lg px-1 py-5 text-left transition-colors hover:text-primary"
                  >
                    <span className="text-balance text-[0.975rem] leading-snug font-medium tracking-tight text-foreground">
                      {entry.question}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground',
                        isOpen && 'border-primary/40 bg-primary/10 text-primary',
                        !reduceMotion && 'transition-all duration-300',
                      )}
                    >
                      <Plus
                        className={cn(
                          'size-3.5',
                          !reduceMotion && 'transition-transform duration-300',
                          isOpen && 'rotate-45',
                        )}
                      />
                    </span>
                  </button>
                </h3>

                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.div
                      key={panelId}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { duration: 0.32, ease: 'easeOut' }
                      }
                      className="overflow-hidden"
                    >
                      <div
                        id={panelId}
                        role="region"
                        aria-labelledby={buttonId}
                        className="flex flex-col gap-3 px-1 pb-6"
                      >
                        {entry.answer.map((paragraph, i) => (
                          <p
                            key={i}
                            className="max-w-prose text-sm leading-relaxed text-pretty text-muted-foreground"
                          >
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
