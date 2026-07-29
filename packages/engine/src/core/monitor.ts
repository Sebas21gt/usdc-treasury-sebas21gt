import { TREASURY_CONFIG, SupportedChain } from '../config';
import { getTreasuryBalances } from './inventory';

export type RangeStatus = 'below_min' | 'within_range' | 'above_max';

export interface ChainInventoryStatus {
  chain: SupportedChain;
  balance: number;
  min: number;
  target: number;
  max: number;
  status: RangeStatus;
}

export interface TreasuryStatus {
  timestamp: string;
  chains: Record<SupportedChain, ChainInventoryStatus>;
}

export interface MonitorAddresses {
  polygonAddress?: string;
  solanaAddress?: string;
  stellarAddress?: string;
}

function rangeStatus(balance: number, min: number, max: number): RangeStatus {
  if (balance < min) return 'below_min';
  if (balance > max) return 'above_max';
  return 'within_range';
}

// Reads the three networks' balances once and evaluates each against its
// configured min/target/max range. Pure read - decides nothing, executes
// nothing; automatic mode's rebalance logic consumes this.
export async function checkInventory(addresses: MonitorAddresses): Promise<TreasuryStatus> {
  const balances = await getTreasuryBalances(addresses);
  const chains = {} as Record<SupportedChain, ChainInventoryStatus>;

  (Object.keys(TREASURY_CONFIG) as SupportedChain[]).forEach((chain) => {
    const { min, target, max } = TREASURY_CONFIG[chain];
    const balance = balances[chain];
    chains[chain] = { chain, balance, min, target, max, status: rangeStatus(balance, min, max) };
  });

  return { timestamp: new Date().toISOString(), chains };
}

export interface InventoryMonitorOptions {
  addresses: MonitorAddresses;
  intervalMs?: number;
  onUpdate?: (status: TreasuryStatus) => void;
  onError?: (error: unknown) => void;
}

export interface InventoryMonitorHandle {
  stop: () => void;
}

// Periodic wrapper around checkInventory. Runs immediately, then every
// intervalMs, until stop() is called. Intended to run as its own long-lived
// engine process (see scripts/monitor.ts), separate from the Next.js app -
// the frontend's own balance polling is only for the dashboard's display.
export function startInventoryMonitor(options: InventoryMonitorOptions): InventoryMonitorHandle {
  const intervalMs = options.intervalMs ?? 30_000;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const status = await checkInventory(options.addresses);
      options.onUpdate?.(status);
    } catch (error) {
      if (options.onError) {
        options.onError(error);
      } else {
        console.error('[inventory-monitor] failed to read balances:', error);
      }
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
