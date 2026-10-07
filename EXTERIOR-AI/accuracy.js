/* Facet estimate against what the installer actually quoted (developer
   brief, 6 Oct, §6): "Facet estimate → installer survey → installer quote →
   final contract price".

   The estimate is the one the installer saw on the enquiry — the same sum the
   portal shows (walls figure plus the windows' published range), so the two
   cannot disagree about what was promised. The quote and the contract price
   are what installers record in the portal (routes/installers.js).

   No public figure until there is a sample worth publishing. Below
   MIN_FOR_SHARE the shares are null and the report says how many it has: a
   percentage of four is a number nobody should repeat. */

'use strict';

const MIN_FOR_SHARE = 30;

function estimateOf(lead) {
  const walls = Number(lead?.price) || 0;
  const g = lead?.glazing ? (lead.glazing.marketRange || lead.glazing.range) : null;
  const low = Number(g?.low) || 0;
  const high = Number(g?.high) || 0;
  if (!walls && !low) return null;
  return { low: walls + low, high: walls + (high || low) };
}

function compare(est, amount) {
  if (!est || !Number.isFinite(amount)) return null;
  const mid = (est.low + est.high) / 2;
  return {
    within: amount >= est.low && amount <= est.high,
    side: amount < est.low ? 'below' : amount > est.high ? 'above' : 'inside',
    vsMidPct: mid ? Math.round(((amount - mid) / mid) * 1000) / 10 : null,
  };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function summarise(rows, key) {
  const got = rows.filter(r => r[key]);
  const n = got.length;
  const enough = n >= MIN_FOR_SHARE;
  const within = got.filter(r => r[key].within).length;
  const abs = got.map(r => Math.abs(r[key].vsMidPct)).filter(Number.isFinite);
  const share = (k) => (enough && abs.length ? Math.round((abs.filter(a => a <= k).length / abs.length) * 1000) / 10 : null);
  return {
    n,
    within,
    withinShare: enough ? Math.round((within / n) * 1000) / 10 : null,
    medianAbsPctFromMiddle: enough ? median(abs) : null,
    /* The rest of the brief's §6 list: the mean, and the share within 5, 10
       and 15 per cent of the middle of the range. */
    meanAbsPctFromMiddle: enough && abs.length ? Math.round((abs.reduce((a, b) => a + b, 0) / abs.length) * 10) / 10 : null,
    within5PctShare: share(5),
    within10PctShare: share(10),
    within15PctShare: share(15),
    note: enough ? null : `${n} recorded — shares are shown from ${MIN_FOR_SHARE}.`,
  };
}

const LEAD_OUTCOMES = ['quoted', 'won', 'lost'];

/* The latest quote and the latest won/lost per lead, from the append-only
   leadResponses rows. installerId narrows to one installer's records. */
function foldOutcomes(rows, installerId = null) {
  const out = {};
  for (const r of rows || []) {
    if (!r?.leadId || !LEAD_OUTCOMES.includes(r.action)) continue;
    if (installerId && r.installerId !== installerId) continue;
    const o = out[r.leadId] || (out[r.leadId] = {});
    if (r.action === 'quoted') o.quote = { amount: r.amount, surveyed: !!r.surveyed, at: r.ts, installerId: r.installerId };
    else o.result = { outcome: r.action, ...(r.amount ? { amount: r.amount } : {}), at: r.ts, installerId: r.installerId };
  }
  return out;
}

/* How a lead is grouped for the brief's segments (§6): the jobs asked for,
   the postcode area, the property type, and the size of the estimate. */
const SIZE_BANDS = [[5000, 'under £5k'], [15000, '£5k–£15k'], [30000, '£15k–£30k'], [Infinity, 'over £30k']];
function segmentsOf(lead, est) {
  const jobs = Array.isArray(lead?.project?.interests) && lead.project.interests.length
    ? [...new Set(lead.project.interests.map(String))].sort().join(' + ')
    : 'not stated';
  const region = (String(lead?.postcode || '').trim().toUpperCase().match(/^[A-Z]{1,2}/) || ['unknown'])[0];
  const property = String(lead?.property?.type || lead?.glazing?.houseType || 'unknown');
  const mid = est ? (est.low + est.high) / 2 : null;
  const size = mid === null ? 'unknown' : SIZE_BANDS.find(([max]) => mid < max)[1];
  return { jobs, region, property, size };
}

/* leads: stored lead records. outcomes: { leadId: { quote, result } } from
   the installer portal's records. */
function report(leads, outcomes) {
  const byId = new Map((leads || []).map(l => [l.id, l]));
  const rows = [];
  for (const [leadId, o] of Object.entries(outcomes || {})) {
    const lead = byId.get(leadId);
    const est = estimateOf(lead);
    rows.push({
      leadId,
      estimate: est,
      segments: segmentsOf(lead, est),
      quote: o.quote ? { amount: o.quote.amount, surveyed: o.quote.surveyed } : null,
      result: o.result ? { outcome: o.result.outcome, amount: o.result.amount ?? null } : null,
      quoteVsEstimate: o.quote ? compare(est, o.quote.amount) : null,
      contractVsEstimate: o.result?.outcome === 'won' ? compare(est, o.result.amount) : null,
    });
  }
  /* Each segment summarised the same way, and held to the same sample rule:
     a segment of four says how many it has and no percentages. */
  const segments = {};
  for (const dim of ['jobs', 'region', 'property', 'size']) {
    const groups = {};
    for (const row of rows) (groups[row.segments[dim]] ||= []).push(row);
    segments[dim] = Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, { quotes: summarise(rs, 'quoteVsEstimate'), contracts: summarise(rs, 'contractVsEstimate') }]));
  }
  return {
    minForShare: MIN_FOR_SHARE,
    quotes: summarise(rows, 'quoteVsEstimate'),
    contracts: summarise(rows, 'contractVsEstimate'),
    segments,
    rows,
  };
}

module.exports = { report, foldOutcomes, estimateOf, compare, segmentsOf, MIN_FOR_SHARE, LEAD_OUTCOMES };
