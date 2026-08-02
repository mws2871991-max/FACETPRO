/* What counts as a plausible house.

   These were stated in three places — the pricing bounds in server.js, the
   window count in glazing.js, and both restated in resume.js — and they had
   already drifted. A design carried to a phone could come back holding a
   5,000 m² wall area that the quote engine then silently discarded, so the
   price on the phone differed from the price on the desk with no explanation.

   Nobody would ever type 5,000, which is exactly why it would have gone
   unnoticed. The codebase keeps one definition of every other bound —
   CONSENTED_MAX_INSTALLERS, the daily caps — and this is the file that makes
   that true of these.

   The numbers themselves, and why:

     wall area    The smallest terraced front we have measured is around
                  30 m²; the largest detached around 250. Outside 15–600 is a
                  tampered or stale client rather than a house.
     roofline     A perimeter, so bounded for the same reason.
     windows      One is a flat; thirty is a large detached with bays counted
                  separately. Beyond that we are reading the picture wrong.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

module.exports = {
  MANUAL_AREA_MIN_M2: 15,
  MANUAL_AREA_MAX_M2: 600,

  TRIM_LENGTH_MIN_M: 4,
  TRIM_LENGTH_MAX_M: 200,

  MIN_WINDOWS: 1,
  MAX_WINDOWS: 30,
};
