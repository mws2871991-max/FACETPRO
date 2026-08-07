/* The same house gets the same number — including tomorrow.

   Detection was already cached against a hash of the image, which made one
   photograph give one price. But the cache was a Map in the process, so a
   deploy emptied it and the next read of the same photograph was a fresh roll
   of a sampled model. On a real house that was seven windows before a deploy
   and six after: a seventeen per cent move, under a homepage promising in as
   many words that the same house gets the same number.

   A homeowner does not experience that as sampling variance. They experience
   it as being quoted one price on Tuesday and a different one on Wednesday,
   which is what they already expect from this trade and the whole reason this
   product exists.

   So the answer is kept in the store as well. This covers the part that broke:
   that a process which has never seen a photograph before still returns what
   the previous process decided about it.

   What is NOT kept is the photograph. legal/privacy.html says it is deleted
   after use, and a SHA-256 cannot reconstruct it — nor is there a session, a
   lead or an IP on the row to join it to a person. Both are asserted below,
   because a cache of everyone's houses is exactly the thing worth not
   accidentally building. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('../store');

const DAYS = 7 * 24 * 60 * 60 * 1000;

const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex');

const DETECTIONS = [
  { type: 'window', label: 'Front left', confidence: 0.9, x_pct: 10, y_pct: 30, w_pct: 12, h_pct: 18 },
  { type: 'window', label: 'Front right', confidence: 0.9, x_pct: 60, y_pct: 30, w_pct: 12, h_pct: 18 },
  { type: 'cladding', label: 'Front wall', confidence: 0.95, x_pct: 2, y_pct: 5, w_pct: 95, h_pct: 80 },
];

test('what one process decided, the next process reads back', async () => {
  const hash = hashOf('a photograph of a house');
  await store.putDetectionCache(hash, { detections: DETECTIONS, aspectRatio: 1.3333 }, DAYS);

  const back = await store.getDetectionCache(hash, DAYS);
  assert.ok(back, 'the detections did not survive being written');
  assert.deepStrictEqual(back.detections, DETECTIONS,
    'the same photograph came back with a different set of elements');
  assert.ok(Math.abs(back.aspectRatio - 1.3333) < 1e-6,
    'the aspect ratio is what turns boxes into sizes — losing it loses the measurement');
});

test('a photograph nobody has sent before is a miss, not a wrong answer', async () => {
  assert.strictEqual(await store.getDetectionCache(hashOf('a different house'), DAYS), null);
});

test('anything that is not a sha-256 is refused rather than looked up', async () => {
  /* The hash reaches a filesystem path on the JSONL backend and a query on
     Postgres. It is derived server-side from the image bytes and never comes
     from a client — but that is a property of today's callers, not a rule, so
     the rule is here. */
  for (const bad of ['../../etc/passwd', '', null, undefined, 'ABC', 'x'.repeat(64), hashOf('x') + 'f']) {
    assert.strictEqual(await store.getDetectionCache(bad, DAYS), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('an entry past its window is a miss, and is swept on the next write', async () => {
  const old = hashOf('an old photograph');
  await store.putDetectionCache(old, { detections: DETECTIONS, aspectRatio: 1 }, DAYS);

  /* Ask with a window of zero: everything is expired. */
  assert.strictEqual(await store.getDetectionCache(old, 0), null,
    'an expired entry was served — the retention window is decorative');

  /* And a later write with that window actually removes it, rather than
     leaving a table that only grows. */
  await store.putDetectionCache(hashOf('a newer photograph'), { detections: DETECTIONS, aspectRatio: 1 }, 0);
  assert.strictEqual(await store.getDetectionCache(old, DAYS), null,
    'the expired entry survived a sweep');
});

test('the row holds no photograph and nothing to identify anybody', async () => {
  /* The privacy notice says the photograph is deleted after use. A hash cannot
     reconstruct it, and there is no session, lead or IP on the row to join it
     to a person. If a column that could is ever added, this fails. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
  const ddl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS detection_cache'));
  const columns = ddl.slice(0, ddl.indexOf(')')).toLowerCase();

  for (const forbidden of ['session', 'lead', 'ip', 'email', 'postcode', 'name', 'bytes', 'image_data']) {
    assert.ok(!columns.includes(forbidden),
      `detection_cache has a "${forbidden}" column — this table must not be joinable to a person`);
  }
  assert.match(columns, /image_hash/, 'the key must be a hash, not an image');

  const hash = hashOf('privacy check');
  await store.putDetectionCache(hash, { detections: DETECTIONS, aspectRatio: 1 }, DAYS);
  const back = await store.getDetectionCache(hash, DAYS);
  assert.deepStrictEqual(Object.keys(back).sort(), ['aspectRatio', 'detections'],
    'the cache handed back more than the geometry it is supposed to hold');
});

test('the server keeps a window, and it is not open-ended', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const m = src.match(/DETECTION_CACHE_DAYS\s*=\s*(\d+)/);
  assert.ok(m, 'there is no retention window on the detection cache');
  const days = Number(m[1]);
  assert.ok(days >= 1, 'a window under a day defeats the point — a deploy would still change the answer');
  assert.ok(days <= 90, `${days} days is long enough to be a record of every house photographed, not a cache`);
});
