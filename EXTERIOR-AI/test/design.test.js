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

test('every font we redistribute is attributed', () => {
  /* The suite had a hole shaped exactly like the omission it missed: it
     checked JetBrains Mono existed and was declared, but not that anyone had
     said whose it was. 31 KB of somebody's typeface with no licence entry. */
  const dir = path.join(root, 'assets', 'fonts');
  const notice = fs.readFileSync(path.join(dir, 'NOTICE.txt'), 'utf8');
  const fonts = fs.readdirSync(dir).filter(f => f.endsWith('.woff2'));
  assert.ok(fonts.length, 'there should be fonts to attribute');
  for (const font of fonts) {
    assert.ok(notice.includes(font), `${font} is redistributed but not in NOTICE.txt`);
  }
  assert.match(notice, /Open Font License/);
});

test('the build input is not sitting in a served directory', () => {
  // Nothing is exposed by three @tailwind directives, but a build input in
  // assets/ is a served file that has no business being one.
  assert.ok(!fs.existsSync(path.join(root, 'assets', 'tailwind.css')));
  assert.ok(fs.existsSync(path.join(root, 'styles', 'tailwind.css')));
  /* build:css and prestart go through the same script now — they used to be
     separate commands that disagreed about whether the output was stale. */
  const pkg = require('../package.json');
  assert.strictEqual(pkg.scripts['build:css'], pkg.scripts.prestart,
    'one path, so the two cannot drift');
  assert.match(fs.readFileSync(path.join(root, 'scripts', 'prestart-css.js'), 'utf8'),
    /styles\/tailwind\.css/, 'the build input moved out of the served directory');
});

test('the daylight tints come from this palette, not the mockup they arrived in', () => {
  /* A page built on sand #D9C5B4 and slate #2F3336 reaching outside itself in
     one place reads as borrowed. */
  const start = html.indexOf('const LIGHTING = {');
  const body = html.slice(start, start + 700);
  assert.ok(!/255,232,184|15,10,42/.test(body), 'the mockup palette is back');
  assert.match(body, /217,197,180/, 'morning should be the sand token');
});

test('a request for less movement is honoured', () => {
  // The daylight transitions are .7s on filter, background and shadow.
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /transition-duration:\.01ms !important/);
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

test('it says what is not covered, not only what is', () => {
  /* A survey finding rot behind a frame is the commonest extra in this trade.
     A homeowner told about it here has been quoted honestly; one told about it
     on the day has been caught out. */
  const start = html.indexOf("What's included");
  const body = html.slice(start, start + 2600);
  assert.match(body, /Not included/);
  assert.match(body, /rotten timber/i);
  assert.match(body, /FENSA or Certass/i, 'building control is only extra if they cannot self-certify');
  assert.match(body, /structural/i);
});

test('it tells the truth about access either way', () => {
  // Charging for a tower on a bungalow, or listing access that is not in the
  // number, would both be the same kind of wrong.
  const start = html.indexOf("What's included");
  const body = html.slice(start, start + 1400);
  assert.match(body, /g\.price\.access/, 'access should be conditional on there being any');
  assert.match(body, /No access equipment needed/);
});
