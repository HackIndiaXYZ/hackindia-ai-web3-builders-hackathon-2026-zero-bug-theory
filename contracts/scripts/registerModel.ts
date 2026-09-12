/**
 * Registers the REAL model version on AnemiaRegistry.
 *
 * `registerScreening` reverts with `ModelNotFound` unless the modelHash the
 * backend attests under was registered here first, and with `ModelInactive` if
 * it was later switched off. grantRoles.ts registers only MOCK_MODEL_HASH, so
 * with INFERENCE_PROVIDER=real (what backend/.env.example ships) the first
 * genuine screening would broadcast a transaction that reverts on-chain and
 * lose the anchor for a result the user already saw. This script is therefore a
 * required step between deploying and the first real screening — not an
 * optional extra.
 *
 * The hash is deliberately NOT hardcoded here. It is derived from the weights
 * themselves: backend/app/ml/manifest.py sha256s every asset the runtime loads
 * and writes contracts/model-manifest.json, whose `model_hash` is keccak256 of
 * the canonical manifest text. Retyping that constant into a script is exactly
 * how the chain, the model card and the running service drift apart, so we read
 * it from the manifest and re-derive it from `canonical_text` as a check.
 *
 * Usage:
 *   npm run register-model:testnet
 *   MODEL_URI=ipfs://<cid> npm run register-model:testnet
 *
 * If contracts/model-manifest.json is missing or stale, regenerate it from the
 * installed bundle — from backend/:
 *   python -m app.ml.manifest --json ../contracts/model-manifest.json
 */
import fs from "fs";
import path from "path";
import hre from "hardhat";
import { ethers } from "hardhat";

// Where `python -m app.ml.manifest --json ...` is expected to have written the
// weights manifest. Overridable so a CI job can point at one built elsewhere.
const MANIFEST_PATH = process.env.MODEL_MANIFEST_PATH
  ? path.resolve(process.env.MODEL_MANIFEST_PATH)
  : path.join(__dirname, "..", "model-manifest.json");

// Off-chain pointer stored next to the hash (ModelVersion.uri). A deployment
// meant to outlive the hackathon should set MODEL_URI to something durable —
// an IPFS CID for the manifest, or a URL to MODEL_CARD.md — so a third party
// can fetch the file list this hash commits to. The default at least names the
// bundle instead of being empty.
const MODEL_URI = process.env.MODEL_URI || "manifest://anemiascan-v3.1+roi1+gate1/model-manifest.json";

type ModelManifest = {
  schema?: string;
  model_hash?: string;
  canonical_text?: string;
  files?: { path: string; sha256: string; bytes: number }[];
};

const REGENERATE_HINT =
  "Regenerate it from the installed weights — from backend/:\n" +
  "  python -m app.ml.manifest --json ../contracts/model-manifest.json";

function readModelHash(): string {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`No model manifest at ${MANIFEST_PATH}.\n${REGENERATE_HINT}`);
  }

  const manifest: ModelManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const modelHash = manifest.model_hash;
  if (typeof modelHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(modelHash)) {
    throw new Error(
      `model_hash missing or malformed in ${MANIFEST_PATH} (got ${JSON.stringify(modelHash)}).\n${REGENERATE_HINT}`,
    );
  }

  // Re-derive rather than trust the JSON: model_hash is keccak256 of the UTF-8
  // canonical_text (see backend/app/ml/manifest.py). A hand-edited manifest, or
  // one whose hash was pasted over from an older bundle, fails loudly here
  // instead of anchoring a hash no running model can ever reproduce.
  if (typeof manifest.canonical_text === "string" && manifest.canonical_text.length > 0) {
    const derived = ethers.keccak256(ethers.toUtf8Bytes(manifest.canonical_text));
    if (derived.toLowerCase() !== modelHash.toLowerCase()) {
      throw new Error(
        `${MANIFEST_PATH} is inconsistent: model_hash is ${modelHash} but keccak256(canonical_text) ` +
          `is ${derived}. Do not register either value by hand.\n${REGENERATE_HINT}`,
      );
    }
  } else {
    console.warn(
      `! ${MANIFEST_PATH} has no canonical_text, so its model_hash could not be re-derived. ` +
        "Registering it as-is.",
    );
  }

  // Printed so the operator can see exactly which bytes this hash commits to
  // before they anchor it — the same list that lands in MODEL_CARD.md.
  if (Array.isArray(manifest.files)) {
    for (const entry of manifest.files) {
      console.log(`  ${entry.sha256}  ${String(entry.bytes).padStart(10)}  ${entry.path}`);
    }
  }

  return modelHash;
}

async function main() {
  const network = hre.network.name;
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployments.json found. Run npm run deploy:${network} first.`);
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const entry = deployments[network];
  if (!entry) throw new Error(`No deployment recorded for network "${network}" in deployments.json.`);

  const [admin] = await ethers.getSigners();
  const registry = await ethers.getContractAt("AnemiaRegistry", entry.AnemiaRegistry.address);

  console.log("Admin:", admin.address);
  console.log("AnemiaRegistry:", entry.AnemiaRegistry.address);
  console.log("Manifest:", MANIFEST_PATH);

  const modelHash = readModelHash();

  console.log("Model hash:", modelHash);
  console.log("Model URI:", MODEL_URI);

  const existing = await registry.getModel(modelHash);
  if (existing.registeredAt !== 0n) {
    const registeredAt = new Date(Number(existing.registeredAt) * 1000).toISOString();
    console.log(`\nModel already registered at ${registeredAt} (uri: ${existing.uri}) — skipping.`);
    if (!existing.active) {
      // Not auto-fixed: a deactivation is a deliberate act (e.g. a version
      // found flawed), and silently flipping it back here would undo someone's
      // decision from a setup script.
      console.warn(
        "! This model version is registered but INACTIVE — registerScreening will revert with " +
          "ModelInactive. If that deactivation is no longer intended, re-enable it deliberately " +
          "with setModelActive(modelHash, true).",
      );
    }
  } else {
    // Turn the opaque AccessControlUnauthorizedAccount revert into something an
    // operator can act on. The deployer holds MODEL_MANAGER_ROLE from the
    // constructor, so this usually means the wrong PRIVATE_KEY is loaded.
    const MODEL_MANAGER_ROLE = await registry.MODEL_MANAGER_ROLE();
    if (!(await registry.hasRole(MODEL_MANAGER_ROLE, admin.address))) {
      throw new Error(
        `${admin.address} does not hold MODEL_MANAGER_ROLE on ${entry.AnemiaRegistry.address}. ` +
          "Run this with the deployer key from contracts/.env.local (it receives the role in the " +
          "constructor), or have an existing admin grant it first.",
      );
    }

    console.log("\nRegistering real model", modelHash);
    await (await registry.connect(admin).registerModel(modelHash, MODEL_URI)).wait();
    console.log("✓ Real model registered");
  }

  console.log(`\nReal model hash: ${modelHash}`);
  console.log(
    "The backend re-derives this same hash from app/ml/model_assets/ on every start, so backend/.env " +
      "needs no change. Set MST_REAL_MODEL_HASH to the value above only if you want the attested hash " +
      "pinned explicitly — it OVERRIDES the derived one, so a stale pin would anchor screenings under a " +
      "model hash that does not match the weights actually running.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
