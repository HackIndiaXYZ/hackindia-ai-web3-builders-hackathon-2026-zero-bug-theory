import type { RiskLevel, ScanAnalysis, SignalBreakdown, SignalKey } from '@/src/lib/types'
import { clamp } from '@/src/lib/format'

/**
 * Local, offline scan history.
 *
 * Everything lives in localStorage under a single versioned key — no account, no
 * upload, no network. Photos are the expensive part, so only the newest few
 * entries keep their `imageDataUrl`; older entries keep their numbers and drop
 * the pixels, which keeps the whole store comfortably inside the ~5MB quota.
 *
 * Every storage touch is wrapped: a missing, corrupt, or unreadable value always
 * degrades to an empty history rather than throwing into a render.
 */

const STORAGE_KEY = 'anemiascan.history.v1'

/** Hard cap on retained scans. */
const MAX_ENTRIES = 30

/** How many of the newest entries keep their captured photo. */
const MAX_IMAGES = 8

const SIGNAL_KEYS: SignalKey[] = ['pallor', 'redness', 'saturation', 'texture', 'illumination']

const RISK_LEVELS: RiskLevel[] = ['Low Risk', 'Moderate Risk', 'Elevated Risk']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 65) return 'Elevated Risk'
  if (score >= 35) return 'Moderate Risk'
  return 'Low Risk'
}

/**
 * Coarse illustrative haemoglobin band, used only to repair a stored entry whose
 * own interval is missing or corrupt. Same (non-clinical) anchors the analyser
 * uses, just without the confidence-driven widening.
 */
function fallbackHbRange(level: RiskLevel): { low: number; high: number } {
  if (level === 'Elevated Risk') return { low: 7.5, high: 11 }
  if (level === 'Moderate Risk') return { low: 11, high: 13 }
  return { low: 13, high: 16 }
}

function reviveSignals(value: unknown, fallbackScore: number): SignalBreakdown[] {
  if (!Array.isArray(value)) return []
  const signals: SignalBreakdown[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const key = entry.key
    if (typeof key !== 'string' || !SIGNAL_KEYS.includes(key as SignalKey)) continue
    signals.push({
      key: key as SignalKey,
      label: typeof entry.label === 'string' && entry.label ? entry.label : key,
      value: clamp(Math.round(num(entry.value, fallbackScore)), 0, 100),
      weight: clamp(num(entry.weight, 0), 0, 1),
      hint: typeof entry.hint === 'string' ? entry.hint : '',
    })
  }
  return signals
}

/**
 * Rebuild a stored record into a well-formed ScanAnalysis, repairing anything
 * missing. Returns null only when the record is too broken to be meaningful.
 */
function reviveScan(value: unknown): ScanAnalysis | null {
  if (!isRecord(value)) return null

  const createdAt = num(value.createdAt, 0)
  if (createdAt <= 0) return null

  const riskScore = clamp(Math.round(num(value.riskScore, 50)), 0, 100)
  const storedLevel = value.riskLevel
  const riskLevel: RiskLevel =
    typeof storedLevel === 'string' && RISK_LEVELS.includes(storedLevel as RiskLevel)
      ? (storedLevel as RiskLevel)
      : levelFromScore(riskScore)

  const quality = isRecord(value.quality) ? value.quality : {}
  const storedHb = isRecord(value.hbRange) ? value.hbRange : {}
  const hbLow = clamp(num(storedHb.low, 0), 0, 25)
  const hbHigh = clamp(num(storedHb.high, 0), 0, 25)
  const hbRange =
    hbLow > 0 && hbHigh > 0
      ? { low: Math.min(hbLow, hbHigh), high: Math.max(hbLow, hbHigh) }
      : fallbackHbRange(riskLevel)

  return {
    id:
      typeof value.id === 'string' && value.id
        ? value.id
        : `scan-${createdAt.toString(36)}`,
    createdAt,
    imageDataUrl: typeof value.imageDataUrl === 'string' ? value.imageDataUrl : '',
    brightness: clamp(num(value.brightness, 0), 0, 255),
    riskScore,
    riskLevel,
    tooDark: value.tooDark === true,
    confidence: clamp(Math.round(num(value.confidence, 0)), 0, 100),
    signals: reviveSignals(value.signals, riskScore),
    hbRange,
    quality: {
      light: clamp(Math.round(num(quality.light, 0)), 0, 100),
      focus: clamp(Math.round(num(quality.focus, 0)), 0, 100),
      framing: clamp(Math.round(num(quality.framing, 0)), 0, 100),
    },
  }
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

export interface HistoryStats {
  /** Number of retained scans. */
  count: number
  /** Mean risk score across all retained scans, 0 when empty. */
  average: number
  /** Most recent risk score, or null when there is no history. */
  latest: number | null
  /** Latest score minus the mean of everything before it. 0 with nothing to compare. */
  trend: number
  /** Lowest risk band ever recorded, or null when there is no history. */
  bestLevel: RiskLevel | null
}

/**
 * Derive summary stats from a newest-first list.
 * `trend` is signed: negative means the latest scan improved on the baseline.
 */
export function historyStats(items: ScanAnalysis[]): HistoryStats {
  if (!items.length) {
    return { count: 0, average: 0, latest: null, trend: 0, bestLevel: null }
  }

  const scores = items.map((item) => item.riskScore)
  const total = scores.reduce((sum, score) => sum + score, 0)
  const average = Math.round(total / scores.length)
  const latest = scores[0]

  const previous = scores.slice(1)
  const trend = previous.length
    ? Math.round(latest - previous.reduce((sum, score) => sum + score, 0) / previous.length)
    : 0

  let best = items[0]
  for (const item of items) {
    if (item.riskScore < best.riskScore) best = item
  }

  return { count: items.length, average, latest, trend, bestLevel: best.riskLevel }
}
