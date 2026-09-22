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

/* The same idea for window and door frames, which had none.

   Every other trade reaches the model as a description. Frames reached it as
   "Anthracite" or "Chartwell Green" — trade names off a swatch card, which the
   comment above says steer the picture poorly, and which the model is left to
   guess at. That is why frame colour has been ignored on every run since
   August while walls and roofs obeyed.

   Kept separate from COLOUR_WORDS rather than merged into it, because two of
   these ids are the words "white" and "black". A cladding or roof swatch could
   be given either name tomorrow, and the merge would silently hand a frame
   description to a wall.

   The words are read off the swatch hexes, not the names. Two of the six
   disagree with what the name suggests: agate-grey is #8A8D8F, a mid neutral
   that is faintly cool rather than a light warm grey, and chartwell-green is
   #5B7C5B, which is a mid green and not a pale one. Describing them the way
   the names sound would reintroduce the same problem one step further along. */
const FRAME_COLOUR_WORDS = {
  anthracite: 'very dark blue-grey, almost black, matte',       // #2B2D42
  'agate-grey': 'mid cool grey, matte',                         // #8A8D8F
  white: 'clean bright white',                                  // #FFFFFF
  'chartwell-green': 'muted mid sage green',                    // #5B7C5B
  black: 'matte black',                                         // #1C1C1C
  cream: 'soft warm cream',                                     // #F5F0E6
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
  /* Material-neutral, because naming brick excused everything that is not.

     This read "every brick, its colour, its mortar joints and its texture".
     On a tile-hung house that sentence holds nothing: the upper wall is not
     brick, so no part of the instruction covers it. Measured on the site's own
     hero photograph, asking for a slate roof turned the tile-hung upper wall
     slate grey and left the terracotta roof alone — the model took the only
     surface in the frame made of small flat overlapping tiles and changed
     that, which is a defensible reading of what it was told. */
  cladding: 'the existing wall surface, whatever it is made of — brick, ' +
            'tile-hanging, render, stone or boarding — including its colour, ' +
            'its texture and any joints or courses in it',
  trim: 'the fascias, soffits, bargeboards and guttering, in their existing colour',
  roof: 'the existing roof covering — the same tiles, the same colour, the same texture',
  glazing: 'the windows and the front door, including the exact colour of every frame',
};

/* Wall surfaces the model will mistake for a roof if nobody says otherwise.

   Detection already labels them — "Tile Hanging Upper Wall" comes back as a
   cladding box on the test photograph — and until now that knowledge stopped
   at the detect call and never reached the render. */
/* The same test the framing guard uses, from the same place.

   Both ask "did detection call this wall tiled?" and they must never disagree:
   the guard decides whether a roof is worth requesting at all, and this
   decides whether the request carries the correction. Two copies of one regex
   is exactly how the bay-pane rule and the neighbour-window regex drifted. */
const { TILED_WALL_LABEL: TILE_HUNG } = require('./geometry');

