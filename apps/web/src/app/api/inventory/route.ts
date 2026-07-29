import { NextResponse } from 'next/server';
import { getTreasuryBalances } from '@usdc-treasury/engine';
import { privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stellarAddress = searchParams.get('stellarAddress') || '';

    let polygonAddress = '';
    const polyKey = process.env.POLYGON_PRIVATE_KEY;
    if (polyKey) {
      const account = privateKeyToAccount(`0x${polyKey.replace('0x', '')}`);
      polygonAddress = account.address;
    }

    let solanaAddress = '';
    if (process.env.SOLANA_PRIVATE_KEY) {
      const keypair = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY));
      solanaAddress = keypair.publicKey.toBase58();
    }

    const balances = await getTreasuryBalances({
      polygonAddress,
      solanaAddress,
      stellarAddress, // Passed from frontend Pollar wallet
    });

    return NextResponse.json({
      ...balances,
      addresses: {
        polygon: polygonAddress,
        solana: solanaAddress,
        stellar: stellarAddress
      }
    });
  } catch (error: any) {
    console.error("Inventory API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
