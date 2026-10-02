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
  const p = buildRenderPrompt({ driveway: { id: 'tarmac', name: 'Tarmac', words: d.promptWords('tarmac', 'tm-black') } });
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
  assert.match(h, /drivewayId: \(state\.driveway\?\.existing === 'yes' && state\.driveway\?\.materialId\) \|\| undefined/);
  assert.match(h, /if \(state\.driveway\?\.existing === 'yes' && state\.driveway\?\.materialId\) return true;/);
});

test('every surface has styles with a drawn swatch; block paving has herringbone patterns', () => {
  const dw = catalogue.driveways;
  for (const m of dw.materials) {
    assert.ok(m.styles && m.styles.length, m.id);
    for (const st of m.styles) assert.ok(fs.existsSync(path.join(__dirname, '..', st.swatch.replace(/^\//, ''))), st.swatch);
  }
  const bp = dw.materials.find(m => m.id === 'block-paving');
  assert.deepStrictEqual(bp.patterns.map(p => p.id), ['herringbone-45', 'herringbone-90']);
  for (const p of bp.patterns) assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets/swatches/driveway', `pattern-${p.id}.png`)));
  assert.ok(dw.materials.some(m => m.id === 'stone-setts') && dw.materials.some(m => m.id === 'imprinted-concrete'));
  assert.match(dw.stylesSource, /No sales-share data found/);
});

test('the render words carry colour, pattern and border; a bad style falls back to the plain default', () => {
  assert.match(d.promptWords('block-paving', 'bp-charcoal', 'herringbone-90'), /charcoal.*90-degree herringbone.*border/);
  assert.match(d.promptWords('block-paving', 'bp-brindle'), /45-degree herringbone/, 'default pattern is 45°');
  assert.strictEqual(d.promptWords('gravel', 'nonsense'), d.DEFAULT_WORDS.gravel + ', with a neat edge');
  assert.strictEqual(d.promptWords('marble'), null);
});

test('colour never changes the price', () => {
  const a = d.estimate({ materialId: 'resin-bound', sizeId: 'one-car' });
  assert.strictEqual(a.low, 1900); assert.strictEqual(a.high, 5300);
});

/* 0054 — after the first live tests (2 Oct): number 14's wall demolished,
   bins and handrail removed; resin drawn as loose gravel. */
const { PNG } = require('pngjs');
const { restoreInsideMask, KEEP_MAX_OF_GROUND } = require('../hold');

test('only an existing driveway is drawn or priced; a front garden gets advice, not a picture', () => {
  assert.strictEqual(d.hasExisting('yes'), true);
  assert.strictEqual(d.hasExisting('no'), false);
  assert.strictEqual(d.hasExisting(undefined), false);
  const s = read('server.js');
  assert.match(s, /if \(!driveways\.hasExisting\(req\.body\?\.existing\)\)/);
  assert.match(s, /drivewayId && driveways\.hasExisting\(drivewayExisting\) && driveways\.enabled/);
  const pub = d.publicSection();
  assert.match(pub.existingQuestion, /driveway in front of the house now/);
  assert.match(pub.noDrivewayAdvice, /taking down a wall or fence/);
  assert.match(pub.noDrivewayAdvice, /don't show it on your photo or price it/);
});

test('walls, fences, railings, bins and cars are segmented and put back', () => {
  assert.match(d.KEEP_PROMPT, /garden wall.*fence.*railing.*handrail.*wheelie bin.*car/);
  assert.doesNotMatch(d.KEEP_PROMPT, /pavement|driveway|paving/, 'never segment the thing being changed');
  const s = read('server.js');
  assert.match(s, /prompt: driveways\.KEEP_PROMPT/);
  assert.match(s, /restoreInsideMask\(\{ render: bytes, \.\.\.common, mask: restore\.keepMask/);
});

const W = 100, H = 100;
const png = (fn) => { const p = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y); const i = (y * W + x) * 4;
    p.data[i] = v[0]; p.data[i + 1] = v[1]; p.data[i + 2] = v[2]; p.data[i + 3] = 255; } return PNG.sync.write(p); };
const wall = (x, y) => y >= 70 && y < 80;                       // a low wall across the front
const bin = (x, y) => x >= 80 && x < 90 && y >= 60 && y < 75;
const photo = png((x, y) => wall(x, y) ? [180, 60, 50] : bin(x, y) ? [30, 120, 40] : y >= 55 ? [120, 120, 120] : [200, 190, 180]);
const render = png((x, y) => y >= 55 ? [40, 40, 45] : [200, 190, 180]);   // everything below 55 paved charcoal
const at = (buf, x, y) => PNG.sync.read(buf).data[(y * W + x) * 4];

test('the wall and bin come back; the new paving around them stays', () => {
  const mask = png((x, y) => (wall(x, y) || bin(x, y)) ? [255, 255, 255] : [0, 0, 0]);
  const r = restoreInsideMask({ render, renderMime: 'image/png', original: photo, originalMime: 'image/png', mask, maskMime: 'image/png', fromYPct: 50 });
  assert.ok(r.restored, r.reason);
  assert.strictEqual(at(r.buffer, 50, 75), 180, 'wall is the photograph');
  assert.strictEqual(at(r.buffer, 85, 65), 30, 'bin is the photograph');
  assert.strictEqual(at(r.buffer, 30, 90), 40, 'the new driveway stays');
});

test('a keep mask that has swallowed the ground is refused', () => {
  const mask = png((x, y) => y >= 55 ? [255, 255, 255] : [0, 0, 0]);
  const r = restoreInsideMask({ render, renderMime: 'image/png', original: photo, originalMime: 'image/png', mask, maskMime: 'image/png', fromYPct: 50 });
  assert.strictEqual(r.restored, false);
  assert.match(r.reason, /that is the driveway/);
  assert.ok(KEEP_MAX_OF_GROUND <= 0.5);
});

test('nothing above the front door and nothing inside our windows is touched', () => {
  const mask = png(() => [255, 255, 255].map((v, i) => v)).toString ? png((x, y) => (wall(x, y) || (y < 40) || (x >= 10 && x < 20 && y >= 60 && y < 70)) ? [255, 255, 255] : [0, 0, 0]) : null;
  const r = restoreInsideMask({ render, renderMime: 'image/png', original: photo, originalMime: 'image/png', mask, maskMime: 'image/png',
    fromYPct: 50, ours: [{ x: 10, y: 58, w: 10, h: 14 }] });
  assert.ok(r.restored, r.reason);
  assert.strictEqual(at(r.buffer, 50, 20), 200, 'above the door: unchanged render');
  assert.strictEqual(at(r.buffer, 15, 65), 40, 'inside our window box: the render');
});

test('resin is described as bound and solid, never loose', () => {
  for (const st of catalogue.driveways.materials.find(m => m.id === 'resin-bound').styles) {
    assert.match(st.words, /no loose stones and no gravel/);
    assert.match(st.words, /fixed together in clear resin/);
  }
});

test('a driveway prompt holds walls, bins, railings and the house number by name', () => {
  const p = buildRenderPrompt({ driveway: { id: 'block-paving', name: 'Block Paving', words: d.promptWords('block-paving', 'bp-charcoal') } });
  assert.match(p, /Do not remove, move or rebuild any wall, fence, gate, railing, handrail, step, bin, car or plant/);
  assert.match(p, /the house number, door number, letterbox and any sign/);
  assert.match(p, /do not make it bigger/);
});
