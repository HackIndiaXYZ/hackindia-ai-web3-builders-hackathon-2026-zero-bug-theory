/* --------------------------------------------------------------------------
 * HeroShowcase — the product story, told as a draggable card stack.
 * --------------------------------------------------------------------------
 * Wraps the skiper40 3D carousel with six chapters that mirror the real flow of
 * the app: capture, the upload and the checks it has to clear, the model,
 * insights, trends, and handing the result to a clinician.
 *
 * The active card also drives a live detail line beneath the stack (via
 * skiper40's `onIndexChange`), so the section explains itself for anyone who
 * never drags it. No external imagery is referenced — each card paints an
 * accent-tinted field, which is guaranteed to exist in every build.
 * -------------------------------------------------------------------------- */

import * as React from 'react'
import { Layers } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Skiper40, type Skiper40Item } from '@/components/ui/skiper40'

interface StoryChapter extends Skiper40Item {
  /** Expanded explanation shown under the stack for the active card. */
  detail: string
  /** Two or three concrete nouns for the chapter's micro-legend. */
  facets: string[]
}

const CHAPTERS: StoryChapter[] = [
  {
    id: 'capture',
    caption: 'Step 01 · Capture',
    title: 'A steady frame of the lower lid',
    subtitle:
      'A live guide frame checks light, focus and framing before it lets you shoot, so you are not scoring a blurry photo.',
    accent: 'var(--primary)',
    detail:
      'The camera preview runs entirely in the page. Three readiness checks — illumination, edge contrast and how much of the guide the conjunctiva fills — have to pass together before the shutter arms. That is what keeps a dark or off-centre frame out of the model in the first place.',
    facets: ['Live readiness checks', 'Front or rear camera', 'Sent securely, never stored'],
  },
  {
    id: 'checks',
    caption: 'Step 02 · Upload and checks',
    title: 'The frame has to earn a score',
    subtitle:
      'The photo goes up over HTTPS, the conjunctiva is located inside it, and anything the model cannot read is refused with a named reason.',
    accent: 'var(--chart-3)',
    detail:
      'Nothing is scored until the server has found the conjunctiva, measured brightness, focus and clipping, and checked how far the crop sits from the data the model was trained on. A frame that fails comes back as a recapture request naming what went wrong — too dark, out of focus, no region found — rather than a number nobody should trust.',
    facets: ['Conjunctiva located', 'Quality measured, not assumed', 'Refused with a reason'],
  },
  {
    id: 'model',
    caption: 'Step 03 · Risk model',
    title: 'One trained model, one calibrated number',
    subtitle:
      'A two-CNN ensemble scores the crop and returns a calibrated probability, judged against a fixed operating threshold.',
    accent: 'var(--chart-4)',
    detail:
      'The threshold is fixed in advance and shown to you, so the same photo always lands on the same side of it. When the probability sits inside the margin around that threshold — or the two candidate models disagree with each other — the result is reported as uncertain rather than rounded to whichever answer is nearer.',
    facets: ['Calibrated probability', 'A fixed, published threshold', 'Uncertain is a real answer'],
  },
  {
    id: 'insights',
    caption: 'Step 04 · Insights',
    title: 'Plain language, and what to do next',
    subtitle:
      'Each result comes with what the number means, what could have skewed it, and concrete, safe next steps.',
    accent: 'var(--moderate)',
    detail:
      'The insights view reads the result back in sentences: how readable your capture actually was, what a benign explanation would look like, and what a genuine one would. Advice stays inside safe ground — get a haemoglobin test, do not self-prescribe iron, and treat urgent symptoms as urgent.',
    facets: ['Plain-language result', 'Confounders named', 'Safe next steps'],
  },
  {
    id: 'trends',
    caption: 'Step 05 · Trends',
    title: 'One scan is a dot, several are a line',
    subtitle:
      'Scans are kept locally so you can watch a direction of travel instead of over-reading a single snapshot.',
    accent: 'var(--chart-6)',
    detail:
      'History lives in this browser only, capped and trimmed so it can never overflow storage, and it stays readable with no connection. The trend chart plots your screening probabilities over time, which is the honest way to read a colour measurement: change over several captures is far more meaningful than any one reading.',
    facets: ['Stored in this browser', 'Probability over time', 'Clear it in one tap'],
  },
  {
    id: 'share',
    caption: 'Step 06 · Share',
    title: 'Something useful to hand a clinician',
    subtitle:
      'A result you can show at an appointment: the outcome, the probability, the capture quality and the date.',
    accent: 'var(--safe)',
    detail:
      'The point of a screen is the conversation it starts. A result summarises what the model returned and how readable your capture was, in a form you can show to a nurse or doctor — alongside the reminder, printed on every screen, that only a blood test can confirm anaemia.',
    facets: ['Readable summary', 'Dated and scored', 'Blood test still decides'],
  },
]

export function HeroShowcase({ className }: { className?: string }) {
  const [active, setActive] = React.useState(0)
  const chapter = CHAPTERS[active] ?? CHAPTERS[0]

  const handleIndexChange = React.useCallback((index: number) => {
    setActive(index)
  }, [])

  return (
    <section
      aria-labelledby="showcase-heading"
      className={cn('relative w-full overflow-hidden py-16 lg:py-24', className)}
    >
      <div className="mx-auto w-full max-w-6xl px-6 lg:px-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex max-w-xl flex-col gap-2">
            <span className="text-2xs font-medium tracking-[0.22em] text-primary uppercase">
              The flow / 02
            </span>
            <h2
              id="showcase-heading"
              className="display text-display-sm text-foreground sm:text-display"
            >
              Six steps, none of them hidden
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Drag the stack, or use the arrow keys. Every stage of the screen is visible to you,
            including the parts that decide to trust a photo less.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14">
          <Skiper40
            items={CHAPTERS}
            autoplay
            interval={5200}
            onIndexChange={handleIndexChange}
          />

          {/* Live detail panel, driven by the active card.
              Deliberately NOT a live region: skiper40 already announces
              "Card N of 6: <title>" politely on every change, and putting
              aria-live here would re-read a ~90-word panel every 5.2s while the
              user is trying to read anything else on the page. */}
          <div className="glass flex flex-col gap-4 rounded-3xl p-6 lg:p-8">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-2xs font-medium tracking-[0.16em] text-primary uppercase">
              <Layers className="size-3.5" aria-hidden="true" />
              {chapter.caption ?? 'Chapter'}
            </span>

            <h3 className="text-balance text-display-xs text-foreground">{chapter.title}</h3>

            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
              {chapter.detail}
            </p>

            <ul className="mt-1 flex flex-col gap-2 border-t border-border/70 pt-4">
              {chapter.facets.map((facet) => (
                <li
                  key={facet}
                  className="flex items-center gap-2.5 text-xs text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-primary"
                  />
                  {facet}
                </li>
              ))}
            </ul>

            <p className="metric text-2xs text-muted-foreground">
              {String(active + 1).padStart(2, '0')}
              <span className="opacity-60"> / {String(CHAPTERS.length).padStart(2, '0')}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
