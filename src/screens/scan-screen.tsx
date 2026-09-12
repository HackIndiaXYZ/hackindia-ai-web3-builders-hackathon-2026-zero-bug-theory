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

type Mode = 'loading' | 'camera' | 'fallback'

export function ScanScreen({ onCapture, onExit }: ScanScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('loading')
  const [signals, setSignals] = useState({ light: false, position: false, clarity: false })
  const [capturing, setCapturing] = useState(false)

  const ready = signals.light && signals.position && signals.clarity

  useEffect(() => {
    let brightnessInterval: ReturnType<typeof setInterval> | undefined
    let positionTimer: ReturnType<typeof setTimeout> | undefined
    let clarityTimer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
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
          setSignals((s) => ({ ...s, light: avg > 60 && avg < 235 }))
        }, 400)
      } catch {
        if (!cancelled) setMode('fallback')
      }
    }

    startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (brightnessInterval) clearInterval(brightnessInterval)
      if (positionTimer) clearTimeout(positionTimer)
      if (clarityTimer) clearTimeout(clarityTimer)
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

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setCapturing(true)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0)
        window.setTimeout(() => finishCapture(canvas), 260)
      }
      img.src = URL.createObjectURL(file)
    },
    [finishCapture],
  )

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-black">
      {mode === 'camera' && (
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
      )}
      {mode !== 'camera' && (
        <div className="absolute inset-0 bg-gradient-to-b from-neutral-900 to-black" />
      )}

      <div className="absolute inset-0 bg-black/25" />

      <canvas ref={canvasRef} className="hidden" />

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
        {mode === 'fallback' ? (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white">
              <Camera className="h-6 w-6" />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-lg font-medium text-white">Camera unavailable</p>
              <p className="max-w-[16rem] text-sm leading-relaxed text-white/60">
                Choose a close-up photo of your lower eyelid to continue the scan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={capturing}
              className="flex h-14 items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              <ImageUp className="h-4 w-4" />
              {capturing ? 'Preparing…' : 'Choose Photo'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        ) : (
          <>
            <EyeGuide ready={ready} className="h-64 w-64" />
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
        </div>
      )}
    </div>
  )
}
