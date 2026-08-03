/* Retention. The privacy notice states periods as fact, so this is what makes
   those statements true rather than aspirational.

   Pure functions, so the whole policy is exercised without a clock or a
   database — dates are passed in. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const { classifyLead, redactLead, isExpired, plan, PERIODS, DAY } = require('../retention');

const NOW = Date.parse('2026-08-01T00:00:00Z');
const ago = (days) => new Date(NOW - days * DAY).toISOString();

const lead = (days, { shared = false, consentDaysAgo = null } = {}) => ({
  id: 'LD-' + days,
  ts: ago(days),
  name: 'Jane', email: 'jane@example.com', phone: '07700900000', postcode: 'SW11 4NP',
  price: 28783,
  wallMeasurement: { houseType: 'semi', m2: 105 },
  measurementSource: 'photo_door',
  consent: {
    terms: true,
    installerQuotes: shared,
    at: ago(consentDaysAgo ?? days),
    version: '2026-08-01',
    wording: { terms: 'I agree…' },
  },
});

test('a design nobody was sent is kept for six months, then goes', () => {
  assert.strictEqual(classifyLead(lead(30), NOW), 'keep');
  assert.strictEqual(classifyLead(lead(182), NOW), 'keep');
  assert.notStrictEqual(classifyLead(lead(200), NOW), 'keep', 'past six months');
});

test('an enquiry shared with installers is kept for two years', () => {
  assert.strictEqual(classifyLead(lead(200, { shared: true }), NOW), 'keep',
    'six months does not apply once it has been shared');
  assert.strictEqual(classifyLead(lead(700, { shared: true }), NOW), 'keep');
  assert.notStrictEqual(classifyLead(lead(800, { shared: true }), NOW), 'keep');
});

test('the consent record outlives the enquiry — that is the point of it', () => {
  // Past 24 months, so the enquiry goes; well inside 6 years, so the proof of
  // what they agreed to stays. Deleting that first would be the wrong way
  // round: the sharing already happened and may still be challenged.
  assert.strictEqual(classifyLead(lead(800, { shared: true }), NOW), 'redact');
  // Past six years, nothing left to keep.
  assert.strictEqual(classifyLead(lead(2300, { shared: true }), NOW), 'delete');
});

test('redacting keeps the agreement and drops the person', () => {
  const r = redactLead(lead(800, { shared: true }));
  assert.ok(r.consent, 'the agreement survives');
  assert.strictEqual(r.consent.installerQuotes, true);
  assert.strictEqual(r.consent.wording.terms, 'I agree…');
  assert.strictEqual(r.redacted, true);
  for (const field of ['name', 'email', 'phone', 'postcode']) {
    assert.ok(!(field in r), `${field} must not survive redaction`);
  }
  const serialised = JSON.stringify(r);
  for (const value of ['Jane', 'jane@example.com', '07700900000', 'SW11 4NP']) {
    assert.ok(!serialised.includes(value), `"${value}" leaked through redaction`);
  }
  // Non-identifying facts are fine to keep for reporting.
  assert.strictEqual(r.price, 28783);
  assert.strictEqual(r.houseType, 'semi');
});

test('an undated record is never deleted on a guess', () => {
  assert.strictEqual(classifyLead({ id: 'x' }, NOW), 'keep');
  assert.strictEqual(classifyLead({ id: 'x', ts: 'not a date' }, NOW), 'keep');
});

test('lastContactAt restarts the clock, as "from your last contact" implies', () => {
  const old = lead(900, { shared: true });
  assert.notStrictEqual(classifyLead(old, NOW), 'keep');
  old.lastContactAt = ago(10);
  assert.strictEqual(classifyLead(old, NOW), 'keep', 'recent contact should keep it');
});

test('access logs expire at twelve months', () => {
  assert.strictEqual(isExpired({ ts: ago(300) }, PERIODS.accessLogDays, NOW), false);
  assert.strictEqual(isExpired({ ts: ago(400) }, PERIODS.accessLogDays, NOW), true);
  assert.strictEqual(isExpired({ ts: 'rubbish' }, PERIODS.accessLogDays, NOW), false, 'never guess');
});

test('a run plans keeps, redactions and deletions together', () => {
  const leads = [
    lead(10),                              // keep
    lead(300),                             // unshared, past 6 months
    lead(800, { shared: true }),           // redact
    lead(2400, { shared: true }),          // delete
  ];
  const accessLog = [{ ts: ago(30) }, { ts: ago(400) }, { ts: ago(500) }];
  const p = plan(leads, accessLog, NOW);
  assert.strictEqual(p.keep, 1);
  assert.strictEqual(p.redact.length + p.delete.length, 3);
  assert.strictEqual(p.accessLogExpired, 2);
});

test('nothing is touched when everything is inside its period', () => {
  const p = plan([lead(10), lead(20, { shared: true })], [{ ts: ago(5) }], NOW);
  assert.strictEqual(p.redact.length, 0);
  assert.strictEqual(p.delete.length, 0);
  assert.strictEqual(p.accessLogExpired, 0);
});
