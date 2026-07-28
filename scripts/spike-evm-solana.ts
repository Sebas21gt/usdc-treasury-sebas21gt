import 'dotenv/config';
import { polygonBurn, getPolygonBalance, polygonExplorerUrl } from '../packages/engine/src/chains/polygon';
import { solanaMint, getSolanaBalance, solanaExplorerUrl }    from '../packages/engine/src/chains/solana';
import { pollAttestation }                                    from '../packages/engine/src/cctp/attestation';

const AMOUNT_USDC = 1; 

async function main() {
  console.log('Starting Spike 1: Polygon Amoy -> Solana Devnet (CCTP v2)');
  console.log('---------------------------------------------------------');

  const polygonRpc = process.env.POLYGON_RPC_URL!;
  const solanaRpc  = process.env.SOLANA_RPC_URL!;

  console.log('Reading initial balances...');
  const [polygonBefore, solanaBefore] = await Promise.all([
    getPolygonBalance(polygonRpc),
    getSolanaBalance(solanaRpc),
  ]);
  console.log(`Polygon Amoy: ${polygonBefore} USDC`);
  console.log(`Solana devnet: ${solanaBefore} USDC`);

  console.log(`\nStep 1: Burning ${AMOUNT_USDC} USDC on Polygon Amoy...`);
  
  const { Keypair } = await import('@solana/web3.js');
  const bs58 = (await import('bs58')).default;
  let solanaKeypair: typeof Keypair.prototype;
  try {
    solanaKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_PRIVATE_KEY!)));
  } catch {
    solanaKeypair = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY!));
  }
  const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
  const { PublicKey } = await import('@solana/web3.js');
  const { CCTP_CONTRACTS } = await import('../packages/engine/src/config');
  const usdcMint = new PublicKey(CCTP_CONTRACTS.solana.usdc);
  const userAta = getAssociatedTokenAddressSync(usdcMint, solanaKeypair.publicKey);
  const mintRecipient = `0x${Buffer.from(userAta.toBytes()).toString('hex')}`;

  const burnResult = await polygonBurn({
    rpcUrl:            polygonRpc,
    destinationDomain: 5, 
    amountUsdc:        AMOUNT_USDC,
    mintRecipient:     mintRecipient as `0x${string}`,
  });

  console.log(`Burn transaction sent: ${burnResult.txHash}`);
  console.log(`Polygon Explorer: ${polygonExplorerUrl(burnResult.txHash)}`);

  console.log('\nStep 2: Waiting for Circle attestation (Iris API)...');
  const attestation = await pollAttestation({
    sourceDomain: 7,
    burnTxHash:   burnResult.txHash,
  });
  console.log(`Attestation received.`);

  console.log('\nStep 3: Minting USDC on Solana devnet...');
  const mintResult = await solanaMint({
    rpcUrl:            solanaRpc,
    attestation,
    sourceChainDomain: 7,
  });

  console.log(`Mint transaction sent: ${mintResult.txHash}`);
  console.log(`Solana Explorer: ${solanaExplorerUrl(mintResult.txHash)}`);

  console.log('\nReading final balances...');
  const [polygonAfter, solanaAfter] = await Promise.all([
    getPolygonBalance(polygonRpc),
    getSolanaBalance(solanaRpc),
  ]);

  console.log('\nSPIKE 1 COMPLETED SUCCESSFULLY');
  console.log(`Polygon balance: ${polygonBefore} -> ${polygonAfter} USDC`);
  console.log(`Solana balance:  ${solanaBefore} -> ${solanaAfter} USDC`);
}

main().catch(err => {
  console.error('\nSPIKE 1 FAILED:', err);
  process.exit(1);
});
