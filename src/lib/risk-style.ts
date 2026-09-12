import type { ScanAnalysis } from '@/src/lib/types'

export function riskColorToken(level: ScanAnalysis['riskLevel']) {
  if (level === 'Elevated Risk') return 'risk'
  if (level === 'Moderate Risk') return 'moderate'
  return 'safe'
}

export function riskExplanation(level: ScanAnalysis['riskLevel']) {
  if (level === 'Elevated Risk') {
    return 'Your conjunctiva shows paleness patterns commonly associated with lower hemoglobin levels.'
  }
  if (level === 'Moderate Risk') {
    return 'A few visual signals were slightly outside the typical range. Consider scanning again.'
  }
  return 'Your conjunctiva color and texture fall within a typical, healthy range.'
}
