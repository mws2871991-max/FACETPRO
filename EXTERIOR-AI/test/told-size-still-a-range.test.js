/* A size the homeowner told us does not make the price exact. Run: npm test
 *
 * Launch review item 17. A told wall area or roofline length returned one
 * figure to the pound, and in one case a range of £6,500–£6,500 with the
 * £6,522 total sitting outside it — on a site whose footer says every figure
 * is "a planning estimate, shown as a range, confirmed by your installer's
 * survey".
 *
 * The old reasoning was that the number is theirs and the Terms say theirs
 * overrides ours. True of the QUANTITY, silent on the PRICE: the rate per
 * square metre, the labour, the waste and the scaffolding are all still ours.
 */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3291;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const quote = (body) => fetch(`${BASE}/api/quote`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

const TOLD_WALL = { claddingId: 'alabaster', trimId: 'none', roofId: 'none',
  footprintM2: 90, trimLengthM: null, detectionId: null, houseType: 'semi' };
const TOLD_ROOFLINE = { claddingId: 'none', trimId: 'ink-trim', roofId: 'none',
  footprintM2: null, trimLengthM: 42, detectionId: null, houseType: 'semi' };

test('a told wall area still gets a range', async () => {
  const q = await quote(TOLD_WALL);
  assert.strictEqual(q.exact, true, 'the size is still theirs, and should still say so');
  assert.ok(q.range, 'a told area came back with no range at all');
  assert.ok(q.range.high > q.range.low, `range collapsed: ${JSON.stringify(q.range)}`);
});

test('the total sits inside its own range — every time', async () => {
  /* The exact complaint: £6,500–£6,500 with a £6,522 total outside it. */
  for (const body of [TOLD_WALL, TOLD_ROOFLINE, { ...TOLD_WALL, footprintM2: 200 }]) {
    const q = await quote(body);
    if (!q.range) continue;                      // one figure is honest on a tiny job
    assert.ok(q.range.low <= q.total && q.total <= q.range.high,
      `total ${q.total} outside ${JSON.stringify(q.range)} for ${JSON.stringify(body)}`);
  }
});

test('their measurement is not widened — the price around it is', async () => {
  /* Widening the area they gave us would be inventing doubt about the one
     number on the page that is theirs. */
  const q = await quote(TOLD_WALL);
  assert.strictEqual(q.footprintM2, 90, 'the area they typed came back changed');
  const q2 = await quote(TOLD_ROOFLINE);
  assert.strictEqual(q2.trimLengthM, 42, 'the roofline length they typed came back changed');
});

test('the band is the one glazing already reasoned out, not a new one', async () => {
  /* glazing.js settled this question the other way round: a typed WINDOW COUNT
     does not go exact, it takes UNCERTAINTY.door — the narrowest band it has —
     because the count is theirs and the rates are ours. Same situation, same
     number, rather than a second percentage invented here. */
  const glazing = require('../glazing');
  const u = (glazing._internals && glazing._internals.UNCERTAINTY) || null;
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const m = src.match(/const TOLD_SIZE_UNCERTAINTY = ([\d.]+);/);
  assert.ok(m, 'the told-size band has gone');
  const told = Number(m[1]);
  if (u && typeof u.door === 'number') {
    assert.strictEqual(told, u.door, 'it should still equal glazing\'s narrowest band');
  } else {
    assert.strictEqual(told, 0.18, 'glazing\'s door band is 0.18');
  }
  assert.ok(told > 0 && told < PRIOR_AREA(src),
    'a told size must be narrower than a size we guessed');

  function PRIOR_AREA(s) {
    const p = s.match(/const PRIOR_AREA_UNCERTAINTY = ([\d.]+);/);
    return p ? Number(p[1]) : 0.25;
  }
});

test('a guessed size is still the wider band', async () => {
  /* The distinction has to survive: telling us the size should visibly buy a
     tighter answer, or there was no point asking. */
  const guessed = await quote({ ...TOLD_WALL, footprintM2: null });
  const told = await quote(TOLD_WALL);
  if (guessed.range && told.range) {
    const width = (r) => (r.high - r.low) / ((r.high + r.low) / 2);
    assert.ok(width(told.range) <= width(guessed.range) + 1e-9,
      `telling us the size widened the answer: told ${JSON.stringify(told.range)} vs guessed ${JSON.stringify(guessed.range)}`);
  }
});
