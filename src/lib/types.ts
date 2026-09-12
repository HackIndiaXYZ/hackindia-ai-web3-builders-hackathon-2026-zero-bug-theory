/**
 * Shared domain types for AnemiaScan.
 *
 * IMPORTANT CONTEXT FOR ANYONE READING THIS FILE:
 *
 * Every medical number in this app comes from the SERVER. The browser captures
 * a photo, uploads it, and renders what comes back. It does not compute a risk
 * score, a risk band, a confidence figure, or a haemoglobin estimate, and it
 * must never start doing so again.
 *
 * That is a deliberate reversal. This app used to run a local colour/texture
 * heuristic (`src/lib/analyze.ts`) that produced its own `riskScore`,
 * `riskLevel`, five "signals" and an "illustrative haemoglobin interval". The
 * backend result was then merged on top of it, overwriting only the score, band
 * and confidence — so the signal bars, the capture-quality bars and the
 * haemoglobin range shown next to a real model result were all still derived
 * from the heuristic's own discarded score. The screen presented server output
 * and local guesswork side by side as though they were one measurement.
 *
 * The heuristic is gone. The haemoglobin interval is gone with it: this tool
 * does not and cannot measure haemoglobin, so it no longer prints a g/dL range.
 *
 * AnemiaScan is a screening aid, not a diagnostic device. Nothing here is
 * clinically validated.
 */

/** Every routable surface in the app shell. */
export type ScreenId =
  | 'home'
  | 'scan'
  | 'processing'
  | 'result'

  | 'insights'
  | 'inconclusive'
  | 'history'
  | 'learn'
  | 'blockchain'
  | 'doctor'
  | 'patient-auth'
  | 'patient-profile'

/**
 * The model's four possible outcomes, exactly as the inference contract
 * defines them. `uncertain` is a first-class result — it means the calibrated
 * probability sits within the uncertainty margin of the operating threshold,
 * or the two candidate models disagreed — and it must never be collapsed into
 * a middle risk band on screen.
 */
export type Decision = 'lower_risk' | 'higher_risk' | 'uncertain'

/** Human-facing label for each decision. */
export type RiskLevel = 'Lower risk' | 'Higher risk' | 'Uncertain'

/** Machine-readable reasons a capture was refused. Stable; safe to branch on. */
export type RecaptureReason =
  | 'roi_too_small'
  | 'roi_coverage_low'
  | 'no_roi_detected'
  | 'extremely_dark'
  | 'extremely_bright'
  | 'severely_clipped'
  | 'out_of_focus'
  | 'degenerate_input'
  | 'implausible_chroma'
  | 'excess_high_frequency'
  | 'out_of_distribution'
  | 'encoder_out_of_range'
  | 'probability_saturated'

/** Measured capture quality, from the server. */
export interface QualityReport {
  accepted: boolean
  brightness: number
  blurVariance: number | null
  clippedFraction: number | null
  failures: string[]
}

/** Where the server located the conjunctiva in the submitted frame. */
export interface RoiReport {
  located: boolean
  /** Fraction of the submitted frame identified as conjunctiva tissue, 0..1. */
  coverage: number
  /** Fraction of the returned ROI that was masked to black, 0..1. */
  maskedFraction: number
  meanRednessOverYellow: number
  method: string
  bbox: number[] | null
  sourceSize: number[]
  roiSize: number[]
  failures: string[]
}

/** How far the located ROI sat from the model's training distribution. */
export interface GateReport {
  accepted: boolean
  failures: string[]
  /** Sum of squared feature z-scores. Expectation is 32 for in-distribution input. */
  distributionBudget: number
  distributionBudgetLimit: number
  rmsZ: number
  maxAbsZ: number
  worstFeatures: { feature: string; z: number }[]
  chromaZ: Record<string, number>
  texture: Record<string, number>
  logitZ: Record<string, number>
}

/** Exactly what the model produced. Every field is server-computed. */
export interface ModelOutput {
  decision: Decision
  riskCategory: string
  /** The calibrated screening probability, 0..1. NOT a confidence. */
  screeningProbability: number
  probabilityBps: number
  selectedModel: string
  /** The operating threshold the decision was made against (~0.2076). */
  operatingThreshold: number
  uncertaintyMargin: number
  candidateProbabilities: Record<string, number>
  candidateThresholds: Record<string, number>
  modelDisagreement: boolean
  nearThreshold: boolean
  /** Softmax weights the gated fusion head gave each branch. */
  fusionGateWeights: Record<string, number>
  modelVersion: string
}

/** One completed screening, as stored and displayed. */
export interface ScanAnalysis {
  id: string
  /** Epoch milliseconds the scan was produced. */
  createdAt: number
  /** Captured frame as a data URL. May be blanked on archived history entries. */
  imageDataUrl: string

  /** The model's decision and its human label. */
  decision: Decision
  riskLevel: RiskLevel
  /** Calibrated screening probability, 0..1 — the headline number. */
  screeningProbability: number
  /** Measured capture quality, 0..100. Not a certainty in the result. */
  captureQuality: number

  modelOutput: ModelOutput
  quality?: QualityReport
  roi?: RoiReport
  gate?: GateReport

  /* -- provenance ---------------------------------------------------------- */
  isSynthetic: boolean
  demoNotice?: string
  probabilityBps?: number
  qualityBps?: number
  commitment?: string
  scanIdHash?: string
  modelHash?: string
  registeredOnChain?: boolean
  chainTxHash?: string | null
  chainTxStatus?: string | null
  explorerUrl?: string | null
}

/** A just-captured frame, before it has been sent for analysis. */
export interface CapturedImage {
  blob: Blob
  imageDataUrl: string
}

export interface DoctorReport {
  id: string
  patientLabel: string
  analysis: ScanAnalysis
  submittedAt: string
  status: 'Awaiting Review' | 'Reviewed'
  patientProfile?: PatientProfile
  doctorAdvice?: string
  clinicalAssessment?: 'Safe' | 'Unsafe'
  reviewedAt?: string
}

export interface PatientProfile {
  name: string
  age: number
  gender: string
  medicalNotes?: string
}
