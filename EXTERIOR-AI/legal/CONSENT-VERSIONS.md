# Consent wording, every version

A lead stores the version tag and the exact wording it was shown (`consent.version`, `consent.wording`). This file keeps each version's installer wording side by side, so anyone checking a record can see what changed and when. Add a row whenever `CONSENT_VERSION` in `index.html` changes, and save a screenshot of the form next to it.

## 2026-10-01 (current)

Yes, send my details to {installers} so they can quote for this project. They'll receive my name, postcode, email address and phone number, with my design, estimate and answers. They may contact me by email, phone or text about this project only, even if my number is on the Telephone Preference Service. This doesn't commit me to using any of them, and each is responsible for how it uses my details. I can withdraw at any time.

Changed: the installers are named. {installers} is replaced with the names of the installers who cover the homeowner's postcode ("A", "A and B", "A, B and C"), shown before the box can be ticked, and the record stores the wording with the names filled in plus `consent.installerIds`. Delivery goes only to those ids. Reason: the ICO has fined lead generators for consent that says "selected partners" or similar instead of naming who will make contact. "Vetted" was dropped until the vetting can be shown. On a deployment, 2026-09-30 (which named nobody) can still save a design but can no longer send details to installers.

## 2026-09-30

Yes, I'd like quotes. Please pass my name, postcode, email address and phone number, together with my design, my estimate and my answers about the project, to up to three vetted installers covering my area, so they can contact me about quoting for this work and arranging a survey. I understand they may contact me by email, by telephone and by text message, including if my number is registered with the Telephone Preference Service, and that each installer is responsible for its own use of my details.

Changed: added "my answers about the project", because the quote-step answers (and the readiness score worked out from them) go to installers with the enquiry. From this version the server holds the wording (consent.js) and stores its own copy; the browser's copy is not stored.

## 2026-09-29

Yes, I'd like quotes. Please pass my name, postcode, email address and phone number, together with my design and estimate, to up to three vetted installers covering my area, so they can contact me about quoting for this work and arranging a survey. I understand they may contact me by email, by telephone and by text message, including if my number is registered with the Telephone Preference Service, and that each installer is responsible for its own use of my details.

Changed: added "and by text message". Also from this date the form says, under the box: "How we're paid: installers pay us when we pass on an enquiry. You pay nothing, it doesn't change your estimate, and no installer can pay to be recommended."

## 2026-08-01

Yes, I'd like quotes. Please pass my name, postcode, email address and phone number, together with my design and estimate, to up to three vetted installers covering my area, so they can contact me about quoting for this work and arranging a survey. I understand they may contact me by email and by telephone, including if my number is registered with the Telephone Preference Service, and that each installer is responsible for its own use of my details.

The email-pack and terms boxes are unchanged across both versions.
