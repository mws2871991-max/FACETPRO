'use strict';
require('./helpers/data-dir');
/* 0083: one-tap full makeover, "Show someone", a status pill born hidden,
   and the AI-training promise limited to what we can stand behind. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '..', 'legal', 'privacy.html'), 'utf8');
const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogue.json'), 'utf8'));
const block = h.slice(h.indexOf('THE FULL MAKEOVER, ONE TAP (0083)'), h.indexOf('function makeoverRow()') + 1200);

test('the makeover uses things the catalogue actually has', () => {
  const doors = (cat.windowsDoors.doorStyles || cat.windowsDoors.doors || []).map(d => d.id);
  assert.ok(doors.includes('composite'));
  const trims = cat.trim.map(t => t.id);
  for (const id of ['ink-trim', 'coastal-fog']) assert.ok(trims.includes(id), id);
  const colours = cat.windowsDoors.colours.map(c => c.id);
  const dark = JSON.parse(block.match(/var DARK_FRAMES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  for (const id of dark) assert.ok(colours.includes(id), id);
});

test('the makeover is priced and then revealed like the first picture', () => {
  assert.match(block, /state\.revealed = false;/);
  assert.match(block, /await Promise\.all\(\[refreshPrice\(\), refreshGlazing\(\{ label: 'Full makeover' \}\)\]\);/);
  assert.match(block, /generateRealRender\(\);/);
  assert.match(h, /state\.makeover \? 'Your full makeover is ready\.' : 'We found your home\.'/);
  assert.match(h, /askAtRender,\s*makeoverRow\(\),\s*makeItYours,/);
});

test('a new photo starts without the makeover', () => {
  assert.match(h, /async function handleUpload\(file\) \{\s*state\.makeover = false;/);
  assert.match(h, /state\.revealed = false; state\.makeover = false;/);
});

test('the share card carries its labels, and nothing is uploaded to make it', () => {
  const s = h.slice(h.indexOf('async function makeShareCard()'), h.indexOf('function makeoverRow()'));
  assert.match(s, /Planning estimate · inc\. VAT · not a quotation · After: AI visualisation/);
  assert.match(s, /pictureLines\(\)/, 'the same figures as the picture');
  assert.match(s, /navigator\.canShare && navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(s, /a\.download = file\.name/, 'a download where there is no share sheet');
  assert.doesNotMatch(s, /fetch\(/, 'made in the browser, not sent anywhere');
});

test('the status pill is born hidden', () => {
  const p = h.slice(h.indexOf('function ensureStatusPill()'), h.indexOf('function ensureStatusPill()') + 1500);
  assert.match(p, /transition-opacity duration-500 opacity-0 pointer-events-none'/);
});

test('the AI-training promise says only what we control until the providers confirm', () => {
  assert.doesNotMatch(h, /never published, sold, or used to train AI/);
  assert.match(h, /never published, sold, or used by us to train AI/);
  assert.doesNotMatch(privacy, /never used to train anyone's AI models/);
  assert.match(privacy, /never used by us to train AI models/);
});
