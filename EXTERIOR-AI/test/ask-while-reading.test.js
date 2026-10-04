'use strict';
require('./helpers/data-dir');
/* 0062: "what would you like to change?" is asked while the photo is read,
   and the first picture waits for the answer (or TRIAGE_WAIT_MS). Before,
   the question was only on the landing stage, below the uploader, and
   vanished on upload — the first picture was always our guess. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the question sits in the analysis panel while it is unanswered', () => {
  assert.match(h, /triageInPanel\(\),\n\s*analysisPanel\(\),/);
  const f = h.slice(h.indexOf('function triageInPanel()'), h.indexOf('function buildTriage()'));
  assert.match(f, /if \(!awaitingTriage\(\)\) return null;/);
  assert.match(f, /While we read your house — what would you like to change\?/);
  assert.match(f, /Not sure — show me ideas/);
  assert.match(f, /TRIAGE\.filter\(t => !t\.href\)/, 'the conservatory link stays out of the photo panel');
});

test('nobody who has already said is asked again', () => {
  const f = h.slice(h.indexOf('function awaitingTriage()'), h.indexOf('function releaseFirstPicture()'));
  for (const k of ['!state.journey', '!state.triageAnswered', '!state.resumedDesign', '!state.conservatoryIntent', '!triageTimedOut', '!!state.uploadedImg']) assert.ok(f.includes(k), k);
});

test('both automatic first pictures wait for the answer', () => {
  for (const fn of ['function startAutoRender()', 'function maybeAutoRender()']) {
    const body = h.slice(h.indexOf(fn), h.indexOf(fn) + 400);
    assert.match(body, /if \(awaitingTriage\(\)\) return;/, fn);
  }
});

test('an answer or the wait releases the first picture', () => {
  assert.match(h, /var TRIAGE_WAIT_MS = 20000;/);
  const a = h.slice(h.indexOf('async function answerTriage('), h.indexOf('function triageInPanel()'));
  assert.match(a, /state\.triageAnswered = true;/);
  assert.match(a, /await applyJourney\(id\);/);
  assert.match(a, /releaseFirstPicture\(\)/);
  assert.match(h, /triageTimedOut = true; render\(\); releaseFirstPicture\(\);/);
  const r = h.slice(h.indexOf('function releaseFirstPicture()'), h.indexOf('async function answerTriage('));
  assert.match(r, /maybeAutoRender\(\); else startAutoRender\(\);/);
});

test('the page does not scroll the question away', () => {
  assert.match(h, /if \(!awaitingTriage\(\)\) document\.getElementById\('visualizer-section'\)\?\.scrollIntoView/);
});
