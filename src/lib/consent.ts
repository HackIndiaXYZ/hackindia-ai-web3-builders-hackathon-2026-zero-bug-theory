const CONSENT_STATEMENT =
  'ANEMIASCAN_DEMO_CONSENT_V1|I consent to an AI-assisted anemia screening of my conjunctiva image for research/demo purposes only, not medical diagnosis.'

export async function getConsentHash(): Promise<string> {
  const bytes = new TextEncoder().encode(CONSENT_STATEMENT)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return '0x' + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
