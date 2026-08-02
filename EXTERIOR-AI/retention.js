/* ─────────────────────────────────────────────────────────────────────────
   Retention.

   The privacy notice states specific periods. A retention policy that nothing
   enforces is a statement of intent, and stating it as fact in a notice is
   itself inaccurate — so this is the code that makes those rows true.

   From the notice:

     design, visualisation and estimate (no installer share)  6 months
     enquiry passed to installers        24 months from last contact
     consent records and withdrawals                          6 years
     complaints and requests                                  6 years
     technical and security logs                              12 months

   Two things worth being careful about, both reflected below:

   - A lead that was shared with installers keeps its consent record for six
     years even after the enquiry itself is deleted at twenty-four months.
     Deleting the evidence of what someone agreed to, while the sharing has
     already happened, is the wrong way round — the record exists precisely to
     answer a later challenge.
   - Deletion is logged, because "we delete on schedule" is a claim that needs
     evidence as much as any other.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const DAY = 86400000;

const PERIODS = {
  designOnlyDays: 183,        // ~6 months, never shared with anyone
  sharedEnquiryDays: 730,     // 24 months from last contact
  consentRecordDays: 2191,    // 6 years
  accessLogDays: 365,         // 12 months
};

const age = (iso, now) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? now - t : null;
};

/* What should happen to one lead today.

   Returns 'keep', 'redact' or 'delete':

     redact  the enquiry is past its period but the consent record is not, so
             strip the personal data and keep the proof of what was agreed
     delete  everything is past its period
*/
function classifyLead(lead, now = Date.now(), periods = PERIODS) {
  const ts = lead?.lastContactAt || lead?.ts;
  const a = age(ts, now);
  if (a === null) return 'keep';                    // undated: never guess, leave it

  /* Already redacted — by a previous run, or by someone withdrawing. There is
     nothing personal left to strip, so it is kept until the consent record
     itself expires and then goes entirely. Without this it would be redacted
     again on every run, refreshing redactedAt each time and making the record
     look newer than the erasure it documents. */
  if (lead?.redacted === true) {
    const consentAge = age(lead?.consent?.at || ts, now);
    return (consentAge !== null && consentAge < periods.consentRecordDays * DAY) ? 'keep' : 'delete';
  }

  const shared = lead?.consent?.installerQuotes === true;
  const enquiryLimit = (shared ? periods.sharedEnquiryDays : periods.designOnlyDays) * DAY;
  if (a < enquiryLimit) return 'keep';

  // Past the enquiry period. Is the consent record still within its own?
  const consentAge = age(lead?.consent?.at || ts, now);
  if (consentAge !== null && consentAge < periods.consentRecordDays * DAY) return 'redact';
  return 'delete';
}

/* Strip everything identifying, keep what evidences the agreement. */
function redactLead(lead) {
  return {
    id: lead.id,
    ts: lead.ts,
    redactedAt: new Date().toISOString(),
    redacted: true,
    // Kept: what they agreed to, when, and which version — the whole point.
    consent: lead.consent,
    /* Kept for the same reason and the same six years: if they withdrew, that
       is as much a part of the record as the agreeing was, and it is the half
       more likely to be asked about later. */
    ...(lead.withdrawals ? { withdrawals: lead.withdrawals } : {}),
    ...(lead.withdrawnAt ? { withdrawnAt: lead.withdrawnAt } : {}),
    // Kept: non-identifying facts useful for reporting.
    price: lead.price ?? null,
    houseType: lead.wallMeasurement?.houseType ?? null,
    measurementSource: lead.measurementSource ?? null,
  };
}

const isExpired = (row, days, now = Date.now()) => {
  const a = age(row?.ts, now);
  return a !== null && a >= days * DAY;
};

/* Plan the run without performing it, so it can be inspected and tested. */
function plan(leads, accessLog, now = Date.now(), periods = PERIODS) {
  const decisions = leads.map(l => ({ lead: l, action: classifyLead(l, now, periods) }));
  return {
    keep: decisions.filter(d => d.action === 'keep').length,
    redact: decisions.filter(d => d.action === 'redact').map(d => d.lead),
    delete: decisions.filter(d => d.action === 'delete').map(d => d.lead),
    accessLogExpired: (accessLog || []).filter(r => isExpired(r, periods.accessLogDays, now)).length,
  };
}

module.exports = { PERIODS, classifyLead, redactLead, isExpired, plan, DAY };
