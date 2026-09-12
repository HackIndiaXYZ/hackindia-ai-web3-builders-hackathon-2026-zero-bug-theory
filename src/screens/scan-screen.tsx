import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  CameraOff,
  CircleQuestionMark,
  Flashlight,
  FlashlightOff,
  ImageUp,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sun,
  SwitchCamera,
  Timer,
  TimerOff,
  X,
} from 'lucide-react'
import { EYE_GUIDE_APERTURE_RATIO, EyeGuide } from '@/src/components/eye-guide'
import { ScanSignals, type ScanSignal } from '@/src/components/scan-signals'
import { clamp } from '@/src/lib/format'
import type { CapturedImage } from '@/src/lib/types'
import { cn } from '@/lib/utils'

interface ScanScreenProps {
  onCapture: (capture: CapturedImage) => void
  onExit: () => void
}

type Mode = 'loading' | 'camera' | 'denied' | 'fallback'
type Facing = 'user' | 'environment'

// `image/*` alone is enough in most browsers, but some platforms don't tag
// HEIC/HEIF files with an image/* MIME type in the file picker, so the
// extensions are listed explicitly too. Actual decoding of anything the
// <img> element can't read natively (HEIC/HEIF) is handled in
// handleFileChange below via heic2any.
const UPLOAD_ACCEPT = 'image/*,.heic,.heif,.avif,.tif,.tiff,.bmp,.gif,.webp,.png,.jpg,.jpeg'

interface Checks {
  light: boolean
  position: boolean
  clarity: boolean
  steady: boolean
}

interface Metrics {
  /** Mean frame brightness, 0..255. */
  lum: number
  /** Centre-vs-surround luminance contrast, as a 0..100 percentage of target. */
  framing: number
  /** Local luminance-gradient energy, as a 0..100 percentage of target. */
  detail: number
  /** Frame-to-frame stability, 0..100. */
  steady: number
}

/** Sampling grid. Kept at 24x24 — the same cheap downscale the capture loop
 * has always used for brightness — and now also differenced for framing,
 * clarity and steadiness so no capture check is ever a blind timer. */
const SAMPLE = 24
const SAMPLE_INTERVAL = 300
/** Grace period before any check may flip green, so the UI cannot flicker
 * while auto-exposure is still settling. */
const WARMUP_MS = 900
/** Exponential smoothing applied to every reading. */
const SMOOTHING = 0.35
const COUNTDOWN_FROM = 3
const COUNTDOWN_STEP = 900
const SHUTTER_DELAY = 260

/** Longest edge of the canvas handed to the analyser.
 *
 * analyze.ts only ever samples a 96x96 grid plus a 72x72 focus patch, so a full
 * 12 MP gallery photo buys nothing and costs a ~36 MB `getImageData`
 * allocation that mid-range phones genuinely fail. Capping here also keeps the
 * JPEG data URL small enough for the localStorage quota in history.ts. */
const ANALYSIS_MAX_EDGE = 1024

/** Targets each raw reading is normalised against for the live readout. */
const FRAMING_TARGET = 0.12
const DETAIL_TARGET = 0.07

const INITIAL_CHECKS: Checks = { light: false, position: false, clarity: false, steady: false }
const INITIAL_METRICS: Metrics = { lum: 0, framing: 0, detail: 0, steady: 0 }

/** 44px, not 40: this is the one screen held at arm's length, one-handed,
 * against your own eye. There is room for it — three controls plus gaps still
 * leave ~180px of slack on a 390px viewport. */
const OVERLAY_BUTTON =
  'flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/85 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50'

const PILL_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-60'

/** Feature-detected haptics. Silently does nothing where unsupported. */
function buzz(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    /* Some browsers refuse without a user gesture. Never block capture on it. */
  }
}

const HELP_STEPS = [
  {
    title: 'Find flat, even light',
    body: 'Face a window or a lamp so the light lands on your face. Avoid a direct beam or a bright source behind you.',
  },
  {
    title: 'Pull the lower eyelid down',
    body: 'Look up. With a clean fingertip, gently pull the skin just under your lower lashes downwards until the moist inner rim is showing.',
  },
  {
    title: 'Fill the dashed box',
    body: 'Hold the phone roughly 15–20 cm away and centre that inner rim inside the dashed rectangle — that is the exact area the analyser reads.',
  },
  {
    title: 'Hold still',
    body: 'When all four checks turn green the shutter releases itself. You can always tap the shutter yourself instead.',
  },
] as const

/** A square region in a source image's own pixel coordinates. */
interface SourceSquare {
  sx: number
  sy: number
  size: number
}

/**
 * Project the reticle's aperture back into the video's own pixel space.
 *
 * The preview is `object-cover`, so the stream is scaled up until it covers the
 * element and then centred — most of a 16:9 stream's width is off-screen on a
 * phone. Cropping the centre square of the RAW frame therefore measures pixels
 * the user never saw (cheek, brow, background), which directly biases the
 * pallor, redness and saturation averages. This inverts that mapping so the
 * captured canvas IS the contents of the dashed box, which is what
 * EyeGuide promises and what analyze.ts's ROI then lines up with.
 *
 * Returns null when the geometry is not measurable yet; the caller falls back
 * to the centre square.
 */
