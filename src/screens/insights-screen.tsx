import { ArrowLeft, BrainCircuit, CheckCircle2, FlaskConical, ImageOff, Info, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { riskColorToken } from '@/src/lib/risk-style'
import type { ScanAnalysis } from '@/src/lib/types'

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function InsightsScreen({ analysis, onBack }: { analysis: ScanAnalysis; onBack: () => void }) {
  const benchmark = analysis.internalBenchmark
  const quality = analysis.modelQuality
  const probability = analysis.screeningProbability
  const threshold = analysis.operatingThreshold
  const isV4 = analysis.modelVersion === 'anemiascan-v4-eff-conv-vit' && benchmark && quality && probability !== undefined && threshold !== undefined

  if (!isV4) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <ImageOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">No V4 details for this legacy scan</h1>
        <p className="text-sm text-muted-foreground">Run a new scan to see calibrated model and benchmark information.</p>
        <Button onClick={onBack} variant="outline" className="rounded-full"><ArrowLeft className="h-4 w-4" />Back</Button>
      </div>
    )
  }

  const token = riskColorToken(analysis.riskLevel)
  const metrics = [
    ['Accuracy', benchmark.accuracy],
    ['Sensitivity', benchmark.sensitivity],
    ['Specificity', benchmark.specificity],
    ['AUROC', benchmark.auroc],
    ['F1', benchmark.f1],
  ] as const

  return (
    <div className="flex flex-1 flex-col">
      <header className="home-hero relative isolate overflow-hidden border-b border-border/70">
        <div className="animate-aurora pointer-events-none absolute inset-0 opacity-45" aria-hidden="true" />
        <div className="grain pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-9 lg:px-10">
          <Button variant="ghost" onClick={onBack} className="h-10 w-fit rounded-full px-3"><ArrowLeft className="h-4 w-4" />Back to result</Button>
          <div><p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Deterministic V4 pipeline</p><h1 className="display mt-2 text-display-sm text-foreground">Model and image details</h1></div>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">These are real values returned by the server. No branch weights or clinical explanations are invented in the browser.</p>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-5xl gap-6 px-6 py-8 lg:grid-cols-2 lg:px-10 lg:py-12">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Guided conjunctiva ROI</CardTitle><CardDescription>The exact cropped image submitted to the V4 endpoint. The capture guide provides the ROI; it is not automatic segmentation.</CardDescription></CardHeader>
            <CardContent>{analysis.imageDataUrl ? <img src={analysis.imageDataUrl} alt="Guided palpebral conjunctiva ROI submitted for V4 screening" className="aspect-square w-full rounded-2xl border border-border object-cover" /> : <div className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-border text-muted-foreground"><ImageOff className="h-8 w-8" /></div>}</CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" />Image-quality gate</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-muted-foreground">Accepted</dt><dd className="mt-1 font-semibold">{quality.accepted ? 'Yes' : 'No'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Brightness</dt><dd className="mt-1 font-semibold">{quality.brightness.toFixed(1)} / 255</dd></div>
                <div><dt className="text-xs text-muted-foreground">Blur variance</dt><dd className="mt-1 font-semibold">{quality.blurVariance.toFixed(1)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Clipped pixels</dt><dd className="mt-1 font-semibold">{percent(quality.clippedFraction)}</dd></div>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BrainCircuit className="h-4 w-4 text-primary" />Calibrated result</CardTitle><CardDescription>Logistic stacker over three model logits followed by the 32 standardized engineered features.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end justify-between gap-4"><div><p className="text-xs text-muted-foreground">Screening score</p><p className="metric mt-1 text-3xl font-semibold">{percent(probability)}</p></div><Badge variant={token}>{analysis.riskLevel}</Badge></div>
              <Progress value={probability * 100} tone={token} label={`Screening score ${percent(probability)}`} />
              <div className="flex justify-between text-xs text-muted-foreground"><span>Operating threshold</span><strong className="text-foreground">{percent(threshold)}</strong></div>
              <div className="flex justify-between text-xs text-muted-foreground"><span>Uncertainty margin applied</span><strong className="text-foreground">6.91 percentage points</strong></div>
              <p className="rounded-xl border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">EfficientNet-B3 uses resize 320 / centre-crop 300. ConvNeXt-Tiny and ViT-B/16 use resize 236 / centre-crop 224. All three use ImageNet normalization. Their logits and the 32 features form exactly 35 stacker inputs.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" />{benchmark.label}</CardTitle><CardDescription>Performance on {benchmark.samples} internal samples. This is not external clinical validation and may not generalize to new populations or devices.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {metrics.map(([label, value]) => <div key={label}><div className="mb-1.5 flex justify-between text-xs"><span>{label}</span><strong>{percent(value)}</strong></div><Progress value={value * 100} label={`${label} ${percent(value)}`} /></div>)}
              <div className="grid grid-cols-4 gap-2 border-t border-border pt-4 text-center text-xs">
                {Object.entries(benchmark.confusionMatrix).map(([key, value]) => <div key={key} className="rounded-lg bg-muted/50 p-2"><span className="block uppercase text-muted-foreground">{key}</span><strong className="mt-1 block text-base">{value}</strong></div>)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Info className="h-4 w-4 text-primary" />Provenance</CardTitle></CardHeader>
            <CardContent><dl className="space-y-2 text-xs"><div><dt className="text-muted-foreground">Version</dt><dd>{analysis.modelVersion}</dd></div><div><dt className="text-muted-foreground">SHA-256 model hash</dt><dd className="break-all font-mono">{analysis.modelHash}</dd></div></dl></CardContent>
          </Card>
        </div>

        <aside className="flex gap-3 rounded-2xl border border-moderate/35 bg-moderate/5 p-4 lg:col-span-2"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-moderate" /><p className="text-sm leading-relaxed text-muted-foreground">{analysis.warning} The benchmark above is internal development data, not a claim of clinical accuracy.</p></aside>
      </div>
    </div>
  )
}
