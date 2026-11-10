// let-them-in commands. Only `round`, `fix` and `demo` make paid model calls.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readSpend, totalSpend } from './ai.js';
import { makeFix } from './fix.js';
import { buildReport } from './report.js';
import { latestRound, runRound, RUNS } from './round.js';
import { scan } from './scan.js';
import { SHOPPERS } from './shoppers.js';

const SHOP = process.env.SHOP_URL ?? `http://127.0.0.1:${process.env.SHOP_PORT ?? '8090'}`;
const [cmd, ...args] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function pick() {
  const only = flag('only');
  const steps = flag('steps');
  const list = only ? SHOPPERS.filter((s) => only.split(',').includes(s.id)) : SHOPPERS;
  return steps ? list.map((s) => ({ ...s, maxSteps: Number(steps) })) : list;
}

async function main() {
  switch (cmd) {
    case 'scan': {
      const r = await scan(SHOP, flag('out') ?? join(RUNS, 'scratch'));
      console.log(`${r.findings.length} axe rules failed. Add To Cart tab stop: ${r.addToCartTabStop}, focus visible: ${r.addToCartShowsFocus}`);
      for (const f of r.findings) console.log(`  ${f.page}: ${f.id} (${f.impact}) x${f.nodes.length}: ${f.help}`);
      break;
    }
    case 'round':
      await runRound(args[0] ?? 'before', SHOP, pick());
      break;
    case 'fix': {
      const dir = args[0] && !args[0].startsWith('--') ? args[0] : latestRound('before');
      if (!dir) throw new Error('no before round found');
      const f = await makeFix(dir, flag('on'));
      console.log(`fix: ${f.edits.length} edits, build ${f.built ? 'passed' : 'failed'} in ${f.buildSeconds} s`);
      console.log(f.summary);
      break;
    }
    case 'report': {
      // report <first round> <round after fix 1> [<round after fix 2> ...]
      const dirs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
      if (!dirs.length) {
        const b = latestRound('before');
        const a = latestRound('after');
        if (!b) throw new Error('no before round found');
        dirs.push(b, ...(a ? [a] : []));
      }
      console.log(buildReport(dirs, flag('out') ?? 'report/index.html'));
      break;
    }
    case 'demo': {
      // The whole loop: before round, fix, after round, report, then the shop goes back to the release.
      const b = await runRound('before', SHOP, pick());
      const f = await makeFix(join(RUNS, b.id));
      if (!f.built) throw new Error('the fix did not build, see fix.json');
      const a = await runRound('after', SHOP, pick());
      console.log(buildReport([join(RUNS, b.id), join(RUNS, a.id)], 'report/index.html'));
      if (!args.includes('--keep-fix')) spawnSync('bash', ['shop/shop.sh', 'reset'], { stdio: 'inherit' });
      break;
    }
    case 'spend': {
      const by = new Map<string, number>();
      for (const l of readSpend()) by.set(l.round ?? '-', (by.get(l.round ?? '-') ?? 0) + l.usd);
      for (const [r, usd] of by) console.log(`${r}\t${usd.toFixed(4)} USD`);
      console.log(`total\t${totalSpend().toFixed(4)} USD in ${readSpend().length} calls`);
      break;
    }
    default:
      console.log('usage: tsx src/cli.ts scan | round <label> [--only ids] [--steps n] | fix [roundDir] [--on earlier/shop.diff] | report [round dirs in order] | demo | spend');
      process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
