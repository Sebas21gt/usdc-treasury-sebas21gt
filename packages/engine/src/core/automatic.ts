// Server-only: pulls in core/history (fs/path), so - like history.ts - this
// is deliberately NOT re-exported from the main index.ts barrel that client
// components import. Import it directly by path from a Node-only context
// (see scripts/automatic-mode.ts).
import { SupportedChain, TREASURY_CONFIG, AUTOMATIC_MODE_CONFIG } from '../config';
import { checkInventory, MonitorAddresses, TreasuryStatus } from './monitor';
import { transferUsdc } from './transferUsdc';
import { recordMovement, getHistory } from './history';

export interface RebalancePlan {
  fromChain: SupportedChain;
  toChain: SupportedChain;
  amount: number;
}

// Picks the worst deficit (furthest below its min) as the destination, and
// the largest available surplus (furthest above its own target, without
// dropping the donor below its own min) as the source. Caps the amount at
// what the destination actually needs, what the source can safely give, and
// the configured max-per-move. Returns null when nothing needs rebalancing.
export function computeRebalancePlan(status: TreasuryStatus): RebalancePlan | null {
  const chains = Object.values(status.chains);

  const deficient = chains
    .filter((c) => c.status === 'below_min')
    .sort((a, b) => (b.min - b.balance) - (a.min - a.balance));
  if (deficient.length === 0) return null;
  const destination = deficient[0];

  const surplusCandidates = chains
    .filter((c) => c.chain !== destination.chain && c.balance > c.target)
    .sort((a, b) => (b.balance - b.target) - (a.balance - a.target));
  if (surplusCandidates.length === 0) return null;
  const source = surplusCandidates[0];

  const amountNeeded = destination.target - destination.balance;
  const surplusAvailable = source.balance - source.min;
  const amount = Math.min(amountNeeded, surplusAvailable, AUTOMATIC_MODE_CONFIG.maxAmountPerMove);
  if (amount <= 0) return null;

  return { fromChain: source.chain, toChain: destination.chain, amount: Math.round(amount * 100) / 100 };
}

function cooldownRemainingMs(): number {
  const lastAutomatic = getHistory().find((m) => m.mode === 'automatic');
  if (!lastAutomatic) return 0;
  const elapsed = Date.now() - new Date(lastAutomatic.timestamp).getTime();
  return Math.max(0, AUTOMATIC_MODE_CONFIG.cooldownMs - elapsed);
}

export interface AutomaticModeDeps {
  polygonAddress: string;
  solanaAddress: string;
  stellarAddress: string;
  onLog?: (message: string) => void;
}

function destinationAddressFor(deps: AutomaticModeDeps, chain: SupportedChain): string {
  if (chain === 'polygon') return deps.polygonAddress;
  if (chain === 'solana') return deps.solanaAddress;
  return deps.stellarAddress;
}

function monitorAddresses(deps: AutomaticModeDeps): MonitorAddresses {
  return {
    polygonAddress: deps.polygonAddress,
    solanaAddress: deps.solanaAddress,
    stellarAddress: deps.stellarAddress,
  };
}

// One check-and-maybe-rebalance pass. Safe to call repeatedly - it's a no-op
// whenever nothing is below its min, the only viable move touches Stellar
// (no headless Pollar signer available), or the cooldown hasn't elapsed.
export async function runAutomaticCycle(deps: AutomaticModeDeps): Promise<void> {
  const log = deps.onLog ?? console.log;
  const status = await checkInventory(monitorAddresses(deps));
  const plan = computeRebalancePlan(status);

  if (!plan) {
    log('No rebalance needed - all networks within range.');
    return;
  }

  if (plan.fromChain === 'stellar' || plan.toChain === 'stellar') {
    log(
      `Rebalance needed (${plan.fromChain} -> ${plan.toChain}, ${plan.amount} USDC) but it touches Stellar. ` +
        `Automatic mode has no headless Pollar session to sign with - do this one manually from the dashboard.`
    );
    return;
  }

  const remaining = cooldownRemainingMs();
  if (remaining > 0) {
    log(`Rebalance needed (${plan.fromChain} -> ${plan.toChain}, ${plan.amount} USDC) but still in cooldown (${Math.ceil(remaining / 1000)}s left). Skipping.`);
    return;
  }

  log(`Rebalancing: ${plan.fromChain} -> ${plan.toChain}, ${plan.amount} USDC...`);
  const result = await transferUsdc({
    fromChain: plan.fromChain,
    toChain: plan.toChain,
    amount: plan.amount,
    destinationAddress: destinationAddressFor(deps, plan.toChain),
  });
  recordMovement({
    fromChain: plan.fromChain,
    toChain: plan.toChain,
    amount: plan.amount,
    burnHash: result.burnHash,
    mintHash: result.mintHash,
    mode: 'automatic',
  });
  log(`Rebalance complete. Burn: ${result.burnHash}  Mint: ${result.mintHash}`);
}

export interface AutomaticModeHandle {
  stop: () => void;
}

export function startAutomaticMode(deps: AutomaticModeDeps & { intervalMs?: number }): AutomaticModeHandle {
  const intervalMs = deps.intervalMs ?? AUTOMATIC_MODE_CONFIG.checkIntervalMs;
  const log = deps.onLog ?? console.log;
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runAutomaticCycle(deps);
    } catch (error) {
      log(`Automatic cycle failed: ${error}`);
    } finally {
      running = false;
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
