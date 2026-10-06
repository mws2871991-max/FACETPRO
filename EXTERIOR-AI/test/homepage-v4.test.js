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
