/**
 * Shared domain types for AnemiaScan.
 *
 * IMPORTANT CONTEXT FOR ANYONE READING THIS FILE:
 * V4 screening values come from the server-side calibrated model applied to a
 * guided palpebral-conjunctiva ROI. Nothing here is a diagnosis or laboratory
 * result. Legacy fields remain only so older local-history records can still
 * be opened without presenting them as V4 results.
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
  | 'proof-auth'

/**
 * The three screening bands the V4 result reports. These are risk *bands*,
 * deliberately phrased as risk rather than as a condition.
 */
export type RiskLevel = 'Low Risk' | 'Moderate Risk' | 'Elevated Risk'

/** Legacy signal keys retained only for pre-V4 local-history compatibility. */
export type SignalKey = 'pallor' | 'redness' | 'saturation' | 'texture' | 'illumination'

/** One measured visual signal, with its contribution to the blended score. */
export interface SignalBreakdown {
  key: SignalKey
  /** Short human-facing name, e.g. "Conjunctival pallor". */
  label: string
  /** 0..100 normalised reading for this signal. */
  value: number
  /** 0..1 contribution of this signal to the final blended risk score. */
  weight: number
  /** One short, plain-language sentence explaining what this reading means. */
  hint: string
}

/** The complete stored result of analysing a single captured frame. */
export interface ScanAnalysis {
  id: string
  /** Epoch milliseconds the scan was produced. */
  createdAt: number
  /** Captured frame as a data URL. May be blanked on archived history entries. */
  imageDataUrl: string
  /** Mean channel brightness of the frame, 0..255. */
  brightness: number
  /** V4 screening probability mapped to 0..100 for existing history charts. */
  riskScore: number
  riskLevel: RiskLevel
  /** True when the frame is too dark to be analysed meaningfully. */
  tooDark: boolean
  /** Legacy pre-V4 field. New V4 screens do not display it. */
  confidence: number
  signals: SignalBreakdown[]
  /** Legacy pre-V4 display field. V4 records keep this at zero and never show it. */
  hbRange: { low: number; high: number }
  /** Legacy pre-V4 capture-quality sub-scores. */
  quality: { light: number; focus: number; framing: number }

  /* ------------------------------------------------------------------------
   * Legacy registry fields. Optional because the direct V4 endpoint does not
   * create an on-chain commitment.
   * ---------------------------------------------------------------------- */
  isSynthetic?: boolean
  demoNotice?: string
  confidenceBps?: number
  qualityBps?: number
  commitment?: string
  scanIdHash?: string
  modelHash?: string
  registeredOnChain?: boolean
  chainTxHash?: string | null
  chainTxStatus?: string | null
  explorerUrl?: string | null

  /** Deterministic V4 result fields returned by POST /api/anemia/analyze. */
  decision?: 'higher_risk' | 'lower_risk' | 'uncertain'
  screeningProbability?: number
  operatingThreshold?: number
  uncertain?: boolean
  modelVersion?: 'anemiascan-v4-eff-conv-vit'
  modelQuality?: {
    accepted: boolean
    brightness: number
    blurVariance: number
    clippedFraction: number
    failures: string[]
  }
  internalBenchmark?: {
    label: 'Internal development benchmark'
    samples: number
    accuracy: number
    sensitivity: number
    specificity: number
    auroc: number
    f1: number
    confusionMatrix: { tn: number; fp: number; fn: number; tp: number }
  }
  warning?: string
}

/** A just-captured frame, before it has been analysed. */
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

