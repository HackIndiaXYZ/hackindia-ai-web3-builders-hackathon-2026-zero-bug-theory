/**
 * Shared domain types for AnemiaScan.
 *
 * IMPORTANT CONTEXT FOR ANYONE READING THIS FILE:
 * AnemiaScan is a *screening aid*, not a diagnostic device. Every number that
 * flows through these types comes from an on-device colour/texture heuristic
 * applied to a photo of the palpebral conjunctiva (the inside of the lower
 * eyelid). Nothing here is a clinically validated measurement, and nothing here
 * should ever be presented to a user as a diagnosis or as a laboratory result.
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

/**
 * The three screening bands the heuristic reports. These are risk *bands*,
 * deliberately phrased as risk rather than as a condition.
 */
export type RiskLevel = 'Low Risk' | 'Moderate Risk' | 'Elevated Risk'

/** The five independent pixel measurements the analyser reports. */
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

/** The complete result of analysing a single captured frame. */
export interface ScanAnalysis {
  id: string
  /** Epoch milliseconds the scan was produced. */
  createdAt: number
  /** Captured frame as a data URL. May be blanked on archived history entries. */
  imageDataUrl: string
  /** Mean channel brightness of the frame, 0..255. */
  brightness: number
  /** Blended screening score, 0..100. Higher means more anaemia-like signals. */
  riskScore: number
  riskLevel: RiskLevel
  /** True when the frame is too dark to be analysed meaningfully. */
  tooDark: boolean
  /** 0..100 confidence in this reading, driven by capture quality. */
  confidence: number
  signals: SignalBreakdown[]
  /** Illustrative estimated haemoglobin interval in g/dL. Not a lab value. */
  hbRange: { low: number; high: number }
  /** Capture quality sub-scores, each 0..100. */
  quality: { light: number; focus: number; framing: number }

  /* ------------------------------------------------------------------------
   * Real-model fields — present once a real backend screening result (from
   * the FastAPI service, see src/lib/api.ts) has been mapped in on top of the
   * on-device heuristic above. Optional because a purely local/demo analysis
   * (or a rejected/inconclusive capture) never populates them.
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
  doctorAdvice?: string
  reviewedAt?: string
}

