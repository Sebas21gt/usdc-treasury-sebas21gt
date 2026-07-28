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

  // Dummy transaction builder just to get the operation XDR
  // In Pollar, you can pass the operation to `buildTx({ operations: [op] })`
  return contract.call('deposit_for_burn', ...args);
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
  const preparedTx = await rpcServer.prepareTransaction(tx);

  return preparedTx.toXDR();
}
