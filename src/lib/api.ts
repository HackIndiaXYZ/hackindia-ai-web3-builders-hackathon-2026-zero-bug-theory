const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type AnemiaDecision = 'higher_risk' | 'lower_risk' | 'uncertain' | 'recapture_required'

export interface AnemiaQuality {
  accepted: boolean
  brightness: number
  blurVariance: number
  clippedFraction: number
  failures: string[]
}

export interface InternalBenchmark {
  label: 'Internal development benchmark'
  samples: number
  accuracy: number
  sensitivity: number
  specificity: number
  auroc: number
  f1: number
  confusionMatrix: { tn: number; fp: number; fn: number; tp: number }
}

export interface AnemiaAnalysisResult {
  modelVersion: 'anemiascan-v4-eff-conv-vit'
  modelHash: string
  decision: AnemiaDecision
  screeningProbability: number | null
  operatingThreshold: number
  uncertain: boolean
  quality: AnemiaQuality
  benchmark: InternalBenchmark
  warning: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function parseAnemiaResult(value: unknown): AnemiaAnalysisResult {
  if (!isRecord(value)) throw new Error('The V4 service returned an incomplete response.')
  const decisions: AnemiaDecision[] = ['higher_risk', 'lower_risk', 'uncertain', 'recapture_required']
  if (value.modelVersion !== 'anemiascan-v4-eff-conv-vit') throw new Error('The response did not come from the expected V4 model.')
  if (typeof value.decision !== 'string' || !decisions.includes(value.decision as AnemiaDecision)) throw new Error('The V4 service returned an invalid decision.')
  if (typeof value.modelHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value.modelHash)) throw new Error('The V4 response has invalid model provenance.')
  if (!validProbability(value.operatingThreshold) || value.operatingThreshold <= 0 || value.operatingThreshold >= 1) throw new Error('The V4 response has an invalid operating threshold.')
  const decision = value.decision as AnemiaDecision
  const probability = value.screeningProbability
  if (decision === 'recapture_required' ? probability !== null : !validProbability(probability)) throw new Error('The V4 response has an invalid screening probability.')
  if (typeof value.uncertain !== 'boolean' || value.uncertain !== (decision === 'uncertain')) throw new Error('The V4 response has inconsistent uncertainty fields.')

  const quality = value.quality
  const benchmark = value.benchmark
  if (!isRecord(quality) || typeof quality.accepted !== 'boolean' || !validProbability(quality.clippedFraction) || typeof quality.brightness !== 'number' || !Number.isFinite(quality.brightness) || quality.brightness < 0 || quality.brightness > 255 || typeof quality.blurVariance !== 'number' || !Number.isFinite(quality.blurVariance) || quality.blurVariance < 0 || !Array.isArray(quality.failures) || !quality.failures.every((failure) => typeof failure === 'string')) throw new Error('The V4 response has invalid image-quality fields.')
  if (decision !== 'recapture_required' && !quality.accepted) throw new Error('The V4 response has inconsistent image-quality fields.')
  if (!isRecord(benchmark) || benchmark.label !== 'Internal development benchmark' || typeof benchmark.samples !== 'number' || !isRecord(benchmark.confusionMatrix)) throw new Error('The V4 response is missing its internal development benchmark.')
  for (const key of ['accuracy', 'sensitivity', 'specificity', 'auroc', 'f1'] as const) {
    if (!validProbability(benchmark[key])) throw new Error(`The V4 benchmark has an invalid ${key} value.`)
  }
  const matrix = benchmark.confusionMatrix
  for (const key of ['tn', 'fp', 'fn', 'tp'] as const) {
    if (typeof matrix[key] !== 'number' || !Number.isInteger(matrix[key]) || matrix[key] < 0) throw new Error('The V4 benchmark has an invalid confusion matrix.')
  }
  if (typeof value.warning !== 'string' || !value.warning.trim()) throw new Error('The V4 response is missing its medical warning.')

  return value as unknown as AnemiaAnalysisResult
}

export async function analyzeAnemiaImage(blob: Blob): Promise<AnemiaAnalysisResult> {
  const formData = new FormData()
  formData.append('image', blob, 'guided-conjunctiva-roi.jpg')
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/anemia/analyze`, { method: 'POST', body: formData })
  } catch {
    throw new Error('The V4 screening service is unavailable. No result was generated.')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : `Screening request failed (${response.status}).`
    throw new Error(detail)
  }
  return parseAnemiaResult(body)
}

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

export interface BlockchainHealth {
  status: string
  network: string
  expectedChainId: number
  liveChainId: number | null
  chainIdMatch: boolean | null
  registryAddress: string
  carePoolAddress: string
}

export interface ScreeningProof extends ScreeningResult {}

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

export async function getBlockchainHealth(): Promise<BlockchainHealth> {
  const response = await fetch(`${API_BASE_URL}/health`)
  if (!response.ok) throw new Error(`Blockchain status is unavailable (${response.status})`)
  const body = await response.json()
  return {
    status: body.status,
    network: body.network,
    expectedChainId: body.expected_chain_id,
    liveChainId: body.live_chain_id,
    chainIdMatch: body.chain_id_match,
    registryAddress: body.registry_address,
    carePoolAddress: body.care_pool_address,
  }
}

export async function getScreeningProof(scanIdHash: string): Promise<ScreeningProof> {
  const response = await fetch(`${API_BASE_URL}/registry/screenings/${encodeURIComponent(scanIdHash.trim())}`)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || `Proof lookup failed (${response.status})`)
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

