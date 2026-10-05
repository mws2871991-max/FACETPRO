/* What a roof or roofline render must leave alone (handoff 5 October, §4).

   Seen live: Ink Trim painting a garden gate, a door surround and the timbers
   and brackets of a mock-Tudor gable; a new roof laid over a gable wall and
   over the tile-hanging of an upper storey whose walls were set to "Leave as
   it is". renderprompt.js already says not to, and wording has lost this
   argument every time it has been tried (see framing in server.js, the door
   in hold.js). So the same answer as the door, the bay and the driveway:
   segment what stays, and put it back from the photograph afterwards.

   Two prompts per render, because one mask alone would either miss the gate
   or eat the roof. `keep` names what stays; `change` names what was asked
   for, and wins wherever the two overlap — see restoreKeptParts in hold.js.

   Only when the walls are not changing. With new walls a pasted gate or door
   frame carries a sliver of old wall with it, a halo against new render, the
   same reason restoreDoor stands down.

   Behind KEPT_PARTS while it is proved: off (default), test (only a page
   opened with ?exp=kept), on. Two segmentation calls per roof or roofline
   render, run beside the render so they cost time only when cold. */

'use strict';

function mode(env = process.env) {
  const m = String(env.KEPT_PARTS || '').toLowerCase();
  return ['off', 'test', 'on'].includes(m) ? m : 'off';
}

function enabled(body, env = process.env) {
  const m = mode(env);
  return m === 'on'
    || (m === 'test' && Array.isArray(body?.experiments) && body.experiments.includes('kept-parts'));
}

/* Things on the front of a house that are not roof or roofline and that the
   roofline colour has been seen landing on. Window frames only when the
   windows are staying: otherwise they are the job. Door likewise. */
const TRIM_KEEPS = ['gate', 'fence', 'door frame', 'porch', 'timber beam', 'wooden bracket'];
/* What a new roof has been seen covering. "tile hanging" is the upper wall of
   a tile-hung house, which detection labels cladding and the model takes for
   roof; "gable wall" the triangle of wall under a gable-fronted roof. */
const ROOF_KEEPS = ['wall', 'tile hanging', 'gable wall', 'timber beam', 'bay window'];
const ROOF_CHANGES = ['roof'];
const TRIM_CHANGES = ['fascia', 'soffit', 'gutter', 'bargeboard'];

/* null when there is nothing for this hold to do: no roof or roofline
   changing, or new walls. */
function plan({ trim = false, roof = false, cladding = false, windows = false, door = false } = {}) {
  if (cladding || (!trim && !roof)) return null;
  const keep = new Set();
  const change = new Set();
  if (trim) { TRIM_KEEPS.forEach(p => keep.add(p)); TRIM_CHANGES.forEach(p => change.add(p)); }
  if (roof) { ROOF_KEEPS.forEach(p => keep.add(p)); ROOF_CHANGES.forEach(p => change.add(p)); }
  /* Kept roofline on a roof job is left to the prompt: holding the fascia
     back would put a seam along the eaves of the new roof. */
  /* What this job is replacing comes off the keep list, not just out of the
     boxes: a box that misses the edge of a bay or a door would otherwise let
     the old frame be pasted over the new one. */
  if (windows) keep.delete('bay window');
  else keep.add('window frame');
  if (door) { keep.delete('door frame'); keep.delete('porch'); }
  else keep.add('front door');
  return { keep: [...keep].join(', '), change: [...change].join(', ') };
}

module.exports = { mode, enabled, plan, TRIM_KEEPS, ROOF_KEEPS, ROOF_CHANGES, TRIM_CHANGES };
