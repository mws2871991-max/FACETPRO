'use strict';

require('./helpers/data-dir');

/* Every picture the homepage cards and journey illustrations point at must
   exist. They are renamed rather than overwritten when they change (images
   are cached for a year), and a rename that misses a reference is a broken
   picture on the first screen. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('every /assets/products picture referenced by index.html exists', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const refs = [...new Set([...html.matchAll(/\/assets\/products\/[\w.-]+\.(?:jpe?g|png|webp)/g)].map(m => m[0]))];
  assert.ok(refs.length >= 10, `expected the card and journey pictures, found ${refs.length}`);
  const missing = refs.filter(r => !fs.existsSync(path.join(root, r)));
  assert.deepStrictEqual(missing, []);
});
