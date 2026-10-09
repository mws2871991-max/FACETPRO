'use strict';
require('./helpers/data-dir');
/* Roof lights are not part of a windows job (9 Oct). A semi with two Velux-
   type lights was priced on five front windows where it has four: the two
   lights were merged into one "small upstairs window". Detections are the
   live ones from that photograph, rounded. */
const { test } = require('node:test');
const assert = require('node:assert');
const glazing = require('../glazing');

const DETECTIONS = [
  { type: 'roof', label: 'Main Roof', confidence: 0.93, x_pct: 34, y_pct: 5, w_pct: 52, h_pct: 14 },
  { type: 'window', label: 'Roof Light (left)', confidence: 0.7, x_pct: 46.2, y_pct: 11.8, w_pct: 3.6, h_pct: 2 },
  { type: 'window', label: 'Roof Light (right)', confidence: 0.72, x_pct: 51, y_pct: 11, w_pct: 6.3, h_pct: 2.3 },
  { type: 'window', label: 'First Floor Bay Window', confidence: 0.9, x_pct: 41.5, y_pct: 18.6, w_pct: 13.5, h_pct: 9 },
  { type: 'window', label: 'First Floor Window (right)', confidence: 0.9, x_pct: 60.5, y_pct: 19.2, w_pct: 9.5, h_pct: 7.2 },
  { type: 'window', label: 'Ground Floor Bay Window', confidence: 0.88, x_pct: 38.8, y_pct: 35.2, w_pct: 15.5, h_pct: 11.5 },
  { type: 'window', label: 'Porch Extension Window', confidence: 0.9, x_pct: 83, y_pct: 35.4, w_pct: 10.5, h_pct: 8 },
  { type: 'door-front', label: 'Front Door', confidence: 0.95, x_pct: 59, y_pct: 35, w_pct: 13, h_pct: 14 },
];

test('roof lights are neither counted nor repainted', () => {
  const boxes = glazing.frontWindowBoxes(DETECTIONS, 0.75);
  assert.strictEqual(boxes.length, 4, 'two bays, the upstairs window and the extension window');
  assert.ok(boxes.every(b => b.y > 15), 'nothing up in the roof');
});

test('every way the model names one is caught, and a dormer is still a window', () => {
  for (const label of ['Roof Light', 'Rooflight', 'Roof-light (left)', 'Skylight', 'Sky light', 'Velux window', 'Roof Window', 'roof windows'])
    assert.strictEqual(glazing.frontWindowBoxes([{ ...DETECTIONS[1], label }, ...DETECTIONS.slice(3)], 0.75).length, 4, label);
  const dormer = { type: 'window', label: 'Dormer Window', confidence: 0.9, x_pct: 48, y_pct: 9, w_pct: 8, h_pct: 5 };
  assert.strictEqual(glazing.frontWindowBoxes([...DETECTIONS, dormer], 0.75).length, 5, 'the dormer counts');
});
