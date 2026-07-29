// Demo/visual feature, NOT part of the CCTP rebalance engine: simulates a
// P2P payment (P1 on Stellar -> P2 on Polygon/Solana) that settles instantly
// off the treasury's existing liquidity, with no CCTP burn/mint involved.
// CCTP is only ever used separately, to rebalance the treasury itself.
import { buildFullStellarPaymentTx } from '../chains/stellar';
import { payUsdcOnPolygon } from '../chains/polygon';
import { payUsdcOnSolana } from '../chains/solana';
import type { StellarXdrSigner } from './transferUsdc';

// Client-side half: P1 (whoever is connected via Pollar) pays the treasury's
// known Stellar address directly - a plain SEP-41 transfer, no CCTP.
export async function payIntoTreasuryFromStellar(params: {
  stellarWalletAddress: string;
  treasuryStellarAddress: string;
  amount: number; // human-readable USDC (7 decimals on Stellar)
  signStellarXdr: StellarXdrSigner;
}): Promise<{ hash: string }> {
  const amountSubunits = BigInt(Math.round(params.amount * 10_000_000));
  const xdr = await buildFullStellarPaymentTx({
    amountSubunits,
    toStrkey: params.treasuryStellarAddress,
    sourceAccountPubkey: params.stellarWalletAddress,
  });
  const result = await params.signStellarXdr(xdr);
  if (result.status === 'error' || !result.hash) {
    throw new Error(result.details || 'Stellar payment into treasury failed');
  }
  return { hash: result.hash };
}

// Server-side half: the treasury credits P2 on Polygon or Solana with a
// plain token transfer from its own wallet there - no CCTP.
export async function creditFromTreasury(params: {
  toChain: 'polygon' | 'solana';
  destinationAddress: string;
  amount: number; // human-readable USDC (6 decimals on both chains)
  polygonPrivateKeyHex?: string;
  polygonRpcUrl?: string;
  solanaPrivateKeyBase58?: string;
  solanaRpcUrl?: string;
}): Promise<{ hash: string }> {
  const amountSubunits = BigInt(Math.round(params.amount * 1_000_000));

  if (params.toChain === 'polygon') {
    const privateKeyHex = params.polygonPrivateKeyHex ?? process.env.POLYGON_PRIVATE_KEY;
    if (!privateKeyHex) throw new Error('Missing POLYGON_PRIVATE_KEY');
    const result = await payUsdcOnPolygon({
      amountSubunits,
      toAddress: params.destinationAddress,
      privateKeyHex,
      rpcUrl: params.polygonRpcUrl ?? process.env.POLYGON_RPC_URL,
    });
    return { hash: result.hash };
  }

  const privateKeyBase58 = params.solanaPrivateKeyBase58 ?? process.env.SOLANA_PRIVATE_KEY;
  if (!privateKeyBase58) throw new Error('Missing SOLANA_PRIVATE_KEY');
  const result = await payUsdcOnSolana({
    amountSubunits,
    toOwnerAddress: params.destinationAddress,
    privateKeyBase58,
    rpcUrl: params.solanaRpcUrl,
  });
  return { hash: result.hash };
}
