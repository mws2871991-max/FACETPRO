'use strict';
/* Conversion wireframes (8 Oct): what was built, and the parts deliberately
   left out because the site could not stand behind them. */
require('./helpers/data-dir');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('1B: no-photo route is a card with its own button beside the upload', () => {
  assert.match(code, /id: 'no-photo-card'/);
  assert.match(code, /Estimate by house type instead/);
});

test('2: after the price, two separate choices; no installer filters that exclude our installers', () => {
  assert.match(code, /Option A \\u00b7 Save your design/);
  assert.match(code, /Option B \\u00b7 Ready for survey quotes\?/);
  assert.doesNotMatch(code, /National Brands|Local Independent Installers Only|FENSA \/ Certass Accredited Only/i);
});

test('3: installer page shows an example lead with the engine figure for that house, and no lead price', () => {
  const sec = html.slice(html.indexOf('<section data-page="installers"'), html.indexOf('</section>', html.indexOf('<section data-page="installers"')));
  assert.match(sec, /Stop paying for cold leads/);
  assert.match(sec, /id="sample-lead"/);
  assert.match(sec, /&pound;7,004&ndash;&pound;12,734/);   // homepage LOOKS anth_comp, engine-checked
  assert.doesNotMatch(sec.replace(/<!--[\s\S]*?-->/g, ''), /Buy this lead|budget-validated|budget consensus/i);
});

test('4: "How we calculate this" uses the engine amounts, not an invented materials/labour split', () => {
  const fn = html.slice(html.indexOf("id: 'how-we-calculate'"), html.indexOf("id: 'how-we-calculate'") + 2500);
  for (const k of ['g.price.supplyFit', 'g.price.doors', 'g.price.access', 'g.price.disposal', 'g.price.vat', 'g.price.total']) assert.ok(fn.includes(k), k);
  assert.doesNotMatch(fn, /Specialist Fitting|Survey Labour/);
});

test('action plan P1: how Facet Pro is paid, said where quotes are asked for', () => {
  assert.match(code, /function howWePaid/);
  assert.ok((code.match(/howWePaid\('/g) || []).length >= 2, 'Option B and the consent box');
  assert.match(code, /Installers pay us when we send them an enquiry, and they can\\u2019t pay to change your estimate/);
});
