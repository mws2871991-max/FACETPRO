'use strict';
require('./helpers/data-dir');
/* Every saved live detection still counts the way a person looking at the
   photograph would. See test/fixtures/live/README.md. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const g = require('../glazing');

const dir = path.join(__dirname, 'fixtures', 'live');
const cases = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
/* Recorded before the folder existed. */
cases.push(
  { file: 'edwardian-14-oct4-detections.json', aspectRatio: 0.75, expected: { frontWindowCount: 4, frontBayCount: 2 }, detections: require('./fixtures/edwardian-14-oct4-detections.json').detections },
  { file: 'manningtree-oct4-detections.json', aspectRatio: 1.5, expected: { frontWindowCount: 5 }, detections: require('./fixtures/manningtree-oct4-detections.json').detections },
);

test('there is a library to protect', () => {
  assert.ok(cases.length >= 4);
});

for (const c of cases) {
  test(`${c.file}: counted as a person would`, () => {
    assert.ok(Array.isArray(c.detections) && c.detections.length, 'no detections saved');
    assert.ok(c.aspectRatio > 0, 'save the photo\'s aspect ratio with it');
    if ('frontWindowCount' in c.expected) assert.strictEqual(g.frontWindowCount(c.detections, c.aspectRatio), c.expected.frontWindowCount, 'windows');
    if ('frontBayCount' in c.expected) assert.strictEqual(g.frontBayCount(c.detections, c.aspectRatio), c.expected.frontBayCount, 'bays');
  });
}
