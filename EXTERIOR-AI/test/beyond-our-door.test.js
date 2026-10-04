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

/* 0067: the live run that priced number 14 at 3. The door box landed to one
   side of the window above it, so the window looked wholly beyond the door. */
test('a window over our own door is ours even when the door box drifts sideways', () => {
  const at = x => F.map(d => d.type === 'door-front' ? { ...d, x_pct: x } : d);
  /* The window over the door runs 30.2 to 40.0. Door boxes starting at 40.5
     to 44 leave it clear of the door's edge — the 0063 rule took it. */
  for (const x of [40.5, 42.5, 44]) {
    assert.strictEqual(g.frontWindowCount(at(x)), 4, `door at ${x}: still four windows`);
    assert.ok(g.frontWindowBoxes(at(x)).some(b => Math.abs(b.x - 30.2) < 0.01), `door at ${x}: the window above it stays ours`);
    assert.ok(g.neighbourWindowBoxes(at(x)).some(b => Math.abs(b.x - 12.2) < 0.01), `door at ${x}: number 12's sash is still next door's`);
  }
});

test('a window beside the door, not over it, is not exempt', () => {
  /* Same gap, but level with the door rather than above it. */
  const beside = F.map(d => d.type === 'door-front' ? { ...d, x_pct: 42.5, y_pct: 20 } : d);
  assert.ok(!g.frontWindowBoxes(beside).some(b => Math.abs(b.x - 30.2) < 0.01));
});

test('a window a full door width away is still next door\'s', () => {
  assert.strictEqual(g.frontWindowCount(F), 4);
  assert.ok(g.neighbourWindowBoxes(F).some(b => Math.abs(b.x - 12.2) < 0.01));
});

/* 0079: the dev's number 14 still read 3 after 0067 — on that run the
   window over our own door carried a neighbour's word in its label, and the
   label rule (disowned) took it before the layout rule was asked. */
test('a window over our own door is ours even when its label says neighbour', () => {
  for (const label of ['Neighbour window (right of pair)', 'Adjacent house window', 'Next-door first floor window']) {
    const v = F.map(d => d.label === 'First Floor Window (right of pair)' ? { ...d, label } : d);
    assert.strictEqual(g.frontWindowCount(v), 4, label);
    assert.ok(g.frontWindowBoxes(v).some(b => Math.abs(b.x - 30.2) < 0.01), `${label}: kept`);
  }
});

test('a neighbour-labelled window that is NOT over our door is still next door\'s', () => {
  const v = F.map(d => d.label === 'First Floor Window (left)' ? { ...d, label: 'Neighbour window' } : d);
  assert.ok(g.neighbourWindowBoxes(v).some(b => Math.abs(b.x - 12.2) < 0.01));
  assert.strictEqual(g.frontWindowCount(v), 4);
});
