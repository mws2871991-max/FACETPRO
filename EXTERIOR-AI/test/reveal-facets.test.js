'use strict';
require('./helpers/data-dir');
/* 0077: the reveal, made an event — facets, a flick back, then the price. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const meshSrc = h.slice(h.indexOf('function facetMesh('), h.indexOf('function revealFacets('));
const facetMesh = new Function(meshSrc + '; return facetMesh;')();
const area = ([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

test('the facets cover the whole picture, with no gaps or overlaps', () => {
  const m = facetMesh(1200, 800);
  const total = m.reduce((s, t) => s + area(t.pts), 0);
  assert.ok(Math.abs(total - 1200 * 800) < 1, `covered ${total}`);
});

test('every facet turns within the reveal, from the middle outwards', () => {
  const m = facetMesh(1000, 700);
  assert.ok(m.every(t => t.tau >= 0 && t.tau < 1), 'a facet would never turn');
  const centre = t => { const cx = t.pts.reduce((s, p) => s + p[0], 0) / 3 / 1000, cy = t.pts.reduce((s, p) => s + p[1], 0) / 3 / 700; return Math.hypot(cx - 0.5, cy - 0.45); };
  const inner = m.filter(t => centre(t) < 0.2), outer = m.filter(t => centre(t) > 0.45);
  const avg = a => a.reduce((s, t) => s + t.tau, 0) / a.length;
  assert.ok(avg(inner) < avg(outer), 'the middle should turn first');
});

test('the same house turns the same way every time', () => {
  assert.deepStrictEqual(facetMesh(600, 400).map(t => t.tau), facetMesh(600, 400).map(t => t.tau));
});

test('the reveal button runs the facets, and anything it cannot do falls back to the wipe', () => {
  assert.match(h, /state\.revealed = true;\s*revealFacets\(\);/);
  const r = h.slice(h.indexOf('function revealFacets('), h.indexOf('function runFacets('));
  assert.match(r, /prefers-reduced-motion: reduce/);
  assert.ok(r.includes("if (reduce || !pane || !img || !cap || !document.createElement('canvas').getContext) { revealWipe(); return; }"));
  assert.match(r, /\.catch\(\(\) => revealWipe\(\)\)/);
});

test('the house lands first, then the flick, then the price', () => {
  const l = h.slice(h.indexOf('function landReveal('), h.indexOf('END REVEAL (0077)'));
  const hide = l.indexOf("c.style.opacity = '0'"), flick = l.indexOf("clipPath = 'inset(0 100% 0 0)'"), price = l.indexOf("c.style.opacity = '1'");
  assert.ok(hide > 0 && flick > hide && price > flick, 'order: hide price, flick, show price');
  assert.match(l, /navigator\.vibrate/);
});
