/// <reference types="vite/client" />

/**
 * Ambient types for the Vite build environment.
 *
 * Without this file `import.meta` is only the bare ECMAScript type, so every
 * `import.meta.env.VITE_*` read fails to compile with TS2339 ("Property 'env'
 * does not exist on type 'ImportMeta'") — one in `lib/api.ts`, six in
 * `lib/firebase.ts`. That went unnoticed for a long time because the build
 * script ran `tsc` with `--noCheck`; it no longer does.
 *
 * The triple-slash reference pulls in Vite's own client types: the built-in
 * `BASE_URL` / `MODE` / `DEV` / `PROD` / `SSR` values, `import.meta.glob`, and
 * the module declarations for asset imports. It is deliberately a reference
 * file rather than a `"types"` array in tsconfig.json — a `"types"` array
 * REPLACES automatic @types discovery, which would drop the `ImportMeta.dirname`
 * augmentation from @types/node that `vite.config.ts` relies on for its `@`
 * alias.
 *
 * The interfaces below merge into Vite's. Vite types unknown keys as `any`, so
 * a typo in a variable name stays silent either way; naming the variables this
 * project actually reads at least pins their real types and documents what a
 * deployment has to provide.
 *
 * Every variable is optional on purpose. Vite inlines only the values present
 * in the shell environment or a `.env` file at build time, so any of them can
 * legitimately be missing, and both consumers already handle that: `api.ts`
 * falls back to a localhost base URL and `firebase.ts` exports
 * `isFirebaseConfigured` so the UI can say sign-in is unavailable instead of
 * crashing. Typing these as plain `string` would type away the exact case they
 * were written to survive.
 *
 * Keep this list in step with `.env.example`.
 */
interface ImportMetaEnv {
  /** Origin of the AnemiaScan backend that serves POST /inference/predict. */
  readonly VITE_API_BASE_URL?: string

  /**
   * Firebase web app credentials. Scanning is authenticated — the backend
   * rejects an unsigned request with 401 — so without these the app can only
   * show its informational screens.
   */
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
