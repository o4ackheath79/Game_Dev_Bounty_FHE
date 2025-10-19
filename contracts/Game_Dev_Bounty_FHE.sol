pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GameDevBountyFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error InvalidState();
    error TooFrequent();
    error BatchClosed();
    error BatchFull();
    error InvalidRequest();
    error StaleWrite();
    error NotInitialized();

    address public owner;
    bool public paused;
    uint256 public constant MIN_INTERVAL = 5 minutes;
    uint256 public cooldownSeconds = 300; // 5 minutes default
    uint256 public maxSubmissionsPerBatch = 10;

    mapping(address => uint256) public lastSubmissionAt;
    mapping(address => uint256) public lastDecryptionRequestAt;
    mapping(address => bool) public isProvider;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => uint256) public batchSubmissionCount;
    mapping(uint256 => mapping(uint256 => Submission)) public submissions;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(uint256 => uint256) public modelVersions;
    mapping(uint256 => bool) public processedRequests;

    euint32 public encryptedTotalScore;
    uint256 public currentBatchId;
    uint256 public totalBatches;
    uint256 public totalSubmissions;

    struct Submission {
        address submitter;
        euint32 encryptedScore;
        uint256 timestamp;
        uint256 batchId;
        uint256 modelVersion;
    }

    struct Batch {
        uint256 id;
        uint256 openedAt;
        uint256 closedAt;
        bool isOpen;
        uint256 totalSubmissions;
        euint32 encryptedAggregateScore;
    }

    struct DecryptionContext {
        uint256 batchId;
        uint256 modelVersion;
        bytes32 stateHash;
        bool processed;
        address requester;
    }

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId, uint256 openedAt);
    event BatchClosed(uint256 indexed batchId, uint256 closedAt, uint256 totalSubmissions);
    event SubmissionAdded(address indexed submitter, uint256 indexed batchId, uint256 submissionId, uint256 timestamp);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, address indexed requester, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 decryptedScore, uint256 timestamp);
    event MaxSubmissionsPerBatchUpdated(uint256 oldMax, uint256 newMax);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionCooldown(address submitter) {
        if (block.timestamp < lastSubmissionAt[submitter] + cooldownSeconds) {
            revert TooFrequent();
        }
        _;
    }

    modifier decryptionRequestCooldown(address requester) {
        if (block.timestamp < lastDecryptionRequestAt[requester] + cooldownSeconds) {
            revert TooFrequent();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        encryptedTotalScore = FHE.asEuint32(0);
        currentBatchId = 1;
        totalBatches = 0;
        totalSubmissions = 0;
        _openBatch(currentBatchId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldown(uint256 newCooldownSeconds) external onlyOwner {
        emit CooldownUpdated(cooldownSeconds, newCooldownSeconds);
        cooldownSeconds = newCooldownSeconds;
    }

    function setMaxSubmissionsPerBatch(uint256 newMax) external onlyOwner {
        emit MaxSubmissionsPerBatchUpdated(maxSubmissionsPerBatch, newMax);
        maxSubmissionsPerBatch = newMax;
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        _openBatch(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner whenNotPaused {
        Batch storage batch = batches[batchId];
        if (!batch.isOpen) revert BatchClosed();
        batch.isOpen = false;
        batch.closedAt = block.timestamp;
        emit BatchClosed(batchId, batch.closedAt, batch.totalSubmissions);
    }

    function submitEncryptedScore(euint32 encryptedScore, uint256 modelVersion) 
        external 
        onlyProvider 
        whenNotPaused 
        submissionCooldown(msg.sender) 
    {
        if (modelVersion != modelVersions[currentBatchId]) revert StaleWrite();
        Batch storage batch = batches[currentBatchId];
        if (!batch.isOpen) revert BatchClosed();
        if (batch.totalSubmissions >= maxSubmissionsPerBatch) revert BatchFull();

        uint256 submissionId = batch.totalSubmissions + 1;
        submissions[currentBatchId][submissionId] = Submission({
            submitter: msg.sender,
            encryptedScore: encryptedScore,
            timestamp: block.timestamp,
            batchId: currentBatchId,
            modelVersion: modelVersion
        });

        batch.encryptedAggregateScore = _initIfNeeded(batch.encryptedAggregateScore);
        batch.encryptedAggregateScore = FHE.add(batch.encryptedAggregateScore, encryptedScore);
        batch.totalSubmissions = submissionId;
        totalSubmissions++;
        lastSubmissionAt[msg.sender] = block.timestamp;

        emit SubmissionAdded(msg.sender, currentBatchId, submissionId, block.timestamp);
    }

    function requestBatchDecryption(uint256 batchId) 
        external 
        onlyProvider 
        whenNotPaused 
        decryptionRequestCooldown(msg.sender) 
    {
        Batch storage batch = batches[batchId];
        if (batch.totalSubmissions == 0) revert InvalidRequest();
        if (!FHE.isInitialized(batch.encryptedAggregateScore)) revert NotInitialized();

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(batch.encryptedAggregateScore);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.handleBatchDecryption.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            modelVersion: modelVersions[batchId],
            stateHash: stateHash,
            processed: false,
            requester: msg.sender
        });
        lastDecryptionRequestAt[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId, msg.sender, stateHash);
    }

    function handleBatchDecryption(uint256 requestId, bytes memory cleartexts, bytes memory proof) 
        public 
    {
        if (processedRequests[requestId]) revert InvalidState();
        DecryptionContext storage context = decryptionContexts[requestId];
        if (context.requester == address(0)) revert InvalidRequest();

        Batch storage batch = batches[context.batchId];
        if (!batch.isOpen) revert BatchClosed();

        // Rebuild cts in the same order
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(batch.encryptedAggregateScore);
        bytes32 currHash = _hashCiphertexts(cts);

        // Verify state consistency
        if (currHash != context.stateHash) revert InvalidState();
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode cleartexts in the same order
        uint32 decryptedScore = abi.decode(cleartexts, (uint32));

        // Update state
        context.processed = true;
        processedRequests[requestId] = true;

        // Emit minimal plaintext result
        emit DecryptionCompleted(requestId, context.batchId, uint256(decryptedScore), block.timestamp);
    }

    function _openBatch(uint256 batchId) internal {
        batches[batchId] = Batch({
            id: batchId,
            openedAt: block.timestamp,
            closedAt: 0,
            isOpen: true,
            totalSubmissions: 0,
            encryptedAggregateScore: FHE.asEuint32(0)
        });
        modelVersions[batchId] = block.timestamp;
        totalBatches++;
        emit BatchOpened(batchId, block.timestamp);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) internal returns (euint32) {
        if (!FHE.isInitialized(x)) {
            x = FHE.asEuint32(0);
        }
        return x;
    }

    function _requireInitialized(euint32 x, string memory tag) internal pure {
        if (!FHE.isInitialized(x)) {
            revert NotInitialized();
        }
    }
}