import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, CloudUpload, Crosshair, Gauge, Layers, ShieldCheck } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  AuthRequiredError,
  RecaptureRequiredError,
  submitScreening,
  type ScreeningResult,
} from '@/src/lib/api'
import { getConsentHash } from '@/src/lib/consent'
import { getIdToken } from '@/src/lib/firebase'
import { riskLevelForDecision } from '@/src/lib/risk-style'
import type { CapturedImage, Decision, ModelOutput, ScanAnalysis } from '@/src/lib/types'

/**
 * The scan handoff screen.
 *
 * It has exactly one job: send the captured frame to the screening service and
 * wait for the answer. It does not measure anything itself.
 *
 * It used to. This screen decoded the JPEG back into ImageData, ran an
 * on-device colour heuristic over it, and then merged the real backend result
 * on top of that — keeping the heuristic's signal bars, its capture-quality
 * numbers and its illustrative haemoglobin band, and presenting all of it
 * beside the model's decision as though it were one measurement. The heuristic
 * is gone, and with it the five "passes" this screen used to narrate. What is
 * named below is the pipeline the SERVER runs, in the order it runs it.
 */

/** riskCode -> decision, mirroring the backend's own table (app/inference.py). */
const RISK_CODE_DECISIONS: Decision[] = ['lower_risk', 'uncertain', 'higher_risk']

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

/**
 * Build the stored scan from the server's response. Nothing here is computed
 * locally beyond an id, a timestamp and unit conversions.
 *
 * `model_output` is always present from the real provider; the deterministic
 * mock provider (INFERENCE_PROVIDER=mock, used for CI and offline dev) returns
 * only the coded summary. The fallback below therefore fills the block from the
 * coded fields and leaves everything it cannot know EMPTY — never the live
 * model's threshold or version, which would attach a provenance record to a
 * result that was not produced under it.
 */
