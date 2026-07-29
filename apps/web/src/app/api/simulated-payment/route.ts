import { NextResponse } from 'next/server';
import { creditFromTreasury } from '@usdc-treasury/engine';
import { parseAmount, safeErrorMessage } from '@/lib/api';

// Demo/visual feature: credits P2 on Polygon or Solana with a plain token
// transfer from the treasury's own wallet - no CCTP. The Stellar half (P1
// paying into the treasury) is signed client-side via Pollar before this
// is called; see page.tsx.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { toChain, destinationAddress } = body as {
      toChain: 'polygon' | 'solana';
      destinationAddress: string;
    };

    if (toChain !== 'polygon' && toChain !== 'solana') {
      return NextResponse.json({ error: 'Simulated payments can only credit Polygon or Solana' }, { status: 400 });
    }
    if (!destinationAddress) {
      return NextResponse.json({ error: 'destinationAddress is required' }, { status: 400 });
    }
    const amount = parseAmount(body.amount);

    const { hash } = await creditFromTreasury({ toChain, destinationAddress, amount });
    return NextResponse.json({ success: true, hash });
  } catch (e: any) {
    console.error('Simulated Payment API Error:', e);
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 });
  }
}
