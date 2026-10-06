/* The site may not quote two prices for one job. Run: npm test
 *
 * Both from the launch review of 29 September. They are the same kind of
 * fault: a guide and the visualiser, or a guide and itself, disagreeing about
 * what a customer will pay — which is the fastest way to lose the trust this
 * whole product runs on.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogue.json'), 'utf8'));
const landing = require('../landing');

const page = (slug) => {
  const p = (landing.COST_PAGES || []).find(x => x.slug === slug);
  assert.ok(p, `no page with slug ${slug}`);
  return p.build(catalogue);
};
const poundsIn = (s) => [...String(s).matchAll(/£([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, '')));

test('the scaffold goes up once, however many trades are done off it', () => {
  /* wallsFor, rooflineFor and roofFor each include a full scaffold, because
     each is also sold on its own page where it is genuinely theirs. The
     whole-exterior guide added all three totals and charged £2,880 of
     scaffolding on a job needing £960 — while its own "What moves the price"
     section said doing the work together "saves paying twice for the same
     scaffold". £1,920 too high, and the page contradicted itself. */
  const built = page('house-exterior-renovation-cost');
  const table = built.sections.find(s => s.table && /itemised/i.test(s.heading));
  assert.ok(table, 'the itemised table has gone');

  const scaffoldRows = table.table.rows.filter(r => /scaffold/i.test(r[0]));
  assert.strictEqual(scaffoldRows.length, 1, 'the scaffold should appear exactly once, as its own row');

  const vat = 1 + (catalogue.vatPct ?? 0.2);
  /* One scaffold for a typical semi (scaffold.js scales it with wall area since 6 Oct). */
  const expected = Math.round(require('../scaffold').scaffoldingFor(catalogue, 85) * vat);
  assert.deepStrictEqual(poundsIn(scaffoldRows[0][1]), [expected],
    `the scaffold row should be one scaffold inc VAT (£${expected})`);

  /* And the column has to add up to the headline, or the reader is being
     asked to take it on faith. */
  const rowTotals = table.table.rows.map(r => poundsIn(r[1]));
  const lows = rowTotals.reduce((a, v) => a + (v[0] || 0), 0);
  const [answerLow] = poundsIn(built.answer);
  assert.ok(Math.abs(lows - answerLow) <= 2,
    `the itemised rows total £${lows} but the answer says £${answerLow}`);
});

test('a guide quotes the same roof the visualiser will quote', () => {
  /* /cost/new-roof-cost priced a flat 80 m² while the tool derived 85 × 0.55 =
     47 for a semi: about £12,900 on the page against about £7,900 in the tool
     it links to, for the same re-roof, with nothing explaining the gap. */
  const ratio = catalogue.wholeHouse?.roofAreaFromWall;
  assert.ok(typeof ratio === 'number' && ratio > 0,
    'the roof ratio is no longer in the catalogue, so the two can drift apart again');

  const expected = Math.round(85 * ratio);   // measure.HOUSE_TYPE_PRIORS.semi.wallM2
  for (const slug of ['new-roof-cost', 'house-exterior-renovation-cost']) {
    const built = page(slug);
    const text = JSON.stringify(built);
    assert.ok(text.includes(`${expected} m²`),
      `${slug} does not quote the ${expected} m² roof the visualiser would`);
    assert.ok(!/\b80 m²/.test(text), `${slug} still quotes an 80 m² roof`);
  }
});

test('the server reads that ratio rather than keeping its own copy', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const ROOF_AREA_FROM_WALL = catalogue\.wholeHouse\?\.roofAreaFromWall/,
    'the visualiser has gone back to a hard-coded roof ratio');
});

test('the ratio still says out loud that nobody has checked it', () => {
  /* Making two numbers agree is not the same as either being right. 0.55 is
     roughly the PLAN area of a semi — it ignores the pitch, and a 35° roof
     covers about 1.22× its plan. The warning has to travel with the number. */
  const note = String(catalogue.wholeHouse?.roofAreaFromWallNote || '');
  assert.match(note, /UNSOURCED/, 'the warning has been dropped from the catalogue');
  assert.match(note, /roof-area-needs-a-source/, 'it no longer points at the note that explains it');
});