function toAnalysis(result: ScreeningResult, imageDataUrl: string): ScanAnalysis {
  const decision: Decision =
    result.modelOutput?.decision ?? RISK_CODE_DECISIONS[result.riskCode] ?? 'uncertain'
  const screeningProbability =
    result.modelOutput?.screeningProbability ?? result.probabilityBps / 10000

  const modelOutput: ModelOutput = result.modelOutput ?? {
    decision,
    riskCategory: '',
    screeningProbability,
    probabilityBps: result.probabilityBps,
    selectedModel: '',
    operatingThreshold: 0,
    uncertaintyMargin: 0,
    candidateProbabilities: {},
    candidateThresholds: {},
    modelDisagreement: false,
    nearThreshold: false,
    fusionGateWeights: {},
    modelVersion: '',
  }

  return {
    id: makeId(),
    createdAt: Date.now(),
    imageDataUrl,
    decision,
    riskLevel: riskLevelForDecision(decision),
    screeningProbability,
    // A measured capture-quality score, not a certainty in the result — and no
    // longer the hardcoded 100 every scan used to report.
    captureQuality: Math.round(result.qualityBps / 100),
    modelOutput,
    quality: result.quality ?? undefined,
    roi: result.roi ?? undefined,
    gate: result.gate ?? undefined,
    isSynthetic: result.isSynthetic,
    demoNotice: result.demoNotice || undefined,
    probabilityBps: result.probabilityBps,
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
  icon: typeof CloudUpload
}

/**
 * The server-side pipeline, in order.
 *
 * Each entry names a real step that POST /inference/predict performs on the
 * uploaded frame. The ORDER is exact; the timing is not measured — the browser
 * cannot see how far along a request is, so the list advances on a timer and
 * rests on the last step until the response lands. The footer says so.
 */
const STAGES: Stage[] = [
  {
    id: 'upload',
    label: 'Uploading the frame',
    copy: 'Your photo is sent to the AnemiaScan screening service over an encrypted connection.',
    icon: CloudUpload,
  },
  {
    id: 'roi',
    label: 'Locating the conjunctiva',
    copy: 'The server finds the inner eyelid in the frame and crops to the tissue it will read.',
    icon: Crosshair,
  },
  {
    id: 'gate',
    label: 'Checking the crop is readable',
    copy: 'The crop is compared against the data the model was trained on. Too far outside it and the capture is refused rather than scored.',
    icon: ShieldCheck,
  },
  {
    id: 'encode',
    label: 'Running the model',
    copy: 'Two convolutional encoders read the crop, and a gated fusion head weighs what each of them saw.',
    icon: Layers,
  },
  {
    id: 'calibrate',
    label: 'Calibrating the probability',
    copy: 'The fused output becomes a calibrated screening probability, compared against the operating threshold.',
    icon: Gauge,
  },
]

/* How long each step is left on screen before the narration moves on. This is
 * a pace for the copy, not a measurement of the request. */
const STAGE_MS = 900
const TICK_MS = 80

export function ProcessingScreen({
  capture,
  onDone,
  onRecapture,
  onError,
  onAuthRequired,
}: {
  capture: CapturedImage
  onDone: (analysis: ScanAnalysis) => void
  /** The server refused the capture (HTTP 422): named reasons plus the sentence
   *  it wants shown to the user. */
  onRecapture: (reasons: string[], message: string) => void
  /** The service could not be reached, or failed unexpectedly. */
  onError: (message: string) => void
  /** No valid Firebase ID token — the endpoint is authenticated (HTTP 401). */
  onAuthRequired: (message: string) => void
}) {
  const [stage, setStage] = useState(0)
  const reduceMotion = useReducedMotion()

  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const onRecaptureRef = useRef(onRecapture)
  onRecaptureRef.current = onRecapture
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onAuthRequiredRef = useRef(onAuthRequired)
  onAuthRequiredRef.current = onAuthRequired

  /** When the frame reached this screen, in unix seconds — the form field the
   *  backend expects. Taken once, so a slow request cannot shift it. */
  const capturedAtRef = useRef(Math.floor(Date.now() / 1000))

  /* ---- narration pacing --------------------------------------------------
     Advances to the last step and stops there. It never completes on its own:
     the only thing that ends this screen is the server answering. */
  useEffect(() => {
    const startedAt = Date.now()
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      const next = Math.min(STAGES.length - 1, Math.floor(elapsed / STAGE_MS))
      setStage(next)
      if (next === STAGES.length - 1) window.clearInterval(tick)
    }, TICK_MS)

    return () => window.clearInterval(tick)
  }, [])

  /* ---- the actual work: one authenticated round trip --------------------- */
  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const [consentHash, idToken] = await Promise.all([getConsentHash(), getIdToken()])
        const result = await submitScreening({
          blob: capture.blob,
          consentHash,
          idToken,
          capturedAt: capturedAtRef.current,
        })
        if (cancelled || doneRef.current) return
        doneRef.current = true
        onDoneRef.current(toAnalysis(result, capture.imageDataUrl))
      } catch (error) {
        if (cancelled || doneRef.current) return
        doneRef.current = true

        if (error instanceof AuthRequiredError) {
          onAuthRequiredRef.current(error.message)
          return
        }
        if (error instanceof RecaptureRequiredError) {
          // Hand the named reasons through: the difference between "the room
          // was too dark" and "no eyelid was found in the frame" is the whole
          // of what the next screen has to tell the user.
          onRecaptureRef.current(error.reasons, error.message)
          return
        }
        onErrorRef.current(
          error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        )
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [capture])

  const active = STAGES[stage]

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

          {/* Decorative only. There is deliberately no region-of-interest box
              drawn here any more: the server locates the conjunctiva, and this
              screen has no idea where it landed, so a fixed rectangle would be
              pointing at nothing. */}
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{
              backgroundImage:
                'linear-gradient(color-mix(in oklab, var(--primary) 16%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--primary) 16%, transparent) 1px, transparent 1px)',
              backgroundSize: '14px 14px',
            }}
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
          region would queue faster than any engine drains it, and none of them
          is an action the user has to take. */}
      <p aria-live="polite" className="sr-only">
        Your photo has been sent for screening. Waiting for the result.
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
            <p className="text-lg font-semibold tracking-tight text-white">{active.label}</p>
            <p className="text-balance text-sm leading-relaxed text-white/60">{active.copy}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ------------------------------- progress -----------------------------
          An indeterminate busy indicator: there is a real wait here now (the
          round trip to the screening service), but the browser cannot see how
          far along it is, so the bar carries no aria-valuenow and no
          percentage. It says "still working", which is all it knows. */}
      <div className="flex w-full max-w-sm flex-col gap-2">
        <div
          role="progressbar"
          aria-label="Waiting for the screening service"
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        >
          <div
            className={cn(
              'h-full w-full rounded-full',
              reduceMotion
                ? 'bg-primary/40'
                : 'animate-shimmer bg-gradient-to-r from-transparent via-primary to-transparent',
            )}
            aria-hidden="true"
          />
        </div>
        <div className="flex items-center justify-between font-mono text-2xs tracking-[0.14em] text-white/70 uppercase">
          <span aria-hidden="true">
            step {Math.min(STAGES.length, stage + 1)} of {STAGES.length}
          </span>
          <span aria-hidden="true">Waiting on the server</span>
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
          Those steps are the order the screening service works in, not a measurement of how far
          along it is. Your photo is analysed in memory on the server and is never stored.
        </p>
        <p className="text-2xs leading-relaxed text-white/70">
          Screening only — never a diagnosis.
        </p>
      </div>
    </div>
  )
}
