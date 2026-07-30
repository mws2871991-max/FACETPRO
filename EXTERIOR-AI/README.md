# Facet Pro

UK home exterior visualiser. A homeowner uploads one photo of their house, the app
detects the exterior elements, they try cladding/roof/trim options, get an itemised
costed estimate, see a photorealistic render of their own home, and save the design
as a lead.

Independent of any other project on this machine (`homeai`, `delivery`,
`glazeai-REDUNDANT`, etc.) — no shared code, no shared data.

## What's real right now

- **Catalogue pricing** — real, server-computed prices from `catalogue.json`. Prices
  are currently **estimated placeholders** (no public cladding/roofing price list
  exists on facetpro.co.uk to pull real numbers from) — edit `catalogue.json` directly
  whenever you have real supplier/installer pricing.
- **Lead capture** — real. Submissions are saved to `data/leads.jsonl`, with the price
  always recomputed server-side (a tampered client request can't fake a quote).
- **AI detection** (Claude vision) and **AI render** (Replicate FLUX Kontext Pro) —
  real, working code, but require API keys (see below). Without keys, they return a
  clear error instead of crashing.
- **Email + CRM push on lead capture** — real, but optional. Without `RESEND_API_KEY`
  / `CRM_WEBHOOK_URL` set, leads are still saved, you just don't get notified.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and add your keys:
#   ANTHROPIC_API_KEY      — https://console.anthropic.com/settings/keys
#   REPLICATE_API_TOKEN    — https://replicate.com/account/api-tokens
#   RESEND_API_KEY         — https://resend.com/api-keys (optional)
#   CRM_WEBHOOK_URL        — optional, any webhook (Zapier/HubSpot/Make/etc.)
npm start
```

Open http://localhost:3020 (or whatever `PORT` you set).

## Files

- `server.js` — Express backend: `/api/detect`, `/api/render`, `/api/quote`,
  `/api/lead`, `/api/leads`, `/api/catalogue`.
- `store.js` — simple JSONL file storage (falls back to Postgres if `DATABASE_URL`
  is set — not required for local use).
- `catalogue.json` — cladding/trim/roof swatches + prices. Edit this to update
  pricing.
- `index.html` — the homeowner-facing site (plain JS, no build step, no framework).
  Marketing sections are static crawlable HTML; only the interactive steps are
  built in JS and mounted into the `#mount-*` slots.
- `robots.txt`, `sitemap.xml`, `assets/og-image.png` — SEO and social sharing.
- `data/` — where leads/detections get stored as JSONL files.

## SEO notes

- Canonical domain is hard-coded as `https://facetpro.co.uk` in `index.html`,
  `guided-demo.html`, `robots.txt` and `sitemap.xml`. Change all four if the domain
  differs.
- `index.html` carries Organization, WebSite, WebApplication and FAQPage structured
  data. Every claim in it matches what the product actually does — no invented
  ratings, review counts or testimonials. Keep it that way: fake `AggregateRating`
  is a manual-action risk with Google as well as being untrue.
- Add new pages to `sitemap.xml` as they're built.
