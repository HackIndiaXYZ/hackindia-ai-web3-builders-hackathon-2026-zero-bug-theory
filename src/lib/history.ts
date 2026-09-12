import type {
  Decision,
  GateReport,
  ModelOutput,
  QualityReport,
  RoiReport,
  ScanAnalysis,
} from '@/src/lib/types'
import { clamp } from '@/src/lib/format'
import { riskLevelForDecision } from '@/src/lib/risk-style'

/**
 * Local scan history.
 *
 * Everything lives in localStorage under a single versioned key. Photos are the
 * expensive part, so only the newest few entries keep their `imageDataUrl`;
 * older entries keep their numbers and drop the pixels, which keeps the whole
 * store comfortably inside the ~5MB quota.
 *
 * The scan itself is NOT local — the frame is uploaded to the screening service
 * and every medical number here came back from it. What is local is this index
 * of past results: it never leaves the browser, and clearing it clears it only
 * here, not on the server.
 *
 * WHAT THIS FILE HAS TO GET RIGHT
 * -------------------------------
 * A stored scan is the only copy of its provenance the user will ever see. The
 * previous revive step rebuilt entries from a fixed whitelist of heuristic
 * fields and silently dropped everything else — the commitment, the scan-id
 * hash, the model hash, the chain transaction and its status, the explorer
 * link, the synthetic-result flag and the demo notice. So a scan looked fully
 * attested when it was created and, after one reload, looked like a bare number
 * with no way to check it against the chain. Reopening a stored scan must show
 * exactly the provenance it had when it was produced, so every field of
 * ScanAnalysis is persisted and revived, and anything that fails validation is
 * dropped as a field rather than quietly replaced with a plausible-looking one.
 *
 * Every storage touch is wrapped: a missing, corrupt, or unreadable value always
 * degrades to an empty history rather than throwing into a render.
 */

const STORAGE_KEY = 'anemiascan.history.v1'

/** Hard cap on retained scans. */
const MAX_ENTRIES = 30

/** How many of the newest entries keep their captured photo. */
const MAX_IMAGES = 8

const DECISIONS: Decision[] = ['lower_risk', 'higher_risk', 'uncertain']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** A non-empty string, or undefined — never a placeholder. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** A string, or an explicit null (the shape the API uses for "no value yet"). */
function strOrNull(value: unknown): string | null | undefined {
  if (value === null) return null
  return str(value)
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function numArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  )
}

/** A `Record<string, number>` with every non-finite entry removed. */
function numRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry
  }
  return out
}

function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && DECISIONS.includes(value as Decision)
}

/* -- per-report revivers ---------------------------------------------------
   Each returns undefined when the stored report is absent or unusable. An
   absent report stays absent; it is never invented, because a fabricated
   "accepted, brightness 0" block would read on screen as a measurement. */

function reviveQuality(value: unknown): QualityReport | undefined {
  if (!isRecord(value)) return undefined
  return {
    accepted: value.accepted === true,
    brightness: num(value.brightness, 0),
    blurVariance: typeof value.blurVariance === 'number' ? value.blurVariance : null,
    clippedFraction: typeof value.clippedFraction === 'number' ? value.clippedFraction : null,
    failures: strArray(value.failures),
  }
}

function reviveRoi(value: unknown): RoiReport | undefined {
  if (!isRecord(value)) return undefined
  return {
    located: value.located === true,
    coverage: clamp(num(value.coverage, 0), 0, 1),
    maskedFraction: clamp(num(value.maskedFraction, 0), 0, 1),
    meanRednessOverYellow: num(value.meanRednessOverYellow, 0),
    method: typeof value.method === 'string' ? value.method : '',
    bbox: Array.isArray(value.bbox) ? numArray(value.bbox) : null,
    sourceSize: numArray(value.sourceSize),
    roiSize: numArray(value.roiSize),
    failures: strArray(value.failures),
  }
}

function reviveGate(value: unknown): GateReport | undefined {
  if (!isRecord(value)) return undefined
  const worst = Array.isArray(value.worstFeatures) ? value.worstFeatures : []
  return {
    accepted: value.accepted === true,
    failures: strArray(value.failures),
    distributionBudget: num(value.distributionBudget, 0),
    distributionBudgetLimit: num(value.distributionBudgetLimit, 0),
    rmsZ: num(value.rmsZ, 0),
    maxAbsZ: num(value.maxAbsZ, 0),
    worstFeatures: worst
      .filter(isRecord)
      .filter((entry) => typeof entry.feature === 'string' && typeof entry.z === 'number')
      .map((entry) => ({ feature: entry.feature as string, z: entry.z as number })),
    chromaZ: numRecord(value.chromaZ),
    texture: numRecord(value.texture),
    logitZ: numRecord(value.logitZ),
  }
}

