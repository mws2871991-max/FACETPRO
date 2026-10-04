'use strict';
require('./helpers/data-dir');
/* 0071: a small cellar light is not priced as a window. Manningtree house,
   live /api/detect on 4 Oct: 6 counted, 5 real. */
const { test } = require('node:test');
const assert = require('node:assert');
const g = require('../glazing');
const F = require('./fixtures/manningtree-oct4-detections.json').detections;

test('the Manningtree house is five windows: no fanlight, no cellar light', () => {
  assert.strictEqual(g.frontWindowCount(F), 5);
  assert.ok(!g.frontWindowBoxes(F).some(b => b.y > 85), 'the cellar light is not a priced window');
});

test('a full-size basement window is still a window', () => {
  const flat = F.map(d => d.label === 'Cellar Window' ? { ...d, y_pct: 80, w_pct: 9, h_pct: 15 } : d);
  assert.strictEqual(g.frontWindowCount(flat), 6);
});

test('with no word for it, a small pane low on the wall still goes', () => {
  const low = F.map(d => d.label === 'Cellar Window' ? { ...d, label: 'Small Window' } : d);
  assert.strictEqual(g.frontWindowCount(low), 5);
});
