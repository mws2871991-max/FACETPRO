/* What an installer is sent about a lead — and nothing else.

   The consent the homeowner gives names what goes: name, postcode, email
   address, phone number, their design, their estimate and their answers about
   the project. Until the launch review (29 September) installers were sent the
   whole stored record with only the withdrawal-token hash removed, which also
   carried the hashed IP, the full consent object including the email-pack and
   terms answers, free-text notes, email delivery status and our internal
   bookkeeping. None of that was in the wording, so none of it goes now.

   An allow-list rather than a deny-list, so a field added to the lead later is
   private until somebody decides otherwise here. Used for the webhook payload
   and for an installer's own view in the portal; the operator view is not
   filtered. */

'use strict';

const INSTALLER_FIELDS = [
  'id', 'ts',
  // Contact, as the wording lists it.
  'name', 'email', 'phone', 'postcode',
  // The design.
  'selections', 'preferences', 'glazing', 'conservatory', 'renderUrl',
  'measurementSource', 'wallMeasurement',
  // The estimate.
  'price', 'priceBreakdown', 'pricing',
  // The price promise caps for this job, when it is switched on (pricepromise.js).
  'pricePromise',
  // Their answers about the project, and the score worked out from them
  // (disclosed in the privacy notice, "AI, and decisions made about you").
  'project', 'property', 'leadScore',
];

function forInstaller(lead, { siteUrl } = {}) {
  if (!lead || typeof lead !== 'object') return lead;
  const out = {};
  for (const k of INSTALLER_FIELDS) if (lead[k] !== undefined) out[k] = lead[k];
  /* Developer brief, 6 Oct (§9): the installer should get the whole brief.
     Two things it was missing. The visualisation as a link that opens —
     renderUrl is a path on our own site, which means nothing in a webhook or
     an installer's inbox. And the quote-request status said plainly, rather
     than left to be inferred from a consent flag. Both are the same facts the
     lead already carries, in a usable form; nothing new is disclosed. */
  if (typeof lead.renderUrl === 'string' && lead.renderUrl.startsWith('/r/') && siteUrl) {
    out.renderLink = String(siteUrl).replace(/\/$/, '') + lead.renderUrl;
  }
  out.quoteRequest = {
    status: lead.consent?.installerQuotes === true ? 'requested' : 'not_requested',
    at: lead.consent?.at || null,
  };
  /* The installer's own evidence that the homeowner asked to be contacted:
     when, which wording, and that wording — nothing about the other boxes. */
  if (lead.consent) {
    out.consent = {
      at: lead.consent.at,
      version: lead.consent.version,
      installerQuotes: lead.consent.installerQuotes === true,
      wording: lead.consent.wording?.installerQuotes,
    };
  }
  return out;
}

module.exports = { forInstaller, INSTALLER_FIELDS };
