export const CCTP_CONTRACTS = {
  polygon: {
    domain: 7,
    tokenMessenger:    '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter:'0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    usdc:              '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', // USDC on Amoy
  },
  solana: {
    domain: 5,
    messageTransmitter: 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
    tokenMessenger: 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
    usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  },
  stellar: {
    domain: 27,
    messageTransmitter: 'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
    tokenMessengerMinter: 'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
    cctpForwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
    usdc: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  }
} as const;

export const IRIS_API_URL = process.env.CCTP_ATTESTATION_URL ?? 'https://iris-api-sandbox.circle.com';
