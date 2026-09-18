/* What we actually ask the image model for.

   This was eight lines inside the /api/render handler, unreachable from any
   test, and it was wrong in three ways at once — all of them invisible from
   the server's side, because a wrong prompt returns a perfectly valid picture.

   The 18 September review found the symptoms from outside: a roof that never
   changed however it was set, brick walls clad in weatherboard after the
   customer chose "Leave as it is", and the same Alabaster coming back once as
   real render and once as painted brick. One cause underneath all three.

   THE CAUSE. "Leave as it is" is a swatch whose id is 'none' and whose *name*
   is the sentence "Leave as it is". The handler read names:

       const cladding = claddingName || 'Alabaster';

   'Leave as it is' is a truthy string, so it sailed past the default and was
   pasted into the instruction:

       "Replace the exterior wall cladding with a photorealistic Leave as it
        is finish, the window/door trim with Leave as it is coloured trim,
        and the roof material with Slate Roof."

   Which explains everything the reviewer saw. The model was told to replace
   the walls, so it did — with whatever "Leave as it is finish" suggested,
   which came back as grey weatherboard. The one real instruction in the
   sentence was the third clause of a request whose first two clauses were
   nonsense, and it was dropped. The customer's roof never changed because we
   never coherently asked for it.

   So this module takes resolved catalogue entries, never display strings, and
   null means leave that trade alone. A trade that is not changing is not
   mentioned as a change — it is named in the hold list instead, which is the
   other half of the fix: "leave everything else alone" is weaker than naming
   the roof and saying the roof must not move.

   Kept deliberately free of Express, the catalogue file and the network, so
   the prompt can be asserted as a string. The prompt is the product; it was
   the one part of it nothing could see. */

'use strict';

/* What each finish physically is, in the words a photograph shows.

   "Alabaster" names a colour to us and nothing at all to the model, which is
   why the same choice came back as smooth render in one picture and painted
   brick in the next: with only a colour to go on, keeping the brick texture
   and tinting it white is a reasonable reading of the request. It is also the
   one result a rendering customer must never be shown, because painted brick
   is a different job at a different price.

   Keyed on catalogue materialType, which already exists on every cladding and
   roof entry and was already driving the "Alabaster (Render)" label on the
   cost pages and the lead emails. The catalogue knew; the prompt did not. */
const CLADDING_SURFACE = {
  render: 'a smooth, through-coloured sand-and-cement render, flat and even, ' +
          'with no brick or block texture showing through anywhere',
  stone: 'natural stone cladding, with individual stones of varying size and ' +
         'visible mortar joints between them',
  fiber_cement: 'fibre-cement weatherboard cladding, in horizontal overlapping ' +
                'boards with a fine wood grain',
  composite: 'composite cladding boards, flat and matte, in even vertical runs',
};

const ROOF_SURFACE = {
  slate: 'natural slate tiles — thin, flat, rectangular, laid in regular ' +
         'overlapping courses',
  concrete_tile: 'interlocking concrete roof tiles, with the regular raised ' +
                 'ribs of a modern profiled tile',
  clay_tile: 'clay plain tiles, in small overlapping courses with the warm ' +
             'uneven colour of fired clay',
};

/* A colour word is worth more to the model than a hex code, which it cannot
   read. The hex is still used — as the thing these words describe — but the
   words are what steer the picture. */
const COLOUR_WORDS = {
  alabaster: 'off-white, barely warm',
  'clay-stone': 'soft sandy beige',
  'sage-slate': 'muted sage green',
  graphite: 'near-black charcoal grey',
  'coastal-fog': 'pale cool grey',
  'ink-trim': 'near-black ink blue',
  cedar: 'warm mid-brown',
  'slate-roof': 'blue-grey',
  'charcoal-roof': 'very dark charcoal, almost black',
  terracotta: 'warm orange-brown terracotta',
};

const describe = (sw, table) => {
  if (!sw) return null;
  const colour = COLOUR_WORDS[sw.id];
  const surface = table[sw.materialType];
  if (surface && colour) return `${surface}, in ${colour}`;
  if (surface) return surface;
  if (colour) return `${sw.name} (${colour})`;
  return sw.name;
};

/* Null, not a name, is how a trade says "don't touch me".

   Anything without an id, or with the id 'none', is not a selection. Checked
   on the id and never on the name, because the name is a sentence somebody in
   marketing is entitled to reword, and the day they do is the day the walls
   start changing again. */
