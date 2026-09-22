/* Where the house is, so the neighbour can be left out of the frame.

   Choosing a roof changes the roof of the house next door. Three prompt
   wordings were measured against it and the right-hand neighbour went
   -2 → 90, then 84, then 71 in mean red-minus-blue: monotonic improvement,
   no resolution. Kontext edits regions and the region runs off the frame, so
   words cannot fix it. Cropping the photograph before the model sees it can —
   a house that is not in the frame cannot be edited.

   subjectBox answers "where is this house, and is it safe to crop to it". A
   wrong crop shaves somebody's home off their own photograph, which is worse
   than the bug it fixes, so every doubt returns null and null means the photo
   goes through untouched — today's behaviour, and a known quantity.

   The fixtures here are the real boxes /api/detect returned for this site's
   own two photographs on 21 September, not invented ones. That matters: the
   invented version of this test passed while the real one could never fire. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const geometry = require('../geometry');
const { subjectBox } = geometry;

const d = (type, x, y, w, h, extra = {}) =>
  ({ type, confidence: 0.9, x_pct: x, y_pct: y, w_pct: w, h_pct: h, ...extra });

/* A house sitting in the middle of its plot, with a neighbour clear of it on
   the right — the case cropping exists for. */
const DETACHED_WITH_ROOM = [
  d('roof', 20, 10, 55, 25, { label: 'Main Roof' }),
  d('cladding', 18, 30, 60, 50, { label: 'Brick Wall' }),
  d('door-front', 45, 58, 7, 16, { label: 'Front Door' }),
  d('window', 25, 36, 12, 11, { label: 'Upper Left' }),
  d('window', 60, 36, 12, 11, { label: 'Upper Right' }),
  d('fascia', 20, 33, 55, 3, { label: 'Fascia' }),
];

test('a house with room either side gives a box that excludes the neighbour', () => {
  const b = subjectBox(DETACHED_WITH_ROOM);
  assert.ok(b, 'a well-detected house in the middle of the frame must produce a box');
  assert.ok(b.x > 0, 'the crop should start inside the frame');
  assert.ok(b.x + b.w < 100, 'and finish inside it — otherwise nothing is removed');
  // The margin is applied, so the box is looser than the detections.
  assert.ok(b.x < 20, 'the left edge should sit outside the leftmost detection');
});

test('cladding does not bound the house, because the model does not bound it', () => {
  /* Asked for the walls, the model returns one region covering every brick
     surface in the frame. On both real photographs it came back x 0..100 —
     "Yellow Brick Wall Cladding" and "Brick Wall Lower" — spanning the
     neighbours' walls too. Unioning that in guarantees a full-frame box and
     therefore no crop, ever.

     This is the bug the first version of subjectBox shipped with, and the
     reason it returned null on every real photograph while passing against
     tidy fixtures. */
  const withGreedyCladding = [
    ...DETACHED_WITH_ROOM.filter(x => x.type !== 'cladding'),
    d('cladding', 0, 30, 100, 65, { label: 'Yellow Brick Wall Cladding' }),
  ];
  const b = subjectBox(withGreedyCladding);
  assert.ok(b, 'a full-frame cladding box must not prevent a crop');
  assert.ok(b.x + b.w < 100,
    'cladding spanning the frame has bounded the box again — it must anchor only');
});

test('cladding still counts as proof there is a house here', () => {
  /* Bounding and anchoring are different jobs. Without a door or a wall the
     detection is a scattering of windows and too thin to crop on. */
  const windowsOnly = DETACHED_WITH_ROOM.filter(x => x.type === 'window' || x.type === 'roof');
  assert.strictEqual(subjectBox(windowsOnly), null, 'no door and no wall is not a house');

  const wallNoDoor = [...windowsOnly, d('cladding', 0, 30, 100, 65)];
  const b = subjectBox(wallNoDoor);
  assert.ok(b, 'a wall is enough to anchor, even spanning the frame');
  /* And it sets the bottom edge. Without cladding in the vertical bounds the
     box stops at the lowest window and the crop cuts the house off at the
     knees — which is how this assertion failed the first time. */
  assert.ok(b.y + b.h > 90, 'the crop must reach the ground, which only cladding knows about');
  assert.ok(b.x + b.w < 100, 'but cladding must not drag the sides out to the frame');
});

