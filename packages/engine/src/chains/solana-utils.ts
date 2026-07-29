import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

// Import IDLs from JSON files
import MessageTransmitterIdl from "./idl/message_transmitter.json";
import TokenMessengerMinterIdl from "./idl/token_messenger_minter.json";

export interface FindProgramAddressResponse {
  publicKey: anchor.web3.PublicKey;
  bump: number;
}

export interface SolanaAnchorWalletProvider {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions?<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]>;
}

// Configure client to use the provider and return it
export const getAnchorConnection = (
  walletProvider: SolanaAnchorWalletProvider,
  rpcUrl: string
) => {
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet: anchor.Wallet = {
    payer: Keypair.generate(),
    publicKey: walletProvider.publicKey,
    signTransaction: (tx: any) => walletProvider.signTransaction(tx),
    signAllTransactions: (txs: any) =>
      walletProvider.signAllTransactions
        ? walletProvider.signAllTransactions(txs)
        : Promise.all(txs.map((tx: any) => walletProvider.signTransaction(tx))),
  };
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  return provider;
};

export const getPrograms = (provider: anchor.AnchorProvider) => {
  // Anchor will automatically use the program ID from the IDL metadata
  const messageTransmitterProgram = new anchor.Program<any>(
    MessageTransmitterIdl as any,
    provider
  );

  const tokenMessengerMinterProgram =
    new anchor.Program<any>(
      TokenMessengerMinterIdl as any,
      provider
    );

  return { messageTransmitterProgram, tokenMessengerMinterProgram };
};

export const getDepositForBurnPdas = (
  {
    messageTransmitterProgram,
    tokenMessengerMinterProgram,
  }: ReturnType<typeof getPrograms>,
  usdcAddress: PublicKey,
  destinationDomain: number,
  owner: PublicKey
) => {
  const messageTransmitterAccount = findProgramAddress(
    "message_transmitter",
    messageTransmitterProgram.programId
  );
  const tokenMessengerAccount = findProgramAddress(
    "token_messenger",
    tokenMessengerMinterProgram.programId
  );
  const tokenMinterAccount = findProgramAddress(
    "token_minter",
    tokenMessengerMinterProgram.programId
  );
  const localToken = findProgramAddress(
    "local_token",
    tokenMessengerMinterProgram.programId,
    [usdcAddress]
  );
  const remoteTokenMessengerKey = findProgramAddress(
    "remote_token_messenger",
    tokenMessengerMinterProgram.programId,
    [destinationDomain.toString()]
  );
  const authorityPda = findProgramAddress(
    "sender_authority",
    tokenMessengerMinterProgram.programId
  );
  const eventAuthority = findProgramAddress(
    "__event_authority",
    tokenMessengerMinterProgram.programId
  );

  return {
    messageTransmitterAccount,
    tokenMessengerAccount,
    tokenMinterAccount,
    localToken,
    remoteTokenMessengerKey,
    authorityPda,
    eventAuthority,
  };
};

