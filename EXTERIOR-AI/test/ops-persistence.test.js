/* Operational events that outlive the container. Run: npm test
 *
 * observability.js has said since August that it is a ring in memory "until a
 * volume or DATABASE_URL exists — then persist it and say so". DATABASE_URL
 * exists now, and on 29 September two separate questions about live renders
 * could not be answered because the deploy that shipped the answer had cleared
 * the evidence. A user test with five homeowners produces five anecdotes and
 * one chance to debug them; this is what makes that chance survive a restart.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const obs = require('../observability');
const store = require('../store');

test('what is stored has already had the homeowner taken out of it', () => {
  /* The single most important ordering in this file. The ring scrubs, and the
     sink must receive the scrubbed entry — persisting the raw one would put an
     email or a query string into a table an operator reads and retention
     keeps for a month. */
  const got = [];
  obs.setSink(e => got.push(e));
  obs.record('delivery', 'could not email sam@example.com about it',
    { email: 'sam@example.com', reason: 'mailbox full' });
  obs.setSink(null);

  assert.strictEqual(got.length, 1, 'the sink was not called');
  const flat = JSON.stringify(got[0]);
  assert.ok(!/sam@example\.com/.test(flat), `an address reached storage: ${flat}`);
  assert.match(flat, /mailbox full/, 'the fault itself should survive scrubbing');
});

test('a sink that is broken costs nothing', () => {
  /* The caller is a failure being recorded. A failure to record a failure must
     not become a second one — and the database being down is exactly when the
     operational record matters most. */
  for (const broken of [
    () => { throw new Error('storage is down'); },
    () => Promise.reject(new Error('connection refused')),
    () => null,
  ]) {
    obs.setSink(broken);
    assert.doesNotThrow(() => obs.record('storage', 'something failed'), 'a broken sink took the record down');
  }
  obs.setSink(null);
  /* And the ring still has them, which is the half that works without a
     database at all. */
  assert.ok(obs.summary({ limit: 10 }).recent.some(e => e.message === 'something failed'));
});

test('an event survives being written and read back', async () => {
  const ev = { at: new Date().toISOString(), kind: 'render', message: 'held the render to the window mask', detail: { inside: '0.234' } };
  assert.strictEqual(await store.appendOpsEvent(ev), true, 'the write reported failure');
  const back = await store.readOpsEvents(50);
  const found = back.find(e => e.at === ev.at && e.message === ev.message);
  assert.ok(found, 'the event did not come back');
  assert.deepStrictEqual(found.detail, ev.detail, 'the detail was lost, which is the part you came to read');
});

test('a malformed event is refused, not thrown', async () => {
  /* Same reason as the broken sink: this is on the path of recording a
     failure. */
  for (const bad of [null, undefined, {}, { at: 'nonsense' }]) {
    await assert.doesNotReject(async () => { await store.appendOpsEvent(bad); }, `${JSON.stringify(bad)} threw`);
  }
});

test('events age out, because a fault log is not a history of the site', async () => {
  const retention = require('../retention');
  assert.ok(retention.PERIODS.opsEventDays > 0 && retention.PERIODS.opsEventDays <= 90,
    `${retention.PERIODS.opsEventDays} days is not a fault log`);

  const old = { at: new Date(Date.now() - 400 * 86400000).toISOString(), kind: 'render', message: 'ancient failure' };
  await store.appendOpsEvent(old);
  const cutoff = new Date(Date.now() - retention.PERIODS.opsEventDays * retention.DAY).toISOString();
  await store.pruneOpsEvents(cutoff);
  const back = await store.readOpsEvents(500);
  assert.ok(!back.some(e => e.message === 'ancient failure'), 'an event older than the period survived the sweep');
});

test('the summary shows this process first, then what came before it', () => {
  /* The question is always about a render a few minutes ago, and the deploy in
     between is what used to lose it. */
  obs.record('render', 'something from this container');
  const history = [
    { at: '2020-01-01T00:00:00.000Z', kind: 'render', message: 'from a container that has gone' },
  ];
  const s = obs.summary({ limit: 50, history });
  const messages = s.recent.map(e => e.message);
  assert.ok(messages.includes('something from this container'));
  assert.ok(messages.includes('from a container that has gone'), 'the history was not shown');
  assert.ok(messages.indexOf('something from this container') < messages.indexOf('from a container that has gone'),
    'the newest should come first');
});

test('a running process writing to both is not reported twice', () => {
  const at = new Date().toISOString();
  const dup = { at, kind: 'render', message: 'the very same event' };
  obs.setSink(null);
  obs.record('render', 'the very same event');
  const mine = obs.summary({ limit: 50 }).recent.find(e => e.message === 'the very same event');
  const s = obs.summary({ limit: 50, history: [{ ...dup, at: mine.at }] });
  const hits = s.recent.filter(e => e.message === 'the very same event');
  assert.strictEqual(hits.length, 1, 'the same event was listed twice');
});

test('the summary says which it is, rather than looking complete', () => {
  /* observability.js's own header: a summary that looks complete and is not is
     worse than none. */
  assert.match(obs.summary({}).retention, /in memory only/);
  assert.match(obs.summary({ history: [{ at: 'x', kind: 'k', message: 'm' }] }).retention,
    /kept in storage across deploys/);
});

test('the server wires the sink, and the sweep clears the old ones', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /obs\.setSink\(\(ev\) => store\.appendOpsEvent\(ev\)\)/,
    'nothing is writing operational events to storage');
  assert.match(src, /store\.pruneOpsEvents\(opsCutoff\)/,
    'operational events are kept for ever');

  /* And observability must stay dependency-free: injecting the sink is what
     lets the ring keep working when the database is the thing that broke. */
  const ob = fs.readFileSync(path.join(__dirname, '..', 'observability.js'), 'utf8');
  assert.ok(!/require\(/.test(ob), 'observability.js has taken a dependency');

  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ops.js'), 'utf8');
  assert.match(route, /store\.readOpsEvents\(200\)/, '/api/ops no longer reads the stored history');
  assert.match(route, /catch \(_\) \{ \/\* an ops page that fails because one panel failed is worse/,
    'a storage failure should not take the whole ops page down');
});
