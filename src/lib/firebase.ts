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

export function getAuthErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : ''

  if (code.includes('popup-closed-by-user')) return 'The sign-in window was closed. Try again when you are ready.'
  if (code.includes('popup-blocked')) return 'Your browser blocked the sign-in window. Allow popups for this site and try again.'
  if (code.includes('unauthorized-domain')) return 'This site is not authorized in Firebase. Add its domain in Firebase Authentication > Settings > Authorized domains.'
  if (code.includes('operation-not-allowed')) return 'Google sign-in is disabled. Enable the Google provider in Firebase Authentication > Sign-in method.'
  if (code.includes('account-exists-with-different-credential')) return 'An account already exists with another sign-in method. Sign in with that method first.'
  if (code.includes('network-request-failed')) return 'The network connection failed. Check your connection and try again.'
  return 'We could not complete Google sign-in. Check your Firebase Auth settings and try again.'
}