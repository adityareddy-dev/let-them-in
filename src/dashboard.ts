// The dashboard. A small web server that reads the same files a round writes as it goes
// (steps.jsonl, outcome.json, fix-status.json, the spend log) and pushes a note to the page
// whenever one of them changes. No model calls.
// Usage: tsx src/dashboard.ts [--dir runs] [--port 8077]

import { createServer, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSpend, SPEND_FILE } from './ai.js';
import { loadSteps, RUNS } from './round.js';
import { SHOPPERS } from './shoppers.js';
import type { Outcome } from './walk.js';

const ROOT = resolve('.');
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(flag('port') ?? process.env.LTI_DASHBOARD_PORT ?? 8077);
const DEFAULT_DIR = flag('dir') ?? RUNS;

const NEEDS: Record<string, { need: string; perceives: string }> = {
  mouse: { need: 'No access needs', perceives: 'Sees the screen, uses a mouse' },
  keyboard: { need: 'Keyboard only', perceives: 'Sees the screen, has to find the focus outline' },
  screenreader: { need: 'Blind, screen reader', perceives: 'Only hears what the screen reader reads out' },
  zoom: { need: 'Low vision, 200% zoom', perceives: 'Sees a quarter of the page at a time' },
  slowphone: { need: 'Cheap phone, slow network', perceives: '500 kbit/s, 400 ms latency, CPU slowed 4x' },
};

const ROUND_DIR = /^\d{8}-\d{4}-[\w-]+$/;

function json<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

// Only folders inside the repo's runs folder can be read.
export function safeDir(dir: string): string {
  const abs = resolve(ROOT, dir);
  const runs = resolve(ROOT, RUNS);
  if (abs !== runs && !abs.startsWith(runs + sep)) throw new Error('only folders under runs/ can be shown');
  return abs;
}

function roundDirs(abs: string): string[] {
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((d) => ROUND_DIR.test(d) && statSync(join(abs, d)).isDirectory())
    .filter((d) => existsSync(join(abs, d, 'round.json')) || existsSync(join(abs, d, 'start.json')) || existsSync(join(abs, d, 'scan.json')))
    .sort();
}

function fileUrl(abs: string): string {
  return '/files/' + relative(ROOT, abs).split(sep).map(encodeURIComponent).join('/');
}

function roundState(abs: string, id: string) {
  const dir = join(abs, id);
  const rec = json<{ label: string; startedAt: string; finishedAt: string; shopperModel?: string; outcomes: Outcome[]; bought: number }>(
    join(dir, 'round.json'),
  );
  const start = json<{ label: string; startedAt: string; shopperModel?: string; shoppers: string[] }>(join(dir, 'start.json'));
  const scan = json<{
    at: string;
    findings: { page: string; id: string; impact: string; help: string; nodes: unknown[] }[];
    addToCartTabStop: number | null;
    addToCartShowsFocus: boolean | null;
    focusAfterOpeningCard?: { afterEnter: string; afterTab: string };
  }>(join(dir, 'scan.json'));
  const fix = json<{ summary: string; edits: { file: string; why: string; helps: string[] }[]; built: boolean; buildSeconds: number; attempts: number; model: string }>(
    join(dir, 'fix.json'),
  );
  const fixStatus = json<{ state: string; attempt: number; at: string }>(join(dir, 'fix-status.json'));
  const notes = json<Record<string, string>>(join(dir, 'notes.json')) ?? {};
  const ids = rec?.outcomes.map((o) => o.shopper) ?? start?.shoppers ?? SHOPPERS.map((s) => s.id).filter((s) => existsSync(join(dir, s)));
  const shoppers = ids.map((sid) => {
    const outcome = json<Outcome>(join(dir, sid, 'outcome.json'));
    const steps = loadSteps(dir, sid).map((s) => ({
      step: s.step,
      at: s.at,
      url: s.url,
      title: s.title,
      thought: s.thought,
      say: s.say,
      action: s.action,
      targetLabel: s.targetLabel,
      text: s.text,
      times: s.times,
      result: s.result,
      shot: s.screenshot ? fileUrl(join(dir, sid, s.screenshot)) : null,
    }));
    const final = existsSync(join(dir, sid, 'final.jpg')) ? fileUrl(join(dir, sid, 'final.jpg')) : null;
    return { id: sid, outcome, steps, final, note: notes[sid] ?? null };
  });
  const spend = readSpend()
    .filter((l) => l.round === id)
    .map((l) => ({ at: l.at, usd: l.usd, purpose: l.purpose, shopper: l.shopper ?? null }));
  const firstStep = shoppers.flatMap((s) => s.steps.map((x) => x.at)).sort()[0];
  return {
    id,
    label: rec?.label ?? start?.label ?? id.slice(14),
    startedAt: rec?.startedAt ?? start?.startedAt ?? scan?.at ?? firstStep ?? null,
    finishedAt: rec?.finishedAt ?? null,
    shopperModel: rec?.shopperModel ?? start?.shopperModel ?? null,
    bought: rec?.bought ?? null,
    scan: scan
      ? {
          at: scan.at,
          failedRules: scan.findings.length,
          rules: [...new Set(scan.findings.map((f) => f.id))],
          addToCartShowsFocus: scan.addToCartShowsFocus,
          focusAfterOpeningCard: scan.focusAfterOpeningCard ?? null,
        }
      : null,
    shoppers,
    fix: fix
      ? {
          ...fix,
          diff: existsSync(join(dir, 'fix.diff')) ? readFileSync(join(dir, 'fix.diff'), 'utf8') : '',
        }
      : null,
    fixStatus,
    spend,
  };
}

