/* Named installers at the consent box (consent 2026-10-01, ICO).

   Consent to be contacted has to name who will contact you. The box shows the
   installers for the postcode typed; the lead carries their ids; delivery goes
   to those and nobody else. */

'use strict';

require('./helpers/data-dir');
process.env.LEAD_CAPTURE = 'on';

const { test, before } = require('node:test');
const assert = require('node:assert');
const routing = require('../routing');
const consent = require('../consent');

const PORT = 3313;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
process.env.LEAD_RECIPIENTS = JSON.stringify([
  { id: 'south', name: 'Southside Windows Ltd', url: 'https://127.0.0.1:9/a', areas: ['SW'] },
  { id: 'north', name: 'Northern Frames Ltd', url: 'https://127.0.0.1:9/b', areas: ['M'] },
]);
require('./helpers/email').configureEmail();
const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const post = async (path, body) => {
  const res = await realFetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const lead = (c, postcode = 'SW11 4NP') => post('/api/lead', {
  name: 'Jane', email: 'jane@example.com', postcode, windowStyleId: 'casement',
  consent: { terms: true, version: '2026-10-01', ...c },
});

test('the quote form is told who covers the postcode, by name', async () => {
  const { status, body } = await post('/api/quote-installers', { postcode: 'SW11 4NP', windowStyleId: 'casement' });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.installers, [{ id: 'south', name: 'Southside Windows Ltd' }]);
});

test('a lead stores the names it was given, in the wording, and only those', async () => {
  const { status, body } = await lead({ installerQuotes: true, installerIds: ['south'] });
  assert.strictEqual(status, 200, JSON.stringify(body));
  const c = body.lead.consent;
  assert.deepStrictEqual(c.installerIds, ['south']);
  assert.match(c.wording.installerQuotes, /^Yes, send my details to Southside Windows Ltd so they can quote/);
  assert.doesNotMatch(c.wording.installerQuotes, /\{installers\}/);
});

test('an installer who does not cover the postcode cannot be named into a lead', async () => {
  const { status, body } = await lead({ installerQuotes: true, installerIds: ['south', 'north'] });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.reason, 'installers_changed');
});

test('ticking the box with no names is refused, not sent to whoever covers it', async () => {
  const { status, body } = await lead({ installerQuotes: true });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.reason, 'installers_changed');
});

test('routing never adds anyone the homeowner was not shown', () => {
  const all = [
    { id: 'a', name: 'A', areas: ['SW'] }, { id: 'b', name: 'B', areas: ['SW'] }, { id: 'c', name: 'C', areas: [] },
  ];
  const { chosen } = routing.chooseRecipients(all, { id: 'L', postcode: 'SW11 4NP' }, { max: 3, only: ['b'] });
  assert.deepStrictEqual(chosen.map(r => r.id), ['b']);
});

test('the current wording names the installers and no longer says "vetted"', () => {
  assert.ok(consent.namesInstallers(consent.CURRENT));
  assert.doesNotMatch(consent.VERSIONS[consent.CURRENT].installerQuotes, /vetted/);
  assert.strictEqual(consent.joinNames(['A', 'B', 'C']), 'A, B and C');
});
