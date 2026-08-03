/* Lead delivery. Each lead goes to several buyers who pay per lead, so the
   interesting cases are all the ones where something goes wrong: a buyer is
   down, a buyer rejects, a buyer hangs. The record has to survive all of it,
   because the record is what gets invoiced. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseRecipients, deliverTo, deliverLead, summarise } = require('../delivery');

const LEAD = { id: 'LD-4821', name: 'Jane', email: 'jane@example.com', price: 28783 };
const noSleep = () => Promise.resolve();          // don't actually wait in tests
const ok = () => ({ ok: true, status: 200 });
const fail = (status) => ({ ok: false, status });

/* ── configuration ── */

test('recipients are parsed from JSON', () => {
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'anglian', name: 'Anglian', url: 'https://anglian.example/hook' },
    { id: 'zenith', name: 'Zenith', url: 'https://zenith.example/hook', headers: { 'X-Key': 'abc' } },
  ]));
  assert.strictEqual(problems.length, 0);
  assert.strictEqual(recipients.length, 2);
  assert.strictEqual(recipients[1].headers['X-Key'], 'abc');
});

test('a plain http recipient is refused — lead data must not travel in clear', () => {
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'insecure', url: 'http://buyer.example/hook' },
  ]));
  assert.strictEqual(recipients.length, 0);
  assert.match(problems[0], /https/i);
});

test('malformed config delivers to nobody, loudly', () => {
  for (const raw of ['not json', '{"id":"x"}', '[]']) {
    const { recipients, problems } = parseRecipients(raw);
    assert.strictEqual(recipients.length, 0);
    if (raw !== '[]') assert.ok(problems.length, `"${raw}" should report a problem`);
  }
});

test('a duplicate id is flagged — otherwise two buyers are indistinguishable', () => {
  const { problems } = parseRecipients(JSON.stringify([
    { id: 'same', url: 'https://a.example/h' },
    { id: 'same', url: 'https://b.example/h' },
  ]));
  assert.ok(problems.some(p => /duplicate/i.test(p)));
});

test('the old single-webhook setting still works', () => {
  const { recipients } = parseRecipients('', { legacyUrl: 'https://old.example/crm' });
  assert.strictEqual(recipients.length, 1);
  assert.strictEqual(recipients[0].id, 'crm');
});

/* ── delivering ── */

test('a successful delivery is recorded with its attempt count', async () => {
  const r = await deliverTo({ id: 'a', name: 'A', url: 'https://a.example/h', headers: {} }, LEAD,
    { fetchImpl: async () => ok(), onSleep: noSleep });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 1);
  assert.strictEqual(r.status, 200);
  assert.ok(r.at, 'needs a timestamp — this is the billing evidence');
});

test('a transient failure is retried and can still succeed', async () => {
  let calls = 0;
  const r = await deliverTo({ id: 'a', name: 'A', url: 'https://a.example/h', headers: {} }, LEAD, {
    fetchImpl: async () => { calls++; return calls < 3 ? fail(503) : ok(); },
    onSleep: noSleep,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 3, 'should have taken three goes');
});

test('a permanent rejection is not retried — retrying a 400 just wastes time', async () => {
  let calls = 0;
  const r = await deliverTo({ id: 'a', name: 'A', url: 'https://a.example/h', headers: {} }, LEAD, {
    fetchImpl: async () => { calls++; return fail(400); },
    onSleep: noSleep,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(calls, 1, `gave up after ${calls} call(s), expected 1`);
  assert.match(r.error, /400/);
  /* And the record has to say one, not three. This is what a buyer sees when
     they query an invoice — evidence that overstates what we did is worse
     than none, because it is the half nobody checks. */
  assert.strictEqual(r.attempts, 1, 'reported more attempts than it made');
});

test('429 and 408 ARE retried — those do clear', async () => {
  for (const status of [429, 408]) {
    let calls = 0;
    await deliverTo({ id: 'a', name: 'A', url: 'https://a.example/h', headers: {} }, LEAD, {
      fetchImpl: async () => { calls++; return fail(status); },
      onSleep: noSleep,
    });
    assert.strictEqual(calls, 3, `${status} should be retried, got ${calls} call(s)`);
  }
});

test('a thrown network error is caught and reported, never propagated', async () => {
  const r = await deliverTo({ id: 'a', name: 'A', url: 'https://a.example/h', headers: {} }, LEAD, {
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    onSleep: noSleep,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
  assert.strictEqual(r.attempts, 3);
});

test('a hanging buyer times out rather than blocking forever', async () => {
  const r = await deliverTo({ id: 'slow', name: 'Slow', url: 'https://slow.example/h', headers: {} }, LEAD, {
    fetchImpl: (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
    timeoutMs: 20,
    onSleep: noSleep,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /timed out/);
});

/* ── the whole set ── */

test('one buyer being down must not stop the others being paid for', async () => {
  const recipients = [
    { id: 'anglian', name: 'Anglian', url: 'https://a.example/h', headers: {} },
    { id: 'broken',  name: 'Broken',  url: 'https://b.example/h', headers: {} },
    { id: 'zenith',  name: 'Zenith',  url: 'https://z.example/h', headers: {} },
  ];
  const results = await deliverLead(LEAD, recipients, {
    fetchImpl: async (url) => (url.includes('b.example') ? fail(500) : ok()),
    onSleep: noSleep,
  });

  assert.strictEqual(results.length, 3, 'every recipient must produce a record');
  const s = summarise(results);
  assert.deepStrictEqual(s, { total: 3, delivered: 2, failed: 1 });
  assert.strictEqual(results.find(r => r.id === 'broken').ok, false);
  assert.ok(results.filter(r => r.id !== 'broken').every(r => r.ok), 'the working buyers still got it');
});

test('every recipient gets the full lead', async () => {
  const seen = [];
  await deliverLead(LEAD, [
    { id: 'a', name: 'A', url: 'https://a.example/h', headers: {} },
    { id: 'b', name: 'B', url: 'https://b.example/h', headers: {} },
  ], {
    fetchImpl: async (url, opts) => { seen.push(JSON.parse(opts.body)); return ok(); },
    onSleep: noSleep,
  });
  assert.strictEqual(seen.length, 2);
  for (const body of seen) assert.deepStrictEqual(body, LEAD);
});

test('per-recipient headers are sent, so each buyer can authenticate us', async () => {
  const seen = {};
  await deliverLead(LEAD, [
    { id: 'a', name: 'A', url: 'https://a.example/h', headers: { 'X-Api-Key': 'key-a' } },
    { id: 'b', name: 'B', url: 'https://b.example/h', headers: {} },
  ], {
    fetchImpl: async (url, opts) => { seen[url] = opts.headers; return ok(); },
    onSleep: noSleep,
  });
  assert.strictEqual(seen['https://a.example/h']['X-Api-Key'], 'key-a');
  assert.strictEqual(seen['https://a.example/h']['Content-Type'], 'application/json');
  assert.ok(!seen['https://b.example/h']['X-Api-Key']);
});

test('no recipients configured is a no-op, not a crash', async () => {
  const results = await deliverLead(LEAD, [], { fetchImpl: async () => ok() });
  assert.deepStrictEqual(results, []);
});
