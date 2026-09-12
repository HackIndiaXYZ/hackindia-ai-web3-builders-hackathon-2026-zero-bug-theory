/* --------------------------------------------------------------------------
 * LearnScreen — the educational surface.
 * --------------------------------------------------------------------------
 * A long-form, genuinely informative read covering: what anaemia is, why the
 * palpebral conjunctiva is the site an image-based screen would choose, what
 * each of the five measured signals means, how to take a capture worth
 * scoring, the hard limits of screening from a photo, and when to stop reading
 * and see a clinician.
 *
 * Editorial rules applied throughout:
 *   - No invented statistics, no prevalence figures, no citations.
 *   - Eyelid-pallor screening is described as an active research area in
 *     general terms; no specific study is referenced or implied.
 *   - Nothing is framed as diagnosis, and no dosing advice is given.
 * -------------------------------------------------------------------------- */

import { motion, useReducedMotion, type Variants } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  CircleAlert,
  CircleCheck,
  Contrast,
  Droplet,
  Eye,
  EyeOff,
  FlaskConical,
  Glasses,
  HeartPulse,
  Lightbulb,
  Palette,
  ScanLine,
  Stethoscope,
  Sun,
  TriangleAlert,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Stat } from '@/components/ui/stat'

/* -------------------------------------------------------------------------- */
/* Content                                                                    */
/* -------------------------------------------------------------------------- */

const CONTENTS = [
  { id: 'anaemia', label: 'What anaemia is' },
  { id: 'why-conjunctiva', label: 'Why the eyelid' },
  { id: 'signals', label: 'The five signals' },
  { id: 'good-capture', label: 'A good capture' },
  { id: 'limits', label: 'Hard limits' },
  { id: 'clinician', label: 'See a clinician' },
] as const

const SYMPTOMS = [
  'Tiredness that rest does not fix',
  'Breathlessness on stairs or mild effort',
  'Dizziness or lightheadedness on standing',
  'Unusually pale skin, lips, gums or inner eyelids',
  'A racing or pounding heartbeat',
  'Cold hands and feet',
  'Headaches or trouble concentrating',
  'Brittle nails, hair shedding, or a sore tongue',
] as const

const SIGNALS = [
  {
    icon: Droplet,
    name: 'Pallor',
    reading: 'How washed-out the tissue looks',
    body: 'The headline signal. A well-perfused conjunctiva is a deep, wet pink-red; as haemoglobin falls, the same tissue trends toward pale pink, then toward the colour of the sclera behind it. The app measures how far the sampled region sits from that saturated reference.',
    confound: 'Overexposure and a cool white balance both flatten colour and can mimic pallor.',
  },
  {
    icon: Palette,
    name: 'Redness',
    reading: 'How much signal sits in the red channel',
    body: 'Separating the red channel from overall brightness distinguishes "pale" from "dim". A dark photo of healthy tissue still carries strong relative red; a bright photo of pale tissue does not.',
    confound: 'Irritation, allergy, crying or rubbing the eye all raise redness independently of haemoglobin.',
  },
  {
    icon: Contrast,
    name: 'Saturation',
    reading: 'Colour intensity, independent of brightness',
    body: 'Saturation is the most lighting-robust of the colour readings, because it describes how far the hue is from grey rather than how bright the frame is. It is the signal that best survives an imperfect exposure.',
    confound: 'Beauty filters, HDR and any auto-enhance step rewrite saturation before the app ever sees it.',
  },
  {
    icon: ScanLine,
    name: 'Texture',
    reading: 'How much fine vascular detail is visible',
    body: 'A healthy conjunctiva shows a visible network of fine vessels. Local pixel variance stands in for that detail: when the vascular pattern flattens out, texture drops. It is a useful cross-check on the colour readings, because it fails for different reasons than they do.',
    confound: 'Motion blur, a smudged lens or a low-resolution crop all read as lost texture.',
  },
  {
    icon: Sun,
    name: 'Illumination',
    reading: 'Whether the frame was lit well enough to trust',
    body: 'Not a health signal at all — a referee. Illumination sets how much weight the other four readings deserve, and it is what drives the confidence figure down on a marginal capture. Below a floor, the scan is refused rather than scored.',
    confound: 'Nothing confounds it; it exists precisely to catch the frames that would confound everything else.',
  },
] as const