export function seriesState(dir: string) {
  const abs = safeDir(dir);
  const readme = join(abs, 'README.md');
  return {
    dir: relative(ROOT, abs) || '.',
    at: new Date().toISOString(),
    shoppers: SHOPPERS.map((s) => ({ id: s.id, name: s.name, mode: s.mode, maxSteps: s.maxSteps, ...NEEDS[s.mode] })),
    rounds: roundDirs(abs).map((id) => roundState(abs, id)),
    hasReadme: existsSync(readme),
  };
}

// Folders with recorded rounds, for the picker.
function seriesList() {
  const out: { dir: string; rounds: number }[] = [];
  const visit = (abs: string, depth: number) => {
    const n = roundDirs(abs).length;
    if (n) out.push({ dir: relative(ROOT, abs), rounds: n });
    if (depth > 1 || !existsSync(abs)) return;
    for (const d of readdirSync(abs)) {
      const sub = join(abs, d);
      if (!ROUND_DIR.test(d) && statSync(sub).isDirectory()) visit(sub, depth + 1);
    }
  };
  visit(resolve(ROOT, RUNS), 0);
  return out;
}

// A cheap fingerprint of everything a round writes. When it changes the page is told to fetch again.
function fingerprint(dir: string): string {
  let abs: string;
  try {
    abs = safeDir(dir);
  } catch {
    return '';
  }
  const parts: string[] = [];
  const add = (f: string) => {
    try {
      const st = statSync(f);
      parts.push(`${f}:${st.size}:${st.mtimeMs}`);
    } catch {
      /* not there yet */
    }
  };
  add(SPEND_FILE);
  for (const id of roundDirs(abs)) {
    const d = join(abs, id);
    for (const f of ['round.json', 'start.json', 'scan.json', 'fix.json', 'fix-status.json', 'notes.json']) add(join(d, f));
    for (const s of SHOPPERS) {
      add(join(d, s.id, 'steps.jsonl'));
      add(join(d, s.id, 'outcome.json'));
    }
  }
  return parts.join('|');
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.diff': 'text/plain; charset=utf-8',
};

function sendFile(res: ServerResponse, abs: string, cache = false) {
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(abs)] ?? 'application/octet-stream',
    'cache-control': cache ? 'max-age=3600' : 'no-cache',
  });
  res.end(readFileSync(abs));
}

const UI = resolve(ROOT, 'dashboard');
const FONTS: Record<string, string> = {
  'atkinson-400.woff2': 'node_modules/@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2',
  'atkinson-400i.woff2': 'node_modules/@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-italic.woff2',
  'atkinson-700.woff2': 'node_modules/@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff2',
  'bricolage.woff2': 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
  'mono-400.woff2': 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  try {
    if (path === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      res.end(JSON.stringify(seriesState(url.searchParams.get('dir') ?? DEFAULT_DIR)));
      return;
    }
    if (path === '/api/series') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ default: DEFAULT_DIR, series: seriesList() }));
      return;
    }
    if (path === '/api/events') {
      // Server-sent events: a "changed" message whenever a round writes something.
      const dir = url.searchParams.get('dir') ?? DEFAULT_DIR;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      let last = fingerprint(dir);
      res.write(`event: hello\ndata: {}\n\n`);
      const timer = setInterval(() => {
        const now = fingerprint(dir);
        if (now !== last) {
          last = now;
          res.write(`event: changed\ndata: {}\n\n`);
        } else res.write(': still here\n\n');
      }, 700);
      req.on('close', () => clearInterval(timer));
      return;
    }
    if (path.startsWith('/files/')) {
      const abs = resolve(ROOT, path.slice('/files/'.length));
      safeDir(abs);
      sendFile(res, abs, true);
      return;
    }
    if (path.startsWith('/fonts/')) {
      const f = FONTS[path.slice('/fonts/'.length)];
      if (!f) {
        res.writeHead(404).end('not found');
        return;
      }
      sendFile(res, resolve(ROOT, f), true);
      return;
    }
    const abs = resolve(UI, '.' + (path === '/' ? '/index.html' : path));
    if (!abs.startsWith(UI + sep)) {
      res.writeHead(404).end('not found');
      return;
    }
    sendFile(res, abs);
  } catch (e) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end(e instanceof Error ? e.message : String(e));
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`dashboard on http://127.0.0.1:${PORT}/ showing ${DEFAULT_DIR}, live`);
    for (const s of seriesList()) console.log(`  replay: http://127.0.0.1:${PORT}/?dir=${encodeURIComponent(s.dir)}&replay=1`);
  });
}
