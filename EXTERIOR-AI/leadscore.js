/* ─────────────────────────────────────────────────────────────────────────
   How good is this lead?

   An installer pays per lead. What they are buying is the probability that a
   phone call turns into a survey, and until now every lead looked identical on
   the way out: same email, same payload, no way to tell a homeowner who
   designed their whole exterior and asked for quotes from somebody who typed a
   name to see what happened.

   Four decisions worth stating, because a score is the kind of number that
   gets believed.

   **It only counts things that happened.** Every factor below is read off the
   stored lead — a postcode we could parse, a render we issued, a consent we
   recorded. Nothing is inferred from what the browser claimed and nothing is
   modelled: there is no conversion data yet, so any weighting presented as
   predictive would be invented. These are weights on observable intent, and
   `basis` says so in the output.

   **It is not a person score.** It scores the completeness and the intent of a
   *project*. It never looks at a name, an email domain, a phone number's
   prefix, or anything else that could stand in for who somebody is — that
   would be profiling, and it would be profiling on a lawful basis nobody has
   agreed to. Postcode is used only for "did we get a usable one", never for
   what the area is like.

   **Timescale is capped, not zeroed.** "Just researching" still scores; it
   scores lower. A researcher in August is a job in October and the trade knows
   it, and a score of zero would route them to nobody at all.

   **The reasons travel with the number.** A bare 91/100 is unarguable, which
   is the problem — an installer who cannot see why cannot tell us the weights
   are wrong. Every factor returns what it awarded and why.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const routing = require('./routing');

/* The weights. They sum to 100 by construction, checked below, so a factor
   cannot be added without somebody deciding what it displaces. */
const WEIGHTS = {
  homeownerConfirmed: 12,
  postcodeUsable: 10,
  photoUploaded: 10,
  designCompleted: 12,
  estimateViewed: 6,
  renderCreated: 6,
  quoteRequested: 18,
  projectValue: 14,
  timescale: 12,
};

const TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
if (TOTAL !== 100) throw new Error(`lead score weights sum to ${TOTAL}, not 100`);

/* Timescale multipliers. The homeowner's own answer, from the quote steps. */
const TIMESCALE_FACTOR = {
  asap: 1,
  '1-3-months': 0.85,
  '3-6-months': 0.55,
  researching: 0.25,
};

/* Project value, in pounds inc VAT, against the fraction of the value weight
   it earns. Bands rather than a curve: the estimate itself is a range with
   ±15–20% on the measurement behind it, so a smooth function would imply a
   precision the input does not have.

   The bands are anchored on what the trade treats as a job size, not on our
   own averages, because we do not have enough completed jobs to have an
   average worth anchoring to. */
const VALUE_BANDS = [
  { from: 25000, factor: 1,    label: 'over £25,000' },
  { from: 15000, factor: 0.85, label: '£15,000–£25,000' },
  { from: 8000,  factor: 0.6,  label: '£8,000–£15,000' },
  { from: 3000,  factor: 0.4,  label: '£3,000–£8,000' },
  { from: 0,     factor: 0.2,  label: 'under £3,000' },
];

/* What the lead is worth, taken as the midpoint of everything we priced.

   The two figures are not addable at their extremes — the cladding total is a
   single number and the glazing is a range — but the midpoint of the range
   plus the total is a reasonable statement of "the size of this job", which is
   all the band lookup needs. It is never shown to a homeowner as a price. */
function projectValueOf(lead) {
  const cladding = Number(lead?.price) || 0;
  const low = Number(lead?.glazing?.range?.low) || 0;
  const high = Number(lead?.glazing?.range?.high) || 0;
  const glazing = low && high ? (low + high) / 2 : (Number(lead?.glazing?.price) || 0);
  const conservatory = Number(lead?.conservatory?.price) || 0;
  return Math.round(cladding + glazing + conservatory);
}

/* Which of the six trades this project touches, reusing the routing module's
   reading of it rather than a second opinion. Two implementations of "what did
   they ask for" is how the score and the routing come to disagree about the
   same lead, and the delivery log would show both. */
function scopeOf(lead) {
  try { return routing.tradesIn(lead) || []; } catch (_) { return []; }
}

function award(reasons, key, factor, why) {
  const max = WEIGHTS[key];
  const points = Math.round(max * Math.max(0, Math.min(1, factor)));
  reasons.push({ factor: key, points, of: max, why });
  return points;
}

/* score(lead) → { score, band, value, scope, reasons, basis }

   Deterministic: the same lead always scores the same, which matters when an
   installer queries a lead they were sent last week. */
