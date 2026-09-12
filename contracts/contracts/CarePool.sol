// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AnemiaRegistry.sol";

/// @title CarePool
/// @notice Sponsor-funded pools that pay authorized clinics for confirmatory
/// follow-up care (CBC / haemoglobin testing), gated by a verified
/// AnemiaScan screening commitment. `issueCarePass` calling back into
/// `AnemiaRegistry.verifyScreening` is the load-bearing integration: a
/// CarePass cannot be issued against a screening that was never registered,
/// was tampered with, or was revoked. This is what makes MST part of the
/// product's actual state machine rather than an isolated demo transaction.
contract CarePool is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant CLINIC_ROLE = keccak256("CLINIC_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    AnemiaRegistry public immutable registry;

    struct Pool {
        address sponsor;
        uint256 totalFunded;
        uint256 totalReserved; // sum of value on Issued (unredeemed, uncancelled) passes
        uint256 totalRedeemed;
        bool active;
    }

    enum PassStatus {
        Issued,
        Redeemed,
        Cancelled
    }

    struct CarePass {
        uint256 poolId;
        bytes32 scanIdHash; // links back to the screening that justified this pass
        bytes32 passHash; // keccak256(abi.encode(secret)) of the off-chain token given to the patient
        uint256 value;
        address clinic; // zero until redeemed
        PassStatus status;
        uint64 issuedAt;
        uint64 settledAt;
    }

    uint256 private _nextPoolId = 1;
    uint256 private _nextPassId = 1;

    mapping(uint256 => Pool) private _pools;
    mapping(uint256 => CarePass) private _passes;
    mapping(bytes32 => uint256) private _passIdByHash; // passHash => passId (0 = none)
    mapping(address => bool) public authorizedClinic;
    mapping(address => uint256) public clinicBalance;

    event PoolCreated(uint256 indexed poolId, address indexed sponsor);
    event PoolFunded(uint256 indexed poolId, address indexed funder, uint256 amount);
    event PoolActiveSet(uint256 indexed poolId, bool active);
    event ClinicAuthorized(address indexed clinic, bool allowed);
    event CarePassIssued(
        uint256 indexed passId,
        uint256 indexed poolId,
        bytes32 indexed scanIdHash,
        bytes32 passHash,
        uint256 value
    );
    event CarePassRedeemed(uint256 indexed passId, address indexed clinic, uint256 value);
    event CarePassCancelled(uint256 indexed passId);
    event ClinicWithdrawal(address indexed clinic, uint256 amount);
    event PoolWithdrawal(uint256 indexed poolId, address indexed sponsor, uint256 amount);

    error PoolNotFound(uint256 poolId);
    error PoolInactive(uint256 poolId);
    error NotPoolSponsor(uint256 poolId, address caller);
    error InsufficientPoolFunds(uint256 poolId, uint256 available, uint256 requested);
    error ScreeningNotVerified(bytes32 scanIdHash);
    error PassHashAlreadyUsed(bytes32 passHash);
    error PassNotFound(uint256 passId);
    error PassNotIssued(uint256 passId);
    error ClinicNotAuthorized(address clinic);
    error NoBalance(address account);
    error ZeroValue();
    error TransferFailed();

    constructor(address admin, address registryAddress) {
        require(admin != address(0), "CarePool: zero admin");
        require(registryAddress != address(0), "CarePool: zero registry");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        registry = AnemiaRegistry(registryAddress);
    }

    /// @notice Opens a new pool under the caller's sponsorship. Permissionless
    /// by design — any wallet (via BridgeKey) can become a sponsor.
    function createPool() external whenNotPaused returns (uint256 poolId) {
        poolId = _nextPoolId++;
        _pools[poolId] = Pool({
            sponsor: msg.sender,
            totalFunded: 0,
            totalReserved: 0,
            totalRedeemed: 0,
            active: true
        });
        emit PoolCreated(poolId, msg.sender);
    }

    /// @notice Adds native MSTC to a pool. Anyone may top up any active pool.
    function fundPool(uint256 poolId) external payable whenNotPaused {
        Pool storage pool = _pools[poolId];
        if (pool.sponsor == address(0)) revert PoolNotFound(poolId);
        if (msg.value == 0) revert ZeroValue();
        pool.totalFunded += msg.value;
        emit PoolFunded(poolId, msg.sender, msg.value);
    }

    /// @notice Sponsor (or an admin) pauses/resumes a specific pool without
    /// touching any other pool.
    function setPoolActive(uint256 poolId, bool active) external {
        Pool storage pool = _pools[poolId];
        if (pool.sponsor == address(0)) revert PoolNotFound(poolId);
        if (pool.sponsor != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotPoolSponsor(poolId, msg.sender);
        }
        pool.active = active;
        emit PoolActiveSet(poolId, active);
    }

    function _availablePoolBalance(Pool storage pool) private view returns (uint256) {
        return pool.totalFunded - pool.totalReserved - pool.totalRedeemed;
    }

    /// @notice Issues a CarePass against `poolId`, only if `commitment` is a
    /// currently-verified (registered, unrevoked, matching) screening in
    /// AnemiaRegistry for `scanIdHash`. Reserves `value` from the pool so it
    /// can't be double-committed to another pass before this one settles.
    function issueCarePass(
        uint256 poolId,
        bytes32 scanIdHash,
        bytes32 commitment,
        bytes32 passHash,
        uint256 value
    ) external onlyRole(ISSUER_ROLE) whenNotPaused nonReentrant returns (uint256 passId) {
        Pool storage pool = _pools[poolId];
        if (pool.sponsor == address(0)) revert PoolNotFound(poolId);
        if (!pool.active) revert PoolInactive(poolId);
        if (value == 0) revert ZeroValue();
        if (_availablePoolBalance(pool) < value) {
            revert InsufficientPoolFunds(poolId, _availablePoolBalance(pool), value);
        }
        if (!registry.verifyScreening(scanIdHash, commitment)) revert ScreeningNotVerified(scanIdHash);
        if (_passIdByHash[passHash] != 0) revert PassHashAlreadyUsed(passHash);

        passId = _nextPassId++;
        _passes[passId] = CarePass({
            poolId: poolId,
            scanIdHash: scanIdHash,
            passHash: passHash,
            value: value,
            clinic: address(0),
            status: PassStatus.Issued,
            issuedAt: uint64(block.timestamp),
            settledAt: 0
        });
        _passIdByHash[passHash] = passId;
        pool.totalReserved += value;

        emit CarePassIssued(passId, poolId, scanIdHash, passHash, value);
    }

    /// @notice An authorized clinic redeems a CarePass by presenting the
    /// pre-image `secret` of its `passHash` (decoded from the
    /// ANEMIASCAN-CAREPASS|1|<token> the patient was given). One-time: the
    /// pass moves Issued -> Redeemed and can never be redeemed again. Pull-
    /// based settlement — value moves to `clinicBalance`, not a push
    /// transfer, so a clinic's own withdrawal failure can never block
    /// redemption.
    function redeemCarePass(bytes32 secret) external whenNotPaused nonReentrant returns (uint256 passId) {
        if (!authorizedClinic[msg.sender]) revert ClinicNotAuthorized(msg.sender);
        bytes32 passHash = keccak256(abi.encode(secret));
        passId = _passIdByHash[passHash];
        if (passId == 0) revert PassNotFound(passId);

        CarePass storage pass = _passes[passId];
        if (pass.status != PassStatus.Issued) revert PassNotIssued(passId);

        Pool storage pool = _pools[pass.poolId];
        pool.totalReserved -= pass.value;
        pool.totalRedeemed += pass.value;

        pass.status = PassStatus.Redeemed;
        pass.clinic = msg.sender;
        pass.settledAt = uint64(block.timestamp);

        clinicBalance[msg.sender] += pass.value;

        emit CarePassRedeemed(passId, msg.sender, pass.value);
    }

    /// @notice Issuer cancels an unredeemed pass (e.g. patient never
    /// followed up), releasing its reserved value back to the pool's
    /// available balance.
    function cancelCarePass(uint256 passId) external onlyRole(ISSUER_ROLE) nonReentrant {
        CarePass storage pass = _passes[passId];
        if (pass.issuedAt == 0) revert PassNotFound(passId);
        if (pass.status != PassStatus.Issued) revert PassNotIssued(passId);

        Pool storage pool = _pools[pass.poolId];
        pool.totalReserved -= pass.value;

        pass.status = PassStatus.Cancelled;
        pass.settledAt = uint64(block.timestamp);

        emit CarePassCancelled(passId);
    }

    function authorizeClinic(address clinic) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedClinic[clinic] = true;
        _grantRole(CLINIC_ROLE, clinic);
        emit ClinicAuthorized(clinic, true);
    }

    function revokeClinic(address clinic) external onlyRole(DEFAULT_ADMIN_ROLE) {
        authorizedClinic[clinic] = false;
        _revokeRole(CLINIC_ROLE, clinic);
        emit ClinicAuthorized(clinic, false);
    }

    function withdrawClinicBalance() external nonReentrant {
        uint256 amount = clinicBalance[msg.sender];
        if (amount == 0) revert NoBalance(msg.sender);
        clinicBalance[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit ClinicWithdrawal(msg.sender, amount);
    }

    /// @notice Sponsor withdraws unreserved, unredeemed funds back out of
    /// their own pool.
    function withdrawUnusedPoolFunds(uint256 poolId, uint256 amount) external nonReentrant {
        Pool storage pool = _pools[poolId];
        if (pool.sponsor == address(0)) revert PoolNotFound(poolId);
        if (pool.sponsor != msg.sender) revert NotPoolSponsor(poolId, msg.sender);
        uint256 available = _availablePoolBalance(pool);
        if (amount > available) revert InsufficientPoolFunds(poolId, available, amount);
        pool.totalFunded -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PoolWithdrawal(poolId, msg.sender, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        return _pools[poolId];
    }

    function getPass(uint256 passId) external view returns (CarePass memory) {
        return _passes[passId];
    }

    function passIdByHash(bytes32 passHash) external view returns (uint256) {
        return _passIdByHash[passHash];
    }

    receive() external payable {}
}
