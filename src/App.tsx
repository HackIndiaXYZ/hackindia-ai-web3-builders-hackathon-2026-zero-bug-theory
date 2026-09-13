/* --------------------------------------------------------------------------
 * App — the AnemiaScan shell.
 * --------------------------------------------------------------------------
 * One state machine over the nine screens in `ScreenId`, no router library.
 * What that buys, and what it costs to do properly:
 *
 *   Real back navigation. Every move pushes (or deliberately replaces) a
 *   `history` entry with the screen in `history.state`, so the Android back
 *   gesture and the desktop back button walk the app instead of leaving it. The
 *   capture flow *replaces* rather than pushes — backing out of a result should
 *   land on home, never re-enter the camera or replay the analysis animation.
 *
 *   Honest focus handling. A screen change in a single-page app is silent to a
 *   screen reader, so on every change the shell scrolls to the top, moves focus
 *   to the new screen's heading and names the new screen in a live region.
 *
 *   One owner for history. Scan history is loaded once and persisted exactly at
 *   the transition into a result — never on render, and never for a frame the
 *   V4 quality gate rejected.
 *
 *   One owner for the doctor queue. `reports` is in-memory only — sending a
 *   screening to a clinician is a prototype workflow, not a persisted one, so
 *   it deliberately does not survive a reload the way scan history does.
 *
 *   Scoped access. Doctor dashboard and Proof & care each require their own
 *   fresh confirmation; neither workspace unlocks the other. The scanner
 *   itself remains available through its patient flow.
 * -------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CloudOff } from 'lucide-react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'

import { cn } from '@/lib/utils'
import { AuthScreen } from '@/src/components/auth-screen'
import { BottomNav } from '@/src/components/bottom-nav'
import { BlockchainScreen } from '@/src/screens/blockchain-screen'
import { ConsentGate, hasAcknowledged } from '@/src/components/consent-gate'
import { DoctorPortal } from '@/src/components/doctor-portal'
import { InstallPrompt } from '@/src/components/install-prompt'
import { SiteHeader } from '@/src/components/site-header'
import { auth, db, isFirebaseConfigured } from '@/src/lib/firebase'
import { clearHistory, deleteScan, loadHistory, saveScan } from '@/src/lib/history'
import type { CapturedImage, DoctorReport, ScanAnalysis, ScreenId, PatientProfile } from '@/src/lib/types'
import { HistoryScreen } from '@/src/screens/history-screen'
import { HomeScreen } from '@/src/screens/home-screen'
import { InconclusiveScreen } from '@/src/screens/inconclusive-screen'
import { InsightsScreen } from '@/src/screens/insights-screen'
import { LearnScreen } from '@/src/screens/learn-screen'
import { ProcessingScreen } from '@/src/screens/processing-screen'
import { ResultScreen } from '@/src/screens/result-screen'
import { ScanScreen } from '@/src/screens/scan-screen'
import { PatientAuthScreen } from '@/src/screens/patient-auth-screen'
import { PatientProfileScreen } from '@/src/screens/patient-profile-screen'
import { ProofAccessScreen } from '@/src/screens/proof-access-screen'

/** Screens that take over the viewport: no header, no tab bar, no page chrome. */
const IMMERSIVE_SCREENS: ScreenId[] = ['scan', 'processing']

/** Screens that render their own full-bleed header instead of the app chrome. */
const OWN_CHROME_SCREENS: ScreenId[] = ['doctor']

/** Screens that need a freshly captured frame to render anything at all. */
const CAPTURE_SCREENS: ScreenId[] = ['processing']

/** Screens that need an active analysis to render anything at all. */
const ANALYSIS_SCREENS: ScreenId[] = ['result', 'insights']

const SCREEN_IDS: ScreenId[] = [
  'home',
  'scan',
  'processing',
  'result',
  'insights',
  'inconclusive',
  'history',
  'learn',
  'blockchain',
  'doctor',
  'patient-auth',
  'patient-profile',
  'proof-auth',
]

/** Only these are safe to land on from a cold URL — the rest need session state. */
const DEEP_LINKABLE: ScreenId[] = ['home', 'learn', 'history', 'blockchain']

