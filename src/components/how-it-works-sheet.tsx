import { Dialog } from '@base-ui/react/dialog'
import { Camera, Sparkles, X, Eye } from 'lucide-react'

const steps = [
  {
    icon: Eye,
    title: 'Align your eye',
    body: 'Gently pull down your lower eyelid and follow the on-screen guide.',
  },
  {
    icon: Camera,
    title: 'Take one scan',
    body: 'Hold still for a second while AnemiaScan captures a clear image.',
  },
  {
    icon: Sparkles,
    title: 'Get your screening',
    body: 'AI models analyze color and texture signals to estimate anemia risk.',
  },
]

export function HowItWorksSheet({ children }: { children: React.ReactElement }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={children} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-x-4 bottom-4 z-50 rounded-3xl border border-border bg-card p-6 shadow-2xl outline-none transition-all data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div className="mb-5 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">How it works</Dialog.Title>
            <Dialog.Close className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-4">
            {steps.map((step, i) => (
              <div key={step.title} className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <step.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {i + 1}. {step.title}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
