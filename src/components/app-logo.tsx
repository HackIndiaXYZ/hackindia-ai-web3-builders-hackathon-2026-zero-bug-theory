export function AppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="AnemiaScan logo">
      <defs>
        <linearGradient id="anemiascan-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--chart-3)" />
        </linearGradient>
      </defs>
      <circle
        cx="60"
        cy="60"
        r="56"
        fill="none"
        stroke="url(#anemiascan-logo-gradient)"
        strokeWidth="2"
        opacity="0.35"
      />
      <path
        d="M16 60 C 36 24, 84 24, 104 60 C 84 96, 36 96, 16 60 Z"
        fill="none"
        stroke="url(#anemiascan-logo-gradient)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="60" cy="60" r="17" fill="url(#anemiascan-logo-gradient)" opacity="0.9" />
      <circle cx="60" cy="60" r="7.5" fill="var(--background)" />
      <line
        x1="14"
        y1="42"
        x2="106"
        y2="42"
        stroke="url(#anemiascan-logo-gradient)"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  )
}
