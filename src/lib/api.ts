const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export interface ScreeningResult {
  scanSessionId: string
  scanIdHash: string
  commitment: string
  modelHash: string
  riskCode: 0 | 1 | 2
  recommendationCode: 0 | 1 | 2
  confidenceBps: number
  qualityBps: number
  isSynthetic: boolean
  demoNotice: string
  registeredOnChain: boolean
  chainTxHash: string | null
  chainTxStatus: string | null
  explorerUrl: string | null
}

export class RecaptureRequiredError extends Error {
  constructor(
    public quality: unknown,
    message: string,
  ) {
    super(message)
  }
}

export async function submitScreening(params: {
  blob: Blob
  consentHash: string
  capturedAt?: number
}): Promise<ScreeningResult> {
  const formData = new FormData()
  formData.append('image', params.blob, 'scan.jpg')
  formData.append('consent_hash', params.consentHash)
  if (params.capturedAt) formData.append('captured_at', String(params.capturedAt))

  const response = await fetch(`${API_BASE_URL}/registry/screenings`, {
    method: 'POST',
    body: formData,
  })

  if (response.status === 422) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    throw new RecaptureRequiredError(
      detail?.quality,
      detail?.message || 'Image quality too low — please retake the scan.',
    )
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || `Screening request failed (${response.status})`)
  }

  const body = await response.json()
  return {
    scanSessionId: body.scan_session_id,
    scanIdHash: body.scan_id_hash,
    commitment: body.commitment,
    modelHash: body.model_hash,
    riskCode: body.risk_code,
    recommendationCode: body.recommendation_code,
    confidenceBps: body.confidence_bps,
    qualityBps: body.quality_bps,
    isSynthetic: body.is_synthetic,
    demoNotice: body.demo_notice,
    registeredOnChain: body.registered_on_chain,
    chainTxHash: body.chain_tx_hash,
    chainTxStatus: body.chain_tx_status,
    explorerUrl: body.explorer_url,
  }
}
