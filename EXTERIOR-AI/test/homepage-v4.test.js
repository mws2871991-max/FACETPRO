'use strict';
require('./helpers/data-dir');
/* The v4 homepage (home.html, served at /) arrived as a bare design file:
   no doctype, no viewport, none of the old homepage's head. These are the
   things it must not lose again. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'home.html'), 'utf8');

test('a real document a phone lays out at its own width', () => {
  assert.match(h, /^<!DOCTYPE html>\n<html lang="en-GB">/);
  assert.match(h, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(h, /<meta charset="UTF-8">/);
});

test('keeps the Pinterest claim, the share card and the canonical', () => {
  assert.match(h, /<meta name="p:domain_verify" content="f04c9c0b39fbb4b990b9484ccbacb629"\/>/);
  assert.match(h, /og:image" content="https:\/\/www\.facetpro\.co\.uk\/assets\/og-card\.png"/);
  assert.match(h, /<link rel="canonical" href="https:\/\/www\.facetpro\.co\.uk\/">/);
  assert.match(h, /rel="manifest"/);
});

test('says Facet Pro, not the design file\'s ProFacet', () => {
  assert.doesNotMatch(h, /ProFacet|PROFACET/);
});

test('still counts homepage visits and clicks through to the tool', () => {
  for (const stage of ['landing', 'homepage_view', 'cta_clicked']) assert.match(h, new RegExp(`'${stage}'`));
  assert.match(h, /'\/api\/funnel'/);
});

test('every in-page link on the homepage has somewhere to land', () => {
  const ids = new Set([...h.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const [, a] of h.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(a), `#${a} goes nowhere`);
});

test('the example composite door is what the engine prices a composite door at', () => {
  // The demo says its prices are the live engine's. The door was cut 20% on
  // 5 Oct and the design file still had the old figure; read it from the
  // same path the cost guides use, so the next price change fails here.
  const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogue.json'), 'utf8'));
  const { doorPrices, money } = require('../landing')._internals;
  const d = doorPrices(catalogue).find(x => /composite/i.test(x.name));
  const range = `${money(d.low)}–${money(d.high)}`;
  const shown = [...h.matchAll(/'Composite front door','([^']+)'/g)].map(m => m[1]);
  assert.ok(shown.length >= 3);
  for (const s of shown) assert.strictEqual(s, range);
});

test('ad tags ride along from the homepage to the tool', () => {
  assert.match(h, /\['utm_source','utm_medium','utm_campaign'\]/);
  assert.match(h, /a\[href\^="\/design"\]/);
});
