/**
 * Theme persistence and application.
 *
 * The app ships dark-first: an absent or corrupt preference resolves to 'dark'.
 * 'system' follows the OS via matchMedia. Every storage and DOM access is
 * guarded so this module is safe to import in a non-browser (SSR / test)
 * environment and safe in private browsing modes where localStorage throws.
 */

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'anemiascan.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'
const DEFAULT_THEME: Theme = 'dark'

/**
 * The browser-chrome colour for each palette — the single source of truth.
 *
 * These are the computed sRGB values of `--background` in src/index.css
 * (`oklch(0.986 0.003 250)` and `oklch(0.148 0.016 262)`). index.html ships the
 * same pair inline so the very first paint is right before any JS runs, and
 * theme-toggle.tsx imports this object rather than redeclaring it. If
 * `--background` is ever retuned, recompute both values here and in index.html.
 */
export const THEME_COLOR: Record<'light' | 'dark', string> = {
  light: '#f9fbfc',
  dark: '#070b12',
}

/**
 * Point every `theme-color` meta at the palette actually being painted.
 *
 * index.html ships two entries gated on `prefers-color-scheme`, tagged with
 * `data-theme-color`. An explicit choice collapses both to that colour; 'system'
 * hands each entry back to the scheme it was authored for.
 */
export function syncThemeColor(theme: Theme): void {
  if (typeof document === 'undefined') return
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  const explicit = theme === 'system' ? null : resolveTheme(theme)
  metas.forEach((meta) => {
    const authored = meta.dataset.themeColor === 'light' ? 'light' : 'dark'
    meta.content = THEME_COLOR[explicit ?? authored]
  })
}

let systemListenerAttached = false

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

function hasDom(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement
}

function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return true
  }
}

/** The stored preference, defaulting to 'dark'. Never throws. */
export function getStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isTheme(raw) ? raw : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** Resolve a preference into the concrete palette that should be painted. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light'
  return theme
}

function paint(theme: Theme, resolved: 'light' | 'dark'): void {
  if (!hasDom()) return
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  // Keeps native form controls, scrollbars and the URL bar in sync.
  root.style.colorScheme = resolved
  // One implementation, walking EVERY meta entry — boot and the runtime toggle
  // can no longer disagree about which ones are correct.
  syncThemeColor(theme)
}

/**
 * Persist the preference and toggle the `dark` class on <html>.
 * Persistence failures (quota, blocked storage) are non-fatal — the theme is
 * still applied for the current session.
 */
export function applyTheme(theme: Theme): void {
  const next: Theme = isTheme(theme) ? theme : DEFAULT_THEME
  paint(next, resolveTheme(next))
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* storage unavailable — the in-session theme is already applied */
  }
}

/**
 * Call once at boot. Applies the stored preference, wires a one-time listener so
 * 'system' keeps tracking the OS, and returns the active choice.
 */
export function initTheme(): Theme {
  const theme = getStoredTheme()
  paint(theme, resolveTheme(theme))

  if (
    !systemListenerAttached &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    try {
      const media = window.matchMedia(DARK_QUERY)
      const onChange = () => {
        // Only 'system' should react to the OS flipping.
        if (getStoredTheme() === 'system') paint('system', prefersDark() ? 'dark' : 'light')
      }
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onChange)
        systemListenerAttached = true
      }
    } catch {
      /* matchMedia unsupported — 'system' resolves once at boot instead */
    }
  }

  return theme
}