/**
 * Rebuild the model output.
 *
 * `decision` and `probability` are the already-validated top-level values, used
 * only to fill a stored block that is missing or corrupt — the two must agree,
 * and the top-level copy is the one the rest of the app renders. Everything
 * else falls back to a neutral empty value rather than to the current model's
 * constants: printing today's operating threshold beside a scan that was run
 * against a different one would be a fabricated provenance record.
 */
function reviveModelOutput(value: unknown, decision: Decision, probability: number): ModelOutput {
  const stored = isRecord(value) ? value : {}
  return {
    decision: isDecision(stored.decision) ? stored.decision : decision,
    riskCategory: typeof stored.riskCategory === 'string' ? stored.riskCategory : '',
    screeningProbability: clamp(num(stored.screeningProbability, probability), 0, 1),
    probabilityBps: clamp(Math.round(num(stored.probabilityBps, probability * 10000)), 0, 10000),
    selectedModel: typeof stored.selectedModel === 'string' ? stored.selectedModel : '',
    operatingThreshold: clamp(num(stored.operatingThreshold, 0), 0, 1),
    uncertaintyMargin: clamp(num(stored.uncertaintyMargin, 0), 0, 1),
    candidateProbabilities: numRecord(stored.candidateProbabilities),
    candidateThresholds: numRecord(stored.candidateThresholds),
    modelDisagreement: stored.modelDisagreement === true,
    nearThreshold: stored.nearThreshold === true,
    fusionGateWeights: numRecord(stored.fusionGateWeights),
    modelVersion: typeof stored.modelVersion === 'string' ? stored.modelVersion : '',
  }
}

/**
 * Rebuild a stored record into a well-formed ScanAnalysis.
 *
 * Returns null when the record is too broken to be meaningful — no timestamp,
 * or no decision we recognise. A scan without a decision cannot be repaired:
 * deriving one from the probability would mean re-making a medical call in the
 * browser, which is exactly what this app no longer does.
 */
function reviveScan(value: unknown): ScanAnalysis | null {
  if (!isRecord(value)) return null

  const createdAt = num(value.createdAt, 0)
  if (createdAt <= 0) return null

  const storedModel = isRecord(value.modelOutput) ? value.modelOutput : null
  const decision = isDecision(value.decision)
    ? value.decision
    : storedModel && isDecision(storedModel.decision)
      ? storedModel.decision
      : null
  if (!decision) return null

  const probabilityBps = num(value.probabilityBps, NaN)
  const screeningProbability = clamp(
    num(
      value.screeningProbability,
      Number.isFinite(probabilityBps)
        ? probabilityBps / 10000
        : num(storedModel?.screeningProbability, 0),
    ),
    0,
    1,
  )

  const qualityBps = num(value.qualityBps, NaN)
  const captureQuality = clamp(
    Math.round(num(value.captureQuality, Number.isFinite(qualityBps) ? qualityBps / 100 : 0)),
    0,
    100,
  )

  const scan: ScanAnalysis = {
    id: typeof value.id === 'string' && value.id ? value.id : `scan-${createdAt.toString(36)}`,
    createdAt,
    imageDataUrl: typeof value.imageDataUrl === 'string' ? value.imageDataUrl : '',
    decision,
    riskLevel: riskLevelForDecision(decision),
    screeningProbability,
    captureQuality,
    modelOutput: reviveModelOutput(value.modelOutput, decision, screeningProbability),
    isSynthetic: value.isSynthetic === true,
  }

  /* Optional blocks and provenance are attached only when they were actually
     stored, so a scan with no chain anchor renders as "not anchored" instead of
     as an anchor whose fields happen to be empty strings. */
  const quality = reviveQuality(value.quality)
  if (quality) scan.quality = quality
  const roi = reviveRoi(value.roi)
  if (roi) scan.roi = roi
  const gate = reviveGate(value.gate)
  if (gate) scan.gate = gate

  const demoNotice = str(value.demoNotice)
  if (demoNotice) scan.demoNotice = demoNotice
  if (Number.isFinite(probabilityBps)) {
    scan.probabilityBps = clamp(Math.round(probabilityBps), 0, 10000)
  }
  if (Number.isFinite(qualityBps)) scan.qualityBps = clamp(Math.round(qualityBps), 0, 10000)

  const commitment = str(value.commitment)
  if (commitment) scan.commitment = commitment
  const scanIdHash = str(value.scanIdHash)
  if (scanIdHash) scan.scanIdHash = scanIdHash
  const modelHash = str(value.modelHash)
  if (modelHash) scan.modelHash = modelHash
  if (typeof value.registeredOnChain === 'boolean') {
    scan.registeredOnChain = value.registeredOnChain
  }
  const chainTxHash = strOrNull(value.chainTxHash)
  if (chainTxHash !== undefined) scan.chainTxHash = chainTxHash
  const chainTxStatus = strOrNull(value.chainTxStatus)
  if (chainTxStatus !== undefined) scan.chainTxStatus = chainTxStatus
  const explorerUrl = strOrNull(value.explorerUrl)
  if (explorerUrl !== undefined) scan.explorerUrl = explorerUrl

  return scan
}

