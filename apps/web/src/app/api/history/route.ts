import { NextResponse } from 'next/server';
import { SupportedChain } from '@usdc-treasury/engine';
// Server-only: uses Node's fs/path, kept out of the client-safe barrel above.
import { getHistory, recordMovement, TransferMode } from '@usdc-treasury/engine/src/core/history';
import { parseAmount, safeErrorMessage } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ history: getHistory() });
}

// Used only by the destination-is-Stellar manual flow: the burn (and the
// server-side wait) already happened via /api/transfer's burn_and_wait
// action, but the mint is signed client-side via Pollar, so the client is
// the only one who knows the final mint hash and reports it here.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { fromChain, toChain, burnHash, mintHash, mode } = body as {
      fromChain: SupportedChain;
      toChain: SupportedChain;
      burnHash: string;
      mintHash: string;
      mode: TransferMode;
    };
    const amount = parseAmount(body.amount);
    if (!burnHash || !mintHash) {
      return NextResponse.json({ error: 'burnHash and mintHash are required' }, { status: 400 });
    }
    const record = recordMovement({ fromChain, toChain, amount, burnHash, mintHash, mode: mode ?? 'manual' });
    return NextResponse.json({ success: true, record });
  } catch (e: any) {
    console.error('History API Error:', e);
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 });
  }
}
