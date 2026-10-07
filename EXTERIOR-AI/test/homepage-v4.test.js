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
  assert.match(h, /og:image" content="https:\/\/www\.facetpro\.co\.uk\/assets\/og-card\.png\?v=2"/);
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

test('the example composite door is what the engine prices it at on a detached house', () => {
  // The demo says its prices are the live engine's, and its house is
  // detached. A door is priced by house type: the cost guides quote a semi
  // (£1,969–£3,579), and "correcting" this demo to that figure on 7 Oct made
  // it wrong. Ask the engine for the detached door, as /api/glazing does.
  const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogue.json'), 'utf8'));
  const glazing = require('../glazing');
  const { money } = require('../landing')._internals;
  const out = glazing.estimateGlazing({ rates: catalogue.glazing, houseType: 'detached', selections: { doorStyleId: 'composite', windowStyleId: 'none', windowDoorColourId: 'black' } });
  const r = glazing.publishedRange(out);
  const shown = [...h.matchAll(/'Composite front door','£([\d,]+)–£([\d,]+)'/g)].map(m => [m[1], m[2]].map(x => Number(x.replace(/,/g, ''))));
  assert.ok(shown.length >= 3);
  // The door on its own is the engine's figure exactly; beside windows the
  // row is the combined total less the windows, so rounding may move it £1.
  assert.strictEqual(`${money(shown[0][0])}–${money(shown[0][1])}`, `${money(r.low)}–${money(r.high)}`);
  for (const [lo, hi] of shown) assert.ok(Math.abs(lo - r.low) <= 1 && Math.abs(hi - r.high) <= 1, `${lo}–${hi}`);
});

test('ad tags ride along from the homepage to the tool', () => {
  assert.match(h, /\['utm_source','utm_medium','utm_campaign'\]/);
  assert.match(h, /a\[href\^="\/design"\]/);
});
