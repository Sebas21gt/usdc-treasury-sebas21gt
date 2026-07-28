import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygonAmoy } from 'viem/chains';
import { CCTP_CONTRACTS } from '../../../../../../packages/engine/src/config';

// MessageTransmitter ABI for receiveMessage
const MESSAGE_TRANSMITTER_ABI = [
  {
    "inputs": [
      { "internalType": "bytes", "name": "message", "type": "bytes" },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "receiveMessage",
    "outputs": [{ "internalType": "bool", "name": "success", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export async function POST(req: Request) {
  try {
    const { messageHex, attestationHex } = await req.json();

    if (!messageHex || !attestationHex) {
      return NextResponse.json({ error: "Missing messageHex or attestationHex" }, { status: 400 });
    }

    const privateKey = process.env.POLYGON_PRIVATE_KEY || process.env.NEXT_PUBLIC_POLYGON_PRIVATE_KEY;
    const rpcUrl = process.env.POLYGON_RPC_URL || process.env.NEXT_PUBLIC_POLYGON_RPC_URL || "https://polygon-amoy.drpc.org";

    if (!privateKey || !rpcUrl) {
      return NextResponse.json({ error: "Server configuration missing EVM credentials" }, { status: 500 });
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    
    const publicClient = createPublicClient({
      chain: polygonAmoy,
      transport: http(rpcUrl)
    });

    const walletClient = createWalletClient({
      account,
      chain: polygonAmoy,
      transport: http(rpcUrl)
    });

    // Simulate the transaction first
    const { request } = await publicClient.simulateContract({
      address: CCTP_CONTRACTS.polygon.messageTransmitter as `0x${string}`,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: 'receiveMessage',
      args: [
        messageHex.startsWith('0x') ? messageHex as `0x${string}` : `0x${messageHex}`,
        attestationHex.startsWith('0x') ? attestationHex as `0x${string}` : `0x${attestationHex}`
      ],
      account
    });

    // Execute the transaction
    const hash = await walletClient.writeContract(request);

    // Wait for receipt (optional, but good for returning confirmation)
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return NextResponse.json({ 
      success: true, 
      hash, 
      receipt: {
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status
      } 
    });
  } catch (e: any) {
    console.error("Mint API Error:", e);
    return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
  }
}
