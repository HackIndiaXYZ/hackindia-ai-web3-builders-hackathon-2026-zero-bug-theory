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
  if (!response.ok) throw new Error(response.status === 404 ? 'Pool not found on MST.' : `Pool lookup failed (${response.status})`)
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
