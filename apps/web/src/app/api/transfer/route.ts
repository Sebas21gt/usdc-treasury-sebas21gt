import { NextResponse } from 'next/server';
import { 
  waitForAttestation, 
  CCTP_CONTRACTS, 
  SupportedChain,
  burnOnPolygon,
  mintOnPolygon,
  mintOnSolana,
  burnOnSolana
} from '@usdc-treasury/engine';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, sourceDomain, txHash, destinationDomain, amount, mintRecipientBytes32 } = body;

    const privateKey = process.env.POLYGON_PRIVATE_KEY || process.env.NEXT_PUBLIC_POLYGON_PRIVATE_KEY;
    const rpcUrl = process.env.POLYGON_RPC_URL || process.env.NEXT_PUBLIC_POLYGON_RPC_URL || "https://polygon-amoy.drpc.org";
    const solanaKey = process.env.SOLANA_PRIVATE_KEY;

    if (!privateKey || !rpcUrl) {
      return NextResponse.json({ error: "Server configuration missing EVM credentials" }, { status: 500 });
    }

    if (action === 'mint') {
      // 1. Wait for attestation
      console.log(`Polling for attestation for tx: ${txHash} on domain ${sourceDomain}...`);
      const { message, attestation } = await waitForAttestation(sourceDomain, txHash);
      
      // 2. Mint on destination
      let mintResult;
      if (destinationDomain === CCTP_CONTRACTS.polygon.domain) {
        mintResult = await mintOnPolygon({ messageHex: message, attestationHex: attestation, privateKeyHex: privateKey, rpcUrl });
      } else if (destinationDomain === CCTP_CONTRACTS.solana.domain) {
        if (!solanaKey) throw new Error("Missing SOLANA_PRIVATE_KEY");
        mintResult = await mintOnSolana({ messageHex: message, attestationHex: attestation, privateKeyBase58: solanaKey });
      } else {
        throw new Error("Cannot mint on Stellar via API. Must be done client-side.");
      }

      return NextResponse.json({ success: true, hash: mintResult.hash, blockNumber: mintResult.blockNumber });
    } 
    
    if (action === 'full_transfer') {
      // Handles Burn + Poll + Mint when server has the private keys (Polygon, Solana)
      let burnResult;
      if (sourceDomain === CCTP_CONTRACTS.polygon.domain) {
        burnResult = await burnOnPolygon({
          amountSubunits: BigInt(amount),
          destinationDomain,
          mintRecipientBytes32,
          privateKeyHex: privateKey,
          rpcUrl
        });
      } else if (sourceDomain === CCTP_CONTRACTS.solana.domain) {
        if (!solanaKey) throw new Error("Missing SOLANA_PRIVATE_KEY");
        burnResult = await burnOnSolana({
          amountSubunits: BigInt(amount),
          destinationDomain,
          mintRecipientBytes32,
          privateKeyBase58: solanaKey
        });
      } else {
        throw new Error("Cannot burn on Stellar via API. Must be done client-side via Pollar.");
      }

      console.log(`Burn success: ${burnResult.hash}. Polling attestation...`);
      const { message, attestation } = await waitForAttestation(sourceDomain, burnResult.hash);

      let mintResult;
      if (destinationDomain === CCTP_CONTRACTS.polygon.domain) {
        mintResult = await mintOnPolygon({ messageHex: message, attestationHex: attestation, privateKeyHex: privateKey, rpcUrl });
      } else if (destinationDomain === CCTP_CONTRACTS.solana.domain) {
        if (!solanaKey) throw new Error("Missing SOLANA_PRIVATE_KEY");
        mintResult = await mintOnSolana({ messageHex: message, attestationHex: attestation, privateKeyBase58: solanaKey });
      } else {
        // If destination is Stellar, we must return the attestation so the frontend can mint it.
        return NextResponse.json({ 
          success: true, 
          burnHash: burnResult.hash, 
          needsClientMint: true,
          messageHex: message,
          attestationHex: attestation
        });
      }

      return NextResponse.json({ success: true, burnHash: burnResult.hash, mintHash: mintResult.hash });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  } catch (e: any) {
    console.error("Transfer API Error:", e);
    return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
  }
}
