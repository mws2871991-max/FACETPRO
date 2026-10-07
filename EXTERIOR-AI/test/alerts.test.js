'use strict';
/* alerts.js: one email to the operator when the caps run low, a lead fails to
   reach a buyer, or errors cluster — throttled, and never carrying a
   homeowner's details. */
require('./helpers/data-dir');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const alerts = require('../alerts');
const obs = require('../observability');

const outbox = [];
beforeEach(() => {
  alerts._reset(); outbox.length = 0;
  process.env.RESEND_API_KEY = 'test'; process.env.LEAD_FROM_EMAIL = 'hello@facetpro.co.uk'; process.env.LEAD_NOTIFY_EMAIL = 'mike@example.com';
  alerts.configure(async (m) => { outbox.push(m); });
});
const flush = () => new Promise(r => setImmediate(r));

test('a cap warns once at 80% and once when it is used up, per day', async () => {
  const day = Date.UTC(2026, 9, 12, 10);
  for (let used = 1; used <= 160; used++) alerts.usage('render', used, 150, { now: day + used });
  await flush();
  assert.deepStrictEqual(outbox.map(m => m.subject), ['Facet Pro alert: 80% of today\'s AI pictures used', 'Facet Pro alert: daily AI pictures used up']);
  assert.match(outbox[1].text, /DAILY_RENDER_LIMIT/);
  // The next day it can warn again.
  alerts.usage('render', 120, 150, { now: day + 86_400_000 + 4 * 3_600_000 });
  await flush();
  assert.strictEqual(outbox.length, 3);
});

test('the same alert is sent at most once an hour', async () => {
  const t = Date.UTC(2026, 9, 12, 10);
  for (let i = 0; i < 5; i++) alerts.deliveryFailed({ leadId: 'LD-1', recipientId: 'anglian', status: 500 }, { now: t + i * 60_000 });
  alerts.deliveryFailed({ leadId: 'LD-2', recipientId: 'anglian', status: 500 }, { now: t + alerts.THROTTLE_MS + 1 });
  await flush();
  assert.strictEqual(outbox.length, 2);
  assert.match(outbox[0].text, /LD-1 could not be delivered to anglian \(500\)/);
});

test('a burst of request errors alerts; one or two do not', async () => {
  const t = Date.UTC(2026, 9, 12, 10);
  for (let i = 0; i < 9; i++) alerts.onEvent({ kind: 'request', message: 'boom' }, { now: t + i });
  await flush();
  assert.strictEqual(outbox.length, 0);
  alerts.onEvent({ kind: 'request', message: 'boom' }, { now: t + 10 });
  await flush();
  assert.match(outbox[0].subject, /burst of errors/);
});

test('crashes reach the alerts through the observability recorder', async () => {
  // The server registers exactly this listener; check it does, then use it.
  const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /obs\.addListener\(\(entry\) => alerts\.onEvent\(entry\)\)/);
  obs.addListener((entry) => alerts.onEvent(entry));
  obs.record('crash', 'uncaught exception: test');
  await flush();
  assert.match(outbox.at(-1).subject, /unexpected error/);
});

test('with no email configured nothing is sent, but the alert is still logged', async () => {
  delete process.env.RESEND_API_KEY;
  assert.strictEqual(alerts.alert('x', 'test', ['line']), true);
  await flush();
  assert.strictEqual(outbox.length, 0);
  assert.strictEqual(alerts.sent.length, 1);
});

test('an alert carries no homeowner details', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'alerts.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /lead\.(name|email|phone|postcode)|\.address\b/);
  // The server passes ids and reasons only.
  const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  for (const call of server.match(/alerts\.(deliveryFailed|emailFailed)\([^\n]*/g)) assert.doesNotMatch(call, /name|email:|phone|postcode/);
});
