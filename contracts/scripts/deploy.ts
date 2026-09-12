/**
 * Deploys AnemiaRegistry then CarePool (wired to the registry address) and
 * writes the result to contracts/deployments.json plus prints an .env-ready
 * summary for backend/.env. Safe to re-run per network — each run appends/
 * overwrites only that network's entry.
 *
 * Usage:
 *   npm run deploy:testnet     (needs PRIVATE_KEY in contracts/.env.local, funded via the MST faucet)
 *   npm run deploy:local       (hardhat node running in another terminal)
 */
import fs from "fs";
import path from "path";
import hre from "hardhat";
import { ethers } from "hardhat";

const DEPLOYMENTS_PATH = path.join(__dirname, "..", "deployments.json");

type Deployments = Record<
  string,
  {
    chainId: number;
    deployer: string;
    deployedAt: string;
    AnemiaRegistry: { address: string };
    CarePool: { address: string };
  }
>;

function readDeployments(): Deployments {
  if (!fs.existsSync(DEPLOYMENTS_PATH)) return {};
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, "utf8"));
}

async function main() {
  const network = hre.network.name;

  if (network !== "hardhat" && network !== "localhost" && !process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not set. Copy contracts/.env.example to contracts/.env.local and set it.");
  }

  const [deployer] = await ethers.getSigners();
  console.log(`\nDeploying to ${network} (chainId ${hre.network.config.chainId ?? "?"})`);
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "native token");
  if (balance === 0n && network !== "hardhat") {
    throw new Error(
      `Deployer ${deployer.address} has zero balance on ${network}. Fund it from https://faucet.mstblockchain.com first.`,
    );
  }

  console.log("\nDeploying AnemiaRegistry...");
  const RegistryFactory = await ethers.getContractFactory("AnemiaRegistry");
  const registry = await RegistryFactory.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("AnemiaRegistry deployed to:", registryAddress);

  console.log("\nDeploying CarePool...");
  const CarePoolFactory = await ethers.getContractFactory("CarePool");
  const carePool = await CarePoolFactory.deploy(deployer.address, registryAddress);
  await carePool.waitForDeployment();
  const carePoolAddress = await carePool.getAddress();
  console.log("CarePool deployed to:", carePoolAddress);

  const all = readDeployments();
  all[network] = {
    chainId: Number(hre.network.config.chainId ?? 0),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    AnemiaRegistry: { address: registryAddress },
    CarePool: { address: carePoolAddress },
  };
  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(all, null, 2) + "\n");

  console.log("\n✓ Deployment recorded in contracts/deployments.json");
  console.log("\nAdd these to backend/.env:");
  console.log(`MST_ANEMIA_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`MST_CARE_POOL_ADDRESS=${carePoolAddress}`);

  if (network === "testnet") {
    console.log(`\nExplorer:`);
    console.log(`  https://testnet.mstscan.com/address/${registryAddress}`);
    console.log(`  https://testnet.mstscan.com/address/${carePoolAddress}`);
    console.log(`\nNext: npm run grant-roles:testnet, then npm run verify:testnet -- <address> <constructor args>`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
