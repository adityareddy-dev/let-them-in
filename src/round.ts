// A round: the free scan, then every shopper visits the shop at the same time.

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSpend, SHOPPER_MODEL } from './ai.js';
import { scan, type ScanResult } from './scan.js';
import { SHOPPERS, type Shopper } from './shoppers.js';
import { walk, type Outcome, type StepRecord } from './walk.js';

export const RUNS = process.env.LTI_RUNS ?? 'runs';

export interface RoundRecord {
  id: string;
  label: string;
  shopUrl: string;
  shop: string;
  shopperModel?: string;
  startedAt: string;
  finishedAt: string;
  outcomes: Outcome[];
  bought: number;
  spendUsd: number;
}

export function roundId(label: string, now = new Date()): string {
  const t = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `${t}-${label}`;
}

export async function runRound(label: string, shopUrl: string, shoppers: Shopper[] = SHOPPERS): Promise<RoundRecord> {
  const id = roundId(label);
  const dir = join(RUNS, id);
  mkdirSync(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  // start.json tells the dashboard who is in this round before anyone has taken a step
  const start = { id, label, shopUrl, shopperModel: SHOPPER_MODEL, shoppers: shoppers.map((s) => s.id), startedAt };
  writeFileSync(join(dir, 'start.json'), JSON.stringify(start, null, 2) + '\n');
  console.log(`round ${id}: scanning ${shopUrl}`);
  await scan(shopUrl, dir);
  console.log(`round ${id}: ${shoppers.length} shoppers start`);
  const outcomes = await Promise.all(
    shoppers.map(async (s) => {
      const o = await walk(s, { shopUrl, round: id, outDir: dir });
      console.log(`  ${s.name} (${s.mode}): ${o.outcome} after ${o.steps} steps. ${o.reason}`);
      return o;
    }),
  );
  const spendUsd = readSpend()
    .filter((l) => l.round === id)
    .reduce((a, l) => a + l.usd, 0);
  const rec: RoundRecord = {
    id,
    label,
    shopUrl,
    shop: process.env.LTI_SHOP_NAME ?? 'OpenTelemetry Demo 3.1.0 (Astronomy Shop)',
    shopperModel: SHOPPER_MODEL,
    startedAt,
    finishedAt: new Date().toISOString(),
    outcomes,
    bought: outcomes.filter((o) => o.outcome === 'bought').length,
    spendUsd: Number(spendUsd.toFixed(4)),
  };
  writeFileSync(join(dir, 'round.json'), JSON.stringify(rec, null, 2) + '\n');
  console.log(`round ${id}: ${rec.bought} of ${outcomes.length} bought, ${rec.spendUsd.toFixed(2)} USD`);
  return rec;
}

export function loadRound(dir: string): RoundRecord {
  return JSON.parse(readFileSync(join(dir, 'round.json'), 'utf8')) as RoundRecord;
}

export function loadScan(dir: string): ScanResult | null {
  const f = join(dir, 'scan.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as ScanResult) : null;
}

export function loadSteps(dir: string, shopper: string): StepRecord[] {
  const f = join(dir, shopper, 'steps.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as StepRecord);
}

export function latestRound(label: string): string | null {
  if (!existsSync(RUNS)) return null;
  const ids = readdirSync(RUNS)
    .filter((d) => d.endsWith(`-${label}`) && existsSync(join(RUNS, d, 'round.json')))
    .sort();
  return ids.length ? join(RUNS, ids[ids.length - 1]) : null;
}
