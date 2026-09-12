import type { RiskLevel, ScanAnalysis, SignalBreakdown, SignalKey } from '@/src/lib/types'
import { clamp } from '@/src/lib/format'

/**
 * ON-DEVICE CONJUNCTIVAL PALLOR HEURISTIC
 * =======================================
 * This is NOT a diagnostic model. There is no machine learning here, no network
 * call, and no clinical validation. It is a transparent, deterministic image
 * statistic: we sample the captured frame, measure colour, chroma, saturation,
 * local contrast and exposure over the central region where the everted lower
 * eyelid sits, and blend those five readings into a single screening score.
 *
 * The design goals, in order:
 *  1. Honesty — every number is traceable to a pixel measurement we can name.
 *  2. Determinism — the same image always produces the same score. There is no
 *     random term anywhere in this file.
 *  3. Privacy — pixels never leave the device; the whole pass is synchronous
 *     arithmetic over a sampled grid.
 *
 * Only a haemoglobin blood test can establish anaemia. Every mapping below
 * (including the haemoglobin interval) is illustrative, tuned for a plausible
 * demonstrable range, and must never be presented as a measurement.
 */

/**
 * Mean frame brightness (0..255) below which a capture is unusable.
 * A close-up eye capture (eyelashes, lid crease shadow, pupil) is naturally
 * darker on average than a normal well-lit face/selfie, so this stays well
 * below what would count as "too dark" for a typical photo — it's only meant
 * to catch a genuinely failed/black capture, not flag a realistic close-up
 * shot taken in ordinary indoor lighting.
 */
export const DARK_THRESHOLD = 28

/** Max grid samples per axis. Caps work at ~9k samples regardless of resolution. */
const GRID = 96

/** Side length of the contiguous centre patch used for the sharpness metric. */
const FOCUS_PATCH = 72

/**
 * Region of interest, in normalised frame coordinates. The capture UI centres
 * the eyelid inside its guide frame, so the conjunctiva reliably lands in a
 * wide, shallow band across the middle of the frame.
 */
const ROI = { x: 0.18, y: 0.26, w: 0.64, h: 0.48 } as const

/**
 * Contribution of each signal to the blended score. These are the exact values
 * reported back on each SignalBreakdown, and they sum to 1.
 */
const WEIGHTS: Record<SignalKey, number> = {
  pallor: 0.36,
  redness: 0.26,
  saturation: 0.16,
  texture: 0.14,
  illumination: 0.08,
}

const LABELS: Record<SignalKey, string> = {
  pallor: 'Conjunctival pallor',
  redness: 'Vascular redness',
  saturation: 'Color saturation',
  texture: 'Tissue texture',
  illumination: 'Lighting quality',
}

const SIGNAL_ORDER: SignalKey[] = ['pallor', 'redness', 'saturation', 'texture', 'illumination']

/** Map a raw measurement onto 0..1 across the [lo, hi] window. */
function norm01(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 0
  return clamp((value - lo) / (hi - lo), 0, 1)
}

