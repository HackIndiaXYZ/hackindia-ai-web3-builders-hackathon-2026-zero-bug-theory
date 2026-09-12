/**
 * The AnemiaScan backend client.
 *
 * The canonical screening endpoint is POST /inference/predict. Every request
 * carries a verified Firebase ID token: the endpoint is authenticated, so a
 * signed-out caller gets a 401 rather than a silent result.
 *
 * A refused capture comes back as HTTP 422 with named `reasons` and a
 * `message`. Both are surfaced to the user — the app used to throw that detail
 * away and show a generic "inconclusive" screen, leaving no way to tell a dark
 * room from a photo of a wall.
 */

import type {
  Decision,
  GateReport,
  ModelOutput,
  QualityReport,
  RoiReport,
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export interface ScreeningResult {
  scanSessionId: string
  scanIdHash: string
  commitment: string
  modelHash: string
  riskCode: 0 | 1 | 2
  recommendationCode: 0 | 1 | 2
  probabilityBps: number
  qualityBps: number
  isSynthetic: boolean
  demoNotice: string
  modelOutput: ModelOutput | null
  quality: QualityReport | null
  roi: RoiReport | null
  gate: GateReport | null
  registeredOnChain: boolean
  chainTxHash: string | null
  chainTxStatus: string | null
  explorerUrl: string | null
}

/** The read-only proof view of a past screening (GET /registry/screenings/:hash). */
export interface ScreeningProof extends ScreeningResult {}

export interface BlockchainHealth {
  status: string
  network: string
  expectedChainId: number
  liveChainId: number | null
  chainIdMatch: boolean | null
  registryAddress: string
  carePoolAddress: string
}

export interface OnChainPool {
  poolId: number
  sponsorAddress: string
  totalFundedWei: string
  totalReservedWei: string
  totalRedeemedWei: string
  availableWei: string
  active: boolean
}

export interface ClinicAuthorization {
  clinicAddress: string
  authorized: boolean
}

export interface BlockchainTransactionStatus {
  transactionHash: string
  status: 'pending' | 'confirmed' | 'reverted'
  blockNumber: number | null
}

export class RecaptureRequiredError extends Error {
  constructor(
    public reasons: string[],
    message: string,
    public quality: QualityReport | null = null,
    public roi: RoiReport | null = null,
    public gate: GateReport | null = null,
  ) {
    super(message)
    this.name = 'RecaptureRequiredError'
  }
}

export class AuthRequiredError extends Error {
  constructor(message = 'Please sign in to run a scan.') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

/* -- mappers: snake_case wire format -> camelCase domain types ------------- */

function mapQuality(raw: any): QualityReport | null {
  if (!raw) return null
  return {
    accepted: !!raw.accepted,
    brightness: Number(raw.brightness ?? 0),
    blurVariance: raw.blur_variance ?? null,
    clippedFraction: raw.clipped_fraction ?? null,
    failures: Array.isArray(raw.failures) ? raw.failures : [],
  }
}

function mapRoi(raw: any): RoiReport | null {
  if (!raw) return null
  return {
    located: !!raw.located,
    coverage: Number(raw.coverage ?? 0),
    maskedFraction: Number(raw.masked_fraction ?? 0),
    meanRednessOverYellow: Number(raw.mean_redness_over_yellow ?? 0),
    method: String(raw.method ?? ''),
    bbox: Array.isArray(raw.bbox) ? raw.bbox : null,
    sourceSize: Array.isArray(raw.source_size) ? raw.source_size : [],
    roiSize: Array.isArray(raw.roi_size) ? raw.roi_size : [],
    failures: Array.isArray(raw.failures) ? raw.failures : [],
  }
}

function mapGate(raw: any): GateReport | null {
  if (!raw) return null
  return {
    accepted: !!raw.accepted,
    failures: Array.isArray(raw.failures) ? raw.failures : [],
    distributionBudget: Number(raw.distribution_budget ?? 0),
    distributionBudgetLimit: Number(raw.distribution_budget_limit ?? 0),
    rmsZ: Number(raw.rms_z ?? 0),
    maxAbsZ: Number(raw.max_abs_z ?? 0),
    worstFeatures: Array.isArray(raw.worst_features) ? raw.worst_features : [],
    chromaZ: raw.chroma_z ?? {},
    texture: raw.texture ?? {},
    logitZ: raw.logit_z ?? {},
  }
}

function mapModelOutput(raw: any): ModelOutput | null {
  if (!raw) return null
  return {
    decision: raw.decision as Decision,
    riskCategory: String(raw.risk_category ?? ''),
    screeningProbability: Number(raw.screening_probability ?? 0),
    probabilityBps: Number(raw.probability_bps ?? 0),
    selectedModel: String(raw.selected_model ?? ''),
    operatingThreshold: Number(raw.operating_threshold ?? 0),
    uncertaintyMargin: Number(raw.uncertainty_margin ?? 0),
    candidateProbabilities: raw.candidate_probabilities ?? {},
    candidateThresholds: raw.candidate_thresholds ?? {},
    modelDisagreement: !!raw.model_disagreement,
    nearThreshold: !!raw.near_threshold,
    fusionGateWeights: raw.fusion_gate_weights ?? {},
    modelVersion: String(raw.model_version ?? ''),
  }
}

function mapScreeningResult(body: any): ScreeningResult {
  return {
    scanSessionId: body.scan_session_id,
    scanIdHash: body.scan_id_hash,
    commitment: body.commitment,
    modelHash: body.model_hash,
    riskCode: body.risk_code,
    recommendationCode: body.recommendation_code,
    probabilityBps: body.probability_bps,
    qualityBps: body.quality_bps,
    isSynthetic: body.is_synthetic,
    demoNotice: body.demo_notice,
    modelOutput: mapModelOutput(body.model_output),
    quality: mapQuality(body.quality),
    roi: mapRoi(body.roi),
    gate: mapGate(body.gate),
    registeredOnChain: body.registered_on_chain,
    chainTxHash: body.chain_tx_hash,
    chainTxStatus: body.chain_tx_status,
    explorerUrl: body.explorer_url,
  }
}

async function authHeaders(idToken: string | null): Promise<HeadersInit> {
  return idToken ? { Authorization: `Bearer ${idToken}` } : {}
}

export async function submitScreening(params: {
  blob: Blob
  consentHash: string
  idToken: string | null
  capturedAt?: number
}): Promise<ScreeningResult> {
  if (!params.idToken) throw new AuthRequiredError()

  const formData = new FormData()
  formData.append('image', params.blob, 'scan.jpg')
  formData.append('consent_hash', params.consentHash)
  if (params.capturedAt) formData.append('captured_at', String(params.capturedAt))

  const response = await fetch(`${API_BASE_URL}/inference/predict`, {
    method: 'POST',
    headers: await authHeaders(params.idToken),
    body: formData,
  })

  if (response.status === 401 || response.status === 403) {
    const body = await response.json().catch(() => null)
    throw new AuthRequiredError(body?.detail || 'Please sign in to run a scan.')
  }

  if (response.status === 422) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    // A 422 is either a refused capture (detail is an object) or a validation
    // error (detail is FastAPI's array of field errors).
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      throw new RecaptureRequiredError(
        Array.isArray(detail.reasons) ? detail.reasons : [],
        detail.message || 'That capture could not be read. Please try again.',
        mapQuality(detail.quality),
        mapRoi(detail.roi),
        mapGate(detail.gate),
      )
    }
    throw new Error('The scan request was rejected as invalid.')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    throw new Error(
      (typeof detail === 'string' && detail) ||
        `Screening request failed (${response.status})`,
    )
  }

  const body = await response.json()
  return mapScreeningResult(body)
}

