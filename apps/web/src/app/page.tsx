"use client";

import { usePollar } from "@pollar/react";
import { useState, useEffect } from "react";
import {
  TREASURY_CONFIG,
  executeBurn,
  executeMint,
  payIntoTreasuryFromStellar,
  SupportedChain,
  StellarSignResult,
} from "@usdc-treasury/engine";
// Type-only: core/history uses Node's fs/path server-side, but `import type`
// is fully erased at compile time, so it never gets bundled for the browser.
import type { MovementRecord } from "@usdc-treasury/engine/src/core/history";

// Adapts Pollar's signAndSubmitTx to the engine's StellarXdrSigner shape.
function makeStellarSigner(pollar: ReturnType<typeof usePollar>) {
  return async (unsignedXdr: string): Promise<StellarSignResult> => {
    const result = await pollar.signAndSubmitTx(unsignedXdr);
    if (result.status === "error") {
      return { status: "error", details: result.details };
    }
    return { status: "success", hash: result.hash };
  };
}

function explorerUrl(chain: SupportedChain, hash: string): string {
  if (chain === "polygon") return `https://amoy.polygonscan.com/tx/${hash}`;
  if (chain === "solana") return `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export default function TreasuryDashboard() {
  const pollar = usePollar();
  const [logs, setLogs] = useState<{message: string, type: 'info' | 'success' | 'error'}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [fromChain, setFromChain] = useState<string>("polygon");
  const [toChain, setToChain] = useState<string>("solana");
  const [amount, setAmount] = useState<string>("1"); // In USDC
  
  const [balances, setBalances] = useState({ polygon: 0, solana: 0, stellar: 0 });
  const [addresses, setAddresses] = useState({ polygon: '', solana: '', stellar: '' });
  const [isBalancesLoading, setIsBalancesLoading] = useState(true);
  const [history, setHistory] = useState<MovementRecord[]>([]);
  const [addressCopied, setAddressCopied] = useState(false);

  const copyConnectedAddress = async () => {
    if (!pollar.wallet?.address) return;
    await navigator.clipboard.writeText(pollar.wallet.address);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 1500);
  };

  // Simulated P2P payment (demo only, no CCTP): P1 (connected wallet) pays
  // the treasury on Stellar, treasury instantly credits P2 elsewhere.
  const [sendToChain, setSendToChain] = useState<"polygon" | "solana">("polygon");
  const [sendDestinationAddress, setSendDestinationAddress] = useState("");
  const [sendAmount, setSendAmount] = useState("1");
  const [isSending, setIsSending] = useState(false);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (data && !data.error) setHistory(data.history);
    } catch (e) {
      console.error("Failed to fetch history", e);
    }
  };

  useEffect(() => {
    const fetchBalances = async () => {
      try {
        const res = await fetch('/api/inventory');
        const data = await res.json();
        if (data && !data.error) {
          setBalances(data);
          if (data.addresses) setAddresses(data.addresses);
        }
      } catch (e) {
        console.error("Failed to fetch balances", e);
      } finally {
        setIsBalancesLoading(false);
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 15000); // 15 seconds

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchHistory();
    // Automatic mode runs as a separate background process and writes
    // straight to data/history.json, so this needs its own poll - it won't
    // come through as a side effect of any button click in this tab.
    const interval = setInterval(fetchHistory, 15000);
    return () => clearInterval(interval);
  }, []);

  const log = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs((prev) => [...prev, { message, type }]);
  };

  const handleManualTransfer = async () => {
    setIsProcessing(true);
    setLogs([]);
    try {
      const from = fromChain as SupportedChain;
      const to = toChain as SupportedChain;
      const parsedAmount = parseFloat(amount);

      const destinationAddress = to === 'polygon' ? addresses.polygon : to === 'solana' ? addresses.solana : addresses.stellar;
      if (!destinationAddress) throw new Error("Destination address not loaded yet. Please wait for inventory to sync.");

      if (from === "stellar") {
        if (!pollar.wallet?.address) throw new Error("Please connect Pollar wallet first");

        log(`Initiating Manual Transfer from Stellar to ${to}...`);
        log("1. Approve + Burn via Pollar...");
        const { hash: burnHash } = await executeBurn({
          fromChain: from,
          toChain: to,
          amount: parsedAmount,
          destinationAddress,
          stellarWalletAddress: pollar.wallet.address,
          signStellarXdr: makeStellarSigner(pollar),
        });
        log(`Burn success: ${burnHash}`, 'success');

        log("2. Passing to backend to poll attestation and mint...");
        const response = await fetch('/api/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mint_from_stellar_burn', toChain: to, amount: parsedAmount, burnTxHash: burnHash })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        log(`Transfer Complete! Mint Hash: ${data.mintHash}`, 'success');
        fetchHistory();

      } else if (to === "stellar") {
        if (!pollar.wallet?.address) throw new Error("Please connect Pollar wallet first");

        log(`Initiating Transfer from ${from} to Stellar...`);
        log("1. Burning on the backend...");
        const response = await fetch('/api/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'burn_and_wait', fromChain: from, toChain: to, amount: parsedAmount, destinationAddress })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        log(`Burn success: ${data.burnHash}`, 'success');

        log("2. Minting into Stellar via Pollar (CctpForwarder)...");
        const { hash: mintHash } = await executeMint({
          toChain: to,
          messageHex: data.messageHex,
          attestationHex: data.attestationHex,
          stellarWalletAddress: pollar.wallet.address,
          signStellarXdr: makeStellarSigner(pollar),
        });
        log(`Transfer Complete! Mint Hash: ${mintHash}`, 'success');

        // Only case where the final hash is known client-side only - report
        // it to the server so it lands in the persisted history too.
        await fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromChain: from, toChain: to, amount: parsedAmount, burnHash: data.burnHash, mintHash, mode: 'manual' })
        });
        fetchHistory();

      } else {
        log(`Initiating Automated Backend Transfer from ${from} to ${to}...`);
        const response = await fetch('/api/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'transfer', fromChain: from, toChain: to, amount: parsedAmount, destinationAddress })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        log(`Transfer Complete! Burn Hash: ${data.burnHash}, Mint Hash: ${data.mintHash}`, 'success');
        fetchHistory();
      }
    } catch (e: any) {
      log(`Error: ${e.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Simulated P2P payment (demo only): P1 (connected wallet) pays the
  // treasury on Stellar, the treasury instantly credits P2 elsewhere - no
  // CCTP on either leg. CCTP only ever rebalances the treasury itself,
  // via the Manual Rebalance form above or automatic mode.
  const handleSimulatedSend = async () => {
    setIsSending(true);
    try {
      if (!pollar.wallet?.address) throw new Error("Connect a Pollar wallet first (this is P1, the sender)");
      if (!addresses.stellar) throw new Error("Treasury address not loaded yet. Please wait for inventory to sync.");
      if (!sendDestinationAddress) throw new Error("Enter a destination address for P2");

      const parsedAmount = parseFloat(sendAmount);

      log(`P1 paying ${parsedAmount} USDC into the treasury on Stellar...`);
      const { hash: depositHash } = await payIntoTreasuryFromStellar({
        stellarWalletAddress: pollar.wallet.address,
        treasuryStellarAddress: addresses.stellar,
        amount: parsedAmount,
        signStellarXdr: makeStellarSigner(pollar),
      });
      log(`P1 -> Treasury payment success: ${depositHash}`, 'success');

      log(`Treasury crediting P2 on ${sendToChain} (instant, no CCTP)...`);
      const response = await fetch('/api/simulated-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toChain: sendToChain, destinationAddress: sendDestinationAddress, amount: parsedAmount })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      log(`Treasury -> P2 payment success: ${data.hash}`, 'success');
    } catch (e: any) {
      log(`Error: ${e.message}`, 'error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="min-h-screen font-sans selection:bg-blue-100">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-pollar-blue rounded-lg flex items-center justify-center text-white font-bold text-lg">
            T
          </div>
          <h1 className="text-xl font-semibold text-gray-900 tracking-tight">
            Treasury Engine
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => pollar.openLoginModal()}
            className="px-5 py-2 bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-sm font-medium text-gray-700 transition-all shadow-sm flex items-center gap-2"
          >
            {pollar.configStatus === 'loading' ? 'Loading...' :
             pollar.wallet?.address ? (
               <><span className="w-2 h-2 rounded-full bg-green-500"></span> {pollar.wallet.address.slice(0,6)}...{pollar.wallet.address.slice(-4)}</>
             ) : "Connect Wallet"}
          </button>
          {pollar.wallet?.address && (
            <>
              <button
                onClick={copyConnectedAddress}
                className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 underline"
                title="Copy the full connected address (to fund it via a faucet)"
              >
                {addressCopied ? "Copied!" : "Copy address"}
              </button>
              <button
                onClick={() => pollar.logout()}
                className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 underline"
                title="Sign out to switch to a different Pollar account"
              >
                Log out
              </button>
            </>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Inventory Dashboard</h2>
          <p className="text-gray-500 text-sm">Live USDC liquidity across integrated networks.</p>
        </div>

        {/* Inventory Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          
          {/* Polygon Card */}
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0L22.5 6V18L12 24L1.5 18V6L12 0ZM12 4.5L5.5 8.25V15.75L12 19.5L18.5 15.75V8.25L12 4.5Z"/></svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Polygon</h3>
                  <p className="text-xs text-gray-500">Amoy Testnet</p>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-semibold rounded-full border border-purple-100">
                EVM
              </span>
            </div>
            
            <div className="mb-4">
              <span className="text-3xl font-bold text-gray-900 tracking-tight">{isBalancesLoading ? '--' : balances.polygon.toLocaleString()}</span>
              <span className="text-gray-500 font-medium ml-2">USDC</span>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-gray-500">
                <span>Min: {TREASURY_CONFIG.polygon.min}</span>
                <span className="text-gray-900">Target: {TREASURY_CONFIG.polygon.target}</span>
                <span>Max: {TREASURY_CONFIG.polygon.max}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-pollar-blue h-full rounded-full transition-all duration-500" style={{ width: `${Math.min((balances.polygon / TREASURY_CONFIG.polygon.max) * 100, 100)}%` }}></div>
              </div>
            </div>
          </div>

          {/* Solana Card */}
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M19.92 8.76L17.26 4.15H4.1L6.76 8.76H19.92ZM19.92 19.85L17.26 15.24H4.1L6.76 19.85H19.92ZM4.08 14.3H17.24L19.9 9.69H6.74L4.08 14.3Z"/></svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Solana</h3>
                  <p className="text-xs text-gray-500">Devnet</p>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-green-50 text-green-700 text-xs font-semibold rounded-full border border-green-100">
                SVM
              </span>
            </div>
            
            <div className="mb-4">
              <span className="text-3xl font-bold text-gray-900 tracking-tight">{isBalancesLoading ? '--' : balances.solana.toLocaleString()}</span>
              <span className="text-gray-500 font-medium ml-2">USDC</span>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-gray-500">
                <span>Min: {TREASURY_CONFIG.solana.min}</span>
                <span className="text-gray-900">Target: {TREASURY_CONFIG.solana.target}</span>
                <span>Max: {TREASURY_CONFIG.solana.max}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-yellow-400 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min((balances.solana / TREASURY_CONFIG.solana.max) * 100, 100)}%` }}></div>
              </div>
            </div>
          </div>

          {/* Stellar Card - Highlighted/Active State from Design */}
          <div className="bg-pollar-blue rounded-2xl p-6 shadow-md shadow-pollar-blue-dark/20 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-2xl"></div>
            
            <div className="flex justify-between items-start mb-6 relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
                </div>
                <div>
                  <h3 className="font-semibold text-white">Stellar</h3>
                  <p className="text-xs text-blue-100">Testnet</p>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-white/20 text-white text-xs font-semibold rounded-full backdrop-blur-sm">
                Soroban
              </span>
            </div>
            
            <div className="mb-4 relative z-10">
              <span className="text-3xl font-bold tracking-tight">{isBalancesLoading ? '--' : balances.stellar.toLocaleString()}</span>
              <span className="text-blue-100 font-medium ml-2">USDC</span>
            </div>
            
            <div className="space-y-2 relative z-10">
              <div className="flex justify-between text-xs font-medium text-blue-100">
                <span>Min: {TREASURY_CONFIG.stellar.min}</span>
                <span className="text-white">Target: {TREASURY_CONFIG.stellar.target}</span>
                <span>Max: {TREASURY_CONFIG.stellar.max}</span>
              </div>
              <div className="w-full bg-black/20 rounded-full h-1.5 overflow-hidden">
                <div className="bg-white h-full rounded-full transition-all duration-500" style={{ width: `${Math.min((balances.stellar / TREASURY_CONFIG.stellar.max) * 100, 100)}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Movement History */}
        <div className="mb-10 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Movement History</h3>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="pb-3 pr-4 font-medium">Time</th>
                  <th className="pb-3 pr-4 font-medium">Route</th>
                  <th className="pb-3 pr-4 font-medium">Amount</th>
                  <th className="pb-3 pr-4 font-medium">Burn tx</th>
                  <th className="pb-3 pr-4 font-medium">Mint tx</th>
                  <th className="pb-3 font-medium">Mode</th>
                </tr>
              </thead>
              <tbody>
                {history.map((movement) => (
                  <tr key={movement.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{new Date(movement.timestamp).toLocaleString()}</td>
                    <td className="py-3 pr-4 text-gray-900 font-medium capitalize whitespace-nowrap">{movement.fromChain} → {movement.toChain}</td>
                    <td className="py-3 pr-4 text-gray-900 whitespace-nowrap">{movement.amount} USDC</td>
                    <td className="py-3 pr-4">
                      <a href={explorerUrl(movement.fromChain, movement.burnHash)} target="_blank" rel="noreferrer" className="text-pollar-blue hover:underline font-mono text-xs">
                        {movement.burnHash.slice(0, 8)}...
                      </a>
                    </td>
                    <td className="py-3 pr-4">
                      <a href={explorerUrl(movement.toChain, movement.mintHash)} target="_blank" rel="noreferrer" className="text-pollar-blue hover:underline font-mono text-xs">
                        {movement.mintHash.slice(0, 8)}...
                      </a>
                    </td>
                    <td className="py-3 capitalize text-gray-500">{movement.mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.length === 0 && (
              <div className="text-center text-gray-400 py-10">No movements recorded yet.</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Manual Rebalance Form */}
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Manual Rebalance</h3>
            
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Source</label>
                  <div className="relative">
                    <select 
                      value={fromChain} 
                      onChange={(e) => setFromChain(e.target.value)}
                      className="w-full appearance-none bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-pollar-blue/20 focus:border-pollar-blue transition-shadow"
                    >
                      <option value="polygon">Polygon</option>
                      <option value="solana">Solana</option>
                      <option value="stellar">Stellar</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Destination</label>
                  <div className="relative">
                    <select 
                      value={toChain} 
                      onChange={(e) => setToChain(e.target.value)}
                      className="w-full appearance-none bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-pollar-blue/20 focus:border-pollar-blue transition-shadow"
                    >
                      <option value="polygon">Polygon</option>
                      <option value="solana">Solana</option>
                      <option value="stellar">Stellar</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount (USDC)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">$</span>
                  </div>
                  <input 
                    type="number" 
                    value={amount} 
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl pl-8 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pollar-blue/20 focus:border-pollar-blue transition-shadow"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button 
                  onClick={handleManualTransfer}
                  disabled={isProcessing || fromChain === toChain}
                  className="w-full py-3 px-4 bg-pollar-blue hover:bg-pollar-blue-dark text-white disabled:opacity-50 disabled:hover:bg-pollar-blue disabled:cursor-not-allowed rounded-full text-sm font-semibold transition-colors shadow-sm flex justify-center items-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      Processing...
                    </>
                  ) : "Execute Transfer"}
                </button>
              </div>
            </div>
          </div>

          {/* Engine Logs Table Style */}
          <div className="lg:col-span-3 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col h-[400px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Activity Log</h3>
              <span className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">Live</span>
            </div>
            
            <div className="flex-1 overflow-y-auto border border-gray-100 rounded-xl bg-gray-50/50 p-4 font-mono text-xs">
              <div className="space-y-3">
                {logs.map((log, i) => {
                  let badgeClass = "bg-gray-100 text-gray-600 border-gray-200";
                  let Icon = () => <span className="mr-2 text-gray-400">›</span>;
                  
                  if (log.type === 'success') {
                    badgeClass = "bg-green-50 text-green-700 border-green-200";
                    Icon = () => <span className="mr-2 text-green-500">✓</span>;
                  } else if (log.type === 'error') {
                    badgeClass = "bg-red-50 text-red-700 border-red-200";
                    Icon = () => <span className="mr-2 text-red-500">×</span>;
                  }

                  return (
                    <div key={i} className={`p-3 rounded-lg border ${badgeClass} break-all flex items-start`}>
                      <Icon />
                      <span className="mt-0.5">{log.message}</span>
                    </div>
                  );
                })}
                {logs.length === 0 && (
                  <div className="text-center text-gray-400 py-10 flex flex-col items-center justify-center">
                    <svg className="w-8 h-8 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    Waiting for engine activity...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Section divider - everything below is a visual demo extra, not part of the CCTP engine */}
        <div className="flex items-center gap-3 mb-4 mt-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Extra demo · not part of the treasury engine</span>
          <div className="flex-1 border-t border-dashed border-gray-300"></div>
        </div>

        {/* Simulated P2P Payment (demo only, no CCTP) */}
        <div className="mb-6 bg-gray-50 border-2 border-dashed border-gray-300 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-lg font-semibold text-gray-700">Send USDC</h3>
            <span className="px-2.5 py-1 bg-white text-gray-500 text-xs font-medium rounded-full border border-gray-200">Simulated · no CCTP</span>
          </div>
          <p className="text-gray-500 text-sm mb-6">
            P1 (the connected wallet) pays the treasury on Stellar; the treasury instantly credits P2 on the destination chain
            from its own liquidity — no cross-chain bridge involved. CCTP only rebalances the treasury itself, separately.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">P1 (sender)</label>
              <div className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-600">
                {pollar.wallet?.address ? `${pollar.wallet.address.slice(0, 6)}...${pollar.wallet.address.slice(-4)}` : "Not connected"}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">P2 destination chain</label>
              <select
                value={sendToChain}
                onChange={(e) => setSendToChain(e.target.value as "polygon" | "solana")}
                className="w-full appearance-none bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-pollar-blue/20 focus:border-pollar-blue transition-shadow"
              >
                <option value="polygon">Polygon</option>
                <option value="solana">Solana</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">P2 address</label>
              <input
                type="text"
                value={sendDestinationAddress}
                onChange={(e) => setSendDestinationAddress(e.target.value)}
                placeholder="0x... or a Solana address"
                className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pollar-blue/20 focus:border-pollar-blue transition-shadow"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount (USDC)</label>
              <input
                type="number"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-pollar-blue/20 focus:border-pollar-blue transition-shadow"
              />
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={handleSimulatedSend}
              disabled={isSending || !pollar.wallet?.address || !sendDestinationAddress}
              className="py-3 px-6 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-full text-sm font-semibold transition-colors"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
