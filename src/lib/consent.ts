/**
 * The consent hash sent with every screening.
 *
 * The backend stores this hash beside the scan and folds it into the on-chain
 * commitment, so it is meant to be evidence that a specific person acknowledged
 * a specific statement before a specific scan was run.
 *
 * It used to be sha256 of a hard-coded sentence. That made it byte-identical
 * for every user, every browser and every scan ever submitted, so it attested
 * to nothing at all: you could compute it without ever having seen the notice.
 *
 * It is now bound to the acknowledgement this browser actually made. The hash
 * covers the statement text, a random id minted when the notice was accepted,
 * and the moment it was accepted — so two people, or the same person before and
 * after clearing the notice, produce different hashes, and the hash cannot be
 * derived from the statement alone.
 *
 * What this is NOT: a signature. Nothing here proves identity — the id lives in
 * the same browser storage the user controls, and anyone can mint one. It is a
 * per-acknowledgement reference, not a cryptographic attestation of consent.
 */

/** Versioned so a change to the statement invalidates old hashes loudly. */
const CONSENT_STATEMENT =
  'ANEMIASCAN_DEMO_CONSENT_V1|I consent to an AI-assisted anemia screening of my conjunctiva image for research/demo purposes only, not medical diagnosis.'

/** Where the binding (id + timestamp) lives. Separate from the consent-gate's
 *  own 'accepted' flag, which stores no timestamp we could bind to. */
const BINDING_KEY = 'anemiascan.consent-binding.v1'

interface ConsentBinding {
  /** Random per-browser id, minted once when the notice was acknowledged. */
  id: string
  /** Epoch milliseconds the acknowledgement was recorded. */
  acknowledgedAt: number
}

/**
 * Used when storage is unavailable (private mode, a blocked origin, a full
 * quota). The binding then lasts for the page session only — which is the safe
 * direction to fail in: a scan still carries a hash unique to this session
 * rather than silently falling back to the old shared constant.
 */
let sessionBinding: ConsentBinding | null = null

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    /* fall through */
  }
  // Last resort. Weaker, but still per-browser rather than per-build.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function isBinding(value: unknown): value is ConsentBinding {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.acknowledgedAt === 'number' &&
    Number.isFinite(record.acknowledgedAt) &&
    record.acknowledgedAt > 0
  )
}

function readBinding(): ConsentBinding | null {
  if (typeof localStorage === 'undefined') return sessionBinding
  try {
    const raw = localStorage.getItem(BINDING_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isBinding(parsed) ? parsed : null
  } catch {
    return sessionBinding
  }
}

function writeBinding(binding: ConsentBinding): void {
  sessionBinding = binding
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(BINDING_KEY, JSON.stringify(binding))
  } catch {
    /* keep the session-only binding — see sessionBinding above */
  }
}

/**
 * Record that this browser acknowledged the screening notice, now.
 *
 * Idempotent: an existing binding is kept, so the timestamp stays the moment of
 * the FIRST acknowledgement rather than drifting forward on every visit. Call
 * it from the consent gate when the box is ticked; `getConsentHash` also calls
 * it lazily, so a browser that acknowledged before this code existed still gets
 * a binding on its next scan instead of failing to produce a hash.
 */
export function recordConsentAcknowledgement(): ConsentBinding {
  const existing = readBinding()
  if (existing) return existing
  const binding: ConsentBinding = { id: randomId(), acknowledgedAt: Date.now() }
  writeBinding(binding)
  return binding
}

/** When this browser acknowledged the notice, or null if it never has. */
export function consentAcknowledgedAt(): number | null {
  return readBinding()?.acknowledgedAt ?? null
}

/**
 * The 0x-prefixed 32-byte sha256 the backend requires (^0x[0-9a-fA-F]{64}$).
 *
 * Stable for a given browser: the same acknowledgement always hashes to the
 * same value, so every scan from one person is traceable to one consent record
 * rather than to a fresh unverifiable number each time.
 */
export async function getConsentHash(): Promise<string> {
  const binding = recordConsentAcknowledgement()
  const payload = `${CONSENT_STATEMENT}|id=${binding.id}|acknowledged_at=${binding.acknowledgedAt}`
  const bytes = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return (
    '0x' +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )
}
