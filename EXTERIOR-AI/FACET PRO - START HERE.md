# FACET PRO - START HERE

The complete Home Exterior Journey build (Phases 1-5 done + gaps fixed).

## Quick Start
Run `npm install && npm start`, then open http://localhost:3020.
`index.html` is the homeowner-facing site; it needs `server.js` running for
detection, pricing, renders and lead capture.

Features:
- Upload one photo, AI detects windows/doors/roof/cladding (Claude vision)
- Visualiser with Before/After slider, live colour swatches, itemised estimate
  (materials, labour, scaffolding, waste, VAT)
- Save framing: "Where should we send your design?" creates lead with full payload
- Installer: homeowner designs and their estimates, measurement_source flag, CRM push

## Demo Video (Option C)

- Chapters at 0s/12s/28s/45s/68s/82s, captions, voiceover speak, speed 1x/1.5x/2x, CC toggle
- Not linked from the site and marked noindex: it's a sales/demo tool, reachable
  by direct URL only

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
