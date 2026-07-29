import { Address, nativeToScVal, Contract, TransactionBuilder, rpc, Networks, StrKey } from '@stellar/stellar-sdk';
import { CCTP_CONTRACTS } from '../config';

// Constantes para Testnet
const NETWORK_PASSPHRASE = Networks.TESTNET;
const BASE_FEE = '10000';

function fromHex(hexStr: string): Buffer {
  if (hexStr.startsWith('0x')) hexStr = hexStr.slice(2);
  return Buffer.from(hexStr, 'hex');
}

function toHex(buf: Buffer): string {
  return buf.toString('hex');
}

export function buildCctpForwarderHookData(forwardRecipientStrkey: string): string {
  const validRecipient =
    StrKey.isValidEd25519PublicKey(forwardRecipientStrkey) ||
    StrKey.isValidContract(forwardRecipientStrkey) ||
    StrKey.isValidMed25519PublicKey(forwardRecipientStrkey);

  if (!validRecipient) {
    throw new Error(`Invalid Stellar forward recipient: ${forwardRecipientStrkey}`);
  }

  const recipientBytes = Buffer.from(forwardRecipientStrkey, 'utf8');
  const hookData = Buffer.alloc(32 + recipientBytes.length);
  hookData.writeUInt32BE(0, 24); // version = 0
  hookData.writeUInt32BE(recipientBytes.length, 28);
  recipientBytes.copy(hookData, 32);
  return '0x' + toHex(hookData);
}

export function contractStrkeyToBytes32(strkey: string): string {
  if (!StrKey.isValidContract(strkey)) {
    throw new Error(`Invalid Stellar contract strkey: ${strkey}`);
  }
  return '0x' + toHex(StrKey.decodeContract(strkey));
}

// 1. Build XDR to burn USDC on Stellar (TokenMessengerMinter.deposit_for_burn)
export async function buildStellarBurnXdr(params: {
  amountSubunits: bigint; // 7 decimals
  destinationDomain: number;
  mintRecipientBytes32: string; // 32 bytes hex of EVM/Solana address
  burnTokenStrkey: string;
  sourceCallerStrkey: string; // The Pollar wallet address G...
}) {
  const contract = new Contract(CCTP_CONTRACTS.stellar.tokenMessengerMinter);
  
  const args = [
    Address.fromString(params.sourceCallerStrkey).toScVal(),
    nativeToScVal(params.amountSubunits, { type: 'i128' }),
    nativeToScVal(params.destinationDomain, { type: 'u32' }),
    nativeToScVal(fromHex(params.mintRecipientBytes32), { type: 'bytes' }),
    Address.fromString(params.burnTokenStrkey).toScVal(),
    nativeToScVal(Buffer.alloc(32), { type: 'bytes' }), // destinationCaller (zero)
    nativeToScVal(0, { type: 'i128' }), // maxFee = 0
    nativeToScVal(0, { type: 'u32' }), // minFinalityThreshold = 0
  ];

  return contract.call('deposit_for_burn', ...args);
}

export async function buildStellarApproveXdr(params: {
  usdcContractStrkey: string;
  sourceCallerStrkey: string;
  spenderStrkey: string;
  amountSubunits: bigint;
  expirationLedger: number;
}) {
  const contract = new Contract(params.usdcContractStrkey);
  
  const args = [
    Address.fromString(params.sourceCallerStrkey).toScVal(),
    Address.fromString(params.spenderStrkey).toScVal(),
    nativeToScVal(params.amountSubunits, { type: 'i128' }),
    nativeToScVal(params.expirationLedger, { type: 'u32' }),
  ];

  return contract.call('approve', ...args);
}

// 2. Build XDR to mint USDC on Stellar (MessageTransmitter.receive_message)
export async function buildStellarMintXdr(params: {
  messageHex: string;
  attestationHex: string;
}) {
  const contract = new Contract(CCTP_CONTRACTS.stellar.cctpForwarder);
  const args = [
    nativeToScVal(fromHex(params.messageHex), { type: 'bytes' }),
    nativeToScVal(fromHex(params.attestationHex), { type: 'bytes' }),
  ];

  return contract.call('mint_and_forward', ...args);
}

import { Horizon } from '@stellar/stellar-sdk';

