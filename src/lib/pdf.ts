/**
 * Doctor-portal PDF export.
 *
 * This used to print an "Est. Hemoglobin Range" and a five-row "Signal
 * Breakdown" — both artefacts of the deleted local heuristic
 * (`src/lib/analyze.ts`). The tool cannot measure haemoglobin, and there are
 * no "signals" any more: the model produces a calibrated probability, two
 * candidate scores, and fusion gate weights. A clinician-facing PDF is
 * exactly the place a fabricated lab-like number must not appear, so this
 * prints what the model actually returned instead.
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

import { formatDateTime, formatPercent, formatProbability, humaniseKey } from './format'
import type { PatientProfile, ScanAnalysis } from './types'

export function generatePatientReportPDF(analysis: ScanAnalysis, patient?: PatientProfile) {
  const doc = new jsPDF()
  const model = analysis.modelOutput

  doc.setFontSize(22)
  doc.setTextColor(0, 0, 0)
  doc.text('AnemiaScan Report', 14, 22)

  doc.setFontSize(12)
  doc.setTextColor(100)
  doc.text(`Generated on: ${formatDateTime(Date.now())}`, 14, 30)
  doc.text(`Scan captured: ${formatDateTime(analysis.createdAt)}`, 14, 36)

  doc.setFontSize(16)
  doc.setTextColor(0, 0, 0)
  doc.text('Patient Information', 14, 51)

  if (patient) {
    autoTable(doc, {
      startY: 56,
      head: [['Field', 'Details']],
      body: [
        ['Name', patient.name],
        ['Age', patient.age.toString()],
        ['Gender', patient.gender],
        ['Medical Notes', patient.medicalNotes || 'None provided'],
      ],
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] },
    })
  } else {
    doc.setFontSize(12)
    doc.text('No patient profile attached.', 14, 58)
  }

  const afterPatient = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY : 66

  doc.setFontSize(16)
  doc.setTextColor(0, 0, 0)
  doc.text('Screening Result', 14, afterPatient + 15)

  autoTable(doc, {
    startY: afterPatient + 20,
    head: [['Metric', 'Value']],
    body: [
      ['Decision', analysis.riskLevel],
      ['Calibrated probability', `${formatProbability(analysis.screeningProbability)} (${formatPercent(analysis.screeningProbability)})`],
      ['Operating threshold', `${formatProbability(model.operatingThreshold)} (tuned for sensitivity, not a 50% midpoint)`],
      ['Uncertainty margin', `± ${formatProbability(model.uncertaintyMargin)}`],
      ['Capture quality', `${Math.round(analysis.captureQuality)}/100`],
      ['Model version', model.modelVersion || '—'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [46, 204, 113] },
  })

  const afterResult = (doc as any).lastAutoTable.finalY

  const candidateRows = Object.entries(model.candidateProbabilities ?? {}).map(([key, probability]) => [
    humaniseKey(key) + (key === model.selectedModel ? ' (selected)' : ''),
    formatProbability(Number(probability)),
    Number.isFinite(Number(model.candidateThresholds?.[key]))
      ? formatProbability(Number(model.candidateThresholds[key]))
      : '—',
  ])

  if (candidateRows.length) {
    doc.setFontSize(16)
    doc.text('Candidate Models', 14, afterResult + 15)
    autoTable(doc, {
      startY: afterResult + 20,
      head: [['Model', 'Probability', 'Threshold']],
      body: candidateRows,
      theme: 'striped',
      foot: [[
        'Disagreement',
        model.modelDisagreement ? 'Yes' : 'No',
        model.nearThreshold ? 'Inside uncertainty margin' : '',
      ]],
    })
  }

  const afterCandidates = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY : afterResult + 20

  doc.setFontSize(16)
  doc.text('Provenance', 14, afterCandidates + 15)
  autoTable(doc, {
    startY: afterCandidates + 20,
    head: [['Field', 'Value']],
    body: [
      ['Model hash', analysis.modelHash ?? '—'],
      ['Commitment', analysis.commitment ?? '—'],
      ['Scan ID hash', analysis.scanIdHash ?? '—'],
      [
        'On-chain status',
        analysis.registeredOnChain
          ? `Registered${analysis.chainTxStatus ? ` (${analysis.chainTxStatus})` : ''}`
          : 'Not registered',
      ],
    ],
    theme: 'grid',
    styles: { fontSize: 8 },
  })

  doc.setFontSize(10)
  doc.setTextColor(150, 150, 150)
  const pageHeight = doc.internal.pageSize.height
  doc.text(
    'DISCLAIMER: This is a research screening result, not a clinical diagnosis. It has no',
    14,
    pageHeight - 20,
  )
  doc.text(
    'regulatory clearance and cannot replace a laboratory haemoglobin (CBC) blood test.',
    14,
    pageHeight - 15,
  )

  const filename = patient ? `${patient.name.replace(/\s+/g, '_')}_ScanReport.pdf` : 'AnemiaScan_Report.pdf'
  doc.save(filename)
}
