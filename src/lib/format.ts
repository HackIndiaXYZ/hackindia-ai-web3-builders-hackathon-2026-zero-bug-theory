/**
 * Tiny, dependency-free formatting helpers.
 *
 * Dates are formatted manually (rather than via toLocaleDateString) so the
 * output is stable across locales, test environments and server renders.
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
