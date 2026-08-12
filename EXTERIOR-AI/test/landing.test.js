/* The landing pages.

   The interesting risk here is not that a page fails to render — it is that a
   page renders beautifully with a wrong number on it. A cost guide that
   disagrees with the visualiser destroys trust in both, and the first draft of
   landing.js did exactly that: it read the root vatPct of 0.2 as a percentage
   and served nine pages understating VAT and waste by about a fifth.

   So most of these tests are about the figures reconciling with the engine, and
   about the honesty rules holding on pages read by people who have not seen
   anything yet.
*/

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const landing = require('../landing');
const glazing = require('../glazing');
const catalogue = require('../catalogue.json');

const OPTS = { catalogue, siteUrl: 'https://www.facetpro.co.uk', siteMode: 'live' };

const allPages = () => [
  ...landing.COST_PAGES.map(p => ({ slug: p.slug, html: landing.renderCostPage(p.slug, OPTS) })),
  ...landing.AREA_PAGES.map(p => ({ slug: p.slug, html: landing.renderAreaPage(p.slug, { ...OPTS, recipients: [] }) })),
];

/* ── THE CONVENTION TRAP ── */

test('percentages are read correctly whichever convention the catalogue uses', () => {
  /* catalogue.json holds VAT as 0.2 at the root and as 20 under glazing. A file
     that picks one silently is a file that understates or overstates every
     figure it produces. */
  const { asFraction, vatMult } = landing._internals;
  assert.strictEqual(asFraction(0.2), 0.2, 'a fraction should stay a fraction');
  assert.strictEqual(asFraction(20), 0.2, 'a percentage should become a fraction');
  assert.strictEqual(asFraction(0.1), 0.1);
  assert.strictEqual(asFraction(10), 0.1);
  assert.strictEqual(vatMult(20), 1.2);
  assert.strictEqual(vatMult(0.2), 1.2);
  /* Missing or nonsense must not silently become a multiplier of 1.2 or NaN. */
  assert.strictEqual(asFraction(undefined), 0);
  assert.strictEqual(asFraction('banana'), 0);
  assert.strictEqual(asFraction(-5), 0);
});

test('VAT is actually applied to wall, roof and roofline figures', () => {
  /* The regression that shipped in the first draft. A £47/m fascia rate that
     comes out at £47 has had 0.2% VAT added, not 20%. */
  const { rooflineFor, wallsFor, roofFor } = landing._internals;
  const r = catalogue.trimRates;
  const netPerM = r.fasciaPerM + r.fasciaLabourPerM + r.soffitPerM + r.soffitLabourPerM
    + r.gutteringPerM + r.gutteringLabourPerM;
  assert.strictEqual(rooflineFor(catalogue, 30).perM, Math.round(netPerM * 1.2),
    'the per-metre roofline figure is not VAT-inclusive');

  const wall = wallsFor(catalogue, 90).rows[0];
  const wallNet = catalogue.cladding[0].pricePerM2 + catalogue.labour.claddingPerM2;
  assert.strictEqual(wall.perM2, Math.round(wallNet * 1.2));

  const roof = roofFor(catalogue, 80)[0];
  const roofNet = catalogue.roof[0].pricePerM2 + catalogue.labour.roofPerM2;
  assert.strictEqual(roof.perM2, Math.round(roofNet * 1.2));
});

test('waste is charged on materials, not on labour', () => {
  /* The rule computePrice applies. A waste allowance is spoiled board, not
     spoiled hours, and applying it to labour inflates every wall figure. */
  const { wallsFor } = landing._internals;
  const m2 = 90;
  const c = catalogue.cladding[0];
  const net = (c.pricePerM2 + catalogue.labour.claddingPerM2) * m2;
  const waste = c.pricePerM2 * m2 * 0.1;
  const expected = Math.round((net + waste + catalogue.scaffoldingCost) * 1.2);
  assert.strictEqual(wallsFor(catalogue, m2).rows[0].total, expected);
});

/* ── RECONCILIATION WITH THE ENGINE ── */

test('window figures come from the pricing engine, not from the copy', () => {
  /* The whole design of landing.js: it calls estimateGlazing rather than
     restating a number. This asserts the page agrees with a direct call for the
     same inputs, so a rate change moves both together or neither. */
  const direct = glazing.estimateGlazing({
    rates: catalogue.glazing,
    houseType: 'semi',
    windowCountOverride: 8,
    selections: { windowStyleId: 'casement', windowDoorColourId: null },
  });
  const html = landing.renderCostPage('window-replacement-cost-uk', OPTS);
  const expected = '£' + Math.round(direct.range.low).toLocaleString('en-GB');
  assert.ok(html.includes(expected),
    `the page does not show the engine's own figure (${expected})`);
});