const CAPTURE_DO = [
  { icon: Sun, title: 'Bright, indirect daylight', body: 'Face a window with the light on your face. Daylight is close to neutral, so colour lands roughly where it should.' },
  { icon: Eye, title: 'Expose the inner surface', body: 'Look up, gently pull the lower lid down with a clean fingertip, and hold until the moist inner lining is fully visible.' },
  { icon: Camera, title: 'Fill the guide frame', body: 'About 15–20 cm away. The conjunctiva should fill the frame — not your whole eye, not your whole face.' },
  { icon: CircleCheck, title: 'Hold still and wait for ready', body: 'Steady hands beat a fast shutter. Let the readiness checks pass before capturing.' },
] as const

const CAPTURE_AVOID = [
  { icon: EyeOff, title: 'Direct sun or harsh flash', body: 'Both blow out the highlights, and a blown-out region reads as pallor no matter what is underneath it.' },
  { icon: Palette, title: 'Coloured or screen light', body: 'Warm bulbs, RGB lamps and a monitor as a light source all shift white balance, which shifts the reading.' },
  { icon: Glasses, title: 'Glasses, lenses and filters', body: 'Take glasses off. Skip beauty mode, HDR boost, and any camera app that enhances colour automatically.' },
  { icon: Droplet, title: 'A recently rubbed or irritated eye', body: 'Wait until the eye settles. Fresh irritation changes both redness and texture.' },
] as const

const LIMITS = [
  'It cannot measure haemoglobin. Colour is a correlate, not a value, and this build has not been validated against laboratory results.',
  'It sees one small patch of tissue at one moment, under one lighting condition, through one unknown camera pipeline.',
  'Mild or early anaemia can look entirely normal in a photo, so a Low Risk result is not a clearance.',
  'It cannot tell you why. Iron deficiency, blood loss, B12 or folate deficiency, chronic disease and inherited conditions can look alike from the outside.',
  'It cannot see anything about the eye itself. Conjunctivitis, an infection or a recent injury will change tissue colour for reasons unrelated to blood.',
  'It is not a medical device, has no regulatory clearance, and is not a substitute for examination or testing.',
] as const

const RED_FLAGS = [
  'Chest pain, fainting, or a heartbeat that races at rest',
  'Visible blood loss — in stool, vomit, urine, or unusually heavy periods',
  'Breathlessness that is new, worsening, or present when sitting still',
  'Symptoms during pregnancy, or in an infant or young child',
] as const

/* -------------------------------------------------------------------------- */
/* Motion                                                                     */
/* -------------------------------------------------------------------------- */

function useSectionMotion(): { variants: Variants; reduceMotion: boolean } {
  const reduceMotion = useReducedMotion() ?? false

  const variants: Variants = {
    hidden: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 18 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.5, ease: 'easeOut' },
    },
  }

  return { variants, reduceMotion }
}

/** Section shell: consistent heading rhythm and a scroll-reveal. */
function Section({
  id,
  eyebrow,
  title,
  lead,
  variants,
  className,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  lead?: string
  variants: Variants
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.section
      id={id}
      aria-labelledby={`${id}-heading`}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.12 }}
      className={cn('scroll-mt-24 border-t border-border/70 py-12 lg:py-16', className)}
    >
      <div className="flex flex-col gap-3">
        <span className="text-2xs font-medium tracking-[0.22em] text-primary uppercase">
          {eyebrow}
        </span>
        <h2 id={`${id}-heading`} className="display text-display-sm text-foreground">
          {title}
        </h2>
        {lead ? (
          <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
            {lead}
          </p>
        ) : null}
      </div>
      <div className="mt-8">{children}</div>
    </motion.section>
  )
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

interface LearnScreenProps {
  onBack: () => void
  onStart: () => void
}

