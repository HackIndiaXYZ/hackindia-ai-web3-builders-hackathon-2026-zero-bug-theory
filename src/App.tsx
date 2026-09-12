import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { SiteHeader } from '@/src/components/site-header'
import { AuthScreen } from '@/src/components/auth-screen'
import { DoctorPortal } from '@/src/components/doctor-portal'
import { HomeScreen } from '@/src/screens/home-screen'
import { ScanScreen } from '@/src/screens/scan-screen'
import { ProcessingScreen } from '@/src/screens/processing-screen'
import { ResultScreen } from '@/src/screens/result-screen'
import { InsightsScreen } from '@/src/screens/insights-screen'
import { InconclusiveScreen } from '@/src/screens/inconclusive-screen'
import type { DoctorReport, ScanAnalysis, ScreenId } from '@/src/lib/types'
import { auth, isFirebaseConfigured } from '@/src/lib/firebase'

const IMMERSIVE_SCREENS: ScreenId[] = ['scan', 'processing']

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('home')
  const [analysis, setAnalysis] = useState<ScanAnalysis | null>(null)
  const [reports, setReports] = useState<DoctorReport[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)

  useEffect(() => {
    if (!auth) return

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthReady(true)
    })
  }, [])

  const handleCaptured = useCallback((result: ScanAnalysis) => {
    setAnalysis(result)
    setScreen('processing')
  }, [])

  const handleProcessingDone = useCallback(() => {
    setScreen((_) => (analysis?.tooDark ? 'inconclusive' : 'result'))
  }, [analysis])

  const goHome = useCallback(() => setScreen('home'), [])
  const sendToDoctor = useCallback((patientLabel: string) => {
    if (!analysis) return
    setReports((current) => [{ id: `R-${Date.now()}`, patientLabel, analysis, submittedAt: new Date().toISOString(), status: 'Awaiting Review' }, ...current])
  }, [analysis])
  const saveDoctorAdvice = useCallback((reportId: string, doctorAdvice: string) => {
    setReports((current) => current.map((report) => report.id === reportId ? { ...report, doctorAdvice, status: 'Reviewed', reviewedAt: new Date().toISOString() } : report))
  }, [])
  const showHeader = !IMMERSIVE_SCREENS.includes(screen) && screen !== 'doctor'

  if (!authReady) {
    return <div className="flex min-h-dvh w-full bg-background" />
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh w-full flex-col bg-background">
        <AuthScreen />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      {showHeader && (
        <SiteHeader
          onHome={goHome}
          user={user}
          onDoctorPortal={() => setScreen('doctor')}
          onSignOut={() => auth && signOut(auth)}
        />
      )}

      <main className="flex flex-1 flex-col">
        {screen === 'home' && <HomeScreen onStart={() => setScreen('scan')} />}

        {screen === 'scan' && (
          <ScanScreen onCapture={handleCaptured} onExit={goHome} />
        )}

        {screen === 'processing' && analysis && (
          <ProcessingScreen imageDataUrl={analysis.imageDataUrl} onDone={handleProcessingDone} />
        )}

        {screen === 'result' && analysis && (
          <ResultScreen
            analysis={analysis}
            onViewInsights={() => setScreen('insights')}
            onScanAgain={() => setScreen('scan')}
            onSendToDoctor={sendToDoctor}
          />
        )}

        {screen === 'insights' && analysis && (
          <InsightsScreen analysis={analysis} onBack={() => setScreen('result')} />
        )}

        {screen === 'inconclusive' && (
          <InconclusiveScreen onRetake={() => setScreen('scan')} onExit={goHome} />
        )}

        {screen === 'doctor' && <DoctorPortal reports={reports} onBack={goHome} onSaveAdvice={saveDoctorAdvice} />}
      </main>
    </div>
  )
}
