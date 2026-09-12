/* --------------------------------------------------------------------------
 * AppLogo — the AnemiaScan mark.
 * --------------------------------------------------------------------------
 * Drawn to survive being shrunk: the silhouette is one almond eye, one solid
 * iris and one scanning beam, so at 20px it still reads as "eye + scan" rather
 * than as grey mush. Every colour is a design token, so the mark re-tints
 * itself in light and dark without a second asset.
 *
 * The gradient ids are salted with `useId()` — two logos on one page (header +
 * install prompt, for example) would otherwise share one `<defs>` id and the
 * second instance would silently inherit the first one's gradient.
 * -------------------------------------------------------------------------- */

import { useId } from 'react'

export function AppLogo({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const rim = `logo-rim-${uid}`
  const iris = `logo-iris-${uid}`
  const beam = `logo-beam-${uid}`

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="AnemiaScan"
      focusable="false"
    >
      <defs>
        <linearGradient id={rim} x1="5" y1="8" x2="43" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--chart-3)" />
        </linearGradient>

        <radialGradient id={iris} cx="0.36" cy="0.3" r="0.85">
          <stop offset="0%" stopColor="var(--chart-3)" />
          <stop offset="100%" stopColor="var(--primary)" />
        </radialGradient>

        <linearGradient id={beam} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0" />
          <stop offset="42%" stopColor="var(--chart-3)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* lower-lid aperture */}
      <path
        d="M4.2 24C10.1 15.1 16.8 10.7 24 10.7S37.9 15.1 43.8 24C37.9 32.9 31.2 37.3 24 37.3S10.1 32.9 4.2 24Z"
        fill="none"
        stroke={`url(#${rim})`}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* iris + pupil, punched through with the page colour so it reads at 20px */}
      <circle cx="24" cy="24" r="7.6" fill={`url(#${iris})`} />
      <circle cx="24" cy="24" r="3.1" fill="var(--background)" />
      <circle cx="26.9" cy="20.9" r="1.15" fill="var(--background)" opacity="0.7" />

      {/* scanning beam — fades at both ends so it never looks like a crop mark */}
      <path
        d="M6.5 15.6H41.5"
        stroke={`url(#${beam})`}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
