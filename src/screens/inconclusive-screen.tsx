import { motion, useReducedMotion, type Variants } from 'motion/react'
import {
  Activity,
  ArrowLeft,
  Crosshair,
  EyeOff,
  Focus,
  Gauge,
  Hand,
  ImageOff,
  Lightbulb,
  Moon,
  MoveHorizontal,
  Palette,
  RotateCcw,
  ScanEye,
  ShieldAlert,
  Sun,
  TriangleAlert,
  WifiOff,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { RecaptureReason } from '@/src/lib/types'

interface Cause {
  icon: typeof Sun
  title: string
  body: string
}

/**
 * Generic causes, shown only when the server did not name a reason.
 *
 * When it did name one — and it names one on every refused capture — the
 * specific block below replaces this, because "one of these four things might
 * have happened" is a much worse answer than "no inner eyelid was found in the
 * frame".
 */
const CAUSES: Cause[] = [
  {
    icon: Sun,
    title: 'Not enough light reached the eyelid',
    body: 'Indoor light at night, or a window behind you, leaves the tissue in shadow even when the room looks bright.',
  },
  {
    icon: Hand,
    title: 'The inner rim stayed hidden',
    body: 'If the eyelid is not pulled far enough down, the lens mostly sees lashes and skin instead of conjunctiva.',
  },
  {
    icon: Zap,
    title: 'A flash or direct lamp blew out the colour',
    body: 'Harsh light straight onto wet tissue clips the red channel, so the reading has no colour left to measure.',
  },
  {
    icon: MoveHorizontal,
    title: 'The camera was too close or moving',
    body: 'Very close framing blocks the light and blurs the fine vessels the screening depends on.',
  },
]

/**
 * One entry per reason code the screening service can return (see the
 * `RecaptureReason` union in src/lib/types.ts).
 *
 * `body` says what the server actually measured; `fix` says what to change.
 * Neither invents a cause the server did not report — several of these codes
 * mean "the model refused to judge this input", which is a different statement
 * from "your photo was bad", and the copy keeps that distinction.
 */
const REASONS: Record<RecaptureReason, Cause & { fix: string }> = {
  roi_too_small: {
    icon: Crosshair,
    title: 'The eyelid filled too little of the frame',
    body: 'The conjunctiva was found, but the crop was too few pixels across to read reliably.',
    fix: 'Move the phone closer — about 15–20 cm — and let the inner rim fill the middle of the reticle.',
  },
  roi_coverage_low: {
    icon: Hand,
    title: 'Only a sliver of the inner rim was showing',
    body: 'Too little conjunctiva was visible in the frame for the reading to be representative.',
    fix: 'Look upward and hold the skin under your lower lashes down a moment longer, until the moist rim is clearly exposed.',
  },
  no_roi_detected: {
    icon: EyeOff,
    title: 'No inner eyelid was found in the frame',
    body: 'The server could not locate conjunctiva tissue anywhere in the photo.',
    fix: 'Frame the lower eyelid itself, everted so the moist inner rim faces the camera — not the whole eye, face or surroundings.',
  },
  extremely_dark: {
    icon: Moon,
    title: 'The frame was too dark',
    body: 'Almost no light reached the tissue, so its colour could not be measured.',
    fix: 'Face a window in daylight, or stand about an arm’s length from a lamp, with the light on your face rather than behind you.',
  },
  extremely_bright: {
    icon: Sun,
    title: 'The frame was too bright',
    body: 'The exposure washed the tissue out, leaving no colour difference to read.',
    fix: 'Step out of direct sun or move away from the lamp, and turn the flash off.',
  },
  severely_clipped: {
    icon: Zap,
    title: 'The highlights blew out',
    body: 'A large share of pixels hit the top of the range, so the red channel was clipped rather than measured.',
    fix: 'Turn the flash off and use soft, indirect light — never a lamp or torch pointed straight at the eye.',
  },
  out_of_focus: {
    icon: Focus,
    title: 'The frame was out of focus',
    body: 'The fine vessel detail the model reads was blurred away.',
    fix: 'Brace your elbow, tap to focus, and hold still for a beat before the shutter releases.',
  },
  degenerate_input: {
    icon: ImageOff,
    title: 'The image carried almost no detail',
    body: 'The frame came through flat, blank or corrupted — there was nothing in it to analyse.',
    fix: 'Retake the photo. If it keeps happening, close and reopen the camera so it can restart the capture.',
  },
  implausible_chroma: {
    icon: Palette,
    title: 'The colours were not tissue colours',
    body: 'The colour statistics of the crop do not resemble conjunctiva under any lighting the model knows.',
    fix: 'Photograph the eyelid directly, in ordinary white light — not through a screen, a filter or a coloured lamp.',
  },
  excess_high_frequency: {
    icon: Activity,
    title: 'The frame was too noisy',
    body: 'Far more fine-grained detail than real tissue produces, which usually means digital noise, heavy compression or a photo of a screen.',
    fix: 'Take the photo directly with this camera in better light, rather than uploading or re-photographing an existing image.',
  },
  out_of_distribution: {
    icon: ScanEye,
    title: 'This crop is unlike the data the model was trained on',
    body: 'The model refused to score it rather than extrapolate. That is a statement about the model’s limits, not about your health.',
    fix: 'Retake in even, indirect daylight with the inner rim centred. If it keeps refusing, this capture may be outside what the model can screen.',
  },
  encoder_out_of_range: {
    icon: Gauge,
    title: 'The model’s internal readings went out of range',
    body: 'The encoders produced features outside the range they were calibrated on, so the probability that followed could not be trusted.',
    fix: 'Retake the photo in steadier light. A cleaner, better-lit crop usually lands back inside the calibrated range.',
  },
  probability_saturated: {
    icon: Gauge,
    title: 'The model returned a saturated score',
    body: 'The probability pinned to the very edge of its range — a known signature of an input the model cannot actually judge, so the result was discarded.',
    fix: 'Retake the photo. If a scan keeps saturating, treat it as no result and rely on how you feel and on a clinician instead.',
  },
}

const FIXES = [
  'Stand facing a window in daylight, or about an arm’s length from a lamp — light on your face, not behind you.',
  'Look upward, then gently pull the skin under your lower lashes down with a clean fingertip until the moist rim shows.',
  'Hold the phone 15–20 cm away and let the inner rim fill the dashed box in the middle of the reticle.',
  'Pause for a moment and let all four capture checks turn green before the shutter releases.',
] as const

function isKnownReason(code: string): code is RecaptureReason {
  return Object.prototype.hasOwnProperty.call(REASONS, code)
}

export function InconclusiveScreen({
  onRetake,
  onExit,
  reason = 'quality',
  reasons = [],
  message,
}: {
  onRetake: () => void
  onExit: () => void
  /** 'quality' — the capture itself was rejected. 'error' — the screening
   *  service could not be reached at all (see src/lib/api.ts). */
  reason?: 'quality' | 'error'
  /** The machine-readable codes from a refused capture (HTTP 422). Each one the
   *  app recognises gets its own explanation below; unrecognised codes are
   *  still listed verbatim rather than hidden. */
  reasons?: string[]
  /** The sentence the server wants shown for this refusal, or a network/service
   *  error message. Falls back to generic copy. */
  message?: string
}) {
  const reduceMotion = useReducedMotion() ?? false
  const isError = reason === 'error'

  const known = reasons.filter(isKnownReason)
  const unknown = reasons.filter((code) => !isKnownReason(code))

  const variants: Variants = {
    hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.45, ease: 'easeOut' },
    },
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* ---- masthead, on the same pattern as result / insights / history --- */}
      <header className="home-hero relative isolate overflow-hidden border-b border-border/70">
        <div
          aria-hidden="true"
          className="animate-aurora pointer-events-none absolute inset-0 opacity-45"
        />
        <div aria-hidden="true" className="grain pointer-events-none absolute inset-0" />

        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 pt-8 pb-10 lg:px-10 lg:pt-10">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-moderate/30 bg-moderate/10 px-3 py-1 text-2xs font-medium tracking-[0.18em] text-moderate-strong uppercase">
            {isError ? (
              <WifiOff className="size-3.5" aria-hidden="true" />
            ) : (
              <TriangleAlert className="size-3.5" aria-hidden="true" />
            )}
            {isError ? 'Connection issue' : 'Inconclusive'}
          </span>

          <h1 className="display text-display-sm text-balance text-foreground sm:text-display">
            {isError ? "Couldn't reach AnemiaScan" : 'That frame could not be screened'}
          </h1>

          {/* The server's own sentence, verbatim. It is the most specific thing
              anyone can say about this capture, so it leads. */}
          <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
            {message ??
              (isError
                ? 'The screening service is unavailable right now. Make sure the AnemiaScan backend is running, then try again.'
                : 'The capture came out too dark, too bright or too unclear to trust — and a bad photo makes healthy tissue look pale. We discarded the reading instead of guessing, so nothing was saved to your history and no score was shown.')}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="moderate">No score produced</Badge>
            <Badge variant="outline">Nothing saved to history</Badge>
            <Badge variant="outline">{isError ? 'Retry once it is back' : 'Fixable in one retake'}</Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8 lg:px-10 lg:py-10">
        {/* ---- visual comparison ------------------------------------------ */}
        <motion.div variants={variants} initial="hidden" animate="show">
          <h2 className="sr-only">What a readable frame looks like</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4" aria-hidden="true">
            <figure className="flex flex-col gap-2">
              <div className="relative h-24 overflow-hidden rounded-2xl border border-risk/40 bg-[#0b0d11] sm:h-32">
                <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_50%,rgba(120,60,60,0.28),transparent_70%)]" />
                <div className="absolute inset-x-5 bottom-6 h-5 rounded-full bg-white/6 blur-[1px]" />
              </div>
              <figcaption className="text-center text-2xs font-medium text-risk">
                Unreadable — discarded
              </figcaption>
            </figure>
            <figure className="flex flex-col gap-2">
              <div className="relative h-24 overflow-hidden rounded-2xl border border-safe/40 bg-[#1b1013] sm:h-32">
                <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_45%,rgba(244,160,155,0.75),transparent_72%)]" />
                <div className="absolute inset-x-5 bottom-6 h-5 rounded-full bg-[#f6b0ab]/80" />
                <div className="absolute inset-x-9 bottom-7 h-2 rounded-full bg-white/25 blur-[2px]" />
              </div>
              <figcaption className="text-center text-2xs font-medium text-safe">
                Evenly lit — readable
              </figcaption>
            </figure>
          </div>
        </motion.div>

        {/* ---- what the server actually reported --------------------------- */}
        {known.length > 0 && (
          <motion.section
            variants={variants}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-4"
            aria-labelledby="inconclusive-reported"
          >
            <h2
              id="inconclusive-reported"
              className="text-2xs font-semibold tracking-[0.18em] text-muted-foreground uppercase"
            >
              {known.length === 1 ? 'What the check found' : 'What the checks found'}
            </h2>
            <ul className="grid list-none gap-3">
              {known.map((code) => {
                const detail = REASONS[code]
                const Icon = detail.icon
                return (
                  <li
                    key={code}
                    className="card-hover flex gap-3 rounded-2xl border border-moderate/30 bg-moderate/5 px-4 py-3.5"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-chip-sm border border-moderate/25 bg-moderate/10 text-moderate-strong">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <p className="text-sm leading-snug font-medium text-foreground">
                        {detail.title}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{detail.body}</p>
                      <p className="text-xs leading-relaxed text-foreground/90">
                        <span className="font-medium">Try this: </span>
                        {detail.fix}
                      </p>
                      <p className="font-mono text-2xs tracking-tight text-muted-foreground/70">
                        {code}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </motion.section>
        )}

        {/* An unrecognised code is still shown. Hiding it would leave someone
            reporting a problem with nothing to quote. */}
        {unknown.length > 0 && (
          <motion.p
            variants={variants}
            initial="hidden"
            animate="show"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            The service also reported{' '}
            <span className="font-mono text-foreground">{unknown.join(', ')}</span>, which this
            version of the app does not have an explanation for.
          </motion.p>
        )}

        {/* ---- generic causes, only when nothing specific came back -------- */}
        {known.length === 0 && (
          <motion.section
            variants={variants}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-4"
            aria-labelledby="inconclusive-causes"
          >
            <h2
              id="inconclusive-causes"
              className="text-2xs font-semibold tracking-[0.18em] text-muted-foreground uppercase"
            >
              Why this happens
            </h2>
            <ul className="grid list-none gap-3 sm:grid-cols-2">
              {CAUSES.map((cause) => {
                const Icon = cause.icon
                return (
                  <li
                    key={cause.title}
                    className="card-hover flex gap-3 rounded-2xl border border-border bg-card/60 px-4 py-3.5"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-chip-sm border border-moderate/25 bg-moderate/10 text-moderate-strong">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-sm leading-snug font-medium text-foreground">
                        {cause.title}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{cause.body}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </motion.section>
        )}

        {/* ---- fixes ------------------------------------------------------- */}
        <motion.section
          variants={variants}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4 rounded-3xl border border-primary/25 bg-primary/5 px-5 py-5 lg:px-6"
          aria-labelledby="inconclusive-fixes"
        >
          <h2
            id="inconclusive-fixes"
            className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
          >
            <Lightbulb className="size-4 shrink-0 text-primary" aria-hidden="true" />
            Four moves that fix it
          </h2>
          <ol className="grid list-none gap-3 sm:grid-cols-2">
            {FIXES.map((fix, index) => (
              <li key={fix} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-2xs font-semibold text-primary"
                >
                  {index + 1}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{fix}</span>
              </li>
            ))}
          </ol>
        </motion.section>

        {/* ---- actions ----------------------------------------------------- */}
        <motion.div
          variants={variants}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-3 sm:flex-row"
        >
          <Button
            size="lg"
            onClick={onRetake}
            className="h-12 rounded-full px-6 text-base sm:w-fit"
          >
            <RotateCcw className="size-4" data-icon="inline-start" aria-hidden="true" />
            Retake the scan
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={onExit}
            className="h-12 rounded-full px-6 text-base sm:w-fit"
          >
            <ArrowLeft className="size-4" data-icon="inline-start" aria-hidden="true" />
            Back to home
          </Button>
        </motion.div>

        <motion.p
          variants={variants}
          initial="hidden"
          animate="show"
          className="flex items-start gap-2.5 border-t border-border/70 pt-6 text-2xs leading-relaxed text-muted-foreground"
        >
          <ShieldAlert className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            AnemiaScan is a screening aid, not a diagnosis and not a haemoglobin measurement. Only a
            blood test can confirm anaemia — if you feel unwell, speak to a clinician regardless of
            what any scan says.
          </span>
        </motion.p>
      </div>
    </div>
  )
}
