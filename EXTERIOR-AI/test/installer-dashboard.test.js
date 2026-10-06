'use strict';
require('./helpers/data-dir');
/* The installer's own dashboard (developer brief, 6 Oct, §16): counts and
   rates from their leads, decisions and recorded outcomes. The summary is a
   pure function in index.html; it is lifted out and run here. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.slice(html.indexOf('function summariseInstallerLeads'), html.indexOf('function installerDashboard'));
const summarise = new Function(`${src}; return summariseInstallerLeads;`)();

const NOW = Date.parse('2026-10-06T12:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const est = (lead) => lead.est || null;

const leads = [
  { id: 'A', ts: day(2), leadScore: { score: 80 }, est: { low: 8000, high: 12000 } },
  { id: 'B', ts: day(10), leadScore: { score: 60 }, est: { low: 5000, high: 9000 } },
  { id: 'C', ts: day(45), leadScore: { score: 40 }, est: { low: 2000, high: 4000 } },
  { id: 'D', ts: day(1) },
];
const decisions = { A: { action: 'accept' }, B: { action: 'accept' }, C: { action: 'pass' } };
const outcomes = {
  A: { quote: { amount: 9500 }, result: { outcome: 'won', amount: 9200 } },
  B: { quote: { amount: 9800 }, result: { outcome: 'lost' } },
};

test('the dashboard counts what the installer did with their leads', () => {
  const s = summarise({ leads, decisions, outcomes, estimateOf: est, now: NOW });
  assert.strictEqual(s.received, 4);
  assert.strictEqual(s.last30, 3, 'C is 45 days old');
  assert.deepStrictEqual([s.awaiting, s.accepted, s.passed], [1, 2, 1]);
  assert.deepStrictEqual([s.quoted, s.won, s.lost], [2, 1, 1]);
  assert.strictEqual(s.wonValue, 9200);
  assert.strictEqual(s.averageScore, 60, 'D has no score and is left out');
  assert.deepStrictEqual(s.projectValue, { low: 15000, high: 25000 });
  assert.deepStrictEqual(s.quoteVsEstimate, { inside: 1, above: 1, below: 0 }, 'B quoted 9,800 against 5,000–9,000');
  assert.deepStrictEqual([s.acceptRate, s.quoteRate, s.winRate], [67, 100, 50]);
});

test('no rate is invented from nothing', () => {
  const s = summarise({ leads: [], estimateOf: est, now: NOW });
  assert.deepStrictEqual([s.acceptRate, s.quoteRate, s.winRate, s.averageScore], [null, null, null, null]);
});

test('only an installer sees it, and small samples are shown as counts', () => {
  assert.match(html, /\(state\.installerScope === 'installer' && state\.leads\.length\)\s*\? installerDashboard\(summariseInstallerLeads\(/);
  const ui = html.slice(html.indexOf('function installerDashboard'), html.indexOf('function renderInstallerOnly'));
  assert.match(ui, /`\$\{n\} of \$\{of\}\$\{of >= 5 && pct !== null \? ` · \$\{pct\}%` : ''\}`/, 'a share only from five up');
});
