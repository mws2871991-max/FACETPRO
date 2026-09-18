/* The instruction we send the image model, asserted as a string.

   Nothing could see this before. It lived inside the /api/render handler, and
   the only way to find out what it said was to read the code or to look very
   carefully at a picture — because FLUX Kontext returns a plausible,
   well-lit, entirely valid photograph for an incoherent request. There is no
   error. The render succeeds. The house is simply wrong.

   That is how the 18 September review found three P0s from outside that six
   hundred passing tests could not see from inside: a roof that never changed,
   brick walls clad in weatherboard after the customer chose "Leave as it is",
   and one Alabaster coming back as render and the next as painted brick.

   Every case below is one of those symptoms, pinned to the string that caused
   it. The regression guard at the end is the important one: it asserts the
   literal sentence the old prompt produced can never be produced again. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { buildRenderPrompt } = require('../renderprompt');

const catalogue = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'catalogue.json'), 'utf8'));

/* Real catalogue entries, not hand-written doubles. A prompt built from a
   fixture that has drifted from catalogue.json proves nothing about the
   prompt the customer actually gets. */
const sw = (group, id) => {
  const found = (catalogue[group] || []).find(s => s.id === id);
  assert.ok(found, `${group}/${id} is not in catalogue.json any more — this test is now fiction`);
  return found;
};

const NONE = { id: 'none', name: 'Leave as it is' };

const alabaster = () => sw('cladding', 'alabaster');
const graphite = () => sw('cladding', 'graphite');
const slate = () => sw('roof', 'slate-roof');
const terracotta = () => sw('roof', 'terracotta');
const ink = () => sw('trim', 'ink-trim');

/* ── The three P0s ── */

test('P0-1: a chosen roof is asked for in its own sentence, and insistently', () => {
  const p = buildRenderPrompt({ cladding: NONE, trim: NONE, roof: terracotta() });

  assert.match(p, /clay plain tiles/i,
    'the roof must be asked for as a material, not as the colour word "Terracotta"');
  assert.match(p, /every visible roof slope/i,
    'a front elevation usually has a porch or bay roof as well as the main slope');
  assert.match(p, /roof must visibly change/i);

  /* The reviewer chose a roof three times and got the original roof three
     times. The old prompt asked for it as the third clause of a sentence
     whose first two clauses were nonsense. It gets its own now. */
  const roofSentence = p.split('. ').find(s => /roof covering/i.test(s));
  assert.ok(roofSentence, 'the roof instruction is not a sentence of its own');
  assert.doesNotMatch(roofSentence, /wall surface|fascia/i,
    'the roof request is sharing a sentence with another trade again — that is ' +
    'the shape of the bug: a compound request is as strong as its weakest clause');
});

test('P0-2: a trade set to "Leave as it is" is never asked to change', () => {
  // The reviewer's render 1: roof-only. Walls and trim explicitly left.
  const p = buildRenderPrompt({ cladding: NONE, trim: NONE, roof: slate() });

  assert.doesNotMatch(p, /Replace the exterior wall surface/i,
    'the walls were set to leave and the picture clad them in weatherboard');
  assert.doesNotMatch(p, /Repaint the fascias/i,
    'the trim was set to leave and the porch canopy went from green to red');

  // And not merely absent — actively held.
  assert.match(p, /Leave the following exactly as they are[\s\S]*every brick/i);
  assert.match(p, /Leave the following exactly as they are[\s\S]*fascias, soffits/i);
  assert.match(p, /windows and the front door, including the exact colour of every frame/i,
    'render 3 changed the window frames from white to grey in a session that ' +
    'never touched windows');
});

test('P0-2: one chosen trade says so in the strongest available words', () => {
  const p = buildRenderPrompt({ cladding: NONE, trim: NONE, roof: slate() });
  assert.match(p, /Make one change, and only one/,
    'the roof journey is exactly the single-trade case, and "change only this" ' +
    'is a stronger instruction than any list of things to hold');

  const many = buildRenderPrompt({ cladding: alabaster(), trim: ink(), roof: slate() });
  assert.doesNotMatch(many, /Make one change, and only one/);
  assert.match(many, /Make the following changes, and only these/);
});

test('P0-3: Alabaster is asked for as render, never as a colour to paint brick', () => {
  const p = buildRenderPrompt({ cladding: alabaster(), trim: NONE, roof: NONE });

  assert.match(p, /through-coloured sand-and-cement render/i);
  assert.match(p, /no brick or block texture showing through/i,
    'the same choice came back once as real render and once as white-painted ' +
    'brick — with only a colour word to go on, tinting the brick is a ' +
    'reasonable reading, and it is a different job at a different price');
  assert.match(p, /rather than as the old surface painted a new colour/i);
});

test('each finish is described as the material it actually is', () => {
  const cases = [
    ['cladding', 'clay-stone', /natural stone cladding/i],
    ['cladding', 'sage-slate', /fibre-cement weatherboard/i],
    ['cladding', 'graphite', /composite cladding boards/i],
    ['roof', 'slate-roof', /natural slate tiles/i],
    ['roof', 'charcoal-roof', /interlocking concrete roof tiles/i],
    ['roof', 'terracotta', /clay plain tiles/i],
  ];
  for (const [group, id, re] of cases) {
    const key = group === 'roof' ? 'roof' : 'cladding';
    const p = buildRenderPrompt({ cladding: NONE, trim: NONE, roof: NONE, [key]: sw(group, id) });
    assert.match(p, re, `${group}/${id} is not described as a material`);
  }
});

