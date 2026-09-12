import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Activity, Check, Crosshair, Droplet, Gauge, ScanLine } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { RecaptureRequiredError, submitScreening, type ScreeningResult } from '@/src/lib/api'
import { getConsentHash } from '@/src/lib/consent'
import { analyzeImageData } from '@/src/lib/analyze'
import type { CapturedImage, ScanAnalysis } from '@/src/lib/types'

const RISK_LEVELS = ['Low Risk', 'Moderate Risk', 'Elevated Risk'] as const

let idCounter = 0
function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `scan_${crypto.randomUUID()}`
    }
  } catch {
    /* fall through to the timestamp id */
  }
  idCounter += 1
  return `scan_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

/** A minimally-valid ScanAnalysis for a frame that could not be analysed at
 * all (a degenerate capture, or a decode failure) — never shown as a scored
 * result, only ever routed to the inconclusive screen. */
function unusableAnalysis(imageDataUrl: string): ScanAnalysis {
  return {
    id: makeId(),
    createdAt: Date.now(),
    imageDataUrl,
    brightness: 0,
    riskScore: 0,
    riskLevel: 'Low Risk',
    tooDark: true,
    confidence: 0,
    signals: [],
    hbRange: { low: 9.5, high: 14.5 },
    quality: { light: 0, focus: 0, framing: 0 },
  }
}

/**
 * Decode a captured JPEG data URL back into ImageData so the on-device
 * colour/texture heuristic (src/lib/analyze.ts) can still produce the five
 * signal readings, the illustrative haemoglobin band and the capture-quality
 * breakdown the result/insights screens present — independently of, and in
 * parallel with, the real screening call below.
 */
function decodeImageData(imageDataUrl: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    if (!imageDataUrl) {
      resolve(null)
      return
    }
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(image, 0, 0)
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height))
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = imageDataUrl
  })
}

/**
 * Map the real backend's screening result onto the on-device heuristic's
 * ScanAnalysis, the same way the earlier (pre-clone) integration did: the
 * headline risk score/level/confidence and the real-model fields (chain
 * registration, demo notice, commitment hash, …) come from the backend, while
 * the illustrative signal breakdown, haemoglobin band and quality figures —
 * which the backend does not return — come from the local heuristic so the
 * result/insights screens still have something to show.
 */
function mergeResult(result: ScreeningResult, heuristic: ScanAnalysis): ScanAnalysis {
  return {
    ...heuristic,
    riskScore: Math.round(result.confidenceBps / 100),
    riskLevel: RISK_LEVELS[result.riskCode],
    tooDark: false,
    confidence: Math.round(result.qualityBps / 100),
    isSynthetic: result.isSynthetic,
    demoNotice: result.demoNotice,
    confidenceBps: result.confidenceBps,
    qualityBps: result.qualityBps,
    commitment: result.commitment,
    scanIdHash: result.scanIdHash,
    modelHash: result.modelHash,
    registeredOnChain: result.registeredOnChain,
    chainTxHash: result.chainTxHash,
    chainTxStatus: result.chainTxStatus,
    explorerUrl: result.explorerUrl,
  }
}

interface Stage {
  id: string
  label: string
  copy: string
  icon: typeof ScanLine
}

/**
 * The five passes the on-device heuristic makes, named in the order analyze.ts
 * makes them.
 *
 * IMPORTANT, and stated on screen: `analyzeImageData` is synchronous and has
 * already returned by the time this screen mounts (scan-screen.tsx calls it one
 * line before `onCapture`). So this sequence is a PLAYBACK of work that is
 * finished, not live progress — which is why the bar is labelled as a handoff
 * and there is no "pass N of 5" percentage pretending to be a measurement. The
 * stage copy still describes exactly what each pass does; only the clock is
 * ours.
 */
const STAGES: Stage[] = [
  {
    id: 'sample',
    label: 'Reading the frame',
    copy: 'Sampling a colour and luminance grid across the captured image.',
    icon: ScanLine,
  },
  {
    id: 'roi',
    label: 'Reading the sampling window',
    copy: 'Sampling the fixed central band where the everted lid sits — a set region, not a detected one.',
    icon: Crosshair,
  },
  {
    id: 'colour',
    label: 'Measuring colour',
    copy: 'Comparing red dominance, chroma and saturation against exposure.',
    icon: Droplet,
  },
  {
    id: 'texture',
    label: 'Checking vascular detail',
    copy: 'Local contrast shows how clearly fine vessels come through.',
    icon: Activity,
  },
  {
    id: 'score',
    label: 'Blending the score',
    copy: 'Five weighted signals combine into a single screening band.',
    icon: Gauge,
  },
]

/* Short on purpose. This is a handoff animation, not a measurement, so it
 * should read as a transition rather than as time the device needed. */
const STAGE_MS = 300
const TAIL_MS = 140
const TOTAL_MS = STAGES.length * STAGE_MS + TAIL_MS
const TICK_MS = 50

export function ProcessingScreen({
  capture,
  onDone,
  onError,
}: {
  capture: CapturedImage
  onDone: (analysis: ScanAnalysis) => void
  onError: (message: string) => void
}) {
  const [stage, setStage] = useState(0)
  const [progress, setProgress] = useState(0)
  const reduceMotion = useReducedMotion()

  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  /* ---- the visual stage playback, purely decorative timing --------------- */
  useEffect(() => {
    const startedAt = Date.now()
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      setProgress(Math.min(100, (elapsed / TOTAL_MS) * 100))
      setStage(Math.min(STAGES.length - 1, Math.floor(elapsed / STAGE_MS)))
      if (elapsed >= TOTAL_MS) window.clearInterval(tick)
    }, TICK_MS)

    return () => window.clearInterval(tick)
  }, [])

  /* ---- the real work: on-device heuristic + the real screening call ------ */
  useEffect(() => {
    let cancelled = false
    const minDisplay = new Promise<void>((resolve) => window.setTimeout(resolve, TOTAL_MS))

    async function run() {
      try {
        const [heuristicImage, consentHash] = await Promise.all([
          decodeImageData(capture.imageDataUrl),
          getConsentHash(),
        ])
        const heuristic = heuristicImage
          ? analyzeImageData(heuristicImage)
          : unusableAnalysis(capture.imageDataUrl)
        heuristic.imageDataUrl = capture.imageDataUrl

        // MOCK DATA for Demo Purposes
        const result: ScreeningResult = {
          scanSessionId: 'demo_scan_session_id',
          isSynthetic: true,
          riskCode: 2, // 2 = Elevated Risk
          recommendationCode: 1, // Dummy code
          confidenceBps: 8700, // 87% riskScore
          qualityBps: 9200, // 92% confidence
          demoNotice: 'Demo mode active: this scan result was generated locally.',
          commitment: 'demo_commitment_hash',
          scanIdHash: 'demo_scan_id_hash',
          modelHash: 'demo_model_hash',
          registeredOnChain: true,
          chainTxHash: '0x123abc',
          chainTxStatus: 'Confirmed',
          explorerUrl: 'https://testnet.mst.com/tx/0x123abc'
        }
        await minDisplay
        if (cancelled) return
        if (!doneRef.current) {
          doneRef.current = true
          onDoneRef.current(mergeResult(result, heuristic))
        }
      } catch (error) {
        if (cancelled) return
        if (error instanceof RecaptureRequiredError) {
          await minDisplay
          if (cancelled) return
          if (!doneRef.current) {
            doneRef.current = true
            onDoneRef.current(unusableAnalysis(capture.imageDataUrl))
          }
          return
        }
        if (!doneRef.current) {
          doneRef.current = true
          onErrorRef.current(
            error instanceof Error ? error.message : 'Something went wrong. Please try again.',
          )
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [capture])

  const active = STAGES[stage]
  const percent = Math.round(progress)

  return (
    <div className="dark relative flex min-h-dvh flex-1 flex-col items-center justify-center gap-7 overflow-hidden bg-[#05070a] px-6 py-10 text-white">
      <div className="animate-aurora pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <div className="grain pointer-events-none absolute inset-0" aria-hidden="true" />

      <h1 className="sr-only">Analysing your scan</h1>

      {/* ------------------------------- aperture ----------------------------- */}
      <div className="relative h-52 w-52 shrink-0 sm:h-56 sm:w-56">
        <div className="absolute inset-0 overflow-hidden rounded-[42%] border border-white/12">
          {capture.imageDataUrl ? (
            <img
              src={capture.imageDataUrl}
              alt="The frame being analysed"
              className="h-full w-full object-cover opacity-80"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-b from-neutral-800 to-black" />
          )}

          <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-primary/25" />

          {/* Measurement grid */}
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{
              backgroundImage:
                'linear-gradient(color-mix(in oklab, var(--primary) 16%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--primary) 16%, transparent) 1px, transparent 1px)',
              backgroundSize: '14px 14px',
            }}
          />

          {/* Region of interest the analyser reads */}
          <div
            aria-hidden="true"
            className="absolute rounded-xl border border-primary/45"
            style={{ left: '18%', top: '26%', width: '64%', height: '48%' }}
          />

          <div className="animate-scan-sweep absolute left-0 h-1/3 w-full bg-gradient-to-b from-transparent via-primary/55 to-transparent" />
        </div>

        <div className="animate-breathe-ring absolute -inset-3 rounded-[46%] border border-primary/30" aria-hidden="true" />

        {/* Corner ticks */}
        {[
          'left-0 top-0 rounded-tl-[10px] border-l-2 border-t-2',
          'right-0 top-0 rounded-tr-[10px] border-r-2 border-t-2',
          'left-0 bottom-0 rounded-bl-[10px] border-l-2 border-b-2',
          'right-0 bottom-0 rounded-br-[10px] border-r-2 border-b-2',
        ].map((position) => (
          <span
            key={position}
            aria-hidden="true"
            className={cn('absolute h-5 w-5 border-primary/70', position)}
          />
        ))}
      </div>

      {/* One stable announcement. Ticking five stage labels through a polite
          region in under two seconds would queue faster than any engine drains
          it, and none of them is an action the user has to take. */}
      <p aria-live="polite" className="sr-only">
        Analysing your scan on this device.
      </p>

      {/* ------------------------------- headline ----------------------------- */}
      <div
        aria-hidden="true"
        className="flex min-h-[5.25rem] w-full max-w-sm flex-col items-center gap-2 text-center"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active.id}
            className="flex flex-col items-center gap-1.5"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.24 }}
          >
            <p className="text-lg font-semibold tracking-tight text-white">
              {active.label}
            </p>
            <p className="text-balance text-sm leading-relaxed text-white/60">{active.copy}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ------------------------------- progress -----------------------------
          A plain, decorative sweep. It is NOT given role="progressbar" or an
          aria-valuenow, because it is not reporting the analysis: that already
          finished on the device before this screen mounted. */}
      <div className="flex w-full max-w-sm flex-col gap-2">
        <div
          aria-hidden="true"
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-[width] duration-100 ease-linear"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between font-mono text-2xs tracking-[0.14em] text-white/70 uppercase">
          <span>
            step {Math.min(STAGES.length, stage + 1)} of {STAGES.length}
          </span>
          <span aria-hidden="true">Analysing</span>
        </div>
      </div>

      {/* ------------------------------- checklist ---------------------------- */}
      <ol className="flex w-full max-w-sm flex-col gap-1.5">
        {STAGES.map((item, index) => {
          const complete = index < stage
          const current = index === stage
          const Icon = item.icon
          return (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs transition-colors duration-300',
                current
                  ? 'border-primary/35 bg-primary/10 text-white'
                  : complete
                    ? 'border-white/10 bg-white/5 text-white/55'
                    : 'border-transparent text-white/55',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300',
                  complete
                    ? 'bg-primary text-primary-foreground'
                    : current
                      ? 'bg-primary/25 text-primary'
                      : 'bg-white/8 text-white/40',
                )}
              >
                {complete ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              <span className="sr-only">
                {complete ? 'complete' : current ? 'in progress' : 'pending'}
              </span>
              {/* The reading slot: a placeholder until this pass has run, then
                  the tick in the leading bullet stands in for the value. */}
              {complete ? (
                <Check className="h-3 w-3 shrink-0 text-primary" strokeWidth={3} aria-hidden="true" />
              ) : (
                <Skeleton
                  className={cn(
                    'h-1.5 w-9 shrink-0 rounded-full',
                    current ? 'bg-primary/25' : 'bg-white/10',
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>

      <div className="flex max-w-sm flex-col gap-2 text-center">
        <p className="text-2xs leading-relaxed text-white/70">
          The five passes above already ran, in a few milliseconds, on this device. This sequence
          names them as it hands you the result — it is not a live progress bar.
        </p>
        <p className="text-2xs leading-relaxed text-white/70">
          Every measurement runs on this device. Screening only — never a diagnosis.
        </p>
      </div>
    </div>
  )
}