function score(lead) {
  const reasons = [];
  let total = 0;

  const consent = lead?.consent || {};

  /* ── Is this their house to spend money on ──
     Asked in the quote steps. Absent is not false: leads captured before the
     question existed, or saved without asking for quotes, simply do not carry
     it, and treating that as "not a homeowner" would mark down every design
     saved for later. */
  total += award(reasons, 'homeownerConfirmed',
    lead?.property?.homeowner === true ? 1 : 0,
    lead?.property?.homeowner === true
      ? 'confirmed they own or are responsible for the property'
      : 'not confirmed as the homeowner');

  /* ── Can an installer reach the area ──
     The same parse the routing uses. An unparseable postcode is the single
     most expensive gap in a lead: it reduces the eligible installers to those
     claiming national coverage. */
  const parsed = routing.parsePostcode(lead?.postcode);
  total += award(reasons, 'postcodeUsable', parsed ? 1 : 0,
    parsed ? `postcode resolves to ${parsed.outward}` : 'no usable postcode');

  /* ── Did they show us the house ──
     detectionCount is the server's own count of elements it found, so this is
     "we read their house", not "the browser said it uploaded something". */
  const detections = Number(lead?.detectionCount) || 0;
  total += award(reasons, 'photoUploaded', detections > 0 ? 1 : 0,
    detections > 0 ? `photo analysed, ${detections} elements found` : 'no photo analysed');

  /* ── How much of a design is there ──
     Graded by how many trades they actually touched, because a project naming
     five trades is a different sale from one frame colour. Three or more is
     treated as a complete design. */
  const scope = scopeOf(lead);
  total += award(reasons, 'designCompleted', Math.min(1, scope.length / 3),
    scope.length ? `chose ${scope.length} trade${scope.length === 1 ? '' : 's'}: ${scope.join(', ')}` : 'no products chosen');

  /* ── Did they see a number ──
     Somebody who has seen a price and carried on is past the objection the
     price would have raised. Inferred from there being a priced estimate on
     the lead, which is what they were shown. */
  const sawEstimate = !!(Number(lead?.price) || lead?.glazing?.price);
  total += award(reasons, 'estimateViewed', sawEstimate ? 1 : 0,
    sawEstimate ? 'saw a costed estimate' : 'no estimate produced');

  /* ── Did they go as far as a render ──
     A capability URL we issued. The strongest engagement signal in the journey
     and the cheapest to verify. */
  total += award(reasons, 'renderCreated', lead?.renderUrl ? 1 : 0,
    lead?.renderUrl ? 'generated a visualisation of their own home' : 'no visualisation generated');

  /* ── Did they ask to be contacted ──
     The heaviest single factor, and correctly so: it is the only one where the
     homeowner has said out loud that they want a quote. It is also the consent
     that makes the lead deliverable at all. */
  total += award(reasons, 'quoteRequested', consent.installerQuotes === true ? 1 : 0,
    consent.installerQuotes === true ? 'asked for installer quotes' : 'did not ask to be contacted');

  /* ── How big is the job ── */
  const value = projectValueOf(lead);
  const band = VALUE_BANDS.find(b => value >= b.from) || VALUE_BANDS[VALUE_BANDS.length - 1];
  total += award(reasons, 'projectValue', value > 0 ? band.factor : 0,
    value > 0 ? `estimated project ${band.label}` : 'no project value');

  /* ── When ── */
  const when = String(lead?.project?.timing || '');
  const factor = TIMESCALE_FACTOR[when];
  total += award(reasons, 'timescale', factor === undefined ? 0.4 : factor,
    factor === undefined ? 'timescale not given' : `timescale: ${when.replace(/-/g, ' ')}`);

  const final = Math.max(0, Math.min(100, Math.round(total)));

  return {
    score: final,
    /* A word as well as a number, because the number invites false precision:
       87 and 84 are the same lead and the bands say so. */
    band: final >= 80 ? 'hot' : final >= 60 ? 'warm' : final >= 40 ? 'cool' : 'cold',
    value,
    valueBand: value > 0 ? band.label : null,
    scope,
    reasons,
    /* Stated in the payload so nobody downstream mistakes this for a
       conversion model. When there are enough completed jobs to fit one, this
       string is what has to change with it. */
    basis: 'weighted intent and completeness signals, not a fitted conversion model',
    version: 1,
  };
}

module.exports = { score, projectValueOf, WEIGHTS, VALUE_BANDS, TIMESCALE_FACTOR };