test('no money figure is hard-coded into the page definitions', () => {
  /* A price typed into prose is a price that will one day contradict the
     product. Every figure must arrive through money() from a computed value. */
  const source = fs.readFileSync(path.join(__dirname, '..', 'landing.js'), 'utf8');
  /* Strip the header comment block, which discusses figures in prose, and the
     CSS, which is full of numbers. */
  const body = source.slice(source.indexOf('const COST_PAGES'));
  const hardCoded = body.match(/£[\d,]+/g) || [];
  assert.deepStrictEqual(hardCoded, [],
    `hard-coded prices found in page copy: ${hardCoded.join(', ')}`);
});

test('the anthracite uplift quoted is the catalogue uplift', () => {
  const html = landing.renderCostPage('anthracite-windows-cost', OPTS);
  const expected = Math.round(((catalogue.glazing.nonWhiteUplift || 1) - 1) * 100);
  assert.ok(html.includes(`About ${expected}%`),
    `the page should quote the catalogue's ${expected}% uplift`);
});

/* ── EVERY PAGE ── */

test('every page renders, and renders something substantial', () => {
  for (const { slug, html } of allPages()) {
    assert.ok(html, `${slug} did not render`);
    /* Thin pages are the failure mode of this whole category. Anything much
       under 4 KB is a stub with a CTA on it. */
    assert.ok(html.length > 4000, `${slug} is only ${html.length} bytes — too thin to be worth serving`);
    assert.match(html, /<h1>/, `${slug} has no h1`);
  }
});

test('an unknown slug renders nothing rather than an empty page', () => {
  assert.strictEqual(landing.renderCostPage('does-not-exist', OPTS), null);
  assert.strictEqual(landing.renderAreaPage('windows-atlantis', { ...OPTS, recipients: [] }), null);
});

test('every page carries the estimate caveat, in one wording', () => {
  /* Two copies of a disclaimer is how they drift. landing.js owns one string
     and no page may override it. */
  for (const { slug, html } of allPages()) {
    assert.ok(html.includes(landing.CAVEAT.slice(0, 60)),
      `${slug} does not carry the estimate caveat`);
    assert.match(html, /not a quotation/, `${slug} does not say it is not a quotation`);
  }
});

test('every page drives to the visualiser with the same call to action', () => {
  for (const { slug, html } of allPages()) {
    assert.ok(html.includes('Upload a photo of your house'),
      `${slug} is missing the primary CTA`);
    assert.ok(html.includes('/#your-photo'), `${slug} does not link into the upload step`);
  }
});

test('the beta notice appears when the site says beta, and not when it does not', () => {
  const beta = landing.renderCostPage('new-roof-cost', { ...OPTS, siteMode: 'beta' });
  const live = landing.renderCostPage('new-roof-cost', { ...OPTS, siteMode: 'live' });
  assert.ok(beta.includes(landing.BETA_NOTICE.slice(0, 40)), 'beta mode should carry the calibration notice');
  assert.ok(!live.includes(landing.BETA_NOTICE.slice(0, 40)), 'live mode should not');
});

test('every page is canonicalised to itself', () => {
  /* Sixteen pages sharing a canonical tag would be sixteen pages asking not to
     be indexed. */
  const seen = new Set();
  for (const p of landing.COST_PAGES) {
    const html = landing.renderCostPage(p.slug, OPTS);
    const m = html.match(/<link rel="canonical" href="([^"]+)"/);
    assert.ok(m, `${p.slug} has no canonical`);
    assert.strictEqual(m[1], `https://www.facetpro.co.uk/cost/${p.slug}`);
    assert.ok(!seen.has(m[1]), `duplicate canonical: ${m[1]}`);
    seen.add(m[1]);
  }
});

