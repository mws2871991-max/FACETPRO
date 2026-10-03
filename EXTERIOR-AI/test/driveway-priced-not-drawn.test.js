'use strict';
require('./helpers/data-dir');
/* 0057: resin bound is priced but not drawn. It rendered as loose gravel on
   every attempt (illustration and real photos, two rounds of wording), and a
   picture of gravel beside a resin price shows the wrong product. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const d = require('../driveways');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('resin bound is not drawable; every other surface is', () => {
  assert.strictEqual(d.drawable('resin-bound'), false);
  for (const id of ['block-paving', 'tarmac', 'gravel', 'stone-setts', 'imprinted-concrete']) {
    assert.strictEqual(d.drawable(id), true, id);
  }
  assert.strictEqual(d.drawable('no-such-surface'), false);
});

test('resin bound is still offered and still priced', () => {
  const pub = d.publicSection();
  const resin = pub.materials.find(m => m.id === 'resin-bound');
  assert.ok(resin, 'still in the list');
  assert.strictEqual(resin.drawn, false);
  assert.match(resin.notDrawn, /price resin bound/);
  assert.match(resin.notDrawn, /loose gravel/);
  assert.match(resin.notDrawn, /as it is now/);
  assert.ok(!('perM2' in resin), 'rates stay off the page');
  const est = d.estimate({ materialId: 'resin-bound', sizeId: pub.sizes[1].id });
  assert.ok(est && est.low > 0 && est.high > est.low);
  assert.ok(!('drawn' in pub.materials.find(m => m.id === 'block-paving')));
});

test('the render leaves an undrawable surface out and says so', () => {
  const s = read('server.js');
  assert.match(s, /const drivewayNotDrawn = !!drivewayMaterial && !driveways\.drawable\(drivewayMaterial\.id\);/);
  assert.match(s, /const driveway = \(drivewayMaterial && !drivewayNotDrawn\) \?/, 'no driveway sentence and no keep mask');
  assert.match(s, /\.\.\.\(drivewayNotDrawn \? \{ drivewayNotDrawn: true \} : \{\}\)/);
});

test('the page says so before the render and on the picture', () => {
  const h = read('index.html');
  assert.match(h, /dwMat && dwMat\.drawn === false[\s\S]{0,200}dwMat\.notDrawn/);
  assert.match(h, /state\.drivewayNotDrawn = !!data\.drivewayNotDrawn;/);
  assert.match(h, /Your new driveway isn’t drawn on this picture — it shows your driveway as it is now\./);
  // A resin-only choice is not a change the picture can show, so it does not auto-render.
  const f = h.slice(h.indexOf('function hasDrawableChange()'), h.indexOf('function startAutoRender()'));
  assert.match(f, /m\.drawn !== false/);
});
