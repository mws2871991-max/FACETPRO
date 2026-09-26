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
  assert.match(line, /'rear'\s*\?\s*'rear'\s*:\s*'front'/,
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
  const at = source.indexOf("if (elevation === 'rear')");
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
