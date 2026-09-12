import { expect } from "chai";
import { ethers } from "hardhat";
import { AnemiaRegistry } from "../typechain-types";

const MODEL_HASH = ethers.keccak256(ethers.toUtf8Bytes("anemiascan-mock-model-v0"));
const MODEL_URI = "ipfs://mock-model-card";
const SCAN_ID_HASH = ethers.keccak256(ethers.toUtf8Bytes("scan-001"));

describe("AnemiaRegistry", () => {
  async function deploy() {
    const [admin, attester, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("AnemiaRegistry");
    const registry = (await Factory.deploy(admin.address)) as unknown as AnemiaRegistry;
    await registry.waitForDeployment();

    const ATTESTER_ROLE = await registry.ATTESTER_ROLE();
    await (await registry.connect(admin).grantRole(ATTESTER_ROLE, attester.address)).wait();

    return { registry, admin, attester, other };
  }

  it("registers a model and rejects a duplicate registration", async () => {
    const { registry, admin } = await deploy();
    await expect(registry.connect(admin).registerModel(MODEL_HASH, MODEL_URI))
      .to.emit(registry, "ModelRegistered");

    await expect(registry.connect(admin).registerModel(MODEL_HASH, MODEL_URI)).to.be.revertedWithCustomError(
      registry,
      "ModelAlreadyRegistered",
    );
  });

  it("rejects registerModel from a non-MODEL_MANAGER_ROLE caller", async () => {
    const { registry, other } = await deploy();
    await expect(registry.connect(other).registerModel(MODEL_HASH, MODEL_URI)).to.be.reverted;
  });

  it("registers a screening only against an active, registered model", async () => {
    const { registry, admin, attester } = await deploy();
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-1"));
    const capturedAt = BigInt(Math.floor(Date.now() / 1000));

    // Model not yet registered.
    await expect(
      registry.connect(attester).registerScreening(SCAN_ID_HASH, commitment, MODEL_HASH, capturedAt),
    ).to.be.revertedWithCustomError(registry, "ModelNotFound");

    await registry.connect(admin).registerModel(MODEL_HASH, MODEL_URI);

    await expect(registry.connect(attester).registerScreening(SCAN_ID_HASH, commitment, MODEL_HASH, capturedAt))
      .to.emit(registry, "ScreeningRegistered")
      .withArgs(SCAN_ID_HASH, commitment, MODEL_HASH, attester.address, capturedAt);

    expect(await registry.verifyScreening(SCAN_ID_HASH, commitment)).to.equal(true);
    expect(await registry.verifyScreening(SCAN_ID_HASH, ethers.ZeroHash)).to.equal(false);
  });

  it("rejects a duplicate screening registration and registration against an inactive model", async () => {
    const { registry, admin, attester } = await deploy();
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-1"));
    const capturedAt = BigInt(Math.floor(Date.now() / 1000));

    await registry.connect(admin).registerModel(MODEL_HASH, MODEL_URI);
    await registry.connect(attester).registerScreening(SCAN_ID_HASH, commitment, MODEL_HASH, capturedAt);

    await expect(
      registry.connect(attester).registerScreening(SCAN_ID_HASH, commitment, MODEL_HASH, capturedAt),
    ).to.be.revertedWithCustomError(registry, "ScreeningAlreadyRegistered");

    await registry.connect(admin).setModelActive(MODEL_HASH, false);
    const otherScanId = ethers.keccak256(ethers.toUtf8Bytes("scan-002"));
    await expect(
      registry.connect(attester).registerScreening(otherScanId, commitment, MODEL_HASH, capturedAt),
    ).to.be.revertedWithCustomError(registry, "ModelInactive");
  });

  it("revoked screenings fail verifyScreening but remain readable", async () => {
    const { registry, admin, attester } = await deploy();
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-1"));
    const capturedAt = BigInt(Math.floor(Date.now() / 1000));

    await registry.connect(admin).registerModel(MODEL_HASH, MODEL_URI);
    await registry.connect(attester).registerScreening(SCAN_ID_HASH, commitment, MODEL_HASH, capturedAt);

    await expect(registry.connect(attester).revokeScreening(SCAN_ID_HASH)).to.emit(registry, "ScreeningRevoked");
    expect(await registry.verifyScreening(SCAN_ID_HASH, commitment)).to.equal(false);

    const stored = await registry.getScreening(SCAN_ID_HASH);
    expect(stored.revoked).to.equal(true);
    expect(stored.commitment).to.equal(commitment);

    await expect(registry.connect(attester).revokeScreening(SCAN_ID_HASH)).to.be.revertedWithCustomError(
      registry,
      "ScreeningAlreadyRevoked",
    );
  });

  it("pause blocks registerScreening and unpause restores it", async () => {
    const { registry, admin, attester } = await deploy();
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("commitment-1"));
    const capturedAt = BigInt(Math.floor(Date.now() / 1000));
    await registry.connect(admin).registerModel(MODEL_HASH, MODEL_URI);

    await registry.connect(admin).pause();
    await expect(
      registry.connect(attester).registerScreening(SCAN_ID_HASH, commitment, MODEL_HASH, capturedAt),
    ).to.be.revertedWithCustomError(registry, "EnforcedPause");

    await registry.connect(admin).unpause();
    await expect(registry.connect(attester).registerScreening(SCAN_ID_HASH, commitment, MODEL_HASH, capturedAt)).to
      .not.be.reverted;
  });

  it("hashScreeningCommitment is a deterministic pure function of its inputs", async () => {
    const { registry } = await deploy();
    const args = [
      SCAN_ID_HASH,
      ethers.keccak256(ethers.toUtf8Bytes("image-digest")),
      MODEL_HASH,
      1,
      2,
      9500,
      8800,
      ethers.keccak256(ethers.toUtf8Bytes("consent")),
      1234567890n,
      ethers.keccak256(ethers.toUtf8Bytes("salt")),
    ] as const;

    const a = await registry.hashScreeningCommitment(...args);
    const b = await registry.hashScreeningCommitment(...args);
    expect(a).to.equal(b);

    const differentSalt = await registry.hashScreeningCommitment(
      ...([...args.slice(0, 9), ethers.keccak256(ethers.toUtf8Bytes("different-salt"))] as unknown as typeof args),
    );
    expect(differentSalt).to.not.equal(a);
  });
});
