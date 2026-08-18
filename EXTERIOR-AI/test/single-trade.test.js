/* Somebody who wants one trade, not the whole outside of their house.

   Every pricing path used to fill in what the visitor had not chosen, and
   always upward. A missing roofId meant `catalogue.roof[0]`, not "no roof". A
   missing window style meant a multiplier of 1, not "the windows are staying".
   Measured on the default 95 m² house, before this:

     a composite front door   £7,451–£13,837, of which £1,667 was the door
     walls rendered           £27,372, of which £6,175 was render
     a conservatory           £27,372 and the conservatory not priced at all

   The defaults were silent and they never argued downward, which is the part
   that matters: an installer pays £100 for a lead whose headline figure
   describes work the homeowner never asked for, and finds out at survey.

   `'none'` is how a caller says "not this trade". An ABSENT field still takes
   the catalogue default — that is deliberate, so a client that has never heard
   of opting out behaves exactly as it did, and it is the first thing asserted
   below. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

process.env.LEAD_CAPTURE = 'on';   // this file saves a lead

const PORT = 3213;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);

const glazing = require('../glazing');
const catalogue = require('../catalogue.json');
const leadscore = require('../leadscore');
const emails = require('../emails');
const store = require('../store');
require('../server');   // PORT must be set before this line

before(async () => { await require('./helpers/server-ready')(BASE); });

const quote = async (body) => {
  const res = await fetch(`${BASE}/api/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 200, 'quote should price');
  return res.json();
};

const glaze = (selections) => glazing.estimateGlazing({
  detections: [], houseType: 'semi', selections, rates: catalogue.glazing,
});

/* ── the walls ────────────────────────────────────────────────────────── */

test('omitting a trade still prices it, so old clients do not change', async () => {
  const p = await quote({ claddingId: 'alabaster' });
  assert.deepStrictEqual(p.priced, ['cladding', 'roof', 'trim'],
    'an absent roofId means "not specified", not "not wanted"');
  assert.ok(p.roof > 0 && p.trim > 0);
});

test('rendering the walls does not buy a roof and new fascias', async () => {
  const all = await quote({ claddingId: 'alabaster' });
  const walls = await quote({ claddingId: 'alabaster', roofId: 'none', trimId: 'none' });

  assert.deepStrictEqual(walls.priced, ['cladding']);
  assert.strictEqual(walls.roof, 0, 'a roof nobody asked for must cost nothing');
  assert.strictEqual(walls.trim, 0);
  assert.ok(walls.total < all.total / 2,
    `walls-only should be far below the whole exterior — got ${walls.total} against ${all.total}`);
});

test('scaffolding follows the walls, not the roof', async () => {
  /* Rendering a two-storey house needs a scaffold just as much as re-roofing
     does, which is why the walls-only calculator has always charged it. The
     mistake would be tying it to the roof and quietly dropping it. */
  const walls = await quote({ claddingId: 'alabaster', roofId: 'none', trimId: 'none' });
  assert.strictEqual(walls.scaffolding, catalogue.scaffoldingCost);
});

test('choosing no work at all costs nothing, not a floor of scaffolding and VAT', async () => {
  const nothing = await quote({ claddingId: 'none', roofId: 'none', trimId: 'none' });
  assert.deepStrictEqual(nothing.priced, []);
  assert.strictEqual(nothing.total, 0);
  assert.strictEqual(nothing.scaffolding, 0, 'nothing to reach means nothing to stand on');
  assert.strictEqual(nothing.vat, 0);
});

test('an excluded trade is absent from selections, not named', async () => {
  /* Otherwise the lead, the installer portal and the homeowner's email all
     print a roof finish for a roof that is not being done. */
  const walls = await quote({ claddingId: 'alabaster', roofId: 'none', trimId: 'none' });
  assert.ok(walls.selections.cladding, 'the chosen finish is still named');
  assert.ok(!('roof' in walls.selections), 'an excluded trade must not be named');
  assert.ok(!('trim' in walls.selections));
});

/* ── the glazing ──────────────────────────────────────────────────────── */

test('a front door on its own is priced as a front door', () => {
  const r = glaze({ doorStyleId: 'composite', windowStyleId: 'none' });
  const door = catalogue.glazing.doors.find(d => d.id === 'composite').supplyFit;

  assert.strictEqual(r.price.windowsIncluded, false);
  assert.strictEqual(r.price.supplyFit, 0, 'windows that are staying cost nothing');
  assert.strictEqual(r.price.doors, door);
  assert.ok(r.range.low < door * 2,
    `a £${door} door should not open at £${r.range.low}`);
});

