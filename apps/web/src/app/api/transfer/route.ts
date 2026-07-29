import { NextResponse } from 'next/server';
import {
  CCTP_CONTRACTS,
  SupportedChain,
  waitForAttestation,
  transferUsdc,
  executeBurn,
  executeMint,
} from '@usdc-treasury/engine';
// Server-only: uses Node's fs/path, kept out of the client-safe barrel above.
import { recordMovement } from '@usdc-treasury/engine/src/core/history';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, fromChain, toChain, amount, destinationAddress } = body as {
      action: string;
      fromChain: SupportedChain;
      toChain: SupportedChain;
      amount: number;
      destinationAddress: string;
    };

    // Fully server-side leg: neither side is Stellar, so no Pollar signer is needed.
    if (action === 'transfer') {
      const result = await transferUsdc({ fromChain, toChain, amount, destinationAddress });
      const record = recordMovement({ fromChain, toChain, amount, burnHash: result.burnHash, mintHash: result.mintHash, mode: 'manual' });
      return NextResponse.json({ success: true, ...result, historyId: record.id });
    }

    // Source is Polygon/Solana, destination is Stellar: the server can burn
    // and wait for the attestation, but the mint into Stellar must be signed
    // client-side via Pollar's signAndSubmitTx, so we hand the attestation back.
    if (action === 'burn_and_wait') {
      const { hash: burnHash } = await executeBurn({ fromChain, toChain, amount, destinationAddress });
      const sourceDomain = CCTP_CONTRACTS[fromChain].domain;
      const { message, attestation } = await waitForAttestation(sourceDomain, burnHash);
      return NextResponse.json({
        success: true,
        burnHash,
        needsClientMint: true,
        messageHex: message,
        attestationHex: attestation,
      });
    }

    // Source is Stellar (already burned + signed client-side via Pollar):
    // wait for the attestation and mint on the Polygon/Solana destination.
    if (action === 'mint_from_stellar_burn') {
      const { burnTxHash } = body as { burnTxHash: string };
      const sourceDomain = CCTP_CONTRACTS.stellar.domain;
      const { message, attestation } = await waitForAttestation(sourceDomain, burnTxHash);
      const { hash: mintHash } = await executeMint({
        toChain,
        messageHex: message,
        attestationHex: attestation,
      });
      const record = recordMovement({ fromChain: 'stellar', toChain, amount, burnHash: burnTxHash, mintHash, mode: 'manual' });
      return NextResponse.json({ success: true, mintHash, historyId: record.id });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e: any) {
    console.error('Transfer API Error:', e);
    return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
  }
}
