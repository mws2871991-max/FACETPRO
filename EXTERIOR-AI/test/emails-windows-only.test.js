'use strict';
/* A windows-only enquiry's emails carry the windows figure and no empty walls
   block. Found in the launch rehearsal (7 Oct 2026): the server prices the
   exterior on every lead, and the emails printed "Scaffolding £0 · Estimated
   total £0, based on a wall area of 90 m²" above the real windows price. */
require('./helpers/data-dir');
const { test } = require('node:test');
const assert = require('node:assert');
const emails = require('../emails');

const lead = { id: 'LD-RH1', name: 'Jane', email: 'jane@example.com', postcode: 'LS1 4AP', measurementSource: 'photo_door',
  glazing: { windowCount: 3, low: 4880, high: 8874 }, consent: { installerQuotes: true } };
const nothingPriced = { cladding: 0, roof: 0, trim: 0, scaffolding: 0, waste: 0, vat: 0, total: 0, footprintM2: 90, selections: {} };
const walls = { cladding: 6370, roof: 0, trim: 0, scaffolding: 1400, waste: 600, vat: 1700, total: 10070, footprintM2: 98, selections: { cladding: 'Alabaster' } };

test('nothing priced on the outside: no £0 block in any of the three emails', () => {
  for (const out of [emails.leadNotificationHtml(lead, nothingPriced, 'https://x'), emails.designPackHtml(lead, nothingPriced, 'https://x', 't', []), emails.designPackText(lead, nothingPriced, 'https://x', 't', [])]) {
    assert.doesNotMatch(out, /Estimated total|Quote total|Scaffolding|Based on a wall area|wall area 90/);
  }
});

test('real wall work is still shown in full', () => {
  const html = emails.designPackHtml(lead, walls, 'https://x', 't', []);
  assert.match(html, /Estimated total/);
  assert.match(html, /Based on a wall area of 98 m²/);
  assert.match(emails.leadNotificationHtml(lead, walls, 'https://x'), /Quote total/);
});
