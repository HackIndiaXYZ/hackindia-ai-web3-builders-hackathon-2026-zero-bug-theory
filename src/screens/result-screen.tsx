import { useState } from 'react'
import { AlertTriangle, ArrowRight, History, Layers, Link2, RotateCcw, Send, ShieldCheck, Stethoscope } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { riskClasses, riskColorToken, riskExplanation, riskHeadline } from '@/src/lib/risk-style'
import type { ScanAnalysis } from '@/src/lib/types'

interface ResultScreenProps {
  analysis: ScanAnalysis
  onViewInsights: () => void
  onScanAgain: () => void
  onViewHistory: () => void
  onViewBlockchain: () => void
  onSendToDoctor: (patientLabel: string) => void
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function ResultScreen({
  analysis,
  onViewInsights,
  onScanAgain,
  onViewHistory,
  onViewBlockchain,
  onSendToDoctor,
}: ResultScreenProps) {
  const [patientLabel, setPatientLabel] = useState('')
  const [sent, setSent] = useState(false)
  const token = riskColorToken(analysis.riskLevel)
  const tone = riskClasses(token)
  const probability = analysis.screeningProbability
  const threshold = analysis.operatingThreshold
  const isV4 = analysis.modelVersion === 'anemiascan-v4-eff-conv-vit' && probability !== undefined && threshold !== undefined

  if (!isV4) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-moderate" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Legacy result</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">This locally stored scan predates the V4 model integration, so its old heuristic details are not presented as a V4 medical result.</p>
        <Button onClick={onScanAgain} className="rounded-full"><RotateCcw className="h-4 w-4" />Run a V4 scan</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="home-hero relative isolate overflow-hidden border-b border-border/70">
        <div className="animate-aurora pointer-events-none absolute inset-0 opacity-45" aria-hidden="true" />
        <div className="grain pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-10 lg:px-10 lg:py-12">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={token}>{analysis.riskLevel}</Badge>
            <Badge variant="outline">AnemiaScan V4</Badge>
            {analysis.uncertain && <Badge variant="moderate">Uncertainty margin</Badge>}
          </div>
          <h1 className="display text-display-sm text-balance text-foreground sm:text-display">{riskHeadline(analysis.riskLevel)}</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{riskExplanation(analysis.riskLevel)}</p>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,.75fr)] lg:px-10 lg:py-12">
        <div className="flex flex-col gap-6">
          <Card className={cn('overflow-hidden', tone.border)}>
            <CardHeader>
              <CardDescription>Calibrated screening score—not diagnostic certainty</CardDescription>
              <CardTitle className={cn('metric text-5xl', tone.text)}>{percent(probability)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Progress value={probability * 100} tone={token} label={`Calibrated screening score ${percent(probability)}`} />
              <div className="flex flex-wrap justify-between gap-3 text-xs text-muted-foreground">
                <span>Operating threshold {percent(threshold)}</span>
                <span>{analysis.uncertain ? 'Score is within the configured uncertainty margin' : probability >= threshold ? 'Score is above the operating threshold' : 'Score is below the operating threshold'}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-moderate/35 bg-moderate/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Stethoscope className="h-5 w-5 text-moderate" />Confirmation is essential</CardTitle>
              <CardDescription>{analysis.warning ?? 'Research screening result only. Confirm using a CBC/hemoglobin test and professional evaluation.'}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              This screen cannot confirm or rule out anaemia. Do not start supplements or change treatment based only on this score.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Send className="h-4 w-4 text-primary" />Share with the doctor portal</CardTitle>
              <CardDescription>Use a label the clinician will recognise. The review queue remains inside this browser session.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="patient-label">Patient label</label>
              <input id="patient-label" value={patientLabel} onChange={(event) => { setPatientLabel(event.target.value); setSent(false) }} placeholder="Patient name or reference" className="min-h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              <Button disabled={!patientLabel.trim() || sent} onClick={() => { onSendToDoctor(patientLabel.trim()); setSent(true) }} className="min-h-11 rounded-full">{sent ? 'Sent for review' : 'Send for review'}</Button>
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Model provenance</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-xs">
                <div><dt className="text-muted-foreground">Model</dt><dd className="mt-0.5 font-medium">{analysis.modelVersion}</dd></div>
                <div><dt className="text-muted-foreground">Patient ID</dt><dd className="mt-0.5 break-all font-mono">{analysis.id}</dd></div>
                <div><dt className="text-muted-foreground">Image quality</dt><dd className="mt-0.5 font-medium">Accepted by the V4 quality gate</dd></div>
              </dl>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3">
            <Button size="lg" onClick={onViewInsights} className="h-12 rounded-full"><Layers className="h-4 w-4" />View V4 details<ArrowRight className="h-4 w-4" /></Button>
            <Button size="lg" variant="outline" onClick={onScanAgain} className="h-11 rounded-full"><RotateCcw className="h-4 w-4" />Scan again</Button>
            <Button variant="outline" onClick={onViewHistory} className="h-11 rounded-full"><History className="h-4 w-4" />Compare history</Button>
            <Button variant="ghost" onClick={onViewBlockchain} className="h-11 rounded-full"><Link2 className="h-4 w-4" />Blockchain and care</Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
