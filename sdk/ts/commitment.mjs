/**
 * ANEMIASCAN_SCREENING_COMMITMENT_V1 — the canonical commitment hash.
 *
 * Must match, byte for byte, AnemiaRegistry.hashScreeningCommitment in
 * contracts/contracts/AnemiaRegistry.sol (the ground truth — it's what
 * actually runs on-chain) and backend/app/commitment.py. Cross-checked via
 * verify.mjs against sdk/golden-vector.json.
 *
 * Uses ethers' `AbiCoder.encode` (the JS equivalent of Solidity's
 * `abi.encode`), never `solidityPacked` — packed encoding is ambiguous for
 * a struct mixing several fixed-width types like this one.
 *
 * Standalone module: no dependency on anything under src/. Import directly
 * (`import { buildScreeningCommitment } from "../../sdk/ts/commitment.mjs"`)
 * whenever the frontend is ready to wire up /proof and /verify pages.
 */
import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";

export const SCHEMA_TAG = "ANEMIASCAN_SCREENING_COMMITMENT_V1";
export const SCHEMA_HASH = keccak256(toUtf8Bytes(SCHEMA_TAG));

const TYPES = [
  "bytes32", // schemaHash
  "bytes32", // scanIdHash
  "bytes32", // imageDigest
  "bytes32", // modelHash
  "uint8", // riskCode
  "uint8", // recommendationCode
  "uint16", // confidenceBps
  "uint16", // qualityBps
  "bytes32", // consentHash
  "uint64", // capturedAt
  "bytes32", // salt
];

const abiCoder = AbiCoder.defaultAbiCoder();

/**
 * @param {object} fields
 * @param {string} fields.scanIdHash
 * @param {string} fields.imageDigest
 * @param {string} fields.modelHash
 * @param {number} fields.riskCode
 * @param {number} fields.recommendationCode
 * @param {number} fields.confidenceBps
 * @param {number} fields.qualityBps
 * @param {string} fields.consentHash
 * @param {number|bigint} fields.capturedAt
 * @param {string} fields.salt
 * @returns {string} 0x-prefixed commitment hash
 */
export function buildScreeningCommitment(fields) {
  const encoded = abiCoder.encode(TYPES, [
    SCHEMA_HASH,
    fields.scanIdHash,
    fields.imageDigest,
    fields.modelHash,
    fields.riskCode,
    fields.recommendationCode,
    fields.confidenceBps,
    fields.qualityBps,
    fields.consentHash,
    fields.capturedAt,
    fields.salt,
  ]);
  return keccak256(encoded);
}
