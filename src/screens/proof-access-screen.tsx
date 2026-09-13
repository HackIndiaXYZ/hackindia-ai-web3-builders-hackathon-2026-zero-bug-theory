import { type FormEvent, useState } from 'react'
import { EmailAuthProvider, createUserWithEmailAndPassword, reauthenticateWithCredential, reauthenticateWithPopup, signInWithEmailAndPassword, signInWithPopup, type User, updateProfile } from 'firebase/auth'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AppLogo } from '@/src/components/app-logo'
import { auth, googleProvider, isFirebaseConfigured } from '@/src/lib/firebase'

interface ProofAccessScreenProps {
  user: User | null
  onAuthenticated: () => void
  onBack: () => void
}

/** A fresh, short-lived confirmation for the separate Proof & care workspace. */
export function ProofAccessScreen({ user, onAuthenticated, onBack }: ProofAccessScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const authenticateWithPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user && !auth) {
      setError('Firebase sign-in is not configured for this app.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (user) {
        if (!user.email) throw new Error('This account has no password email. Use Google confirmation instead.')
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
      } else if (mode === 'signup') {
        const result = await createUserWithEmailAndPassword(auth!, email, password)
        await updateProfile(result.user, { displayName: name.trim() })
      } else {
        await signInWithEmailAndPassword(auth!, email, password)
      }
      onAuthenticated()
    } catch (authError) {
      const message = authError instanceof Error ? authError.message : ''
      setError(message.includes('email-already-in-use') ? 'An account already exists for this email. Try logging in.' : message.includes('invalid-credential') ? 'The email or password is incorrect.' : user ? 'Your password could not be confirmed. Try again.' : 'Sign-in could not be completed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const authenticateWithGoogle = async () => {
    if (!user && !auth) {
      setError('Firebase sign-in is not configured for this app.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (user) await reauthenticateWithPopup(user, googleProvider)
      else await signInWithPopup(auth!, googleProvider)
      onAuthenticated()
    } catch (authError) {
      setError(authError instanceof Error && authError.message.includes('popup-closed-by-user') ? 'The confirmation window was closed.' : 'Google confirmation could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <section className="w-full max-w-md border border-border bg-card/60 p-8 shadow-[0_24px_80px_-40px_var(--primary)] sm:p-10">
        <button type="button" onClick={onBack} className="mb-6 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to home</button>
        <div className="flex flex-col items-center text-center">
          <AppLogo className="mb-6 h-14 w-14" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Proof & care</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Confirm access</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Proof & care has its own sign-in. Scan access and profile details are not required here.</p>
          {user ? <p className="mt-6 text-xs text-muted-foreground">Signed in as {user.email ?? 'your Firebase account'}. Confirm again to open Proof & care.</p> : <div className="mt-6 grid w-full grid-cols-2 border-b border-border">{(['login', 'signup'] as const).map((option) => <button key={option} type="button" onClick={() => { setMode(option); setError('') }} className={`border-b-2 pb-3 text-sm font-medium ${mode === option ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>{option === 'login' ? 'Login' : 'Sign up'}</button>)}</div>}
          <form className="mt-5 flex w-full flex-col gap-3 text-left" onSubmit={authenticateWithPassword}>
            {!user && mode === 'signup' ? <label className="flex flex-col gap-2 text-sm font-medium">Name<input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="h-11 border border-input bg-background px-3 outline-none focus:border-primary" /></label> : null}
            {!user ? <label className="flex flex-col gap-2 text-sm font-medium">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="h-11 border border-input bg-background px-3 outline-none focus:border-primary" /></label> : null}
            <label className="flex flex-col gap-2 text-sm font-medium">{user ? 'Confirm password' : 'Password'}<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={user || mode === 'login' ? 'current-password' : 'new-password'} className="h-11 border border-input bg-background px-3 outline-none focus:border-primary" /></label>
            <Button type="submit" disabled={busy || !isFirebaseConfigured || (Boolean(user) && !user.email)} className="h-12 rounded-none">{busy ? 'Confirming…' : user ? 'Confirm with password' : mode === 'login' ? 'Login to Proof & care' : 'Create Proof & care account'}</Button>
          </form>
          <Button type="button" variant="outline" disabled={busy || !isFirebaseConfigured} onClick={authenticateWithGoogle} className="mt-4 h-12 w-full rounded-none">{user ? 'Confirm with Google' : 'Continue with Google'}</Button>
          {!isFirebaseConfigured ? <p className="mt-4 text-xs text-risk">Add Firebase values to `.env.local` to enable sign-in.</p> : null}
          {error ? <p className="mt-4 text-xs text-risk">{error}</p> : null}
          <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground/70"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> This confirmation does not change your scan profile.</div>
        </div>
      </section>
    </main>
  )
}