/** Announced in the live region, and used as the document title suffix. */
const SCREEN_TITLES: Record<ScreenId, string> = {
  home: 'Home',
  scan: 'Camera',
  processing: 'Analysing your scan',
  result: 'Your screening result',
  insights: 'V4 model details',
  inconclusive: 'Scan inconclusive',
  history: 'Scan history',
  learn: 'Learn about anaemia',
  blockchain: 'Proof and care',
  doctor: 'Doctor portal',
  'patient-auth': 'Patient sign in',
  'patient-profile': 'Patient Profile',
  'proof-auth': 'Proof and care access',
}

interface ShellHistoryState {
  screen?: string
  depth?: number
}

function isScreenId(value: unknown): value is ScreenId {
  return typeof value === 'string' && SCREEN_IDS.includes(value as ScreenId)
}

function screenFromHash(hash: string): ScreenId {
  const candidate = hash.replace(/^#\/?/, '')
  return isScreenId(candidate) && DEEP_LINKABLE.includes(candidate) ? candidate : 'home'
}

function urlFor(screen: ScreenId): string {
  if (typeof window === 'undefined') return '#/home'
  const { pathname, search } = window.location
  return screen === 'home' ? `${pathname}${search}` : `${pathname}${search}#/${screen}`
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>(() =>
    typeof window === 'undefined' ? 'home' : screenFromHash(window.location.hash),
  )
  const [capture, setCapture] = useState<CapturedImage | null>(null)
  const [analysis, setAnalysis] = useState<ScanAnalysis | null>(null)
  const [inconclusiveInfo, setInconclusiveInfo] = useState<{
    reason: 'quality' | 'error'
    message?: string
  }>({ reason: 'quality' })
  const [history, setHistory] = useState<ScanAnalysis[]>(() => loadHistory())
  const [reports, setReports] = useState<DoctorReport[]>([])
  const [consented, setConsented] = useState<boolean>(() => hasAcknowledged())
  const [announcement, setAnnouncement] = useState('')

  /* ---- Firebase auth gate ------------------------------------------------ */
  const [user, setUser] = useState<User | null>(null)
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null | undefined>(undefined)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)
  const [proofAccessGranted, setProofAccessGranted] = useState(false)
  const [doctorAccessGranted, setDoctorAccessGranted] = useState(false)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        setProofAccessGranted(false)
        setDoctorAccessGranted(false)
      }
      if (nextUser && db) {
        try {
          const docSnap = await getDoc(doc(db, 'patients', nextUser.uid))
          if (docSnap.exists()) {
            setPatientProfile(docSnap.data() as PatientProfile)
          } else {
            setPatientProfile(null)
          }
        } catch (e) {
          setPatientProfile(null)
        }
      } else {
        setPatientProfile(null)
      }
      setAuthReady(true)
    })
  }, [])

  /** How many entries deep into the app we are, so `back` never escapes it. */
  const depthRef = useRef(0)
  /** Mirrors `screen` so the nav callbacks stay identity-stable. */
  const screenRef = useRef(screen)
  const mainRef = useRef<HTMLElement>(null)
  /** The screen we last moved focus into. Also makes the effect idempotent, so
   *  React's development double-invoke cannot steal focus on first paint. */
  const focusedScreenRef = useRef<ScreenId | null>(null)

  /* ---- navigation primitives --------------------------------------------
     History writes live here rather than inside a state updater: React may run
     an updater twice, and a doubled pushState would poison the back stack. */

  const push = useCallback((next: ScreenId) => {
    if (screenRef.current === next) return
    depthRef.current += 1
    screenRef.current = next
    const state: ShellHistoryState = { screen: next, depth: depthRef.current }
    try {
      window.history.pushState(state, '', urlFor(next))
    } catch {
      /* history unavailable (rare, sandboxed frames) — still navigate */
    }
    setScreen(next)
  }, [])

  const replace = useCallback((next: ScreenId) => {
    screenRef.current = next
    const state: ShellHistoryState = { screen: next, depth: depthRef.current }
    try {
      window.history.replaceState(state, '', urlFor(next))
    } catch {
      /* as above */
    }
    setScreen(next)
  }, [])

  /* ---- patient auth auto-redirect ---------------------------------------- */
  useEffect(() => {
    if (screen === 'patient-auth' && user) {
      if (patientProfile === null) {
        replace('patient-profile')
      } else if (patientProfile !== undefined) {
        replace('scan')
      }
    }
  }, [screen, user, patientProfile, replace])

  // Proof & care always needs its own fresh confirmation, even when scan
  // authentication and the patient profile are already complete.
  useEffect(() => {
    if (screen === 'blockchain' && !proofAccessGranted) {
      replace('proof-auth')
    }
  }, [screen, proofAccessGranted, replace])

  /** Pop one entry when we own one, otherwise fall back inside the app. */
  const back = useCallback(
    (fallback: ScreenId) => {
      if (depthRef.current > 0) {
        window.history.back()
        return
      }
      replace(fallback)
    },
    [replace],
  )

  /* ---- seed the first history entry so popstate always has state -------- */
  useEffect(() => {
    const state: ShellHistoryState = { screen, depth: 0 }
    try {
      window.history.replaceState(state, '', urlFor(screen))
    } catch {
      /* ignore */
    }
    // Intentionally once: every later entry is written by push/replace.
  }, [])

  /* ---- hardware / browser back ------------------------------------------ */
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = (event.state ?? null) as ShellHistoryState | null
      const target = isScreenId(state?.screen)
        ? state.screen
        : screenFromHash(window.location.hash)
      depthRef.current = typeof state?.depth === 'number' ? Math.max(0, state.depth) : 0
      screenRef.current = target
      setScreen(target)
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  /* ---- never render a screen whose data is gone ------------------------- */
  useEffect(() => {
    if (!capture && CAPTURE_SCREENS.includes(screen)) {
      replace('home')
      return
    }
    if (!analysis && ANALYSIS_SCREENS.includes(screen)) replace('home')
  }, [capture, analysis, screen, replace])

  /* ---- scroll, focus and announce every screen change ------------------- */
  useEffect(() => {
    setAnnouncement(SCREEN_TITLES[screen])
    document.title = screen === 'home' ? 'AnemiaScan' : `${SCREEN_TITLES[screen]} · AnemiaScan`

    if (focusedScreenRef.current === null) {
      // First paint: announce, but never yank focus off the consent notice.
      focusedScreenRef.current = screen
      return
    }
    if (focusedScreenRef.current === screen) return
    focusedScreenRef.current = screen

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })

    // ScanScreen runs its own focus choreography — it focuses whichever heading
    // matches its current state (camera, permission denied, no camera) on mount
    // and on every state change, because entering the camera unmounts the header
    // and bottom nav the user just activated. ProcessingScreen is deliberately
    // left alone: it is a sub-two-second handoff that unmounts itself, and the
    // screen that replaces it takes focus normally.
    if (IMMERSIVE_SCREENS.includes(screen)) return

    const container = mainRef.current
    if (!container) return

    const target = container.querySelector<HTMLElement>('h1, h2') ?? container
    const borrowedTabIndex = !target.hasAttribute('tabindex')
    if (borrowedTabIndex) target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })

    const release = () => {
      if (borrowedTabIndex) target.removeAttribute('tabindex')
    }
    target.addEventListener('blur', release, { once: true })
    return () => target.removeEventListener('blur', release)
  }, [screen])

  /* ---- flow handlers ---------------------------------------------------- */

  const goHome = useCallback(() => push('home'), [push])
  const goScan = useCallback(() => push('scan'), [push])

  const handleBeginScan = useCallback(() => {
    if (!user) {
      push('patient-auth')
    } else if (!patientProfile) {
      push('patient-profile')
    } else {
      push('scan')
    }
  }, [user, patientProfile, push])

  const goHistory = useCallback(() => push('history'), [push])
  const goLearn = useCallback(() => push('learn'), [push])
  const goBlockchain = useCallback(() => {
    setProofAccessGranted(false)
    push('proof-auth')
  }, [push])
  const goDoctor = useCallback(() => {
    setDoctorAccessGranted(false)
    push('doctor')
  }, [push])

  const handleCaptured = useCallback(
    (next: CapturedImage) => {
      setCapture(next)
      // Replace, not push: the camera should never be behind a finished result.
      replace('processing')
    },
    [replace],
  )

  /** ProcessingScreen calls this only for a validated, quality-accepted V4
   *  response. A rejected capture uses handleRecapture instead. */
  const handleProcessingDone = useCallback(
    (result: ScanAnalysis) => {
      setAnalysis(result)
      setHistory(saveScan(result))
      replace('result')
    },
    [replace],
  )

  /** The screening service could not be reached at all (network failure, the
   *  backend being down, or an unexpected server error) — distinct from a
   *  quality-rejected capture, which still gets a normal 200/422 response. */
  const handleProcessingError = useCallback(
    (message: string) => {
      setInconclusiveInfo({ reason: 'error', message })
      replace('inconclusive')
    },
    [replace],
  )

  const handleRecapture = useCallback(
    (message: string) => {
      setInconclusiveInfo({ reason: 'quality', message })
      replace('inconclusive')
    },
    [replace],
  )

  const handleOpenFromHistory = useCallback(
    (item: ScanAnalysis) => {
      setAnalysis(item)
      push('result')
    },
    [push],
  )

  const handleDeleteScan = useCallback((id: string) => {
    setHistory(deleteScan(id))
    setAnalysis((current) => (current && current.id === id ? null : current))
  }, [])

  const handleClearHistory = useCallback(() => {
    clearHistory()
    setHistory([])
    setAnalysis(null)
  }, [])

  /** Sends the current screening to the doctor review queue. Prototype-only:
   *  the queue lives in memory, not localStorage — it never leaves this tab
   *  and resets on reload, unlike scan history which is meant to persist. */
  const sendToDoctor = useCallback(
    (patientLabel: string) => {
      if (!analysis) return
      setReports((current) => [
        {
          id: `R-${current.length + 1}-${analysis.id}`,
          patientLabel,
          analysis: { ...analysis },
          patientProfile: patientProfile || undefined,
          submittedAt: new Date().toISOString(),
          status: 'Awaiting Review',
        },
        ...current,
      ])
    },
    [analysis, patientProfile],
  )

  const saveDoctorAdvice = useCallback((reportId: string, doctorAdvice: string, clinicalAssessment: 'Safe' | 'Unsafe') => {
    setReports((current) =>
      current.map((report) =>
        report.id === reportId
          ? { ...report, doctorAdvice, clinicalAssessment, status: 'Reviewed', reviewedAt: new Date().toISOString() }
          : report,
      ),
    )
  }, [])

  /* ---- chrome ----------------------------------------------------------- */

  const immersive = IMMERSIVE_SCREENS.includes(screen)
  const ownsChrome = OWN_CHROME_SCREENS.includes(screen)
  const showChrome = !immersive && !ownsChrome
  const historyCount = history.length

  const navOffset = useMemo(
    () => (showChrome ? 'bottom-[calc(5.6rem+env(safe-area-inset-bottom,0px))] md:bottom-6' : ''),
    [showChrome],
  )

  return (
    <div className="relative flex min-h-dvh w-full flex-col overflow-x-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-110 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {showChrome && (
        <SiteHeader
          onHome={goHome}
          onLearn={goLearn}
          onBlockchain={goBlockchain}
          onHistory={goHistory}
          onScan={handleBeginScan}
          onDoctorPortal={goDoctor}
          active={screen}
          historyCount={historyCount}
          user={user}
          onSignOut={() => auth && signOut(auth)}
        />
      )}

      <main
        id="main-content"
        ref={mainRef}
        className={cn(
          'relative flex flex-1 flex-col',
          showChrome && 'pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))] md:pb-0',
        )}
      >
        <div key={screen} className={cn('flex flex-1 flex-col', !immersive && 'animate-fade-in')}>
          {screen === 'home' && (
            <HomeScreen
              onStart={handleBeginScan}
              onViewHistory={goHistory}
              onLearn={goLearn}
              history={history}
            />
          )}

          {screen === 'learn' && <LearnScreen onBack={() => back('home')} onStart={handleBeginScan} />}

          {screen === 'blockchain' && <BlockchainScreen analysis={analysis} onBack={() => back('home')} />}

          {screen === 'scan' && (
            <ScanScreen onCapture={handleCaptured} onExit={() => back('home')} />
          )}

          {screen === 'processing' && capture && (
            <ProcessingScreen
              capture={capture}
              onDone={handleProcessingDone}
              onError={handleProcessingError}
              onRecapture={handleRecapture}
            />
          )}

          {screen === 'inconclusive' && (
            <InconclusiveScreen
              onRetake={() => replace('scan')}
              onExit={() => back('home')}
              reason={inconclusiveInfo.reason}
              message={inconclusiveInfo.message}
            />
          )}

          {screen === 'result' && analysis && (
            <ResultScreen
              analysis={analysis}
              onViewInsights={() => push('insights')}
              onScanAgain={handleBeginScan}
              onViewHistory={goHistory}
              onViewBlockchain={goBlockchain}
              onSendToDoctor={sendToDoctor}
            />
          )}

          {screen === 'insights' && analysis && (
            <InsightsScreen analysis={analysis} onBack={() => back('result')} />
          )}

          {screen === 'history' && (
            <HistoryScreen
              items={history}
              onBack={() => back('home')}
              onStart={handleBeginScan}
              onOpen={handleOpenFromHistory}
              onDelete={handleDeleteScan}
              onClear={handleClearHistory}
            />
          )}

          {screen === 'doctor' &&
            // Doctor access is deliberately separate from Proof & care. A
            // successful doctor sign-in opens this dashboard only for this
            // visit; entering either workspace never unlocks the other.
            (!authReady ? (
              <div className="min-h-dvh bg-background" />
            ) : doctorAccessGranted ? (
              <DoctorPortal reports={reports} onBack={() => back('home')} onSaveAdvice={saveDoctorAdvice} />
            ) : (
              <AuthScreen
                onBack={() => back('home')}
                onAuthenticated={() => {
                  setDoctorAccessGranted(true)
                  replace('doctor')
                }}
              />
            ))}

          {screen === 'patient-auth' && (
            <PatientAuthScreen onBack={() => back('home')} />
          )}

          {screen === 'patient-profile' && (
            <PatientProfileScreen
              onBack={() => back('home')}
              onComplete={() => {
                // Manually set patient profile so we don't have to wait for onAuthStateChanged refetch
                if (auth?.currentUser) {
                  getDoc(doc(db!, 'patients', auth.currentUser.uid)).then(snap => {
                    if (snap.exists()) setPatientProfile(snap.data() as PatientProfile)
                  })
                }
                replace('scan')
              }}
            />
          )}

          {screen === 'proof-auth' && (
            <ProofAccessScreen
              user={user}
              onBack={() => back('home')}
              onAuthenticated={() => {
                setProofAccessGranted(true)
                replace('blockchain')
              }}
            />
          )}
        </div>
      </main>

      {showChrome && (
        <BottomNav
          active={screen}
          onHome={goHome}
          onScan={handleBeginScan}
          onHistory={goHistory}
          onLearn={goLearn}
          historyCount={historyCount}
        />
      )}

      <ConsentGate onAccept={() => setConsented(true)} />
      <InstallPrompt enabled={consented && showChrome} className={navOffset} />
      <OfflineNotice />

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

/* --------------------------------------------------------------------------
 * OfflineNotice — a heads-up rather than a scary error.
 * A real scan is scored by the backend, so it needs a connection; the notice
 * says so instead of leaving someone to wonder why the shutter never fires.
 * -------------------------------------------------------------------------- */

function OfflineNotice() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  )

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      className="glass fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] left-1/2 z-60 flex -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium text-foreground shadow-lift"
    >
      <CloudOff className="size-3.5 text-moderate" aria-hidden="true" />
      Offline — reconnect to submit a scan
    </div>
  )
}
