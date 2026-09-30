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
  /* Named installers (30 September, ICO). "Up to three vetted installers
     covering my area" is the shape of wording the ICO has fined lead
     generators for: consent to be contacted has to name who will contact
     you. {installers} is filled by the server with the names the homeowner
     was shown for their postcode (fillInstallers below) and stored filled
     in. "Vetted" is gone until the vetting can be shown. */
  '2026-10-01': {
    emailPack: EMAIL_PACK,
    installerQuotes: 'Yes, send my details to {installers} so they can quote for this project. They’ll receive my name, postcode, email address and phone number, with my design, estimate and answers. They may contact me by email, phone or text about this project only, even if my number is on the Telephone Preference Service. This doesn’t commit me to using any of them, and each is responsible for how it uses my details. I can withdraw at any time.',
    terms: TERMS,
  },
};

const CURRENT = '2026-10-01';

/* The one before CURRENT stays accepted, so somebody whose page loaded just
   before a deploy is not turned away; their record carries the words they
   actually saw. */
const ACCEPTED = new Set(['2026-09-30', CURRENT]);

function wordingFor(version) {
  return ACCEPTED.has(version) ? VERSIONS[version] : null;
}

/* Does this version name the installers? Versions before 2026-10-01 did
   not; on a deployment they can no longer send anyone's details. */
const namesInstallers = (version) => /\{installers\}/.test(VERSIONS[version]?.installerQuotes || '');

/* "A", "A and B", "A, B and C" — the same join the page uses. */
function joinNames(names) {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] || '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

function fillInstallers(wording, names) {
  return String(wording).replace('{installers}', joinNames(names));
}

module.exports = { VERSIONS, CURRENT, ACCEPTED, wordingFor, namesInstallers, joinNames, fillInstallers };
