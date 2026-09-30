/* The consent handoff's four gaps (1 October): the privacy notice version and
   the enquiry's source stored with the lead, the installer's permission line,
   and the withdrawal race. */

'use strict';

require('./helpers/data-dir');
process.env.LEAD_CAPTURE = 'on';

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3317;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
process.env.LEAD_RECIPIENTS = JSON.stringify([{ id: 'south', name: 'Southside Windows Ltd', url: 'https://127.0.0.1:9/a', areas: ['SW'] }]);
require('./helpers/email').configureEmail();
const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const lead = async (extra) => {
  const res = await realFetch(BASE + '/api/lead', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Jane', email: 'jane@example.com', postcode: 'SW11 4NP', windowStyleId: 'casement',
      consent: { terms: true, version: '2026-10-01', installerQuotes: true, installerIds: ['south'] }, ...extra }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('the privacy notice version in force is stored with the consent', async () => {
  const { status, body } = await lead({});
  assert.strictEqual(status, 200, JSON.stringify(body));
  const shown = read('legal/privacy.html').match(/Version ([0-9.]+)/)[1];
  assert.strictEqual(body.lead.consent.privacyVersion, shown);
});

test('the enquiry records where it came from, and nothing that is not a tag', async () => {
  const { body } = await lead({ source: { from: 'window-replacement-cost-uk', cta: 'hero', utm_source: 'google',
    utm_medium: 'cpc', utm_campaign: 'windows-oct', utm_term: 'x', evil: '<script>' } });
  assert.deepStrictEqual(body.lead.source, { from: 'window-replacement-cost-uk', cta: 'hero',
    utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'windows-oct' });
  const { body: b2 } = await lead({ source: { from: 'NOT OK!', utm_source: 'a b' } });
  assert.strictEqual(b2.lead.source, null);
});

test('the installer portal says what the homeowner agreed to', () => {
  assert.match(read('index.html'), /contact about this project only, by email, phone or text · no marketing, no passing on/);
});

test('delivery asks again before sending, and tells installers of a withdrawal that lands mid-send', () => {
  const server = read('server.js');
  assert.match(server, /if \(!\(await stillConsentsToShare\(lead\.id\)\)\) \{/);
  assert.match(server, /withheld: 'consent withdrawn before sending'/);
  assert.match(server, /await tellIfWithdrawnDuringDelivery\(lead, results\);/);
});
