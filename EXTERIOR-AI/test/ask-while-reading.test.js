'use strict';
require('./helpers/data-dir');
/* 0062 put "what would you like to change?" in the analysis panel and made
   the first picture wait for the answer. Before that the question was only on
   the landing stage, below the uploader, and vanished on upload — the first
   picture was always our guess.

   Reversed on 5 October (Mike): "upload photo of your house … then see what
   new windows doors will look like … then what are you looking for". The
   question is right and its place was wrong — asked before the reveal it is a
   toll on the one thing they came for; asked after it, it is a conversation
   with somebody who has just seen their own house with new windows on it. So
   the picture no longer waits, and the question follows it. Who is asked at
   all has not changed. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the question comes after the picture, not during the reading', () => {
  assert.match(h, /triageInPanel\(\),\n\s*analysisPanel\(\),/);
  const f = h.slice(h.indexOf('function triageInPanel()'), h.indexOf('function buildTriage()'));
  assert.match(f, /if \(!triageAfterReveal\(\)\) return null;/, 'it is back to asking before the reveal');
  assert.match(f, /That’s your house\. What would you like us to price\?/);
  assert.match(f, /Not sure — show me ideas/);
  assert.match(f, /TRIAGE\.filter\(t => !t\.href\)/, 'the conservatory link stays out of the photo panel');
});

test('the reveal is what releases the question', () => {
  const f = h.slice(h.indexOf('function triageAfterReveal()'), h.indexOf('function buildTriage()'));
  assert.match(f, /awaitingTriage\(\) && !!state\.renderUrl && !!state\.revealed/,
    'a question that shows before the picture is the toll this removed');
});

test('nobody who has already said is asked again', () => {
  const f = h.slice(h.indexOf('function awaitingTriage()'), h.indexOf('function releaseFirstPicture()'));
  for (const k of ['!state.journey', '!state.triageAnswered', '!state.resumedDesign', '!state.conservatoryIntent', '!!state.uploadedImg']) assert.ok(f.includes(k), k);
});

test('neither automatic first picture waits for the answer', () => {
  /* The whole point of the reversal: the picture is what they came for and it
     goes as soon as it can. */
  for (const fn of ['function startAutoRender()', 'function maybeAutoRender()']) {
    const body = h.slice(h.indexOf(fn), h.indexOf(fn) + 400);
    assert.doesNotMatch(body, /if \(awaitingTriage\(\)\) return;/, `${fn} is holding the picture again`);
  }
});

test('nothing times the question out before the picture arrives', () => {
  /* The bug this shipped on 5 October. The twenty-second timer set
     triageTimedOut, awaitingTriage() read it, and triageAfterReveal() depends
     on awaitingTriage() — so with a render taking 25-30s the timer always
     fired first and the question could never appear. Reported from both the
     desktop and the phone walk the same day. A question that waits for the
     picture cannot also expire before it. */
  /* Code only. index.html ships its comments to the browser, and the note
     explaining this removal necessarily names the thing it removed — the same
     trap the legal-placeholder guard fell into twice. */
  const code = h.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /triageTimedOut/, 'the timeout that suppressed the question is back');
  assert.doesNotMatch(code, /TRIAGE_WAIT_MS/, 'a timer on a question that follows the picture can only kill it');
});

test('an answer still applies the journey and renders it', () => {
  const a = h.slice(h.indexOf('async function answerTriage('), h.indexOf('function triageInPanel()'));
  assert.match(a, /state\.triageAnswered = true;/);
  assert.match(a, /await applyJourney\(id\);/);
  assert.match(a, /releaseFirstPicture\(\)/);
  const r = h.slice(h.indexOf('function releaseFirstPicture()'), h.indexOf('async function answerTriage('));
  assert.match(r, /maybeAutoRender\(\); else startAutoRender\(\);/);
});

test('the page does not scroll the question away', () => {
  assert.match(h, /if \(!awaitingTriage\(\)\) document\.getElementById\('visualizer-section'\)\?\.scrollIntoView/);
});
