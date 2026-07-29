import { getPolygonClients } from '../chains/polygon';
import { getSolanaConnection } from '../chains/solana';
import { CCTP_CONTRACTS } from '../config';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { formatUnits } from 'viem';

// ERC20 minimal ABI for balance
const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }]
  }
] as const;

export async function getPolygonBalance(address: string, rpcUrl?: string): Promise<number> {
  if (!address) return 0;
  // Use a dummy private key just to instantiate the client for public reads if none provided
  const { publicClient } = getPolygonClients('0x0000000000000000000000000000000000000000000000000000000000000001', rpcUrl);
  
  try {
    const balance = await publicClient.readContract({
      address: CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`]
    });
    return parseFloat(formatUnits(balance as bigint, 6));
  } catch (e) {
    console.error("Error fetching Polygon balance:", e);
    return 0;
  }
}

export async function getSolanaBalance(address: string, rpcUrl?: string): Promise<number> {
  if (!address) return 0;
  const connection = getSolanaConnection(rpcUrl);
  try {
    const pubkey = new PublicKey(address);
    const usdcMint = new PublicKey(CCTP_CONTRACTS.solana.usdc);
    const ata = await getAssociatedTokenAddress(usdcMint, pubkey);
    
    const balance = await connection.getTokenAccountBalance(ata);
    return balance.value.uiAmount || 0;
  } catch (e) {
    console.error("Error fetching Solana balance:", e);
    return 0; // Might return 0 if ATA doesn't exist yet
  }
}

export async function getStellarBalance(address: string): Promise<number> {
  if (!address) return 0;
  try {
    // Circle USDC on Stellar Testnet is usually a classic asset: USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUUB3MACLUJGVNN4LNPTTYOBLSJZPII
    // But it can also be queried via Soroban. 
    // The simplest way to get native Stellar balances is via Horizon.
    const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`);
    if (!res.ok) return 0;
    const data = await res.json() as { balances?: { asset_code?: string; balance: string }[] };

    // Find USDC balance (Stellar CCTP Testnet uses this specific issuer)
    const usdcBalance = data.balances?.find((b) => b.asset_code === "USDC");
    if (usdcBalance) {
      return parseFloat(usdcBalance.balance);
    }
    return 0;
  } catch (e) {
    console.error("Error fetching Stellar balance:", e);
    return 0;
  }
}

export async function getTreasuryBalances(params: {
  polygonAddress?: string;
  solanaAddress?: string;
  stellarAddress?: string;
}) {
  const [polygon, solana, stellar] = await Promise.all([
    getPolygonBalance(params.polygonAddress || ''),
    getSolanaBalance(params.solanaAddress || ''),
    getStellarBalance(params.stellarAddress || '')
  ]);

  return { polygon, solana, stellar };
}
