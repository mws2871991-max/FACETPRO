/* Two ways the store used to lose things, and one way the paid endpoints used
   to take the client's word for what they were being sent.

   Both matter beyond ordinary correctness. Losing a consent record destroys
   the evidence of the lawful basis for everything already done with that
   person's details. Losing a withdrawal means processing carries on after
   somebody asked us to stop. And an unvalidated upload is arbitrary content
   pushed through the Anthropic and Replicate keys — the daily caps bound how
   much of that happens, not what it is. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const measure = require('../measure');

/* ── what the bytes actually are ── */

const png = (w = 100, h = 50) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const gif = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.from([200, 0, 100, 0]), Buffer.alloc(20)]);
const jpeg = (w = 800, h = 600) => {
  const b = Buffer.alloc(40, 0);
  b[0] = 0xff; b[1] = 0xd8;                       // SOI
  b[2] = 0xff; b[3] = 0xc0;                       // SOF0
  b.writeUInt16BE(17, 4);                         // segment length
  b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9);
  return b;
};

test('a real image is recognised, with its format', () => {
  assert.deepStrictEqual(measure.sniffImage(png()), { mime: 'image/png', width: 100, height: 50 });
  assert.deepStrictEqual(measure.sniffImage(gif()), { mime: 'image/gif', width: 200, height: 100 });
  assert.strictEqual(measure.sniffImage(jpeg()).mime, 'image/jpeg');
});

test('anything else is not', () => {
  for (const bad of [
    Buffer.from('<?php system($_GET["c"]); ?>'.repeat(4)),
    Buffer.from('{"just":"some json, padded out to a plausible length"}'),
    Buffer.alloc(64),                                  // zeroes
    Buffer.from('%PDF-1.7\n%âãÏÓ\nnot an image at all'),
    Buffer.alloc(4),                                   // too short to judge
  ]) {
    assert.strictEqual(measure.sniffImage(bad), null, bad.slice(0, 16).toString('latin1'));
  }
});

test('imageSize still answers the question it always did', () => {
  // It now delegates to the same header parsing, so the two cannot disagree
  // about whether something is an image.
  assert.deepStrictEqual(measure.imageSize(png(1200, 900)), { width: 1200, height: 900 });
  assert.strictEqual(measure.imageSize(Buffer.from('not an image, not even a little bit')), null);
});

/* ── one writer at a time ── */

const table = 'accessLog';                 // not leads: no test needs to fight over those
const reset = async () => { await store.replaceAll(table, []); };

test('a write landing mid-mutation is not lost', async () => {
  /* The bug: mutate used to be readAll() in the caller, then replaceAll() —
     so anything appended in between was overwritten by rows read before it
     existed. Here the append is fired while the transform is still running. */
  await reset();
  await store.append(table, { ts: 'A', endpoint: '/first' });

  const slowMutate = store.mutate(table, async (rows) => {
    await new Promise(r => setTimeout(r, 40));            // the window
    return [...rows, { ts: 'B', endpoint: '/from-mutate' }];
  });
  const concurrentAppend = store.append(table, { ts: 'C', endpoint: '/concurrent' });
  await Promise.all([slowMutate, concurrentAppend]);

  const rows = await store.readAll(table);
  const seen = rows.map(r => r.endpoint).sort();
  assert.deepStrictEqual(seen, ['/concurrent', '/first', '/from-mutate'],
    'the concurrent write was swallowed by the mutation');
});

test('two mutations of the same table both take effect', async () => {
  // Two withdrawals arriving together: one used to be lost.
  await reset();
  await store.append(table, { ts: 'A', endpoint: '/base' });
  await Promise.all([
    store.mutate(table, async (rows) => { await new Promise(r => setTimeout(r, 30)); return [...rows, { ts: 'X', endpoint: '/one' }]; }),
    store.mutate(table, async (rows) => [...rows, { ts: 'Y', endpoint: '/two' }]),
  ]);
  const seen = (await store.readAll(table)).map(r => r.endpoint).sort();
  assert.deepStrictEqual(seen, ['/base', '/one', '/two']);
});

test('the transform sees the rows as they are, not as they were', async () => {
  await reset();
  await store.append(table, { ts: 'A', endpoint: '/a' });
  await store.mutate(table, (rows) => [...rows, { ts: 'B', endpoint: '/b' }]);
  await store.mutate(table, (rows) => {
    assert.strictEqual(rows.length, 2, 'the second mutation must see the first');
    return rows;
  });
});

test('returning undefined writes nothing', async () => {
  await reset();
  await store.append(table, { ts: 'A', endpoint: '/kept' });
  const result = await store.mutate(table, () => undefined);
  assert.strictEqual(result, null);
  assert.strictEqual((await store.readAll(table)).length, 1, 'nothing should have been rewritten');
});

test('a failed mutation does not wedge the queue behind it', async () => {
  await reset();
  await assert.rejects(store.mutate(table, () => { throw new Error('boom'); }), /boom/);
  await store.append(table, { ts: 'A', endpoint: '/after' });
  assert.strictEqual((await store.readAll(table)).length, 1, 'writes must still work afterwards');
});

