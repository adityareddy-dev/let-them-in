// The fix. The AI reads what happened to the shoppers who were locked out, the scan findings and
// the shop's frontend source, and returns exact find and replace edits. The edits become a patch,
// the shop frontend is rebuilt from it, and a build that fails goes back to the AI once with its error.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { askJson, FIX_MODEL } from './ai.js';
import { loadRound, loadScan, loadSteps } from './round.js';

export const SHOP_SRC = process.env.LTI_SHOP_SRC ?? 'shop/src';
const FRONTEND = 'src/frontend';
const DIRS = ['components', 'pages', 'styles'];

export interface Edit {
  file: string;
  find: string;
  replace: string;
  why: string;
  helps: string[];
}

export interface FixPlan {
  summary: string;
  edits: Edit[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'edits'],
  properties: {
    summary: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'find', 'replace', 'why', 'helps'],
        properties: {
          file: { type: 'string', description: 'Path relative to the frontend folder, as given.' },
          find: { type: 'string', description: 'Exact text that appears once in the file.' },
          replace: { type: 'string' },
          why: { type: 'string', description: 'One plain sentence: which barrier this removes.' },
          helps: { type: 'array', items: { type: 'string' }, description: 'Shopper ids this should help.' },
        },
      },
    },
  },
};

const SYSTEM = [
  'You fix accessibility barriers in the frontend of a real online shop (Next.js, React, styled-components).',
  'You get records of shoppers with access needs who tried to buy something and could not, findings from an automated',
  'accessibility scan, and the frontend source files. Make the smallest change that removes the barriers that actually',
  'stopped these shoppers. Keep the shop looking the same for mouse users. Follow WCAG 2.1 AA.',
  'Return exact find and replace edits on the files given. Each find must appear exactly once in its file and must be',
  'copied character for character. The code must still type check and lint. Do not touch files that were not given.',
].join(' ');

export function applyEdits(root: string, edits: Edit[]): string[] {
  const problems: string[] = [];
  const next = new Map<string, string>();
  for (const e of edits) {
    const path = join(root, e.file);
    if (relative(root, path).startsWith('..')) {
      problems.push(`${e.file}: outside the frontend`);
      continue;
    }
    let text: string;
    try {
      text = next.get(path) ?? readFileSync(path, 'utf8');
    } catch {
      problems.push(`${e.file}: no such file`);
      continue;
    }
    const count = text.split(e.find).length - 1;
    if (count !== 1) {
      problems.push(`${e.file}: find text appears ${count} times, it must appear once`);
      continue;
    }
    next.set(path, text.replace(e.find, () => e.replace));
  }
  if (problems.length) return problems;
  for (const [path, text] of next) writeFileSync(path, text);
  return [];
}

function sourceFiles(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(join(root, d))) {
      const rel = join(d, name);
      if (rel.startsWith(join('pages', 'api'))) continue;
      if (statSync(join(root, rel)).isDirectory()) visit(rel);
      else if (/\.(tsx?|css)$/.test(name)) out.push({ path: rel, text: readFileSync(join(root, rel), 'utf8') });
    }
  };
  for (const d of DIRS) visit(d);
  return out;
}

export function lockoutNotes(roundDir: string): string {
  const round = loadRound(roundDir);
  const parts: string[] = [];
  for (const o of round.outcomes) {
    if (o.outcome === 'bought') {
      parts.push(`## ${o.name} (${o.shopper}, ${o.mode}): bought in ${o.steps} steps.`);
      continue;
    }
    const steps = loadSteps(roundDir, o.shopper).slice(-8);
    parts.push(
      `## ${o.name} (${o.shopper}, ${o.mode}): ${o.outcome} after ${o.steps} steps on ${o.lastUrl}\n` +
        `Their reason: ${o.reason}\n` +
        steps
          .map((s) => `- step ${s.step} on ${s.url}: ${s.action} ${s.targetLabel || s.target} ${s.text} -> ${s.result}. Thought: ${s.thought}`)
          .join('\n'),
    );
  }
  const sc = loadScan(roundDir);
  if (sc) {
    parts.push(
      '## Automated scan\n' +
        sc.findings.map((f) => `- ${f.page}: ${f.id} (${f.impact}) ${f.help}. Elements: ${f.nodes.map((n) => n.html).join(' | ')}`).join('\n') +
        `\nKeyboard walk on a product page: Add To Cart is tab stop ${sc.addToCartTabStop ?? 'never reached'}, ` +
        `shows focus: ${sc.addToCartShowsFocus}. Stops without a visible focus indicator: ` +
        sc.tabStops.filter((t) => !t.visibleFocus).map((t) => `${t.tag} "${t.name}"`).join(', ') +
        (sc.focusAfterOpeningCard
          ? `\nKeyboard check on a product page: Tab to the recommended card ${sc.focusAfterOpeningCard.card} and press Enter. ` +
            `The new product page opens with focus on ${sc.focusAfterOpeningCard.afterEnter}. One Tab later focus is on ` +
            `${sc.focusAfterOpeningCard.afterTab}, with the page scrolled ${sc.focusAfterOpeningCard.scrollAfterTab}px down.`
          : ''),
    );
  }
  return parts.join('\n\n');
}

