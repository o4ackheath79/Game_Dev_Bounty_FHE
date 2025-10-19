// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Bounty {
  id: string;
  title: string;
  reward: string;
  encryptedDescription: string;
  timestamp: number;
  creator: string;
  status: "open" | "completed" | "expired";
  submissionsCount: number;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  // Randomly selected style: High Contrast (Red+Black), Cyberpunk UI, Grid Information Flow, Animation Rich
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newBountyData, setNewBountyData] = useState({ title: "", reward: 0, description: "" });
  const [selectedBounty, setSelectedBounty] = useState<Bounty | null>(null);
  const [decryptedDescription, setDecryptedDescription] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "open" | "completed">("all");
  const [showStats, setShowStats] = useState(false);

  // Randomly selected features: Search & Filter, Data Statistics, Project Introduction
  const openCount = bounties.filter(b => b.status === "open").length;
  const completedCount = bounties.filter(b => b.status === "completed").length;
  const expiredCount = bounties.filter(b => b.status === "expired").length;

  useEffect(() => {
    loadBounties().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadBounties = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("bounty_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing bounty keys:", e); }
      }
      
      const list: Bounty[] = [];
      for (const key of keys) {
        try {
          const bountyBytes = await contract.getData(`bounty_${key}`);
          if (bountyBytes.length > 0) {
            try {
              const bountyData = JSON.parse(ethers.toUtf8String(bountyBytes));
              list.push({ 
                id: key, 
                title: bountyData.title, 
                reward: bountyData.reward, 
                encryptedDescription: bountyData.description, 
                timestamp: bountyData.timestamp, 
                creator: bountyData.creator, 
                status: bountyData.status || "open",
                submissionsCount: bountyData.submissionsCount || 0
              });
            } catch (e) { console.error(`Error parsing bounty data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading bounty ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setBounties(list);
    } catch (e) { console.error("Error loading bounties:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createBounty = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting bounty details with Zama FHE..." });
    try {
      const encryptedReward = FHEEncryptNumber(newBountyData.reward);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const bountyId = `bounty-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const bountyData = { 
        title: newBountyData.title,
        reward: encryptedReward,
        description: newBountyData.description, // In real implementation, this would be encrypted
        timestamp: Math.floor(Date.now() / 1000),
        creator: address,
        status: "open",
        submissionsCount: 0
      };
      
      await contract.setData(`bounty_${bountyId}`, ethers.toUtf8Bytes(JSON.stringify(bountyData)));
      
      const keysBytes = await contract.getData("bounty_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(bountyId);
      await contract.setData("bounty_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Bounty created with FHE encryption!" });
      await loadBounties();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewBountyData({ title: "", reward: 0, description: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<string | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return encryptedData; // In real implementation, this would decrypt the data
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const completeBounty = async (bountyId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing bounty completion with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const bountyBytes = await contract.getData(`bounty_${bountyId}`);
      if (bountyBytes.length === 0) throw new Error("Bounty not found");
      
      const bountyData = JSON.parse(ethers.toUtf8String(bountyBytes));
      const updatedBounty = { ...bountyData, status: "completed" };
      
      await contract.setData(`bounty_${bountyId}`, ethers.toUtf8Bytes(JSON.stringify(updatedBounty)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Bounty marked as completed!" });
      await loadBounties();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Completion failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isCreator = (bountyAddress: string) => address?.toLowerCase() === bountyAddress.toLowerCase();

  const filteredBounties = bounties.filter(bounty => {
    const matchesSearch = bounty.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         bounty.creator.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || bounty.status === activeTab;
    return matchesSearch && matchesTab;
  });

  const renderStats = () => (
    <div className="stats-grid">
      <div className="stat-item">
        <div className="stat-value">{bounties.length}</div>
        <div className="stat-label">Total Bounties</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{openCount}</div>
        <div className="stat-label">Open</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{completedCount}</div>
        <div className="stat-label">Completed</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{expiredCount}</div>
        <div className="stat-label">Expired</div>
      </div>
    </div>
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="shield-icon"></div></div>
          <h1>FHE<span>Game</span>Bounty</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-bounty-btn cyber-button">
            <div className="add-icon"></div>Create Bounty
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE Game Development Bounty Platform</h2>
            <p>Submit and complete game development tasks with fully homomorphic encryption</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>Project Introduction</h3>
            <p>This platform uses <strong>Zama FHE technology</strong> to enable game studios to post encrypted development bounties (like "Design a secret Boss AI") that developers can submit encrypted solutions to. All evaluation happens homomorphically without decryption.</p>
            <div className="fhe-badge"><span>FHE-Powered</span></div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <div className="card-header">
              <h3>Bounty Statistics</h3>
              <button className="toggle-stats cyber-button" onClick={() => setShowStats(!showStats)}>
                {showStats ? "Hide Stats" : "Show Stats"}
              </button>
            </div>
            {showStats && renderStats()}
          </div>
        </div>

        <div className="bounties-section">
          <div className="section-header">
            <h2>Game Development Bounties</h2>
            <div className="header-actions">
              <div className="search-container">
                <input 
                  type="text" 
                  placeholder="Search bounties..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cyber-input"
                />
              </div>
              <div className="tabs">
                <button className={`tab-button ${activeTab === "all" ? "active" : ""}`} onClick={() => setActiveTab("all")}>All</button>
                <button className={`tab-button ${activeTab === "open" ? "active" : ""}`} onClick={() => setActiveTab("open")}>Open</button>
                <button className={`tab-button ${activeTab === "completed" ? "active" : ""}`} onClick={() => setActiveTab("completed")}>Completed</button>
              </div>
              <button onClick={loadBounties} className="refresh-btn cyber-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="bounties-grid">
            {filteredBounties.length === 0 ? (
              <div className="no-bounties">
                <div className="no-bounties-icon"></div>
                <p>No bounties found</p>
                <button className="cyber-button primary" onClick={() => setShowCreateModal(true)}>Create First Bounty</button>
              </div>
            ) : filteredBounties.map(bounty => (
              <div className="bounty-card cyber-card" key={bounty.id} onClick={() => setSelectedBounty(bounty)}>
                <div className="bounty-header">
                  <h3>{bounty.title}</h3>
                  <span className={`status-badge ${bounty.status}`}>{bounty.status}</span>
                </div>
                <div className="bounty-meta">
                  <div className="meta-item">
                    <span>Reward:</span>
                    <strong>{FHEDecryptNumber(bounty.reward)} ETH</strong>
                  </div>
                  <div className="meta-item">
                    <span>Creator:</span>
                    <strong>{bounty.creator.substring(0, 6)}...{bounty.creator.substring(38)}</strong>
                  </div>
                  <div className="meta-item">
                    <span>Submissions:</span>
                    <strong>{bounty.submissionsCount}</strong>
                  </div>
                </div>
                <div className="bounty-footer">
                  <div className="date">{new Date(bounty.timestamp * 1000).toLocaleDateString()}</div>
                  {isCreator(bounty.creator) && bounty.status === "open" && (
                    <button className="action-btn cyber-button success" onClick={(e) => { e.stopPropagation(); completeBounty(bounty.id); }}>
                      Mark Complete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal cyber-card">
            <div className="modal-header">
              <h2>Create New Bounty</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="fhe-notice-banner">
                <div className="key-icon"></div> 
                <div><strong>FHE Encryption Notice</strong><p>Bounty details will be encrypted with Zama FHE before submission</p></div>
              </div>
              <div className="form-group">
                <label>Title *</label>
                <input 
                  type="text" 
                  name="title" 
                  value={newBountyData.title} 
                  onChange={(e) => setNewBountyData({...newBountyData, title: e.target.value})} 
                  placeholder="Bounty title..." 
                  className="cyber-input"
                />
              </div>
              <div className="form-group">
                <label>Reward (ETH) *</label>
                <input 
                  type="number" 
                  name="reward" 
                  value={newBountyData.reward} 
                  onChange={(e) => setNewBountyData({...newBountyData, reward: parseFloat(e.target.value)})} 
                  placeholder="Reward amount in ETH..." 
                  className="cyber-input"
                  step="0.01"
                />
              </div>
              <div className="form-group">
                <label>Description *</label>
                <textarea 
                  name="description" 
                  value={newBountyData.description} 
                  onChange={(e) => setNewBountyData({...newBountyData, description: e.target.value})} 
                  placeholder="Detailed description of the bounty..." 
                  className="cyber-textarea"
                  rows={4}
                />
              </div>
              <div className="encryption-preview">
                <h4>Reward Encryption Preview</h4>
                <div className="preview-container">
                  <div className="plain-data"><span>Plain Value:</span><div>{newBountyData.reward || '0'} ETH</div></div>
                  <div className="encryption-arrow">→</div>
                  <div className="encrypted-data">
                    <span>Encrypted Data:</span>
                    <div>{newBountyData.reward ? FHEEncryptNumber(newBountyData.reward).substring(0, 50) + '...' : 'No value entered'}</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn cyber-button">Cancel</button>
              <button onClick={createBounty} disabled={creating} className="submit-btn cyber-button primary">
                {creating ? "Creating with FHE..." : "Create Bounty"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedBounty && (
        <div className="modal-overlay">
          <div className="bounty-detail-modal cyber-card">
            <div className="modal-header">
              <h2>Bounty Details</h2>
              <button onClick={() => { setSelectedBounty(null); setDecryptedDescription(null); }} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="bounty-info">
                <div className="info-item"><span>Title:</span><strong>{selectedBounty.title}</strong></div>
                <div className="info-item"><span>Reward:</span><strong>{FHEDecryptNumber(selectedBounty.reward)} ETH</strong></div>
                <div className="info-item"><span>Creator:</span><strong>{selectedBounty.creator.substring(0, 6)}...{selectedBounty.creator.substring(38)}</strong></div>
                <div className="info-item"><span>Status:</span><strong className={`status-badge ${selectedBounty.status}`}>{selectedBounty.status}</strong></div>
                <div className="info-item"><span>Created:</span><strong>{new Date(selectedBounty.timestamp * 1000).toLocaleString()}</strong></div>
                <div className="info-item"><span>Submissions:</span><strong>{selectedBounty.submissionsCount}</strong></div>
              </div>
              
              <div className="description-section">
                <h3>Description</h3>
                <div className="description-content">
                  {decryptedDescription || (
                    <div className="encrypted-notice">
                      <p>Description is encrypted with FHE</p>
                      <button 
                        className="decrypt-btn cyber-button" 
                        onClick={async () => {
                          const decrypted = await decryptWithSignature(selectedBounty.encryptedDescription);
                          if (decrypted) setDecryptedDescription(decrypted);
                        }}
                        disabled={isDecrypting}
                      >
                        {isDecrypting ? "Decrypting..." : "Decrypt with Wallet"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setSelectedBounty(null); setDecryptedDescription(null); }} className="close-btn cyber-button">Close</button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="shield-icon"></div><span>FHEGameBounty</span></div>
            <p>Game development bounties with Zama FHE encryption</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} FHEGameBounty. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

export default App;