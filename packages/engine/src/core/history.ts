import fs from 'fs';
import path from 'path';
import { SupportedChain } from '../config';

export type TransferMode = 'manual' | 'automatic';

export interface MovementRecord {
  id: string;
  timestamp: string; // ISO 8601
  fromChain: SupportedChain;
  toChain: SupportedChain;
  amount: number;
  burnHash: string;
  mintHash: string;
  mode: TransferMode;
}

// __dirname can't be trusted here: Next.js's bundler (Turbopack/webpack)
// rewrites it to a virtual path for server code, not the real filesystem
// location. process.cwd() is a genuine syscall instead, so we walk up from
// wherever the process actually started until we find the monorepo root
// (marked by turbo.json) - this works whether that's the repo root (scripts,
// run via `npm run` from there) or apps/web (Next, which turbo cd's into).
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'turbo.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not locate the monorepo root (no turbo.json found above ' + startDir + ')');
    dir = parent;
  }
}

const HISTORY_FILE = path.join(findRepoRoot(process.cwd()), 'data', 'history.json');

function readAll(): MovementRecord[] {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(raw) as MovementRecord[];
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeAll(records: MovementRecord[]): void {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2));
}

export function recordMovement(input: Omit<MovementRecord, 'id' | 'timestamp'>): MovementRecord {
  const record: MovementRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...input,
  };
  const records = readAll();
  records.push(record);
  writeAll(records);
  return record;
}

// Newest first.
export function getHistory(): MovementRecord[] {
  return readAll().slice().reverse();
}

// Most recent movement touching a given chain (either side) - the piece
// automatic mode's cooldown will need.
export function getLastMovementForChain(chain: SupportedChain): MovementRecord | undefined {
  return getHistory().find((r) => r.fromChain === chain || r.toChain === chain);
}
