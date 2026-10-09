/* The colour the homeowner actually chose. Run: npm test
 *
 * Number 14, Chartwell Green, live on 28 September: the frames came back
 * BRIGHT LIME, measured at ΔE 35.1 from the swatch. renderprompt already says
 * "muted grey-green sage, soft and dusty, never bright or lime green" — and
 * that wording was itself written in response to the same defect on a door.
 * Saying it a third time is not a plan, so this settles it arithmetically:
 * keep the lightness the model produced, take the colour from the swatch.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const { correctFrameColour, rgbToLab, labToRgb, hexToRgb } = require('../hold');

const CHARTWELL = '#5B7C5B';

const png = (w, h, paint) => {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = paint(x, y);
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
};
const read = (b) => PNG.sync.read(b);
const at = (p, x, y) => { const i = (y * p.width + x) * 4; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };
const dE = (c, hex) => {
  const a = rgbToLab(c[0], c[1], c[2]), b = rgbToLab(...hexToRgb(hex));
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
};

/* A 60x60 frame. The left third is "frame" the model painted lime, with
   shading so the lightness varies the way a real surface does. The middle is
   glass: a pale neutral curtain the model also redrew. The right third is wall
   the render never touched. */
const W = 60, H = 60;
const isFrame = (x) => x < 20;
const isGlass = (x) => x >= 20 && x < 40;
const ORIGINAL = png(W, H, (x) => (isFrame(x) ? [240, 240, 238] : isGlass(x) ? [200, 205, 210] : [150, 110, 90]));
const LIME = png(W, H, (x, y) => (
  isFrame(x) ? [110 + (y % 7) * 6, 205 + (y % 7) * 5, 55 + (y % 7) * 4]   // lime, shaded
  : isGlass(x) ? [150 + (y % 5) * 4, 155 + (y % 5) * 4, 162 + (y % 5) * 4] // redrawn, but neutral
  : [150, 110, 90]));                                                      // wall, untouched
const MASK = png(W, H, (x) => (x < 40 ? [255, 255, 255] : [0, 0, 0]));

test('Lab conversion round-trips, or every number after it is wrong', () => {
  for (const hex of [CHARTWELL, '#2B2D42', '#FFFFFF', '#1C1C1C', '#F5F0E6']) {
    const rgb = hexToRgb(hex);
    assert.deepStrictEqual(labToRgb(...rgbToLab(...rgb)), rgb, `${hex} did not survive the round trip`);
  }
  assert.strictEqual(hexToRgb('not a colour'), null);
  assert.strictEqual(hexToRgb(null), null);
});

test('lime frames become the colour on the swatch', () => {
  const before = at(read(LIME), 5, 10);
  assert.ok(dE(before, CHARTWELL) > 30, `the fixture should start far from the swatch, was ${dE(before, CHARTWELL).toFixed(1)}`);

  const r = correctFrameColour({
    render: LIME, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png',
    mask: MASK, maskMime: 'image/png', hex: CHARTWELL,
  });
  assert.strictEqual(r.corrected, true, r.reason || '');
  const out = read(r.buffer);
  for (const y of [3, 17, 31, 48]) {
    const px = at(out, 5, y);
    assert.ok(dE(px, CHARTWELL) < 10,
      `frame at y=${y} is ΔE ${dE(px, CHARTWELL).toFixed(1)} from the swatch — the handoff's bar is about 10`);
  }
});

test('the shading survives: this is paint on a house, not a flat fill', () => {
  /* Flattening every frame pixel to one value would be perfectly accurate
     colour on a cardboard cut-out. The lightness variation is what makes it
     read as a real surface in real light, so it has to come through. */
  const r = correctFrameColour({
    render: LIME, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png',
    mask: MASK, maskMime: 'image/png', hex: CHARTWELL,
  });
  const out = read(r.buffer);
  const Ls = [0, 1, 2, 3, 4, 5, 6].map(y => rgbToLab(...at(out, 5, y))[0]);
  const spread = Math.max(...Ls) - Math.min(...Ls);
  assert.ok(spread > 3, `the frame came out flat (lightness spread ${spread.toFixed(1)})`);
});

