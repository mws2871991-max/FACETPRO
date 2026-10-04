'use strict';
require('./helpers/data-dir');
/* 0061: Anthracite is RAL 7016, a dark grey — not navy. The swatch was
   #2B2D42 (blue 0x42 against red 0x2B), and the frame-colour correction
   pulls every frame towards the swatch, so anthracite frames came out navy
   in warm light (4 Oct, a red-brick house in evening sun). */
const { test } = require('node:test');
const assert = require('node:assert');
const catalogue = require('../catalogue.json');
const fs = require('fs');
const path = require('path');

const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

test('every anthracite swatch is a near-neutral dark grey', () => {
  const found = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.id === 'anthracite' && o.hex) found.push(o.hex); Object.values(o).forEach(walk); } };
  walk(catalogue);
  assert.ok(found.length >= 2);
  for (const hex of found) {
    const [r, g, b] = rgb(hex);
    assert.ok(Math.max(r, g, b) < 90, `${hex} is too light for anthracite`);
    assert.ok(b - r <= 12, `${hex} leans blue (b-r = ${b - r}); RAL 7016 does not`);
    assert.strictEqual(hex.toUpperCase(), '#383E42');
  }
});

test('the render is told grey, and told not navy', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'renderprompt.js'), 'utf8');
  assert.match(s, /anthracite: 'deep anthracite grey \(RAL 7016\)[^']*never navy or blue/);
  assert.doesNotMatch(s, /very dark blue-grey/);
});
