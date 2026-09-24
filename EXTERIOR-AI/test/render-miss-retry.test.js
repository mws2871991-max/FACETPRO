/* A render that misses the roof or walls is tried once more (server.js,
   MISS_CHECKS / judgeRender), and the page names what is still missing. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('roof and walls are judged, with thresholds between a hit and a miss', () => {
  const checks = server.slice(server.indexOf('const MISS_CHECKS'), server.indexOf('const RETRY_NEEDS_MS'));
  const min = (t) => Number(checks.match(new RegExp(`${t}: \\{[^}]*min: ([\\d.]+)`))[1]);
  // Measured live: roof hit 0.42–0.66, miss 0.13–0.25; walls hit 0.43, untouched up to 0.16.
  assert.ok(min('roof') > 0.25 && min('roof') < 0.42);
  assert.ok(min('cladding') > 0.16 && min('cladding') < 0.43);
});

test('one retry, only with time left, and the better picture is kept', () => {
  const route = server.slice(server.indexOf("app.post('/api/render'"), server.indexOf('/* ── POST /api/lead ──'));
  assert.equal((route.match(/await runFlux\(/g) || []).length, 2, 'expected the first try and exactly one retry');
  assert.match(route, /deadlineAt - Date\.now\(\) > RETRY_NEEDS_MS/);
  assert.match(route, /again\.score >= verdict\.score/);
  assert.match(route, /missedChanges/);
});

test('the page says what the picture may be missing, and that it is still priced', () => {
  assert.match(html, /state\.missedChanges = Array\.isArray\(data\.missedChanges\)/);
  assert.match(html, /The picture may not show your new \$\{/);
  assert.match(html, /still in your estimate/);
});
