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
#   INSTALLER_PASSWORD     — required for the installer area (openssl rand -base64 24)
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
- `legal/privacy.html`, `legal/terms.html` — served at `/privacy` and `/terms`.
- `robots.txt`, `sitemap.xml`, `assets/og-image.png` — SEO and social sharing.
- `data/` — where leads/detections get stored as JSONL files (gitignored: personal data).

## Spend caps on the paid endpoints

`/api/detect` and `/api/render` call Anthropic and Replicate, so they cost money
per request. The per-IP rate limiters don't bound that — enough distinct IPs can
still run up unlimited spend — so there is a **global daily cap** counted per UTC
day across all callers.

| Variable | Default | Endpoint |
| --- | --- | --- |
| `DAILY_DETECT_LIMIT` | 50 | `/api/detect` (Anthropic) |
| `DAILY_RENDER_LIMIT` | 50 | `/api/render` (Replicate) |

Once a cap is reached the endpoint returns `429 {"error":"Daily limit reached —
try again tomorrow."}` **without contacting the provider**, along with
`Retry-After` (seconds to UTC midnight) and `X-Daily-Limit` / `X-Daily-Remaining`
headers. Set a limit to `0` to switch that endpoint off. An unparseable value
logs a warning and falls back to the default. The limits in force are printed at
startup.

The counter lives in `data/usage.json` so a restart doesn't hand out a fresh
allowance. Two caveats worth knowing:

- **Per process.** A multi-instance deployment gets one allowance each — move the
  counter to a shared store (Redis, Postgres) if you scale out.
- **Quota is consumed on dispatch, not on success.** A provider error still
  counts, because the call may well have been billed.

Quota is checked after request validation, so a malformed request costs nothing.

## What is publicly served

Static file serving is deny-by-default. Only `index.html`, `guided-demo.html`,
`robots.txt`, `sitemap.xml`, `/assets/**` and `/legal/**` are reachable; the
request path is decoded and normalised before the check, so `/assets/../server.js`
is judged as `/server.js` and refused. Source, data, config and documentation
extensions (`.js`, `.json`, `.jsonl`, `.md`, `.yml`, `.lock`, keys, logs …) are
blocked even inside a public directory, and dotfiles are denied outright.

If you add a new public page or asset directory, add it to `PUBLIC_FILES` or
`PUBLIC_DIRS` in `server.js` — it will 404 until you do.

No CORS headers are sent. The front end is same-origin, so it never needed them.

## Installer access

`GET /api/leads` returns homeowner names, emails, phone numbers and postcodes, so
it requires `INSTALLER_PASSWORD`. Send it as `Authorization: Bearer <password>` or
`x-installer-password`. The check is constant-time (both sides SHA-256'd first, so
neither the comparison nor its timing leaks the password or its length), rate
limited to 20 attempts per 15 minutes, and **fails closed** — with no
`INSTALLER_PASSWORD` set the endpoint returns 503 and serves nothing.

The front end prompts for the password in the "Are you an installer?" panel and
keeps it in `sessionStorage` for that browser tab only.

This is a single shared password, which is fine for one installer or a small
trusted group. Per-installer accounts, audit logging and lead-level access
control are the obvious next step if that changes.

## Legal pages

`legal/privacy.html` and `legal/terms.html` are **UK GDPR / consumer-law templates
with placeholder fields**, not finished documents. Every highlighted
`[BRACKETED FIELD]` needs replacing, both pages carry a visible amber "not yet
live-ready" banner to delete once complete, and both should be reviewed by a
solicitor or data-protection adviser before launch.

The lead form has a required consent tickbox linking to both. The exact wording
agreed to is stored with the lead (`consent.wording`, `consent.version`,
`consent.at`) so there is a record of what was consented to and when — bump
`CONSENT_VERSION` in `index.html` whenever the wording changes. The server rejects
any lead submitted without consent.

## SEO notes

- Canonical domain is hard-coded as `https://facetpro.co.uk` in `index.html`,
  `guided-demo.html`, `robots.txt` and `sitemap.xml`. Change all four if the domain
  differs.
- `index.html` carries Organization, WebSite, WebApplication and FAQPage structured
  data. Every claim in it matches what the product actually does — no invented
  ratings, review counts or testimonials. Keep it that way: fake `AggregateRating`
  is a manual-action risk with Google as well as being untrue.
- Add new pages to `sitemap.xml` as they're built.
