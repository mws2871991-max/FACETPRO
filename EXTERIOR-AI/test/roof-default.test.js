/* The roof the visualiser opens on, against the roof the page advertises.

   /cost/new-roof-cost leads with "From about £138 per m²" and a £12,864
   worked example. Both are Charcoal, because the page picks the cheapest
   covering in the catalogue and quotes it. The visualiser opened on Slate at
   £246 per m² — so a customer who clicked "Show me my roof" out of that
   sentence met a number 78% higher than the one that brought them there, and
   nothing on the way explained it.

   Two numbers in two files, derived two different ways, that have to agree.
   That is the shape of a thing that will not stay agreed, so this asserts it
   rather than trusting it: if a supplier rate change makes Terracotta the
   cheapest covering, the page will start leading with Terracotta on its own
   and this test fails until the visualiser follows. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalogue.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* The cost page's own arithmetic, from landing.js roofFor(). Repeated here
   rather than imported because what is being checked is that two independent
   derivations agree — importing the one under test would only prove it equals
   itself. */
const asFraction = (n) => (n > 1 ? n / 100 : n);

function cheapestCovering() {
  const labour = catalogue.labour?.roofPerM2 || 0;
  const vat = 1 + asFraction(catalogue.vatPct);
  return (catalogue.roof || [])
    .map(r => ({ id: r.id, name: r.name, perM2: Math.round((r.pricePerM2 + labour) * vat) }))
    .reduce((a, b) => (a.perM2 <= b.perM2 ? a : b));
}

test('the visualiser opens the roof journey on the covering the cost page leads with', () => {
  const m = html.match(/const ROOF_JOURNEY_DEFAULT = '([a-z0-9-]+)'/);
  assert.ok(m, 'ROOF_JOURNEY_DEFAULT has gone from index.html — if the roof journey ' +
    'default moved somewhere else, retarget this test rather than dropping it');

  const cheapest = cheapestCovering();
  assert.strictEqual(m[1], cheapest.id,
    `the roof journey opens on "${m[1]}" while /cost/new-roof-cost leads with ` +
    `"${cheapest.name}" at £${cheapest.perM2}/m². A customer arriving from that ` +
    'sentence would be shown a different covering at a different price with no ' +
    'explanation. Either follow the page, or change what the page leads with.');
});

test('that default really is in the catalogue', () => {
  const id = html.match(/const ROOF_JOURNEY_DEFAULT = '([a-z0-9-]+)'/)[1];
  assert.ok((catalogue.roof || []).some(r => r.id === id),
    `"${id}" is not a roof in catalogue.json, so findSwatch falls back to SWATCHES[0] ` +
    '— which is a cladding colour, not a roof');
});

test('the journeys that are not about roofs still open on Slate', () => {
  /* Charcoal is right for somebody who came to price a re-roof, because that
     is the figure they were quoted on the way in. It is not automatically the
     right first look for everyone else, and AUTO_DEFAULTS picks per house
     type on purpose. This pins that the change stayed inside the roof
     journey. */
  assert.match(html, /readJourney\(\) === 'roof' \? ROOF_JOURNEY_DEFAULT : 'slate-roof'/,
    'the initial state no longer distinguishes the roof journey from the rest');
  assert.match(html, /id === 'roof' \? ROOF_JOURNEY_DEFAULT : 'slate-roof'/,
    'applyJourney no longer distinguishes the roof journey from the rest');
});

test('the roof area used for pricing is reported, not just the wall area', () => {
  /* The review asked for this directly: the breakdown stated "Based on 85 m²
     of wall" under a £9,584 roof line priced on 46.75 m² of roof, so the one
     number the figure came from was the one never shown. A roofer quotes per
     m² of roof, and the homeowner had nothing to compare. */
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /roofM2: roof \?/,
    'computePrice no longer returns roofM2, so the breakdown cannot state its basis');
  assert.match(html, /m² of roof/,
    'the breakdown no longer shows the roof area');
});

test('the unsourced roof-area ratio is still flagged as unsourced', () => {
  /* 0.55 has no basis anywhere in the repository and decides an entire trade.
     It is allowed to stay — changing it moves every roof price on the site,
     which is a commercial decision — but it is not allowed to go quiet again.
     If somebody sources it, they should delete this test along with the note. */
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /ROOF_AREA_FROM_WALL/,
    'the ratio is back to being a bare number in an expression');
  assert.ok(fs.existsSync(path.join(ROOT, 'notes', 'roof-area-needs-a-source.md')),
    'the note explaining what this number needs has gone; the code points at it');
});

test('the stated basis names the trade that was priced, in its own unit', () => {
  /* Three panels said "of wall" whatever was on the estimate. A roof-only job
     announced 85 m² of wall and priced none; a roofline-only job announced the
     same, while fascia, soffit and guttering are priced by the metre along the
     eaves. The quantity, the unit and the trade were all wrong, in the line
     whose entire job is to say where the number came from. */
  const fn = html.match(/function areaBasis\(price\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'areaBasis() has gone; the two panels are free to disagree again');
  const src = fn[0];

  assert.match(src, /priced\.includes\('cladding'\)[\s\S]*?footprintM2/,
    'wall area must be gated on cladding actually being priced');
  assert.match(src, /priced\.includes\('roof'\)[\s\S]*?roofM2/,
    'roof area must be gated on the roof actually being priced');
  assert.match(src, /priced\.includes\('trim'\)[\s\S]*?trimLengthM/,
    'roofline is priced by the metre and must be reported that way');

  // And both panels go through it, rather than one keeping a copy.
  const callers = html.match(/areaBasis\(price\)/g) || [];
  assert.ok(callers.length >= 2,
    `only ${callers.length} panel(s) use areaBasis — the other one has drifted back to its own wording`);
});
