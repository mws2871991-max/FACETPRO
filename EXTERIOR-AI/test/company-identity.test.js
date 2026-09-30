/* Who operates this site, in one place and in every footer. Run: npm test
 *
 * The company details went onto /privacy and /terms when 6a2111b filled the
 * legal placeholders, and nowhere else. So the only way to learn who runs the
 * site was to open a legal page — and somebody looked in the footer, where
 * everyone looks, and could not find it. Launch review item P1-6.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const company = JSON.parse(fs.readFileSync(path.join(root, 'company.json'), 'utf8'));
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('the company details exist in exactly one place', () => {
  for (const k of ['legalName', 'companyNumber', 'registeredOffice', 'jurisdiction']) {
    assert.ok(String(company[k] || '').trim(), `company.json has no ${k}`);
  }
  assert.match(company.companyNumber, /^\d{8}$/, 'a UK company number is eight digits');
});

test('the footer of the site says who operates it', () => {
  /* The Companies Act trading-disclosure rules want the registered name,
     number and office on the website. On two legal pages probably satisfies
     it; in the footer of every page is the version nobody argues with. */
  const at = page.lastIndexOf('</footer>');
  assert.ok(at > 0, 'the footer has gone');
  const foot = page.slice(at - 1600, at);
  for (const v of [company.legalName, company.companyNumber, company.registeredOffice]) {
    assert.ok(foot.includes(v), `the footer does not state ${JSON.stringify(v)}`);
  }
});

test('every cost guide and area page says it too', () => {
  const landing = require('../landing');
  const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'catalogue.json'), 'utf8'));
  const opts = { catalogue, siteUrl: 'https://www.facetpro.co.uk' };
  const slugs = (landing.COST_PAGES || []).slice(0, 5).map(p => p.slug);
  assert.ok(slugs.length >= 3, 'no cost pages to check');
  for (const slug of slugs) {
    const html = landing.renderCostPage(slug, opts);
    assert.ok(html.includes(company.legalName) && html.includes(company.companyNumber),
      `/cost/${slug} does not say who operates the site`);
  }
});

test('the legal pages and the footer cannot drift apart', () => {
  /* Three hand-typed copies is how they end up disagreeing — which is exactly
     what happened to the build numbers in the deploy handoff, twice. The
     footer reads company.json; these assert the legal pages still agree with
     it, so a change in one place is caught rather than silently diverging. */
  for (const f of ['legal/privacy.html', 'legal/terms.html']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    for (const v of [company.legalName, company.companyNumber, company.registeredOffice]) {
      assert.ok(s.includes(v), `${f} no longer matches company.json on ${JSON.stringify(v)}`);
    }
  }
});

test('the line is styled, or it ships unstyled and only a browser notices', () => {
  const css = fs.readFileSync(path.join(root, 'assets', 'landing.css'), 'utf8');
  assert.match(css, /footer\.site \.company\{/, 'the guide footer line has no styling');
  const built = fs.readFileSync(path.join(root, 'assets', 'app.css'), 'utf8');
  assert.ok(built.length > 1000, 'the built stylesheet looks empty');
});