/** Sort newest-first, de-duplicate by id, cap the length, prune old photos. */
function normalise(items: ScanAnalysis[]): ScanAnalysis[] {
  const seen = new Set<string>()
  const sorted = [...items]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .slice(0, MAX_ENTRIES)

  return sorted.map((item, index) =>
    index < MAX_IMAGES || !item.imageDataUrl ? item : { ...item, imageDataUrl: '' },
  )
}

function readStore(): ScanAnalysis[] {
  if (typeof localStorage === 'undefined') return []
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const revived: ScanAnalysis[] = []
    for (const entry of parsed) {
      const scan = reviveScan(entry)
      if (scan) revived.push(scan)
    }
    return normalise(revived)
  } catch {
    return []
  }
}

/**
 * Persist, retrying with progressively fewer photos if the quota rejects the
 * write.
 *
 * Only the PHOTO is ever dropped to make room — never a provenance field. A
 * pixel-less entry is still a complete, checkable record; an entry stripped of
 * its commitment is not. So the ladder below only blanks `imageDataUrl` or
 * drops whole entries from the tail.
 *
 * Returns the payload that was ACTUALLY written, which may be a degraded
 * version of `items` (fewer thumbnails, or fewer entries). Callers hand that
 * back to the UI so the in-memory list can never promise history that has
 * already been dropped from disk — otherwise a quota failure would show 30
 * thumbnailed scans until the next reload silently revealed 10 image-less ones.
 *
 * Returns `null` when nothing could be written at all (no storage, or every
 * attempt rejected); the caller then keeps the session list as-is.
 */
function writeStore(items: ScanAnalysis[]): ScanAnalysis[] | null {
  if (typeof localStorage === 'undefined') return null

  const attempts: ScanAnalysis[][] = [
    items,
    items.map((item, index) => (index < 3 ? item : { ...item, imageDataUrl: '' })),
    items.map((item) => ({ ...item, imageDataUrl: '' })),
    items.slice(0, 10).map((item) => ({ ...item, imageDataUrl: '' })),
  ]

  for (const attempt of attempts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(attempt))
      return attempt
    } catch {
      /* try a smaller payload */
    }
  }
  return null
}

/** Newest-first history. Never throws. */
export function loadHistory(): ScanAnalysis[] {
  return readStore()
}

/**
 * Persist a scan (replacing any entry with the same id) and return the new list.
 * The returned list is what reached storage, so a quota-degraded write is
 * reflected on screen immediately rather than after the next reload.
 */
export function saveScan(scan: ScanAnalysis): ScanAnalysis[] {
  const existing = readStore().filter((item) => item.id !== scan.id)
  const next = normalise([scan, ...existing])
  return writeStore(next) ?? next
}

/** Remove one scan by id and return the new list (as persisted). */
export function deleteScan(id: string): ScanAnalysis[] {
  const next = normalise(readStore().filter((item) => item.id !== id))
  return writeStore(next) ?? next
}

/** Drop every stored scan. */
export function clearHistory(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to do — the caller resets its own in-memory list */
  }
}

/* There is deliberately no history-summary helper here any more.
 *
 * The old `historyStats()` averaged `riskScore` and reported a "best risk
 * band", both of which came from the deleted local heuristic. The home and
 * history screens now derive their own summaries from `screeningProbability`
 * directly (see the comments in those files), so a second implementation in
 * this module would only give the two of them a way to drift apart — and
 * averaging categorical decisions, one of which is `uncertain`, would invent a
 * figure the model never produced. Storage is all this module owns. */
