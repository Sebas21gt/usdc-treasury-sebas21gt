import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import * as anchor from '@coral-xyz/anchor';
import type { MintResult, CctpAttestation } from '@usdc-treasury/shared';
import { CCTP_CONTRACTS } from '../config';

// Import IDL
import MessageTransmitterIdl from '../cctp/solana/idl/message_transmitter.json';
import TokenMessengerMinterIdl from '../cctp/solana/idl/token_messenger_minter.json';

function getKeypair(): Keypair {
  const raw = process.env.SOLANA_PRIVATE_KEY;
  if (!raw) throw new Error('SOLANA_PRIVATE_KEY env var not set');
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); }
  catch { return Keypair.fromSecretKey(bs58.decode(raw)); }
}

function getConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, 'confirmed');
}

export async function getSolanaBalance(rpcUrl: string): Promise<number> {
  const connection = getConnection(rpcUrl);
  const keypair = getKeypair();
  const usdcMint = new PublicKey(CCTP_CONTRACTS.solana.usdc);
  const ata = getAssociatedTokenAddressSync(usdcMint, keypair.publicKey);
  try {
    const acc = await getAccount(connection, ata);
    return Number(acc.amount) / 1000000;
  } catch {
    return 0;
  }
}

export function solanaExplorerUrl(txHash: string): string {
  return `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
}

export async function solanaMint(params: {
  rpcUrl: string;
  attestation: CctpAttestation;
  sourceChainDomain: number;
}): Promise<MintResult> {
  const { rpcUrl, attestation, sourceChainDomain } = params;
  const connection = getConnection(rpcUrl);
  const keypair = getKeypair();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), { commitment: 'confirmed' });
  
  const messageTransmitterProgram = new anchor.Program(MessageTransmitterIdl as anchor.Idl, provider);
  const tokenMessengerMinterProgram = new anchor.Program(TokenMessengerMinterIdl as anchor.Idl, provider);
  const usdcMint = new PublicKey(CCTP_CONTRACTS.solana.usdc);

  const msgBytes = Buffer.from(attestation.message.replace('0x', ''), 'hex');
  const attBytes = Buffer.from(attestation.attestation.replace('0x', ''), 'hex');
  const nonce = msgBytes.subarray(12, 44);

  const remoteUsdcAddressHex = "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582"; // Polygon Amoy USDC
  const remoteTokenAddressHex = `0x000000000000000000000000${remoteUsdcAddressHex.replace('0x', '')}`;
  
  const findProgramAddress = (label: string, programId: PublicKey, extraSeeds: (string | number[] | Buffer | PublicKey)[] | null = null) => {
    const seeds: Buffer[] = [Buffer.from(anchor.utils.bytes.utf8.encode(label))];
    if (extraSeeds) {
      for (const extraSeed of extraSeeds) {
        if (typeof extraSeed === "string") seeds.push(Buffer.from(anchor.utils.bytes.utf8.encode(extraSeed)));
        else if (Array.isArray(extraSeed)) seeds.push(Buffer.from(extraSeed as number[]));
        else if (Buffer.isBuffer(extraSeed)) seeds.push(Buffer.from(extraSeed));
        else seeds.push((extraSeed as PublicKey).toBuffer());
      }
    }
    return PublicKey.findProgramAddressSync(seeds, programId)[0];
  };

  const tokenMessengerAccount = findProgramAddress("token_messenger", tokenMessengerMinterProgram.programId);
  const messageTransmitterAccount = findProgramAddress("message_transmitter", messageTransmitterProgram.programId);
  const tokenMinterAccount = findProgramAddress("token_minter", tokenMessengerMinterProgram.programId);
  const localToken = findProgramAddress("local_token", tokenMessengerMinterProgram.programId, [usdcMint]);
  const remoteTokenMessengerKey = findProgramAddress("remote_token_messenger", tokenMessengerMinterProgram.programId, [sourceChainDomain.toString()]);
  const remoteTokenKey = new PublicKey(Buffer.from(remoteTokenAddressHex.replace("0x", ""), "hex"));
  const tokenPair = findProgramAddress("token_pair", tokenMessengerMinterProgram.programId, [sourceChainDomain.toString(), remoteTokenKey]);
  const custodyTokenAccount = findProgramAddress("custody", tokenMessengerMinterProgram.programId, [usdcMint]);
  const authorityPda = findProgramAddress("message_transmitter_authority", messageTransmitterProgram.programId, [tokenMessengerMinterProgram.programId]);
  const tokenMessengerEventAuthority = findProgramAddress("__event_authority", tokenMessengerMinterProgram.programId);
  const usedNonce = findProgramAddress("used_nonce", messageTransmitterProgram.programId, [nonce]);

  const tokenMessengerAccounts = await (tokenMessengerMinterProgram.account as any).tokenMessenger.fetch(tokenMessengerAccount);
  const feeRecipientTokenAccount = getAssociatedTokenAddressSync(usdcMint, tokenMessengerAccounts.feeRecipient);
  const userTokenAccount = getAssociatedTokenAddressSync(usdcMint, keypair.publicKey);

  const accountMetas = [
    { isSigner: false, isWritable: false, pubkey: tokenMessengerAccount },
    { isSigner: false, isWritable: false, pubkey: remoteTokenMessengerKey },
    { isSigner: false, isWritable: true, pubkey: tokenMinterAccount },
    { isSigner: false, isWritable: true, pubkey: localToken },
    { isSigner: false, isWritable: false, pubkey: tokenPair },
    { isSigner: false, isWritable: true, pubkey: feeRecipientTokenAccount },
    { isSigner: false, isWritable: true, pubkey: userTokenAccount },
    { isSigner: false, isWritable: true, pubkey: custodyTokenAccount },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: tokenMessengerEventAuthority },
    { isSigner: false, isWritable: false, pubkey: tokenMessengerMinterProgram.programId },
  ];

  console.log(`Submitting receiveMessage on Solana using Anchor...`);
  const tx = await (messageTransmitterProgram as any).methods
    .receiveMessage({ message: msgBytes, attestation: attBytes })
    .accounts({
      payer: keypair.publicKey,
      caller: keypair.publicKey,
      authorityPda,
      messageTransmitter: messageTransmitterAccount,
      usedNonce,
      receiver: tokenMessengerMinterProgram.programId,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(accountMetas)
    .rpc();

  return { txHash: tx };
}