test('glass and wall are left alone', () => {
  const r = correctFrameColour({
    render: LIME, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png',
    mask: MASK, maskMime: 'image/png', hex: CHARTWELL,
  });
  const out = read(r.buffer), lime = read(LIME);
  /* Inside the mask but neutral: a curtain the model redrew. Tinting it sage
     looks worse than a frame that is slightly off. */
  assert.deepStrictEqual(at(out, 30, 10), at(lime, 30, 10), 'the glass was tinted');
  /* Outside the mask entirely. */
  assert.deepStrictEqual(at(out, 50, 10), at(lime, 50, 10), 'the wall was repainted');
});

test('a render that already got the colour right is not touched', () => {
  /* Measured on the newbuild, live: the model produced Chartwell Green within
     ΔE 11.1 on its own. Correcting that would move it for no reason and flatten
     its lighting onto the swatch's mean. */
  const good = png(W, H, (x, y) => (isFrame(x) ? [88 + (y % 7) * 5, 121 + (y % 7) * 5, 88 + (y % 7) * 5]
    : isGlass(x) ? [150, 155, 162] : [150, 110, 90]));
  const r = correctFrameColour({
    render: good, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png',
    mask: MASK, maskMime: 'image/png', hex: CHARTWELL,
  });
  assert.strictEqual(r.corrected, false);
  assert.match(r.reason, /already within/);
  assert.strictEqual(r.buffer, good, 'the buffer should come back untouched, not re-encoded');
});

test('without a mask it does nothing at all', () => {
  /* A correction with nothing bounding it would hunt that hue across the whole
     photograph — the brick, the grass, the neighbour. The mask is what makes
     this safe, so its absence is a refusal, not a free-for-all. */
  const r = correctFrameColour({
    render: LIME, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png',
    hex: CHARTWELL,
  });
  assert.strictEqual(r.corrected, false);
  assert.match(r.reason, /no mask/);
});

test('anything malformed is a refusal, never a throw', () => {
  /* This runs inside a render that has already been paid for. */
  const base = { render: LIME, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png',
                 mask: MASK, maskMime: 'image/png', hex: CHARTWELL };
  for (const [what, args] of Object.entries({
    'no swatch': { ...base, hex: null },
    'bad swatch': { ...base, hex: 'chartwell green' },
    'render not a PNG': { ...base, renderMime: 'image/jpeg' },
    'mask of the wrong shape': { ...base, mask: png(10, 60, () => [255, 255, 255]) },
    'junk mask': { ...base, mask: Buffer.from('nonsense'), maskMime: 'image/png' },
  })) {
    const r = correctFrameColour(args);
    assert.strictEqual(r.corrected, false, `${what} should refuse`);
    assert.ok(r.reason, `${what} should say why`);
    assert.strictEqual(r.buffer, args.render, `${what} must hand back the render it was given`);
  }
});

