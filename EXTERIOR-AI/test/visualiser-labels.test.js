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

test('before and after are two buttons, and one label names the picture on screen', () => {
  /* 28 September: the slider rebuilt itself on the first step of every drag
     (renderVisualizerOnly in its input handler), so dragging went nowhere.
     It was replaced by Before / After buttons that show one whole picture. */
  assert.ok(!/type: 'range', min: 0, max: 100, value: state\.afterPct/.test(visualizer), 'the drag slider is back');
  assert.match(visualizer, /state\.afterPct = which === 'after' \? 100 : 0/, 'the buttons no longer swap the whole picture');
  assert.match(visualizer, /'aria-pressed': showing === which/, 'the buttons do not say which is showing');
  // One label at a time, for whichever picture fills the frame.
  assert.match(visualizer, /\(!state\.renderUrl \|\| showing === 'before'\)/, '"Before" shows over the After picture');
  assert.match(visualizer, /state\.renderUrl && showing === 'after'/, '"After" shows over the photograph');
  assert.ok(!/% after`\)/.test(visualizer), 'the percentage readout is back');
});

test('daylight from outside draws nothing over the windows', () => {
  const body = withoutComments(html.slice(
    html.indexOf('function lightingLayers'),
    html.indexOf('function buildVisualizer')));
  assert.ok(!/rgba\(255,255,255,0\.88\)/.test(body), 'the white glass panel is back');
  assert.ok(!/transparent 0 35%/.test(body), 'the specular sweep is back');
});

test('the page names the control that is on the screen', () => {
  /* a2404c1 replaced the drag slider with two Before / After buttons, and
     Step 2's intro went on saying "Drag the slider to compare…". Found live on
     28 September. An instruction for a control that is not there is worse than
     none: the reader concludes the page is broken or that they have missed
     something, and this is the step where they are deciding whether to trust
     the picture at all. */
  const page = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/Drag the slider to compare/.test(page),
    'Step 2 still tells people to drag a slider that was removed');
  assert.match(page, /Tap Before and After to compare/,
    'Step 2 should name the two buttons it actually has');

  /* And those buttons must still be what it names. If they are ever replaced
     again this test should fail with the copy, not after it. */
  assert.match(page, /which === 'after' \? 'After' : 'Before'/,
    'the Before / After buttons have changed shape — check the copy that names them');
});
