'use strict';
require('./helpers/data-dir');
/* Developer brief, 6 Oct (§11): the content clusters it named that had no
   page — eight windows, windows + door, windows + roofline, a 3-bed semi, a
   1930s semi. Priced through the engine, in the sitemap, answer first. */
const { test } = require('node:test');
const assert = require('node:assert');
const landing = require('../landing');
const catalogue = require('../catalogue.json');
const glazing = require('../glazing');
const OPTS = { catalogue, siteUrl: 'https://www.facetpro.co.uk', siteMode: 'live' };
const NEW = ['8-window-replacement-cost', 'windows-and-front-door-cost', 'windows-and-roofline-cost', 'replacing-windows-3-bed-semi-cost', 'windows-1930s-semi-cost'];
const money = (n) => '£' + Math.round(n).toLocaleString('en-GB');

test('the five pages exist, are in the sitemap, and lead with the answer', () => {
  const paths = landing.allPaths();
  for (const slug of NEW) {
    assert.ok(paths.includes(`/cost/${slug}`), `${slug} is not in the sitemap`);
    const html = landing.renderCostPage(slug, OPTS);
    assert.match(html, /<strong>The short answer<\/strong><span>£\d/, `${slug} does not lead with a figure`);
  }
});

test('windows and a door quote what the tool quotes for the same job', () => {
  const out = glazing.publishedRange(glazing.estimateGlazing({ rates: catalogue.glazing, houseType: 'semi', windowCountOverride: 8,
    selections: { windowStyleId: 'casement', doorStyleId: 'composite' } }));
  const html = landing.renderCostPage('windows-and-front-door-cost', OPTS);
  assert.ok(html.includes(`${money(out.low)} to ${money(out.high)}`), 'the page and the engine disagree');
});
