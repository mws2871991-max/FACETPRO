'use strict';
/* The Facet Pro price promise (pricepromise.js): within the range, never more
   than 13% above it for the job chosen. Off until PRICE_PROMISE=on, which is
   set only once the installers have signed it. */
require('./helpers/data-dir');
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pp = require('../pricepromise');
const emails = require('../emails');
const { forInstaller } = require('../leadview');

const PORT = 3175;
const BASE = `http://127.0.0.1:${PORT}`;
delete process.env.PRICE_PROMISE;
process.env.PORT = String(PORT);
const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

test('the limit is 13% above the top of the range, per part', () => {
  assert.strictEqual(pp.CAP, 0.13);
  assert.strictEqual(pp.capAt(14128), 15965);
  const out = pp.forLead({ glazing: { marketRange: { low: 7770, high: 14128 } }, exterior: { low: 23500, high: 31500 } });
  assert.deepStrictEqual(out.parts.map(p => [p.what, p.capAt]), [['Windows and doors', 15965], ['Walls, roof and roofline', 35595]]);
  assert.strictEqual(pp.forLead({}), null);
  assert.doesNotMatch(out.wording, /guarantee|price match/i);
});

test('off by default: no config, no terms page', async () => {
  assert.strictEqual(pp.enabled(), false);
  const cfg = await (await realFetch(BASE + '/api/config')).json();
  assert.strictEqual(cfg.pricePromise, null);
  assert.strictEqual((await realFetch(BASE + '/price-promise')).status, 404);
});

test('switched on, the terms page is served and says what it is not', async () => {
  process.env.PRICE_PROMISE = 'on';
  try {
    const res = await realFetch(BASE + '/price-promise');
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /never more than 13% above it/);
    assert.match(html, /not a fixed price, a guarantee of your final price or a price match/);
    assert.match(html, /&pound;15,965/);
  } finally { delete process.env.PRICE_PROMISE; }
});

test('emails carry the limits only when the lead carries the promise', () => {
  const promise = pp.forLead({ glazing: { marketRange: { low: 7770, high: 14128 } } });
  const lead = { id: 'LD-PP1', name: 'Jane', postcode: 'LS1 4AP', consent: { installerQuotes: true }, pricePromise: promise };
  const recipients = [{ name: 'Anglian' }];
  assert.match(emails.leadNotificationHtml(lead, null, 'https://x'), /Price promise[\s\S]*£15,965/);
  assert.match(emails.sharingConfirmationHtml(lead, recipients, 'https://www.facetpro.co.uk', 't'), /The Facet Pro price promise[\s\S]*£15,965[\s\S]*\/price-promise/);
  assert.match(emails.sharingConfirmationText(lead, recipients, 'https://www.facetpro.co.uk', 't'), /up to £15,965/);
  const without = { ...lead, pricePromise: undefined };
  assert.doesNotMatch(emails.leadNotificationHtml(without, null, 'https://x'), /Price promise/);
  assert.doesNotMatch(emails.sharingConfirmationHtml(without, recipients, 'https://x', 't'), /price promise/i);
  // no installers, no promise to make
  assert.doesNotMatch(emails.sharingConfirmationHtml(lead, [], 'https://x', 't'), /price promise/i);
});

test('the installer receives the limits with the lead', () => {
  const promise = pp.forLead({ glazing: { marketRange: { low: 7770, high: 14128 } } });
  assert.deepStrictEqual(forInstaller({ id: 'LD-PP2', pricePromise: promise }).pricePromise, promise);
});

test('the page shows the promise only when the server says it is in force', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fn = index.slice(index.indexOf('function pricePromiseNote'), index.indexOf('function consentBox'));
  assert.match(fn, /if \(!state\.pricePromise \|\| !state\.installerQuotesAvailable\) return null;/);
  assert.match(index, /state\.pricePromise = cfg\.pricePromise && Number\(cfg\.pricePromise\.capPercent\) > 0/);
});
