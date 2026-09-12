export type ScreenId =
  | 'home'
  | 'scan'
  | 'processing'
  | 'result'
  | 'insights'
  | 'inconclusive'
  | 'doctor'

export interface ScanAnalysis {
  imageDataUrl: string
  brightness: number
  riskScore: number
  riskLevel: 'Low Risk' | 'Moderate Risk' | 'Elevated Risk'
  tooDark: boolean
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
