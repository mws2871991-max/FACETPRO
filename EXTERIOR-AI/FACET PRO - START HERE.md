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
- `guided-demo.html` — upload your screen recording MP4
- Chapters at 0s/12s/28s/45s/68s/82s, captions, voiceover speak, speed 1x/1.5x/2x, CC toggle

## Full Stack Deploy
- See frontend/README.md and backend/README.md
- docker-compose up

## Branding
Named FACET PRO (facetpro.co.uk). Was briefly renamed to EXTERIOR AI, now back to
FACET PRO. Display form is "Facet Pro"; monogram is FP. See the SEO notes in
README.md before changing the domain.
