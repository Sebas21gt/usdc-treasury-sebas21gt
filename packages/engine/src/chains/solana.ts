import { Connection, Keypair, PublicKey } from '@solana/web3.js';
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
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import * as anchor from "@coral-xyz/anchor";

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
      // Anchor's .rpc() builds a legacy Transaction here, whose sign()
      // takes variadic signers, not an array (that's VersionedTransaction's signature).
      tx.sign(keypair);
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

  const tx = await (programs.tokenMessengerMinterProgram.methods as any)
    .depositForBurn({
      amount: new BN(params.amountSubunits.toString()),
      destinationDomain: params.destinationDomain,
      mintRecipient: Array.from(mintRecipientBuffer),
    })
    .accounts({
      owner: keypair.publicKey,
      eventRentPayer: keypair.publicKey,
      senderAuthorityPda: pdas.authorityPda.publicKey,
      burnTokenAccount: userTokenAccount,
      messageTransmitter: pdas.messageTransmitterAccount.publicKey,
      tokenMessenger: pdas.tokenMessengerAccount.publicKey,
      tokenMinter: pdas.tokenMinterAccount.publicKey,
      localToken: pdas.localToken.publicKey,
      burnTokenMint: usdcAddress,
      remoteTokenMessenger: pdas.remoteTokenMessengerKey.publicKey,
      eventAuthority: pdas.eventAuthority.publicKey,
      messageTransmitterProgram: programs.messageTransmitterProgram.programId,
      tokenMessengerMinterProgram: programs.tokenMessengerMinterProgram.programId,
    })
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
      // Anchor's .rpc() builds a legacy Transaction here, whose sign()
      // takes variadic signers, not an array (that's VersionedTransaction's signature).
      tx.sign(keypair);
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
