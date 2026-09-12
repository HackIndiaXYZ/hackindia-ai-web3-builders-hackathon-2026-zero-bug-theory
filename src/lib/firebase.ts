import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean)

const firebaseApp = isFirebaseConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null

export const auth = firebaseApp ? getAuth(firebaseApp) : null
export const db = firebaseApp ? getFirestore(firebaseApp) : null
export const googleProvider = new GoogleAuthProvider()

/**
 * The signed-in user's Firebase ID token, or null when nobody is signed in.
 *
 * POST /inference/predict is authenticated — a request without a valid token
 * gets a 401 and no result — so the scan flow needs this on every submission.
 * `getIdToken()` returns the cached token and refreshes it automatically once
 * it is within five minutes of expiry, which is why this is not memoised here:
 * a token cached by us would outlive the one Firebase is willing to vouch for.
 *
 * Never throws. A failed refresh (offline, revoked session, clock skew) yields
 * null, and the caller surfaces that as "please sign in" rather than firing an
 * unauthenticated request that the backend would reject anyway.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const currentUser = auth?.currentUser
  if (!currentUser) return null
  try {
    return await currentUser.getIdToken(forceRefresh)
  } catch {
    return null
  }
}