test('a failed mutation leaves the store as it was', async () => {
  await reset();
  await store.append(table, { ts: 'A', endpoint: '/original' });
  await assert.rejects(store.mutate(table, () => { throw new Error('boom'); }));
  const rows = await store.readAll(table);
  assert.deepStrictEqual(rows.map(r => r.endpoint), ['/original'], 'a half-applied change is worse than none');
});

/* ── the catalogue has to agree with itself ──

   The two halves fail differently when they drift, which is what makes this
   worth a test rather than a comment. A window style with no multiplier
   prices at 1× with no signal at all. A door style with no rate throws — so
   /api/glazing returns 500, and resolveGlazing swallows the same throw, which
   means the lead silently loses its estimate and the installer never sees the
   figure the homeowner was shown. */

const catalogue = require('../catalogue.json');

test('every window style we offer has a rate behind it', () => {
  for (const style of catalogue.windowsDoors.windowStyles) {
    assert.notStrictEqual(catalogue.glazing.styleMultipliers[style.id], undefined,
      `windowStyles offers "${style.id}" but glazing.styleMultipliers has no entry — it would price at 1x, silently`);
  }
});

test('every door style we offer has a rate behind it', () => {
  for (const style of catalogue.windowsDoors.doorStyles) {
    assert.ok(catalogue.glazing.doors.some(d => d.id === style.id),
      `doorStyles offers "${style.id}" but glazing.doors has no rate — /api/glazing would 500 for anyone who picks it`);
  }
});

test('window bands ascend, because bandFor takes the first that fits', () => {
  const caps = catalogue.glazing.windowBands.map(b => b.maxAreaM2 ?? Infinity);
  assert.deepStrictEqual(caps, [...caps].sort((a, b) => a - b),
    'out of order, every window falls into whichever band happens to be first');
});

test('the placeholder warning is driven by the catalogue, not by a flag someone forgets', () => {
  /* GLAZING_RATES_SOURCED reads catalogue.glazing.source. Replacing the rates
     and editing that line turns every caveat off at once — which is the right
     design, and worth pinning so nobody removes the string it depends on. */
  assert.ok(typeof catalogue.glazing.source === 'string' && catalogue.glazing.source.length,
    'glazing.source is what the caveat is derived from; it must exist');
});

test('one definition of what counts as a plausible house', () => {
  /* These were stated in three places and had already drifted: a resume code
     could carry back a 5,000 m² wall area that the quote engine then silently
     discarded, so the price on the phone differed from the price on the desk
     with nothing to explain it. */
  const limits = require('../limits');
  const resume = require('../resume');
  const glazing = require('../glazing');

  assert.strictEqual(resume.NUMBER_FIELDS.footprintM2.max, limits.MANUAL_AREA_MAX_M2);
  assert.strictEqual(resume.NUMBER_FIELDS.footprintM2.min, limits.MANUAL_AREA_MIN_M2);
  assert.strictEqual(resume.NUMBER_FIELDS.trimLengthM.max, limits.TRIM_LENGTH_MAX_M);
  assert.strictEqual(resume.NUMBER_FIELDS.windowCount.max, limits.MAX_WINDOWS);
  assert.strictEqual(glazing.MAX_WINDOWS, limits.MAX_WINDOWS);
  assert.strictEqual(glazing.MIN_WINDOWS, limits.MIN_WINDOWS);
});

test('a design carried to a phone cannot hold a number the quote engine refuses', () => {
  const resume = require('../resume');
  const limits = require('../limits');
  const carried = resume.buildPayload({
    footprintM2: limits.MANUAL_AREA_MAX_M2 + 1,
    trimLengthM: limits.TRIM_LENGTH_MAX_M + 1,
    claddingId: 'sage-slate',
  });
  assert.deepStrictEqual(Object.keys(carried), ['claddingId']);

  const kept = resume.buildPayload({ footprintM2: 95, trimLengthM: 24, claddingId: 'sage-slate' });
  assert.strictEqual(kept.footprintM2, 95, 'a real house still travels');
});

test('the suite cannot write to the real data directory', () => {
  /* The one remaining way this codebase could damage something outside
     itself: `npm test` on a box with the production volume mounted wrote test
     leads into real storage and deleted the live spend counter. store.js now
     resolves DATA_DIR once, from FACETPRO_DATA_DIR, and every test file
     requires helpers/data-dir before anything else. */
  const store = require('../store');
  const real = path.join(__dirname, '..', 'data');
  assert.ok(process.env.FACETPRO_DATA_DIR, 'the guard should have set this');
  assert.notStrictEqual(path.resolve(store.DATA_DIR), path.resolve(real),
    'the store is pointed at the real data directory during a test run');
  assert.strictEqual(path.resolve(store.DATA_DIR), path.resolve(process.env.FACETPRO_DATA_DIR));
});

test('every test file is guarded, not just the ones that write today', () => {
  // A new test file that forgets the guard writes to the real directory, and
  // nothing would say so until the day it runs beside a mounted volume.
  const dir = __dirname;
  const unguarded = fs.readdirSync(dir)
    .filter(f => f.endsWith('.test.js'))
    .filter(f => !fs.readFileSync(path.join(dir, f), 'utf8').includes("helpers/data-dir"));
  assert.deepStrictEqual(unguarded, [], `these write to the real data/: ${unguarded.join(', ')}`);
});