const chosen = (sw) => (sw && sw.id && sw.id !== 'none') ? sw : null;

/* Everything the picture must not touch, named.

   "Only the wall cladding, trim colour and roof material change" was the old
   instruction, and it is a weaker sentence than it looks: it says what may
   change and leaves the rest as a category. Naming the roof, and saying the
   roof must be identical, is what actually holds it — and the trades left out
   are exactly the ones the customer said to leave, so they are the ones worth
   the words. */
const HOLDS = {
  cladding: 'the existing wall surface — every brick, its colour, its mortar ' +
            'joints and its texture',
  trim: 'the fascias, soffits, bargeboards and guttering, in their existing colour',
  roof: 'the existing roof covering — the same tiles, the same colour, the same texture',
  glazing: 'the windows and the front door, including the exact colour of every frame',
};

function buildRenderPrompt(sel = {}) {
  const cladding = chosen(sel.cladding);
  const trim = chosen(sel.trim);
  const roof = chosen(sel.roof);

  const windowStyle = String(sel.windowStyle || '').trim();
  const doorStyle = String(sel.doorStyle || '').trim();
  const glazingColour = String(sel.glazingColour || '').trim();
  const changingGlazing = !!(glazingColour && (windowStyle || doorStyle));

  /* One sentence per trade, each beginning with the thing it acts on.

     The old prompt asked for all three in a single sentence with the roof
     last, and the roof was what went missing. A compound request is only ever
     as strong as its weakest clause; three requests are three requests. */
  const changes = [];
  if (cladding) {
    changes.push(
      `Replace the exterior wall surface with ${describe(cladding, CLADDING_SURFACE)}. ` +
      `Cover the walls completely and evenly, so the finish reads as ${cladding.materialLabel || cladding.name} ` +
      `rather than as the old surface painted a new colour.`);
  }
  if (roof) {
    /* Every visible slope, said out loud. A front elevation usually shows a
       main slope and a porch or bay roof, and changing one and not the other
       is its own kind of wrong picture. */
    changes.push(
      `Replace the roof covering on every visible roof slope, including any porch or bay roof, ` +
      `with ${describe(roof, ROOF_SURFACE)}. The roof must visibly change.`);
  }
  if (trim) {
    changes.push(
      `Repaint the fascias, soffits, bargeboards and guttering in ${describe(trim, {})}. ` +
      `Change their colour only — their shape, size and position stay exactly as they are.`);
  }
  if (changingGlazing) {
    changes.push(
      `Replace the window frames${doorStyle ? ' and the front door' : ''} with photorealistic ` +
      `${windowStyle || 'casement'} windows${doorStyle ? ` and a ${doorStyle} front door` : ''}, ` +
      `both in ${glazingColour}. Frame proportions and opening sizes must match the existing ` +
      `apertures exactly. Glass reflections must stay consistent with the original sky and surroundings.`);
  }

  // Nothing to ask for. The caller decides what to do about it; this refuses
  // to invent a request, which is how the whole problem started.
  if (!changes.length) return null;

  const holds = [];
  if (!cladding) holds.push(HOLDS.cladding);
  if (!trim) holds.push(HOLDS.trim);
  if (!roof) holds.push(HOLDS.roof);
  if (!changingGlazing) holds.push(HOLDS.glazing);
  holds.push('the garden, path, driveway, fencing, sky and everything beyond the house');

  /* "Change only the roof" is a stronger sentence than any list of holds, and
     it is available exactly when one trade was chosen — which is the whole
     roof journey, and the case the reviewer was testing. */
  const single = changes.length === 1;

  return [
    'Edit this photograph of a house.',
    single ? `Make one change, and only one.` : `Make the following changes, and only these.`,
    ...changes,
    `Leave the following exactly as they are in the original photograph, pixel for pixel: ${holds.join('; ')}.`,
    `Do not add, remove, move or resize any window, door, chimney or other opening or feature.`,
    `Preserve the exact perspective, shadow direction, ambient lighting colour temperature, lens distortion, camera exposure and depth of field of the original photograph.`,
    `Shadows and reflections must remain consistent with the existing light source angle and intensity.`,
    `The result must be indistinguishable from a real photograph of the same house after that work was carried out.`,
  ].join(' ');
}

module.exports = { buildRenderPrompt, CLADDING_SURFACE, ROOF_SURFACE, COLOUR_WORDS };
