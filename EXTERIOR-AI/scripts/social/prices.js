/* Every price a social post shows, from the engine, on the day the batch is
   made — the rule the launch videos taught (7 Oct): the house type is named,
   because the engine prices a semi and a detached house differently, and
   walls, roof and roofline come from the live site's own quote, which counts
   the scaffold once.

   Windows and doors are priced with this repository's glazing.js — the code
   that is deployed — and each one is cross-checked against the live
   /api/glazing total before it is used. A mismatch stops the build. */

'use strict';

const catalogue = require('../../catalogue.json');
const glazing = require('../../glazing');

const SITE = (process.env.SOCIAL_SITE || 'https://www.facetpro.co.uk').replace(/\/$/, '');

async function post(path, body) {
  const r = await fetch(SITE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return r.json();
}

const money = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;
const range = (r) => `${money(r.low)}–${money(r.high)}`;

/* Windows and/or a door. sel: { houseType, count, colourId, styleId, doorStyleId } */
async function glazingRange({ houseType, count, colourId = null, styleId = 'casement', doorStyleId = 'none' }) {
  const selections = { windowStyleId: count ? styleId : 'none', windowDoorColourId: colourId, doorStyleId };
  const out = glazing.estimateGlazing({ rates: catalogue.glazing, houseType, windowCountOverride: count || undefined, selections });
  const live = await post('/api/glazing', { houseType, windowCount: count || undefined, windowStyleId: selections.windowStyleId, windowDoorColourId: colourId || undefined, doorStyleId });
  if (Math.round(live?.price?.total) !== Math.round(out.price.total)) {
    throw new Error(`Live site and this code disagree on ${JSON.stringify(selections)} for a ${houseType}: ${live?.price?.total} vs ${out.price.total}. Deploy first, or the posts would quote the wrong price.`);
  }
  return glazing.publishedRange(out);
}

/* Walls, roof and/or roofline for a typical house of the type, from the live quote. */
async function exteriorRange({ houseType, claddingId = 'none', trimId = 'none', roofId = 'none' }) {
  const q = await post('/api/quote', { houseType, claddingId, trimId, roofId });
  if (!q?.range) throw new Error('The live quote returned no range');
  return q.range;
}

module.exports = { glazingRange, exteriorRange, money, range, SITE };
