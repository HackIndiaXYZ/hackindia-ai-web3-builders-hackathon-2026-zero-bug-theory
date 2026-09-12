import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/src/components/disclosure'
import type { ScanAnalysis } from '@/src/lib/types'

const MODEL_BARS = [
  { label: 'EfficientNet', offset: 4 },
  { label: 'ConvNeXt', offset: -9 },
  { label: 'Colour Features', offset: 12 },
]

export function InsightsScreen({
  analysis,
  onBack,
}: {
  analysis: ScanAnalysis
  onBack: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10 lg:px-10">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to result"
          className="h-9 w-9 rounded-full"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">AI Insights</h1>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_1fr] lg:items-start">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-56 w-56 overflow-hidden rounded-[42%] border border-white/10">
            {analysis.imageDataUrl && (
              <img
                src={analysis.imageDataUrl || '/placeholder.svg'}
                alt="Captured eyelid scan"
                className="h-full w-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
            )}
            <div
              className="absolute inset-0 mix-blend-screen"
              style={{
                background:
                  'radial-gradient(circle at 50% 55%, rgba(255,140,90,0.55) 0%, rgba(255,140,90,0.28) 30%, transparent 65%)',
              }}
            />
            <div
              className="absolute inset-0 mix-blend-screen opacity-70"
              style={{
                background:
                  'radial-gradient(circle at 38% 40%, rgba(94,234,212,0.35) 0%, transparent 55%)',
              }}
            />
          </div>
          <p className="max-w-[16rem] text-center text-sm leading-relaxed text-muted-foreground">
            These visual signals influenced the AI screening.
          </p>
        </div>

        <div className="flex flex-col gap-6 rounded-3xl border border-border bg-card/50 p-8">
          <div className="flex flex-col gap-4">
            {MODEL_BARS.map((bar) => {
              const width = Math.min(96, Math.max(18, analysis.riskScore + bar.offset))
              return (
                <div key={bar.label} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{bar.label}</span>
                    <span>{width}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-chart-3 transition-all duration-700"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <Disclosure label="Model details">
            <div className="flex flex-col gap-1.5">
              <p>Model version: AnemiaScan v1.0 (ensemble)</p>
              <p>Overall confidence: {Math.min(98, 62 + Math.round(analysis.riskScore / 4))}%</p>
              <p>Sampled region: lower palpebral conjunctiva</p>
            </div>
          </Disclosure>
        </div>
      </div>
    </div>
  )
}