test('the real newbuild photograph gives null, and that is correct', () => {
  /* The boxes /api/detect actually returned. The subject's own downpipe
     reaches x=98 and the neighbour's roof sits at x 93-100, so no vertical
     cut separates them: there is nothing to crop without cutting the house.

     Pinned so that nobody later loosens a guard to "make it work" on this
     photograph. Making it fire here would shave the downpipe off. */
  const REAL_NEWBUILD = [
    d('roof', 6, 0, 90, 38, { label: 'Main Roof' }),
    d('cladding', 0, 30, 100, 65, { label: 'Yellow Brick Wall Cladding' }),
    d('guttering', 3, 18, 2, 50, { label: 'Downpipe Left' }),
    d('guttering', 96, 10, 2, 55, { label: 'Downpipe Right' }),
    d('window', 14, 22, 16, 13, { label: 'Upper Left Double Window' }),
    d('window', 60, 48, 23, 14, { label: 'Lower Right Triple Window' }),
    d('door-front', 41, 52, 8, 18, { label: 'Front Door' }),
  ];
  assert.strictEqual(subjectBox(REAL_NEWBUILD), null,
    'this house spans the frame; cropping it would cut its own downpipe');
});

test('a house already filling the frame gives null — nothing to gain', () => {
  const fillsIt = [
    d('roof', 0, 0, 100, 30),
    d('cladding', 0, 28, 100, 70),
    d('door-front', 45, 70, 8, 20),
  ];
  assert.strictEqual(subjectBox(fillsIt), null);
});

test('a degenerate box gives null rather than a sliver crop', () => {
  const sliver = [
    d('roof', 40, 40, 12, 8),
    d('door-front', 44, 46, 4, 6),
  ];
  assert.strictEqual(subjectBox(sliver), null, 'a tiny box means the detections failed');
});

test('low-confidence boxes are ignored, as they are for pricing', () => {
  const noisy = [...DETACHED_WITH_ROOM, d('roof', 0, 0, 100, 90, { confidence: 0.2 })];
  const b = subjectBox(noisy);
  assert.ok(b && b.x + b.w < 100,
    'a 0.2-confidence full-frame box has bounded the crop — the floor is not applied');
});

test('rubbish never throws, and never produces a box', () => {
  for (const input of [null, undefined, [], 'nonsense', 42, [null, undefined, 5],
                       [{ type: 'roof' }], [{ type: 'roof', x_pct: 'a', y_pct: 'b', w_pct: 'c', h_pct: 'd' }],
                       [d('roof', 10, 10, -5, -5)]]) {
    let out;
    assert.doesNotThrow(() => { out = subjectBox(input); }, `threw on ${JSON.stringify(input)}`);
    assert.strictEqual(out, null, `produced a box from ${JSON.stringify(input)}`);
  }
});

test('the box never leaves the frame, even for detections at the edge', () => {
  /* The margin is added before clamping, so a house touching the edge must
     not produce a negative coordinate or one past 100 — a crop rectangle
     outside the image is a canvas exception in the browser. */
  const atEdge = [
    d('roof', 0, 0, 60, 25),
    d('cladding', 0, 24, 62, 50),
    d('door-front', 20, 55, 7, 16),
    d('window', 8, 30, 12, 11),
  ];
  const b = subjectBox(atEdge);
  if (b) {
    assert.ok(b.x >= 0 && b.y >= 0, 'negative origin');
    assert.ok(b.x + b.w <= 100.001 && b.y + b.h <= 100.001, 'runs past the frame');
    assert.ok(b.w > 0 && b.h > 0);
  }
});

