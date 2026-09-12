import type { ScanAnalysis } from '@/src/lib/types'

// A close-up eye capture (eyelashes, lid crease shadow, pupil) is
// naturally darker on average than a normal well-lit face/selfie, so this
// stays well below what would count as "too dark" for a typical photo —
// it's only meant to catch a genuinely failed/black capture, not flag a
// realistic close-up shot taken in ordinary indoor lighting.
const DARK_THRESHOLD = 28

function riskLevelFromScore(score: number): ScanAnalysis['riskLevel'] {
  if (score >= 65) return 'Elevated Risk'
  if (score >= 35) return 'Moderate Risk'
  return 'Low Risk'
}

/**
 * Lightweight, on-device heuristic used to make the demo feel alive.
 * This is NOT a diagnostic model — it approximates conjunctival pallor
 * by comparing red-channel dominance against green/blue in the sampled
 * region, then maps that to a risk-style percentage.
 */
export function analyzeImageData(imageData: ImageData): ScanAnalysis {
  const { data } = imageData
  let sumR = 0
  let sumG = 0
  let sumB = 0
  const pixelCount = data.length / 4

  for (let i = 0; i < data.length; i += 4) {
    sumR += data[i]
    sumG += data[i + 1]
    sumB += data[i + 2]
  }

  const avgR = sumR / pixelCount
  const avgG = sumG / pixelCount
  const avgB = sumB / pixelCount
  const brightness = (avgR + avgG + avgB) / 3

  const rednessIndex = avgR / (avgG + avgB + 1)
  const clampedRedness = Math.min(Math.max(rednessIndex, 0.55), 1.05)
  const pallorFactor = 1 - (clampedRedness - 0.55) / 0.5

  const seed = Math.round(brightness + avgR) % 9
  const jitter = seed - 4

  const rawScore = 38 + pallorFactor * 48 + jitter
  const riskScore = Math.min(96, Math.max(6, Math.round(rawScore)))

  return {
    imageDataUrl: '',
    brightness,
    riskScore,
    riskLevel: riskLevelFromScore(riskScore),
    tooDark: brightness < DARK_THRESHOLD,
  }
}
