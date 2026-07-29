import 'dotenv/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { privateKeyToAccount } from 'viem/accounts';
import bs58 from 'bs58';
import {
  CCTP_CONTRACTS,
  burnOnPolygon,
  mintOnSolana,
  waitForAttestation,
  getPolygonBalance,
  getSolanaBalance,
} from '../packages/engine/src/index';

const AMOUNT_USDC = 1;

function polygonExplorerUrl(hash: string) {
  return `https://amoy.polygonscan.com/tx/${hash}`;
}

function solanaExplorerUrl(hash: string) {
  return `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
}

async function main() {
  console.log('Spike: Polygon Amoy -> Solana devnet (CCTP v2, Standard transfer)');
  console.log('-------------------------------------------------------------------');

  const polygonPrivateKey = process.env.POLYGON_PRIVATE_KEY;
  const polygonRpcUrl = process.env.POLYGON_RPC_URL;
  const solanaPrivateKeyBase58 = process.env.SOLANA_PRIVATE_KEY;
  const solanaRpcUrl = process.env.SOLANA_RPC_URL;

  if (!polygonPrivateKey) throw new Error('Missing POLYGON_PRIVATE_KEY in env');
  if (!solanaPrivateKeyBase58) throw new Error('Missing SOLANA_PRIVATE_KEY in env');

  const polygonAccount = privateKeyToAccount(
    polygonPrivateKey.startsWith('0x') ? (polygonPrivateKey as `0x${string}`) : `0x${polygonPrivateKey}`
  );
  const solanaKeypair = Keypair.fromSecretKey(bs58.decode(solanaPrivateKeyBase58));

  console.log(`Polygon account: ${polygonAccount.address}`);
  console.log(`Solana account:  ${solanaKeypair.publicKey.toBase58()}`);

  console.log('\nReading initial balances...');
  const [polygonBefore, solanaBefore] = await Promise.all([
    getPolygonBalance(polygonAccount.address, polygonRpcUrl),
    getSolanaBalance(solanaKeypair.publicKey.toBase58(), solanaRpcUrl),
  ]);
  console.log(`Polygon Amoy: ${polygonBefore} USDC`);
  console.log(`Solana devnet: ${solanaBefore} USDC`);

  const usdcMint = new PublicKey(CCTP_CONTRACTS.solana.usdc);
  const solanaAta = await getAssociatedTokenAddress(usdcMint, solanaKeypair.publicKey);
  const mintRecipientBytes32 = `0x${Buffer.from(solanaAta.toBytes()).toString('hex')}`;
  const amountSubunits = BigInt(AMOUNT_USDC * 1_000_000); // 6 decimals

  console.log(`\nStep 1: burning ${AMOUNT_USDC} USDC on Polygon Amoy (depositForBurn, Standard finality)...`);
  const burnResult = await burnOnPolygon({
    amountSubunits,
    destinationDomain: CCTP_CONTRACTS.solana.domain,
    mintRecipientBytes32,
    privateKeyHex: polygonPrivateKey,
    rpcUrl: polygonRpcUrl,
  });
  console.log(`Burn tx: ${burnResult.hash}`);
  console.log(`Polygon Explorer: ${polygonExplorerUrl(burnResult.hash)}`);

  console.log('\nStep 2: waiting for Circle attestation (Iris API v2)...');
  const { message, attestation } = await waitForAttestation(CCTP_CONTRACTS.polygon.domain, burnResult.hash);
  console.log('Attestation received.');

  console.log('\nStep 3: minting USDC on Solana devnet (receiveMessage)...');
  const mintResult = await mintOnSolana({
    messageHex: message,
    attestationHex: attestation,
    privateKeyBase58: solanaPrivateKeyBase58,
    rpcUrl: solanaRpcUrl,
  });
  console.log(`Mint tx: ${mintResult.hash}`);
  console.log(`Solana Explorer: ${solanaExplorerUrl(mintResult.hash)}`);

  console.log('\nReading final balances...');
  const [polygonAfter, solanaAfter] = await Promise.all([
    getPolygonBalance(polygonAccount.address, polygonRpcUrl),
    getSolanaBalance(solanaKeypair.publicKey.toBase58(), solanaRpcUrl),
  ]);

  console.log('\nSPIKE COMPLETED SUCCESSFULLY');
  console.log(`Polygon balance: ${polygonBefore} -> ${polygonAfter} USDC`);
  console.log(`Solana balance:  ${solanaBefore} -> ${solanaAfter} USDC`);
  console.log('\nResult (for README):');
  console.log(
    JSON.stringify(
      {
        burnTxHash: burnResult.hash,
        burnExplorer: polygonExplorerUrl(burnResult.hash),
        mintTxHash: mintResult.hash,
        mintExplorer: solanaExplorerUrl(mintResult.hash),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('\nSPIKE FAILED:', err);
  process.exit(1);
});
