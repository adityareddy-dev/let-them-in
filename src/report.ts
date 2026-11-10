// One static page that tells the story of a before round, the fix and an after round.
// It reads only saved records, so it costs nothing to rebuild.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { loadRound, loadScan, loadSteps, type RoundRecord } from './round.js';
import { SHOPPERS } from './shoppers.js';
import type { FixRecord } from './fix.js';
import type { Outcome } from './walk.js';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const NEED: Record<string, string> = {
  mouse: 'No access needs, mouse',
  keyboard: 'Keyboard only',
  screenreader: 'Blind, screen reader',
  zoom: 'Low vision, 200% zoom',
  slowphone: 'Cheap phone, slow network',
};

function badge(o?: Outcome): string {
  if (!o) return '<span class="badge none">not run</span>';
  if (o.outcome === 'bought') return `<span class="badge in">Got in, bought in ${o.steps} steps</span>`;
  const word = o.outcome === 'gave_up' ? 'Locked out, gave up' : o.outcome === 'step_limit' ? 'Locked out, still stuck' : 'Run error';
  return `<span class="badge out">${word} after ${o.steps} steps</span>`;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function diffHtml(diff: string): string {
  return diff
    .split('\n')
    .map((l) => {
      const cls = l.startsWith('+++') || l.startsWith('---') ? 'meta' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'meta' : '';
      return `<span class="${cls}">${esc(l)}</span>`;
    })
    .join('\n');
}

function trail(roundDir: string, outFile: string, shopper: string): string {
  const steps = loadSteps(roundDir, shopper);
  if (!steps.length) return '';
  const rel = (f: string) => esc(relative(dirname(outFile), join(roundDir, shopper, f)));
  return (
    '<ol class="trail">' +
    steps
      .map(
        (s) =>
          `<li><img loading="lazy" src="${rel(s.screenshot)}" alt="What the screen showed at step ${s.step}, ${esc(pathOf(s.url))}">` +
          `<div><p class="act">${esc(s.action)} ${esc(s.targetLabel || s.target)} ${esc(s.action === 'give_up' ? '' : s.text)} <span class="res">${esc(s.result)}</span></p>` +
          `<p class="thought">${esc(s.thought)}</p></div></li>`,
      )
      .join('') +
    '</ol>'
  );
}

function lastShot(roundDir: string, outFile: string, o?: Outcome): string {
  if (!o) return '';
  const steps = loadSteps(roundDir, o.shopper);
  const final = o.outcome === 'bought' && existsSync(join(roundDir, o.shopper, 'final.jpg')) ? 'final.jpg' : steps[steps.length - 1]?.screenshot;
  if (!final) return '';
  const src = esc(relative(dirname(outFile), join(roundDir, o.shopper, final)));
  return `<img class="shot" src="${src}" alt="${esc(o.name)}'s screen at the end, ${esc(pathOf(o.lastUrl))}">`;
}

export function buildReport(beforeDir: string, afterDir: string | null, outFile: string): string {
  const before = loadRound(beforeDir);
  const after: RoundRecord | null = afterDir ? loadRound(afterDir) : null;
  const fixFile = join(beforeDir, 'fix.json');
  const fix: FixRecord | null = existsSync(fixFile) ? JSON.parse(readFileSync(fixFile, 'utf8')) : null;
  const diffFile = join(beforeDir, 'fix.diff');
  const diff = existsSync(diffFile) ? readFileSync(diffFile, 'utf8') : '';
  const scanB = loadScan(beforeDir);
  const scanA = afterDir ? loadScan(afterDir) : null;
  const n = before.outcomes.length;

  const rows = SHOPPERS.filter((s) => before.outcomes.some((o) => o.shopper === s.id))
    .map((s) => {
      const b = before.outcomes.find((o) => o.shopper === s.id);
      const a = after?.outcomes.find((o) => o.shopper === s.id);
      const quote = b && b.outcome !== 'bought' ? `<blockquote>${esc(b.reason)}</blockquote><p class="where">Stuck on <code>${esc(pathOf(b.lastUrl))}</code></p>` : '';
      return `<article class="shopper" id="${s.id}">
  <header><span class="avatar" aria-hidden="true">${esc(s.name[0])}</span><div><h3>${esc(s.name)}</h3><p class="need">${esc(NEED[s.mode])}</p></div></header>
  <div class="cols">
    <section aria-label="${esc(s.name)} before the fix"><h4>Before</h4>${badge(b)}${quote}${lastShot(beforeDir, outFile, b)}
      <details><summary>Every step ${esc(s.name)} took before</summary>${trail(beforeDir, outFile, s.id)}</details></section>
    <section aria-label="${esc(s.name)} after the fix"><h4>After</h4>${badge(a)}${a && a.outcome !== 'bought' ? `<blockquote>${esc(a.reason)}</blockquote>` : ''}${afterDir ? lastShot(afterDir, outFile, a) : ''}
      ${afterDir ? `<details><summary>Every step ${esc(s.name)} took after</summary>${trail(afterDir, outFile, s.id)}</details>` : ''}</section>
  </div>
</article>`;
    })
    .join('\n');

  const rules = (sc: typeof scanB) => {
    const m = new Map<string, number>();
    for (const f of sc?.findings ?? []) m.set(f.id, (m.get(f.id) ?? 0) + f.nodes.length);
    return m;
  };
  const rb = rules(scanB);
  const ra = rules(scanA);
  const ruleRows = [...new Set([...rb.keys(), ...ra.keys()])]
    .map((id) => {
      const help = [...(scanB?.findings ?? []), ...(scanA?.findings ?? [])].find((f) => f.id === id)?.help ?? '';
      return `<tr><th scope="row"><code>${esc(id)}</code> ${esc(help)}</th><td>${rb.get(id) ?? 0}</td><td>${afterDir ? (ra.get(id) ?? 0) : ''}</td></tr>`;
    })
    .join('');
  const focusLine = (sc: typeof scanB) =>
    !sc ? 'not run' : sc.addToCartTabStop === null ? 'never reached by Tab' : `tab stop ${sc.addToCartTabStop}, focus ${sc.addToCartShowsFocus ? 'visible' : 'invisible'}`;

  const edits = fix?.edits
    .map((e) => `<li><code>${esc(e.file)}</code>: ${esc(e.why)} <span class="helps">Helps ${e.helps.map((h) => esc(SHOPPERS.find((s) => s.id === h)?.name ?? h)).join(', ')}</span></li>`)
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Let Them In: ${esc(before.shop)}</title>
<style>
:root { --ink:#16182d; --soft:#4a4f6a; --line:#d8dae5; --bg:#f7f6f2; --card:#fff; --in:#1d6b34; --in-bg:#e3f4e8; --out:#a51d1d; --out-bg:#fbe5e5; --brand:#c2410c; }
* { box-sizing:border-box; }
body { margin:0; font:17px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--ink); background:var(--bg); }
a { color:var(--brand); }
:focus-visible { outline:3px solid var(--brand); outline-offset:2px; }
.skip { position:absolute; left:-999px; } .skip:focus { left:8px; top:8px; background:#fff; padding:6px 10px; }
.top { background:var(--ink); color:#fff; padding:28px 24px 34px; }
.top .wrap { display:flex; gap:18px; align-items:center; }
.logo { width:56px; height:56px; flex:none; }
h1 { margin:0; font-size:34px; letter-spacing:-0.5px; }
.tag { margin:4px 0 0; color:#d9dbea; }
main { max-width:1120px; margin:0 auto; padding:24px; }
.wrap { max-width:1120px; margin:0 auto; }
.score { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; margin:-46px 0 28px; }
.score div { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
.score .big { font-size:46px; font-weight:800; line-height:1; }
.score .lbl { color:var(--soft); }
h2 { font-size:24px; margin:36px 0 12px; }
.shopper { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin:0 0 18px; }
.shopper > header { display:flex; gap:12px; align-items:center; }
.avatar { width:42px; height:42px; border-radius:50%; background:var(--ink); color:#fff; display:grid; place-items:center; font-weight:800; font-size:20px; }
h3 { margin:0; font-size:20px; } .need { margin:0; color:var(--soft); }
h4 { margin:12px 0 6px; font-size:15px; text-transform:uppercase; letter-spacing:.06em; color:var(--soft); }
.cols { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
@media (max-width:760px) { .cols { grid-template-columns:1fr; } }
.badge { display:inline-block; padding:4px 10px; border-radius:999px; font-weight:700; font-size:15px; }
.badge.in { background:var(--in-bg); color:var(--in); } .badge.out { background:var(--out-bg); color:var(--out); } .badge.none { background:#eee; color:#444; }
blockquote { margin:10px 0; padding:8px 12px; border-left:4px solid var(--out); background:#fff7f7; }
.where { margin:0 0 8px; color:var(--soft); }
.shot { display:block; width:100%; max-height:260px; object-fit:cover; object-position:top; border:1px solid var(--line); border-radius:8px; margin-top:8px; }
details { margin-top:10px; } summary { cursor:pointer; color:var(--brand); font-weight:600; }
.trail { padding-left:22px; } .trail li { margin:10px 0; }
.trail li { display:grid; grid-template-columns:160px 1fr; gap:10px; }
.trail img { width:160px; border:1px solid var(--line); border-radius:6px; }
.act { margin:0; font-weight:700; } .res { font-weight:400; color:var(--soft); } .thought { margin:2px 0 0; color:var(--soft); font-size:15px; }
.box { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
pre.diff { background:#0f1222; color:#e6e8f2; padding:14px; border-radius:10px; overflow:auto; font-size:13px; line-height:1.45; max-height:520px; }
pre.diff .add { color:#8ce99a; } pre.diff .del { color:#ffa8a8; } pre.diff .meta { color:#a5b4fc; }
.helps { color:var(--soft); }
pre.tree { background:#f1f2f7; padding:12px; border-radius:8px; font-size:13px; overflow:auto; max-height:420px; white-space:pre-wrap; }
table { border-collapse:collapse; width:100%; } th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line); vertical-align:top; } td { width:90px; font-weight:700; }
footer { color:var(--soft); font-size:15px; padding:30px 24px; max-width:1120px; margin:0 auto; }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to results</a>
<div class="top"><div class="wrap">
<svg class="logo" viewBox="0 0 64 64" role="img" aria-label="Let Them In logo, an open door"><rect x="6" y="6" width="52" height="52" rx="12" fill="#c2410c"/><path d="M20 50V14h24v36" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M20 14l14 5v35l-14-4z" fill="#fff"/><circle cx="30" cy="34" r="2.2" fill="#c2410c"/></svg>
<div><h1>Let Them In</h1><p class="tag">Who does this shop lock out? AI shoppers with different access needs try it, the AI fixes what stopped them, and the same shoppers go again.</p></div>
</div></div>
<main id="main">
<div class="score">
<div><p class="big">${before.bought} of ${n}</p><p class="lbl">bought before the fix</p></div>
<div><p class="big">${after ? `${after.bought} of ${after.outcomes.length}` : '–'}</p><p class="lbl">bought after the fix</p></div>
<div><p class="big">${esc(before.shop.split(' (')[0])}</p><p class="lbl">the real shop, frontend unchanged before the fix</p></div>
</div>
<h2>The shoppers</h2>
${rows}
<h2 id="fix">The fix</h2>
<div class="box">
${fix ? `<p>${esc(fix.summary)}</p><ul>${edits}</ul><p>Shop frontend rebuilt with the patch: <strong>${fix.built ? `passed in ${fix.buildSeconds} s` : 'failed'}</strong>${fix.attempts > 1 ? `, on attempt ${fix.attempts}` : ''}.</p>${diff ? `<pre class="diff" aria-label="The patch">${diffHtml(diff)}</pre>` : ''}` : '<p>No fix yet.</p>'}
</div>
<h2>Rule-based check</h2>
<div class="box">
<p>axe-core on the home, product and cart pages, and a scripted Tab walk on a product page. No AI involved.</p>
<p>Add To Cart by keyboard: before, ${esc(focusLine(scanB))}. ${afterDir ? `After, ${esc(focusLine(scanA))}.` : ''}</p>
<table><thead><tr><th scope="col">Rule</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${ruleRows || '<tr><td colspan="3">No findings</td></tr>'}</tbody></table>
${scanB?.checkoutFormHeard ? `<h3 id="heard">What a screen reader gets from the checkout form</h3><div class="cols"><div><h4>Before</h4><pre class="tree">${esc(scanB.checkoutFormHeard)}</pre></div><div><h4>After</h4><pre class="tree">${esc(scanA?.checkoutFormHeard ?? '')}</pre></div></div>` : ''}
</div>
</main>
<footer>
<p>Before round <code>${esc(before.id)}</code>${after ? `, after round <code>${esc(after.id)}</code>` : ''}. Shop: ${esc(before.shop)}. AI cost: ${esc(before.spendUsd.toFixed(2))} USD before${after ? `, ${esc(after.spendUsd.toFixed(2))} USD after` : ''}. Every model call is in <code>spend/openai.jsonl</code>.</p>
</footer>
</body>
</html>
`;
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  return outFile;
}


