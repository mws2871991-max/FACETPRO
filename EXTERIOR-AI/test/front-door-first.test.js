'use strict';
require('./helpers/data-dir');
/* 0085 (5 Oct, outside review): the first screen is the button, windows and
   doors lead, the fine print sits under the choice, and every page a search
   lands on has a way into the uploader before the long read. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const landing = require('../landing');
const OPTS = { catalogue: require('../catalogue.json'), siteUrl: 'https://example.test', siteMode: 'beta' };

const home = () => {
  const at = html.indexOf('id="choose-heading"');
  return html.slice(at, html.indexOf('</section>', at));
};

test('between the h1 and the picture: the offer, the button, the reassurance — nothing else', () => {
  const s = home();
  const top = s.slice(0, s.indexOf('<figure')).replace(/<!--[\s\S]*?-->/g, '');
  assert.match(top, /See my house &amp; price &rarr;/);
  assert.doesNotMatch(top, /Works best on/, 'the fit line belongs under the choice');
  assert.doesNotMatch(s, /See my price<\/button>/, 'one button, not two for the same thing');
});

test('windows and doors lead; the rest of the outside follows, smaller', () => {
  const s = home();
  const rest = s.indexOf('The rest of the outside');
  assert.ok(rest > 0);
  assert.ok(s.indexOf('journey=windows') < rest && s.indexOf('journey=doors') < rest);
  for (const j of ['roofline', 'roof', 'cladding']) assert.ok(s.indexOf(`journey=${j}`) > rest, `${j} should follow`);
  assert.match(html, /New windows &amp; doors &middot; UK/);
});

test('the photo tips are folded under the examples on /design, not above the upload', () => {
  const at = html.indexOf("'Tips for a good photo'");
  assert.ok(at > html.indexOf("'Too close, no door — we size your house against it.'"), 'after the examples');
  assert.ok(html.indexOf('A straight-on photo from across the road') > at - 400);
});

test('no "most popular" claim on the chooser', () => {
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), /most popular/i);
});

test('every area page and the guide index has a button into the tool before the long read', () => {
  const pages = [
    ...landing.AREA_PAGES.map(p => landing.renderAreaPage(p.slug, OPTS)),
    landing.renderCostIndex(OPTS),
  ];
  for (const page of pages) {
    const body = page.slice(page.indexOf('<h1'));
    const hero = body.indexOf('cta=hero');
    assert.ok(hero > 0, 'no button above the content');
    const words = body.slice(0, hero).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(words < 120, `${words} words before the first button`);
    assert.match(body.slice(0, hero + 200), /\/design\?/);
  }
});
