import { Lightbulb, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function InconclusiveScreen({
  onRetake,
}: {
  onRetake: () => void
  onExit: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center animate-fade-in-up">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-moderate/10 text-moderate">
        <Lightbulb className="h-6 w-6" />
      </div>

      <div className="flex flex-col gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Let&apos;s try that again.
        </h1>
        <p className="text-sm font-medium text-moderate">The image is too dark.</p>
      </div>

      <div className="max-w-[19rem] rounded-2xl border border-border bg-card/60 px-4 py-3.5 text-sm leading-relaxed text-muted-foreground">
        Tip: face a light source and make sure your lower eyelid is clearly lit before
        scanning.
      </div>

      <Button size="lg" onClick={onRetake} className="h-12 rounded-full px-7 text-base font-medium">
        <RotateCcw className="mr-1 h-4 w-4" data-icon="inline-start" />
        Retake Scan
      </Button>
    </div>
  )
}
