/* The consent wording, held by the server (launch review, 29 September).

   The lead used to store whatever wording and version the browser sent — a
   test lead went in as version "v" with the wording blank — so the stored
   record was only as good as the client that wrote it. Now the browser sends
   the version it showed, the server looks the words up here, and stores its
   own copy. An unknown version asking for installer quotes is refused.

   index.html's CONSENT_WORDING must match CURRENT word for word (it is what
   the homeowner reads); test/consent-versions.test.js checks it, and
   legal/CONSENT-VERSIONS.md keeps each version for anyone reading a record. */

'use strict';

const TERMS = 'I’ve read and agree to the Terms of Use and the Privacy Notice.';
const EMAIL_PACK = 'Email me my design pack — my visualisation and indicative estimate.';

const VERSIONS = {
  '2026-09-29': {
    emailPack: EMAIL_PACK,
    installerQuotes: 'Yes, I’d like quotes. Please pass my name, postcode, email address and phone number, together with my design and estimate, to up to three vetted installers covering my area, so they can contact me about quoting for this work and arranging a survey. I understand they may contact me by email, by telephone and by text message, including if my number is registered with the Telephone Preference Service, and that each installer is responsible for its own use of my details.',
    terms: TERMS,
  },
  '2026-09-30': {
    emailPack: EMAIL_PACK,
    installerQuotes: 'Yes, I’d like quotes. Please pass my name, postcode, email address and phone number, together with my design, my estimate and my answers about the project, to up to three vetted installers covering my area, so they can contact me about quoting for this work and arranging a survey. I understand they may contact me by email, by telephone and by text message, including if my number is registered with the Telephone Preference Service, and that each installer is responsible for its own use of my details.',
    terms: TERMS,
  },
};

const CURRENT = '2026-09-30';

/* The one before CURRENT stays accepted, so somebody whose page loaded just
   before a deploy is not turned away; their record carries the words they
   actually saw. */
const ACCEPTED = new Set(['2026-09-29', CURRENT]);

function wordingFor(version) {
  return ACCEPTED.has(version) ? VERSIONS[version] : null;
}

module.exports = { VERSIONS, CURRENT, ACCEPTED, wordingFor };
