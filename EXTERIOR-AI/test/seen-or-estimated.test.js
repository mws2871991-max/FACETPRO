/* Seen, told, or estimated.

   The product rule: measure what the photo shows, never pretend about what it
   does not, and label every assumption. /api/quote says, for each quantity
   behind the price, which of the three it is. These pin that it never calls
   an estimate "measured". */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3262;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);

const { _internals } = require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const quote = async (body) => {
  const res = await fetch(`${BASE}/api/quote`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claddingId: 'clay-stone', trimId: 'ink-trim', roofId: 'slate-roof', ...body }),
  });
  assert.strictEqual(res.status, 200);
  return res.json();
};

test('a measured front is measured, and the rest of the house is an estimate', async () => {
  _internals.detectionRecords.set('seen-test', {
    detections: [], aspectRatio: 4 / 3,
    measurement: { m2: 105, method: 'door', low: 90, high: 120, observed: { frontElevationM2: 34.6, frontToTotal: 3.05 } },
  });
  const q = await quote({ detectionId: 'seen-test' });
  assert.deepStrictEqual(q.basis.walls, [
    { part: 'front wall', kind: 'measured', m2: 35 },
    { part: 'back and side walls', kind: 'estimated', m2: 70 },
  ]);
  assert.strictEqual(q.basis.roof.kind, 'estimated', 'a roof is never measured from the ground');
  assert.strictEqual(q.basis.trim.kind, 'estimated');
});

test('with no photo reading, the walls are an estimate, never "measured"', async () => {
  const q = await quote({ houseType: 'semi' });
  assert.strictEqual(q.basis.walls.length, 1);
  assert.strictEqual(q.basis.walls[0].kind, 'estimated');
  assert.ok(!JSON.stringify(q.basis).includes('"measured"'));
});

test('a typed wall area and roofline length are the homeowner\'s', async () => {
  const q = await quote({ footprintM2: 120, trimLengthM: 42 });
  assert.deepStrictEqual(q.basis.walls, [{ part: 'walls', kind: 'told', m2: 120 }]);
  assert.deepStrictEqual(q.basis.trim, { kind: 'told', m: 42 });
});

test('a trade that was not chosen has no basis line', async () => {
  const q = await quote({ claddingId: 'none', trimId: 'none', roofId: 'slate-roof', houseType: 'semi' });
  assert.strictEqual(q.basis.walls, null);
  assert.strictEqual(q.basis.trim, null);
  assert.strictEqual(q.basis.roof.kind, 'estimated');
});
