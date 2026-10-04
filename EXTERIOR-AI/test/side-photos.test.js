'use strict';
require('./helpers/data-dir');
/* 0084: the sides of the house from photographs, counted like the back. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the server reads a side as its own elevation, with its own prompt', () => {
  assert.match(s, /const elevation = elevRaw === 'rear' \? 'rear' : elevRaw === 'side' \? 'side' : 'front';/);
  assert.match(s, /text: elevation === 'rear' \? REAR_PROMPT : elevation === 'side' \? SIDE_PROMPT :/);
  const p = s.slice(s.indexOf('const SIDE_PROMPT'), s.indexOf('function imageFingerprint'));
  for (const w of ['SIDE (gable end)', 'side wall facing the camera', 'side of the property']) assert.ok(p.includes(w), w);
});

test('the side prompt really differs from the back one (every replace landed)', () => {
  /* .replace() on a string that is not there returns it unchanged — a silent
     no-op. Rebuild SIDE_PROMPT from the source and check each change. */
  const rear = new Function(s.slice(s.indexOf('const REAR_PROMPT'), s.indexOf('`;', s.indexOf('const REAR_PROMPT')) + 2) + '; return REAR_PROMPT;')();
  const sideSrc = s.slice(s.indexOf('const SIDE_PROMPT'), s.indexOf(';\n', s.indexOf('const SIDE_PROMPT')) + 1);
  const side = new Function('REAR_PROMPT', sideSrc + '; return SIDE_PROMPT;')(rear);
  assert.ok(!side.includes('BACK of a UK home'));
  assert.ok(side.includes('pedestrian side door'));
  assert.ok(side.includes('seen at an angle'));
  assert.ok(side.includes('overview of the side of the property'));
});

test('a side answers with a count, never a measurement or a house type', () => {
  assert.match(s, /\(record\.elevation === 'rear' \|\| record\.elevation === 'side'\)/);
  assert.match(s, /sideWindowCount: record\.elevation === 'side' \? glazing\.frontWindowCount\(record\.detections\) : undefined,/);
  assert.match(s, /if \(elevation === 'rear' \|\| elevation === 'side'\) \{/);
  assert.match(s, /&& \(elevation !== 'front' \|\| 'houseType' in cachedAnalysis\);/);
});

test('the page adds side photos to the back, at most two, and a typed number wins', () => {
  const f = h.slice(h.indexOf('async function handleSideUpload('), h.indexOf('async function handleUpload('));
  assert.match(f, /elevation: 'side'/);
  assert.match(f, /\.slice\(0, 2\)/);
  assert.match(f, /state\.backCount = Math\.min\(30, backAlone \+ state\.sideCount\);/);
  assert.match(h, /stepper\(sides, \(n\) => \{ state\.sidePhotos = \[\]; setSides\(n\); \}, 'window on the sides'\)/);
  assert.match(h, /sidePhotoButton\('Add a photo of a side'\)/);
});

test('a new photo, front or back, forgets the side photos', () => {
  assert.match(h, /state\.sideCount = null;\n  state\.sidePhotos = \[\];/);
  assert.match(h, /state\.backPhotoCount = state\.backCount;\n    state\.sideCount = null;\n    state\.sidePhotos = \[\];/);
});