function apertureSourceSquare(
  video: HTMLVideoElement,
  guide: HTMLElement | null,
  mirrored: boolean,
): SourceSquare | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!guide || !vw || !vh) return null

  const el = video.getBoundingClientRect()
  const box = guide.getBoundingClientRect()
  if (el.width <= 0 || el.height <= 0 || box.width <= 0 || box.height <= 0) return null

  const scale = Math.max(el.width / vw, el.height / vh)
  if (!Number.isFinite(scale) || scale <= 0) return null

  const drawnW = vw * scale
  const drawnH = vh * scale
  const originX = el.left + (el.width - drawnW) / 2
  const originY = el.top + (el.height - drawnH) / 2

  // EyeGuide draws its aperture (and the dashed ROI inside it) as a centred
  // square of the guide box — see EYE_GUIDE_APERTURE_RATIO.
  const side = Math.min(box.width, box.height) * EYE_GUIDE_APERTURE_RATIO
  const screenLeft = box.left + box.width / 2 - side / 2
  const screenTop = box.top + box.height / 2 - side / 2

  const sizeInSource = side / scale
  if (!Number.isFinite(sizeInSource) || sizeInSource < 8) return null

  const unmirroredX = (screenLeft - originX) / scale
  // A mirrored preview reflects about the element centre, which maps to
  // `vw - x` in source space once the centred object-cover offset is undone.
  const rawX = mirrored ? vw - unmirroredX - sizeInSource : unmirroredX
  const rawY = (screenTop - originY) / scale

  const size = Math.min(sizeInSource, vw, vh)
  return {
    sx: clamp(rawX, 0, vw - size),
    sy: clamp(rawY, 0, vh - size),
    size,
  }
}

/** The centred square of a source, used when the reticle cannot be measured. */
function centreSquare(width: number, height: number): SourceSquare | null {
  const size = Math.min(width, height)
  if (!Number.isFinite(size) || size < 8) return null
  return { sx: (width - size) / 2, sy: (height - size) / 2, size }
}

/**
 * Draw one square source region into `canvas` at analysis resolution.
 *
 * Capping the output edge is what removes the allocation cliff: a 4032x3024
 * gallery photo would otherwise make `getImageData` allocate ~36MB and
 * `toDataURL` run over 12 megapixels, for a heuristic that only ever samples a
 * 96x96 grid. `mirrored` un-flips the front camera so the saved photo reads the
 * same way round as the preview the user framed in.
 */
