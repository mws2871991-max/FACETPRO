'use strict';
/* Strategy handoff (9 Oct): the Facet Project Pack, and the installer
   pipeline New, Accepted, Survey booked, Quote submitted, Won/Lost. */
require('./helpers/data-dir');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const { foldOutcomes, report } = require('../accuracy');

test('a survey booking is a pipeline step, not an accuracy outcome', () => {
  const rows = [
    { leadId: 'L1', installerId: 'a', action: 'survey', surveyDate: '2026-10-20', ts: '2026-10-09T10:00:00Z' },
    { leadId: 'L1', installerId: 'a', action: 'quoted', amount: 9000, ts: '2026-10-21T10:00:00Z' },
  ];
  const f = foldOutcomes(rows, 'a');
  assert.strictEqual(f.L1.survey.date, '2026-10-20');
  assert.strictEqual(f.L1.quote.amount, 9000);
  assert.strictEqual(f.L1.result, undefined, 'a survey read as won or lost');
  const onlySurvey = foldOutcomes([rows[0]], 'a');
  assert.ok(!report([{ id: 'L1', glazing: { marketRange: { low: 8000, high: 12000 } } }], onlySurvey).rows.some(r => r.quoteVsEstimate), 'a survey counted as a quote');
});

test('every lead sits in exactly one pipeline stage', () => {
  const src = html.slice(html.indexOf('const PIPELINE = '), html.indexOf('function pipelineBar'));
  const { pipelineStage } = new Function(src + '; return { pipelineStage };')();
  const L = { id: 'X' };
  assert.strictEqual(pipelineStage(L, {}, {}), 'new');
  assert.strictEqual(pipelineStage(L, { X: { action: 'accept' } }, {}), 'accepted');
  assert.strictEqual(pipelineStage(L, { X: { action: 'accept' } }, { X: { survey: {} } }), 'survey');
  assert.strictEqual(pipelineStage(L, { X: { action: 'accept' } }, { X: { survey: {}, quote: {} } }), 'quoted');
  assert.strictEqual(pipelineStage(L, { X: { action: 'accept' } }, { X: { quote: {}, result: { outcome: 'won' } } }), 'won');
  assert.strictEqual(pipelineStage(L, { X: { action: 'pass' } }, {}), 'passed');
});

test('the project pack is built on the device from the figures the page shows', () => {
  const fn = html.slice(html.indexOf('function packHtml'), html.indexOf('function openProjectPack'));
  assert.match(fn, /publishedRange\(d\.g\)/);
  assert.match(fn, /Planning estimate · inc\. VAT · not a quotation/);
  assert.match(fn, /minimumApplied/, 'a small job would not add up');
  assert.doesNotMatch(html.slice(html.indexOf('function openProjectPack'), html.indexOf('function openProjectPack') + 1500), /fetch\(/, 'the pack uploads something');
  assert.match(html, /\['mount-pack', +buildPackCard\]/);
});

test('one "how we are paid" line in the quote form, not two', () => {
  const start = html.indexOf('function buildInstallerConsent');
  const fn = html.slice(start, html.indexOf('\n}\n', start));
  assert.doesNotMatch(fn, /howWePaid\(/);
});
