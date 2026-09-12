/**
 * Tiny, dependency-free formatting helpers.
 *
 * Dates are formatted manually (rather than via toLocaleDateString) so the
 * output is stable across locales, test environments and server renders.
 *
 * The number helpers exist because the headline figure on the result screen is
 * a CALIBRATED PROBABILITY in 0..1, not a score out of 100. Printing it needs
 * care: `0.25` and `25%` are the same number but they read very differently
 * next to a threshold of `0.208`, so both forms are produced here rather than
 * being improvised per call site.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Clamp `n` into [min, max]. Non-finite input collapses to `min`. */
export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  if (min > max) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

function isValidStamp(epochMs: number): boolean {
  return Number.isFinite(epochMs) && epochMs > 0
}

/** Whole-calendar-days between two timestamps, ignoring the time of day. */
function calendarDayDiff(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  const aMid = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const bMid = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((bMid - aMid) / DAY)
}

function dayAndMonth(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/**
 * Human relative time: 'Just now', '45s ago', '12 min ago', '5 hr ago',
 * 'Yesterday', '12 Mar', '12 Mar 2024'.
 */
export function formatRelativeTime(epochMs: number): string {
  if (!isValidStamp(epochMs)) return '—'

  const now = Date.now()
  const diff = now - epochMs

  // Clock skew or a future timestamp: treat as the present rather than
  // rendering nonsense like "-3 min ago".
  if (diff < 10 * SECOND) return 'Just now'
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}s ago`
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE)
    return `${minutes} min ago`
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR)
    return `${hours} hr ago`
  }

  const date = new Date(epochMs)
  const days = calendarDayDiff(epochMs, now)
  if (days <= 1) return 'Yesterday'
  if (date.getFullYear() === new Date(now).getFullYear()) return dayAndMonth(date)
  return `${dayAndMonth(date)} ${date.getFullYear()}`
}

/** Absolute timestamp, e.g. '12 Mar 2026, 14:32'. */
export function formatDateTime(epochMs: number): string {
  if (!isValidStamp(epochMs)) return '—'
  const date = new Date(epochMs)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${dayAndMonth(date)} ${date.getFullYear()}, ${hours}:${minutes}`
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

/** Fixed-point, with a dash for anything that is not a real number. */
export function formatFixed(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

/**
 * A calibrated probability, printed as a probability.
 *
 * Three decimals is not decoration: the operating threshold is 0.2076 and the
 * uncertainty margin is 0.0405, so two decimals would round a reading and its
 * decision boundary onto the same number and hide exactly the comparison this
 * screen is trying to show.
 */
export function formatProbability(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '—'
  return clamp(value, 0, 1).toFixed(digits)
}

/** The same probability expressed as a percentage, for the secondary reading. */
export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${(clamp(value, 0, 1) * 100).toFixed(digits)}%`
}

/** Basis points (the wire format for probability and quality) as 0..100. */
export function bpsToScore(bps: number): number {
  if (!Number.isFinite(bps)) return 0
  return Math.round(clamp(bps / 100, 0, 100))
}

/**
 * Middle-truncate a 0x hash for display.
 *
 * Provenance values (the commitment, the scan-id hash, the model hash) are all
 * 32-byte hex, which is far too long to print inline but must stay verifiable —
 * so the head and tail are kept verbatim and the caller is expected to offer
 * the full string for copying alongside it.
 */
export function shortHash(hash: string | null | undefined, lead = 10, tail = 8): string {
  if (!hash) return '—'
  if (hash.length <= lead + tail + 1) return hash
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`
}

/**
 * Turn a snake_case identifier from the inference contract into something
 * readable, e.g. 'logistic_stacker' -> 'Logistic stacker'. Used for candidate
 * model names and fusion branch names, which arrive as raw keys.
 */
export function humaniseKey(key: string): string {
  if (!key) return '—'
  const words = key.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
