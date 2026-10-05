/* The day's spend outlives the container. Run: npm test
 *
 * 5 October: /api/ops reported detect 0, render 0 on a day with seven renders
 * behind it. usage.json is written to DATA_DIR, and the only Railway volume is
 * attached to Postgres rather than to the app — so every `railway up` wiped
 * the counter and readUsageFile() began again at zero.
 *
 * With fifteen deploys in a day, the 50 detections and 150 renders were not a
 * daily cap but a per-container one, and the ceiling they put on the Replicate
 * bill was fifteen times what it says. Nobody reached it, because traffic is
 * low — which is exactly why it would have gone unnoticed until the day a
 * guide page caught on or somebody scripted the endpoint.
 *
 * ops_events were moved into Postgres for the same reason and this follows
 * them. The file is kept as the fallback for a local run with no database.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const store = require('../store');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('the counter is seeded from storage at boot, not from a file alone', () => {
  /* Without this a new container starts the day at zero however many
     pictures it has already paid for. */
  assert.match(SERVER, /async function seedUsageFromStore\(\)/);
  assert.match(SERVER, /await store\.ensureSchema\(\);\s*\n\s*await seedUsageFromStore\(\);/,
    'the seed must run at startup, after the schema exists');
  assert.match(SERVER, /store\.readDailyUsage\(utcDay\(\)\)/);
});

test('every charge is counted where another container can see it', () => {
  const i = SERVER.indexOf('usage[kind] += 1;');
  assert.ok(i > 0, 'the in-memory increment has moved');
  assert.match(SERVER.slice(i, i + 300), /reconcileUsage\(kind\)/,
    'a charge that only lands in memory is lost on the next deploy');
});

test('a slow or broken database never refuses a homeowner', () => {
  /* The counter is a safety net on the bill. Failing closed would turn a
     database wobble into "we cannot analyse photos right now" for everybody,
     which is a worse outcome than a few pictures over the cap. */
  const f = SERVER.slice(SERVER.indexOf('function reconcileUsage('), SERVER.indexOf('async function seedUsageFromStore('));
  assert.match(f, /\.catch\(\(\) => \{\}\)/, 'a failed write must not surface');
  assert.match(f, /Math\.max\(usage\.detect, row\.detect\)/, 'reconciling must never lower the count');
  assert.doesNotMatch(f, /await /, 'the request must not wait on the counter');
});

test('the database is told to do the addition, not asked for the old value', async () => {
  /* Two containers both reading 49 and both writing 50 is how a cap leaks.
     The increment belongs in the statement. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
  assert.match(src, /ON CONFLICT \(day\) DO UPDATE SET/);
  assert.match(src, /daily_usage\.\$\{col\}|\.\$\{col\} \+ 1/, 'the new value must be derived in SQL');
  assert.match(src, /CREATE TABLE IF NOT EXISTS daily_usage/);
});

test('with no database it behaves exactly as it did', async () => {
  /* A local run without DATABASE_URL keeps the file and the old behaviour,
     so this change is invisible to anyone developing offline. */
  if (store.hasDb) return;   // the integration path is covered by postgres.test.js
  assert.strictEqual(await store.readDailyUsage('2026-10-05'), null);
  assert.strictEqual(await store.chargeDailyUsage('2026-10-05', 'render'), null);
  assert.match(SERVER, /function persistUsage\(\)/, 'the file fallback has gone');
});