function buildRenderPrompt(sel = {}) {
  const cladding = chosen(sel.cladding);
  const trim = chosen(sel.trim);
  const roof = chosen(sel.roof);

  /* What detection saw on the walls, as labels. Optional: a render without a
     detectionId still works exactly as it did, which matters because the
     record is pruned after a while and a retry may outlive it. */
  const wallMaterials = Array.isArray(sel.wallMaterials) ? sel.wallMaterials.map(String) : [];
  const tileHungWall = wallMaterials.some(l => TILE_HUNG.test(l));

  const windowStyle = String(sel.windowStyle || '').trim();
  const doorStyle = String(sel.doorStyle || '').trim();
  const glazingColour = String(sel.glazingColour || '').trim();
  const changingGlazing = !!(glazingColour && (windowStyle || doorStyle));

  /* The frame colour as a description where the id is known, and as the bare
     trade name only where it is not. Same rule as every other trade: the id is
     the selection, the name is a label somebody in marketing may reword. */
  const glazingColourId = String(sel.glazingColourId || '').trim();
  const frameWords = FRAME_COLOUR_WORDS[glazingColourId] || null;
  const glazingColourPhrase = frameWords ? `${glazingColour} — ${frameWords}` : glazingColour;

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
    /* "Of this house", because "every visible roof slope" was taken
       literally: on 19 September the roof changed correctly and so did the
       roof of the house next door, which was visible. */
    /* The exclusion goes in the sentence that does the work.

       "Of this house, the one in the middle of the photograph" plus a hold
       further down was not enough: measured on a real render, the subject's
       roof turned correctly (red-minus-blue -18 → 74) and so did the
       neighbour's at the right-hand edge (-2 → 90), while the neighbour at
       the left edge was untouched (-42 → -35).

       The asymmetry says what the problem is. The right-hand roof runs off the
       edge of the frame and reads as a continuation of the subject's roofline;
       a roof fully inside the frame does not. So the instruction names that
       specific case, and it sits beside the verb rather than in a list of
       things to leave alone twelve clauses later. */
    changes.push(
      /* The roof named by where it is, not only by what it is made of.

         "Every visible roof slope" is a material description, and on a
         tile-hung house there are two surfaces in the frame that answer to it.
         Position is the thing that separates them: the roof is above the
         fascia and guttering, and the tile-hanging is below. */
      `Replace the roof covering on every visible roof slope of this house — the sloping roof above the fascia and ` +
      `guttering, on the house in the centre of the photograph, ` +
      `the one whose front door is visible — including any porch or bay roof, with ${describe(roof, ROOF_SURFACE)}. ` +
      `Do not change the roof of the houses on either side of it: any roof that runs off the left or right edge of the ` +
      `frame belongs to a neighbouring property and must keep its original colour, material and texture exactly, even ` +
      `where it appears to continue from this roof. The roof of this house must visibly change.`);
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
      `both in ${glazingColourPhrase}. Every window frame and the door frame must visibly take this colour. ` +
      `Frame proportions and opening sizes must match the existing ` +
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
  // Held whatever was chosen: every change above is to this house only.
  holds.push('every neighbouring or attached house, including its roof, walls and windows');
  holds.push('the garden, path, driveway, fencing, sky and everything beyond the house');

  /* "Change only the roof" is a stronger sentence than any list of holds, and
     it is available exactly when one trade was chosen — which is the whole
     roof journey, and the case the reviewer was testing. */
  const single = changes.length === 1;

  return [
    'Edit this photograph of a house.',
    /* Scope before instruction, because two attempts at putting it inside the
       instruction failed.

       Measured on live renders: naming the subject "the one in the middle of
       the photograph" and holding "every neighbouring or attached house" left
       the right-hand neighbour's roof turning terracotta (red-minus-blue
       -2 → 90). Naming the frame edges explicitly inside the roof sentence
       did the same (-2 → 84). The left-hand neighbour was held both times, so
       the model can tell buildings apart — what it does not do is treat a
       mid-sentence caveat as a boundary on where the edit may apply.

       So the boundary is stated first, as the scope of the whole request,
       before anything has been asked for. */
    'Only one building in this photograph may change: the house in the centre, the one whose front door faces the camera. ' +
    'Any other building — the properties at the left and right edges of the frame, attached or detached, and every part of them ' +
    'including their roofs — must be pixel-for-pixel identical to the original.',

    /* Which surface is the roof, stated as scope, for the same reason the
       building boundary is.

       This shipped once inside the roof sentence and was measured on the
       site's own hero photograph: the tile-hung wall went from warm red-brown
       to slate blue-grey (shift 24.9) and the terracotta roof did not move
       (shift 1.0). Identical outcome to the two failed attempts at the
       neighbour's roof, and the same cause — the model does not treat a
       mid-sentence caveat as a boundary on where the edit may apply.

       On a close-up like that photograph the tile-hanging is also the largest
       tiled surface in the frame, so "every visible roof slope" and "thin,
       flat, rectangular, laid in regular overlapping courses" both point at it
       more strongly than at the sliver of real roof along the top edge. Naming
       what the roof is not, before anything has been asked for, is the only
       shape of this instruction that has ever held. */
    (tileHungWall && roof)
      ? 'One more boundary, before the change: in this photograph the roof is only the sloping surface at the very top, '
        + 'above the fascia and guttering. The large area of small overlapping tiles on the wall below the guttering is '
        + 'tile-hanging. It is a wall surface, it is not a roof, and no instruction about the roof applies to it — it must '
        + 'stay exactly the colour, material and texture it is now.'
      : null,

    single ? `Make one change, and only one.` : `Make the following changes, and only these.`,
    ...changes,
    `Leave the following exactly as they are in the original photograph, pixel for pixel: ${holds.join('; ')}.`,
    `Do not add, remove, move or resize any window, door, chimney or other opening or feature.`,
    `Preserve the exact perspective, shadow direction, ambient lighting colour temperature, lens distortion, camera exposure and depth of field of the original photograph.`,
    `Shadows and reflections must remain consistent with the existing light source angle and intensity.`,
    `The result must be indistinguishable from a real photograph of the same house after that work was carried out.`,
  ].filter(Boolean).join(' ');
}

module.exports = { buildRenderPrompt, CLADDING_SURFACE, ROOF_SURFACE, COLOUR_WORDS };
