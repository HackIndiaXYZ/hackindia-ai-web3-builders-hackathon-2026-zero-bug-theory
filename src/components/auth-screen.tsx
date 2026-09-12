import { useState } from 'react'
import { LogIn, ShieldCheck } from 'lucide-react'
import { signInWithPopup } from 'firebase/auth'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/src/components/app-logo'
import { auth, googleProvider, isFirebaseConfigured } from '@/src/lib/firebase'

export function AuthScreen() {
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState('')

  const handleGoogleSignIn = async () => {
    if (!auth) return

    setError('')
    setIsSigningIn(true)

    try {
      await signInWithPopup(auth, googleProvider)
    } catch (signInError) {
      if (signInError instanceof Error && signInError.message.includes('popup-closed-by-user')) {
        setError('The sign-in window was closed. Try again when you are ready.')
      } else {
        setError('We could not complete sign-in. Check your Firebase Auth settings and try again.')
      }
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <section className="relative w-full max-w-md overflow-hidden border border-border bg-card/60 p-8 shadow-[0_24px_80px_-40px_var(--primary)] sm:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,oklch(0.78_0.135_174_/_12%),transparent_55%)]" />
        <div className="relative flex flex-col items-center text-center">
          <AppLogo className="mb-6 h-14 w-14" />
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-primary">
            AnemiaScan
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Your health, in focus.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Sign in to securely access your screening history and continue to the camera check.
          </p>

          <Button
            type="button"
            size="lg"
            className="mt-8 h-12 w-full rounded-none text-base"
            onClick={handleGoogleSignIn}
            disabled={isSigningIn || !isFirebaseConfigured}
          >
            <LogIn className="mr-2 h-4 w-4" />
            {isSigningIn ? 'Opening secure sign-in...' : 'Continue with Google'}
          </Button>

          {!isFirebaseConfigured && (
            <p className="mt-4 text-xs leading-relaxed text-risk">
              Firebase is not configured yet. Add the VITE_FIREBASE values from `.env.example` to enable sign-in.
            </p>
          )}

          {error && <p className="mt-4 text-xs leading-relaxed text-risk">{error}</p>}

          <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground/70">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Your account stays private and secure.
          </div>
        </div>
      </section>
    </main>
  )
}