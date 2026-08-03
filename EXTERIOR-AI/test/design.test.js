/* The design pass — the parts of it that are assertions rather than taste.

   These read index.html rather than driving it, for the same reason the
   glazing-freshness tests do: the front end is inline in that file and the
   suite has no DOM. They are a tripwire for the intent being lost, not proof
   the page looks right. Someone still has to look at it. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fontsCss = fs.readFileSync(path.join(root, 'assets', 'fonts.css'), 'utf8');

/* ── D-1 · a measured number should look measured ── */

test('every face the page uses is served from here', () => {
  /* Adding a third-party font origin back would undo the CSP work: the app
     policy now has no external origin at all, and Google Fonts has been
     litigated on exactly this. */
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), 'the page asks Google for a font again');
  for (const family of ['Geist', 'Instrument Serif', 'JetBrains Mono']) {
    assert.ok(fontsCss.includes(`font-family: '${family}'`), `${family} is not declared`);
  }
  for (const file of ['geist-variable.woff2', 'instrument-serif-400.woff2', 'jetbrains-mono-variable.woff2']) {
    assert.ok(fs.existsSync(path.join(root, 'assets', 'fonts', file)), `${file} is referenced but missing`);
    assert.ok(fontsCss.includes(file), `${file} is present but never declared`);
  }
});

test('measured figures are set in the mono, with tabular numerals', () => {
  // A column of prices that does not line up, or a total that shuffles
  // sideways as it changes, is the thing tabular figures exist to stop.
  assert.match(html, /\.measured\{[^}]*JetBrains Mono/);
  assert.match(html, /\.measured\{[^}]*tabular-nums/);
  const uses = (html.match(/className: 'measured|className: `measured| measured /g) || []).length;
  assert.ok(uses >= 5, `only ${uses} measured figures — the estimate build-up should be one`);
});

/* ── D-2 · the number you are deciding on, without scrolling ── */

test('the total bar shows composition, not just a number', () => {
  const start = html.indexOf('function buildTotalBar');
  const body = html.slice(start, html.indexOf('function buildDetailOptions'));
  assert.match(body, /window\$\{n === 1/, 'it should say how many windows');
  assert.match(body, /m² of wall/);
  assert.match(body, /inc VAT/);
  assert.match(body, /See breakdown/, 'one place owns the itemisation; this links to it');
});

test('the two figures are shown separately, never summed', () => {
  /* The cladding total is a single number and the glazing is a range. Adding
     them would invent a precision neither has. */
  const start = html.indexOf('function buildTotalBar');
  const body = html.slice(start, html.indexOf('function buildDetailOptions'));
  assert.ok(!/price\.total \+|\+ glaz\.|range\.low \+/.test(body), 'a range and a total are being added together');
  assert.match(body, /walls, roof & trim/);
  assert.match(body, /windows & doors/);
});

test('the bar stays out of the way until there is something to say', () => {
  const start = html.indexOf('function buildTotalBar');
  assert.match(html.slice(start, start + 400), /if \(!price && !glaz\?\.price\) return/);
  // And it must not sit on top of the consent boxes at the end of the page.
  assert.match(html, /padding-bottom:\s*\d+px/);
});

/* ── D-3 · the sentence that answers the fear ── */

test('the upload step says what will not change', () => {
  /* The render prompt tells the model "do not add, remove, move or resize any
     window, door or other opening". This is that promise, made to the person
     deciding whether to hand over a photograph of their house. */
  assert.match(html, /We only change the finish/);
  assert.match(html, /stay exactly as they are/);
});

/* ── D-4 · the figure charges for things; show them ── */

test('the glazing estimate says what is inside it', () => {
  const start = html.indexOf("What's included");
  assert.ok(start > 0, 'the breakdown should exist');
  const body = html.slice(start, start + 1400);
  for (const item of ['survey', 'recycling', 'Cills', 'VAT at 20%', 'guarantee']) {
    assert.ok(new RegExp(item, 'i').test(body), `"${item}" is charged for but not shown`);
  }
});

test('it tells the truth about access either way', () => {
  // Charging for a tower on a bungalow, or listing access that is not in the
  // number, would both be the same kind of wrong.
  const start = html.indexOf("What's included");
  const body = html.slice(start, start + 1400);
  assert.match(body, /g\.price\.access/, 'access should be conditional on there being any');
  assert.match(body, /No access equipment needed/);
});
