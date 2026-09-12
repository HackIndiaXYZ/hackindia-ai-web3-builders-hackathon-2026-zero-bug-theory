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
 *   the transition into a result — never on render, and never for a capture the
 *   screening service refused.
 *
 *   One owner for the doctor queue. `reports` is in-memory only — sending a
 *   screening to a clinician is a prototype workflow, not a persisted one, so
 *   it deliberately does not survive a reload the way scan history does.
 *
 *   Auth around the whole capture flow. Scanning is not a local computation:
 *   the photo is uploaded, and POST /inference/predict refuses a request with
 *   no Firebase ID token. The gate below therefore covers the camera and the
 *   processing handoff as well as the doctor portal — the app used to gate only
 *   the portal, which meant the scan flow walked someone through a camera, a
 *   capture and a consent notice before the server turned them away with a 401.
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

/** Screens that take over the viewport: no header, no tab bar, no page chrome. */
const IMMERSIVE_SCREENS: ScreenId[] = ['scan', 'processing']

/** Screens that render their own full-bleed header instead of the app chrome. */
const OWN_CHROME_SCREENS: ScreenId[] = ['doctor']

/** Screens that need a freshly captured frame to render anything at all. */
const CAPTURE_SCREENS: ScreenId[] = ['processing']

/** Screens that need an active analysis to render anything at all. */
const ANALYSIS_SCREENS: ScreenId[] = ['result', 'insights']

/**
 * Screens that need a signed-in user.
 *
 * The scan flow is on this list because the screening endpoint is
 * authenticated: the frame is uploaded and scored on the server, and a request
 * without a valid ID token gets a 401 and no result. Asking up front is the
 * honest order — the consent notice already tells people an account is
 * required.
 */
const AUTHENTICATED_SCREENS: ScreenId[] = ['scan', 'processing', 'doctor']

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
]

/** Only these are safe to land on from a cold URL — the rest need session state. */
const DEEP_LINKABLE: ScreenId[] = ['home', 'learn', 'history', 'blockchain']

/** Announced in the live region, and used as the document title suffix. */
const SCREEN_TITLES: Record<ScreenId, string> = {
  home: 'Home',
  scan: 'Camera',
  processing: 'Analysing your scan',
  result: 'Your screening result',
  insights: 'Result details',
  inconclusive: 'Scan inconclusive',
  history: 'Scan history',
  learn: 'Learn about anaemia',
  blockchain: 'Proof and care',
  doctor: 'Doctor portal',
  'patient-auth': 'Patient sign in',
  'patient-profile': 'Patient Profile',
}

interface ShellHistoryState {
  screen?: string
  depth?: number
}

/** Why the inconclusive screen is showing, and everything the server said. */
interface InconclusiveInfo {
  /** 'quality' — the capture was refused. 'error' — the service failed. */
  reason: 'quality' | 'error'
  /** The sentence to show. From the server on a refusal. */
  message?: string
  /** Machine-readable refusal codes, so the screen can be specific. */
  reasons?: string[]
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
  const [inconclusiveInfo, setInconclusiveInfo] = useState<InconclusiveInfo>({ reason: 'quality' })
  const [history, setHistory] = useState<ScanAnalysis[]>(() => loadHistory())
  const [reports, setReports] = useState<DoctorReport[]>([])
  const [consented, setConsented] = useState<boolean>(() => hasAcknowledged())
  const [announcement, setAnnouncement] = useState('')