function drawAnalysisSquare(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  region: SourceSquare,
  mirrored: boolean,
): boolean {
  const out = Math.max(8, Math.round(Math.min(region.size, ANALYSIS_MAX_EDGE)))
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.save()
  if (mirrored) {
    ctx.translate(out, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(source, region.sx, region.sy, region.size, region.size, 0, 0, out, out)
  ctx.restore()
  return true
}

export function ScanScreen({ onCapture, onExit }: ScanScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const helpTriggerRef = useRef<HTMLButtonElement>(null)
  const helpCloseRef = useRef<HTMLButtonElement>(null)
  const helpSheetRef = useRef<HTMLDivElement>(null)

  const guideRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const captureTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const finishedRef = useRef(false)
  const capturingRef = useRef(false)

  const reduceMotion = useReducedMotion()

  const [mode, setMode] = useState<Mode>('loading')
  const [facing, setFacing] = useState<Facing>('user')
  const [attempt, setAttempt] = useState(0)
  const [canFlip, setCanFlip] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [videoLive, setVideoLive] = useState(false)
  const [warm, setWarm] = useState(false)

  const [checks, setChecks] = useState<Checks>(INITIAL_CHECKS)
  const [metrics, setMetrics] = useState<Metrics>(INITIAL_METRICS)

  const [capturing, setCapturing] = useState(false)
  const [flash, setFlash] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [autoCapture, setAutoCapture] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const ready = checks.light && checks.position && checks.clarity && checks.steady

  /* ----------------------------------------------------------------------- */
  /* Camera lifecycle + live frame measurement                                */
  /* ----------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false
    /* Every timer id lands here the moment it is created, and the cleanup
     * drains the array. Plain closure locals are not enough: the cleanup can run
     * while `play()` is still pending, read `undefined`, and then have the
     * continuation assign an id it will never see again — a 300ms interval
     * leaking for the rest of the session on every abandoned visit. */
    const timers: number[] = []
    let localStream: MediaStream | null = null

    const startedAt = Date.now()
    /** Smoothed readings, kept out of state so the interval never re-renders
     * more than once per tick. */
    const ema = { light: 0, contrast: 0, detail: 0, steady: 0, seeded: false }
    let previous: Float32Array | null = null

    setMode('loading')
    setVideoLive(false)
    setWarm(false)
    setChecks(INITIAL_CHECKS)
    setMetrics(INITIAL_METRICS)
    setTorchSupported(false)
    setTorchOn(false)

    function measure(ctx: CanvasRenderingContext2D) {
      const video = videoRef.current
      if (!video || video.readyState < 2) return

      ctx.drawImage(video, 0, 0, SAMPLE, SAMPLE)
      const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)

      const lum = new Float32Array(SAMPLE * SAMPLE)
      let sum = 0
      for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        const value = (data[i] + data[i + 1] + data[i + 2]) / 3
        lum[p] = value
        sum += value
      }
      const avg = sum / (SAMPLE * SAMPLE)

      // Framing: how much the centre of the frame differs from its surround.
      // A filled, everted eyelid held in the reticle always separates from the
      // skin and shadow around it; an empty wall or a ceiling does not.
      let inner = 0
      let innerCount = 0
      let outer = 0
      let outerCount = 0
      for (let y = 0; y < SAMPLE; y += 1) {
        for (let x = 0; x < SAMPLE; x += 1) {
          const value = lum[y * SAMPLE + x]
          const isCentre = x >= 7 && x <= 16 && y >= 7 && y <= 16
          if (isCentre) {
            inner += value
            innerCount += 1
          } else {
            outer += value
            outerCount += 1
          }
        }
      }
      const innerMean = innerCount ? inner / innerCount : 0
      const outerMean = outerCount ? outer / outerCount : 0
      const contrast =
        Math.abs(innerMean - outerMean) / Math.max(24, (innerMean + outerMean) / 2)

      // Clarity: mean absolute luminance gradient across the centre band,
      // normalised by its own exposure so a dim frame is not read as blurry.
      let gradient = 0
      let gradientCount = 0
      for (let y = 5; y < SAMPLE - 5; y += 1) {
        for (let x = 5; x < SAMPLE - 5; x += 1) {
          const value = lum[y * SAMPLE + x]
          gradient += Math.abs(value - lum[y * SAMPLE + x + 1])
          gradient += Math.abs(value - lum[(y + 1) * SAMPLE + x])
          gradientCount += 2
        }
      }
      const detail = gradientCount
        ? gradient / gradientCount / Math.max(24, innerMean)
        : 0

      // Steadiness: frame-to-frame difference over the same grid.
      let steady = 0
      if (previous) {
        let drift = 0
        for (let i = 0; i < lum.length; i += 1) drift += Math.abs(lum[i] - previous[i])
        drift = drift / lum.length / Math.max(24, avg)
        steady = clamp(1 - drift / 0.14, 0, 1)
      }
      previous = lum

      if (!ema.seeded) {
        ema.light = avg
        ema.contrast = contrast
        ema.detail = detail
        ema.steady = steady
        ema.seeded = true
      } else {
        ema.light += (avg - ema.light) * SMOOTHING
        ema.contrast += (contrast - ema.contrast) * SMOOTHING
        ema.detail += (detail - ema.detail) * SMOOTHING
        ema.steady += (steady - ema.steady) * SMOOTHING
      }

      const next: Metrics = {
        lum: Math.round(ema.light),
        framing: Math.round(clamp((ema.contrast / FRAMING_TARGET) * 100, 0, 100)),
        detail: Math.round(clamp((ema.detail / DETAIL_TARGET) * 100, 0, 100)),
        steady: Math.round(clamp(ema.steady * 100, 0, 100)),
      }
      setMetrics((prev) =>
        prev.lum === next.lum &&
        prev.framing === next.framing &&
        prev.detail === next.detail &&
        prev.steady === next.steady
          ? prev
          : next,
      )

      // Hold every check false until exposure has had time to settle.
      if (Date.now() - startedAt < WARMUP_MS) return

      // Asymmetric thresholds (looser to stay on than to turn on) stop the
      // chips from chattering when a reading sits right on the boundary.
      // Kept in step with analyze.ts's DARK_THRESHOLD (28): a close-up eye
      // capture (eyelashes, lid crease shadow, pupil) reads naturally darker
      // than a normal well-lit face, so this stays well below what would
      // flag a typical selfie as "too dark" — the old 60/52 floor was
      // stricter than the actual scoring check, so it could read "not
      // ready" on frames that would have scanned fine anyway.
      setChecks((prev) => {
        const light = prev.light
          ? ema.light > 27 && ema.light < 244
          : ema.light > 35 && ema.light < 235
        const position =
          light && (prev.position ? ema.contrast > 0.042 : ema.contrast > 0.055)
        const clarity = light && (prev.clarity ? ema.detail > 0.024 : ema.detail > 0.032)
        const steadyOk = prev.steady ? ema.steady > 0.36 : ema.steady > 0.48
        if (
          light === prev.light &&
          position === prev.position &&
          clarity === prev.clarity &&
          steadyOk === prev.steady
        ) {
          return prev
        }
        return { light, position, clarity, steady: steadyOk }
      })
    }

    async function startCamera() {
      const media = navigator.mediaDevices
      if (!media || typeof media.getUserMedia !== 'function') {
        if (!cancelled) setMode('fallback')
        return
      }

      try {
        const stream = await media.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        localStream = stream
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        // `play()` is a second await: the screen may already have been closed.
        if (cancelled) return
        setMode('camera')
        setFileError(null)
        timers.push(window.setTimeout(() => setWarm(true), WARMUP_MS))

        const track = stream.getVideoTracks()[0]
        if (track && typeof track.getCapabilities === 'function') {
          try {
            const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
              torch?: boolean
            }
            if (capabilities.torch) setTorchSupported(true)
          } catch {
            /* Capability probing is optional; the torch control just stays hidden. */
          }
        }

        if (typeof media.enumerateDevices === 'function') {
          media
            .enumerateDevices()
            .then((devices) => {
              if (cancelled) return
              const cameras = devices.filter((device) => device.kind === 'videoinput')
              setCanFlip(cameras.length > 1)
            })
            .catch(() => {})
        }

        const sampler = document.createElement('canvas')
        sampler.width = SAMPLE
        sampler.height = SAMPLE
        const ctx = sampler.getContext('2d', { willReadFrequently: true })
        if (!ctx || cancelled) return
        timers.push(window.setInterval(() => measure(ctx), SAMPLE_INTERVAL))
      } catch (error) {
        if (cancelled) return
        const name = error instanceof DOMException ? error.name : ''
        setMode(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'fallback')
      }
    }

    startCamera()

    return () => {
      cancelled = true
      for (const id of timers) {
        window.clearInterval(id)
        window.clearTimeout(id)
      }
      timers.length = 0
      localStream?.getTracks().forEach((track) => track.stop())
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      previous = null
    }
  }, [facing, attempt])

  /* ----------------------------------------------------------------------- */
  /* Capture                                                                  */
  /* ----------------------------------------------------------------------- */

  /**
   * Put the screen back into a usable state after a capture that could not be
   * analysed, and say so. Without this, every early return below would leave
   * the shutter permanently disabled with "Analysing on this device…" on screen
   * and no way out but the X button.
   */
  const abortCapture = useCallback((message: string) => {
    if (captureTimerRef.current) window.clearTimeout(captureTimerRef.current)
    captureTimerRef.current = null
    capturingRef.current = false
    setCapturing(false)
    setFlash(false)
    setCountdown(null)
    // Hand the shutter back to the user. Leaving auto-capture armed would
    // immediately re-fire the countdown against a frame that has just failed,
    // looping the same error instead of showing it.
    setAutoCapture(false)
    setFileError(message)
  }, [])

  const finishCapture = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (finishedRef.current) return
      try {
        const size = Math.min(canvas.width, canvas.height)
        if (size < 8) throw new Error('capture canvas is empty')
        // The canvas already IS the region the user framed, at a capped
        // resolution — this is handed to the real screening backend as-is
        // (see src/lib/api.ts submitScreening), so no local analysis runs here.
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85)
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              abortCapture('That frame could not be prepared for upload. Try again.')
              return
            }
            finishedRef.current = true
            // Release the camera only once the frame is safely captured; a
            // failed capture must leave a live preview to retry with.
            streamRef.current?.getTracks().forEach((track) => track.stop())
            onCapture({ blob, imageDataUrl })
          },
          'image/jpeg',
          0.85,
        )
      } catch {
        abortCapture('That frame could not be prepared for upload. Try again.')
      }
    },
    [onCapture, abortCapture],
  )

  const handleCapture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || finishedRef.current || capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)
    setFlash(true)
    setCountdown(null)
    setFileError(null)
    buzz(18)

    const region =
      apertureSourceSquare(video, guideRef.current, facing === 'user') ??
      centreSquare(video.videoWidth, video.videoHeight)

    if (!region || !drawAnalysisSquare(canvas, video, region, facing === 'user')) {
      abortCapture('The camera did not give a readable frame. Give it a moment and try again.')
      return
    }

    captureTimerRef.current = window.setTimeout(() => finishCapture(canvas), SHUTTER_DELAY)
  }, [finishCapture, abortCapture, facing])

  const captureRef = useRef(handleCapture)
  useEffect(() => {
    captureRef.current = handleCapture
  }, [handleCapture])

  /** Belt and braces: if the video element mounted after the stream arrived,
   * re-attach it rather than showing a black frame. */
  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (mode !== 'camera' || !video || !stream || video.srcObject === stream) return
    video.srcObject = stream
    void video.play().catch(() => {})
  }, [mode])

  /** Hold-still countdown. Cancels the moment any check drops out. */
  useEffect(() => {
    if (mode !== 'camera' || !ready || !autoCapture || capturing || helpOpen) {
      setCountdown(null)
      return
    }
    let remaining = COUNTDOWN_FROM
    setCountdown(remaining)
    buzz(10)
    const id = window.setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        window.clearInterval(id)
        setCountdown(0)
        captureRef.current()
        return
      }
      setCountdown(remaining)
    }, COUNTDOWN_STEP)
    return () => window.clearInterval(id)
  }, [mode, ready, autoCapture, capturing, helpOpen])

  /** Shutter flash. */
  useEffect(() => {
    if (!flash) return
    flashTimerRef.current = window.setTimeout(() => setFlash(false), 420)
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
    }
  }, [flash])

  /** Final teardown: timers, object URLs and any surviving track. */
  useEffect(
    () => () => {
      if (captureTimerRef.current) window.clearTimeout(captureTimerRef.current)
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    },
    [],
  )

  /* ----------------------------------------------------------------------- */
  /* Controls                                                                 */
  /* ----------------------------------------------------------------------- */

  const closeHelp = useCallback(() => {
    setHelpOpen(false)
    helpTriggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!helpOpen) return
    const focusTimer = window.setTimeout(() => helpCloseRef.current?.focus(), 60)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeHelp()
        return
      }
      // Keep Tab inside the sheet while it is open.
      if (event.key !== 'Tab') return
      const sheet = helpSheetRef.current
      if (!sheet) return
      const focusable = sheet.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const outside = !(active instanceof Node) || !sheet.contains(active)
      if (event.shiftKey ? active === first || outside : active === last || outside) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [helpOpen, closeHelp])

  const toggleTorch = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    track
      .applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      .then(() => setTorchOn(next))
      .catch(() => {
        setTorchSupported(false)
        setTorchOn(false)
      })
  }, [torchOn])

  const flipCamera = useCallback(() => {
    setTorchOn(false)
    setFacing((current) => (current === 'user' ? 'environment' : 'user'))
  }, [])

  const retryCamera = useCallback(() => {
    setFileError(null)
    setAttempt((value) => value + 1)
  }, [])

  // Decodes whatever image file the user picked, converting HEIC/HEIF (the
  // default format iPhones save photos in, which Chrome/Firefox/Edge can't
  // decode natively) to JPEG first via heic2any. Everything else goes
  // straight through as-is — the browser's own <img> decoder already
  // covers JPEG/PNG/GIF/BMP/WEBP/AVIF.
  const toDecodableBlob = useCallback(async (file: File): Promise<Blob> => {
    const looksLikeHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
    if (!looksLikeHeic) return file
    const heic2any = (await import('heic2any')).default
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    return Array.isArray(converted) ? converted[0] : converted
  }, [])

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      setFileError(null)
      setCapturing(true)
      capturingRef.current = true
      setFlash(true)

      const image = new Image()

      image.onload = () => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
        const canvas = canvasRef.current
        // A gallery photo has no reticle to align to, so the centre square is
        // the honest crop — downscaled, which is what keeps a 12MP photo from
        // failing the getImageData allocation on a mid-range phone.
        const region = canvas
          ? centreSquare(image.naturalWidth, image.naturalHeight)
          : null
        if (!canvas || !region || !drawAnalysisSquare(canvas, image, region, false)) {
          abortCapture('That photo could not be prepared for analysis. Try another one.')
          return
        }
        captureTimerRef.current = window.setTimeout(() => finishCapture(canvas), SHUTTER_DELAY)
      }

      image.onerror = () => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
        abortCapture('That file could not be read as an image. Try a JPEG or PNG photo.')
      }

      toDecodableBlob(file)
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          objectUrlRef.current = url
          image.src = url
        })
        .catch(() => {
          abortCapture("Couldn't read that photo. Try a JPEG, PNG, or HEIC image.")
        })
    },
    [finishCapture, abortCapture, toDecodableBlob],
  )

  /* ----------------------------------------------------------------------- */
  /* Coaching copy                                                            */
  /* ----------------------------------------------------------------------- */

  const tooBright = metrics.lum >= 235
  const tooDim = warm && !checks.light && !tooBright

  /* The countdown is deliberately NOT written into the live region. Polite
   * announcements queue rather than interrupt, so three digits 0.9s apart would
   * still be mid-sentence when the shutter fires. The region carries one stable
   * instruction; the ticking digit is rendered aria-hidden next to the ring. */
  const coach = useMemo<{ text: string; tone: 'idle' | 'warn' | 'ready' }>(() => {
    if (capturing) return { text: 'Captured. Analysing on this device…', tone: 'ready' }
    if (mode === 'loading') return { text: 'Starting the camera…', tone: 'idle' }
    if (mode === 'denied') return { text: 'Camera access is blocked', tone: 'warn' }
    if (mode === 'fallback') return { text: 'No camera stream available', tone: 'warn' }
    if (!videoLive || !warm) return { text: 'Warming up the sensor…', tone: 'idle' }
    if (countdown !== null && countdown > 0) {
      return { text: 'Locked on. Hold still — capturing automatically.', tone: 'ready' }
    }
    if (ready) return { text: 'Locked on. Hold still.', tone: 'ready' }
    if (tooBright) return { text: 'Too bright — step out of the direct glare', tone: 'warn' }
    if (!checks.light) return { text: 'Too dim — turn towards a window or lamp', tone: 'warn' }
    if (!checks.position) return { text: 'Pull your lower eyelid down and fill the frame', tone: 'idle' }
    if (!checks.clarity) return { text: 'Move slightly closer until the rim looks sharp', tone: 'idle' }
    return { text: 'Almost — keep the phone still', tone: 'idle' }
  }, [capturing, mode, videoLive, warm, countdown, ready, tooBright, checks])

  const signals: ScanSignal[] = [
    {
      label: 'Light',
      ok: checks.light,
      hint: tooBright
        ? 'Strong glare is washing the frame out. Turn away from the light source.'
        : 'Face a window or a lamp so the inner eyelid is evenly lit.',
    },
    {
      label: 'Framing',
      ok: checks.position,
      hint: 'Bring the everted lower eyelid into the middle of the reticle so it fills the dashed box.',
    },
    {
      label: 'Focus',
      ok: checks.clarity,
      hint: 'Hold about 15–20 cm away and pause — the fine vessels need to resolve.',
    },
    {
      label: 'Steady',
      ok: checks.steady,
      hint: 'Brace your elbow against something solid for a second.',
    },
  ]

  /* Content present at insertion time is not reliably announced by any engine,
   * so the region mounts empty and the first message is written afterwards. */
  const [liveMessage, setLiveMessage] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setLiveMessage(coach.text), 80)
    return () => window.clearTimeout(id)
  }, [coach.text])

  /* Focus lands on <body> otherwise: App.tsx skips its own focus move for the
   * immersive screens, and entering the camera unmounts the header and bottom
   * nav the user just activated. Each state gets its own heading focused. */
  useEffect(() => {
    if (helpOpen) return
    const id = window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 40)
    return () => window.clearTimeout(id)
  }, [mode, helpOpen])

  const mirrored = facing === 'user'
  const showCameraUi = mode === 'camera' || mode === 'loading'

  /* ----------------------------------------------------------------------- */
  /* Render                                                                   */
  /* ----------------------------------------------------------------------- */

  return (
    <div className="dark relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-gradient-to-b from-neutral-900 via-[#0a0e14] to-black" />

      {/* One video element for the whole camera lifecycle: remounting it would
       * drop the srcObject we attached during 'loading'. */}
      {showCameraUi && (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onPlaying={() => setVideoLive(true)}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
            videoLive ? 'opacity-100' : 'opacity-0',
          )}
          style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-black/30" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 85% at 50% 45%, transparent 30%, rgba(0,0,0,0.72) 100%)',
        }}
      />

      <canvas ref={canvasRef} className="hidden" />

      <input
        ref={fileInputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ------------------------------- header ------------------------------ */}
      <header className="safe-top relative z-20 flex items-start justify-between gap-3 px-4 py-4">
        <button type="button" onClick={onExit} className={OVERLAY_BUTTON} aria-label="Close scan and return home">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="flex flex-col items-center gap-1 pt-1">
          <span className="text-sm font-medium text-white/90">Eyelid scan</span>
          <span className="flex items-center gap-1 rounded-full border border-white/12 bg-black/40 px-2 py-0.5 text-2xs font-medium tracking-wide text-white/70 backdrop-blur-md">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Secure & private
          </span>
        </div>

        <div className="flex items-center gap-2">
          {torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              className={cn(OVERLAY_BUTTON, torchOn && 'border-primary/60 bg-primary/20 text-primary')}
              aria-label={torchOn ? 'Turn the camera light off' : 'Turn the camera light on'}
              aria-pressed={torchOn}
            >
              {torchOn ? (
                <Flashlight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <FlashlightOff className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
          {canFlip && mode === 'camera' && (
            <button
              type="button"
              onClick={flipCamera}
              className={OVERLAY_BUTTON}
              aria-label={
                mirrored ? 'Switch to the rear camera' : 'Switch to the front camera'
              }
            >
              <SwitchCamera className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            ref={helpTriggerRef}
            type="button"
            onClick={() => setHelpOpen(true)}
            className={OVERLAY_BUTTON}
            aria-label="How to frame the scan"
            aria-haspopup="dialog"
          >
            <CircleQuestionMark className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ------------------------------- middle ------------------------------ */}
      <div className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col items-center justify-center gap-6 px-5 py-2">
          {mode === 'denied' && (
            <PermissionDenied
              headingRef={headingRef}
              onRetry={retryCamera}
              onPickPhoto={() => fileInputRef.current?.click()}
              busy={capturing}
            />
          )}

          {mode === 'fallback' && (
            <NoCamera
              headingRef={headingRef}
              onRetry={retryCamera}
              onPickPhoto={() => fileInputRef.current?.click()}
              busy={capturing}
            />
          )}

          {showCameraUi && (
            <>
              <h1 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
                Capture the inside of your lower eyelid
              </h1>

              {/* The wrapper, not EyeGuide itself, is measured: handleCapture
                  projects this box back into the video's pixels so the crop is
                  exactly what the reticle showed. */}
              <div ref={guideRef} className="h-56 w-56 shrink-0 sm:h-64 sm:w-64">
                <EyeGuide ready={ready} className="h-full w-full" />
              </div>

              <div className="flex w-full flex-col items-center gap-3">
                <p
                  className={cn(
                    'min-h-[1.75rem] text-balance text-center text-base font-medium transition-colors duration-300 sm:text-lg',
                    coach.tone === 'ready' && 'text-primary',
                    coach.tone === 'warn' && 'text-moderate',
                    coach.tone === 'idle' && 'text-white',
                  )}
                >
                  {coach.text}
                </p>
                <p aria-live="polite" className="sr-only">
                  {liveMessage}
                </p>

                <ScanSignals signals={signals} />

                {mode === 'camera' && videoLive && (
                  <div
                    aria-hidden="true"
                    className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-2xs tracking-[0.14em] text-white/60 uppercase"
                  >
                    <span>lum {metrics.lum}</span>
                    <span>frm {metrics.framing}%</span>
                    <span>det {metrics.detail}%</span>
                    <span>stb {metrics.steady}%</span>
                  </div>
                )}
              </div>
            </>
          )}

          {fileError && (
            <p role="alert" className="max-w-[20rem] text-center text-xs leading-relaxed text-moderate">
              {fileError}
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------- footer ------------------------------ */}
      {mode === 'camera' && (
        <div className="safe-bottom relative z-20 flex flex-col items-center gap-4 px-5 pb-8">
          <AnimatePresence initial={false}>
            {tooDim && (
              <motion.div
                key="low-light"
                className="flex w-full max-w-sm items-start gap-3 rounded-2xl border border-moderate/30 bg-moderate/10 px-3.5 py-3 backdrop-blur-md"
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                transition={{ duration: reduceMotion ? 0 : 0.22 }}
              >
                <Sun className="mt-0.5 h-4 w-4 shrink-0 text-moderate" aria-hidden="true" />
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs leading-relaxed text-white/80">
                    There is not enough light on your eyelid. A dark frame cannot be screened, so
                    the result would be discarded.
                  </p>
                  {torchSupported && !torchOn && (
                    <button
                      type="button"
                      onClick={toggleTorch}
                      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-moderate/40 px-2.5 py-1.5 text-2xs font-medium text-moderate transition-colors hover:bg-moderate/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                    >
                      <Flashlight className="h-3 w-3" aria-hidden="true" />
                      Use the camera light
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex w-full max-w-sm items-center justify-between">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={capturing}
              className={OVERLAY_BUTTON}
              aria-label="Use a photo from this device instead"
            >
              <ImageUp className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="flex flex-col items-center gap-2">
              <motion.button
                type="button"
                onClick={handleCapture}
                disabled={capturing}
                aria-label={
                  ready ? 'Capture scan now, all checks passed' : 'Capture scan now'
                }
                whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                className={cn(
                  'relative flex h-20 w-20 items-center justify-center rounded-full border-4 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-black disabled:opacity-70',
                  ready
                    ? 'border-primary shadow-[0_0_50px_-4px_var(--primary)]'
                    : 'border-white/50',
                )}
              >
                {countdown !== null && countdown > 0 && (
                  <svg
                    className="pointer-events-none absolute -inset-1.5 -rotate-90"
                    viewBox="0 0 80 80"
                    aria-hidden="true"
                  >
                    <motion.circle
                      cx="40"
                      cy="40"
                      r="37"
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      initial={{ pathLength: reduceMotion ? 1 : 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{
                        duration: reduceMotion ? 0 : (COUNTDOWN_FROM * COUNTDOWN_STEP) / 1000,
                        ease: 'linear',
                      }}
                    />
                  </svg>
                )}
                <motion.span
                  aria-hidden="true"
                  className={cn(
                    'flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold transition-colors duration-300',
                    ready ? 'bg-primary text-primary-foreground' : 'bg-white text-neutral-900',
                  )}
                  animate={{ scale: capturing ? 0.84 : 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18 }}
                >
                  {countdown !== null && countdown > 0 ? countdown : ''}
                </motion.span>
              </motion.button>

              <p className="text-xs text-white/55">
                {capturing
                  ? 'Capturing…'
                  : countdown !== null && countdown > 0
                    ? 'Releasing automatically'
                    : 'Tap to capture'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAutoCapture((value) => !value)}
              className={cn(
                OVERLAY_BUTTON,
                autoCapture && 'border-primary/60 bg-primary/20 text-primary',
              )}
              aria-label={
                autoCapture
                  ? 'Turn off automatic capture when checks pass'
                  : 'Turn on automatic capture when checks pass'
              }
              aria-pressed={autoCapture}
            >
              {autoCapture ? (
                <Timer className="h-4 w-4" aria-hidden="true" />
              ) : (
                <TimerOff className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>

          <p className="max-w-[20rem] text-center text-2xs leading-relaxed text-white/70">
            Frames are sent securely for analysis and never stored. Screening only — not a
            diagnosis.
          </p>
        </div>
      )}

      {/* ------------------------------- flash ------------------------------- */}
      <AnimatePresence>
        {flash && !reduceMotion && (
          <motion.div
            key="flash"
            className="pointer-events-none absolute inset-0 z-30 bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.42, times: [0, 0.18, 1] }}
          />
        )}
      </AnimatePresence>

      {/* ----------------------------- help sheet ---------------------------- */}
      <AnimatePresence>
        {helpOpen && (
          <>
            <motion.div
              key="help-backdrop"
              className="absolute inset-0 z-40 bg-black/70 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
              onClick={closeHelp}
            />
            <motion.div
              key="help-sheet"
              ref={helpSheetRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="scan-help-title"
              className="safe-bottom absolute inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-y-auto rounded-t-[28px] border-t border-white/12 bg-[#0a0e14]/97 px-5 pt-4 pb-7 backdrop-blur-xl"
              initial={{ y: reduceMotion ? 0 : '100%', opacity: reduceMotion ? 0 : 1 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: reduceMotion ? 0 : '100%', opacity: reduceMotion ? 0 : 1 }}
              transition={
                reduceMotion ? { duration: 0.15 } : { type: 'spring', stiffness: 240, damping: 28 }
              }
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h2 id="scan-help-title" className="text-lg font-semibold tracking-tight text-white">
                    How to frame the scan
                  </h2>
                  <p className="text-xs text-white/55">
                    Four steps. The whole capture takes about ten seconds.
                  </p>
                </div>
                <button
                  ref={helpCloseRef}
                  type="button"
                  onClick={closeHelp}
                  className={OVERLAY_BUTTON}
                  aria-label="Close the framing guide"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <ol className="mt-5 flex flex-col gap-4">
                {HELP_STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-2xs font-semibold text-primary"
                    >
                      {index + 1}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm font-medium text-white">{step.title}</p>
                      <p className="text-xs leading-relaxed text-white/60">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-2xs leading-relaxed text-white/70">
                AnemiaScan looks for visual signs associated with anaemia. It is a screening aid,
                not a diagnosis, and it cannot replace a haemoglobin blood test.
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* Non-camera states                                                          */
/* ------------------------------------------------------------------------- */

const DENIED_STEPS = [
  'Tap the lock, camera or “site settings” icon next to the address bar.',
  'Set Camera to Allow for this site.',
  'Come back here and tap Try again — no reload needed on most browsers.',
] as const

function PermissionDenied({
  headingRef,
  onRetry,
  onPickPhoto,
  busy,
}: {
  headingRef: React.Ref<HTMLHeadingElement>
  onRetry: () => void
  onPickPhoto: () => void
  busy: boolean
}) {
  return (
    <section className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-moderate/30 bg-moderate/10 text-moderate">
        <Lock className="h-6 w-6" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-white outline-none"
        >
          Camera access is blocked
        </h1>
        <p className="text-sm leading-relaxed text-white/60">
          Your browser refused the camera for this site, so nothing was captured. Re-enable it in
          two taps.
        </p>
      </div>

      <ol className="flex w-full flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-left">
        {DENIED_STEPS.map((step, index) => (
          <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-white/70">
            <span
              aria-hidden="true"
              className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/12 text-2xs font-semibold text-white/85"
            >
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <p className="text-2xs leading-relaxed text-white/70">
        On iPhone, also check Settings → Safari → Camera → Allow. In a private or embedded window,
        camera access may be blocked outright.
      </p>

      <div className="flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={onRetry}
          className={cn(PILL_BUTTON, 'bg-primary text-primary-foreground hover:bg-primary/90')}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
        <button
          type="button"
          onClick={onPickPhoto}
          disabled={busy}
          className={cn(PILL_BUTTON, 'border border-white/15 bg-white/5 text-white hover:bg-white/10')}
        >
          <ImageUp className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Preparing…' : 'Use a photo instead'}
        </button>
      </div>
    </section>
  )
}

const PHOTO_REQUIREMENTS = [
  'Bright, even light — no flash directly on the eye.',
  'Lower eyelid pulled down so the moist inner rim shows.',
  'The rim centred and filling the middle of the frame.',
] as const

function NoCamera({
  headingRef,
  onRetry,
  onPickPhoto,
  busy,
}: {
  headingRef: React.Ref<HTMLHeadingElement>
  onRetry: () => void
  onPickPhoto: () => void
  busy: boolean
}) {
  return (
    <section className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/12 bg-white/8 text-white">
        <CameraOff className="h-6 w-6" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-white outline-none"
        >
          No camera stream
        </h1>
        <p className="text-sm leading-relaxed text-white/60">
          This device or browser did not offer a live camera. You can still run the full screening
          from a clear close-up photo.
        </p>
      </div>

      <ul className="flex w-full flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-left">
        {PHOTO_REQUIREMENTS.map((requirement) => (
          <li key={requirement} className="flex gap-2.5 text-xs leading-relaxed text-white/70">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            />
            {requirement}
          </li>
        ))}
      </ul>

      <div className="flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={onPickPhoto}
          disabled={busy}
          className={cn(PILL_BUTTON, 'bg-primary text-primary-foreground hover:bg-primary/90')}
        >
          <ImageUp className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Preparing…' : 'Choose or take a photo'}
        </button>
        <button
          type="button"
          onClick={onRetry}
          className={cn(PILL_BUTTON, 'border border-white/15 bg-white/5 text-white hover:bg-white/10')}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Look for a camera again
        </button>
      </div>

      <p className="max-w-[20rem] text-2xs leading-relaxed text-white/70">
        Photos are analysed securely and never stored. Screening only — not a diagnosis.
      </p>
    </section>
  )
}