/** Re-fetches a past screening's coded result and provenance, for the
 * "Proof & care" workspace. Unauthenticated: this is a public record lookup
 * by scan_id_hash, not a request to run a new screening. */
export async function getScreeningProof(scanIdHash: string): Promise<ScreeningProof> {
  const response = await fetch(
    `${API_BASE_URL}/registry/screenings/${encodeURIComponent(scanIdHash.trim())}`,
  )
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || `Proof lookup failed (${response.status})`)
  }
  const body = await response.json()
  return mapScreeningResult(body)
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

/** Public configuration for the non-custodial browser workspace. */
export async function getBlockchainConfig(): Promise<BlockchainHealth> {
  const response = await fetch(`${API_BASE_URL}/blockchain/config`)
  if (!response.ok) throw new Error(`Blockchain configuration is unavailable (${response.status})`)
  const body = await response.json()
  return {
    status: body.status,
    network: body.network,
    expectedChainId: body.chain_id,
    liveChainId: body.live_chain_id,
    chainIdMatch: body.live_chain_id === body.chain_id,
    registryAddress: body.registry_address,
    carePoolAddress: body.care_pool_address,
  }
}

export async function getOnChainPool(poolId: string): Promise<OnChainPool> {
  const response = await fetch(`${API_BASE_URL}/blockchain/pools/${encodeURIComponent(poolId)}`)
  if (!response.ok) {
    throw new Error(
      response.status === 404 ? 'Pool not found on MST.' : `Pool lookup failed (${response.status})`,
    )
  }
  const body = await response.json()
  return {
    poolId: body.pool_id,
    sponsorAddress: body.sponsor_address,
    totalFundedWei: body.total_funded_wei,
    totalReservedWei: body.total_reserved_wei,
    totalRedeemedWei: body.total_redeemed_wei,
    availableWei: body.available_wei,
    active: body.active,
  }
}