test('the render corrects the colour after holding the picture, and before the bars', () => {
  /* After the mask because it needs one. Before the bars because they are drawn
     in the frame's colour and should be drawn in the corrected one. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const maskAt = src.indexOf('const masked = restore.mask');
  const colourAt = src.indexOf('if (restore.glazingHex && restore.mask) {');
  const barsAt = src.indexOf('if (restore.bars) {');
  assert.ok(maskAt > 0 && colourAt > 0 && barsAt > 0, 'the render no longer corrects the frame colour');
  assert.ok(maskAt < colourAt, 'the correction must run after the mask hold');
  assert.ok(colourAt < barsAt, 'the correction must run before the Georgian bars are drawn');
  /* And the hex must come from the catalogue, not from prose. */
  assert.match(src, /glazingHex: \(catalogue\.windowsDoors\.colours\.find/,
    'the swatch hex is no longer read from the catalogue');
});

test('every swatch the page offers has a hex to correct towards', () => {
  /* The correction can only run on colours that carry a real value. A swatch
     added without one would silently never be corrected. */
  const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogue.json'), 'utf8'));
  for (const group of [cat.windowsDoors.colours, cat.wholeHouse.windowColours]) {
    for (const c of group) {
      assert.match(String(c.hex || ''), /^#[0-9A-Fa-f]{6}$/, `${c.id} has no usable hex`);
    }
  }
});

/* 0072: cream frames blew out the glass (render 53dc068c). Two faults: the
   vote for "the frame's colour" was won by the glass (frames shade across
   several bins, a pane of sky sits in one), and a near-neutral frame matched
   neutral glass in a/b, so the glass was lifted to cream. A real window here:
   the mask is the whole window, the frame a band round the glass. */
const inWin = (x, y) => x >= 10 && x < 50 && y >= 10 && y < 50;
const inGlass = (x, y) => x >= 16 && x < 44 && y >= 16 && y < 44;
const WIN_MASK = png(W, H, (x, y) => (inWin(x, y) ? [255, 255, 255] : [0, 0, 0]));
const WIN_ORIG = png(W, H, (x, y) => (inGlass(x, y) ? [90, 95, 100] : inWin(x, y) ? [240, 240, 238] : [150, 110, 90]));
const window_ = (frame, glass) => png(W, H, (x, y) => (inGlass(x, y) ? glass(x, y) : inWin(x, y) ? frame(x, y) : [150, 110, 90]));

test('cream: when the glass wins the vote, the render is left alone rather than the glass lifted to cream', () => {
  /* White frames asked to be cream barely change (under CHANGE_T); the
     redrawn glass is most of what changed, so it wins the vote. */
  const CREAM = '#F5F0E6';
  const render = window_((x, y) => [232 + (y % 5) * 2, 230 + (y % 5) * 2, 222 + (y % 5) * 2],   // frames: barely changed
    (x, y) => (y < 30 ? [100 + (y % 3) * 2, 105, 112] : [150, 156, 164]));                      // glass redrawn
  const r = correctFrameColour({ render, renderMime: 'image/png', original: WIN_ORIG, originalMime: 'image/png',
    mask: WIN_MASK, maskMime: 'image/png', hex: CREAM });
  assert.strictEqual(r.corrected, false);
  assert.match(r.reason, /that is the glass/);
  assert.strictEqual(r.buffer, render, 'handed back untouched');
});

test('grey frames asked to be a grey are left as the model drew them (9 Oct)', () => {
  /* Was "a neutral frame that was repainted is corrected". A semi asked for
     anthracite on 9 Oct: the frames came back mid grey and the reflections
     and net curtains in the glass were the same grey, so correcting the
     lightness painted the glass black. Grey to grey is now left alone. */
  const GREY = '#8A8D8F';
  const render = window_((x, y) => [180 + (y % 2) * 3, 182 + (y % 2) * 3, 184 + (y % 2) * 3],
    (x, y) => [90 + (y % 9) * 5, 92 + (x % 7) * 5, 96 + (y % 9) * 5]);
  const r = correctFrameColour({ render, renderMime: 'image/png', original: png(W, H, () => [20, 20, 20]), originalMime: 'image/png',
    mask: WIN_MASK, maskMime: 'image/png', hex: GREY });
  assert.strictEqual(r.corrected, false);
  assert.match(r.reason, /grey frames asked to be a grey/);
  assert.strictEqual(r.buffer, render, 'handed back untouched');
});

test('anthracite over grey glass: the glass is not painted (the 9 Oct house)', () => {
  /* Frames the model made mid grey, glass reflections the same grey: the
     render is kept, not darkened into black glass. */
  const ANTHRACITE = '#383E42';
  const render = window_(() => [108, 116, 122], (x, y) => [104 + (y % 4) * 3, 112 + (y % 4) * 3, 118 + (y % 4) * 3]);
  const r = correctFrameColour({ render, renderMime: 'image/png', original: WIN_ORIG, originalMime: 'image/png',
    mask: WIN_MASK, maskMime: 'image/png', hex: ANTHRACITE });
  assert.strictEqual(r.corrected, false, 'a grey render asked for anthracite is left alone');
  assert.strictEqual(r.buffer, render);
});
