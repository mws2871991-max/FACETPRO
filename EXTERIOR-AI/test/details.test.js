/* Window/door and roofline preferences. These capture what the homeowner
   wants and never touch the price — the quote engine prices trim at one
   sourced rate whatever profile is picked, and window/door costs aren't
   modelled at all. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const catalogue = require('../catalogue.json');

const PORT = 3092;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
/* Installer-quotes consent is refused unless we can email the homeowner —
   that is where the withdrawal link lives — so email is made to look
   configured. Nothing is sent; the stub records it. */
require('./helpers/email').configureEmail();

const realFetch = globalThis.fetch;
require('../server');

const post = async (path, body) => {
  const res = await realFetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const lead = (extra) => post('/api/lead', {
  name: 'Jane', email: 'jane@example.com', postcode: 'SW11 4NP',   // required once quotes are asked for
  claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar',
  consent: { terms: true, installerQuotes: true, version: 'v' },
  ...extra,
});

test('both catalogue sections are present and complete', () => {
  const wd = catalogue.windowsDoors;
  assert.strictEqual(wd.windowStyles.length, 4);
  assert.strictEqual(wd.doorStyles.length, 2);
  assert.strictEqual(wd.colours.length, 6);
  for (const c of wd.colours) assert.match(c.hex, /^#[0-9A-Fa-f]{6}$/, `${c.id} needs a hex`);
  for (const s of [...wd.windowStyles, ...wd.doorStyles]) {
    assert.ok(s.name && s.description, `${s.id} needs display copy`);
  }

  const fs = catalogue.fsgc;
  for (const [key, n] of [['fascia', 3], ['soffit', 3], ['guttering', 4], ['cladding', 4]]) {
    assert.strictEqual(fs[key].length, n, `${key} count`);
    for (const item of fs[key]) {
      assert.ok(item.pricePerM > 0, `${item.id} needs a guide rate`);
      assert.ok(item.name && item.tagline, `${item.id} needs display copy`);
    }
  }
});

test('windows and doors carry no pricing, by design', () => {
  // The note is explicit that these can't be priced from a photo. If prices
  // ever appear here the copy on the page becomes wrong.
  const wd = catalogue.windowsDoors;
  assert.match(wd.note, /no price range|Style and colour preview/i);
  for (const s of [...wd.windowStyles, ...wd.doorStyles]) {
    assert.ok(s.pricePerM === undefined && s.priceMin === undefined,
      `${s.id} must not carry a price`);
  }
});

test('the fsgc note keeps flagging that its rates are not the sourced ones', () => {
  // The detailed comparison names quote_generator.py and spells out the
  // material/labour split, so it lives in internalNote and is stripped from
  // the public response. The customer-facing note still has to make clear
  // these are a guide rather than the quote.
  assert.match(catalogue.fsgc.internalNote, /NOT the same numbers|ESTIMATED/);
  assert.match(catalogue.fsgc.note, /guide/i);
  assert.match(catalogue.fsgc.note, /standard|estimate/i);
  // And the real rates must still exist separately for the quote engine.
  const t = catalogue.trimRates;
  assert.ok(t.fasciaPerM > 0 && t.soffitPerM > 0 && t.gutteringPerM > 0);
});

test('preferences are resolved from our catalogue onto the lead', async () => {
  const { status, body } = await lead({
    windowStyleId: 'sliding-sash', doorStyleId: 'bifold', windowDoorColourId: 'chartwell-green',
    fasciaId: 'ogee', soffitId: 'vented', gutteringId: 'aluminium-seamless', rooflineCladdingId: 'brick-slip',
  });
  assert.strictEqual(status, 200);
  const p = body.lead.preferences;
  assert.strictEqual(p.windows.style.name, 'Sliding Sash');
  assert.strictEqual(p.windows.door.name, 'Bifold');
  assert.strictEqual(p.windows.colour.hex, '#5B7C5B');
  assert.strictEqual(p.roofline.fascia.name, 'Ogee');
  assert.strictEqual(p.roofline.soffit.name, 'Vented');
  // Guarantee years are the genuinely useful detail and must survive.
  assert.strictEqual(p.roofline.guttering.guaranteeYears, 40);
  assert.strictEqual(p.roofline.cladding.guaranteeYears, 60);
});

test('a client cannot inject its own products or prices', async () => {
  const { body } = await lead({
    fasciaId: 'flat-18mm',
    preferences: { windows: { style: { name: 'HACKED', pricePerM: 1 } } },
    roofline: { fascia: { name: 'Free', pricePerM: 0 } },
  });
  const serialised = JSON.stringify(body.lead.preferences);
  assert.ok(!serialised.includes('HACKED'), 'client-supplied preferences must be discarded');
  assert.ok(!serialised.includes('Free'), 'client-supplied products must be discarded');
  const real = catalogue.fsgc.fascia.find(f => f.id === 'flat-18mm');
  assert.strictEqual(body.lead.preferences.roofline.fascia.pricePerM, real.pricePerM);
});

test('unknown ids drop out and no preferences means null', async () => {
  const { body } = await lead({ windowStyleId: 'porthole', fasciaId: 'gold-plated' });
  assert.strictEqual(body.lead.preferences, null,
    'nothing valid was chosen, so there is nothing to record');
});

test('preferences never move the price', async () => {
  const withPrefs = await lead({
    footprintM2: 95,
    fasciaId: 'bullnose-22mm', gutteringId: 'aluminium-seamless', rooflineCladdingId: 'brick-slip',
  });
  assert.strictEqual(withPrefs.status, 200);
  const quote = await post('/api/quote', {
    claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', footprintM2: 95,
  });
  // The dearest profiles in the catalogue, and the quote is unchanged —
  // trim is priced at one sourced rate regardless of profile.
  assert.strictEqual(withPrefs.body.lead.price, quote.body.total);
  assert.ok(withPrefs.body.lead.preferences.roofline.cladding.pricePerM > 100,
    'a premium profile really was selected');
});

test('the sections reach the front end', async () => {
  const body = await realFetch(BASE + '/api/catalogue').then(r => r.json());
  assert.ok(body.windowsDoors && body.fsgc);
  assert.strictEqual(body.windowsDoors.windowStyles.length, 4);
  assert.strictEqual(body.fsgc.guttering.length, 4);
});
