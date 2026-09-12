import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImageUp, X } from 'lucide-react'
import { EyeGuide } from '@/src/components/eye-guide'
import { ScanSignals } from '@/src/components/scan-signals'
import { analyzeImageData } from '@/src/lib/analyze'
import type { ScanAnalysis } from '@/src/lib/types'
import { cn } from '@/lib/utils'

interface ScanScreenProps {
  onCapture: (analysis: ScanAnalysis) => void
  onExit: () => void
}

type Mode = 'instructions' | 'loading' | 'camera' | 'fallback'

// `image/*` alone is enough in most browsers, but some platforms don't tag
// HEIC/HEIF files with an image/* MIME type in the file picker, so the
// extensions are listed explicitly too. Actual decoding of anything the
// <img> element can't read natively (HEIC/HEIF) is handled in
// loadImageFromFile below via heic2any.
const UPLOAD_ACCEPT =
  'image/*,.heic,.heif,.avif,.tif,.tiff,.bmp,.gif,.webp,.png,.jpg,.jpeg'

export function ScanScreen({ onCapture, onExit }: ScanScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('instructions')
  const [cameraDenied, setCameraDenied] = useState(false)
  const [signals, setSignals] = useState({ light: false, position: false, clarity: false })
  const [capturing, setCapturing] = useState(false)
  const [uploadError, setUploadError] = useState('')
  // Identifies one camera-start attempt. Incrementing it is what (re)runs
  // the effect below — see the comment there for why this can't just be a
  // `[mode]` dependency.
  const [cameraAttempt, setCameraAttempt] = useState(0)

  const ready = signals.light && signals.position && signals.clarity

  useEffect(() => {
    if (cameraAttempt === 0) return

    // This effect must NOT depend on `mode`. It calls `setMode('camera')`
    // itself on success — if `mode` were a dependency, that state update
    // would make React tear down *this very effect* (mode: loading ->
    // camera counts as a change) and run its cleanup, which stops the
    // MediaStream it just started. The preview would then show nothing
    // (survives just long enough to never render a frame), every capture
    // is black, and every scan reports "too dark". Keying this off a
    // dedicated counter that only changes when the user explicitly (re)starts
    // the camera avoids that self-inflicted teardown entirely.
    let brightnessInterval: ReturnType<typeof setInterval> | undefined
    let positionTimer: ReturnType<typeof setTimeout> | undefined
    let clarityTimer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('getUserMedia unsupported')
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        // Best-effort real optical/digital zoom on devices that expose it
        // (mostly Android Chrome on the rear camera; harmless no-op
        // everywhere else). The CSS transform below is what actually
        // guarantees the "zoomed in on the eye" look on every device.
        const [track] = stream.getVideoTracks()
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: { min: number; max: number } }) | undefined
        if (capabilities?.zoom) {
          const target = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, capabilities.zoom.min + (capabilities.zoom.max - capabilities.zoom.min) * 0.35))
          track.applyConstraints({ advanced: [{ zoom: target } as MediaTrackConstraintSet] }).catch(() => {})
        }

        // videoRef is guaranteed mounted by now — the <video> element
        // renders for both 'loading' and 'camera' modes precisely so this
        // ref exists before the stream is ready to attach (attaching it
        // only after flipping to 'camera' would mount a *fresh* element
        // with no stream ever assigned, leaving the preview blank).
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setMode('camera')

        positionTimer = setTimeout(
          () => setSignals((s) => ({ ...s, position: true })),
          1100,
        )
        clarityTimer = setTimeout(() => setSignals((s) => ({ ...s, clarity: true })), 1750)

        const sampleCanvas = document.createElement('canvas')
        sampleCanvas.width = 24
        sampleCanvas.height = 24
        const ctx = sampleCanvas.getContext('2d')

        brightnessInterval = setInterval(() => {
          const video = videoRef.current
          if (!video || !ctx || video.readyState < 2) return
          ctx.drawImage(video, 0, 0, 24, 24)
          const { data } = ctx.getImageData(0, 0, 24, 24)
          let sum = 0
          for (let i = 0; i < data.length; i += 4) {
            sum += (data[i] + data[i + 1] + data[i + 2]) / 3
          }
          const avg = sum / (data.length / 4)
          // Kept in step with analyze.ts's DARK_THRESHOLD (with a little
          // headroom) so the "Light" chip reliably predicts whether the
          // capture will actually pass — it was previously stricter than
          // the real check, so it could read "not ready" on frames that
          // would have scanned fine anyway.
          setSignals((s) => ({ ...s, light: avg > 35 && avg < 235 }))
        }, 400)
      } catch {
        if (!cancelled) {
          setCameraDenied(true)
          setMode('fallback')
        }
      }
    }

    startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (brightnessInterval) clearInterval(brightnessInterval)
      if (positionTimer) clearTimeout(positionTimer)
      if (clarityTimer) clearTimeout(clarityTimer)
    }
  }, [cameraAttempt])

  // Belt-and-suspenders: stop any live stream if the whole screen unmounts
  // mid-capture (e.g. the user taps the X while the camera is running).
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const finishCapture = useCallback(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const size = Math.min(canvas.width, canvas.height)
      const sx = (canvas.width - size) / 2
      const sy = (canvas.height - size) / 2
      const region = ctx.getImageData(sx, sy, size, size)
      const analysis = analyzeImageData(region)
      analysis.imageDataUrl = canvas.toDataURL('image/jpeg', 0.85)
      onCapture(analysis)
    },
    [onCapture],
  )

  const handleScanTap = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    setCapturing(true)
    canvas.width = video.videoWidth || 720
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    window.setTimeout(() => finishCapture(canvas), 260)
  }, [finishCapture])

  // Decodes whatever image file the user picked, converting HEIC/HEIF
  // (the default format iPhones save photos in, which Chrome/Firefox/Edge
  // can't decode natively) to JPEG first via heic2any. Everything else goes
  // straight through the browser's own <img> decoder, which already covers
  // JPEG/PNG/GIF/BMP/WEBP/AVIF/SVG.
  const loadImageFromFile = useCallback(async (file: File): Promise<HTMLImageElement> => {
    let source: Blob = file
    const looksLikeHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)

    if (looksLikeHeic) {
      const heic2any = (await import('heic2any')).default
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
      source = Array.isArray(converted) ? converted[0] : converted
    }

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('unsupported-image'))
      img.src = URL.createObjectURL(source)
    })
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // allow re-selecting the same file later
      if (!file) return

      setUploadError('')
      setCapturing(true)

      loadImageFromFile(file)
        .then((img) => {
          const canvas = canvasRef.current
          if (!canvas) return
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          ctx?.drawImage(img, 0, 0)
          window.setTimeout(() => finishCapture(canvas), 260)
        })
        .catch(() => {
          setCapturing(false)
          setUploadError("Couldn't read that photo. Try a JPEG, PNG, or HEIC image.")
        })
    },
    [finishCapture, loadImageFromFile],
  )

  const openFilePicker = useCallback(() => {
    setUploadError('')
    fileInputRef.current?.click()
  }, [])

  const startCameraMode = useCallback(() => {
    setCameraDenied(false)
    setUploadError('')
    setSignals({ light: false, position: false, clarity: false })
    setMode('loading')
    setCameraAttempt((n) => n + 1)
  }, [])

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-black">
      {/* The live feed only ever shows zoomed in, inside the eye-guide
          frame below — not as an unzoomed full-bleed background — so the
          screen always reads as a dedicated close-up eye scanner rather
          than a normal selfie camera. */}
      <div className="absolute inset-0 bg-gradient-to-b from-neutral-900 to-black" />
      <div className="absolute inset-0 bg-black/25" />

      <canvas ref={canvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="safe-top relative z-10 flex items-center justify-between px-5 py-5">
        <button
          type="button"
          onClick={onExit}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-md"
          aria-label="Close scan"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-white/80">Scan</span>
        <div className="h-9 w-9" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-6">
        {mode === 'instructions' && (
          <div className="flex flex-col items-center gap-6 text-center">
            <EyeGuide ready className="h-56 w-56" />
            <div className="flex flex-col gap-2">
              <p className="text-lg font-medium text-white">Scan your lower eyelid</p>
              <p className="max-w-[19rem] text-sm leading-relaxed text-white/60">
                Gently pull down your lower eyelid, face a light source so it falls on
                your eye (not behind you), and hold your device steady about 20cm
                (8in) away.
              </p>
            </div>
            <div className="flex w-full max-w-xs flex-col gap-3">
              <button
                type="button"
                onClick={startCameraMode}
                className="flex h-14 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground"
              >
                <Camera className="h-4 w-4" />
                Use camera
              </button>
              <button
                type="button"
                onClick={openFilePicker}
                disabled={capturing}
                className="flex h-14 items-center justify-center gap-2 rounded-full border border-white/25 bg-white/5 px-6 text-sm font-medium text-white backdrop-blur-md disabled:opacity-60"
              >
                <ImageUp className="h-4 w-4" />
                {capturing ? 'Preparing…' : 'Upload a photo'}
              </button>
            </div>
            {uploadError && <p className="max-w-[19rem] text-xs text-risk">{uploadError}</p>}
          </div>
        )}

        {mode === 'fallback' && (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white">
              <Camera className="h-6 w-6" />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-lg font-medium text-white">
                {cameraDenied ? 'Camera unavailable' : 'Upload a photo'}
              </p>
              <p className="max-w-[16rem] text-sm leading-relaxed text-white/60">
                {cameraDenied
                  ? 'Choose a close-up photo of your lower eyelid to continue the scan.'
                  : 'Choose a clear, well-lit photo of your lower eyelid.'}
              </p>
            </div>
            <button
              type="button"
              onClick={openFilePicker}
              disabled={capturing}
              className="flex h-14 items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              <ImageUp className="h-4 w-4" />
              {capturing ? 'Preparing…' : 'Choose photo'}
            </button>
            {cameraDenied && (
              <button
                type="button"
                onClick={startCameraMode}
                className="text-xs font-medium text-primary underline underline-offset-4"
              >
                Try camera again
              </button>
            )}
            {uploadError && <p className="max-w-[16rem] text-xs text-risk">{uploadError}</p>}
          </div>
        )}

        {(mode === 'loading' || mode === 'camera') && (
          <>
            <EyeGuide ready={ready} className="h-64 w-64">
              {/* Rendered for 'loading' too, not just 'camera' — this ref
                  has to exist in the DOM before the stream resolves, or
                  there's nothing to attach it to (see startCamera above). */}
              <video
                ref={videoRef}
                playsInline
                muted
                className={cn(
                  'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
                  mode === 'camera' ? 'opacity-100' : 'opacity-0',
                )}
                style={{ transform: 'scaleX(-1) scale(2.5)' }}
              />
            </EyeGuide>
            <div className="flex flex-col items-center gap-4">
              <p
                className={cn(
                  'text-center text-lg font-medium transition-colors duration-300',
                  ready ? 'text-primary' : 'text-white',
                )}
              >
                {mode === 'loading'
                  ? 'Starting camera…'
                  : ready
                    ? 'Perfect. Hold still.'
                    : 'Pull down your lower eyelid'}
              </p>
              <ScanSignals
                signals={[
                  { label: 'Light', ok: signals.light },
                  { label: 'Position', ok: signals.position },
                  { label: 'Clarity', ok: signals.clarity },
                ]}
              />
            </div>
          </>
        )}
      </div>

      {mode === 'camera' && (
        <div className="safe-bottom relative z-10 flex flex-col items-center gap-3 pb-10">
          <button
            type="button"
            onClick={handleScanTap}
            disabled={capturing}
            aria-label="Capture scan"
            className={cn(
              'relative flex h-20 w-20 items-center justify-center rounded-full border-4 transition-all duration-300 disabled:opacity-70',
              ready
                ? 'border-primary shadow-[0_0_50px_-4px_var(--primary)]'
                : 'border-white/50',
            )}
          >
            <span
              className={cn(
                'h-16 w-16 rounded-full transition-colors duration-300',
                ready ? 'bg-primary' : 'bg-white',
                capturing && 'scale-90',
              )}
            />
          </button>
          <p className="text-xs text-white/50">
            {capturing ? 'Capturing…' : 'Tap to scan'}
          </p>
          <button
            type="button"
            onClick={openFilePicker}
            disabled={capturing}
            className="text-xs font-medium text-white/60 underline underline-offset-4 disabled:opacity-60"
          >
            Or upload a photo instead
          </button>
        </div>
      )}
    </div>
  )
}
