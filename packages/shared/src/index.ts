export type Chain = 'polygon' | 'solana' | 'stellar';

export interface CctpAttestation {
  message: string;
  attestation: string;
}

export interface BurnResult {
  txHash: string;
  messageHash: string;
  sourceDomain: number;
}

export interface MintResult {
  txHash: string;
}
