/* The before-and-after on the design page: which label goes where, and
   what is drawn over the picture by default.

   Both were wrong in production on 23 September, after a fix that looked
   right in review: the pills moved to opposite corners without anyone
   checking which side each picture is on, so "After" sat over the untouched
   photograph. And the default daylight view painted pale glass panels over
   every detected window, across both panes. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const withoutComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const start = html.indexOf('function buildVisualizer');
const visualizer = withoutComments(html.slice(start, html.indexOf('\nfunction ', start + 1)));

test('each label sits over its own picture', () => {
  // The render is clipped from the right, so it occupies the left.
  assert.match(visualizer, /clipPath: `inset\(0 \$\{100 - state\.afterPct\}% 0 0\)`/,
    'the after pane is no longer clipped from the right — recheck the label corners');
  const pill = (word) => (visualizer.match(new RegExp(`className: '([^']*)' \\}, '${word}'\\)`)) || [])[1] || '';
  assert.match(pill('After'), /\bleft-3\b/, '"After" must sit on the left, over the render');
  assert.match(pill('Before'), /\bright-3\b/, '"Before" must sit on the right, over the photograph');
});

test('daylight from outside draws nothing over the windows', () => {
  const body = withoutComments(html.slice(
    html.indexOf('function lightingLayers'),
    html.indexOf('function buildVisualizer')));
  assert.ok(!/rgba\(255,255,255,0\.88\)/.test(body), 'the white glass panel is back');
  assert.ok(!/transparent 0 35%/.test(body), 'the specular sweep is back');
});
