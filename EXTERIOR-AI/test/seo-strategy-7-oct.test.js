'use strict';
/* The SEO strategy of 7 Oct: every guide answers in markup, the methodology
   is a page a search can land on, the addresses the strategy names all
   arrive somewhere real, and the homepage tells Google it is an app. */
require('./helpers/data-dir');
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const landing = require('../landing');

const PORT = 3173;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const OPTS = { catalogue: require('../catalogue.json'), siteUrl: 'https://www.facetpro.co.uk', siteMode: 'beta' };
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const types = (html) => JSON.stringify(ld(html)).match(/"@type":"(\w+)"/g).map(t => t.slice(9, -1));

test('every guide carries FAQPage markup', () => {
  for (const p of landing.COST_PAGES) assert.ok(types(landing.renderCostPage(p.slug, OPTS)).includes('FAQPage'), p.slug);
});

test('the methodology page is an indexable guide that says estimate, not quote', () => {
  const html = landing.renderCostPage('how-our-estimates-work', OPTS);
  assert.match(html, /<link rel="canonical" href="https:\/\/www.facetpro.co.uk\/cost\/how-our-estimates-work">/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.match(html, /planning estimate, not a quotation/);
  assert.doesNotMatch(html, /same figure|guaranteed price/i);
});

test('London and the South East have area pages on national rates', () => {
  for (const slug of ['windows-london', 'windows-south-east']) {
    const html = landing.renderAreaPage(slug, { ...OPTS, recipients: [] });
    assert.ok(html, slug);
    assert.match(html, /national fitted rates rather than a local quote/);
  }
  assert.ok(landing.allPaths().includes('/windows-london'));
});

test('the addresses the strategy names all land on a real page', async () => {
  const cases = {
    '/costs/replacement-windows': '/cost/window-replacement-cost-uk',
    '/costs/composite-front-doors': '/cost/composite-door-cost',
    '/costs/bifold-doors': '/cost/bifold-doors-cost',
    '/costs/window-replacement-london': '/windows-london',
    '/costs/replacement-windows-south-east': '/windows-south-east',
    '/window-replacement-cost-guide': '/cost/window-replacement-cost-uk',
    '/how-our-estimates-work': '/cost/how-our-estimates-work',
    '/costs': '/cost',
  };
  for (const [from, to] of Object.entries(cases)) {
    const res = await realFetch(BASE + from, { redirect: 'manual' });
    assert.strictEqual(res.status, 301, from);
    assert.strictEqual(new URL(res.headers.get('location'), BASE).pathname, to, from);
  }
  assert.strictEqual((await realFetch(BASE + '/costs/nothing-here', { redirect: 'manual' })).status, 404);
});

test('the homepage marks up the tool as a web application', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'home.html'), 'utf8');
  assert.ok(types(home).includes('WebApplication'));
  assert.ok(home.includes('href="/cost/how-our-estimates-work"'));
});
