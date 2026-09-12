import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, ClipboardList, Clock3, Eye, FileText, Send, Stethoscope, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { riskColorToken } from '@/src/lib/risk-style'
import type { DoctorReport } from '@/src/lib/types'
import { cn } from '@/lib/utils'
import { generatePatientReportPDF } from '@/src/lib/pdf'

export function DoctorPortal({ reports, onBack, onSaveAdvice }: { reports: DoctorReport[]; onBack: () => void; onSaveAdvice: (id: string, advice: string, assessment: 'Safe' | 'Unsafe') => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null)
  const selected = useMemo(() => reports.find((report) => report.id === selectedId) ?? reports[0], [reports, selectedId])
  const awaiting = reports.filter((report) => report.status === 'Awaiting Review').length
  return <div className="min-h-dvh bg-background text-foreground"><header className="border-b border-border bg-card"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Stethoscope className="h-5 w-5" /></div><div><p className="font-semibold tracking-tight">AnemiaScan Doctor Portal</p><p className="text-xs text-muted-foreground">Prototype · local demo data</p></div></div><Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Patient experience</Button></div></header>
    <main className="mx-auto max-w-7xl px-5 py-7"><div className="mb-7"><p className="text-sm font-medium text-primary">Clinical review workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Reports routed directly to the doctor</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Review AI-assisted screenings, add clinician guidance, and keep the doctor as the decision maker. This is not a diagnostic or prescribing tool.</p></div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3"><Metric icon={<ClipboardList />} label="Reports received" value={reports.length} detail="Submitted from patient flow" /><Metric icon={<Clock3 />} label="Awaiting review" value={awaiting} detail="Requires clinician attention" /><Metric icon={<CheckCircle2 />} label="Reviewed" value={reports.length - awaiting} detail="Doctor guidance saved" /></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(260px,.85fr)_minmax(0,1.8fr)]"><section className="rounded-2xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Doctor review queue</h2><p className="mt-1 text-xs text-muted-foreground">New patient scans appear here instantly.</p></div>{reports.length ? <div className="divide-y divide-border">{reports.map((report) => <button key={report.id} onClick={() => setSelectedId(report.id)} className={cn('w-full p-4 text-left transition hover:bg-muted/60', selected?.id === report.id && 'bg-primary/5')}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{report.patientLabel}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(report.submittedAt).toLocaleString()}</p></div><Status status={report.status} /></div><p className={cn('mt-3 text-sm font-semibold', riskColorToken(report.analysis.riskLevel) === 'risk' ? 'text-risk' : riskColorToken(report.analysis.riskLevel) === 'moderate' ? 'text-moderate' : 'text-safe')}>{report.analysis.riskLevel} · p={report.analysis.screeningProbability.toFixed(3)}</p></button>)}</div> : <EmptyQueue />}</section>
        <section>{selected ? <ReportDetail report={selected} onSave={onSaveAdvice} /> : <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-8 text-center"><FileText className="h-8 w-8 text-muted-foreground" /><h2 className="mt-4 font-semibold">No reports yet</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">Complete a patient scan, then select “Send for review” on the result screen. The report will route here immediately.</p></div>}</section></div></main></div>
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: number; detail: string }) { return <div className="rounded-2xl border border-border bg-card p-4"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div><p className="mt-4 text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div> }
function Status({ status }: { status: DoctorReport['status'] }) { return <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', status === 'Reviewed' ? 'bg-safe/10 text-safe' : 'bg-moderate/10 text-moderate')}>{status}</span> }
function EmptyQueue() { return <div className="p-7 text-center"><ClipboardList className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Review queue is clear</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Reports sent from the patient result screen will appear here.</p></div> }

function ReportDetail({ report, onSave }: { report: DoctorReport; onSave: (id: string, advice: string, assessment: 'Safe' | 'Unsafe') => void }) {
  const [advice, setAdvice] = useState(report.doctorAdvice ?? '')
  const [assessment, setAssessment] = useState<'Safe' | 'Unsafe' | null>(report.clinicalAssessment ?? null)
  const [saved, setSaved] = useState(report.status === 'Reviewed')
  const token = riskColorToken(report.analysis.riskLevel)
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">{report.patientLabel}</p>
              <p className="text-xs text-muted-foreground">
                Report ID {report.id} · Submitted {new Date(report.submittedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => generatePatientReportPDF(report.analysis, report.patientProfile)}>
              <FileText className="mr-2 h-4 w-4" /> Download PDF
            </Button>
            <Status status={saved ? 'Reviewed' : 'Awaiting Review'} />
          </div>
        </div>

        {report.patientProfile && (
          <div className="mt-6 rounded-xl border border-border bg-background p-4 text-sm">
            <h3 className="font-semibold mb-2">Patient Profile</h3>
            <div className="grid grid-cols-2 gap-2 text-muted-foreground">
              <p>Name: <span className="text-foreground">{report.patientProfile.name}</span></p>
              <p>Age: <span className="text-foreground">{report.patientProfile.age}</span></p>
              <p>Gender: <span className="text-foreground">{report.patientProfile.gender}</span></p>
              <p className="col-span-2 mt-1">Medical Notes: <span className="text-foreground">{report.patientProfile.medicalNotes || 'None'}</span></p>
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Info label="AI screening result" value={report.analysis.riskLevel} tone={token} />
          <Info label="Calibrated probability" value={report.analysis.screeningProbability.toFixed(3)} />
          <Info label="Capture quality" value={`${report.analysis.captureQuality}/100`} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Decision threshold {report.analysis.modelOutput.operatingThreshold.toFixed(4)}, chosen for high
          sensitivity rather than balanced accuracy — a probability above it means "worth confirming", not
          "likely anaemic". Model {report.analysis.modelOutput.modelVersion}.
          {report.analysis.modelOutput.modelDisagreement ? ' The two candidate models disagreed on this capture.' : ''}
        </p>
        <div className="mt-5 rounded-xl border border-moderate/40 bg-moderate/10 p-3 text-xs leading-relaxed text-moderate">
          AI-assisted screening result only — not a medical diagnosis. Clinical confirmation, such as CBC testing, may be required at the doctor’s discretion.
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">Scan context</h2>
            <p className="text-xs text-muted-foreground">Original patient-captured image for clinician review</p>
          </div>
        </div>
        {report.analysis.imageDataUrl && (
          <img src={report.analysis.imageDataUrl} alt="Patient-contributed lower eyelid scan" className="mt-4 aspect-video w-full rounded-xl border border-border object-cover" />
        )}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">Doctor guidance</h2>
            <p className="text-xs text-muted-foreground">Clinician-authored advice only; no automated recommendation.</p>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <Button
            variant={assessment === 'Safe' ? 'default' : 'outline'}
            className={assessment === 'Safe' ? 'bg-safe hover:bg-safe/90 text-white border-safe' : ''}
            onClick={() => { setAssessment('Safe'); setSaved(false) }}
          >
            Mark as Safe
          </Button>
          <Button
            variant={assessment === 'Unsafe' ? 'default' : 'outline'}
            className={assessment === 'Unsafe' ? 'bg-risk hover:bg-risk/90 text-white border-risk' : ''}
            onClick={() => { setAssessment('Unsafe'); setSaved(false) }}
          >
            Mark as Unsafe (Requires testing)
          </Button>
        </div>
        <textarea
          value={advice}
          onChange={(event) => { setAdvice(event.target.value); setSaved(false) }}
          placeholder="Add guidance for the patient, such as whether to arrange a clinical visit or laboratory confirmation…"
          className="mt-4 min-h-28 w-full rounded-xl border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary"
        />
        <div className="mt-3 flex justify-end">
          <Button disabled={!assessment || !advice.trim()} onClick={() => { onSave(report.id, advice.trim(), assessment!); setSaved(true) }}>
            <Send className="mr-2 h-4 w-4" /> Save doctor guidance
          </Button>
        </div>
      </div>
    </div>
  )
}
function Info({ label, value, tone }: { label: string; value: string; tone?: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className={cn('mt-1 text-sm font-semibold', tone === 'risk' ? 'text-risk' : tone === 'moderate' ? 'text-moderate' : tone === 'safe' ? 'text-safe' : 'text-foreground')}>{value}</p></div> }
