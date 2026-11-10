import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { costUsd, firstJsonObject } from '../src/ai.js';
import { applyEdits } from '../src/fix.js';
import { roundId } from '../src/round.js';
import { buildReport } from '../src/report.js';
import { ACTIONS, decisionSchema, orderIdFromUrl, systemPrompt } from '../src/walk.js';
import { SHOPPERS } from '../src/shoppers.js';

test('cost uses the cached price for cached tokens', () => {
  const usd = costUsd('gpt-5.4-mini', { input_tokens: 1_000_000, cached_tokens: 400_000, output_tokens: 100_000 });
  assert.equal(Number(usd.toFixed(6)), Number((0.6 * 0.75 + 0.4 * 0.075 + 0.1 * 4.5).toFixed(6)));
});

test('cost refuses a model with no price', () => {
  assert.throws(() => costUsd('no-such-model', { input_tokens: 1, cached_tokens: 0, output_tokens: 1 }));
});

test('order id comes only from the confirmation page', () => {
  assert.equal(orderIdFromUrl('http://x/cart/checkout/abc-123?order=%7B%7D'), 'abc-123');
  assert.equal(orderIdFromUrl('http://x/cart'), undefined);
  assert.equal(orderIdFromUrl('http://x/product/OLJCESPC7Z'), undefined);
});

test('each shopper can only use the actions their access need allows', () => {
  assert.ok(!ACTIONS.keyboard.includes('click'));
  assert.ok(!ACTIONS.screenreader.includes('click'));
  assert.ok(ACTIONS.mouse.includes('click'));
  for (const s of SHOPPERS) {
    const schema = decisionSchema(s.mode) as any;
    assert.deepEqual(schema.properties.action.enum, ACTIONS[s.mode]);
    assert.match(systemPrompt(s), new RegExp(s.name));
  }
});

test('edits apply only when every find text appears exactly once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lti-'));
  try {
    writeFileSync(join(dir, 'a.tsx'), 'outline: none;\nlabel\n');
    writeFileSync(join(dir, 'b.tsx'), 'x x\n');
    const bad = applyEdits(dir, [
      { file: 'a.tsx', find: 'outline: none;', replace: 'outline: 2px;', why: '', helps: [] },
      { file: 'b.tsx', find: 'x', replace: 'y', why: '', helps: [] },
    ]);
    assert.equal(bad.length, 1);
    assert.equal(readFileSync(join(dir, 'a.tsx'), 'utf8'), 'outline: none;\nlabel\n', 'nothing written when one edit fails');
    assert.deepEqual(applyEdits(dir, [{ file: '../escape.tsx', find: 'a', replace: 'b', why: '', helps: [] }]), ['../escape.tsx: outside the frontend']);
    assert.deepEqual(applyEdits(dir, [{ file: 'a.tsx', find: 'outline: none;', replace: 'outline: 2px $& solid;', why: '', helps: [] }]), []);
    assert.equal(readFileSync(join(dir, 'a.tsx'), 'utf8'), 'outline: 2px $& solid;\nlabel\n', 'replace text is literal');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('round ids sort by time', () => {
  assert.equal(roundId('before', new Date('2026-11-10T04:05:00Z')), '20261110-0405-before');
});

test('report shows who got in before and after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lti-'));
  try {
    const round = (id: string, outcomes: any[]) => {
      mkdirSync(join(dir, id), { recursive: true });
      writeFileSync(
        join(dir, id, 'round.json'),
        JSON.stringify({ id, label: id, shopUrl: 'http://shop', shop: 'Test Shop (x)', startedAt: '', finishedAt: '', outcomes, bought: outcomes.filter((o) => o.outcome === 'bought').length, spendUsd: 0.1 }),
      );
    };
    round('b', [
      { shopper: 'tom', name: 'Tom', mode: 'mouse', outcome: 'bought', steps: 6, lastUrl: 'http://shop/cart/checkout/1', reason: 'order complete', lastSay: '' },
      { shopper: 'joel', name: 'Joel', mode: 'keyboard', outcome: 'gave_up', steps: 12, lastUrl: 'http://shop/product/X', reason: 'I cannot see <where> I am', lastSay: '' },
    ]);
    round('a', [
      { shopper: 'tom', name: 'Tom', mode: 'mouse', outcome: 'bought', steps: 6, lastUrl: '', reason: '', lastSay: '' },
      { shopper: 'joel', name: 'Joel', mode: 'keyboard', outcome: 'bought', steps: 9, lastUrl: '', reason: '', lastSay: '' },
    ]);
    const out = join(dir, 'report', 'index.html');
    buildReport([join(dir, 'b'), join(dir, 'a')], out);
    const html = readFileSync(out, 'utf8');
    assert.match(html, /1 of 2/);
    assert.match(html, /2 of 2/);
    assert.match(html, /I cannot see &lt;where&gt; I am/);
    assert.match(html, /Locked out, gave up after 12 steps/);
    assert.match(html, /<html lang="en">/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the first JSON object is taken when a reply holds two', () => {
  assert.deepEqual(firstJsonObject('{"a":"x}"}{"a":2}'), { a: 'x}' });
  assert.equal(firstJsonObject('no json'), null);
});