test('no scaffold tower to fit a front door', () => {
  /* The access charge fires on any upstairs window. Upstairs windows are not
     involved in fitting a door, and £780 was the single largest line on the
     old door-only figure after the windows themselves. */
  const r = glaze({ doorStyleId: 'composite', windowStyleId: 'none' });
  assert.strictEqual(r.price.access, 0);
});

test('one door disposed of, not one door and every window in the house', () => {
  const r = glaze({ doorStyleId: 'composite', windowStyleId: 'none' });
  assert.strictEqual(r.price.disposal, catalogue.glazing.disposalPerUnit);
});

test('the minimum job charge finally reaches the jobs it was written for', () => {
  /* minJobCharge has always been in the catalogue and was unreachable: the
     whole-house window total buried it every time. A single uPVC door is
     exactly the case it exists for — the van, the survey and the day are the
     same whether it is one door or eleven windows. */
  const r = glaze({ doorStyleId: 'upvc', windowStyleId: 'none' });
  assert.strictEqual(r.price.minimumApplied, true);
  assert.ok(r.price.total >= catalogue.glazing.minJobCharge);
});

test('asking for windows still prices windows', () => {
  const r = glaze({ windowStyleId: 'casement', doorStyleId: 'composite' });
  assert.strictEqual(r.price.windowsIncluded, true);
  assert.ok(r.price.supplyFit > 0);
  assert.ok(r.price.access > 0, 'upstairs windows still need access');
});

test('declining the front door is not a catalogue lookup for a door called none', () => {
  /* doorSelections was [doorStyleId].filter(Boolean), so 'none' passed straight
     through to rates.doors.find(...) and threw. The endpoint would have 500'd
     the moment the UI could offer the option. */
  const r = glaze({ windowStyleId: 'casement', doorStyleId: 'none' });
  assert.strictEqual(r.price.doors, 0);
  assert.ok(r.price.supplyFit > 0, 'the windows they did ask for still price');
});

test('declining everything is £0, not the minimum job charge', () => {
  /* Every line is zero, and a £950 floor applied to that quotes somebody for
     declining. The minimum exists for small jobs, not for no job. */
  const r = glaze({ windowStyleId: 'none', doorStyleId: 'none' });
  assert.strictEqual(r.price.total, 0);
  assert.strictEqual(r.price.minimumApplied, false);
});

/* ── the conservatory ─────────────────────────────────────────────────── */

test('a conservatory enquiry is not dressed as a whole-house refit', async () => {
  /* The installer pays £100 for this. Sending it with a headline price of
     £27,372 of render, roof and fascias means they ring expecting an exterior
     job and find a conservatory — the product misdescribing what it sells to
     the person buying it. */
  const res = await fetch(`${BASE}/api/lead`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Jane Smith', email: 'jane@example.com', phone: '07700900000', postcode: 'SW11 4NP',
      claddingId: 'none', roofId: 'none', trimId: 'none',
      conservatoryStyleId: 'orangery',
      consent: { terms: true },
    }),
  });
  const body = await res.clone().text();
  assert.strictEqual(res.status, 200, `lead should save — got ${res.status}: ${body.slice(0, 300)}`);

  /* Read through the store, not off the disk. leads.jsonl only exists on the
     JSONL fallback; production runs Postgres, where reading a file finds
     nothing and the test fails for a reason that has nothing to do with what
     it is checking. */
  const all = await store.readAll('leads');
  const lead = all[all.length - 1];

  assert.strictEqual(lead.price, null, 'no priced work means no price, not a wrong one');
  assert.strictEqual(lead.priceBreakdown, null);
  assert.deepStrictEqual(lead.selections, {}, 'no finishes to name');
  assert.ok(lead.conservatory, 'the thing they actually asked about survives');
  assert.strictEqual(lead.conservatory.indicative, true);
});

/* ── the emails ───────────────────────────────────────────────────────── */

/* These templates read price.selections.cladding/trim/roof straight through.
   Making a trade optional broke both without a single test noticing: a
   walls-only lead printed "Alabaster (Render) / undefined / undefined", and a
   conservatory-only lead threw outright on a null price. Neither could fire
   while RESEND_API_KEY was unset — which is exactly why it had to be found
   before it was set, since configuring email is the next job. */
