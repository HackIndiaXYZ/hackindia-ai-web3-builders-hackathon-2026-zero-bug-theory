import { ArrowLeft, ArrowRight, BrainCircuit, Camera, Eye, FlaskConical, ShieldAlert, Stethoscope } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const PIPELINE = [
  { icon: Camera, title: 'Guided ROI capture', body: 'The reticle crops a tight square around the exposed palpebral conjunctiva. It is a guided region, not automatic segmentation.' },
  { icon: BrainCircuit, title: 'Three vision-model logits', body: 'EfficientNet-B3, ConvNeXt-Tiny and ViT-B/16 process the ROI with the bundle’s exact resize, crop and ImageNet normalization.' },
  { icon: Eye, title: '32 engineered features', body: 'The same saved RGB, HSV, LAB, brightness and texture pipeline produces 32 values, standardized with training-only scalers.' },
  { icon: FlaskConical, title: 'Calibrated logistic stacker', body: 'Three logits followed by feature_00 through feature_31 form exactly 35 inputs. Saved scaling, logistic regression and Platt calibration produce the screening score.' },
] as const

const LIMITS = [
  'A phone image cannot measure haemoglobin and cannot diagnose or rule out anaemia.',
  'Lighting, focus, camera processing, eye irritation and capture framing can affect the image.',
  'The reported benchmark is internal development data, not external clinical validation.',
  'Performance may differ across populations, devices and real-world capture conditions.',
] as const

const URGENT = [
  'Chest pain, fainting or severe shortness of breath',
  'A racing heartbeat with weakness or dizziness',
  'Visible or suspected significant blood loss',
  'Rapidly worsening symptoms or feeling acutely unwell',
] as const

export function LearnScreen({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="home-hero relative isolate overflow-hidden border-b border-border/70">
        <div className="animate-aurora pointer-events-none absolute inset-0 opacity-45" aria-hidden="true" />
        <div className="grain pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-10 lg:px-10 lg:py-14">
          <Button variant="ghost" onClick={onBack} className="h-10 w-fit rounded-full px-3"><ArrowLeft className="h-4 w-4" />Back</Button>
          <Badge variant="outline" className="w-fit">Research screening education</Badge>
          <h1 className="display max-w-3xl text-display-sm text-balance text-foreground sm:text-display">What AnemiaScan V4 does—and what it cannot tell you</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">Anaemia means the blood cannot carry oxygen as effectively as it should, commonly because haemoglobin is low. A CBC or haemoglobin blood test—not a photograph—is how it is assessed clinically.</p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 lg:px-10 lg:py-14">
        <section className="space-y-4" aria-labelledby="pipeline-heading">
          <div><p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">The implementation</p><h2 id="pipeline-heading" className="mt-2 text-2xl font-semibold">The deterministic V4 path</h2></div>
          <div className="grid gap-4 sm:grid-cols-2">
            {PIPELINE.map(({ icon: Icon, title, body }, index) => <Card key={title}><CardHeader><span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span><CardTitle>{index + 1}. {title}</CardTitle></CardHeader><CardContent><p className="text-sm leading-relaxed text-muted-foreground">{body}</p></CardContent></Card>)}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2" aria-label="Screening limitations and follow-up">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-moderate" />Hard limits</CardTitle><CardDescription>These limits apply even when image quality passes.</CardDescription></CardHeader>
            <CardContent><ul className="space-y-3">{LIMITS.map((item) => <li key={item} className="flex gap-2 text-sm leading-relaxed text-muted-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-moderate" />{item}</li>)}</ul></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Stethoscope className="h-5 w-5 text-risk" />When not to wait for an app</CardTitle><CardDescription>Seek urgent medical help for serious or rapidly worsening symptoms.</CardDescription></CardHeader>
            <CardContent><ul className="space-y-3">{URGENT.map((item) => <li key={item} className="flex gap-2 text-sm leading-relaxed text-muted-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-risk" />{item}</li>)}</ul></CardContent>
          </Card>
        </section>

        <section className="rounded-3xl border border-primary/25 bg-primary/5 p-6 sm:p-8">
          <h2 className="text-xl font-semibold">How to use a result safely</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">Read the probability as a screening score, not diagnostic certainty. A higher-risk or uncertain result is a reason to arrange professional evaluation and appropriate blood testing. A lower-risk result does not overrule symptoms or clinical advice.</p>
          <Button size="lg" onClick={onStart} className="mt-6 rounded-full">Start a guided V4 scan<ArrowRight className="h-4 w-4" /></Button>
        </section>
      </div>
    </div>
  )
}
