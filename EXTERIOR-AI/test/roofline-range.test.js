'use strict';

require('./helpers/data-dir');

/* A roofline-only job is a range too (29 September). Fascias, soffits and
   guttering are priced by the metre, not by wall area, so widening only the
   area gave low === high and the page showed one exact-looking figure
   (£5,500) beside a range for every other trade. An estimated run now gets
   the same ±25% as an estimated area; a run the homeowner typed stays exact. */
const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3287;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const quote = (body) => fetch(`${BASE}/api/quote`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

test('roofline only, with the typical run: a real range', async () => {
  /* Exactly what /design?journey=roofline sends on arrival. */
  const q = await quote({ claddingId: 'none', trimId: 'ink-trim', roofId: 'none', footprintM2: null, trimLengthM: null, detectionId: null, houseType: 'semi' });
  assert.ok(q.range, 'no range at all');
  assert.ok(q.range.high > q.range.low, `range collapsed to one figure: ${JSON.stringify(q.range)}`);
  assert.ok(q.range.low <= q.total && q.total <= q.range.high, 'the figure should sit inside its own range');
});

test('roofline length the homeowner typed does not get widened', async () => {
  const typed = await quote({ trimId: 'ink-trim', trimLengthM: 30, footprintM2: 90 });
  // Walls not chosen and the area typed: nothing left to be uncertain about.
  assert.ok(!typed.range || typed.range.low === typed.range.high || typed.exact,
    `a told length and a told area should not produce a spread: ${JSON.stringify(typed.range)}`);
});
