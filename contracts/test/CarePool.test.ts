import { expect } from "chai";
import { ethers } from "hardhat";
import { AnemiaRegistry, CarePool } from "../typechain-types";

const MODEL_HASH = ethers.keccak256(ethers.toUtf8Bytes("anemiascan-mock-model-v0"));
const MODEL_URI = "ipfs://mock-model-card";
const SCAN_ID_HASH = ethers.keccak256(ethers.toUtf8Bytes("scan-001"));
const COMMITMENT = ethers.keccak256(ethers.toUtf8Bytes("commitment-1"));

function passHashOf(secret: string) {
  // Mirrors the contract: keccak256(abi.encode(bytes32 secret))
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [secret]));
}

describe("CarePool", () => {
  async function deploy() {
    const [admin, attester, issuer, sponsor, clinic, otherClinic] = await ethers.getSigners();

    const RegistryFactory = await ethers.getContractFactory("AnemiaRegistry");
    const registry = (await RegistryFactory.deploy(admin.address)) as unknown as AnemiaRegistry;
    await registry.waitForDeployment();

    const ATTESTER_ROLE = await registry.ATTESTER_ROLE();
    await registry.connect(admin).grantRole(ATTESTER_ROLE, attester.address);
    await registry.connect(admin).registerModel(MODEL_HASH, MODEL_URI);
    const capturedAt = BigInt(Math.floor(Date.now() / 1000));
    await registry.connect(attester).registerScreening(SCAN_ID_HASH, COMMITMENT, MODEL_HASH, capturedAt);

    const CarePoolFactory = await ethers.getContractFactory("CarePool");
    const carePool = (await CarePoolFactory.deploy(
      admin.address,
      await registry.getAddress(),
    )) as unknown as CarePool;
    await carePool.waitForDeployment();

    const ISSUER_ROLE = await carePool.ISSUER_ROLE();
    await carePool.connect(admin).grantRole(ISSUER_ROLE, issuer.address);
    await carePool.connect(admin).authorizeClinic(clinic.address);

    return { registry, carePool, admin, attester, issuer, sponsor, clinic, otherClinic };
  }

  it("full lifecycle: create, fund, issue against a verified screening, redeem, withdraw", async () => {
    const { carePool, issuer, sponsor, clinic } = await deploy();

    await expect(carePool.connect(sponsor).createPool()).to.emit(carePool, "PoolCreated").withArgs(1n, sponsor.address);

    const fundAmount = ethers.parseEther("1.0");
    await expect(carePool.connect(sponsor).fundPool(1, { value: fundAmount }))
      .to.emit(carePool, "PoolFunded")
      .withArgs(1n, sponsor.address, fundAmount);

    const secret = ethers.keccak256(ethers.toUtf8Bytes("patient-secret-1"));
    const passHash = passHashOf(secret);
    const value = ethers.parseEther("0.1");

    await expect(carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, COMMITMENT, passHash, value))
      .to.emit(carePool, "CarePassIssued")
      .withArgs(1n, 1n, SCAN_ID_HASH, passHash, value);

    const poolAfterIssue = await carePool.getPool(1);
    expect(poolAfterIssue.totalReserved).to.equal(value);

    await expect(carePool.connect(clinic).redeemCarePass(secret))
      .to.emit(carePool, "CarePassRedeemed")
      .withArgs(1n, clinic.address, value);

    const poolAfterRedeem = await carePool.getPool(1);
    expect(poolAfterRedeem.totalReserved).to.equal(0n);
    expect(poolAfterRedeem.totalRedeemed).to.equal(value);

    expect(await carePool.clinicBalance(clinic.address)).to.equal(value);

    const before = await ethers.provider.getBalance(clinic.address);
    const tx = await carePool.connect(clinic).withdrawClinicBalance();
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(clinic.address);
    expect(after).to.equal(before + value - gasCost);
    expect(await carePool.clinicBalance(clinic.address)).to.equal(0n);
  });

  it("rejects issueCarePass when the screening is not verified (wrong commitment)", async () => {
    const { carePool, issuer, sponsor } = await deploy();
    await carePool.connect(sponsor).createPool();
    await carePool.connect(sponsor).fundPool(1, { value: ethers.parseEther("1.0") });

    const wrongCommitment = ethers.ZeroHash;
    const passHash = passHashOf(ethers.keccak256(ethers.toUtf8Bytes("secret")));

    await expect(
      carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, wrongCommitment, passHash, ethers.parseEther("0.1")),
    ).to.be.revertedWithCustomError(carePool, "ScreeningNotVerified");
  });

  it("rejects issueCarePass when the screening was revoked after being valid", async () => {
    const { carePool, registry, attester, issuer, sponsor } = await deploy();
    await carePool.connect(sponsor).createPool();
    await carePool.connect(sponsor).fundPool(1, { value: ethers.parseEther("1.0") });

    await registry.connect(attester).revokeScreening(SCAN_ID_HASH);

    const passHash = passHashOf(ethers.keccak256(ethers.toUtf8Bytes("secret")));
    await expect(
      carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, COMMITMENT, passHash, ethers.parseEther("0.1")),
    ).to.be.revertedWithCustomError(carePool, "ScreeningNotVerified");
  });

  it("rejects issuance beyond available pool balance", async () => {
    const { carePool, issuer, sponsor } = await deploy();
    await carePool.connect(sponsor).createPool();
    await carePool.connect(sponsor).fundPool(1, { value: ethers.parseEther("0.05") });

    const passHash = passHashOf(ethers.keccak256(ethers.toUtf8Bytes("secret")));
    await expect(
      carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, COMMITMENT, passHash, ethers.parseEther("0.1")),
    ).to.be.revertedWithCustomError(carePool, "InsufficientPoolFunds");
  });

  it("prevents double redemption and redemption by an unauthorized clinic", async () => {
    const { carePool, issuer, sponsor, clinic, otherClinic } = await deploy();
    await carePool.connect(sponsor).createPool();
    await carePool.connect(sponsor).fundPool(1, { value: ethers.parseEther("1.0") });

    const secret = ethers.keccak256(ethers.toUtf8Bytes("secret"));
    const passHash = passHashOf(secret);
    await carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, COMMITMENT, passHash, ethers.parseEther("0.1"));

    await expect(carePool.connect(otherClinic).redeemCarePass(secret)).to.be.revertedWithCustomError(
      carePool,
      "ClinicNotAuthorized",
    );

    await carePool.connect(clinic).redeemCarePass(secret);
    await expect(carePool.connect(clinic).redeemCarePass(secret)).to.be.revertedWithCustomError(
      carePool,
      "PassNotIssued",
    );
  });

  it("rejects re-using a passHash across two issuances", async () => {
    const { carePool, issuer, sponsor } = await deploy();
    await carePool.connect(sponsor).createPool();
    await carePool.connect(sponsor).fundPool(1, { value: ethers.parseEther("1.0") });

    const passHash = passHashOf(ethers.keccak256(ethers.toUtf8Bytes("secret")));
    await carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, COMMITMENT, passHash, ethers.parseEther("0.1"));

    await expect(
      carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, COMMITMENT, passHash, ethers.parseEther("0.1")),
    ).to.be.revertedWithCustomError(carePool, "PassHashAlreadyUsed");
  });

  it("cancelCarePass releases reserved value back to the pool and blocks later redemption", async () => {
    const { carePool, issuer, sponsor, clinic } = await deploy();
    await carePool.connect(sponsor).createPool();
    await carePool.connect(sponsor).fundPool(1, { value: ethers.parseEther("1.0") });

    const secret = ethers.keccak256(ethers.toUtf8Bytes("secret"));
    const passHash = passHashOf(secret);
    const value = ethers.parseEther("0.1");
    await carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, COMMITMENT, passHash, value);

    await expect(carePool.connect(issuer).cancelCarePass(1)).to.emit(carePool, "CarePassCancelled").withArgs(1n);

    const pool = await carePool.getPool(1);
    expect(pool.totalReserved).to.equal(0n);

    await expect(carePool.connect(clinic).redeemCarePass(secret)).to.be.revertedWithCustomError(
      carePool,
      "PassNotIssued",
    );
  });

  it("only the pool's sponsor can withdraw its unused funds", async () => {
    const { carePool, sponsor, clinic } = await deploy();
    await carePool.connect(sponsor).createPool();
    const fundAmount = ethers.parseEther("1.0");
    await carePool.connect(sponsor).fundPool(1, { value: fundAmount });

    await expect(
      carePool.connect(clinic).withdrawUnusedPoolFunds(1, fundAmount),
    ).to.be.revertedWithCustomError(carePool, "NotPoolSponsor");

    const before = await ethers.provider.getBalance(sponsor.address);
    const tx = await carePool.connect(sponsor).withdrawUnusedPoolFunds(1, fundAmount);
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(sponsor.address);
    expect(after).to.equal(before + fundAmount - gasCost);
  });

  it("revoking clinic authorization blocks further redemptions", async () => {
    const { carePool, admin, issuer, sponsor, clinic } = await deploy();
    await carePool.connect(sponsor).createPool();
    await carePool.connect(sponsor).fundPool(1, { value: ethers.parseEther("1.0") });

    const secret = ethers.keccak256(ethers.toUtf8Bytes("secret"));
    const passHash = passHashOf(secret);
    await carePool.connect(issuer).issueCarePass(1, SCAN_ID_HASH, COMMITMENT, passHash, ethers.parseEther("0.1"));

    await carePool.connect(admin).revokeClinic(clinic.address);
    await expect(carePool.connect(clinic).redeemCarePass(secret)).to.be.revertedWithCustomError(
      carePool,
      "ClinicNotAuthorized",
    );
  });
});
