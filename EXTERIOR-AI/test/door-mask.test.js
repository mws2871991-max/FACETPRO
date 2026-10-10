'use strict';
require('./helpers/data-dir');
/* The kept front door is put back over detection's box joined to the door's
   segmented outline (10 Oct): detection's box was sometimes low, and only the
   bottom of the door came back with its glass missing. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { doorWithMask } = require('../hold');

const det = { x: 60, y: 40, w: 12, h: 15 };   // detection's box, too low

test('a door outline near detection\'s box widens the restore to cover both', () => {
  const r = doorWithMask(det, [{ x_pct: 59.6, y_pct: 35, w_pct: 12.5, h_pct: 15 }]);
  assert.strictEqual(r.y, 35, 'reaches up to the real top of the door');
  assert.strictEqual(r.y + r.h, 55, 'and still down to where detection put the bottom');
  assert.ok(r.x <= 59.6 && r.x + r.w >= 72.1);
});

test('specks and doors elsewhere are ignored', () => {
  assert.deepStrictEqual(doorWithMask(det, [{ x_pct: 61, y_pct: 41, w_pct: 0.4, h_pct: 0.6 }]), det, 'a speck is not a door');
  assert.deepStrictEqual(doorWithMask(det, [{ x_pct: 5, y_pct: 40, w_pct: 10, h_pct: 15 }]), det, 'the neighbour\'s door, across the picture');
});

test('no detection door, no restore — the outline alone is not trusted', () => {
  assert.strictEqual(doorWithMask(null, [{ x_pct: 60, y_pct: 35, w_pct: 12, h_pct: 15 }]), null);
});

test('wired: started at upload, joined in the render', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /prepareDoorMask\(detectionRecords\.get\(detectionId\), elevation\);/);
  assert.match(server, /restoreDoor\(\{ render: bytes, \.\.\.common, maskBoxes: dm \?/);
});