export const getReceiveMessagePdas = async (
  {
    messageTransmitterProgram,
    tokenMessengerMinterProgram,
  }: ReturnType<typeof getPrograms>,
  solUsdcAddress: PublicKey,
  remoteDomain: number,
  remoteTokenBytes32: Buffer,
  nonce: Buffer
) => {
  const tokenMessengerAccount = findProgramAddress(
    "token_messenger",
    tokenMessengerMinterProgram.programId
  );
  const messageTransmitterAccount = findProgramAddress(
    "message_transmitter",
    messageTransmitterProgram.programId
  );
  const tokenMinterAccount = findProgramAddress(
    "token_minter",
    tokenMessengerMinterProgram.programId
  );
  const localToken = findProgramAddress(
    "local_token",
    tokenMessengerMinterProgram.programId,
    [solUsdcAddress]
  );
  const remoteTokenMessengerKey = findProgramAddress(
    "remote_token_messenger",
    tokenMessengerMinterProgram.programId,
    [remoteDomain.toString()]
  );
  const tokenPair = findProgramAddress(
    "token_pair",
    tokenMessengerMinterProgram.programId,
    [remoteDomain.toString(), remoteTokenBytes32]
  );

  const custodyTokenAccount = findProgramAddress(
    "custody",
    tokenMessengerMinterProgram.programId,
    [solUsdcAddress]
  );
  const authorityPda = findProgramAddress(
    "message_transmitter_authority",
    messageTransmitterProgram.programId,
    [tokenMessengerMinterProgram.programId]
  ).publicKey;
  const tokenMessengerEventAuthority = findProgramAddress(
    "__event_authority",
    tokenMessengerMinterProgram.programId
  );
  const messageTransmitterEventAuthority = findProgramAddress(
    "__event_authority",
    messageTransmitterProgram.programId
  );
  const usedNonce = findProgramAddress(
    "used_nonce",
    messageTransmitterProgram.programId,
    [nonce]
  ).publicKey;

  const tokenMessengerAccounts = await (
    tokenMessengerMinterProgram.account as any
  ).tokenMessenger.fetch(tokenMessengerAccount.publicKey);
  const feeRecipientTokenAccount = await getAssociatedTokenAddress(
    solUsdcAddress,
    tokenMessengerAccounts.feeRecipient
  );

  return {
    messageTransmitterAccount,
    tokenMessengerAccount,
    tokenMinterAccount,
    localToken,
    remoteTokenMessengerKey,
    tokenPair,
    custodyTokenAccount,
    authorityPda,
    tokenMessengerEventAuthority,
    messageTransmitterEventAuthority,
    usedNonce,
    feeRecipientTokenAccount,
  };
};

export const hexToBytes = (hex: string): Buffer =>
  Buffer.from(hex.replace("0x", ""), "hex");

export const findProgramAddress = (
  label: string,
  programId: PublicKey,
  extraSeeds: (string | number[] | Buffer | PublicKey)[] | null = null
): FindProgramAddressResponse => {
  const seeds = [Buffer.from(anchor.utils.bytes.utf8.encode(label))];
  if (extraSeeds) {
    for (const extraSeed of extraSeeds) {
      if (typeof extraSeed === "string") {
        seeds.push(Buffer.from(anchor.utils.bytes.utf8.encode(extraSeed)));
      } else if (Array.isArray(extraSeed)) {
        seeds.push(Buffer.from(extraSeed as number[]));
      } else if (Buffer.isBuffer(extraSeed)) {
        seeds.push(Buffer.from(extraSeed));
      } else if (typeof (extraSeed as any).toBuffer === 'function') {
        seeds.push(Buffer.from((extraSeed as any).toBuffer()));
      } else {
        seeds.push(Buffer.from(new PublicKey(extraSeed).toBuffer()));
      }
    }
  }
  const pid = typeof (programId as any).toBuffer === 'function' ? programId : new PublicKey(programId);
  const res = PublicKey.findProgramAddressSync(seeds, pid);
  return { publicKey: res[0], bump: res[1] };
};

// CCTP v2 message header: version(4) + sourceDomain(4) + destinationDomain(4) + nonce(32) + ...
// (v1 used an 8-byte uint64 nonce at this offset; v2 widened it to bytes32).
export const decodeNonceFromMessage = (messageHex: string): Buffer => {
  const nonceIndex = 12;
  const nonceBytesLength = 32;
  const message = hexToBytes(messageHex);
  const eventNonceBytes = message.subarray(
    nonceIndex,
    nonceIndex + nonceBytesLength
  );
  return eventNonceBytes;
};

// The generic message envelope's `recipient` field (offset 76) is the
// destination PROGRAM (e.g. TokenMessengerMinter), not the end user.
// The end-user mint recipient lives inside the BurnMessage body, which
// starts at offset 148: bodyVersion(4) + burnToken(32) + mintRecipient(32).
export const decodeMintRecipientFromMessage = (messageHex: string): PublicKey => {
  const mintRecipientIndex = 148 + 4 + 32;
  const mintRecipientBytesLength = 32;
  const message = hexToBytes(messageHex);
  const mintRecipientBytes = message.subarray(
    mintRecipientIndex,
    mintRecipientIndex + mintRecipientBytesLength
  );
  return new PublicKey(mintRecipientBytes);
};