function git(args: string[]): string {
  return execFileSync('git', ['-C', SHOP_SRC, ...args], { encoding: 'utf8' });
}

export interface FixRecord {
  model: string;
  summary: string;
  edits: Edit[];
  attempts: number;
  built: boolean;
  buildSeconds: number;
  buildTail: string;
}

// baseDiff: an earlier fix that the shop in this round already had. The new edits go on top of it.
export async function makeFix(roundDir: string, baseDiff?: string): Promise<FixRecord> {
  const root = join(SHOP_SRC, FRONTEND);
  const notes = lockoutNotes(roundDir);
  const round = loadRound(roundDir);
  const base = baseDiff ? readFileSync(baseDiff, 'utf8') : '';
  const prepare = () => {
    git(['reset', '-q', '--', FRONTEND]);
    git(['checkout', '--', FRONTEND]);
    if (baseDiff) {
      git(['apply', resolve(baseDiff)]);
      git(['add', '--', FRONTEND]);
    }
  };
  let feedback = '';
  let last: FixRecord | null = null;
  // fix-status.json lets the dashboard show what the fix is doing while it runs
  const status = (state: string, attempt: number) =>
    writeFileSync(join(roundDir, 'fix-status.json'), JSON.stringify({ state, attempt, at: new Date().toISOString() }) + '\n');
  for (let attempt = 1; attempt <= 2; attempt++) {
    status('writing', attempt);
    prepare();
    const files = sourceFiles(root);
    const plan = await askJson<FixPlan>({
      model: FIX_MODEL,
      system: SYSTEM,
      user: [
        { type: 'input_text', text: `# What happened in the round\n\n${notes}` },
        ...(base
          ? [{ type: 'input_text' as const, text: `# An earlier fix is already in the shop\n\nThe source files below already include it. This is that fix:\n\n${base}` }]
          : []),
        { type: 'input_text', text: `# Frontend source files\n\n${files.map((f) => `=== ${f.path}\n${f.text}`).join('\n\n')}` },
        ...(feedback ? [{ type: 'input_text' as const, text: `# Your previous edits failed\n\n${feedback}\nReturn a corrected full set of edits.` }] : []),
      ],
      schemaName: 'fix_plan',
      schema: SCHEMA,
      purpose: 'fix',
      round: round.id,
      effort: 'medium',
    });
    const problems = applyEdits(root, plan.edits);
    if (problems.length) {
      feedback = problems.join('\n');
      last = { model: FIX_MODEL, summary: plan.summary, edits: plan.edits, attempts: attempt, built: false, buildSeconds: 0, buildTail: feedback };
      continue;
    }
    // fix.diff is what this pass changed, shop.diff is everything from the release that the shop now runs
    writeFileSync(join(roundDir, 'fix.diff'), git(['diff', '--', FRONTEND]));
    const shopDiff = join(roundDir, 'shop.diff');
    writeFileSync(shopDiff, git(['diff', 'HEAD', '--', FRONTEND]));
    git(['reset', '-q', '--', FRONTEND]);
    git(['checkout', '--', FRONTEND]);
    status('building', attempt);
    const t0 = Date.now();
    const build = spawnSync('bash', ['shop/shop.sh', 'fix', shopDiff], { encoding: 'utf8' });
    const seconds = Math.round((Date.now() - t0) / 1000);
    const tail = `${build.stdout}\n${build.stderr}`.split('\n').slice(-40).join('\n');
    last = { model: FIX_MODEL, summary: plan.summary, edits: plan.edits, attempts: attempt, built: build.status === 0, buildSeconds: seconds, buildTail: tail };
    if (build.status === 0) break;
    feedback = `The shop build failed:\n${tail}`;
  }
  writeFileSync(join(roundDir, 'fix.json'), JSON.stringify(last, null, 2) + '\n');
  status(last?.built ? 'built' : 'failed', last?.attempts ?? 0);
  return last!;
}
