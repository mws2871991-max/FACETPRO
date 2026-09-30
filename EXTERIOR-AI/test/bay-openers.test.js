'use strict';
require('./helpers/data-dir');
/* A bay's price already has its two openers in it (Mike, 30 September 2026),
   so the opener answer must not be added to it again. */
const { test } = require('node:test');
const assert = require('node:assert');
const glazing = require('../glazing');
const catalogue = require('../catalogue.json');

const job = (style, openerCount) => glazing.estimateGlazing({
  rates: catalogue.glazing, houseType: 'semi', windowCountOverride: 4,
  selections: { windowStyleId: style, doorStyleId: 'none' }, openerCount,
}).price;

test('the opener answer does not change a bay', () => {
  assert.strictEqual(job('bay', 3).total, job('bay', undefined).total);
  assert.strictEqual(job('bay', 0).total, job('bay', undefined).total);
});

test('the opener answer still changes ordinary windows', () => {
  assert.ok(job('casement', 3).total > job('casement', undefined).total);
  assert.ok(job('casement', 0).total < job('casement', undefined).total);
});
