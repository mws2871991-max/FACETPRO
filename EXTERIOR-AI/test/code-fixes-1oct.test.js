/* The code-fix list from the 1 October run-through. */
'use strict';
require('./helpers/data-dir');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const catalogue = require('../catalogue.json');
const landing = require('../landing');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('records around leads age out: older rows go, newer ones stay', async () => {
  const old = new Date(Date.now() - 800 * 86400000).toISOString();
  const recent = new Date().toISOString();
  await store.append('deliveries', { ts: old, leadId: 'OLD', delivered: 1, failed: 0, results: [] });
  await store.append('deliveries', { ts: recent, leadId: 'NEW', delivered: 1, failed: 0, results: [] });
  const cutoff = new Date(Date.now() - 730 * 86400000).toISOString();
  const removed = await store.pruneOlderThan('deliveries', cutoff);
  assert.ok(removed >= 1);
  const ids = (await store.readAll('deliveries')).map(r => r.leadId);
  assert.ok(!ids.includes('OLD') && ids.includes('NEW'));
});

test('retention sweeps every table it promises, on their own clocks', () => {
  const server = read('server.js');
  for (const t of ['deliveries', 'leadResponses', 'notificationFailures', 'withdrawals', 'leadEvents']) {
    assert.ok(server.includes(`['${t}', retention.PERIODS.`), t);
  }
  assert.match(server, /store\.pruneDetectionCache\(DETECTION_CACHE_MS\)/);
});

test('a standard aluminium window prices at exactly Mike’s £1,904', () => {
  const g = catalogue.glazing;
  const alu = g.materials.find(m => m.id === 'aluminium').multiplier;
  const std = g.windowBands.find(b => b.id === 'standard').supplyFit;
  assert.strictEqual(Math.round(std * alu * (1 + g.vatPct / 100)), 1904);
});

test('the aluminium guide says "a little over twice", not "117% more"', () => {
  const page = landing.COST_PAGES.find(p => p.slug === 'aluminium-window-prices');
  const built = JSON.stringify(page.build(catalogue));
  assert.match(built, /a little over twice the price of/);
  assert.doesNotMatch(built, /\d{3}% more/);
});

test('/design has a top heading and no duplicated ids', () => {
  const html = read('index.html');
  assert.match(html, /<h2 data-page="design" id="design-heading"/);
  assert.match(html, /design: 'design-heading'/);
  assert.ok(!/h\('div', \{ id: 'mount-(choose|triage)'/.test(html));
});

test('/investors limits wrong passwords; /healthz checks the database', () => {
  const server = read('server.js');
  assert.match(server, /requireInvestorPassword: \[investorLimiter, requireInvestorPassword\]/);
  assert.match(server, /skipSuccessfulRequests: true/);
  assert.match(server, /store\.ping\(\)/);
});

test('contrast and tap targets: After label and guide footer links', () => {
  assert.match(read('index.html'), /bg-emerald-700 text-white font-semibold">After</);
  assert.match(read('assets/landing.css'), /footer\.site \.wrap>a\{display:inline-block;padding:12px 2px;min-height:44px\}/);
});
