import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { StrKey } from '@stellar/stellar-sdk';
import { CCTP_CONTRACTS } from '../config';
import {
  getAnchorConnection,
  getPrograms,
  getDepositForBurnPdas,
  getReceiveMessagePdas,
  decodeNonceFromMessage,
  decodeMintRecipientFromMessage,
  hexToBytes
} from './solana-utils';
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import * as anchor from "@coral-xyz/anchor";

// CCTP v2 Standard finality (fee-less), same convention used on the Polygon side.
const STANDARD_FINALITY_THRESHOLD = 2000;

export function getSolanaConnection(rpcUrl: string = "https://api.devnet.solana.com") {
  return new Connection(rpcUrl, "confirmed");
}

export function getSolanaKeypair(privateKeyBase58: string) {
  return Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
}

// The token_pair PDA is keyed by [remoteDomain, remoteTokenAddress], so minting
// on Solana needs to know the remote chain's USDC token address as bytes32.
function remoteUsdcBytes32ForDomain(domain: number): Buffer {
  if (domain === CCTP_CONTRACTS.polygon.domain) {
    return Buffer.from(CCTP_CONTRACTS.polygon.usdc.replace('0x', '').padStart(64, '0'), 'hex');
  }
  if (domain === CCTP_CONTRACTS.stellar.domain) {
    return Buffer.from(StrKey.decodeContract(CCTP_CONTRACTS.stellar.usdc));
  }
  throw new Error(`No known remote USDC token for CCTP domain ${domain}`);
}

export async function burnOnSolana(params: {
  amountSubunits: bigint;
  destinationDomain: number;
  mintRecipientBytes32: string;
  privateKeyBase58: string;
  rpcUrl?: string;
}) {
  const connection = getSolanaConnection(params.rpcUrl);
  const keypair = getSolanaKeypair(params.privateKeyBase58);

  const provider = getAnchorConnection({
    publicKey: keypair.publicKey,
    signTransaction: async (tx: any) => {
      // partialSign (not sign) - sign() recompiles and wipes any signatures
      // Anchor already added for other required signers (e.g. burnOnSolana's
      // messageSentEventData keypair) before calling this callback.
      tx.partialSign(keypair);
      return tx;
    }
  }, connection.rpcEndpoint);

  const programs = getPrograms(provider);
  const usdcAddress = new PublicKey(CCTP_CONTRACTS.solana.usdc);
  const pdas = getDepositForBurnPdas(
    programs,
    usdcAddress,
    params.destinationDomain,
    keypair.publicKey
  );
  
  const userTokenAccount = await getAssociatedTokenAddress(usdcAddress, keypair.publicKey);
  const mintRecipientBuffer = hexToBytes(params.mintRecipientBytes32);

  // message_sent_event_data is NOT a PDA - it's a fresh account the caller
  // creates and signs for, which the program uses to store the outgoing
  // MessageSent event data for the attestation service to read.
  const messageSentEventData = anchor.web3.Keypair.generate();

  const tx = await (programs.tokenMessengerMinterProgram.methods as any)
    .depositForBurn({
      amount: new BN(params.amountSubunits.toString()),
      destinationDomain: params.destinationDomain,
      // mint_recipient/destination_caller are `pubkey` in the IDL, not
      // `bytes` - Anchor's borsh coder needs an actual PublicKey instance,
      // not a plain byte array (calls .toBuffer() on whatever is passed).
      mintRecipient: new PublicKey(mintRecipientBuffer),
      destinationCaller: new PublicKey(new Uint8Array(32)), // no restriction
      maxFee: new BN(0),
      minFinalityThreshold: STANDARD_FINALITY_THRESHOLD,
    })
    .accounts({
      owner: keypair.publicKey,
      eventRentPayer: keypair.publicKey,
      senderAuthorityPda: pdas.authorityPda.publicKey,
      burnTokenAccount: userTokenAccount,
      denylistAccount: pdas.denylistAccount.publicKey,
      messageTransmitter: pdas.messageTransmitterAccount.publicKey,
      tokenMessenger: pdas.tokenMessengerAccount.publicKey,
      remoteTokenMessenger: pdas.remoteTokenMessengerKey.publicKey,
      tokenMinter: pdas.tokenMinterAccount.publicKey,
      localToken: pdas.localToken.publicKey,
      burnTokenMint: usdcAddress,
      messageSentEventData: messageSentEventData.publicKey,
      messageTransmitterProgram: programs.messageTransmitterProgram.programId,
      tokenMessengerMinterProgram: programs.tokenMessengerMinterProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      eventAuthority: pdas.eventAuthority.publicKey,
      program: programs.tokenMessengerMinterProgram.programId,
    })
    .signers([messageSentEventData])
    .rpc();

  // Wait for confirmation to get the block info
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({
    signature: tx,
    ...latestBlockhash
  }, 'confirmed');

  return {
    hash: tx,
    blockNumber: latestBlockhash.lastValidBlockHeight.toString()
  };
}

