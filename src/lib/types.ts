export type ScreenId =
  | 'home'
  | 'scan'
  | 'processing'
  | 'result'
  | 'insights'
  | 'inconclusive'

export interface ScanAnalysis {
  imageDataUrl: string
  brightness: number
  riskScore: number
  riskLevel: 'Low Risk' | 'Moderate Risk' | 'Elevated Risk'
  tooDark: boolean
}
