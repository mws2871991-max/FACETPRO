/* ─────────────────────────────────────────────────────────────────────────
   Carrying a design from one device to another.

   Somebody at a desk has chosen their windows and their colours and now has
   to go outside and photograph their house. That is where the journey ends
   for most of them — the camera is in their pocket, the design is on the
   screen, and there is no bridge between the two. This is the bridge: a short
   code they type into their phone.

   The design and nothing else. This module's whole reason for existing is the
   allowlist below.

   Emailing or texting a link would do the same job and cost far more than it
   looks: an email address collected to send a link is personal data, which
   means a lawful basis, a retention period, a line in the notice and
   something to disclose if it leaks — and SMS adds a vendor, a processor
   agreement and PECR on top. Storing only the choices means there is nothing
   here to protect. A stranger who guesses a code learns that somebody, once,
   liked anthracite windows.

   So the payload is built by naming every field, never by copying what the
   client sent. Two things must never end up here: the photograph, and
   anything about the person. Both are easy to add by accident and neither
   would be obvious afterwards.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const crypto = require('crypto');

// Twenty-four hours. Long enough to walk round the house after tea, short
// enough that nothing lingers.
const TTL_MS = 24 * 60 * 60 * 1000;

/* Crockford's base32 without I, L, O and U, so nothing is misread off a
   screen and typed wrong on a phone. Six characters is thirty bits — plenty
   when what it unlocks is a set of colour preferences. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;

function newCode() {
  let out = '';
  // rejection-sampled so every character is equally likely
  while (out.length < CODE_LENGTH) {
    for (const byte of crypto.randomBytes(CODE_LENGTH)) {
      if (byte < 248 && out.length < CODE_LENGTH) out += ALPHABET[byte % 32];
    }
  }
  return out;
}

/* People will type O for 0 and I for 1 whatever the alphabet says, so read
   the two most common substitutions rather than refusing them. */
const normaliseCode = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');

const isCode = (raw) => new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(normaliseCode(raw));

/* Everything that may travel, and nothing else.

   Ids are catalogue keys and are resolved against the catalogue when they are
   used, so a bad one is inert. Numbers are bounded here because they arrive
   from a browser. */
const ID_FIELDS = [
  'claddingId', 'trimId', 'roofId',
  'windowStyleId', 'doorStyleId', 'windowDoorColourId',
  'fasciaId', 'soffitId', 'gutteringId', 'rooflineCladdingId',
  'conservatoryStyleId', 'houseType',
];

/* The same bounds the quote engine enforces, taken from the same file rather
   than restated. These had drifted: a code could carry back a 5,000 m² wall
   area that resolveFootprint then discarded, so the price on the phone
   differed from the price on the desk with nothing to explain it. */
const L = require('./limits');
const NUMBER_FIELDS = {
  footprintM2: { min: L.MANUAL_AREA_MIN_M2, max: L.MANUAL_AREA_MAX_M2 },
  trimLengthM: { min: L.TRIM_LENGTH_MIN_M, max: L.TRIM_LENGTH_MAX_M },
  windowCount: { min: L.MIN_WINDOWS, max: L.MAX_WINDOWS },
};

const cleanId = (v) => {
  const s = String(v ?? '').trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null;
};

function buildPayload(body) {
  const design = {};
  for (const field of ID_FIELDS) {
    const value = cleanId(body?.[field]);
    if (value) design[field] = value;
  }
  for (const [field, { min, max }] of Object.entries(NUMBER_FIELDS)) {
    const n = Number(body?.[field]);
    if (Number.isFinite(n) && n >= min && n <= max) design[field] = n;
  }
  return design;
}

const isExpired = (row, now = Date.now()) => {
  const t = Date.parse(row?.expiresAt);
  return !Number.isFinite(t) || t <= now;
};

/* The newest unexpired row for a code. Newest because a code is unique in the
   database but the JSONL backend is append-only, so a re-issue leaves both. */
function find(rows, code, now = Date.now()) {
  const wanted = normaliseCode(code);
  if (!isCode(wanted)) return null;
  let found = null;
  for (const row of rows || []) {
    if (row?.code !== wanted || isExpired(row, now)) continue;
    if (!found || Date.parse(row.ts) >= Date.parse(found.ts)) found = row;
  }
  return found;
}

module.exports = { newCode, normaliseCode, isCode, buildPayload, find, isExpired, TTL_MS, CODE_LENGTH, ID_FIELDS, NUMBER_FIELDS };
