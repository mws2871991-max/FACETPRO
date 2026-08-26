# FACET PRO - START HERE

The complete Home Exterior Journey build (Phases 1-5 done + gaps fixed).

## Quick Start
Run `npm install && npm start`, then open http://localhost:3000.
(3000 is the default; `PORT` overrides it. This said 3020 for a long time,
which is a dead port — the first instruction in the file named START HERE.)
`index.html` is the homeowner-facing site; it needs `server.js` running for
detection, pricing, renders and lead capture.

Features:
- Upload one photo, AI detects windows/doors/roof/cladding (Claude vision)
- Visualiser with Before/After slider, live colour swatches, itemised estimate
  (materials, labour, scaffolding, waste, VAT)
- Save framing: "Where should we send your design?" creates lead with full payload
- Installer: homeowner designs and their estimates, measurement_source flag, CRM push

## The demo page is gone

There was a `guided-demo.html` here, described in this file down to its chapter
timings. It was deleted, and the reasoning is in `server.js` around the
`PUBLIC_FILES` set: it was an unmaintained fork of the product UI that asked for
a real email address and posted it to `/api/lead` with no consent object,
derived a name by splitting the address on "@", and linked to neither the
privacy notice nor the terms. It is in the git history if the walkthrough copy
is ever wanted back.

## Deploy
This is a single Node service — `server.js` serves both the API and the site.
`npm install && npm start`, set the environment variables from `.env.example`,
and put it behind your host of choice.

There is no separate frontend or backend to build. Earlier versions of this
folder carried a Next.js/FastAPI scaffold and a docker-compose file for it;
none of it was ever implemented (no Dockerfiles existed, so `docker-compose up`
could not have worked) and it has been removed.

## Branding
Named FACET PRO (facetpro.co.uk). Was briefly renamed to EXTERIOR AI, now back to
FACET PRO. Display form is "Facet Pro"; monogram is FP. See the SEO notes in
README.md before changing the domain.
