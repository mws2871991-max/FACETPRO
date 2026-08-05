/* Lead delivery. Each lead goes to several buyers who pay per lead, so the
   interesting cases are all the ones where something goes wrong: a buyer is
   down, a buyer rejects, a buyer hangs. The record has to survive all of it,
   because the record is what gets invoiced. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

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
  /* feeTotal is null and not 0: none of these three has a leadPrice
     configured, so nothing is known about what the lead was worth. Two
     deliveries succeeded and both are unpriced, which is a fact worth
     carrying rather than rounding to zero on an invoice. */
  assert.deepStrictEqual(s, { total: 3, delivered: 2, failed: 1, feeTotal: null, feeUnpriced: 2 });
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

/* ── what a lead was worth ──

   Two signed contracts at £100 and £130. Before this the code had one cap and
   no price at all, so a delivery record — which is the billing evidence —
   could not say what any lead was worth. Reconciling an invoice meant looking
   up a contract that may have changed since.

   The fee recorded is the fee that applied when the lead was sent. */

test('a per-recipient price is parsed and kept', () => {
  const { recipients } = parseRecipients(JSON.stringify([
    { id: 'anglian', url: 'https://a.test/hook', leadPrice: 130 },
    { id: 'zenith', url: 'https://z.test/hook', leadPrice: 100 },
  ]));
  assert.deepStrictEqual(recipients.map(r => r.leadPrice), [130, 100]);
});

test('a recipient with no price is allowed, and recorded as unpriced', () => {
  /* A recipient may be a CRM rather than a buyer. Absent must not become 0,
     because "not charged" and "we do not know" are different facts. */
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'crm', url: 'https://c.test/hook' },
  ]));
  assert.strictEqual(recipients[0].leadPrice, null);
  assert.strictEqual(problems.length, 0, 'an absent price is not a problem');
});

test('a price that is not a number is refused loudly rather than guessed at', () => {
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'bad', url: 'https://b.test/hook', leadPrice: 'free' },
  ]));
  assert.strictEqual(recipients[0].leadPrice, null, 'a bad price became a real one');
  assert.match(problems.join(' '), /leadPrice/, 'nothing was said about it');
});

test('a negative price is refused', () => {
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'neg', url: 'https://n.test/hook', leadPrice: -50 },
  ]));
  assert.strictEqual(recipients[0].leadPrice, null);
  assert.match(problems.join(' '), /leadPrice/);
});

test('the fee total counts what arrived, not what was attempted', () => {
  /* A failed delivery is not a lead sold. Billing one would put a number on
     an invoice that the delivery log itself contradicts. */
  const s = summarise([
    { id: 'a', ok: true, leadPrice: 130 },
    { id: 'z', ok: true, leadPrice: 100 },
    { id: 'f', ok: false, leadPrice: 130 },
  ]);
  assert.strictEqual(s.delivered, 2);
  assert.strictEqual(s.feeTotal, 230, 'the failed delivery was billed');
});

test('unpriced deliveries are counted separately, not silently valued at zero', () => {
  const s = summarise([
    { id: 'a', ok: true, leadPrice: 130 },
    { id: 'crm', ok: true, leadPrice: null },
  ]);
  assert.strictEqual(s.feeTotal, 130);
  assert.strictEqual(s.feeUnpriced, 1, 'the unpriced delivery vanished from the record');
});

test('no priced recipient means null, not zero', () => {
  const s = summarise([{ id: 'crm', ok: true, leadPrice: null }]);
  assert.strictEqual(s.feeTotal, null,
    '"nobody was charged" and "we do not know what this was worth" must not look the same');
});
