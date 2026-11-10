import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeDir, seriesState } from '../src/dashboard.js';

test('dashboard state reads a recorded series in order', () => {
  const s = seriesState('runs/series-b');
  assert.deepEqual(
    s.rounds.map((r) => [r.label, r.bought, !!r.fix]),
    [
      ['before', 4, true],
      ['after', 4, true],
      ['after2', 5, false],
    ],
  );
  const joel = s.rounds[0].shoppers.find((x) => x.id === 'joel')!;
  assert.equal(joel.outcome?.outcome, 'step_limit');
  assert.equal(joel.steps.length, 30);
  assert.match(joel.steps[0].shot ?? '', /^\/files\/runs\/series-b\/20261110-0338-before\/joel\/step-01\.jpg$/);
  assert.ok(s.rounds[0].spend.some((l) => l.purpose === 'fix'));
});

test('dashboard only reads folders under runs', () => {
  assert.throws(() => safeDir('../'));
  assert.throws(() => safeDir('spend'));
  assert.doesNotThrow(() => safeDir('runs/series-a'));
});
