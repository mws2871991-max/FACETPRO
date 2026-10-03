'use strict';
require('./helpers/data-dir');
/* 0060: when the server has forgotten the photograph's reading (two hours, or
   a restart), the page reads it again instead of pricing a typical house as
   if it had been counted, and no render runs without its holds. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('/api/glazing says when the reading has gone', () => {
  const m = read('routes/measure.js');
  assert.match(m, /const detectionMissing = !!detectionId && !record;/);
  assert.match(m, /\.\.\.\(detectionMissing \? \{ detectionMissing: true \} : \{\}\)/);
});

test('/api/render refuses an expired reading before paying for anything', () => {
  const s = read('server.js');
  const start = s.indexOf("app.post('/api/render'"); const r = s.slice(start, s.indexOf("app.post('/api/lead'", start));
  const refuse = r.indexOf("reason: 'detection_expired'");
  assert.ok(refuse > 0);
  const paid = r.indexOf('runFluxOrRetry(');
  assert.ok(paid > 0 && refuse < paid, 'refused before the render is paid for');
  assert.match(r, /if \(detectionId && !detectionRecords\.has\(String\(detectionId\)\)\)/);
});

test('the page reads the photo again, once, and retries', () => {
  const h = read('index.html');
  const rv = h.slice(h.indexOf('async function reviveDetection()'), h.indexOf('async function refreshGlazing('));
  assert.match(rv, /fetch\('\/api\/detect'/);
  assert.match(rv, /image: state\.uploadedBase64/);
  assert.match(rv, /state\.detectionId = data\.detectionId;/);
  assert.match(h, /if \(res\.ok && data\.detectionMissing && !revived && await reviveDetection\(\)\) \{\s*return refreshGlazing\(\{ label, revived: true \}\);/);
  assert.match(h, /if \(res\.status === 409 && data\.reason === 'detection_expired' && !revived && await reviveDetection\(\)\)/);
  assert.match(h, /if \(retryRevived\) \{ generateRealRender\(\{ settled, revived: true \}\); return; \}/);
});

test('a typical house is never described as counted from the photo', () => {
  const h = read('index.html');
  const f = h.slice(h.indexOf('function photoChangedPriceLine('), h.indexOf('function buildGlazingLedPanel('));
  const guard = f.indexOf("countSource === 'house_type_prior'");
  assert.ok(guard > 0 && guard < f.indexOf('because this is priced from your photo'));
});
