'use strict';
require('./helpers/data-dir');
/* Roof prices checked against 2026 UK guides (6 Oct): roof area 0.76 of wall
   area, scaffolding by house size, strip-out of the old roof, slate and clay
   material rates put back to all-in figures the guides support. */
const { test } = require('node:test');
const assert = require('node:assert');
const catalogue = require('../catalogue.json');
const { scaffoldingFor } = require('../scaffold');

test('scaffolding scales with the house: terrace, semi, detached', () => {
  assert.strictEqual(scaffoldingFor(catalogue, 50), 800);
  assert.strictEqual(scaffoldingFor(catalogue, 85), 1238);
  assert.strictEqual(scaffoldingFor(catalogue, 130), 1800);
  assert.strictEqual(scaffoldingFor(catalogue, 20), 800, 'never below the base');
  assert.strictEqual(scaffoldingFor(catalogue, 400), catalogue.scaffolding.max, 'capped');
});

test('a semi\'s roof is the size the guides price it on', () => {
  const ratio = catalogue.wholeHouse.roofAreaFromWall;
  assert.strictEqual(Math.round(85 * ratio), 65, 'Checkatrade 64 m², Homebuilding & Renovating 65 m²');
  assert.ok(catalogue.roofStripPerM2 > 0, 'stripping the old roof is priced');
});

test('a concrete-tile re-roof on a semi lands near the guides\' £10k–£15k', () => {
  const roof = catalogue.roof.find(r => r.id === 'charcoal-roof');
  const m2 = 85 * catalogue.wholeHouse.roofAreaFromWall;
  const net = (roof.pricePerM2 + catalogue.labour.roofPerM2 + catalogue.roofStripPerM2) * m2
    + roof.pricePerM2 * m2 * catalogue.wastePct + scaffoldingFor(catalogue, 85);
  const inc = net * (1 + catalogue.vatPct);
  assert.ok(inc > 10000 && inc < 15000, `£${Math.round(inc)}`);
});
