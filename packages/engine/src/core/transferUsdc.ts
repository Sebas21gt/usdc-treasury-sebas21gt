import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { CCTP_CONTRACTS, SupportedChain } from '../config';
import { waitForAttestation } from './transfer';
import { burnOnPolygon, mintOnPolygon } from '../chains/polygon';
import { burnOnSolana, mintOnSolana } from '../chains/solana';
import {
  buildFullStellarApproveTx,
  buildFullStellarBurnTx,
  buildFullStellarMintTx,
  buildCctpForwarderHookData,
  contractStrkeyToBytes32,
} from '../chains/stellar';

export interface StellarSignResult {
  status: 'success' | 'error';
  hash?: string;
  details?: string;
}

// Wraps whatever can actually produce a Pollar signature for a Stellar XDR
// (in this codebase, that's @pollar/react's signAndSubmitTx in the browser).
export type StellarXdrSigner = (unsignedXdr: string) => Promise<StellarSignResult>;

const POLYGON_USDC_DECIMALS = 6;
const SOLANA_USDC_DECIMALS = 6;
const STELLAR_USDC_DECIMALS = 7;

function evmAddressToBytes32(address: string): string {
  return '0x' + address.replace('0x', '').padStart(64, '0');
}

async function solanaOwnerToAtaBytes32(ownerAddress: string): Promise<string> {
  const owner = new PublicKey(ownerAddress);
  const usdcMint = new PublicKey(CCTP_CONTRACTS.solana.usdc);
  const ata = await getAssociatedTokenAddress(usdcMint, owner);
  return '0x' + Buffer.from(ata.toBytes()).toString('hex');
}

function requireStellarSigner(signStellarXdr?: StellarXdrSigner): StellarXdrSigner {
  if (!signStellarXdr) {
    throw new Error('signStellarXdr is required whenever Stellar is the source or destination');
  }
  return signStellarXdr;
}

async function submitStellarXdr(signStellarXdr: StellarXdrSigner, xdr: string, step: string): Promise<string> {
  const result = await signStellarXdr(xdr);
  if (result.status === 'error' || !result.hash) {
    throw new Error(result.details || `Stellar ${step} failed`);
  }
  return result.hash;
}

export interface BurnParams {
  fromChain: SupportedChain;
  toChain: SupportedChain;
  amount: number; // human-readable USDC
  destinationAddress: string; // treasury's own wallet address on toChain
  stellarWalletAddress?: string; // required when fromChain === 'stellar' (the Pollar G-address)
  signStellarXdr?: StellarXdrSigner; // required when fromChain === 'stellar'
  polygonPrivateKeyHex?: string;
  polygonRpcUrl?: string;
  solanaPrivateKeyBase58?: string;
  solanaRpcUrl?: string;
}

// Dispatches the burn leg for whichever chain is the source. Throws for
// Solana -> Stellar: burnOnSolana doesn't support hookData/destinationCaller
// yet, so the CctpForwarder pattern isn't reachable from Solana today.
export async function executeBurn(params: BurnParams): Promise<{ hash: string }> {
  const { fromChain, toChain, amount } = params;
  const destinationDomain = CCTP_CONTRACTS[toChain].domain;

  if (fromChain === 'polygon') {
    const amountSubunits = BigInt(Math.round(amount * 10 ** POLYGON_USDC_DECIMALS));
    let mintRecipientBytes32: string;
    let destinationCallerBytes32: string | undefined;
    let hookData: string | undefined;

    if (toChain === 'stellar') {
      mintRecipientBytes32 = contractStrkeyToBytes32(CCTP_CONTRACTS.stellar.cctpForwarder);
      destinationCallerBytes32 = mintRecipientBytes32;
      hookData = buildCctpForwarderHookData(params.destinationAddress);
    } else if (toChain === 'solana') {
      mintRecipientBytes32 = await solanaOwnerToAtaBytes32(params.destinationAddress);
    } else {
      throw new Error(`Unsupported destination "${toChain}" from Polygon`);
    }

    const burn = await burnOnPolygon({
      amountSubunits,
      destinationDomain,
      mintRecipientBytes32,
      destinationCallerBytes32,
      hookData,
      privateKeyHex: params.polygonPrivateKeyHex ?? requireEnv('POLYGON_PRIVATE_KEY'),
      rpcUrl: params.polygonRpcUrl ?? process.env.POLYGON_RPC_URL,
    });
    return { hash: burn.hash };
  }

  if (fromChain === 'solana') {
    if (toChain === 'stellar') {
      throw new Error('Solana -> Stellar is not supported yet: burnOnSolana has no hookData/destinationCaller support for the CctpForwarder pattern');
    }
    const amountSubunits = BigInt(Math.round(amount * 10 ** SOLANA_USDC_DECIMALS));
    const mintRecipientBytes32 = evmAddressToBytes32(params.destinationAddress);

    const burn = await burnOnSolana({
      amountSubunits,
      destinationDomain,
      mintRecipientBytes32,
      privateKeyBase58: params.solanaPrivateKeyBase58 ?? requireEnv('SOLANA_PRIVATE_KEY'),
      rpcUrl: params.solanaRpcUrl,
    });
    return { hash: burn.hash };
  }

  if (fromChain === 'stellar') {
    if (!params.stellarWalletAddress) {
      throw new Error('stellarWalletAddress is required when burning from Stellar');
    }
    const signStellarXdr = requireStellarSigner(params.signStellarXdr);
    const amountSubunits = BigInt(Math.round(amount * 10 ** STELLAR_USDC_DECIMALS));

    const mintRecipientBytes32 =
      toChain === 'polygon'
        ? evmAddressToBytes32(params.destinationAddress)
        : await solanaOwnerToAtaBytes32(params.destinationAddress);

    const approveXdr = await buildFullStellarApproveTx({
      amountSubunits,
      burnTokenStrkey: CCTP_CONTRACTS.stellar.usdc,
      sourceAccountPubkey: params.stellarWalletAddress,
    });
    await submitStellarXdr(signStellarXdr, approveXdr, 'approve');

    const burnXdr = await buildFullStellarBurnTx({
      amountSubunits,
      destinationDomain,
      mintRecipientBytes32,
      burnTokenStrkey: CCTP_CONTRACTS.stellar.usdc,
      sourceAccountPubkey: params.stellarWalletAddress,
    });
    const hash = await submitStellarXdr(signStellarXdr, burnXdr, 'burn');
    return { hash };
  }

  throw new Error(`Unsupported source chain "${fromChain}"`);
}

