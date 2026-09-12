import type { RiskLevel } from '@/src/lib/types'

/**
 * Presentation layer for a risk band: colour token, copy, and ready-made
 * Tailwind class strings.
 *
 * All class strings below are written as complete literals so the Tailwind v4
 * scanner can see them — never build these by interpolating a token.
 */

export type RiskToken = 'risk' | 'moderate' | 'safe'

export function riskColorToken(level: RiskLevel): RiskToken {
  if (level === 'Elevated Risk') return 'risk'
  if (level === 'Moderate Risk') return 'moderate'
  return 'safe'
}

/**
 * Two-to-four word headline for the result screen.
 *
 * The Low band deliberately does NOT read as an all-clear: mild anaemia
 * commonly produces no visible conjunctival pallor at all, which faq.tsx and
 * learn-screen.tsx both say outright. The headline names what the capture did
 * and did not show, not a state of health.
 */
export function riskHeadline(level: RiskLevel): string {
  if (level === 'Elevated Risk') return 'Worth Getting Checked'
  if (level === 'Moderate Risk') return 'Some Signals Stand Out'
  return 'No Pallor Signal Today'
}

/**
 * One-paragraph, non-diagnostic explanation of the band.
 *
 * These never say "reference range" or "the usual range". That is laboratory
 * vocabulary, and there is no such range here: analyze.ts normalises against
 * hand-picked windows that have never been compared against a blood result. The
 * copy therefore talks about what THIS SCREEN treats as unremarkable, which is
 * the only claim the heuristic can actually support.
 */
export function riskExplanation(level: RiskLevel): string {
  if (level === 'Elevated Risk') {
    return 'The conjunctiva in your photo looks paler and less vascular than the range this screen treats as unremarkable, a pattern often seen alongside lower haemoglobin. This is a screening signal only — a blood test is the only way to know your haemoglobin.'
  }
  if (level === 'Moderate Risk') {
    return 'Most signals looked ordinary, but colour saturation and vascular detail sat below the range this screen treats as unremarkable. That can come from mild anaemia, but also from lighting, camera white balance or a slightly off-centre capture.'
  }
  return 'Colour, saturation and vascular texture in this capture all sit in the range this screen treats as unremarkable. That is not a clean bill of health — mild anaemia often shows no visible pallor at all, so symptoms still matter more than this score.'
}

/** Three to four concrete, safe next steps. */
export function riskAdvice(level: RiskLevel): string[] {
  if (level === 'Elevated Risk') {
    return [
      'Book a haemoglobin (CBC) blood test — it is inexpensive, fast and definitive.',
      'Note any tiredness, breathlessness, dizziness, cold hands or heavy periods to mention to your clinician.',
      'Do not start iron supplements on your own; the wrong dose can cause harm and can mask the real cause.',
      'Seek care promptly if you have chest pain, fainting, a racing heart or visible blood loss.',
    ]
  }
  if (level === 'Moderate Risk') {
    return [
      'Re-scan in bright, indirect daylight to rule out a lighting artefact.',
      'Keep iron-rich food in your week: lentils, beans, leafy greens, eggs, red meat or fortified cereal.',
      'Pair those with vitamin C (citrus, tomato, capsicum) and keep tea or coffee away from meals.',
      'If you feel unusually tired or breathless, ask a clinician for a haemoglobin test rather than waiting.',
    ]
  }
  return [
    'Keep a baseline: re-scan every few weeks so you can see a change rather than a single snapshot.',
    'Maintain iron-rich meals with a vitamin C source to keep absorption high.',
    'Trust symptoms over any screening result — fatigue, breathlessness or dizziness still deserve a real test.',
  ]
}

/**
 * Ready-to-use Tailwind classes for a token.
 * - `text` / `bg` / `border` / `ring` are tinted surface + accent classes.
 * - `fill` is the full-opacity accent, for meter fills and solid chips.
 */
export function riskClasses(token: RiskToken): {
  text: string
  bg: string
  border: string
  ring: string
  fill: string
} {
  if (token === 'risk') {
    return {
      text: 'text-risk',
      bg: 'bg-risk/10',
      border: 'border-risk/30',
      ring: 'ring-risk/30',
      fill: 'bg-risk',
    }
  }
  if (token === 'moderate') {
    return {
      text: 'text-moderate',
      bg: 'bg-moderate/10',
      border: 'border-moderate/30',
      ring: 'ring-moderate/30',
      fill: 'bg-moderate',
    }
  }
  return {
    text: 'text-safe',
    bg: 'bg-safe/10',
    border: 'border-safe/30',
    ring: 'ring-safe/30',
    fill: 'bg-safe',
  }
}