export function LearnScreen({ onBack, onStart }: LearnScreenProps) {
  const { variants } = useSectionMotion()

  return (
    <div className="flex flex-1 flex-col">
      {/* ---- masthead --------------------------------------------------- */}
      <header className="home-hero relative isolate overflow-hidden border-b border-border/70">
        <div
          aria-hidden="true"
          className="animate-aurora pointer-events-none absolute inset-0 opacity-60"
        />
        <div className="home-hero-grid pointer-events-none absolute inset-0" />
        <div className="grain pointer-events-none absolute inset-0" />

        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pt-8 pb-14 lg:px-10 lg:pt-10 lg:pb-20">
          <Button
            variant="ghost"
            size="lg"
            onClick={onBack}
            className="h-10 w-fit rounded-full px-3.5 text-muted-foreground"
          >
            <ArrowLeft className="size-4" data-icon="inline-start" aria-hidden="true" />
            Back
          </Button>

          <div className="flex flex-col gap-4">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-2xs font-medium tracking-[0.18em] text-primary uppercase">
              <BookOpen className="size-3.5" aria-hidden="true" />
              The guide
            </span>

            <h1 className="display text-display text-foreground sm:text-display-lg">
              Anaemia, the eyelid, and what a photo can honestly tell you
            </h1>

            <p className="max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground">
              This is the long version: the condition being screened for, the reason the inside of
              the lower lid is the site to look at, what each measured signal actually means, and —
              just as importantly — the things an image can never show. About a seven-minute read.
            </p>
          </div>

          <nav aria-label="On this page" className="flex flex-wrap gap-2 pt-2">
            {CONTENTS.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                className="ring-focus rounded-full border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 lg:px-10">
        {/* ---- 1. what anaemia is -------------------------------------- */}
        <Section
          id="anaemia"
          eyebrow="Chapter 01"
          title="What anaemia actually is"
          lead="Anaemia means your blood carries less oxygen than your body needs — usually because there is too little haemoglobin, the iron-bearing protein inside red blood cells. It is one of the most common blood conditions worldwide, and in most cases it is treatable once someone finds it."
          variants={variants}
          className="border-t-0"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HeartPulse className="size-4 text-primary" aria-hidden="true" />
                  Why it goes unnoticed
                </CardTitle>
                <CardDescription>
                  It arrives slowly. The body adapts to falling oxygen delivery by raising the heart
                  rate and shifting blood toward the organs that need it most, so the early
                  experience is not illness — it is a vague, gradual flattening of energy that is
                  easy to explain away as stress, poor sleep or age.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  That slow onboarding is exactly why a cheap, repeatable prompt to get tested has
                  value, even when the prompt itself is imprecise.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FlaskConical className="size-4 text-primary" aria-hidden="true" />
                  Common causes
                </CardTitle>
                <CardDescription>
                  Anaemia is a finding, not a diagnosis in itself — the useful question is always
                  what caused it.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <p>
                  <strong className="font-medium text-foreground">Not enough iron</strong> — low
                  dietary intake, poor absorption, or a demand the diet cannot keep up with.
                </p>
                <p>
                  <strong className="font-medium text-foreground">Blood loss</strong> — heavy
                  periods, or slow gastrointestinal bleeding that nobody has noticed.
                </p>
                <p>
                  <strong className="font-medium text-foreground">Vitamin deficiency</strong> — B12
                  or folate, which red cells need in order to be built correctly.
                </p>
                <p>
                  <strong className="font-medium text-foreground">Chronic or inherited
                  conditions</strong> — kidney disease, inflammation, thalassaemia, sickle cell
                  disease and others.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-5">
            <CardHeader>
              <CardTitle>What people tend to notice first</CardTitle>
              <CardDescription>
                None of these confirm anaemia on their own — plenty of other things cause each of
                them. Several together, persisting for weeks, are worth a blood test.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {SYMPTOMS.map((symptom) => (
                  <li
                    key={symptom}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                    />
                    {symptom}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </Section>

        {/* ---- 2. why the conjunctiva ---------------------------------- */}
        <Section
          id="why-conjunctiva"
          eyebrow="Chapter 02"
          title="Why the inside of the lower eyelid"
          lead="The palpebral conjunctiva is the moist lining on the inner surface of the eyelid. It is thin, transparent, densely supplied with capillaries, and — unlike almost every other accessible surface on the body — essentially free of melanin. Look at it and you are very nearly looking at the colour of the blood beneath."
          variants={variants}
        >
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>Three properties that make it the right site</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex gap-3.5">
                  <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-chip-sm border border-primary/25 bg-primary/10 text-primary">
                    <Eye className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    <strong className="font-medium text-foreground">Thin and transparent.</strong>{' '}
                    There is very little tissue between the surface and the capillary bed, so the
                    hue you see is dominated by blood rather than by whatever sits on top of it.
                  </p>
                </div>
                <div className="flex gap-3.5">
                  <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-chip-sm border border-primary/25 bg-primary/10 text-primary">
                    <Contrast className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    <strong className="font-medium text-foreground">Unpigmented.</strong> Because
                    melanin is not a variable here, the site behaves far more consistently across
                    skin tones than a palm, a nail bed or facial skin — which is a fairness property,
                    not just a technical one.
                  </p>
                </div>
                <div className="flex gap-3.5">
                  <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-chip-sm border border-primary/25 bg-primary/10 text-primary">
                    <Stethoscope className="size-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    <strong className="font-medium text-foreground">Already part of the
                    examination.</strong> Checking conjunctival pallor at the bedside is long-standing
                    clinical practice. A phone camera is not inventing a new sign — it is attempting
                    to read an established one more consistently.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-accent/25">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="size-4 text-primary" aria-hidden="true" />
                  Where the research stands
                </CardTitle>
                <CardDescription>
                  Estimating haemoglobin from images of the conjunctiva is an active research area.
                  We cite no specific study here, and none of it was used to build or validate this
                  app.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                  What such work generally requires, though, is tight control of the capture:
                  consistent lighting, a known camera response, a well-defined region of interest,
                  and validation against actual laboratory values.
                </p>
                <p>
                  AnemiaScan does none of that validation. It runs a transparent heuristic on an
                  unknown camera in unknown light, which is why it reports a band and a confidence
                  rather than a number — and why it says, on every screen, that a blood test is the
                  only real answer.
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ---- 3. the five signals ------------------------------------- */}
        <Section
          id="signals"
          eyebrow="Chapter 03"
          title="The five signals, and what each one means"
          lead="Your result is not a single opaque number. Five readings are measured separately, each normalised to a 0–100 scale, each carrying a visible weight — and each with its own way of being wrong."
          variants={variants}
        >
          <ul className="flex flex-col gap-4">
            {SIGNALS.map(({ icon: Icon, name, reading, body, confound }, i) => (
              <li key={name}>
                <Card className="card-hover">
                  <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:gap-6">
                    <div className="flex shrink-0 items-center gap-3 sm:w-40 sm:flex-col sm:items-start">
                      <span className="inline-flex size-10 items-center justify-center rounded-chip border border-primary/25 bg-primary/10 text-primary">
                        <Icon className="size-[1.15rem]" aria-hidden="true" />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <span className="metric text-2xs text-muted-foreground">
                          Signal {String(i + 1).padStart(2, '0')}
                        </span>
                        <h3 className="text-base leading-snug font-semibold tracking-tight text-foreground">
                          {name}
                        </h3>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-col gap-3">
                      <Badge variant="secondary" className="text-2xs">
                        {reading}
                      </Badge>
                      <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                        {body}
                      </p>
                      <p className="flex items-start gap-2 border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
                        <CircleAlert
                          className="mt-px size-3.5 shrink-0 text-moderate"
                          aria-hidden="true"
                        />
                        <span>
                          <strong className="font-medium text-foreground">Can be fooled by: </strong>
                          {confound}
                        </span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <Card className="mt-5">
            <CardHeader>
              <CardTitle>How the readings become a band</CardTitle>
              <CardDescription>
                The five signals are blended by weight into a single 0–100 screening score. The score
                maps to one of three bands, and capture quality is tracked separately as confidence
                — so a borderline photo lowers certainty instead of quietly inventing it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-x-10 gap-y-5">
                <Stat label="Low risk" value="Band 1" hint="No pallor pattern detected in this capture" />
                <Stat
                  label="Moderate risk"
                  value="Band 2"
                  hint="Some signals below this screen’s unremarkable range"
                />
                <Stat label="Elevated risk" value="Band 3" hint="A pallor pattern worth testing for" />
                <Stat label="Too dark" value="Refused" hint="Scored frames must clear a light floor" />
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* ---- 4. a good capture --------------------------------------- */}
        <Section
          id="good-capture"
          eyebrow="Chapter 04"
          title="How to take a capture worth scoring"
          lead="This is the part you control, and it matters more than anything else on this page. The app reads colour, so anything that changes colour — light, filters, exposure — changes the result."
          variants={variants}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-safe">
                  <CircleCheck className="size-4" aria-hidden="true" />
                  Do this
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-4">
                  {CAPTURE_DO.map(({ icon: Icon, title, body }) => (
                    <li key={title} className="flex gap-3">
                      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-chip-sm border border-safe/30 bg-safe/10 text-safe">
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm leading-snug font-medium text-foreground">
                          {title}
                        </span>
                        <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-risk">
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  Avoid this
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-4">
                  {CAPTURE_AVOID.map(({ icon: Icon, title, body }) => (
                    <li key={title} className="flex gap-3">
                      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-chip-sm border border-risk/30 bg-risk/10 text-risk">
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm leading-snug font-medium text-foreground">
                          {title}
                        </span>
                        <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-5 bg-accent/25">
            <CardContent className="flex flex-col gap-2 py-6">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                One more habit worth having
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Capture in the same place, at roughly the same time of day, whenever you can. A
                consistent setup will not make any single reading accurate — but it makes the
                comparison between readings mean something, and change over several scans is the most
                useful thing this app can give you.
              </p>
            </CardContent>
          </Card>
        </Section>

        {/* ---- 5. limits ---------------------------------------------- */}
        <Section
          id="limits"
          eyebrow="Chapter 05"
          title="The hard limits of screening from a photo"
          lead="Every screening tool should be able to state plainly what it cannot do. Here is ours."
          variants={variants}
        >
          <Card className="border-moderate/30 bg-moderate/5">
            <CardContent className="py-6">
              <ul className="flex flex-col gap-3.5">
                {LIMITS.map((limit) => (
                  <li key={limit} className="flex items-start gap-3">
                    <TriangleAlert
                      className="mt-0.5 size-4 shrink-0 text-moderate"
                      aria-hidden="true"
                    />
                    <span className="text-sm leading-relaxed text-pretty text-muted-foreground">
                      {limit}
                    </span>
                  </li>
                ))}
              </ul>

              <Separator className="my-6" />

              <p className="text-sm leading-relaxed text-foreground">
                The honest framing: this app is a prompt, not an answer. Its entire value is the
                chance that it gets someone to a blood test sooner than they would have gone
                otherwise.
              </p>
            </CardContent>
          </Card>
        </Section>

        {/* ---- 6. clinician ------------------------------------------- */}
        <Section
          id="clinician"
          eyebrow="Chapter 06"
          title="When to see a clinician"
          lead="Short version: any time you are wondering. A full blood count is inexpensive, quick and definitive, and it answers the question this app can only gesture at."
          variants={variants}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="border-risk/30 bg-risk/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-risk">
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  Seek care now, do not wait for a scan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {RED_FLAGS.map((flag) => (
                    <li key={flag} className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-risk"
                      />
                      <span className="text-sm leading-relaxed text-muted-foreground">{flag}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>What to bring to the appointment</CardTitle>
                <CardDescription>
                  A screening result is most useful as a conversation starter, paired with what you
                  have actually noticed.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                  Your screening band and confidence, the dates of your scans, and the signals that
                  stood out — all of which the result and history screens show you.
                </p>
                <p>
                  Your symptoms and roughly when they started, any heavy bleeding, your diet, and any
                  supplements or medicines you already take.
                </p>
                <p>
                  And one request: ask for a haemoglobin measurement. That is the test that settles
                  it.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleAlert className="size-4 text-moderate" aria-hidden="true" />
                About iron supplements
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Please do not start iron on your own because of a screening result. Too much iron is
                genuinely harmful, some causes of anaemia are made worse by it, and supplementing
                before testing can mask the underlying reason — which is the thing that actually
                needs finding.
              </p>
              <p>
                Eating well is a different matter and is always reasonable: iron-rich foods such as
                lentils, beans, leafy greens, eggs, red meat and fortified cereals, paired with a
                vitamin C source like citrus, tomato or capsicum to help absorption, and tea or
                coffee kept away from mealtimes. Treatment, dose and duration are decisions for a
                clinician who has seen your results.
              </p>
            </CardContent>
          </Card>
        </Section>
      </div>

      {/* ---- closing ---------------------------------------------------- */}
      <section
        aria-labelledby="learn-cta-heading"
        className="home-hero relative isolate mt-6 overflow-hidden border-t border-border/70"
      >
        <div
          aria-hidden="true"
          className="animate-aurora pointer-events-none absolute inset-0 opacity-60"
        />
        <div className="grain pointer-events-none absolute inset-0" />

        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center gap-5 px-6 py-16 text-center lg:px-10 lg:py-24">
          <h2
            id="learn-cta-heading"
            className="display text-display-sm text-balance text-foreground sm:text-display"
          >
            That is the theory. Ready to try it?
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground">
            Find a window, take your glasses off, and give it thirty seconds. Whatever the result
            says, treat it as a reason to ask a clinician — never as an answer in itself.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Button size="lg" onClick={onStart} className="h-12 rounded-full px-7 text-base">
              Start a scan
              <ArrowRight className="size-4" data-icon="inline-end" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={onBack}
              className="h-12 rounded-full px-6 text-base"
            >
              <ArrowLeft className="size-4" data-icon="inline-start" aria-hidden="true" />
              Back
            </Button>
          </div>
          <p className="max-w-xl pt-2 text-2xs leading-relaxed text-muted-foreground">
            AnemiaScan is an educational screening aid, not a diagnosis, not a haemoglobin
            measurement and not a medical device. Never delay professional care because of a result
            here.
          </p>
        </div>
      </section>
    </div>
  )
}
