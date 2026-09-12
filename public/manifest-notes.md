# PWA setup notes

Reference for anyone changing AnemiaScan's install/offline behaviour. It documents
**what is configured today** and where to change it — it is not itself read by the
build.

Nothing in `public/` is processed by Vite: every file here is copied verbatim to
`dist/` and served from the site root (`public/robots.txt` → `/robots.txt`).

---

## 1. Where the configuration lives

| Concern | File | Notes |
| --- | --- | --- |
| Web app manifest, service worker, precache rules | `vite.config.ts` → `VitePWA({ … })` | The manifest is **generated** by `vite-plugin-pwa`; there is no hand-written `manifest.webmanifest` to edit. |
| Browser-UI theme colour, favicon, Apple touch icon, `<title>`, meta description | `index.html` | The manifest's `theme_color` and this file's `<meta name="theme-color">` are two separate settings and must be kept in sync by hand. |
| Icon and screenshot binaries | `public/icons/`, `public/favicon-32.png` | See §4. |
| Offline navigation fallback page | `public/offline.html` | See §5. |
| Crawler policy | `public/robots.txt` | Allows everything except `/offline.html`. |

Plugin in use: `vite-plugin-pwa` (`^1.3.0`), default `generateSW` strategy — Workbox
builds the service worker for us, so there is no `src/sw.ts` to maintain.

---

## 2. Generated manifest (current values)

From the `manifest` block in `vite.config.ts`:

| Field | Value |
| --- | --- |
| `name` | `AnemiaScan — anaemia risk screening` |
| `short_name` | `AnemiaScan` |
| `description` | `Screen for anaemia risk from a photo of your lower eyelid. The image is analysed on your device and never uploaded. A screening aid, not a diagnosis.` |
| `id` | `/` |
| `theme_color` | `#07090f` |
| `background_color` | `#07090f` |
| `display` | `standalone` |
| `orientation` | `portrait` |
| `start_url` | `/` |
| `scope` | `/` |
| `lang` / `dir` | `en` / `ltr` |
| `categories` | `health`, `medical`, `utilities` |
| `icons` | three entries, see §4 |

**Not set today** (all optional, all safe to add):

- `id` — pin it (e.g. `"/?app=anemiascan"`) before the app is published anywhere, because
  the default identity is derived from `start_url` and changing `start_url` later would
  look like a different app to already-installed clients.
- `scope` — defaults to the `start_url` directory, which is correct for a root deploy.
  Set it explicitly if the app is ever hosted under a sub-path.
- `screenshots` — Chromium only shows its richer install dialog when these exist. Two or
  three 1080×1920 captures placed in `public/screenshots/` and listed with
  `form_factor: 'narrow'` is the usual minimum.
- `shortcuts` — a "New scan" shortcut is the obvious candidate, but it needs a routable
  URL: the shell parses `#/home`, `#/learn` and `#/history` only (see `DEEP_LINKABLE`
  in `src/App.tsx`), and the camera screen is deliberately **not** deep-linkable.
- `orientation`, `lang`, `dir`, `categories`.

### Theme colours are in two places, and they disagree

A manifest may only carry **one** `theme_color`, so it is the dark palette's near-black.
Light mode is handled in `index.html`, which already ships two media-scoped metas plus an
inline boot script that collapses them to a single explicit value once the user has
chosen a theme:

| Where | Light | Dark |
| --- | --- | --- |
| `index.html` `<meta name="theme-color">` | `#f6f7fb` | `#07090f` |
| `vite.config.ts` manifest `theme_color` / `background_color` | — | `#07090f` |

✅ These now agree. The meta tag drives browser chrome; the manifest drives the installed
app's splash screen and task-switcher tint, so they must be the same near-black or the
splash flashes a different shade than the app that follows it. `#07090f` is the value the
shell's theme control writes at runtime, so that is the one both places use. If you
re-tint the dark palette, change it in `index.html`, `vite.config.ts` and
`src/lib/theme.ts` together.

---

## 3. Service worker registration

- `registerType: 'autoUpdate'` — Workbox is built with `clientsClaim` + `skipWaiting`, so
  a newly deployed version takes over on the next load without prompting. There is no
  "Update available" UI to maintain, and no `virtual:pwa-register` import anywhere in
  `src/`; the plugin injects the registration script into `index.html` at build time
  (`injectRegister: 'auto'` is the default).
- Because the worker activates immediately, **avoid shipping breaking `localStorage`
  changes without bumping the key**. History is stored under
  `anemiascan.history.v1` (`src/lib/history.ts`) — a schema change means a `.v2` key,
  not a silent reinterpretation of `.v1` data.
- The service worker is **only produced by a production build**. `devOptions` is not
  enabled, so `pnpm dev` runs with no worker at all. To exercise offline behaviour:

  ```bash
  pnpm build && pnpm preview
  ```

  then use DevTools → Application → Service Workers (tick *Offline*) and
  DevTools → Application → Cache Storage to inspect the precache.

---

## 4. Icons

### Declared in the manifest

| `src` | Declared `sizes` | `purpose` | File on disk |
| --- | --- | --- | --- |
| `/icons/icon-192.png` | `192x192` | *(default: any)* | 192×192, ~29 KB ✅ |
| `/icons/icon-512.png` | `1024x1024` | `any` | 1024×1024, ~318 KB ✅ |
| `/icons/maskable-512.png` | `512x512` | `maskable` | 512×512, ~122 KB ✅ |

The declared size now matches the file. The filename still says `512` for history's sake;
the asset is genuinely 1024×1024 and is declared as such, so no browser downloads it
expecting a smaller bitmap. Downscaling it to a real 512×512 (and renaming) would save
~290 KB of precache and is the only remaining win here — a cosmetic one.

### Referenced from `index.html`

