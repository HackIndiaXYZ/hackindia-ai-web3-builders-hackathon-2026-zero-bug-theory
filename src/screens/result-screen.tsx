import { CheckCircle2, RotateCcw, Send, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/src/components/disclosure'
import { riskColorToken, riskExplanation } from '@/src/lib/risk-style'
import type { ScanAnalysis } from '@/src/lib/types'
import { cn } from '@/lib/utils'

export function ResultScreen({
  analysis,
  onViewInsights,
  onScanAgain,
  onSendToDoctor,
}: {
  analysis: ScanAnalysis
  onViewInsights: () => void
  onScanAgain: () => void
  onSendToDoctor: (patientLabel: string) => void
}) {
  const token = riskColorToken(analysis.riskLevel)
  const [patientLabel, setPatientLabel] = useState('')
  const [submitted, setSubmitted] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-10 px-6 py-16 lg:px-10">
      <div className="flex w-full flex-col items-center gap-8 rounded-3xl border border-border bg-card/50 px-8 py-12 text-center animate-fade-in-up sm:flex-row sm:items-center sm:justify-center sm:gap-10 sm:text-left">
        <div
          className={cn(
            'flex h-28 w-28 shrink-0 items-center justify-center rounded-full border',
            token === 'risk' && 'border-risk/40 bg-risk/10',
            token === 'moderate' && 'border-moderate/40 bg-moderate/10',
            token === 'safe' && 'border-safe/40 bg-safe/10',
          )}
        >
          <span
            className={cn(
              'text-3xl font-semibold tabular-nums',
              token === 'risk' && 'text-risk',
              token === 'moderate' && 'text-moderate',
              token === 'safe' && 'text-safe',
            )}
          >
            {analysis.riskScore}%
          </span>
        </div>

        <div className="flex flex-col gap-2.5">
          <p
            className={cn(
              'text-3xl font-semibold tracking-tight',
              token === 'risk' && 'text-risk',
              token === 'moderate' && 'text-moderate',
              token === 'safe' && 'text-safe',
            )}
          >
            {analysis.riskLevel}
          </p>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {riskExplanation(analysis.riskLevel)}
          </p>
          <div className="pt-1">
            <Disclosure label="Why?">
              AnemiaScan looks at color signals in the conjunctiva (the inside of your lower
              eyelid) — pale, washed-out tones can indicate lower hemoglobin, while deeper red
              tones typically suggest healthy iron levels. This is a screening estimate, not a
              blood test.
            </Disclosure>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" onClick={onViewInsights} className="h-12 rounded-full px-6 text-base font-medium">
          <Sparkles className="mr-1 h-4 w-4" data-icon="inline-start" />
          View AI Insights
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={onScanAgain}
          className="h-12 rounded-full px-6 text-base font-medium"
        >
          <RotateCcw className="mr-1 h-4 w-4" data-icon="inline-start" />
          Scan Again
        </Button>
      </div>

      <div className="w-full max-w-xl rounded-2xl border border-border bg-card/50 p-5">
        <p className="text-sm font-semibold text-foreground">Send this report to a doctor</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">A clinician can review this AI-assisted screening report and leave guidance. No automated medical advice is generated.</p>
        {submitted ? (
          <p className="mt-4 flex items-center gap-2 text-sm font-medium text-safe"><CheckCircle2 className="h-4 w-4" /> Report sent to the doctor review queue.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input value={patientLabel} onChange={(event) => setPatientLabel(event.target.value)} placeholder="Patient name or ID (optional)" className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
            <Button onClick={() => { onSendToDoctor(patientLabel.trim() || 'Current patient'); setSubmitted(true) }} className="h-10 rounded-lg"><Send className="h-4 w-4" /> Send for review</Button>
          </div>
        )}
      </div>
    </div>
  )
}
