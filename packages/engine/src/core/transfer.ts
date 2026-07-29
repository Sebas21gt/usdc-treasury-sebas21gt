import { IRIS_API_URL, SupportedChain, CCTP_CONTRACTS } from '../config';
import bs58 from 'bs58';

/**
 * Polls the Circle Iris API for an attestation.
 * @param sourceDomain The CCTP domain ID of the source chain.
 * @param txHash The transaction hash of the burn on the source chain.
 * @returns The messageHex and attestationHex
 */
export async function waitForAttestation(sourceDomain: number, txHash: string): Promise<{ message: string; attestation: string }> {
  const url = `${IRIS_API_URL}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
  
  while (true) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json() as { messages?: { status: string; message: string; attestation: string }[] };
      const complete = data.messages?.find((m) => m.status === "complete");
      if (complete) {
        return {
          message: complete.message,
          attestation: complete.attestation
        };
      }
    }
    // Wait 5 seconds before polling again
    await new Promise(r => setTimeout(r, 5000));
  }
}

/**
 * Normalizes an address to a bytes32 string (without 0x prefix for Stellar, or with 0x for EVM depending on usage).
 * Circle CCTP uses left-padded 32-byte strings for addresses.
 */
export function addressToBytes32(address: string): string {
  // If it's a hex string (EVM), strip 0x and pad
  if (address.startsWith('0x')) {
    return address.replace('0x', '').padStart(64, '0');
  }
  // If it's a base58 string (Solana), decoding it to hex is required, 
  // but usually Solana CCTP handles this in its SDK. 
  // For Stellar Strkey, it uses a 32-byte public key.
  // We'll throw for non-EVM here to force specific implementations for those chains.
  throw new Error(`Unsupported address format for simple padding: ${address}`);
}