test('the existing real fixture is handled, whatever it answers', () => {
  /* no-door-bay: a genuine photograph with no front door in shot. Whatever
     the guards decide, they must decide it without throwing. */
  const detections = require('./fixtures/no-door-bay.detections.json');
  let out;
  assert.doesNotThrow(() => { out = subjectBox(detections); });
  assert.ok(out === null || (out.w > 0 && out.h > 0));
});

/* ── Roof framing: decide from the boxes whether to ask at all ── */

const mkBox = (type, label, h, extra = {}) => ({
  type, label, x_pct: 5, y_pct: 0, w_pct: 80, h_pct: h, ...extra,
});

test('a roof that fills a reasonable share of the frame is rendered', () => {
  /* tilehung-before.jpg: roof 58, tiled wall 50. This photograph renders
     correctly today and the guard must not touch it. */
  const v = geometry.roofFraming([
    mkBox('roof', 'Main Gable Roof', 58),
    mkBox('cladding', 'Roof Tile Cladding (Gable Wall)', 50),
  ]);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.reason, null);
});

test('a roof that is a sliver along the top edge is refused', () => {
  /* hero-before.jpg: roof 16, tiled wall 25. Three separate prompt rewrites
     failed on this photograph. There is barely any roof to apply them to. */
  const v = geometry.roofFraming([
    mkBox('roof', 'Main Roof', 16),
    mkBox('cladding', 'Tile Hanging Cladding Upper', 25),
  ]);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'roof_sliver');
  assert.strictEqual(v.roofHPct, 16);
});

test('a tiled wall bigger than the roof is refused even when the roof is large', () => {
  const v = geometry.roofFraming([
    mkBox('roof', 'Main Roof', 30),
    mkBox('cladding', 'Tile Hung Upper Wall', 45),
  ]);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'tiled_wall_larger');
});

test('an ordinary brick house is never refused, however big the wall', () => {
  /* The regression that matters. semi-before-sm.jpg renders correctly and its
     brick wall is far larger than its roof — if the guard keyed on wall size
     alone it would refuse the one photograph that works. Only a *tiled* wall
     competes with a roof for the same instruction. */
  const v = geometry.roofFraming([
    mkBox('roof', 'Main Roof', 28),
    mkBox('cladding', 'Brick Wall', 60),
  ]);
  assert.strictEqual(v.ok, true);
});

test('no roof box means no opinion, not a refusal', () => {
  /* Refusing on absent evidence would break photographs that work today —
     the same trap subjectBox's null has. */
  const v = geometry.roofFraming([mkBox('cladding', 'Brick Wall', 60)]);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.roofHPct, null);
});

test('the framing guard and the prompt correction read the same labels', () => {
  /* They must never disagree: one decides whether to ask for a roof, the other
     whether the request carries the tile-hanging correction. Two copies of the
     regex is how the bay-pane rule drifted. */
  const { TILED_WALL_LABEL } = geometry;
  for (const l of ['Tile Hanging Cladding', 'Roof Tile Cladding (Gable Wall)', 'Clay Tile Cladding']) {
    assert.ok(TILED_WALL_LABEL.test(l), `${l} should read as tiled`);
  }
  for (const l of ['Brick Wall', 'Render Upper Wall', 'Timber Boarding']) {
    assert.ok(!TILED_WALL_LABEL.test(l), `${l} should not read as tiled`);
  }
});

test('a tiled wall exactly as tall as the roof still renders', () => {
  /* Measured, not invented: one detect call on tilehung-before.jpg returned a
     roof of 45 and a tiled wall of 45, and that photograph renders correctly.
     The comparison has to be strict or the guard refuses a house it can do.
     It clears by nothing, which is why this case is pinned. */
  const v = geometry.roofFraming([
    mkBox('roof', 'Main Gable Roof', 45),
    mkBox('cladding', 'Tile Hanging Upper Wall', 45),
  ]);
  assert.strictEqual(v.ok, true, 'an equal-sized tiled wall must not refuse the roof');
});
