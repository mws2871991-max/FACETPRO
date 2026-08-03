/* ─────────────────────────────────────────────────────────────────────────
   Who a lead goes to.

   The consent wording is specific, and until now the code was not:

     "pass my ... details ... to up to three vetted installers covering my
      area, so they can contact me about quoting for this work"

   Delivery posted every lead to every configured recipient, with no cap and
   no area check. With three buyers that happened to be the same thing. With a
   fourth, or with a buyer who only works the South East, it stops being the
   same thing — and the gap between what someone agreed to and what happens is
   the kind that is only ever discovered by the person it happened to.

   Three decisions worth stating.

   An installer with no areas configured covers everywhere. That is what a
   national buyer looks like, and it is the existing behaviour, so nothing
   silently stops being delivered when this ships. It does mean "covering my
   area" rests on the buyer's own claim about its footprint, which is a
   commercial fact to get in writing rather than something code can check.

   No postcode means no area, so only national buyers are eligible. We cannot
   promise someone covers an area we were never told. (Worth making the
   postcode required on the form — an installer cannot quote without one — but
   that is a product decision, not one to take here.)

   When more installers are eligible than the cap allows, the choice rotates
   on the lead id rather than always taking the first three. Order in the
   configuration would quietly starve whoever is listed last, and at £100 a
   lead that is somebody's revenue. Hashing the id spreads them evenly without
   any stored counter, and gives the same answer every time for the same lead,
   which matters when you are reconciling a delivery log.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const crypto = require('crypto');

const DEFAULT_MAX = 3;

/* UK outward code: the bit before the space. AA9A, AA9, AA99, A9, A9A, A99.
   We take the postcode as typed, which is to say inconsistently. */
const OUTWARD = /^[A-Z]{1,2}\d[A-Z\d]?$/;

function parsePostcode(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 5 || clean.length > 7) return null;
  // The inward code is always three characters, so whatever precedes it is the
  // outward code — this works whether or not they typed the space.
  const outward = clean.slice(0, -3);
  const inward = clean.slice(-3);
  if (!OUTWARD.test(outward) || !/^\d[A-Z]{2}$/.test(inward)) return null;
  return {
    outward,                                  // SW11
    area: outward.match(/^[A-Z]{1,2}/)[0],    // SW
  };
}

/* ── WHO DOES WHAT ──

   Postcode was only half the question. The two installers with signed
   per-lead contracts buy windows and doors; render, roofline and roof go to
   different contractors entirely. Until now LEAD_RECIPIENTS was one flat
   list, so everybody got everything — which means a homeowner who priced
   their whole exterior generated a lead only the window firms ever saw, and
   the render contractors never heard about work they would have paid for.

   Absent means all trades, so nothing that works today stops working. */
const TRADES = ['windows', 'doors', 'cladding', 'roofline', 'roof', 'conservatory'];

function normaliseTrades(list) {
  const trades = [];
  const bad = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const token = String(entry || '').toLowerCase().replace(/[^a-z]/g, '');
    const match = TRADES.find(t => t === token);
    if (match) trades.push(match); else bad.push(String(entry));
  }
  return { trades: [...new Set(trades)], bad };
}

/* What a lead is actually asking for, read off what they chose rather than
   off anything the browser told us. */
function tradesIn(lead) {
  const wanted = new Set();
  const g = lead?.glazing || lead?.preferences?.windows;
  if (lead?.preferences?.windows?.style || lead?.glazing?.price) wanted.add('windows');
  if (lead?.preferences?.windows?.door || lead?.glazing?.price) wanted.add('doors');
  if (lead?.selections?.cladding) wanted.add('cladding');
  if (lead?.selections?.trim || lead?.preferences?.roofline) wanted.add('roofline');
  if (lead?.selections?.roof) wanted.add('roof');
  if (lead?.conservatory) wanted.add('conservatory');
  return [...wanted];
}

const doesTrade = (recipient, trade) =>
  !recipient?.trades?.length || recipient.trades.includes(trade);

/* An area token in the configuration: either a postcode area ("SW", "M") or a
   full outward code ("SW11", "PO3"). Nothing in between, because prefix
   matching would put SW1 and SW11 in the same place and they are not. */
const AREA_TOKEN = /^[A-Z]{1,2}(\d[A-Z\d]?)?$/;

function normaliseAreas(list) {
  const areas = [];
  const bad = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const token = String(entry || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (AREA_TOKEN.test(token)) areas.push(token);
    else bad.push(String(entry));
  }
  return { areas, bad };
}

