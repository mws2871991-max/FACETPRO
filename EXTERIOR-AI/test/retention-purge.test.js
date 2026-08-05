/* Retention has to reach the copies, not only withdrawal.

   purgeLeadPii scrubs name, email, phone and postcode from the deliveries and
   notificationFailures tables. It existed, it worked, and it was called from
   exactly one place: the withdrawal handler. runRetention never called it.

   So a homeowner who asked to be erased had those rows scrubbed, and a
   homeowner who simply reached the end of the retention period did not.
   Their details stayed on file indefinitely — past the periods the privacy
   notice states, and surviving the redaction that is meant to leave only the
   consent record. Installer webhooks fail sometimes by nature, so this was
   not a rare path.

   What hid it is the part worth remembering. test/withdrawal.test.js has a
   passing test called "erasure reaches the copies, the render and the
   ancillary records", and it does exactly what it says — down the withdrawal
   path. Reading the suite, the subject looks covered. A passing test gave
   false assurance about a route it never touched, which is a worse failure
   than no test at all.

   These go through runRetention itself rather than the pure planning
   functions in retention.js, because the gap was never in the plan. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3107;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);

const store = require('../store');
const { _internals } = require('../server');
const retention = require('../retention');

before(async () => { await require('./helpers/server-ready')(BASE); });

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

/* Old enough that the plan will act on it, and shared so it is redacted
   rather than merely deleted — the case that keeps a row behind. */
const oldLead = (id, days) => ({
  id,
  ts: ago(days),
  name: 'Jane Smith',
  email: 'jane@example.com',
  phone: '07700900000',
  postcode: 'SW11 4NP',
  status: 'New lead',
  consent: { terms: true, installerQuotes: true, at: ago(days) },
});

const failureRow = (leadId) => ({
  ts: ago(1), kind: 'failure', leadId, recipientId: 'r1', recipientName: 'Installer',
  attempts: 3, status: 500, error: 'gateway timeout',
  name: 'Jane Smith', email: 'jane@example.com', phone: '07700900000', postcode: 'SW11 4NP',
});

const stillHasPii = (rows, leadId) => rows
  .filter(r => r?.leadId === leadId)
  .some(r => r.name || r.email || r.phone || r.postcode);

test('a delivery failure is scrubbed when its lead reaches the retention period', async () => {
  const id = 'LD-RETPURGE1';
  const beyond = Math.max(...Object.values(retention.PERIODS).filter(n => typeof n === 'number')) + 30;

  await store.replaceAll('leads', [oldLead(id, beyond)]);
  await store.replaceAll('deliveries', [failureRow(id)]);
  await store.replaceAll('notificationFailures', [failureRow(id)]);

  assert.ok(stillHasPii(await store.readAll('deliveries'), id), 'fixture should start with PII');

  await _internals.runRetention();

  assert.ok(!stillHasPii(await store.readAll('deliveries'), id),
    'a delivery-failure row kept name, email, phone or postcode after retention ran');
  assert.ok(!stillHasPii(await store.readAll('notificationFailures'), id),
    'a notification-failure row kept personal data after retention ran');
});

test('the scrubbed row is kept, not deleted — it is billing and audit evidence', async () => {
  const rows = await store.readAll('deliveries');
  const mine = rows.filter(r => r?.leadId === 'LD-RETPURGE1');
  assert.ok(mine.length, 'the delivery record was removed rather than scrubbed');
  assert.strictEqual(mine[0].erased, true, 'the row does not record that it was erased');
  assert.strictEqual(mine[0].status, 500, 'the non-personal detail was lost with the personal');
});

test('another homeowner in the same table is untouched', async () => {
  /* A scrub keyed on the wrong field, or one that rewrote every row, would
     pass the tests above and quietly erase somebody who was still inside
     their retention period. */
  const keep = 'LD-RETKEEP';
  const purge = 'LD-RETPURGE2';
  const beyond = Math.max(...Object.values(retention.PERIODS).filter(n => typeof n === 'number')) + 30;

  await store.replaceAll('leads', [oldLead(purge, beyond), oldLead(keep, 1)]);
  await store.replaceAll('deliveries', [failureRow(purge), failureRow(keep)]);

  await _internals.runRetention();

  const rows = await store.readAll('deliveries');
  assert.ok(!stillHasPii(rows, purge), 'the expired lead was not scrubbed');
  assert.ok(stillHasPii(rows, keep), 'a lead still inside its retention period was scrubbed');
});

test('purging is safe when the ancillary tables hold nothing', async () => {
  await store.replaceAll('leads', []);
  await store.replaceAll('deliveries', []);
  await store.replaceAll('notificationFailures', []);
  await assert.doesNotReject(() => _internals.runRetention());
});