/** Rec. 709 relative luminance for channels already scaled to 0..1. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 65) return 'Elevated Risk'
  if (score >= 35) return 'Moderate Risk'
  return 'Low Risk'
}

let idCounter = 0

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `scan_${crypto.randomUUID()}`
    }
  } catch {
    /* fall through to the timestamp id */
  }
  idCounter += 1
  return `scan_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

/* ------------------------------------------------------------------------- */
/* Per-signal copy                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Each hint states what was measured AND which direction is healthy, because
 * the signals do not share a polarity: a high `pallor` reading is a concern,
 * while a high reading on the other four is reassuring.
 */
function hintFor(key: SignalKey, value: number): string {
  switch (key) {
    case 'pallor':
      if (value >= 66) {
        return 'The tissue reads distinctly washed out — low colour intensity is the classic pallor pattern, and higher here is the concerning direction.'
      }
      if (value >= 38) {
        return 'Mildly washed out. Some colour is present but less than a well-perfused conjunctiva usually shows.'
      }
      return 'Little to no washing out. The tissue holds strong colour, which is the reassuring direction for this signal.'
    case 'redness':
      if (value >= 66) {
        return 'Strong red dominance over green and blue, consistent with a well-perfused, blood-rich membrane.'
      }
      if (value >= 38) {
        return 'Moderate red dominance. Present, but softer than a typical healthy conjunctiva.'
      }
      return 'Red barely leads green and blue. Low red dominance is what pallor looks like numerically.'
    case 'saturation':
      if (value >= 66) {
        return 'Rich, vivid colour across the sample — pigment is intense rather than grey.'
      }
      if (value >= 38) {
        return 'Middling colour intensity. Camera white balance can pull this down, so re-scan in daylight if it looks off.'
      }
      return 'Colour is close to grey. That can mean pallor, or simply a dull, indirect light source.'
    case 'texture':
      if (value >= 66) {
        return 'Fine vascular detail is clearly resolved — small vessels give the surface visible structure.'
      }
      if (value >= 38) {
        return 'Some surface structure, but softer than ideal. A steadier, closer capture sharpens this.'
      }
      return 'The surface reads flat. Either the vessels are faint or the frame is slightly out of focus.'
    case 'illumination':
      if (value >= 66) {
        return 'Exposure sits in the sweet spot, with almost no crushed shadows or blown highlights.'
      }
      if (value >= 38) {
        return 'Usable but imperfect exposure. Bright, indirect daylight would give a cleaner reading.'
      }
      return 'Exposure is off — too dark, too bright, or clipped. This lowers confidence in every other signal.'
    default:
      return ''
  }
}

/* ------------------------------------------------------------------------- */
/* Haemoglobin interval                                                       */
/* ------------------------------------------------------------------------- */

/**
 * ILLUSTRATIVE ONLY — not clinically validated, and not calibrated against any
 * cohort. This piecewise curve exists so the UI can show an interval instead of
 * a bare percentage; it roughly follows the bands the app already communicates
 * (Low Risk ~13-16, Moderate ~11-13, Elevated ~7-11 g/dL).
 */
const HB_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 15.8],
  [20, 14.5],
  [35, 13.1],
  [50, 12.1],
  [65, 11.0],
  [82, 9.4],
  [100, 7.4],
]

function hbCentre(score: number): number {
  const s = clamp(score, 0, 100)
  for (let i = 1; i < HB_ANCHORS.length; i += 1) {
    const [prevScore, prevHb] = HB_ANCHORS[i - 1]
    const [nextScore, nextHb] = HB_ANCHORS[i]
    if (s <= nextScore) {
      const span = nextScore - prevScore
      const t = span === 0 ? 0 : (s - prevScore) / span
      return prevHb + (nextHb - prevHb) * t
    }
  }
  return HB_ANCHORS[HB_ANCHORS.length - 1][1]
}

/** The interval widens as confidence drops — an uncertain capture says less. */
function hbRangeFor(score: number, confidence: number): { low: number; high: number } {
  const centre = hbCentre(score)
  const halfWidth = 0.45 + (1 - clamp(confidence, 0, 100) / 100) * 2.1
  const low = round1(clamp(centre - halfWidth, 4.2, 19))
  const high = round1(clamp(centre + halfWidth, low + 0.2, 19.5))
  return { low, high }
}

/* ------------------------------------------------------------------------- */
/* Fallback                                                                   */
/* ------------------------------------------------------------------------- */

/** Used when the frame is degenerate (zero-sized or unreadable). */
function unusableAnalysis(): ScanAnalysis {
  const signals: SignalBreakdown[] = SIGNAL_ORDER.map((key) => ({
    key,
    label: LABELS[key],
    value: 0,
    weight: WEIGHTS[key],
    hint: 'No usable pixels were captured for this signal.',
  }))

  return {
    id: makeId(),
    createdAt: Date.now(),
    imageDataUrl: '',
    brightness: 0,
    riskScore: 50,
    riskLevel: 'Moderate Risk',
    tooDark: true,
    confidence: 0,
    signals,
    hbRange: { low: 9.5, high: 14.5 },
    quality: { light: 0, focus: 0, framing: 0 },
  }
}

/* ------------------------------------------------------------------------- */
/* Sharpness                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Mean absolute Laplacian over a small contiguous centre patch, expressed
 * relative to patch brightness so a dim-but-sharp frame is not punished twice.
 * A full-resolution convolution is unnecessary; a 72x72 window is plenty to
 * separate "in focus" from "smeared".
 */
function measureSharpness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { relative: number; meanLum: number } {
  const patch = Math.max(5, Math.min(FOCUS_PATCH, width, height))
  const x0 = Math.floor((width - patch) / 2)
  const y0 = Math.floor((height - patch) / 2)

  const buffer = new Float32Array(patch * patch)
  let lumSum = 0
  for (let y = 0; y < patch; y += 1) {
    for (let x = 0; x < patch; x += 1) {
      const index = ((y0 + y) * width + (x0 + x)) * 4
      const value = luma(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255)
      buffer[y * patch + x] = value
      lumSum += value
    }
  }

  const meanLum = lumSum / (patch * patch)

  let lapSum = 0
  let lapCount = 0
  for (let y = 1; y < patch - 1; y += 1) {
    for (let x = 1; x < patch - 1; x += 1) {
      const i = y * patch + x
      const lap =
        4 * buffer[i] -
        buffer[i - 1] -
        buffer[i + 1] -
        buffer[i - patch] -
        buffer[i + patch]
      lapSum += Math.abs(lap)
      lapCount += 1
    }
  }

  const lapMean = lapCount ? lapSum / lapCount : 0
  return { relative: lapMean / Math.max(0.12, meanLum), meanLum }
}

/* ------------------------------------------------------------------------- */
/* Main entry point                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Analyse a captured frame. Pure, synchronous, and deterministic: identical
 * pixels always yield an identical score, level, confidence and breakdown.
 * Only `id` and `createdAt` vary between calls.
 */
export function analyzeImageData(imageData: ImageData): ScanAnalysis {
  const { width, height, data } = imageData
  if (!width || !height || data.length < 64) return unusableAnalysis()

  const gw = Math.max(8, Math.min(GRID, width))
  const gh = Math.max(8, Math.min(GRID, height))

  // Luminance grid, kept so neighbouring samples can be differenced afterwards.
  const lumGrid = new Float32Array(gw * gh)
  const inRoi = new Uint8Array(gw * gh)

  // Whole-frame accumulators (brightness keeps its original full-frame meaning).
  let frameR = 0
  let frameG = 0
  let frameB = 0
  let frameCount = 0

  // Region-of-interest accumulators.
  let roiR = 0
  let roiG = 0
  let roiB = 0
  let roiLum = 0
  let roiSat = 0
  let roiChroma = 0
  let roiValue = 0
  let roiCount = 0
  let shadowClipped = 0
  let highlightClipped = 0
  let tissueLike = 0
  let innerLum = 0
  let innerCount = 0
  let outerLum = 0
  let outerCount = 0

  const roiX1 = ROI.x + ROI.w
  const roiY1 = ROI.y + ROI.h
  const innerX0 = ROI.x + ROI.w * 0.25
  const innerX1 = roiX1 - ROI.w * 0.25
  const innerY0 = ROI.y + ROI.h * 0.25
  const innerY1 = roiY1 - ROI.h * 0.25

  for (let gy = 0; gy < gh; gy += 1) {
    const v = (gy + 0.5) / gh
    const py = Math.min(height - 1, Math.floor(v * height))

    for (let gx = 0; gx < gw; gx += 1) {
      const u = (gx + 0.5) / gw
      const px = Math.min(width - 1, Math.floor(u * width))
      const index = (py * width + px) * 4

      const r = data[index] / 255
      const g = data[index + 1] / 255
      const b = data[index + 2] / 255

      frameR += r
      frameG += g
      frameB += b
      frameCount += 1

      const lum = luma(r, g, b)
      const cell = gy * gw + gx
      lumGrid[cell] = lum

      const isRoi = u >= ROI.x && u <= roiX1 && v >= ROI.y && v <= roiY1
      if (!isRoi) continue
      inRoi[cell] = 1

      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const chroma = max - min
      const saturation = max > 0 ? chroma / max : 0

      roiR += r
      roiG += g
      roiB += b
      roiLum += lum
      roiSat += saturation
      roiChroma += chroma
      roiValue += max
      roiCount += 1

      if (lum <= 0.045) shadowClipped += 1
      if (lum >= 0.965) highlightClipped += 1
      if (r > g && r >= b && lum > 0.07 && lum < 0.97) tissueLike += 1

      const isInner = u >= innerX0 && u <= innerX1 && v >= innerY0 && v <= innerY1
      if (isInner) {
        innerLum += lum
        innerCount += 1
      } else {
        outerLum += lum
        outerCount += 1
      }
    }
  }

  if (!roiCount || !frameCount) return unusableAnalysis()

  /* --- Local contrast (vascular detail) over the ROI grid ----------------- */
  let gradSum = 0
  let gradCount = 0
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const cell = gy * gw + gx
      if (!inRoi[cell]) continue
      if (gx + 1 < gw && inRoi[cell + 1]) {
        gradSum += Math.abs(lumGrid[cell] - lumGrid[cell + 1])
        gradCount += 1
      }
      if (gy + 1 < gh && inRoi[cell + gw]) {
        gradSum += Math.abs(lumGrid[cell] - lumGrid[cell + gw])
        gradCount += 1
      }
    }
  }
  const gradMean = gradCount ? gradSum / gradCount : 0

  /* --- Means ------------------------------------------------------------- */
  const meanR = roiR / roiCount
  const meanG = roiG / roiCount
  const meanB = roiB / roiCount
  const meanLum = roiLum / roiCount
  const meanSat = roiSat / roiCount
  const meanChroma = roiChroma / roiCount
  const meanValue = roiValue / roiCount
  const clipFraction = clamp((shadowClipped + highlightClipped) / roiCount, 0, 1)

  const brightness = clamp(((frameR + frameG + frameB) / (frameCount * 3)) * 255, 0, 255)
  const tooDark = brightness < DARK_THRESHOLD

  /* --- Signal 1: redness (red-channel dominance) -------------------------- */
  const rednessRatio = meanR / (meanG + meanB + 1e-6)
  const redness = norm01(rednessRatio, 0.5, 0.92) * 100

  /* --- Signal 2: saturation (mean HSV saturation) ------------------------- */
  const saturation = norm01(meanSat, 0.06, 0.55) * 100

  /* --- Signal 3: pallor (washed out / low chroma / little red excess) ----- */
  // Chroma and red-excess are measured RELATIVE to the sample's own brightness.
  // Absolute versions would read any dim photo as pale, which is exactly the
  // artefact we must not confuse with real conjunctival pallor.
  const exposureFloor = Math.max(0.15, meanValue)
  const relativeChroma = meanChroma / exposureFloor
  const relativeRedExcess = (meanR - (meanG + meanB) / 2) / exposureFloor
  const chromaTerm = 1 - norm01(relativeChroma, 0.06, 0.45)
  const washoutTerm = norm01(meanValue, 0.35, 0.98) * (1 - norm01(meanSat, 0.05, 0.5))
  const hueTerm = 1 - norm01(relativeRedExcess, 0, 0.35)
  const pallor = clamp(0.42 * chromaTerm + 0.28 * washoutTerm + 0.3 * hueTerm, 0, 1) * 100

  /* --- Signal 4: texture (local luminance gradient, brightness-relative) -- */
  const gradRelative = gradMean / Math.max(0.12, meanLum)
  const texture = norm01(gradRelative, 0.012, 0.13) * 100

  /* --- Signal 5: illumination (exposure quality, both tails penalised) ---- */
  const exposureDeviation = Math.abs(meanLum - 0.55) / 0.45
  const exposureScore = 1 - Math.pow(clamp(exposureDeviation, 0, 1), 1.15)
  const illumination = clamp(exposureScore * (1 - 0.75 * clipFraction), 0, 1) * 100

  const values: Record<SignalKey, number> = {
    pallor,
    redness,
    saturation,
    texture,
    illumination,
  }

  /* --- Capture quality ---------------------------------------------------- */
  const sharpness = measureSharpness(data, width, height)
  // In a near-black patch the only "detail" is sensor noise, so fade the
  // sharpness reading out as the patch approaches black.
  const sharpnessTrust = norm01(sharpness.meanLum, 0.05, 0.22)
  const focusScore = Math.pow(norm01(sharpness.relative, 0.01, 0.12), 0.75) * sharpnessTrust * 100

  const tissueFraction = tissueLike / roiCount
  const innerMean = innerCount ? innerLum / innerCount : meanLum
  const outerMean = outerCount ? outerLum / outerCount : meanLum
  const vignetteBalance = 1 - norm01(Math.abs(innerMean - outerMean), 0.02, 0.45)
  const framingScore = clamp(0.6 * tissueFraction + 0.4 * vignetteBalance, 0, 1) * 100

  const quality = {
    light: Math.round(clamp(illumination, 0, 100)),
    focus: Math.round(clamp(focusScore, 0, 100)),
    framing: Math.round(clamp(framingScore, 0, 100)),
  }

  /* --- Confidence: how much this capture lets us claim -------------------- */
  const confidenceBase =
    0.34 * quality.light + 0.3 * quality.focus + 0.22 * quality.framing + 0.14 * texture
  const confidenceRaw = (confidenceBase - clipFraction * 22) * (tooDark ? 0.45 : 1)
  const confidence = Math.round(clamp(confidenceRaw, 4, 96))

  /* --- Blended risk score ------------------------------------------------- */
  // Polarity: pallor rises with concern; the other four fall with concern.
  const riskContribution: Record<SignalKey, number> = {
    pallor: values.pallor,
    redness: 100 - values.redness,
    saturation: 100 - values.saturation,
    texture: 100 - values.texture,
    illumination: 100 - values.illumination,
  }

  let blended = 0
  for (const key of SIGNAL_ORDER) blended += WEIGHTS[key] * riskContribution[key]

  // Gentle expansion around the midpoint: the weighted mean of five bounded
  // signals clusters, and a screening tool that only ever says "about 50" is
  // useless. This is a presentation curve, not extra information.
  const expanded = 50 + (blended - 50) * 1.15
  const riskScore = Math.round(clamp(expanded, 3, 97))
  const riskLevel = riskLevelFromScore(riskScore)

  const signals: SignalBreakdown[] = SIGNAL_ORDER.map((key) => {
    const value = Math.round(clamp(values[key], 0, 100))
    return { key, label: LABELS[key], value, weight: WEIGHTS[key], hint: hintFor(key, value) }
  })

  return {
    id: makeId(),
    createdAt: Date.now(),
    imageDataUrl: '',
    brightness,
    riskScore,
    riskLevel,
    tooDark,
    confidence,
    signals,
    hbRange: hbRangeFor(riskScore, confidence),
    quality,
  }
}
