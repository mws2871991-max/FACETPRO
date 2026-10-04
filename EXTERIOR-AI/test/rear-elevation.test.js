/* Reading the back of a house is a different question from reading the front.

   The front prompt hunts a pedestrian front door as a 1.98 m scale reference,
   reads the left and right edges for gap/shared/cut-off, and names a house
   type from them. A garden shot answers none of those, so the back gets its
   own prompt — and, just as importantly, its own reply: reporting a house
   type or a scale reference it never looked for would be inventing them, and
   a houseType guessed from a garden would overwrite a good front reading.

   Unit tests on the pieces, not the endpoint: the endpoint needs a live
   Anthropic call, and what can go wrong here is the wiring rather than the
   model. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('the back gets its own prompt, not the front one reworded', () => {
  assert.match(source, /const REAR_PROMPT = /, 'there is no rear prompt');
  const start = source.indexOf('const REAR_PROMPT = ');
  const prompt = source.slice(start, source.indexOf('`;', start));

  /* What a back actually has. */
  for (const want of ['door-rear', 'door-patio', 'conservatory', 'extension']) {
    assert.ok(prompt.includes(`"${want}"`), `the rear prompt never asks for ${want}`);
  }

  /* What it must not ask for, because the back cannot answer it. */
  assert.ok(!prompt.includes('door-front'), 'the rear prompt hunts a front door');
  assert.ok(!/gap\|shared\|cut-off/.test(prompt), 'the rear prompt reads the sides');
  assert.ok(!/houseType/.test(prompt), 'the rear prompt names a house type from a garden');
  assert.ok(!/1\.98/.test(prompt), 'the rear prompt claims a front door’s scale');

  /* A count, checkable by the homeowner, rather than a measurement nobody
     can check — a patio door and a bifold are not 1.98 m. */
  assert.match(prompt, /as ONE window/i, 'panes in one opening are not grouped');
});

test('an unknown elevation reads as the front', () => {
  /* It must not refuse and must not guess: anything unrecognised gets the
     reading the whole product already does. */
  const line = source.match(/const elevation = [^\n]*/)[0];
  /* 0084 added 'side'; anything else still falls to the front. */
  assert.match(line, /'rear'\s*\?\s*'rear'\s*:\s*elevRaw === 'side'\s*\?\s*'side'\s*:\s*'front'/,
    'an unrecognised elevation does not fall back to the front');
});

test('the same photograph is cached separately per elevation', () => {
  /* The cache answers from the bytes. Read as a front and as a back they are
     two different answers, so one key would hand the front's reading back for
     the rear, out of cache, with nothing to show a call was never made. */
  const fp = source.slice(source.indexOf('function imageFingerprint'));
  const body = fp.slice(0, fp.indexOf('\n}'));
  assert.match(body, /elevation/, 'the fingerprint ignores the elevation');
  assert.match(body, /DETECTION_VERSION\}:\$\{elevation\}/,
    'the elevation is not part of the cache key');
});

test('the rear reply omits every front-only finding', () => {
  const at = source.indexOf("if (elevation === 'rear' || elevation === 'side')");
  assert.ok(at > 0, 'the rear has no reply of its own');
  const reply = source.slice(at, source.indexOf('  }', at));

  assert.match(reply, /rearWindowCount/, 'the back reports no window count');
  assert.match(reply, /rearDoorCount/, 'a back or patio door is priced, and is not reported');
  /* The four the back never looked for. houseType matters most: guessed from
     a garden it would overwrite a good front reading. */
  assert.ok(!/houseType:/.test(reply), 'the rear reply claims a house type');
  assert.ok(!/subjectBox:/.test(reply), 'the rear reply claims a subject box');
  assert.match(reply, /canMeasure: false/, 'the rear claims it can measure');
  assert.match(reply, /scaleReference: false/, 'the rear claims a scale reference');
});

/* ── Which counts came from a photograph ── */

test('the back count carries where it came from', () => {
  /* The number alone is not the whole answer. A count read from a photograph
     and a count somebody typed are different evidence, and an installer
     pricing the job should be told which they are quoting against.

     Three states, not two: absent means they never answered, which is not the
     same as zero — zero is "just the front", a real answer. */
  const resume = require('../resume');

  const fromPhoto = resume.buildPayload({ backCount: 5, backCountSource: 'photo' });
  assert.strictEqual(fromPhoto.backCount, 5);
  assert.strictEqual(fromPhoto.backCountSource, 'photo');

  const told = resume.buildPayload({ backCount: 4, backCountSource: 'told' });
  assert.strictEqual(told.backCountSource, 'told');

  /* Zero survives as an answer rather than being dropped as falsy. */
  const none = resume.buildPayload({ backCount: 0, backCountSource: 'told' });
  assert.strictEqual(none.backCount, 0);

  /* Never answered stays never answered. */
  const unanswered = resume.buildPayload({ claddingId: 'alabaster' });
  assert.ok(!('backCount' in unanswered));
  assert.ok(!('backCountSource' in unanswered));

  /* And it is an allowlisted id, not free text riding into a stored record. */
  const junk = resume.buildPayload({ backCount: 5, backCountSource: '<script>alert(1)</script>' });
  assert.ok(!('backCountSource' in junk), 'free text reached the saved design');
});

