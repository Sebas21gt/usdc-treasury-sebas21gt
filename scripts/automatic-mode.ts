import 'dotenv/config';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { privateKeyToAccount } from 'viem/accounts';
import { startAutomaticMode } from '../packages/engine/src/core/automatic';

function main() {
  const polygonPrivateKey = process.env.POLYGON_PRIVATE_KEY;
  const solanaPrivateKeyBase58 = process.env.SOLANA_PRIVATE_KEY;
  const stellarAddress = process.env.TREASURY_STELLAR_ADDRESS;

  if (!polygonPrivateKey) throw new Error('Missing POLYGON_PRIVATE_KEY in env');
  if (!solanaPrivateKeyBase58) throw new Error('Missing SOLANA_PRIVATE_KEY in env');
  if (!stellarAddress) throw new Error('Missing TREASURY_STELLAR_ADDRESS in env (the Pollar wallet G-address)');

  const polygonAccount = privateKeyToAccount(
    polygonPrivateKey.startsWith('0x') ? (polygonPrivateKey as `0x${string}`) : `0x${polygonPrivateKey}`
  );
  const solanaKeypair = Keypair.fromSecretKey(bs58.decode(solanaPrivateKeyBase58));

  console.log('Starting automatic mode (Ctrl+C to stop)');
  console.log(`Polygon: ${polygonAccount.address}`);
  console.log(`Solana:  ${solanaKeypair.publicKey.toBase58()}`);
  console.log(`Stellar: ${stellarAddress} (rebalances touching Stellar are skipped - no headless Pollar signer)`);

  const { stop } = startAutomaticMode({
    polygonAddress: polygonAccount.address,
    solanaAddress: solanaKeypair.publicKey.toBase58(),
    stellarAddress,
    onLog: (message) => console.log(`[${new Date().toISOString()}] ${message}`),
  });

  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });
}

main();
