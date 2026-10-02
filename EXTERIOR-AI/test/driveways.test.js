'use strict';
require('./helpers/data-dir');
/* Driveways trial (2 October 2026). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const d = require('../driveways');
const catalogue = require('../catalogue.json');
const { buildRenderPrompt } = require('../renderprompt');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('off unless switched on; test only for requests that ask', () => {
  assert.strictEqual(d.mode({}), 'off');
  assert.strictEqual(d.enabled({ body: { experiments: ['driveway'] } }, {}), false);
  assert.strictEqual(d.enabled({ body: {} }, { DRIVEWAYS: 'test' }), false);
  assert.strictEqual(d.enabled({ body: { experiments: ['driveway'] } }, { DRIVEWAYS: 'test' }), true);
  assert.strictEqual(d.enabled({ query: { exp: 'driveway' } }, { DRIVEWAYS: 'test' }), true);
  assert.strictEqual(d.enabled({}, { DRIVEWAYS: 'on' }), true);
  assert.strictEqual(d.enabled({}, { DRIVEWAYS: 'banana' }), false);
});

test('every rate is sourced and dated; exclusions and planning are stated', () => {
  const dw = catalogue.driveways;
  assert.ok(dw.sourced && /MyBuilder/.test(dw.source) && /BestBuilders/.test(dw.source) && dw.updated);
  for (const m of dw.materials) assert.ok(m.perM2[0] > 0 && m.perM2[1] > m.perM2[0], m.id);
  assert.ok(dw.excluded.some(x => /dropped kerb/i.test(x)));
  assert.match(dw.planning, /5 m²/);
  assert.match(dw.noInstallerYet, /won't pass your details on/);
});

test('the estimate is surface + groundworks + waste, lows with lows and highs with highs', () => {
  const e = d.estimate({ materialId: 'block-paving', sizeId: 'two-cars' });
  // 35×(80+30)+250 = 4100 ; 45×(150+50)+700 = 9700
  assert.strictEqual(e.low, 4100); assert.strictEqual(e.high, 9700);
  assert.strictEqual(e.size.kind, 'told');
  assert.strictEqual(e.kind, 'planning-estimate');
  assert.strictEqual(d.estimate({ materialId: 'block-paving' }), null, 'no size, no figure');
  assert.strictEqual(d.estimate({ materialId: 'marble', sizeId: 'two-cars' }), null);
});

test('the page gets names and sizes, never the rate card', () => {
  const pub = JSON.stringify(d.publicSection());
  assert.doesNotMatch(pub, /perM2|groundworksPerM2|wasteRemoval/);
});

test('the render asks for the driveway inside the boundary and stops holding it', () => {
  const p = buildRenderPrompt({ driveway: { id: 'tarmac', name: 'Tarmac', words: d.promptWords('tarmac') } });
  assert.match(p, /this house's own driveway/);
  assert.match(p, /public pavement and road beyond the boundary/);
  assert.doesNotMatch(p, /the garden, path, driveway, fencing/, 'the driveway is no longer held');
  const plain = buildRenderPrompt({ trim: { id: 'ink-trim', name: 'Ink Trim' } });
  assert.match(plain, /the garden, path, driveway, fencing/, 'without a driveway it is still held');
});

test('server: gated quote route, catalogue only when enabled, surroundings hold off for a driveway, no lead', () => {
  const s = read('server.js');
  assert.match(s, /app\.post\('\/api\/driveway-quote'/);
  assert.match(s, /if \(!driveways\.enabled\(\{ body: req\.body, query: req\.query \}\)\) return res\.status\(404\)/);
  assert.match(s, /surroundings: !trim && !\(roof && !roofUnsupported\) && !driveway/);
  const lead = s.slice(s.indexOf("app.post('/api/lead'"), s.indexOf("app.post('/api/lead'") + 6000);
  assert.doesNotMatch(lead, /driveway/i, 'driveways never reach a lead');
});

test('page: driveway row only from the catalogue, sends the surface with the render', () => {
  const h = read('index.html');
  assert.match(h, /const dw = state\.catalogue\?\.driveways \|\| null;/);
  assert.match(h, /drivewayId: state\.driveway\?\.materialId \|\| undefined/);
  assert.match(h, /if \(state\.driveway\?\.materialId\) return true;/);
});