test('every catalogue finish has a material description — no silent fallbacks', () => {
  /* A finish added to the catalogue without a materialType would quietly fall
     back to its name, which is the failure mode this whole file exists to
     stop: "Alabaster" as an instruction is what produced painted brick. */
  const { CLADDING_SURFACE, ROOF_SURFACE, COLOUR_WORDS } = require('../renderprompt');
  for (const c of catalogue.cladding || []) {
    assert.ok(CLADDING_SURFACE[c.materialType],
      `cladding "${c.name}" has materialType "${c.materialType}" with no surface description — ` +
      'add one to renderprompt.js, or the prompt will ask for a colour and get paint');
    assert.ok(COLOUR_WORDS[c.id], `cladding "${c.name}" has no colour word`);
  }
  for (const r of catalogue.roof || []) {
    assert.ok(ROOF_SURFACE[r.materialType],
      `roof "${r.name}" has materialType "${r.materialType}" with no surface description`);
    assert.ok(COLOUR_WORDS[r.id], `roof "${r.name}" has no colour word`);
  }
  for (const t of catalogue.trim || []) {
    assert.ok(COLOUR_WORDS[t.id], `trim "${t.name}" has no colour word`);
  }
});

/* ── The cause, pinned ── */

test('the exact broken sentence can never be produced again', () => {
  /* What the old handler built for the reviewer's roof-only render:

       "Replace the exterior wall cladding with a photorealistic Leave as it
        is finish, the window/door trim with Leave as it is coloured trim,
        and the roof material with Slate Roof."

     `claddingName || 'Alabaster'` let a truthy sentence through as a product
     name. Every combination below would have carried it. */
  const noneish = [
    { id: 'none', name: 'Leave as it is' },
    { name: 'Leave as it is' },          // a name with no id at all
    { id: 'none' },
    null,
    undefined,
  ];
  for (const n of noneish) {
    const p = buildRenderPrompt({ cladding: n, trim: n, roof: slate() });
    assert.ok(p, 'the roof was still chosen, so there is still a prompt');
    assert.doesNotMatch(p, /leave as it is/i,
      `"${JSON.stringify(n)}" leaked the display name into the instruction`);
  }
});

test('an id of none beats a name that looks like a real finish', () => {
  /* Defence in depth, and the realistic accident: an id correctly set to none
     alongside a stale name. The id is the selection. */
  const p = buildRenderPrompt({
    cladding: { id: 'none', name: 'Alabaster', materialType: 'render' },
    trim: NONE, roof: slate(),
  });
  assert.doesNotMatch(p, /Replace the exterior wall surface/i);
});

test('nothing chosen returns null rather than inventing a request', () => {
  assert.strictEqual(buildRenderPrompt({ cladding: NONE, trim: NONE, roof: NONE }), null);
  assert.strictEqual(buildRenderPrompt({}), null);
  assert.strictEqual(buildRenderPrompt(), null);

  /* This is what the ?journey=windows visitor sent on upload, every time,
     because the client-side guard compared the swatch *name* against 'none'
     while the name is "Leave as it is". Fifty renders a day, and some of them
     were bought to ask for nothing. */
});

/* ── Glazing, which was already conditional and should stay that way ── */

test('glazing changes only when a colour and a style were both chosen', () => {
  const base = { cladding: NONE, trim: NONE, roof: slate() };

  const none = buildRenderPrompt(base);
  assert.doesNotMatch(none, /Replace the window frames/i);
  assert.match(none, /windows and the front door, including the exact colour/i);

  const colourOnly = buildRenderPrompt({ ...base, glazingColour: 'Anthracite' });
  assert.doesNotMatch(colourOnly, /Replace the window frames/i,
    'a colour with no style is not a coherent request');

  const both = buildRenderPrompt({ ...base, glazingColour: 'Anthracite', windowStyle: 'Casement' });
  assert.match(both, /Replace the window frames with photorealistic Casement windows.*Anthracite/is);
  assert.doesNotMatch(both, /Leave the following[\s\S]*including the exact colour of every frame/i,
    'the frames cannot be both replaced and held');
});

test('glazing alone is enough to be worth a render', () => {
  const p = buildRenderPrompt({
    cladding: NONE, trim: NONE, roof: NONE,
    glazingColour: 'Anthracite', windowStyle: 'Casement', doorStyle: 'Composite',
  });
  assert.ok(p, 'a windows-and-doors customer has chosen something');
  assert.match(p, /Make one change, and only one/);
  assert.match(p, /a Composite front door/);
  // The walls and roof they did not ask about are held.
  assert.match(p, /every brick, its colour, its mortar joints/i);
  assert.match(p, /the same tiles, the same colour, the same texture/i);
});

/* ── Things the old prompt got right, kept ── */

test('the protections that were already there survive the rewrite', () => {
  const p = buildRenderPrompt({ cladding: alabaster(), trim: ink(), roof: terracotta() });
  assert.match(p, /Do not add, remove, move or resize any window, door/i,
    'FLUX Kontext will happily improve a house by adding a window');
  assert.match(p, /perspective, shadow direction, ambient lighting colour temperature/i);
  assert.match(p, /Shadows and reflections must remain consistent/i);
  assert.match(p, /indistinguishable from a real photograph/i);
  assert.match(p, /garden, path, driveway, fencing, sky/i);
});

test('all three trades each get their own sentence', () => {
  const p = buildRenderPrompt({ cladding: graphite(), trim: ink(), roof: terracotta() });
  assert.match(p, /Replace the exterior wall surface/i);
  assert.match(p, /Replace the roof covering/i);
  assert.match(p, /Repaint the fascias/i);
  // And nothing is held that is also being changed.
  assert.doesNotMatch(p, /Leave the following[\s\S]*every brick/i);
  assert.doesNotMatch(p, /Leave the following[\s\S]*fascias, soffits/i);
  assert.doesNotMatch(p, /Leave the following[\s\S]*same tiles, the same colour/i);
});
