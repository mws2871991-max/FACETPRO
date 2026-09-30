/* The homeowner has to be able to check the count. Run: npm test
 *
 * From the launch run-through: nineteen labels drawn over the photograph,
 * overlapping and unreadable at phone width, under a question that asked
 * "does that match your house?" with "Looks right — continue" as the easy
 * button. So people confirm a count they never read — and on 28 September
 * that count was wrong on the one house anybody checked by hand.
 *
 * The person standing in front of the house is the only one who can catch
 * what detection got wrong. This is the machinery that lets them.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const glazing = require('../glazing');
const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the question names the number it is asking about', () => {
  assert.match(page, /We counted \$\{n\} window\$\{n === 1 \? '' : 's'\} at the front — is that right\?/,
    'the confirmation no longer states the count');
  assert.ok(!/Does that match your house\?'\),\s*\n\s*h\('div'/.test(page),
    'the old unanswerable question is still the one being asked');
  /* And the buttons answer THAT question rather than a vaguer one. */
  assert.match(page, /btn\('Yes',/, 'the confirm button should answer the question asked');
  assert.match(page, /btn\('No, change it',/, 'and the other should say what it will do');
});

test('the question, the summary and the price read one number', () => {
  /* "We found 8 windows" over a price for 7 happened because three places
     worked it out separately. */
  assert.match(page, /function countOnScreen\(fallback = 0\) \{[\s\S]{0,220}state\.windowCount\s*\|\|\s*state\.glazing\?\.frontCount/,
    'the one source for the number on screen has gone');
  const uses = (page.match(/countOnScreen\(/g) || []).length;
  assert.ok(uses >= 3, `only ${uses} references — the summary and the question should both use it`);
});

test('the counted windows are numbered, and nothing else is', () => {
  assert.match(page, /state\.frontWindowBoxes/, 'the page never receives the counted boxes');
  assert.match(page, /ring-emerald-400/, 'the counted windows are not marked out from the rest');
  assert.match(page, /\}, String\(i \+ 1\)\)\);/, 'the windows are not numbered');
  /* Everything else stays, dimmer — the supporting detail, not the answer. */
  assert.match(page, /border-zinc-900\/40 bg-zinc-900\/5/,
    'the other elements should be drawn more faintly than the counted windows');
});

test('a bay gets one number, because it is one window on the invoice', () => {
  const n14 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'edwardian-14-opus-detections.json'), 'utf8'));
  const AR = 888 / 1184;
  const boxes = glazing.frontWindowBoxes(n14.detections, AR);
  assert.strictEqual(boxes.length, glazing.frontWindowCount(n14.detections, AR),
    'there must be exactly one dot per counted window');
  assert.strictEqual(boxes.length, 4, 'number 14 has four');
  assert.strictEqual(boxes.filter(b => b.isBay).length, 2, 'both bays should be single boxes');
  /* A bay box has to span its panes, or the number lands on one facet and the
     homeowner counts three windows where we counted one. */
  for (const bay of boxes.filter(b => b.isBay)) {
    assert.ok(bay.w > 20, `a bay box only ${bay.w}% wide has not been merged`);
  }
});

test('one dot per counted window, on every house in the set', () => {
  const dir = path.join(__dirname, 'fixtures', 'houses');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    const h = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const boxes = glazing.frontWindowBoxes(h.detections, h.aspectRatio);
    assert.strictEqual(boxes.length, h.countedByHand.windows,
      `${h.house}: ${boxes.length} dots for ${h.countedByHand.windows} windows`);
    for (const b of boxes) {
      assert.ok(b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0,
        `${h.house}: a dot would be placed off the photograph`);
    }
  }
});

test('the server sends the boxes, from the same place as the count', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const hits = (src.match(/frontWindowBoxes: glazing\.frontWindowBoxes\(/g) || []).length;
  assert.strictEqual(hits, 2, 'both the fresh and the cached reading should send them');
  /* The boxes and the count must be produced by one function, or the dots and
     the number drift apart. */
  const g = fs.readFileSync(path.join(__dirname, '..', 'glazing.js'), 'utf8');
  assert.match(g, /function frontWindowBoxes\(detections, aspectRatio = null\) \{[\s\S]{0,400}windowCandidates\(detections, aspectRatio\)\.kept/,
    'frontWindowBoxes no longer reads the same units as the count');
});

test('a customer waiting for a render is shown their own house', () => {
  /* Walked on a phone on 30 September. For the thirty to forty-five seconds a
     render takes — the stretch of this journey that matters most — the picture
     panel filled with a grey block carrying two white rectangles and a dark
     one. That is the colour-preview schematic, which is right for somebody
     playing with a colour before they have uploaded anything, and wrong here:
     on the windows journey no cladding is chosen, so the block is default grey
     and its shapes are walls, a roof and a door, none of which they asked to
     change. It reads as a broken image, not as work in progress.

     Their own photograph reads as neither, and is the truthful thing to show:
     nothing has changed yet. */
  const at = page.indexOf('} else if (state.rendering && state.uploadedImg) {');
  assert.ok(at > 0, 'the waiting state has gone back to the schematic');
  const block = page.slice(at, at + 2200);   // the label sits at ~1580; 1600 cut it mid-match
  assert.match(block, /src: state\.uploadedImg/, 'it should show the photograph they gave us');
  assert.match(block, /Making your picture…/, 'and say plainly that it is still being made');
  assert.match(block, /animate-pulse motion-reduce:animate-none/,
    'a pulse says "in progress", and must stop for anyone who asks for less motion');

  /* The schematic still exists for the case it was written for. */
  assert.match(page, /colour preview`\)/, 'the colour preview schematic was removed rather than narrowed');
});

test('the classes that fix reach the stylesheet', () => {
  /* A Tailwind class renders unstyled until build:css runs, the suite stays
     green either way, and only a browser notices. */
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.css'), 'utf8');
  for (const cls of ['animate-pulse', 'opacity-70']) {
    assert.ok(css.includes(cls), `${cls} is used in index.html but is not in the built stylesheet`);
  }
});