export interface MintParams {
  toChain: SupportedChain;
  messageHex: string;
  attestationHex: string;
  stellarWalletAddress?: string; // required when toChain === 'stellar' (pays for + submits the mint tx)
  signStellarXdr?: StellarXdrSigner; // required when toChain === 'stellar'
  polygonPrivateKeyHex?: string;
  polygonRpcUrl?: string;
  solanaPrivateKeyBase58?: string;
  solanaRpcUrl?: string;
}

// Dispatches the mint leg for whichever chain is the destination.
export async function executeMint(params: MintParams): Promise<{ hash: string }> {
  const { toChain, messageHex, attestationHex } = params;

  if (toChain === 'polygon') {
    const mint = await mintOnPolygon({
      messageHex,
      attestationHex,
      privateKeyHex: params.polygonPrivateKeyHex ?? requireEnv('POLYGON_PRIVATE_KEY'),
      rpcUrl: params.polygonRpcUrl ?? process.env.POLYGON_RPC_URL,
    });
    return { hash: mint.hash };
  }

  if (toChain === 'solana') {
    const mint = await mintOnSolana({
      messageHex,
      attestationHex,
      privateKeyBase58: params.solanaPrivateKeyBase58 ?? requireEnv('SOLANA_PRIVATE_KEY'),
      rpcUrl: params.solanaRpcUrl,
    });
    return { hash: mint.hash };
  }

  if (toChain === 'stellar') {
    if (!params.stellarWalletAddress) {
      throw new Error('stellarWalletAddress is required when minting into Stellar');
    }
    const signStellarXdr = requireStellarSigner(params.signStellarXdr);
    const mintXdr = await buildFullStellarMintTx({
      messageHex,
      attestationHex,
      sourceAccountPubkey: params.stellarWalletAddress,
    });
    const hash = await submitStellarXdr(signStellarXdr, mintXdr, 'mint');
    return { hash };
  }

  throw new Error(`Unsupported destination chain "${toChain}"`);
}

export interface TransferUsdcParams extends Omit<BurnParams, 'toChain'> {
  toChain: SupportedChain;
}

export interface TransferUsdcResult {
  fromChain: SupportedChain;
  toChain: SupportedChain;
  amount: number;
  burnHash: string;
  mintHash: string;
}

// Full burn -> wait for attestation -> mint flow, reused by manual mode
// (the API route) and, later, by automatic mode. Requires a signStellarXdr
// callback whenever Stellar is on either side - there is no way to run a
// Stellar leg from a headless server process, since the treasury's Stellar
// wallet is custodial through Pollar and only signs via signAndSubmitTx.
export async function transferUsdc(params: TransferUsdcParams): Promise<TransferUsdcResult> {
  const { fromChain, toChain, amount } = params;
  if (fromChain === toChain) {
    throw new Error('fromChain and toChain must be different');
  }

  const sourceDomain = CCTP_CONTRACTS[fromChain].domain;

  const { hash: burnHash } = await executeBurn(params);
  const { message, attestation } = await waitForAttestation(sourceDomain, burnHash);
  const { hash: mintHash } = await executeMint({
    toChain,
    messageHex: message,
    attestationHex: attestation,
    stellarWalletAddress: params.stellarWalletAddress,
    signStellarXdr: params.signStellarXdr,
    polygonPrivateKeyHex: params.polygonPrivateKeyHex,
    polygonRpcUrl: params.polygonRpcUrl,
    solanaPrivateKeyBase58: params.solanaPrivateKeyBase58,
    solanaRpcUrl: params.solanaRpcUrl,
  });

  return { fromChain, toChain, amount, burnHash, mintHash };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
