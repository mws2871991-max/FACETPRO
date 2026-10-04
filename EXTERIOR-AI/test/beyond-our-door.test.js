'use strict';
require('./helpers/data-dir');
/* 0063: on a terrace, a window wholly beyond our own door (on the far side
   from the bay, against a party wall) is next door's. Number 14, 4 Oct:
   number 12's door was not detected and its sash was counted. */
const { test } = require('node:test');
const assert = require('node:assert');
const g = require('../glazing');
const F = require('./fixtures/edwardian-14-oct4-detections.json').detections;

test('number 14 is four windows even when number 12\'s door is not seen', () => {
  assert.strictEqual(F.filter(d => d.type === 'door-front').length, 1, 'fixture must have only our door');
  assert.strictEqual(g.frontWindowCount(F), 4);
  assert.strictEqual(g.frontBayCount(F), 2);
  const notOurs = g.neighbourWindowBoxes(F);
  assert.ok(notOurs.some(b => Math.abs(b.x - 12.2) < 0.01), "number 12's sash is held as not ours, so the render will not repaint it");
});

test('the window over our own door stays ours', () => {
  const kept = g.frontWindowBoxes(F);
  assert.ok(kept.some(b => Math.abs(b.x - 30.2) < 0.01));
});

test('not on a detached house, and not with bays both sides', () => {
  const detached = F.map(d => d.type === 'analysis' ? { ...d, sides: { left: 'detached', right: 'detached' } } : d);
  assert.strictEqual(g.frontWindowCount(detached), 5, 'no party wall on that side: left alone');
  const noSides = F.filter(d => d.type !== 'analysis');
  assert.strictEqual(g.frontWindowCount(noSides), 5, 'no reading of the sides: left alone');
  const doubleFronted = [...F, { type: 'window', label: 'Bay Window Left', x_pct: 5, y_pct: 50, w_pct: 20, h_pct: 20, confidence: 0.9 }];
  assert.ok(g.frontWindowCount(doubleFronted) >= 5, 'bays on both sides of the door: left alone');
});
