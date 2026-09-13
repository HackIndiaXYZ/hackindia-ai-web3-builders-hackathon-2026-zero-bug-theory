import { type FormEvent, useState } from 'react'
import { ArrowLeft, LogIn, ShieldCheck } from 'lucide-react'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/src/components/app-logo'
import { auth, googleProvider, isFirebaseConfigured } from '@/src/lib/firebase'

type AuthMode = 'login' | 'signup'

export function AuthScreen({ onBack, onAuthenticated }: { onBack?: () => void; onAuthenticated?: () => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setError('')
  }

  const handleEmailAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!auth) return

    setError('')
    setBusy(true)

    try {
      if (mode === 'signup') {
        const result = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(result.user, { displayName: name.trim() })
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
      onAuthenticated?.()
    } catch (authError) {
      const errorCode = authError instanceof Error ? authError.message : ''
      if (errorCode.includes('auth/invalid-credential')) {
        setError('The email or password is incorrect.')
      } else if (errorCode.includes('auth/email-already-in-use')) {
        setError('An account already exists for this email. Try logging in.')
      } else if (errorCode.includes('auth/weak-password')) {
        setError('Use a password with at least 6 characters.')
      } else {
        setError('We could not complete authentication. Check your details and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleGoogleSignIn = async () => {
    if (!auth) return

    setError('')
    setBusy(true)

    try {
      await signInWithPopup(auth, googleProvider)
      onAuthenticated?.()
    } catch (signInError) {
      if (signInError instanceof Error && signInError.message.includes('popup-closed-by-user')) {
        setError('The sign-in window was closed. Try again when you are ready.')
      } else {
        setError('We could not complete sign-in. Check your Firebase Auth settings and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return <main className="flex flex-1 items-center justify-center px-6 py-12"><section className="w-full max-w-md border border-border bg-card/60 p-8 shadow-[0_24px_80px_-40px_var(--primary)] sm:p-10">{onBack && <button type="button" onClick={onBack} className="mb-6 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to scanner</button>}<div className="flex flex-col items-center text-center"><AppLogo className="mb-6 h-14 w-14" /><p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">AnemiaScan</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Doctor sign in</h1><p className="mt-4 text-sm leading-relaxed text-muted-foreground">Sign in to review patient screenings routed to you and add clinical guidance.</p><div className="mt-8 grid w-full grid-cols-2 border-b border-border">{(['login', 'signup'] as AuthMode[]).map((option) => <button key={option} type="button" onClick={() => { setMode(option); setError('') }} className={`border-b-2 pb-3 text-sm font-medium ${mode === option ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>{option === 'login' ? 'Login' : 'Sign up'}</button>)}</div><form className="mt-6 flex w-full flex-col gap-4 text-left" onSubmit={handleEmailAuth}>{mode === 'signup' && <label className="flex flex-col gap-2 text-sm font-medium">Name<input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="h-11 border border-input bg-background px-3 outline-none focus:border-primary" /></label>}<label className="flex flex-col gap-2 text-sm font-medium">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="h-11 border border-input bg-background px-3 outline-none focus:border-primary" /></label><label className="flex flex-col gap-2 text-sm font-medium">Password<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="h-11 border border-input bg-background px-3 outline-none focus:border-primary" /></label><Button type="submit" disabled={busy || !isFirebaseConfigured} className="h-12 rounded-none">{busy ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}</Button></form><Button type="button" variant="outline" disabled={busy || !isFirebaseConfigured} onClick={handleGoogleSignIn} className="mt-4 h-12 w-full rounded-none"><LogIn className="mr-2 h-4 w-4" /> Continue with Google</Button>{!isFirebaseConfigured && <p className="mt-4 text-xs text-risk">Add Firebase values to `.env.local` to enable sign-in.</p>}{error && <p className="mt-4 text-xs text-risk">{error}</p>}<div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground/70"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Your account stays private and secure.</div></div></section></main>
}