export async function buildFullStellarMintTx(params: {
  messageHex: string;
  attestationHex: string;
  sourceAccountPubkey: string;
}) {
  const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
  const account = await horizon.loadAccount(params.sourceAccountPubkey);
  
  const op = await buildStellarMintXdr(params);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(300)
    .build();

  const rpcServer = new rpc.Server('https://soroban-testnet.stellar.org');
  const preparedTx = await rpcServer.prepareTransaction(tx) as any;
  if (preparedTx.error) {
    throw new Error(`Failed to simulate Soroban Tx: ${JSON.stringify(preparedTx.error)}`);
  }

  return preparedTx.toXDR();
}

export async function buildFullStellarBurnTx(params: {
  amountSubunits: bigint;
  destinationDomain: number;
  mintRecipientBytes32: string;
  burnTokenStrkey: string;
  sourceAccountPubkey: string;
}) {
  const op = await buildStellarBurnXdr({
    amountSubunits: params.amountSubunits,
    destinationDomain: params.destinationDomain,
    mintRecipientBytes32: params.mintRecipientBytes32,
    burnTokenStrkey: params.burnTokenStrkey,
    sourceCallerStrkey: params.sourceAccountPubkey
  });

  const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
  const rpcServer = new rpc.Server("https://soroban-testnet.stellar.org");
  const sourceAccount = await horizon.loadAccount(params.sourceAccountPubkey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "10000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const preparedTx = await rpcServer.prepareTransaction(tx) as any;
  if (preparedTx.error) {
    throw new Error(`Failed to simulate Soroban Burn Tx: ${JSON.stringify(preparedTx.error)}`);
  }

  return preparedTx.toXDR();
}

// Plain SEP-41 transfer on the USDC token contract - no CCTP involved. Used
// by the "simulated P2P payment" demo feature (P1 paying into the treasury),
// not by the actual rebalance engine.
export async function buildStellarTransferXdr(params: {
  usdcContractStrkey: string;
  fromStrkey: string;
  toStrkey: string;
  amountSubunits: bigint;
}) {
  const contract = new Contract(params.usdcContractStrkey);
  const args = [
    Address.fromString(params.fromStrkey).toScVal(),
    Address.fromString(params.toStrkey).toScVal(),
    nativeToScVal(params.amountSubunits, { type: 'i128' }),
  ];
  return contract.call('transfer', ...args);
}

export async function buildFullStellarPaymentTx(params: {
  amountSubunits: bigint;
  toStrkey: string;
  sourceAccountPubkey: string;
}) {
  const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
  const rpcServer = new rpc.Server('https://soroban-testnet.stellar.org');
  const sourceAccount = await horizon.loadAccount(params.sourceAccountPubkey);

  const op = await buildStellarTransferXdr({
    usdcContractStrkey: CCTP_CONTRACTS.stellar.usdc,
    fromStrkey: params.sourceAccountPubkey,
    toStrkey: params.toStrkey,
    amountSubunits: params.amountSubunits,
  });

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const preparedTx = await rpcServer.prepareTransaction(tx) as any;
  if (preparedTx.error) {
    throw new Error(`Failed to simulate Soroban Payment Tx: ${JSON.stringify(preparedTx.error)}`);
  }

  return preparedTx.toXDR();
}

export async function buildFullStellarApproveTx(params: {
  amountSubunits: bigint;
  burnTokenStrkey: string;
  sourceAccountPubkey: string;
}) {
  const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
  const rpcServer = new rpc.Server("https://soroban-testnet.stellar.org");
  
  const latestLedger = await rpcServer.getLatestLedger();
  const expirationLedger = latestLedger.sequence + 10000;

  const approveOp = await buildStellarApproveXdr({
    usdcContractStrkey: params.burnTokenStrkey,
    sourceCallerStrkey: params.sourceAccountPubkey,
    spenderStrkey: CCTP_CONTRACTS.stellar.tokenMessengerMinter,
    amountSubunits: params.amountSubunits,
    expirationLedger
  });

  const sourceAccount = await horizon.loadAccount(params.sourceAccountPubkey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "10000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(approveOp)
    .setTimeout(180)
    .build();

  const preparedTx = await rpcServer.prepareTransaction(tx) as any;
  if (preparedTx.error) {
    throw new Error(`Failed to simulate Soroban Approve Tx: ${JSON.stringify(preparedTx.error)}`);
  }

  return preparedTx.toXDR();
}
