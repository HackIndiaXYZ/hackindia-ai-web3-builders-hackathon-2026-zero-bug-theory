import { type FormEvent, useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, type User } from 'firebase/auth'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AppLogo } from '@/src/components/app-logo'
import { googleProvider } from '@/src/lib/firebase'

interface ProofAccessScreenProps {
  user: User | null
  onAuthenticated: () => void
  onBack: () => void
}

/** A fresh, short-lived confirmation for the separate Proof & care workspace. */
export function ProofAccessScreen({ user, onAuthenticated, onBack }: ProofAccessScreenProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const authenticateWithPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user?.email) {
      setError('This account has no password email. Use Google confirmation instead.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
      onAuthenticated()
    } catch {
      setError('Your password could not be confirmed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const authenticateWithGoogle = async () => {
    if (!user) return
    setBusy(true)
    setError('')
    try {
      await reauthenticateWithPopup(user, googleProvider)
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
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Scan access and Proof & care are separate. Confirm your Firebase identity again before opening your private proof and care options.</p>
          {!user ? (
            <p className="mt-6 rounded-xl border border-moderate/30 bg-moderate/10 p-3 text-sm text-foreground">Sign in to the patient scan area first, then return here to confirm Proof & care access.</p>
          ) : (
            <>
              <p className="mt-6 text-xs text-muted-foreground">Signed in as {user.email ?? 'your Firebase account'}</p>
              <form className="mt-5 flex w-full flex-col gap-3 text-left" onSubmit={authenticateWithPassword}>
                <label className="flex flex-col gap-2 text-sm font-medium">Confirm password<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="h-11 border border-input bg-background px-3 outline-none focus:border-primary" /></label>
                <Button type="submit" disabled={busy || !user.email} className="h-12 rounded-none">{busy ? 'Confirming…' : 'Confirm with password'}</Button>
              </form>
              <Button type="button" variant="outline" disabled={busy} onClick={authenticateWithGoogle} className="mt-4 h-12 w-full rounded-none">Confirm with Google</Button>
            </>
          )}
          {error ? <p className="mt-4 text-xs text-risk">{error}</p> : null}
          <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground/70"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> This confirmation does not change your scan profile.</div>
        </div>
      </section>
    </main>
  )
}