| File | Size | Used as |
| --- | --- | --- |
| `public/favicon-32.png` | 32×32, ~1.5 KB | `<link rel="icon">`, and listed in `includeAssets` |
| `public/icons/apple-touch-icon.png` | 180×180, ~27 KB | `<link rel="apple-touch-icon">` — iOS home-screen icon |

`includeAssets: ['favicon-32.png']` only exists to force that file into the precache.
It is in practice redundant: the Workbox glob (§6) already matches every `.png` in the
build output. Leave it — it documents intent and costs nothing.

### Regenerating the set

The in-app mark is vector (`src/components/app-logo.tsx`: lower-lid aperture + iris +
scanning beam, drawn with design tokens so it re-tints per theme). The PNGs here were
exported separately and are **not** generated from that component at build time, so a
logo change means re-exporting these files by hand.

When you do:

- Keep `maskable-512.png` visually distinct from the plain icon: a maskable icon is
  cropped to a circle/squircle by the OS, so the mark must sit inside the **inner 80%**
  safe zone and the artwork must bleed to all four edges.
- Flatten onto the brand near-black (`#07090f`) rather than shipping transparency —
  Android composites maskable icons over an unpredictable background.
- Add an SVG entry (`purpose: 'any'`, `sizes: 'any'`) if you want a resolution-free icon;
  no such asset exists today.

### `public/icon.svg`

`index.html` references it twice — `<link rel="icon" type="image/svg+xml">` and
`<link rel="mask-icon" color="#2fd8b6">` (the Safari pinned-tab glyph). It now carries the
AnemiaScan eye-and-beam mark, redrawn from `src/components/app-logo.tsx` at 180×180 (the
same geometry scaled ×3.75) with literal colours, because a favicon cannot read CSS custom
properties. Keep the two in sync by hand if the mark changes.

One caveat: `rel="mask-icon"` expects a single-colour path, so Safari's pinned tab renders
the silhouette in `#2fd8b6` and ignores the gradients. That is why the beam and the iris
are separate strokes rather than one compound shape — the silhouette still reads as
"eye + scan" when flattened.

### Unreferenced legacy assets

Leftovers from the original project template. Nothing in `src/`, `index.html` or the
manifest references them, yet the `png`/`svg` glob (§6) still precaches the PNGs and
SVGs, so deleting them makes every install smaller:

`public/apple-icon.png`, `public/icon-dark-32x32.png`, `public/icon-light-32x32.png`,
`public/placeholder-logo.png`, `public/placeholder-logo.svg`, `public/placeholder-user.jpg`,
`public/placeholder.jpg`, `public/placeholder.svg`.

(`.jpg` is not in the glob, so the two JPEG placeholders ship to `dist/` but are not
precached.)

---

## 5. `offline.html`

A fully self-contained fallback page: inline CSS, an inline SVG mark and one small
inline script — **zero external requests**, which is the only way a page shown without a
network can be trusted to render. Its palette mirrors the `.dark` tokens in
`src/index.css`, with hex values first and the exact `oklch()` tokens layered behind an
`@supports` guard.

Status today:

- It **is** precached (it matches `**/*.html`) and is reachable at `/offline.html`.
- It is **deliberately not** the navigation fallback. The trade-off was decided in favour
  of the app: this is a single-page app whose analysis is entirely local, so an offline
  navigation should boot the cached shell, not a dead end. `vite.config.ts` therefore sets

  ```ts
  workbox: {
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/^\/offline\.html$/],
  }
  ```

  The denylist entry is what keeps `/offline.html` reachable as itself instead of being
  rewritten to the shell. So the page is a manual destination and a belt-and-braces
  explainer for the case where the shell itself was never cached — not the normal
  offline experience, which is the full app.

---

## 6. Precache glob

```ts
workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'] }
```

Matched relative to the **build output** (`dist/`), not `public/`. Consequences worth
knowing:

- Every hashed JS/CSS chunk, `index.html`, `offline.html`, the web manifest and all
  PNG/SVG assets are precached on install — the app is fully usable offline after one successful load.
- `.webp`, `.avif` and `.woff2` are **not** matched. Nothing in the build output
  uses them today, but the day someone adds a self-hosted font or a `.webp` illustration,
  add its extension here or it will 404 offline.
- **Fonts are handled at runtime, not by the glob.** `index.html` pulls Inter from
  `fonts.googleapis.com`, and a precache glob cannot cover a cross-origin request. Two
  `runtimeCaching` rules close that gap: `StaleWhileRevalidate` for the
  `fonts.googleapis.com` stylesheet and `CacheFirst` (opaque responses allowed, 8 entries,
  one year) for the `fonts.gstatic.com` font files. So the first online load warms the
  cache and later offline launches keep Inter instead of dropping to the system stack. The
  fully origin-contained alternative is still to self-host the `.woff2` files under
  `public/fonts/` — `woff2` would then need adding to the glob.
- Captured eyelid photos are never cached here: they live in `localStorage` as data URLs
  and never touch the network or the Cache Storage API.

---

## 7. Checklist for renaming or rebranding

1. `vite.config.ts` — `manifest.name`, `short_name`, `description`, `theme_color`,
   `background_color`.
2. `index.html` — `<title>`, `<meta name="description">`, both `<meta name="theme-color">`
   entries, the inline theme-boot script's hard-coded colours, `mask-icon` colour, and the
   Open Graph / Twitter card text and images.
3. `public/icons/*` — re-export all four PNGs (see §4).
4. `src/components/app-logo.tsx` — the in-app vector mark.
5. `public/offline.html` — the brand name, the inline mark and the palette variables.
6. `public/robots.txt` — add the `Sitemap:` line once a permanent origin exists.
7. `pnpm build && pnpm preview`, then re-check install + offline in DevTools.
