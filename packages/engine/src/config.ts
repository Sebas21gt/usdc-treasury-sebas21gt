export const CCTP_CONTRACTS = {
  polygon: {
    tokenMessenger:    '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter:'0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    usdc:              '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', // USDC on Amoy
  },
  solana: {
    tokenMessenger:    'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
    messageTransmitter:'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
    usdc:              '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC mint on devnet
  }
} as const;

export const IRIS_API_URL = process.env.CCTP_ATTESTATION_URL ?? 'https://iris-api-sandbox.circle.com';