/* Does this installer cover this postcode? */
function covers(recipient, parsed) {
  if (!recipient?.areas?.length) return true;          // no restriction: national
  if (!parsed) return false;                           // restricted, and we don't know where they are
  return recipient.areas.includes(parsed.outward) || recipient.areas.includes(parsed.area);
}

/* Stable, evenly-spread offset from the lead id. */
function rotationOffset(leadId, n) {
  if (n <= 0) return 0;
  const h = crypto.createHash('sha256').update(String(leadId || '')).digest();
  return h.readUInt32BE(0) % n;
}

/* Who gets this lead, and — just as important for the delivery log — who did
   not and why. */
function chooseRecipients(recipients, lead, { max = DEFAULT_MAX } = {}) {
  const parsed = parsePostcode(lead?.postcode);
  const all = Array.isArray(recipients) ? recipients : [];

  const wanted = tradesIn(lead);
  const eligible = [];
  const skipped = [];
  for (const r of all) {
    if (!covers(r, parsed)) {
      skipped.push({ id: r.id, name: r.name, reason: parsed ? 'does not cover this area' : 'no usable postcode, and this installer is area-restricted' });
      continue;
    }
    /* A lead with no discernible trade goes to everyone eligible, as it did
       before — that is a homeowner who saved a design without choosing much,
       and guessing would be worse than sharing. */
    if (wanted.length && !wanted.some(t => doesTrade(r, t))) {
      skipped.push({ id: r.id, name: r.name, reason: `does not do ${wanted.join(' or ')}` });
      continue;
    }
    eligible.push(r);
  }

  /* Cover each trade before doubling up on any of them.

     The cap is three installers in total, not three per trade — the consent
     wording says "up to three vetted installers", and a whole-exterior job
     going to three window firms and three render firms would be six
     companies holding somebody's details on a permission for three.

     So the first pass takes one installer per trade the homeowner asked for,
     in rotation, and only then fills the remaining places. A render
     contractor beats a second window firm, because the second window firm
     adds a quote the homeowner already has. */
  const byTrade = [];
  if (wanted.length && max > 0 && eligible.length > max) {
    const taken = new Set();
    for (const trade of wanted) {
      const able = eligible.filter(r => doesTrade(r, trade) && !taken.has(r.id));
      if (!able.length || byTrade.length >= max) continue;
      const pick = able[rotationOffset(String(lead?.id) + trade, able.length)];
      taken.add(pick.id);
      byTrade.push(pick);
    }
    for (const r of eligible) {
      if (byTrade.length >= max) break;
      if (!taken.has(r.id)) { taken.add(r.id); byTrade.push(r); }
    }
  }

  let chosen = byTrade.length ? byTrade : eligible;
  /* Zero means nobody, matching how the daily caps read elsewhere. Treating it
     as "no limit" would turn the one setting someone reaches for to stop
     sharing into the one that shares with everybody. */
  if (max <= 0) {
    chosen = [];
    for (const r of eligible) skipped.push({ id: r.id, name: r.name, reason: 'sharing is switched off' });
  } else if (!byTrade.length && eligible.length > max) {
    const start = rotationOffset(lead?.id, eligible.length);
    chosen = Array.from({ length: max }, (_, i) => eligible[(start + i) % eligible.length]);
    for (const r of eligible.filter(e => !chosen.includes(e))) {
      skipped.push({ id: r.id, name: r.name, reason: `over the cap of ${max}` });
    }
  }
  if (byTrade.length) {
    /* Say which it was. A trade already covered and a trade squeezed out by
       the cap are different facts, and the delivery log is what somebody
       reads when a contractor asks why they never saw a job. */
    const served = new Set(chosen.flatMap(c => wanted.filter(t => doesTrade(c, t))));
    for (const r of eligible.filter(e => !chosen.includes(e))) {
      const theirs = wanted.filter(t => doesTrade(r, t));
      const unserved = theirs.filter(t => !served.has(t));
      skipped.push({
        id: r.id, name: r.name,
        reason: unserved.length
          ? `over the cap of ${max} — nobody is covering ${unserved.join(' or ')} on this lead`
          : `over the cap of ${max} — ${theirs.join(' and ')} already covered`,
      });
    }
  }

  return {
    chosen,
    routing: {
      outward: parsed?.outward || null,
    trades: wanted,
      postcodeUsable: !!parsed,
      cap: max,
      eligible: eligible.map(r => r.id),
      chosen: chosen.map(r => r.id),
      skipped,
    },
  };
}

module.exports = { parsePostcode, normaliseAreas, normaliseTrades, tradesIn, doesTrade, covers, chooseRecipients, rotationOffset, DEFAULT_MAX, AREA_TOKEN, TRADES };
