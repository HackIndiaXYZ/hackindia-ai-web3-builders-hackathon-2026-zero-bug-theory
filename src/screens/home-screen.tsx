import { ArrowRight, Camera, ScanEye, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EyeGuide } from '@/src/components/eye-guide'

const STEPS = [
  {
    icon: Camera,
    title: 'Capture',
    body: 'Use your camera to photograph the inside of your lower eyelid in good light.',
  },
  {
    icon: ScanEye,
    title: 'Analyze',
    body: 'An ensemble of vision models reads color and texture signals from the conjunctiva.',
  },
  {
    icon: ShieldCheck,
    title: 'Screen',
    body: 'Get an instant risk estimate plus AI insights you can bring to a clinician.',
  },
]

export function HomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <section className="home-hero relative isolate overflow-hidden">
        <div className="home-hero-grid pointer-events-none absolute inset-0" />
        <div className="home-hero-orbit pointer-events-none absolute left-1/2 top-1/2 h-[min(72vw,42rem)] w-[min(72vw,42rem)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/15" />
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-20 lg:px-10 lg:pb-28 lg:pt-24">
          <div className="relative z-10 flex max-w-2xl flex-col items-start gap-7 text-left">
          <span className="animate-fade-in-up inline-flex items-center gap-2 border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-primary">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI-powered screening / 01
          </span>

          <h1 className="home-title animate-fade-in-up text-5xl font-semibold leading-[0.95] tracking-[-0.04em] text-foreground sm:text-7xl lg:text-[5.8rem]">
            See the signal
            <span className="block text-primary">before it hides.</span>
          </h1>

          <p className="animate-fade-in-up max-w-lg text-base leading-relaxed text-muted-foreground [animation-delay:120ms] sm:text-lg">
            AnemiaScan uses your camera and on-device AI to check the inside of your eyelid
            for early signs of anemia — right from your browser, in under a minute.
          </p>

          <div className="animate-fade-in-up flex flex-wrap items-center gap-4 pt-1 [animation-delay:220ms]">
            <Button size="lg" onClick={onStart} className="h-12 rounded-none px-7 text-base font-medium">
              Begin a scan
              <ArrowRight className="ml-1 h-4 w-4" data-icon="inline-end" />
            </Button>
          </div>

          <p className="max-w-md border-l border-primary/40 pl-4 text-xs leading-relaxed text-muted-foreground/70">
            AnemiaScan is a screening tool, not a diagnosis. Always consult a clinician for
            medical advice.
          </p>
          </div>

          <div className="relative z-10 flex min-h-[25rem] items-center justify-center lg:min-h-[34rem]">
            <div className="home-scan-stamp absolute right-0 top-3 hidden text-right text-[10px] uppercase tracking-[0.24em] text-muted-foreground/60 sm:block">
              Optical signal<br />
              Conjunctiva / live
            </div>
            <div className="home-guide-frame relative flex aspect-square w-[min(80vw,26rem)] items-center justify-center border border-primary/25 bg-background/70 p-8 shadow-[0_0_80px_-35px_var(--primary)] backdrop-blur-sm sm:p-12 lg:w-[30rem]">
              <div className="absolute inset-4 border border-border/60" />
              <span className="absolute left-0 top-1/2 h-px w-8 bg-primary" />
              <span className="absolute right-0 top-1/2 h-px w-8 bg-primary" />
              <span className="absolute left-1/2 top-0 h-8 w-px bg-primary" />
              <span className="absolute bottom-0 left-1/2 h-8 w-px bg-primary" />
              <EyeGuide ready className="relative h-full w-full" />
              <span className="absolute bottom-5 left-5 text-[10px] uppercase tracking-[0.2em] text-primary/80">
                Ready to capture
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="w-full border-t border-border/60 bg-card/25">
        <div className="mx-auto grid w-full max-w-6xl gap-0 px-6 lg:grid-cols-3 lg:px-10">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex flex-col gap-3 border-b border-border/60 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:first:pl-0 lg:last:border-r-0">
              <div className="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-foreground">{title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
