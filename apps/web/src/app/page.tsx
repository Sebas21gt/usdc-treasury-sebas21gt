"use client";

import { usePollar } from "@pollar/react";
import { useState } from "react";
import { CCTP_CONTRACTS, buildFullStellarApproveTx, buildFullStellarBurnTx, buildFullStellarMintTx } from "@usdc-treasury/engine";

export default function TreasuryDashboard() {
  const pollar = usePollar();
  const [logs, setLogs] = useState<{message: string, type: 'info' | 'success' | 'error'}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [fromChain, setFromChain] = useState<string>("polygon");
  const [toChain, setToChain] = useState<string>("solana");
  const [amount, setAmount] = useState<string>("1"); // In USDC
  
  const log = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs((prev) => [...prev, { message, type }]);
  };

  const handleManualTransfer = async () => {
    setIsProcessing(true);
    setLogs([]);
    try {
      // 6 decimals for EVM/Solana, 7 for Stellar. 
      let amountSubunitsEVM = BigInt(parseFloat(amount) * 1_000_000);
      let amountSubunitsStellar = BigInt(parseFloat(amount) * 10_000_000);

      const sourceDomain = CCTP_CONTRACTS[fromChain as keyof typeof CCTP_CONTRACTS]?.domain;
      const destinationDomain = CCTP_CONTRACTS[toChain as keyof typeof CCTP_CONTRACTS]?.domain;

      if (sourceDomain === undefined || destinationDomain === undefined) throw new Error("Invalid chains selected");

      if (fromChain === "stellar") {
        if (!pollar.wallet?.address) throw new Error("Please connect Pollar wallet first");
        
        log(`Initiating Manual Transfer from Stellar to ${toChain}...`);
        log("1. Requesting Approve via Pollar...");
        
        const approveXdr = await buildFullStellarApproveTx({
          amountSubunits: amountSubunitsStellar,
          burnTokenStrkey: CCTP_CONTRACTS.stellar.usdc,
          sourceAccountPubkey: pollar.wallet.address
        });
        
        const approveResult = await pollar.signAndSubmitTx(approveXdr);
        if (approveResult.status === "error") throw new Error(approveResult.details || "Approve failed");
        log(`Approve success: ${approveResult.hash}`, 'success');
        await new Promise(r => setTimeout(r, 2000));

        log("2. Requesting Burn via Pollar...");
        const recipientAddress = "0x0279A7D9f93805A9D0bF7bb7a88A99D7392934AC"; 
        const mintRecipientBytes32 = recipientAddress.replace("0x", "").padStart(64, "0"); 

        const unsignedXdr = await buildFullStellarBurnTx({
          amountSubunits: amountSubunitsStellar,
          destinationDomain,
          mintRecipientBytes32,
          burnTokenStrkey: CCTP_CONTRACTS.stellar.usdc,
          sourceAccountPubkey: pollar.wallet.address
        });

        const burnResult = await pollar.signAndSubmitTx(unsignedXdr);
        if (burnResult.status === "error") throw new Error(burnResult.details || "Burn failed");
        log(`Burn success: ${burnResult.hash}`, 'success');

        log("3. Passing to Backend to poll and mint...");
        const response = await fetch('/api/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'mint',
            sourceDomain,
            destinationDomain,
            txHash: burnResult.hash,
          })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        log(`Transfer Complete! Mint Hash: ${data.hash}`, 'success');

      } else {
        log(`Initiating Automated Backend Transfer from ${fromChain} to ${toChain}...`);
        
        const recipientAddress = "0x0279A7D9f93805A9D0bF7bb7a88A99D7392934AC";
        const mintRecipientBytes32 = recipientAddress.replace("0x", "").padStart(64, "0"); 
        
        const response = await fetch('/api/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'full_transfer',
            sourceDomain,
            destinationDomain,
            amount: amountSubunitsEVM.toString(),
            mintRecipientBytes32
          })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        if (data.needsClientMint) {
          log(`Burn and poll complete on backend. Proceeding to Client-Side Mint on Stellar...`, 'success');
          if (!pollar.wallet?.address) throw new Error("Please connect Pollar wallet first");
          const unsignedXdr = await buildFullStellarMintTx({
            messageHex: data.messageHex,
            attestationHex: data.attestationHex,
            sourceAccountPubkey: pollar.wallet.address
          });
          const mintResult = await pollar.signAndSubmitTx(unsignedXdr);
          if (mintResult.status === "error") throw new Error(mintResult.details || "Mint failed");
          log(`Stellar Mint Complete! Hash: ${mintResult.hash}`, 'success');
        } else {
          log(`Transfer Complete! Burn Hash: ${data.burnHash}, Mint Hash: ${data.mintHash}`, 'success');
        }
      }
    } catch (e: any) {
      log(`Error: ${e.message}`, 'error');
    } finally {
      setIsProcessing(false);
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
        <button 
          onClick={() => pollar.openLoginModal()} 
          className="px-5 py-2 bg-white border border-gray-300 rounded-full hover:bg-gray-50 text-sm font-medium text-gray-700 transition-all shadow-sm flex items-center gap-2"
        >
          {pollar.configStatus === 'loading' ? 'Loading...' : 
           pollar.wallet?.address ? (
             <><span className="w-2 h-2 rounded-full bg-green-500"></span> {pollar.wallet.address.slice(0,6)}...{pollar.wallet.address.slice(-4)}</>
           ) : "Connect Wallet"}
        </button>
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
              <span className="text-3xl font-bold text-gray-900 tracking-tight">--</span>
              <span className="text-gray-500 font-medium ml-2">USDC</span>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-gray-500">
                <span>Min: 10</span>
                <span className="text-gray-900">Target: 50</span>
                <span>Max: 100</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-pollar-blue h-full rounded-full transition-all duration-500" style={{ width: '45%' }}></div>
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
              <span className="text-3xl font-bold text-gray-900 tracking-tight">--</span>
              <span className="text-gray-500 font-medium ml-2">USDC</span>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-gray-500">
                <span>Min: 10</span>
                <span className="text-gray-900">Target: 50</span>
                <span>Max: 100</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-yellow-400 h-full rounded-full transition-all duration-500" style={{ width: '20%' }}></div>
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
              <span className="text-3xl font-bold tracking-tight">--</span>
              <span className="text-blue-100 font-medium ml-2">USDC</span>
            </div>
            
            <div className="space-y-2 relative z-10">
              <div className="flex justify-between text-xs font-medium text-blue-100">
                <span>Min: 10</span>
                <span className="text-white">Target: 50</span>
                <span>Max: 100</span>
              </div>
              <div className="w-full bg-black/20 rounded-full h-1.5 overflow-hidden">
                <div className="bg-white h-full rounded-full transition-all duration-500" style={{ width: '85%' }}></div>
              </div>
            </div>
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
      </div>
    </main>
  );
}
