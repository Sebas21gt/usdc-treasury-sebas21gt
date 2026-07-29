// Shared helpers for API routes: input validation and safe error responses.
// Keeps internal error details (RPC bodies, stack traces, node paths) out of
// what gets sent back to the client, while still logging the full error
// server-side for debugging.

export function parseAmount(value: unknown): number {
  const amount = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: "${value}" (must be a positive number)`);
  }
  return amount;
}

export function safeErrorMessage(e: any): string {
  // viem errors carry a short, already-sanitized summary separate from the
  // full .message (which can include RPC URLs, request bodies, etc).
  if (typeof e?.shortMessage === 'string') return e.shortMessage;
  // Our own thrown `new Error('...')` calls are safe - we wrote that text.
  if (e instanceof Error && e.message) return e.message;
  return 'Internal Server Error';
}
