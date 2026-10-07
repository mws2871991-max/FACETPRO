'use strict';
/* Developer brief §6: the accuracy report's measures and segments, held to
   the sample rule (no percentages below MIN_FOR_SHARE, overall or per segment). */
require('./helpers/data-dir');
const { test } = require('node:test');
const assert = require('node:assert');
const acc = require('../accuracy');

const lead = (i, extra = {}) => ({ id: `LD-${i}`, postcode: i % 2 ? 'LS1 4AP' : 'SW11 1AA', price: 0,
  glazing: { range: { low: 9000, high: 11000 }, houseType: 'semi' }, project: { interests: ['windows'] }, property: { type: i % 3 ? 'semi' : 'detached' }, ...extra });

test('segments: jobs, postcode area, property type and size band', () => {
  const s = acc.segmentsOf(lead(1, { project: { interests: ['doors', 'windows', 'windows'] } }), { low: 9000, high: 11000 });
  assert.deepStrictEqual(s, { jobs: 'doors + windows', region: 'LS', property: 'semi', size: '£5k–£15k' });
  assert.deepStrictEqual(acc.segmentsOf({}, null), { jobs: 'not stated', region: 'unknown', property: 'unknown', size: 'unknown' });
});

test('±5/10/15% and the mean, only once the sample is big enough', () => {
  const N = acc.MIN_FOR_SHARE;
  const leads = Array.from({ length: N }, (_, i) => lead(i));
  // Middle of every range is 10,000: quotes at 10,000 (0%), 10,800 (8%), 11,400 (14%), 12,000 (20%).
  const amounts = [10000, 10800, 11400, 12000];
  const outcomes = Object.fromEntries(leads.map((l, i) => [l.id, { quote: { amount: amounts[i % 4], surveyed: true } }]));
  const r = acc.report(leads, outcomes);
  assert.strictEqual(r.quotes.n, N);
  assert.ok(r.quotes.within5PctShare > 20 && r.quotes.within5PctShare < 30);
  assert.ok(r.quotes.within10PctShare > r.quotes.within5PctShare && r.quotes.within15PctShare > r.quotes.within10PctShare);
  assert.ok(r.quotes.meanAbsPctFromMiddle > 9 && r.quotes.meanAbsPctFromMiddle < 12);
  // Each region holds half the sample — under the threshold, so counts only.
  assert.strictEqual(r.segments.region.LS.quotes.n, N / 2);
  assert.strictEqual(r.segments.region.LS.quotes.within10PctShare, null);
  assert.match(r.segments.region.LS.quotes.note, /shares are shown from/);
});

test('a small sample publishes nothing as a percentage', () => {
  const r = acc.report([lead(1)], { 'LD-1': { quote: { amount: 10000 } } });
  assert.strictEqual(r.quotes.within5PctShare, null);
  assert.strictEqual(r.quotes.meanAbsPctFromMiddle, null);
});
