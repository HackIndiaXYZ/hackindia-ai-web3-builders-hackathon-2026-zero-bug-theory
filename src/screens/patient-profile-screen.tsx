import { type FormEvent, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { doc, setDoc } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/src/components/app-logo'
import { db, auth } from '@/src/lib/firebase'

export function PatientProfileScreen({ onComplete, onBack }: { onComplete: () => void; onBack?: () => void }) {
  const [name, setName] = useState(auth?.currentUser?.displayName || '')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState('male')
  const [medicalNotes, setMedicalNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!auth?.currentUser || !db) return

    setError('')
    setBusy(true)

    try {
      const savePromise = setDoc(doc(db, 'patients', auth.currentUser.uid), {
        name: name.trim(),
        age: parseInt(age, 10),
        gender,
        medicalNotes: medicalNotes.trim(),
        createdAt: new Date().toISOString(),
      })
      
      // Timeout after 10 seconds if Firestore is hanging (e.g. not enabled or blocked)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), 10000)
      )

      await Promise.race([savePromise, timeoutPromise])
      onComplete()
    } catch (err) {
      console.error('Firestore save error:', err)
      if (err instanceof Error && err.message === 'timeout') {
        setError('Connection timed out. Please check if Firestore Database is enabled in your Firebase console.')
      } else {
        setError('Could not save your profile. Please check console for details.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <section className="w-full max-w-md border border-border bg-card/60 p-8 shadow-[0_24px_80px_-40px_var(--primary)] sm:p-10">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-6 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
        <div className="flex flex-col items-center text-center">
          <AppLogo className="mb-6 h-14 w-14" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">AnemiaScan</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Patient Profile</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Before we begin the scan, please provide some basic information. This helps ensure accurate screening context.
          </p>

          <form className="mt-8 flex w-full flex-col gap-4 text-left" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Full Name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="h-11 border border-input bg-background px-3 outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Age
              <input
                required
                type="number"
                min="1"
                max="120"
                value={age}
                onChange={(event) => setAge(event.target.value)}
                className="h-11 border border-input bg-background px-3 outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Gender
              <select
                required
                value={gender}
                onChange={(event) => setGender(event.target.value)}
                className="h-11 border border-input bg-background px-3 outline-none focus:border-primary"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Relevant Medical History (Optional)
              <textarea
                value={medicalNotes}
                onChange={(event) => setMedicalNotes(event.target.value)}
                placeholder="Any known conditions or past history of anemia?"
                className="min-h-[80px] resize-y border border-input bg-background px-3 py-2 outline-none focus:border-primary"
              />
            </label>

            <Button type="submit" disabled={busy || !db} className="mt-2 h-12 rounded-none">
              {busy ? 'Saving...' : 'Save and Continue'}
            </Button>
          </form>

          {error && <p className="mt-4 text-xs text-risk">{error}</p>}
        </div>
      </section>
    </main>
  )
}
