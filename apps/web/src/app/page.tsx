"use client";

import { usePollar } from "@pollar/react";
import { useState } from "react";
import { parseUnits } from "viem";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";
import { CCTP_CONTRACTS } from "../../../../packages/engine/src/config";
import { buildStellarMintXdr, buildStellarBurnXdr, buildCctpForwarderHookData, contractStrkeyToBytes32, buildFullStellarMintTx } from "../../../../packages/engine/src/chains/stellar";

// EVM ABI just for depositForBurnWithHook
const TOKEN_MESSENGER_ABI = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" }
    ],
    outputs: [{ type: "uint64" }]
  }
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  }
] as const;

export default function Home() {
  const pollar = usePollar();
  const [logs, setLogs] = useState<string[]>([]);
  const [isBurning, setIsBurning] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [mintMessage, setMintMessage] = useState<{ message: string; attestation: string } | null>(null);

  const log = (msg: string) => setLogs((prev) => [...prev, msg]);

  // Spike 2.1: Polygon -> Stellar
  const handlePolygonToStellar = async () => {
    setIsBurning(true);
    setLogs([]);
    try {
      const pollarWallet = pollar.wallet?.address;
      if (!pollarWallet) {
        throw new Error("Pollar wallet not connected/found. Wait for initialization.");
      }
      log(`Pollar Treasury Wallet: ${pollarWallet}`);

      // 1. Burn on Polygon
      log("Initializing Polygon wallet...");
      const account = privateKeyToAccount(process.env.NEXT_PUBLIC_POLYGON_PRIVATE_KEY as `0x${string}`);
      const client = createWalletClient({
        account,
        chain: polygonAmoy,
        transport: http("https://polygon-amoy.drpc.org")
      }).extend(publicActions);

      const amount = parseUnits("1", 6); // 1 USDC
      const forwarderBytes32 = contractStrkeyToBytes32(CCTP_CONTRACTS.stellar.cctpForwarder);
      const hookData = buildCctpForwarderHookData(pollarWallet);

      log("Approving USDC spend...");
      const approveHash = await client.writeContract({
        address: CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`,
          amount
        ]
      });
      log(`Approve tx sent: ${approveHash}. Waiting for receipt...`);
      await client.waitForTransactionReceipt({ hash: approveHash });
      log("Approve confirmed.");

      log("Submitting depositForBurnWithHook on Polygon...");
      const hash = await client.writeContract({
        address: CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurnWithHook",
        args: [
          amount,
          CCTP_CONTRACTS.stellar.domain,
          forwarderBytes32 as `0x${string}`,
          CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
          forwarderBytes32 as `0x${string}`,
          BigInt(0), // maxFee
          0, // minFinalityThreshold
          hookData as `0x${string}`
        ]
      });

      log(`Burn tx sent: ${hash}. Waiting for receipt...`);
      const receipt = await client.waitForTransactionReceipt({ hash });
      log(`Burn confirmed in block ${receipt.blockNumber}.`);

      // 2. Fetch attestation
      log("Waiting for Circle attestation...");
      const attestation = await waitForAttestation(CCTP_CONTRACTS.polygon.domain, hash);
      log("Attestation received!");
      setMintMessage(attestation);
    } catch (e: any) {
      log(`Error: ${e.message}`);
      console.error(e);
    } finally {
      setIsBurning(false);
    }
  };

  const handleMintOnStellar = async () => {
    if (!mintMessage) return;
    setIsMinting(true);
    try {
      log("Building Stellar Mint Tx locally...");
      if (!pollar.wallet?.address) throw new Error("Pollar wallet not connected");

      log("Ensuring USDC trustline exists...");
      const tl = await pollar.setTrustline({ 
        code: "USDC",
        issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
      });
      log(`Trustline outcome: ${JSON.stringify(tl)}`);
      if (tl.status === "error") {
        throw new Error(tl.details || "Unknown trustline error");
      }
      
      // Give Horizon/Soroban 2 seconds to index the new trustline before simulating
      await new Promise(r => setTimeout(r, 2000));

      const unsignedXdr = await buildFullStellarMintTx({
        messageHex: mintMessage.message,
        attestationHex: mintMessage.attestation,
        sourceAccountPubkey: pollar.wallet.address
      });

      log("Submitting to Pollar...");
      const result = await pollar.signAndSubmitTx(unsignedXdr);
      if (result.status === "error") {
        throw new Error(result.message || result.details || "Unknown error");
      }
      log(`Stellar Mint success! Hash: ${result.hash}`);
    } catch (e: any) {
      log(`Error: ${e.message}`);
      console.error(e);
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <main className="p-8 font-mono">
      <h1 className="text-2xl font-bold mb-4">Spike 2: Pollar Treasury (Polygon ↔ Stellar)</h1>
      <p className="mb-4 text-xs text-gray-500">API Key: {process.env.NEXT_PUBLIC_POLLAR_API_KEY?.slice(0, 15)}...</p>
      
      <div className="flex gap-4 mb-8 items-center">
        <button 
          onClick={() => pollar.openLoginModal()} 
          className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
        >
          {pollar.configStatus === 'loading' ? 'Cargando Pollar...' : 
           pollar.wallet?.address ? `Conectado: ${pollar.wallet.address.slice(0,6)}...` : 
           "Login Pollar"}
        </button>

        <button 
          onClick={handlePolygonToStellar} 
          disabled={isBurning}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {isBurning ? "Quemando..." : "1. Quemar 1 USDC en Polygon"}
        </button>

        <button 
          onClick={handleMintOnStellar} 
          disabled={isMinting || !mintMessage}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {isMinting ? "Recibiendo..." : "2. Recibir USDC en Stellar"}
        </button>
      </div>

      <div className="bg-gray-900 text-green-400 p-4 rounded min-h-[300px]">
        {logs.map((l, i) => <div key={i}>{l}</div>)}
        {logs.length === 0 && <span className="opacity-50">Esperando acciones...</span>}
      </div>
    </main>
  );
}

// Helper to poll Iris API
async function waitForAttestation(sourceDomain: number, txHash: string) {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
  while (true) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const complete = data.messages?.find((m: any) => m.status === "complete");
      if (complete) return complete;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}
