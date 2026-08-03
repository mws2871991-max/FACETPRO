/* Time of day and inside glow — six variations on one paid render.

   The point of the feature is what it *doesn't* do. Switching view or time
   makes no request and spends no quota: it is a CSS filter over the image we
   already paid for, plus overlays on the window boxes /api/detect already
   found. Six real renders would multiply the Replicate bill by six for
   something a filter does better, instantly and reversibly.

   Two rules, and the tests are here because both are easy to break later:

     The filter is display only. The bytes sent to /api/detect, /api/measure
     and /api/render are the untouched original. Measuring a darkened
     photograph would skew the wall area, the window sizes and therefore the
     price — quietly, which is the worst way.

     It is an impression, not a simulation. The mockup this came from
     captioned it "Evening shows real light transmission". It does not. This
     codebase does not get to imply otherwise. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* Comments quote the wording they exist to warn against — including, in this
   very feature, the mockup's "shows real light transmission". Assertions about
   what the page says have to read the code, not the commentary. */
const withoutComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('nothing about lighting is sent to the server', () => {
  /* The whole economic argument. If a fetch ever appears in this path,
     every swatch of evening light starts costing money. */
  const start = html.indexOf('function lightingLayers');
  const end = html.indexOf('function buildVisualizer');
  assert.ok(start > 0 && end > start, 'lightingLayers should sit above buildVisualizer');
  const body = html.slice(start, end);
  assert.ok(!/fetch\(/.test(body), 'lightingLayers makes a network call');
  assert.ok(!/generateRealRender|refreshPrice|refreshGlazing/.test(body),
    'lightingLayers triggers work that costs something');
});

test('the controls only redraw the picture', () => {
  // renderVisualizerOnly, not render(), and nothing that is charged for.
  const start = html.indexOf('const segmented = (options, current, onPick)');
  const end = html.indexOf('return h(\'section\', { id: \'visualizer-section\'');
  assert.ok(start > 0 && end > start);
  const body = withoutComments(html.slice(start, end));
  assert.match(body, /renderVisualizerOnly\(\)/);
  assert.ok(!/fetch\(|generateRealRender/.test(body), 'a control triggers a paid call');
});

test('the filter never touches the bytes we upload', () => {
  /* state.uploadedBase64 is what every server call sends. If the filter were
     ever applied by re-encoding a canvas into it, the measurement would move
     with the time of day. */
  const start = html.indexOf('function lightingLayers');
  const end = html.indexOf('function buildVisualizer');
  const body = html.slice(start, end);
  assert.ok(!/uploadedBase64|toDataURL|getContext/.test(body),
    'the display layer is re-encoding the image');
});

test('overlays are gated on the same confidence the pricing uses', () => {
  /* Real detection means real misdetection. A warm glow on a patch of
     brickwork is worse than no effect, so a box that does not clear the bar
     gets nothing rather than a guess. */
  const glazing = require('../glazing');
  const declared = html.match(/const OVERLAY_MIN_CONFIDENCE = ([0-9.]+);/);
  assert.ok(declared, 'the threshold should be named, not inlined');
  // glazing.js keeps its own copy private; assert the numbers agree.
  const inGlazing = fs.readFileSync(path.join(__dirname, '..', 'glazing.js'), 'utf8')
    .match(/const MIN_CONFIDENCE = ([0-9.]+);/);
  assert.strictEqual(declared[1], inGlazing[1],
    'the overlay and the pricing disagree about what counts as a window');
  assert.ok(typeof glazing.estimateGlazing === 'function');
});

test('it does not claim to simulate light', () => {
  const start = html.indexOf('const lightingControls =');
  const body = withoutComments(html.slice(start, start + 2000));
  assert.ok(!/light transmission|simulat/i.test(body),
    'this is a tint and a gradient, and the copy has to say so');
  assert.match(body, /An idea of how it might look/);
  assert.match(body, /no extra renders/, 'free is worth saying, and it is true');
});

test('the slider is not dimmed by the light it controls', () => {
  /* A CSS filter applies to every descendant. With the slider inside the
     filtered element, brightness(0.62) at evening dimmed the control people
     use to compare before and after — exactly when the image is hardest to
     read — and the white readout with it. */
  const start = html.indexOf("className: 'media-cap relative aspect-[16/10]");
  const end = html.indexOf('groupsRow', start);
  const frame = html.slice(start, end);
  const filterAt = frame.indexOf('filter: (LIGHTING');
  const sliderAt = frame.indexOf('\n          slider,');
  assert.ok(filterAt > 0 && sliderAt > 0, 'both should be in the frame somewhere');
  // The filtered layer closes before the slider is added as a sibling.
  assert.ok(frame.slice(filterAt, sliderAt).includes('[beforePane, afterPane]'),
    'the filtered layer should hold the panes and nothing else');
  assert.ok(sliderAt > filterAt, 'the slider must come after, as a sibling');
});

test('both panes are lit by the same hour', () => {
  /* The filter belongs on the frame that holds the before and the after, not
     on the rendered image alone. Filtering one side meant dragging the slider
     compared this evening's new frames with this afternoon's old ones — two
     changes at once, which is the one thing a before-and-after must not do. */
  const start = html.indexOf("className: 'media-cap relative aspect-[16/10]");
  assert.ok(start > 0, 'the media frame should still be there');
  const frame = html.slice(start, start + 700);
  assert.match(frame, /filter: \(LIGHTING\[state\.timeOfDay\]/, 'the frame carries the filter');
  assert.match(frame, /\[beforePane, afterPane\]/, 'and it holds both panes, so they share an hour');
  // And not on the after image on its own.
  const after = html.slice(html.indexOf('src: state.renderUrl'), html.indexOf('src: state.renderUrl') + 400);
  assert.ok(!/filter:/.test(after), 'the after image is filtered separately from the before');
});

test('the controls appear only once there is a render to light', () => {
  const start = html.indexOf('const lightingControls =');
  assert.match(html.slice(start, start + 80), /state\.renderUrl \?/,
    'offering these before the picture exists promises something the page cannot do');
});
