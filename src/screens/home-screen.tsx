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
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-16 px-6 py-16 lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-24">
        <div className="flex max-w-xl flex-col items-start gap-6 text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI-powered screening
          </span>

          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            A smarter way to screen for anemia risk.
          </h1>

          <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
            AnemiaScan uses your camera and on-device AI to check the inside of your eyelid
            for early signs of anemia — right from your browser, in under a minute.
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Button size="lg" onClick={onStart} className="h-12 rounded-full px-7 text-base font-medium">
              Start Scan
              <ArrowRight className="ml-1 h-4 w-4" data-icon="inline-end" />
            </Button>
          </div>

          <p className="max-w-md text-xs leading-relaxed text-muted-foreground/70">
            AnemiaScan is a screening tool, not a diagnosis. Always consult a clinician for
            medical advice.
          </p>
        </div>

        <div className="flex w-full max-w-sm items-center justify-center rounded-3xl border border-border bg-card/60 p-10 lg:w-[26rem]">
          <EyeGuide ready className="h-56 w-56" />
        </div>
      </section>

      <section className="w-full border-t border-border/60 bg-card/30">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-16 sm:grid-cols-3 lg:px-10">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex flex-col gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