test('the lead tells the installer which counts are photographs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = source.indexOf('const backCountSource =');
  assert.ok(at > 0, 'the lead does not say where the counts came from');
  const block = source.slice(at, at + 2600);

  assert.match(block, /'not priced'/, 'an unanswered back is not distinguished');
  assert.match(block, /counts: \{ front: frontSource, backAndSides: backCountSource \}/,
    'the lead summary does not carry the counts');

  /* The front is a photograph only when one actually read it and the
     homeowner did not correct it. It was hardcoded to 'photo', which said so
     over a house-type prior — no photograph involved — and over a count they
     had typed themselves. Certifying either to an installer is the exact
     thing this field exists to prevent. */
  const front = source.slice(source.indexOf('const frontSource ='), source.indexOf('const frontSource =') + 320);
  assert.match(front, /summary\.frontTold \? 'told'/, 'a corrected front is still called a photograph');
  assert.match(front, /photo_door' \|\| summary\.countSource === 'photo_count'/, 'the front source ignores how it was read');
  assert.match(front, /'estimated'/, 'a house-type prior is not distinguished from a photograph');

  /* Derived server-side, like the price. A client that can set the number
     must not also be the thing that certifies where it came from. */
  assert.match(block, /body\.backCountSource === 'photo' \? 'photo' : 'told'/,
    'the source is taken from the client without being narrowed');
});

/* ── From a code review of 27 September ── */

test('a cached reading answers in the shape of the elevation it read', () => {
  /* answer() always replied in the front's shape — frontWindowCount,
     houseType, subjectBox — whatever the record held. A rear photograph
     served from cache therefore came back with no rearWindowCount, the page
     did Number(undefined), and the homeowner was told "We couldn't find any
     windows in that photo" about one that had been read fine a minute
     earlier. Reachable by re-adding the same rear photo after replacing the
     front one. */
  const at = source.indexOf('const answer = (record, id) =>');
  assert.ok(at > 0, 'the cache reply helper has gone');
  const helper = source.slice(at, at + 900);
  assert.match(helper, /record\.elevation === 'rear'/, 'the cached reply ignores the elevation');
  assert.match(helper, /rearWindowCount/, 'a cached rear reading carries no count');

  /* And the record rebuilt from the persistent cache has to remember which
     face it was, or the next reply is wrong for the same reason. */
  assert.match(source, /stored\.aspectRatio \|\| stored\.aspectRatio !== null[\s\S]{0,120}elevation\)|height: 1 \} : null, elevation\)/,
    'a record rebuilt from cache forgets its elevation');
});

test('a rear reading can be cached at all', () => {
  /* cacheComplete asked for houseType unconditionally, and the rear analysis
     has none and never will. So no rear reading could ever be served from the
     persistent cache: every rear photograph paid for a fresh Anthropic call
     and a slot of the shared fifty-a-day detect budget the front funnel
     depends on, and the log claimed the cache "predates the house-type field"
     every single time. */
  const at = source.indexOf('const cacheComplete =');
  const block = source.slice(at, at + 200);
  assert.match(block, /elevation !== 'front' \|\| 'houseType' in cachedAnalysis/,
    'the rear is still judged incomplete for lacking a front-only field');
});

test('answering the back question is not the same as correcting a count', () => {
  /* count_corrected means "the number we showed was not believed". The first
     answer to the back-and-sides question is not that — nothing was shown to
     disbelieve — so it turned the one measure of whether the count is trusted
     into a measure of how many people answered a question. */
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const at = page.indexOf('const setBack = (n, touched = true)');
  const body = page.slice(at, at + 900);
  assert.match(body, /const wasAnswered = state\.backCount !== null/,
    'the first answer is still recorded as a correction');
  assert.match(body, /if \(wasAnswered\) reachedStage\('count_corrected'\)/,
    'count_corrected fires unconditionally');
});

test('a back count the homeowner adjusted is not certified as a photograph', () => {
  /* A count read as 3 and stepped to 5 is two windows they added. Telling an
     installer the whole figure came from a photograph is the over-claim this
     field exists to prevent. */
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const hits = page.match(/state\.backFromPhoto && state\.backCount === state\.backPhotoCount\) \? 'photo' : 'told'/g) || [];
  assert.strictEqual(hits.length, 3,
    `all three send sites must narrow the claim; ${hits.length} do`);
});
