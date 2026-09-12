import { motion, useReducedMotion } from 'motion/react'
import { BrainCircuit, Check, Circle, FlaskConical, LoaderCircle, ScanLine } from 'lucide-react'
import { analyzeAnemiaImage, type AnemiaAnalysisResult } from '@/src/lib/api'
import type { CapturedImage, RiskLevel, ScanAnalysis } from '@/src/lib/types'
import { useEffect } from 'react'

const requestByBlob = new WeakMap<Blob, Promise<AnemiaAnalysisResult>>()

function analyzeOnce(blob: Blob): Promise<AnemiaAnalysisResult> {
  const existing = requestByBlob.get(blob)
  if (existing) return existing
  const request = analyzeAnemiaImage(blob)
  requestByBlob.set(blob, request)
  return request
}

function riskLevel(decision: AnemiaAnalysisResult['decision']): RiskLevel {
  if (decision === 'higher_risk') return 'Elevated Risk'
  if (decision === 'lower_risk') return 'Low Risk'
  return 'Moderate Risk'
}

function makeId(): string {
  try {
    return `scan_${crypto.randomUUID()}`
  } catch {
    return `scan_${Date.now().toString(36)}`
  }
}

function toAnalysis(result: AnemiaAnalysisResult, capture: CapturedImage): ScanAnalysis {
  if (result.screeningProbability === null || result.decision === 'recapture_required') {
    throw new Error('No screening score was generated for this capture.')
  }
  return {
    id: makeId(),
    createdAt: Date.now(),
    imageDataUrl: capture.imageDataUrl,
    brightness: result.quality.brightness,
    riskScore: Math.round(result.screeningProbability * 100),
    riskLevel: riskLevel(result.decision),
    tooDark: false,
    // Retained only for compatibility with older locally stored scans. V4 does
    // not expose a separate diagnostic-confidence value.
    confidence: 0,
    signals: [],
    hbRange: { low: 0, high: 0 },
    quality: { light: 0, focus: 0, framing: 0 },
    isSynthetic: false,
    demoNotice: result.warning,
    modelHash: result.modelHash,
    decision: result.decision,
    screeningProbability: result.screeningProbability,
    operatingThreshold: result.operatingThreshold,
    uncertain: result.uncertain,
    modelVersion: result.modelVersion,
    modelQuality: result.quality,
    internalBenchmark: result.benchmark,
    warning: result.warning,
  }
}

const QUALITY_MESSAGES: Record<string, string> = {
  roi_too_small: 'Move closer so the exposed inner lower eyelid fills the guide.',
  extremely_dark: 'Use brighter, even light and avoid shadows over the eyelid.',
  extremely_bright: 'Reduce direct light or glare on the eyelid.',
  severely_clipped: 'Avoid deep shadow and blown highlights, then retake the image.',
}

const STAGES = [
  { icon: Check, label: 'Secure PNG/JPEG decoding and image-quality gate' },
  { icon: ScanLine, label: 'EfficientNet-B3, ConvNeXt-Tiny and ViT-B/16 logits' },
  { icon: BrainCircuit, label: '32 standardized colour and texture features' },
  { icon: FlaskConical, label: 'Calibrated logistic-stacker screening score' },
] as const

export function ProcessingScreen({
  capture,
  onDone,
  onError,
  onRecapture,
}: {
  capture: CapturedImage
  onDone: (analysis: ScanAnalysis) => void
  onError: (message: string) => void
  onRecapture: (message: string) => void
}) {
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    let active = true
    void analyzeOnce(capture.blob)
      .then((result) => {
        if (!active) return
        if (result.decision === 'recapture_required' || !result.quality.accepted) {
          const instructions = result.quality.failures
            .map((failure) => QUALITY_MESSAGES[failure] ?? failure.replace(/_/g, ' '))
            .join(' ')
          onRecapture(instructions || 'Please retake a clear, tightly framed conjunctiva ROI.')
          return
        }
        onDone(toAnalysis(result, capture))
      })
      .catch((error: unknown) => {
        if (!active) return
        onError(error instanceof Error ? error.message : 'The V4 screening service failed. No result was generated.')
      })
    return () => {
      active = false
    }
  }, [capture, onDone, onError, onRecapture])

  return (
    <div className="dark relative flex min-h-dvh flex-1 flex-col items-center justify-center gap-8 overflow-hidden bg-[#05070a] px-6 py-10 text-white">
      <div className="animate-aurora pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
      <div className="grain pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative h-52 w-52 shrink-0 sm:h-56 sm:w-56">
        <div className="absolute inset-0 overflow-hidden rounded-[42%] border border-white/12">
          <img src={capture.imageDataUrl} alt="Guided conjunctiva ROI being screened" className="h-full w-full object-cover opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-primary/25" />
          <motion.div
            aria-hidden="true"
            className="absolute left-0 h-1/3 w-full bg-gradient-to-b from-transparent via-primary/55 to-transparent"
            animate={reduceMotion ? undefined : { y: ['-100%', '400%'] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
          />
        </div>
        <div className="animate-breathe-ring absolute -inset-3 rounded-[46%] border border-primary/30" aria-hidden="true" />
      </div>

      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          <h1 className="text-lg font-semibold tracking-tight">Running AnemiaScan V4</h1>
        </div>
        <p className="text-sm leading-relaxed text-white/60">
          The captured ROI is being screened by the server-side calibrated model. This page remains active until that request finishes.
        </p>
      </div>

      <ol className="flex w-full max-w-md flex-col gap-2" aria-label="V4 inference pipeline">
        {STAGES.map(({ icon: Icon, label }, index) => (
          <li key={label} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/70">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              {index === 0 ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-2.5 w-2.5 fill-current" aria-hidden="true" />}
            </span>
            {label}
          </li>
        ))}
      </ol>

      <p className="max-w-md text-center text-xs leading-relaxed text-white/55">
        Screening support only—not diagnostic certainty. Confirm concerns with a CBC or haemoglobin test and professional evaluation.
      </p>
    </div>
  )
}