export async function mintOnSolana(params: {
  messageHex: string;
  attestationHex: string;
  privateKeyBase58: string;
  rpcUrl?: string;
}) {
  const connection = getSolanaConnection(params.rpcUrl);
  const keypair = getSolanaKeypair(params.privateKeyBase58);
  const usdcAddress = new PublicKey(CCTP_CONTRACTS.solana.usdc);

  const provider = getAnchorConnection({
    publicKey: keypair.publicKey,
    signTransaction: async (tx: any) => {
      // partialSign (not sign) - sign() recompiles and wipes any signatures
      // Anchor already added for other required signers (e.g. burnOnSolana's
      // messageSentEventData keypair) before calling this callback.
      tx.partialSign(keypair);
      return tx;
    }
  }, connection.rpcEndpoint);

  const programs = getPrograms(provider);
  
  const messageBytes = hexToBytes(params.messageHex);
  const attestationBytes = hexToBytes(params.attestationHex);
  
  // Extract source domain from message
  const sourceDomainBuffer = messageBytes.subarray(4, 8);
  const sourceDomain = sourceDomainBuffer.readUInt32BE(0);

  const nonce = decodeNonceFromMessage(params.messageHex);
  const recipientTokenAccount = decodeMintRecipientFromMessage(params.messageHex);
  const remoteTokenBytes32 = remoteUsdcBytes32ForDomain(sourceDomain);

  const pdas = await getReceiveMessagePdas(
    programs,
    usdcAddress,
    sourceDomain,
    remoteTokenBytes32,
    nonce
  );

  // Account order for the handle_receive_finalized_message CPI must match
  // token_messenger_minter's IDL exactly (verified against the local IDL JSON).
  // NOTE: authority_pda is NOT included here - MessageTransmitter injects it
  // itself as the first account when it CPIs into the receiver program.
  const tx = await (programs.messageTransmitterProgram.methods as any)
    .receiveMessage({
      message: messageBytes,
      attestation: attestationBytes,
    })
    .accounts({
      payer: keypair.publicKey,
      caller: keypair.publicKey,
      authorityPda: pdas.authorityPda,
      messageTransmitter: pdas.messageTransmitterAccount.publicKey,
      usedNonce: pdas.usedNonce,
      receiver: programs.tokenMessengerMinterProgram.programId,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: pdas.tokenMessengerAccount.publicKey, isWritable: false, isSigner: false },
      { pubkey: pdas.remoteTokenMessengerKey.publicKey, isWritable: false, isSigner: false },
      { pubkey: pdas.tokenMinterAccount.publicKey, isWritable: true, isSigner: false },
      { pubkey: pdas.localToken.publicKey, isWritable: true, isSigner: false },
      { pubkey: pdas.tokenPair.publicKey, isWritable: false, isSigner: false },
      { pubkey: pdas.feeRecipientTokenAccount, isWritable: true, isSigner: false },
      { pubkey: recipientTokenAccount, isWritable: true, isSigner: false },
      { pubkey: pdas.custodyTokenAccount.publicKey, isWritable: true, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: pdas.tokenMessengerEventAuthority.publicKey, isWritable: false, isSigner: false },
      { pubkey: programs.tokenMessengerMinterProgram.programId, isWritable: false, isSigner: false },
    ])
    .rpc();

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({
    signature: tx,
    ...latestBlockhash
  }, 'confirmed');

  return {
    hash: tx,
    blockNumber: latestBlockhash.lastValidBlockHeight.toString()
  };
}

// Plain SPL token transfer - no CCTP involved. Used by the "simulated P2P
// payment" demo feature (treasury crediting P2 on Solana), not by the
// actual rebalance engine. Creates the recipient's ATA if it doesn't exist
// yet (the treasury, as payer, covers that rent).
export async function payUsdcOnSolana(params: {
  amountSubunits: bigint;
  toOwnerAddress: string;
  privateKeyBase58: string;
  rpcUrl?: string;
}) {
  const connection = getSolanaConnection(params.rpcUrl);
  const keypair = getSolanaKeypair(params.privateKeyBase58);
  const usdcMint = new PublicKey(CCTP_CONTRACTS.solana.usdc);
  const toOwner = new PublicKey(params.toOwnerAddress);

  const fromAta = await getAssociatedTokenAddress(usdcMint, keypair.publicKey);
  const toAtaAccount = await getOrCreateAssociatedTokenAccount(connection, keypair, usdcMint, toOwner);

  const tx = new Transaction().add(
    createTransferInstruction(fromAta, toAtaAccount.address, keypair.publicKey, params.amountSubunits)
  );

  const hash = await sendAndConfirmTransaction(connection, tx, [keypair]);
  return { hash };
}