  /* ---- Firebase auth gate ------------------------------------------------ */
  const [user, setUser] = useState<User | null>(null)
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null | undefined>(undefined)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)
  /** Set when the screening service itself rejected the session mid-flow, so
   *  the sign-in screen can say why it appeared instead of looking like a bug. */
  const [authNotice, setAuthNotice] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
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
      if (nextUser) setAuthNotice(undefined)
    })
  }, [])

  /** A gated screen with nobody signed in renders the sign-in card instead.
   *  While Firebase is still resolving we render neither, rather than flashing
   *  a login at someone who is already signed in. */
  const needsAuth = AUTHENTICATED_SCREENS.includes(screen) && authReady && !user

  /* The sign-in card is an ordinary page: it keeps the header and tab bar even
     on screens that are otherwise immersive or carry their own chrome. */
  const immersive = IMMERSIVE_SCREENS.includes(screen) && !needsAuth
  const ownsChrome = OWN_CHROME_SCREENS.includes(screen) && !needsAuth
  const showChrome = !immersive && !ownsChrome

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
    // A gated screen showing the sign-in card is announced as sign-in, not as
    // the camera it is standing in for.
    const title = needsAuth ? 'Sign in' : SCREEN_TITLES[screen]
    setAnnouncement(title)
    document.title = screen === 'home' ? 'AnemiaScan' : `${title} · AnemiaScan`

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
    // left alone: it is a handoff that unmounts itself the moment the screening
    // service answers, and the screen that replaces it takes focus normally.
    // `immersive` (not the raw list) is the condition, so the sign-in card that
    // can stand in for either of them still gets focus.
    if (immersive) return

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
  }, [screen, immersive, needsAuth])

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
  const goBlockchain = useCallback(() => push('blockchain'), [push])
  const goDoctor = useCallback(() => push('doctor'), [push])

  const handleCaptured = useCallback(
    (next: CapturedImage) => {
      setCapture(next)
      // Replace, not push: the camera should never be behind a finished result.
      replace('processing')
    },
    [replace],
  )

  /** The screening service accepted the capture and returned a result.
   *  Everything in `result` came back from the server — see
   *  src/screens/processing-screen.tsx, which no longer computes anything. */
  const handleProcessingDone = useCallback(
    (result: ScanAnalysis) => {
      setAnalysis(result)
      setHistory(saveScan(result))
      replace('result')
    },
    [replace],
  )

  /** The server refused the capture (HTTP 422). It names why, in codes and in a
   *  sentence; both go through to the inconclusive screen, which is the only
   *  way someone can tell a dark room from a photo of a wall. Nothing is saved
   *  to history: a refused capture produced no result to save. */
  const handleProcessingRecapture = useCallback(
    (reasons: string[], message: string) => {
      setInconclusiveInfo({ reason: 'quality', message, reasons })
      replace('inconclusive')
    },
    [replace],
  )

  /** The screening service could not be reached at all (network failure, the
   *  backend being down, or an unexpected server error) — distinct from a
   *  refused capture, which comes back as a normal 422 with reasons. */
  const handleProcessingError = useCallback(
    (message: string) => {
      setInconclusiveInfo({ reason: 'error', message })
      replace('inconclusive')
    },
    [replace],
  )

  /** The screening endpoint rejected the session (HTTP 401/403). Sign out and
   *  send the user back through the camera entrance, which now shows sign-in:
   *  a token the server will not accept is not a session we should pretend to
   *  still hold. */
  const handleAuthRequired = useCallback(
    (message: string) => {
      setAuthNotice(message)
      setCapture(null)
      if (auth) void signOut(auth)
      replace('scan')
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
          submittedAt: new Date().toISOString(),
          status: 'Awaiting Review',
        },
        ...current,
      ])
    },
    [analysis],
  )

  const saveDoctorAdvice = useCallback((reportId: string, doctorAdvice: string) => {
    setReports((current) =>
      current.map((report) =>
        report.id === reportId
          ? { ...report, doctorAdvice, status: 'Reviewed', reviewedAt: new Date().toISOString() }
          : report,
      ),
    )
  }, [])

  /* ---- chrome ----------------------------------------------------------- */

  const historyCount = history.length

  const navOffset = useMemo(
    () => (showChrome ? 'bottom-[calc(5.6rem+env(safe-area-inset-bottom,0px))] md:bottom-6' : ''),
    [showChrome],
  )

  /** Firebase has not reported yet: hold the frame rather than flash a login. */
  const authPending = AUTHENTICATED_SCREENS.includes(screen) && !authReady

  return (
    <div className="relative flex min-h-dvh w-full flex-col overflow-x-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[110] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
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
          {authPending && <div className="min-h-dvh bg-background" />}

          {/* One sign-in card for every gated screen. The scan flow is gated
              because the screening endpoint is authenticated; the doctor portal
              because the queue is clinical. */}
          {needsAuth && (
            <AuthScreen
              purpose={screen === 'doctor' ? 'doctor' : 'scan'}
              notice={authNotice}
              onBack={() => back('home')}
            />
          )}

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

          {screen === 'scan' && !needsAuth && !authPending && (
            <ScanScreen onCapture={handleCaptured} onExit={() => back('home')} />
          )}

          {screen === 'processing' && capture && !needsAuth && !authPending && (
            <ProcessingScreen
              capture={capture}
              onDone={handleProcessingDone}
              onRecapture={handleProcessingRecapture}
              onError={handleProcessingError}
              onAuthRequired={handleAuthRequired}
            />
          )}

          {screen === 'inconclusive' && (
            <InconclusiveScreen
              onRetake={() => replace('scan')}
              onExit={() => back('home')}
              reason={inconclusiveInfo.reason}
              reasons={inconclusiveInfo.reasons}
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

          {screen === 'doctor' && !needsAuth && !authPending && (
            <DoctorPortal
              reports={reports}
              onBack={() => back('home')}
              onSaveAdvice={saveDoctorAdvice}
            />
          )}

          {screen === 'patient-auth' && (
            <PatientAuthScreen onBack={() => back('home')} />
          )}

          {screen === 'patient-profile' && (
            <PatientProfileScreen
              onBack={() => back('home')}
              onComplete={() => {
                // Manually set patient profile so we don't have to wait for onAuthStateChanged refetch
                if (auth?.currentUser && db) {
                  getDoc(doc(db, 'patients', auth.currentUser.uid)).then((snap) => {
                    if (snap.exists()) setPatientProfile(snap.data() as PatientProfile)
                  })
                }
                replace('scan')
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
      className="glass fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium text-foreground shadow-lift"
    >
      <CloudOff className="size-3.5 text-moderate" aria-hidden="true" />
      Offline — reconnect to submit a scan
    </div>
  )
}