const emailFixtures = {
  lead: {
    id: 'LD-EMAILTEST', name: 'Jane Smith', email: 'jane@example.com',
    phone: '07700900000', postcode: 'SW11 4NP', measurementSource: 'default_footprint',
    conservatory: { id: 'orangery', name: 'Orangery', priceMin: 25000, priceMax: 45000, indicative: true },
  },
  wallsOnly: {
    total: 8940, footprintM2: 95, priced: ['cladding'],
    cladding: 6175, roof: 0, trim: 0, scaffolding: 800, waste: 400, vat: 1490,
    selections: { cladding: 'Alabaster (Render)' },
  },
};

test('the installer email names only the work that was chosen', () => {
  const html = emails.leadNotificationHtml(emailFixtures.lead, emailFixtures.wallsOnly);
  assert.ok(!/undefined/.test(html), 'no undefined anywhere in an installer email');
  assert.match(html, /Alabaster \(Render\)/);
  assert.ok(!/Slate Roof/.test(html));
});

test('an email survives a lead with no priced work at all', () => {
  const html = emails.leadNotificationHtml(emailFixtures.lead, null);
  assert.ok(!/undefined/.test(html));
  assert.match(html, /No wall, roof or roofline work chosen/);
  assert.match(html, /Orangery/, 'the conservatory is what this lead is about');
});

test('the homeowner design pack survives both shapes', () => {
  for (const price of [emailFixtures.wallsOnly, null]) {
    const html = emails.designPackHtml(emailFixtures.lead, price, 'https://example.com', 'tok', []);
    assert.ok(html.length > 200, 'a design pack should still be a design pack');
    assert.ok(!/undefined/.test(html), `undefined leaked into the design pack for ${price ? 'walls-only' : 'no priced work'}`);
  }
});

test('a lead records where it came from, and refuses an invented source', async () => {
  const save = (journeySource) => fetch(`${BASE}/api/lead`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Jane Smith', email: 'jane@example.com', phone: '07700900000', postcode: 'SW11 4NP',
      claddingId: 'alabaster', journeySource, consent: { terms: true },
    }),
  });

  assert.strictEqual((await save('doors')).status, 200);
  let all = await store.readAll('leads');
  assert.strictEqual(all[all.length - 1].journeySource, 'doors');

  /* An allowlist, not a passthrough: this reaches the installer portal and
     eventually routing, so a client must not be able to write arbitrary text
     into it. */
  assert.strictEqual((await save('<script>alert(1)</script>')).status, 200);
  all = await store.readAll('leads');
  assert.strictEqual(all[all.length - 1].journeySource, null);
});

test('the lead is priced for the house the homeowner said they had', async () => {
  /* /api/quote passed houseType to resolveFootprint and /api/lead did not, so
     somebody who picked "Detached" without uploading a photo saw a detached
     price and had a 95 m² semi price stored and emailed to the installer. The
     whole suite passed before the fix and after it, which is why this exists:
     nothing compared the two endpoints for the same inputs. */
  const body = { houseType: 'detached', claddingId: 'alabaster' };

  const quote = await (await fetch(`${BASE}/api/quote`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })).json();

  const res = await fetch(`${BASE}/api/lead`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...body, name: 'Jane Smith', email: 'jane@example.com',
      phone: '07700900000', postcode: 'SW11 4NP', consent: { terms: true },
    }),
  });
  assert.strictEqual(res.status, 200);

  const all = await store.readAll('leads');
  const lead = all[all.length - 1];

  assert.strictEqual(lead.priceBreakdown.footprintM2, quote.footprintM2,
    `the installer must be sent the area the homeowner was shown: lead ${lead.priceBreakdown.footprintM2} m² against quote ${quote.footprintM2} m²`);
  assert.strictEqual(lead.price, quote.total,
    `and the same total: lead £${lead.price} against quote £${quote.total}`);
});

test('a conservatory carries its value into the lead score', () => {
  /* projectValueOf read lead.conservatory.price, which has never existed —
     the guide band is priceMin/priceMax. Every conservatory enquiry scored
     zero value, which went unnoticed while a whole-house wall price was
     always there to hide it. */
  const style = catalogue.conservatories.styles.find(s => s.id === 'orangery');
  const lead = { conservatory: { id: 'orangery', priceMin: style.priceMin, priceMax: style.priceMax, indicative: true } };
  const value = leadscore.projectValueOf
    ? leadscore.projectValueOf(lead)
    : leadscore.score(lead).projectValue;

  const midpoint = (style.priceMin + style.priceMax) / 2;
  assert.ok(value >= midpoint * 0.9,
    `an orangery enquiry should be worth about £${midpoint}, scored £${value}`);
});
