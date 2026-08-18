/* Where visitors stop, without knowing who they are.

   The conversion plan asks to know where every visitor drops out, because it
   puts conversion first and conversion cannot be improved blind. It does not
   ask to know WHO dropped out, and this is built so it cannot answer that
   even if somebody later wants it to.

   A row is a day, a stage and a number. No session, no visitor id, no IP, no
   user agent, no referrer, no path. Two people who upload are indistinguishable
   from one person uploading twice. That is the cost, and it buys: no personal
   data, so no consent to obtain, no processor agreement, no international
   transfer, and nothing that can leak.

   The tests below are mostly about keeping it that way. The counting itself is
   simple; the discipline is the point. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3128;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'funnel-test-password';

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = PASSWORD;
process.env.INSTALLER_RATE_LIMIT = '500';

const store = require('../store');
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const send = (stage) => fetch(`${BASE}/api/funnel`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ stage }),
});
const read = (headers = { Authorization: `Bearer ${PASSWORD}` }) =>
  fetch(`${BASE}/api/funnel`, { headers });

/* The endpoint answers 204 and writes afterwards, deliberately: a counter that
   fails must never cost a visitor their journey, and the browser is not waiting
   for anything useful. That means a read taken the instant the 204 lands can
   legitimately arrive before the row does.

   This test used to read once and assert, which passed whenever the write won
   the race and failed when it did not — once against Postgres, where an insert
   is a network round trip rather than a file append. A flaky test is worse than
   a missing one: it teaches whoever sees it to press re-run rather than look,
   which is the same lesson as a red cross that appears every night.

   So it waits for the count instead of assuming it. */
const countOf = async (stage) =>
  (await (await read()).json()).funnel.find(f => f.stage === stage).count;

async function countReaches(stage, target, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const n = await countOf(stage);
    if (n >= target) return n;
    if (Date.now() > deadline) return n;
    await new Promise(r => setTimeout(r, 25));
  }
}

test('a stage is counted, and the funnel reports it', async () => {
  const before = await countOf('landing');
  assert.strictEqual((await send('landing')).status, 204);
  assert.strictEqual((await send('landing')).status, 204);
  const after = await countReaches('landing', before + 2);
  assert.strictEqual(after, before + 2, 'the counter did not move');
});

test('conversion is measured against the step before, not the top', async () => {
  /* "Where do we lose them" is always a question about the previous step. */
  const body = await (await read()).json();
  const stages = body.funnel.map(f => f.stage);
  assert.deepStrictEqual(stages, [
    'landing', 'upload_started', 'upload_completed',
    'analysis_completed', 'visualisation_started', 'design_created', 'design_changed',
    'estimate_viewed', 'design_saved',
    'quote_started', 'quote_requested', 'quote_completed',
    'lead_qualified', 'lead_sent', 'installer_received', 'installer_accepted',
  ], 'the funnel order no longer matches the journey');
  assert.strictEqual(body.funnel[0].ofPreviousPct, null, 'the first stage has nothing to convert from');
});

test('the original eight stages keep their names and their order', () => {
  /* Rows are keyed by stage name, so renaming one does not migrate its
     history — it orphans it, silently, and the funnel simply shows a step that
     started last Tuesday. New stages may be inserted between these; none of
     these eight may be renamed, reordered or dropped. */
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const m = server.match(/const FUNNEL_STAGES = \[([\s\S]*?)\];/);
  assert.ok(m, 'FUNNEL_STAGES has moved or been renamed');
  const stages = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
  const original = ['landing', 'upload_started', 'upload_completed', 'design_created',
    'estimate_viewed', 'design_saved', 'quote_requested', 'lead_sent'];
  assert.deepStrictEqual(stages.filter(s => original.includes(s)), original,
    'one of the original stages has been renamed, dropped or moved — its stored rows would be orphaned');
});

test('a browser cannot claim a stage only the server can witness', async () => {
  /* These four are counted server-side: a lead stored and scored, a lead
     delivered, a buyer accepting. A page that could post them could inflate
     the numbers somebody makes spend decisions from, and nothing downstream
     would know. */
  for (const stage of ['lead_qualified', 'lead_sent', 'installer_received', 'installer_accepted']) {
    const res = await send(stage);
    assert.strictEqual(res.status, 400, `the public endpoint accepted ${stage}`);
  }
});

test('a stage nobody defined is refused', async () => {
  /* Without an allowlist a client could write arbitrary text into the table,
     which turns a counter into free-text storage nobody is watching. */
  for (const bad of ['<script>alert(1)</script>', 'landing; DROP TABLE funnel', '', 'LANDING', 'x'.repeat(500)]) {
    const res = await send(bad);
    assert.strictEqual(res.status, 400, `accepted ${JSON.stringify(bad.slice(0, 30))}`);
  }
});

test('the funnel is not public', async () => {
  assert.strictEqual((await read({})).status, 401);
  assert.strictEqual((await read({ Authorization: 'Bearer wrong' })).status, 401);
});

test('recording a stage never blocks the visitor', async () => {
  /* 204 and nothing else: the browser has no reason to wait, and a counter
     must never be in the way of somebody pricing their windows. */
  const res = await send('estimate_viewed');
  assert.strictEqual(res.status, 204);
  assert.strictEqual(await res.text(), '');
});

test('nothing stored can identify a visitor', async () => {
  /* The schema is the guarantee. If a column that could join a row to a person
     is ever added, this fails — before anybody has to notice it in a review. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
  const ddl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS funnel'));
  const columns = ddl.slice(0, ddl.indexOf(')')).toLowerCase();

  for (const forbidden of ['session', 'visitor', 'ip', 'user_agent', 'referrer', 'path', 'lead', 'email', 'postcode', 'id ']) {
    assert.ok(!columns.includes(forbidden),
      `the funnel table has a "${forbidden}" column — it must not be joinable to a person`);
  }
  assert.match(columns, /day/);
  assert.match(columns, /stage/);
  assert.match(columns, /hits/);
});

test('the endpoint accepts a stage and nothing else', async () => {
  /* Anything extra a client sends must be ignored rather than stored. */
  const res = await fetch(`${BASE}/api/funnel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: 'landing', email: 'someone@example.com', ip: '1.2.3.4', note: 'hello' }),
  });
  assert.strictEqual(res.status, 204);

  const dir = process.env.FACETPRO_DATA_DIR;
  const file = path.join(dir, 'funnel.json');
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    for (const leak of ['someone@example.com', '1.2.3.4', 'hello']) {
      assert.ok(!raw.includes(leak), `the funnel store kept "${leak}"`);
    }
  }
});

test('the window is bounded, so one caller cannot ask for everything', async () => {
  const res = await fetch(`${BASE}/api/funnel?days=99999`, { headers: { Authorization: `Bearer ${PASSWORD}` } });
  const body = await res.json();
  assert.ok(body.days <= 365, `days was ${body.days}`);
});

test('the store rolls a day up rather than keeping a row per visit', async () => {
  /* Counters, not events. A table of events is a table that grows with every
     visitor and eventually describes their behaviour individually. */
  await store.countStage('landing');
  await store.countStage('landing');
  const totals = await store.readFunnel(30);
  assert.ok(typeof totals.landing === 'number', 'readFunnel should return counts, not rows');
});
