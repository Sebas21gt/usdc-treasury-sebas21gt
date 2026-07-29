import 'dotenv/config';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { privateKeyToAccount } from 'viem/accounts';
import { startInventoryMonitor, TreasuryStatus, RangeStatus } from '../packages/engine/src/index';

function statusLabel(status: RangeStatus): string {
  if (status === 'below_min') return 'BELOW MIN';
  if (status === 'above_max') return 'ABOVE MAX';
  return 'within range';
}

function printStatus(status: TreasuryStatus) {
  console.log(`\n[${status.timestamp}]`);
  for (const chain of Object.values(status.chains)) {
    console.log(
      `  ${chain.chain.padEnd(8)} ${chain.balance.toFixed(2).padStart(8)} USDC` +
        `  (min ${chain.min} / target ${chain.target} / max ${chain.max})` +
        `  -> ${statusLabel(chain.status)}`
    );
  }
}

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

  console.log('Starting inventory monitor (Ctrl+C to stop)');
  console.log(`Polygon: ${polygonAccount.address}`);
  console.log(`Solana:  ${solanaKeypair.publicKey.toBase58()}`);
  console.log(`Stellar: ${stellarAddress}`);

  const { stop } = startInventoryMonitor({
    addresses: {
      polygonAddress: polygonAccount.address,
      solanaAddress: solanaKeypair.publicKey.toBase58(),
      stellarAddress,
    },
    intervalMs: 30_000,
    onUpdate: printStatus,
    onError: (error) => console.error('[monitor] error reading balances:', error),
  });

  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });
}

main();