export async function getClinicAuthorization(address: string): Promise<ClinicAuthorization> {
  const response = await fetch(`${API_BASE_URL}/blockchain/clinics/${encodeURIComponent(address)}`)
  if (!response.ok) throw new Error(`Clinic verification failed (${response.status})`)
  const body = await response.json()
  return { clinicAddress: body.clinic_address, authorized: body.authorized }
}

export async function getBlockchainTransaction(hash: string): Promise<BlockchainTransactionStatus> {
  const response = await fetch(`${API_BASE_URL}/blockchain/transactions/${encodeURIComponent(hash)}`)
  if (!response.ok) throw new Error(`Transaction confirmation failed (${response.status})`)
  const body = await response.json()
  return { transactionHash: body.transaction_hash, status: body.status, blockNumber: body.block_number }
}

export interface ModelInfo {
  provider: string
  modelVersion: string | null
  modelHash: string
  operatingThreshold: number | null
  uncertaintyMargin: number | null
  selectedCandidate: string | null
  targetSensitivity: number | null
  assets: { path: string; sha256: string; bytes: number }[]
  explainerAvailable: boolean
  notice: string
}

export async function fetchModelInfo(): Promise<ModelInfo | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/inference/model`)
    if (!response.ok) return null
    const body = await response.json()
    return {
      provider: body.provider,
      modelVersion: body.model_version ?? null,
      modelHash: body.model_hash,
      operatingThreshold: body.operating_threshold ?? null,
      uncertaintyMargin: body.uncertainty_margin ?? null,
      selectedCandidate: body.selected_candidate ?? null,
      targetSensitivity: body.target_sensitivity ?? null,
      assets: Array.isArray(body.assets) ? body.assets : [],
      explainerAvailable: !!body.explainer_available,
      notice: body.notice ?? '',
    }
  } catch {
    return null
  }
}

export interface Explanation {
  available: boolean
  explanation: string | null
  reason: string | null
}

/**
 * Optional Gemini explainer. Explains an already-computed result; it can never
 * change one. When unavailable the UI hides the section rather than inventing
 * text locally.
 */
export async function fetchExplanation(params: {
  model: ModelOutput
  qualityBps: number
  roi: RoiReport | null
  idToken: string | null
}): Promise<Explanation> {
  if (!params.idToken) return { available: false, explanation: null, reason: 'Not signed in.' }
  try {
    const response = await fetch(`${API_BASE_URL}/inference/explain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeaders(params.idToken)),
      },
      body: JSON.stringify({
        decision: params.model.decision,
        risk_category: params.model.riskCategory,
        screening_probability: params.model.screeningProbability,
        operating_threshold: params.model.operatingThreshold,
        uncertainty_margin: params.model.uncertaintyMargin,
        candidate_probabilities: params.model.candidateProbabilities,
        model_disagreement: params.model.modelDisagreement,
        near_threshold: params.model.nearThreshold,
        quality_bps: params.qualityBps,
        roi: params.roi ? { coverage: params.roi.coverage } : null,
      }),
    })
    if (!response.ok) {
      return { available: false, explanation: null, reason: `Explainer unavailable (${response.status}).` }
    }
    const body = await response.json()
    return {
      available: !!body.available,
      explanation: body.explanation ?? null,
      reason: body.reason ?? null,
    }
  } catch (error) {
    return {
      available: false,
      explanation: null,
      reason: error instanceof Error ? error.message : 'Explainer unavailable.',
    }
  }
}
