import type { CctpAttestation } from '@usdc-treasury/shared';
import { IRIS_API_URL } from '../config';

export async function pollAttestation(params: {
  sourceDomain: number;
  burnTxHash: string;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<CctpAttestation> {
  const { sourceDomain, burnTxHash, maxAttempts = 60, intervalMs = 10_000 } = params;
  const url = `${IRIS_API_URL}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;

  console.log(`Polling Circle Iris API for domain=${sourceDomain} tx=${burnTxHash}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json() as any;
        if (json.messages && json.messages.length > 0) {
          const msg = json.messages[0];
          if (msg.status === 'complete' && msg.attestation && msg.message) {
            console.log(`Attestation ready after ${attempt} attempt(s)`);
            return { message: msg.message, attestation: msg.attestation };
          }
        }
      }
    } catch (err) {
      console.warn(`Attempt ${attempt}/${maxAttempts} — fetch error:`, err);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Attestation not received after ${maxAttempts} attempts`);
}
