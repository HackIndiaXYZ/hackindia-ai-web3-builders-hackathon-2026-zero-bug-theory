/**
 * Post-deploy setup: registers the mock model version AnemiaRegistry needs
 * before any screening can reference it, and (optionally) grants
 * ATTESTER_ROLE / ISSUER_ROLE to a separate backend signer address if one is
 * given via BACKEND_SIGNER_ADDRESS. Without that env var, the deployer key
 * itself is used as attester/issuer, which is fine for a hackathon demo
 * where one funded key runs everything.
 *
 * Usage:
 *   npm run grant-roles:testnet
 *   BACKEND_SIGNER_ADDRESS=0x... npm run grant-roles:testnet
 */
import fs from "fs";
import path from "path";
import hre from "hardhat";
import { ethers } from "hardhat";

// Sentinel model hash for the hackathon's deterministic mock inference
// provider. NOT a real trained model — see docs/DEPLOYMENT.md.
export const MOCK_MODEL_HASH = ethers.keccak256(ethers.toUtf8Bytes("ANEMIASCAN_MOCK_MODEL_V0_DEMO_ONLY"));
export const MOCK_MODEL_URI = "demo://mock-inference-provider-v0";

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
  const carePool = await ethers.getContractAt("CarePool", entry.CarePool.address);

  console.log("Admin:", admin.address);
  console.log("AnemiaRegistry:", entry.AnemiaRegistry.address);
  console.log("CarePool:", entry.CarePool.address);

  const existing = await registry.getModel(MOCK_MODEL_HASH);
  if (existing.registeredAt === 0n) {
    console.log("\nRegistering mock model", MOCK_MODEL_HASH);
    await (await registry.connect(admin).registerModel(MOCK_MODEL_HASH, MOCK_MODEL_URI)).wait();
    console.log("✓ Mock model registered");
  } else {
    console.log("\nMock model already registered, skipping.");
  }

  const backendSigner = process.env.BACKEND_SIGNER_ADDRESS;
  if (backendSigner) {
    console.log(`\nGranting ATTESTER_ROLE + ISSUER_ROLE to backend signer ${backendSigner}...`);
    const ATTESTER_ROLE = await registry.ATTESTER_ROLE();
    const ISSUER_ROLE = await carePool.ISSUER_ROLE();
    await (await registry.connect(admin).grantRole(ATTESTER_ROLE, backendSigner)).wait();
    await (await carePool.connect(admin).grantRole(ISSUER_ROLE, backendSigner)).wait();
    console.log("✓ Roles granted");
  } else {
    console.log(
      "\nBACKEND_SIGNER_ADDRESS not set — the deployer key itself already holds ATTESTER_ROLE and ISSUER_ROLE " +
        "from the constructor, so backend/.env can reuse contracts/.env.local's PRIVATE_KEY for MST_ATTESTER_PRIVATE_KEY.",
    );
  }

  console.log(`\nMock model hash (put in backend/.env as MST_MOCK_MODEL_HASH): ${MOCK_MODEL_HASH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