test('nothing is interpolated into a page unescaped', () => {
  const html = landing.renderAreaPage('windows-grays', {
    ...OPTS,
    recipients: [{ id: 'x', name: '<script>alert(1)</script>', areas: [], trades: [] }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'a recipient name reached the page as markup');
});

/* ── HONESTY ── */

test('an area with no installer says so instead of implying coverage', () => {
  /* A page headed "Windows in Basildon" implying installers who are not
     configured is a promise the routing cannot keep, and the person who finds
     out is the homeowner who asked. */
  const html = landing.renderAreaPage('windows-basildon', { ...OPTS, recipients: [] });
  assert.match(html, /still signing up installers/i);
  assert.ok(!/\d+ vetted installers?/.test(html), 'it should not claim a number of installers it does not have');
  /* And it still offers the product, because the visualiser works everywhere. */
  assert.ok(html.includes('Upload a photo of your house'));
});

test('an area with installers states the real number', () => {
  const recipients = [
    { id: 'a', name: 'A', areas: ['SS'], trades: [] },
    { id: 'b', name: 'B', areas: [], trades: [] },          // national
    { id: 'c', name: 'C', areas: ['M1'], trades: [] },      // elsewhere
  ];
  const html = landing.renderAreaPage('windows-basildon', { ...OPTS, recipients });
  assert.match(html, /2 vetted installers/, 'should count only those covering SS14');
});

test('no page invents social proof or accreditation', () => {
  /* The four things a competitor's version of these pages opens with, none of
     which we have. Cheaper to catch here than in a regulator's letter. */
  const banned = [
    /\btrusted by\b/i, /\b\d+(,\d+)?\s*(reviews|customers|homeowners served)\b/i,
    /\b\d(\.\d)?\s*\/\s*5\b/, /\bTrustpilot\b/i, /\bas seen (in|on)\b/i,
    /\bMICS\b/, /\baward[- ]winning\b/i, /\bguarantee(d)? (lowest|best) price\b/i,
    /\bno\.?\s*1\b/i, /\bcertificate of measurement\b/i,
  ];
  for (const { slug, html } of allPages()) {
    for (const pattern of banned) {
      assert.doesNotMatch(html, pattern, `${slug} contains an unsubstantiated claim: ${pattern}`);
    }
  }
});

test('no page claims we do the work', () => {
  /* We are a marketplace. "Our fitters" on a cost page is a misrepresentation
     and it is also the claim that would make us liable for the installation. */
  for (const { slug, html } of allPages()) {
    assert.doesNotMatch(html, /\bour (fitters|installers|engineers|team) (will|fit|install)/i, slug);
  }
});

test('the pages need no scripts, so they can serve under the strict CSP', () => {
  /* server.js puts /cost/ and /windows-* on the document CSP, which sets
     script-src to none. An executable script tag would silently stop working. */
  for (const { slug, html } of allPages()) {
    const scripts = html.match(/<script[^>]*>/g) || [];
    for (const tag of scripts) {
      assert.match(tag, /type="application\/ld\+json"/,
        `${slug} has an executable script tag, which the strict CSP will block: ${tag}`);
    }
  }
});

/* ── PLUMBING ── */

test('every landing page is routed, and every route is a real page', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /app\.get\('\/cost\/:slug'/, 'cost pages are not routed');
  assert.match(server, /app\.get\('\/:slug'/, 'area pages are not routed');
  /* allPaths is the single source for the sitemap, so a page cannot exist
     unlisted or be listed without existing. */
  const paths = landing.allPaths();
  assert.strictEqual(paths.length, landing.COST_PAGES.length + landing.AREA_PAGES.length);
  for (const p of paths) assert.match(p, /^\/[a-z0-9/-]+$/, `${p} is not a clean URL`);
  assert.strictEqual(new Set(paths).size, paths.length, 'a path is listed twice');
});

test('the sitemap is generated and the static file is gone', () => {
  /* The static middleware runs before every route, so a sitemap.xml on disk
     would mean the generated route never served a request — the exact shape of
     the bugs HANDOVER.md documents. */
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'sitemap.xml')),
    'a static sitemap.xml is back, and it will shadow the generated one');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /app\.get\('\/sitemap\.xml'/, 'nothing generates the sitemap');
  const publicFiles = server.slice(server.indexOf('const PUBLIC_FILES'), server.indexOf('const PUBLIC_DIRS'));
  assert.ok(!/'\/sitemap\.xml'/.test(publicFiles),
    "sitemap.xml is listed in PUBLIC_FILES again, which shadows the route");
});

test('the area page slugs match the CSP path pattern', () => {
  /* server.js decides the CSP with a regex on the path. A slug that does not
     match it would silently get the app policy, with unsafe-inline scripts
     allowed on a page that has none. */
  const pattern = /^\/windows-[a-z-]+$/;
  for (const p of landing.AREA_PAGES) {
    assert.match(`/${p.slug}`, pattern, `${p.slug} would not get the strict CSP`);
  }
});
