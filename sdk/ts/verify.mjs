/**
 * Three-way parity check: this file is the TypeScript/JS leg. The Solidity
 * leg (ground truth) is contracts/scripts/printCommitmentVector.ts, which
 * writes ../golden-vector.json; the Python leg is
 * backend/tests/test_commitment.py. Run with `npm run verify`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildScreeningCommitment, SCHEMA_HASH } from "./commitment.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectorPath = join(__dirname, "..", "golden-vector.json");

const vector = JSON.parse(readFileSync(vectorPath, "utf8"));

if (SCHEMA_HASH !== vector.schemaHash) {
  console.error(`FAIL: SCHEMA_HASH mismatch\n  expected ${vector.schemaHash}\n  got      ${SCHEMA_HASH}`);
  process.exit(1);
}

const commitment = buildScreeningCommitment(vector.fields);

if (commitment !== vector.expectedCommitment) {
  console.error(
    `FAIL: commitment mismatch\n  expected ${vector.expectedCommitment}\n  got      ${commitment}\n` +
      "TypeScript and Solidity disagree on the commitment encoding — do not deploy.",
  );
  process.exit(1);
}

console.log("OK: TypeScript commitment matches the Solidity-generated golden vector");
console.log("  schemaHash: ", SCHEMA_HASH);
console.log("  commitment: ", commitment);
