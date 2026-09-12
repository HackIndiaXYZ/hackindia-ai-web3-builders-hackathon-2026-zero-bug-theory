// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AnemiaRegistry
/// @notice On-chain provenance registry for AnemiaScan screenings. Stores a
/// cryptographic commitment to a screening result (and the model version that
/// produced it), not the underlying eye photo, patient identity, or raw
/// prediction. Anyone can independently recompute a commitment off-chain from
/// the full result and confirm it matches what was registered here — that is
/// the tamper-evidence property this contract exists to provide.
///
/// This contract makes no claim that a registered prediction is clinically
/// correct. It only proves that a specific ATTESTER_ROLE-holding actor
/// committed to a specific set of bytes at a specific point in time, against
/// a specific, explicitly-registered model version.
contract AnemiaRegistry is AccessControl, Pausable {
    bytes32 public constant MODEL_MANAGER_ROLE = keccak256("MODEL_MANAGER_ROLE");
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Schema tag for the canonical screening commitment. Baked into
    /// `hashScreeningCommitment` rather than taken as a caller-supplied
    /// argument, so a caller cannot spoof a different schema version into a
    /// commitment that otherwise looks valid.
    bytes32 public constant SCHEMA_HASH = keccak256("ANEMIASCAN_SCREENING_COMMITMENT_V1");

    struct ModelVersion {
        bytes32 modelHash;
        string uri; // off-chain pointer (IPFS/URL) to a model card / weights manifest
        bool active;
        uint64 registeredAt;
    }

    struct Screening {
        bytes32 commitment;
        bytes32 modelHash;
        address attester;
        uint64 capturedAt;
        uint64 registeredAt;
        bool revoked;
    }

    mapping(bytes32 => ModelVersion) private _models; // modelHash => ModelVersion
    mapping(bytes32 => Screening) private _screenings; // scanIdHash => Screening

    event ModelRegistered(bytes32 indexed modelHash, string uri, uint64 registeredAt);
    event ModelActiveSet(bytes32 indexed modelHash, bool active);
    event ScreeningRegistered(
        bytes32 indexed scanIdHash,
        bytes32 indexed commitment,
        bytes32 indexed modelHash,
        address attester,
        uint64 capturedAt
    );
    event ScreeningRevoked(bytes32 indexed scanIdHash, address revokedBy);

    error ModelNotFound(bytes32 modelHash);
    error ModelInactive(bytes32 modelHash);
    error ModelAlreadyRegistered(bytes32 modelHash);
    error ScreeningAlreadyRegistered(bytes32 scanIdHash);
    error ScreeningNotFound(bytes32 scanIdHash);
    error ScreeningAlreadyRevoked(bytes32 scanIdHash);

    constructor(address admin) {
        require(admin != address(0), "AnemiaRegistry: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MODEL_MANAGER_ROLE, admin);
        _grantRole(ATTESTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @notice Registers a model version's hash and off-chain manifest pointer.
    /// A screening can only reference a model that has been registered here,
    /// so provenance is explicit rather than implied.
    function registerModel(bytes32 modelHash, string calldata uri)
        external
        onlyRole(MODEL_MANAGER_ROLE)
    {
        if (_models[modelHash].registeredAt != 0) revert ModelAlreadyRegistered(modelHash);
        _models[modelHash] = ModelVersion({
            modelHash: modelHash,
            uri: uri,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        emit ModelRegistered(modelHash, uri, uint64(block.timestamp));
    }

    /// @notice Activates or deactivates a model version. Screenings cannot be
    /// registered against an inactive model (e.g. one later found flawed),
    /// but past screenings against it remain readable and verifiable.
    function setModelActive(bytes32 modelHash, bool active) external onlyRole(MODEL_MANAGER_ROLE) {
        if (_models[modelHash].registeredAt == 0) revert ModelNotFound(modelHash);
        _models[modelHash].active = active;
        emit ModelActiveSet(modelHash, active);
    }

    /// @notice Registers a screening commitment. `scanIdHash` must be unique
    /// (one registration per scan); `commitment` is the
    /// ANEMIASCAN_SCREENING_COMMITMENT_V1 hash computed off-chain (and
    /// reproducible via `hashScreeningCommitment`) over the full result.
    function registerScreening(
        bytes32 scanIdHash,
        bytes32 commitment,
        bytes32 modelHash,
        uint64 capturedAt
    ) external onlyRole(ATTESTER_ROLE) whenNotPaused {
        ModelVersion storage model = _models[modelHash];
        if (model.registeredAt == 0) revert ModelNotFound(modelHash);
        if (!model.active) revert ModelInactive(modelHash);
        if (_screenings[scanIdHash].registeredAt != 0) revert ScreeningAlreadyRegistered(scanIdHash);

        _screenings[scanIdHash] = Screening({
            commitment: commitment,
            modelHash: modelHash,
            attester: msg.sender,
            capturedAt: capturedAt,
            registeredAt: uint64(block.timestamp),
            revoked: false
        });

        emit ScreeningRegistered(scanIdHash, commitment, modelHash, msg.sender, capturedAt);
    }

    /// @notice Marks a screening revoked (e.g. bad capture, later found
    /// fraudulent). Revoked screenings fail `verifyScreening` and so can no
    /// longer be used to issue a CarePass, but the record itself is kept for
    /// audit rather than deleted.
    function revokeScreening(bytes32 scanIdHash) external onlyRole(ATTESTER_ROLE) {
        Screening storage s = _screenings[scanIdHash];
        if (s.registeredAt == 0) revert ScreeningNotFound(scanIdHash);
        if (s.revoked) revert ScreeningAlreadyRevoked(scanIdHash);
        s.revoked = true;
        emit ScreeningRevoked(scanIdHash, msg.sender);
    }

    /// @notice True iff `scanIdHash` was registered, is not revoked, and its
    /// stored commitment matches `commitment` exactly. This is both the
    /// public tamper-check judges can run and the on-chain gate CarePool
    /// calls before issuing a CarePass.
    function verifyScreening(bytes32 scanIdHash, bytes32 commitment) external view returns (bool) {
        Screening storage s = _screenings[scanIdHash];
        return s.registeredAt != 0 && !s.revoked && s.commitment == commitment;
    }

    function getModel(bytes32 modelHash) external view returns (ModelVersion memory) {
        return _models[modelHash];
    }

    function getScreening(bytes32 scanIdHash) external view returns (Screening memory) {
        return _screenings[scanIdHash];
    }

    /// @notice Pure reference implementation of ANEMIASCAN_SCREENING_COMMITMENT_V1.
    /// This is the ground truth: off-chain Python/TypeScript implementations
    /// must reproduce this exact value for the same inputs, verified against
    /// each other via a shared golden-vector fixture (see
    /// sdk/golden-vector.json). Uses `abi.encode` (never `abi.encodePacked`,
    /// which is ambiguous for a mix of dynamic and fixed-width fields).
    function hashScreeningCommitment(
        bytes32 scanIdHash,
        bytes32 imageDigest,
        bytes32 modelHash,
        uint8 riskCode,
        uint8 recommendationCode,
        uint16 confidenceBps,
        uint16 qualityBps,
        bytes32 consentHash,
        uint64 capturedAt,
        bytes32 salt
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    SCHEMA_HASH,
                    scanIdHash,
                    imageDigest,
                    modelHash,
                    riskCode,
                    recommendationCode,
                    confidenceBps,
                    qualityBps,
                    consentHash,
                    capturedAt,
                    salt
                )
            );
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
