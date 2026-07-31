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

## Measure my walls (optional)

`POST /api/measure` estimates exterior wall area from a photo already analysed
by `/api/detect`, so the quote can be sized to the actual house instead of
`catalogue.json`'s default footprint. It is **optional and off the critical
path** — detect → visualise → price works exactly as before if it's ignored.

**No AI call.** It is geometry over the boxes `/api/detect` already returned,
which is why it does not consume the daily cap. If a segmentation model is
ever added here, it must go through `consumeDailyQuota` like detect and render.

Two methods, in `measure.js`:

1. **Door reference (primary).** A UK front door is ~1.98 m, so the door's
   height in frame gives metres-per-pixel, which scales the wall bounding box.
   Windows and doors are subtracted. Algebraically the image height cancels,
   leaving `area = aspect × 1.98² × (wallW% × wallH%) / doorH%²` — so it is
   independent of how far away the homeowner stood, which matters because
   framing varies wildly.
2. **Coverage (fallback, no door found).** Wall share of the frame × that
   house type's calibration factor, rejected if coverage falls outside the
   band expected for the type.

Both are then clamped against house-type priors (detached 130, semi 85,
terrace 50 m²) and fall back to the prior when out of band.

### Front-to-total multiplier

A photo shows one elevation; the quote needs whole-house wall area. The
multiplier between them is plan geometry, not a fudge factor:

```
total wall      = exposed perimeter × wall height
front elevation = frontage width    × wall height
```

Wall height cancels, so `frontToTotal = exposedPerimeter / frontageWidth` and
**no storey-height assumption is involved**. Exposed perimeter by type, with
W = frontage and D = depth:

| Type | Party walls | Exposed perimeter | Multiplier |
| --- | --- | --- | --- |
| Mid-terrace | both sides | `2W` | **2.00** (exact) |
| Semi-detached | one side | `2W + D` | 3.05 |
| End of terrace | one side | `2W + D` | 3.45 |
| Detached | none | `2W + 2D` | 3.84 |

D comes from floor area: `footprint = floorArea / storeys`, `D = footprint / W`.
Inputs are English Housing Survey 2018-19 mean floor areas (detached 149,
semi 97, terraced 88 m²) and typical UK plot frontages.

These replace earlier back-derived guesses of 1.7 / 2.4 / 3.2, **which were low
by 15–25%** — measured areas rose 18–27% as a result. Overridable per type with
`WALL_FRONT_TO_TOTAL_*`.

**End of terrace is a separate house type** because a mid-terrace has two party
walls and an end has one: 2.00 vs 3.45, a ~70% difference. Confusing the two is
a bigger error than anything else in this feature, which is why the UI asks.

### Validating the calibration

```bash
npm run validate            # data/survey-samples.json
npm run validate -- path/to/other.json
```

The calibration above is *derived* — from plan geometry and published
housing-stock averages — not *measured*. To validate it properly, collect
properties whose wall area you know from a survey, copy
`data/survey-samples.example.json` to `data/survey-samples.json`, and run the
above. Samples can be either a real `/api/detect` output plus the surveyed area
(tests the whole pipeline, detection quality included) or just
frontage/depth/storeys (tests the multiplier in isolation).

It reports per-property error, overall bias and spread, how often the true
figure fell inside the quoted range, and — most usefully — the multiplier each
property *implies* versus the one in use. A consistent gap there means the
multiplier is wrong rather than the photo.

### Calibration, per house type

From the prototype survey table, and env-overridable so you can fold in your
own surveyed properties without a code change:

| House type | `WALL_CALIBRATION_*` | `WALL_COVERAGE_*` | Implied m² (centre × factor) |
| --- | --- | --- | --- |
| Terraced | `TERRACE` 277 | `TERRACE` 0.18 | ≈ 50 |
| Semi-detached | `SEMI` 303 | `SEMI` 0.28 | ≈ 85 |
| Detached | `DETACHED` 342 | `DETACHED` 0.38 | ≈ 130 |

`WALL_COVERAGE_TOLERANCE` (default `0.04`) sets how far either side of the
centre still counts as well framed — a semi is accepted between 24% and 32%
coverage. Anything invalid is ignored with a warning, and the effective
figures are printed at startup with `*` marking env overrides:

```
Wall measurement (factor/coverage) — detached 342/0.38, semi 303/0.28, terrace 277/0.18
```

The table is internally consistent: each type's mid-band coverage times its
factor lands on that type's prior, which a test asserts.

### Which area sizes the quote

1. A figure the homeowner typed — their house, their number, and the Terms
   make the manual entry the override.
2. A measurement **this server** produced, looked up by `detectionId`.
3. The generic default footprint.

The client never sends an area. `/api/detect` keeps its own copy of the
detections keyed by an unguessable `detectionId` and the client passes only
that id back, for the same reason `computePrice` never trusts a client price —
otherwise a tampered request could invent a wall area and move the price. The
image aspect ratio is read from the uploaded bytes for the same reason.
Detection records are in-memory, 2-hour TTL, capped at 500; a restart just
means re-uploading before measuring.

`npm test` covers the geometry and the full detect → measure → quote chain
with the Anthropic call stubbed (19 tests, offline, no API cost).

### Accuracy caveats

Read these before putting a number in front of a homeowner.

- **⚠ The multipliers are derived, not measured.** They now come from plan
  geometry and published housing-stock averages rather than being guessed, and
  two independent routes agree closely for terrace (47 vs 50 m²) and semi
  (88 vs 85) — but **no real property has been measured against them**.
  Detached is the weakest: geometry implies ~147 m² where the prototype's
  prior says 130, a 13% disagreement that only survey data can settle.
  Use `npm run validate` once you have some.
- **Frontage assumptions carry the most weight.** Depth is derived from floor
  area ÷ frontage, so an atypical frontage propagates into the multiplier.
  Detached homes vary most and are least well served by an average.
- **Storeys are assumed to be 2.** Bungalows and three-storey townhouses have
  a different depth-to-frontage relationship and are not modelled. A bungalow
  will read as too small.
- **One photo shows one elevation.** Whole-house area is the front elevation
  × that multiplier. A property with an extension, an unusual footprint or a
  rear elevation unlike its front will be wrong, and nothing in the photo can
  reveal that.
- **It inherits every detection error.** A wall box that includes the
  neighbour's house, or a garage read as cladding, feeds straight through.
- **The door assumption fails on non-standard doors.** A tall Victorian or
  arched door is not 1.98 m, and there's no way to tell from the image.
- **Coverage is much weaker than the door method** — it assumes typical
  framing distance. That's why it's a fallback and shown as "rough".
- **Presentation is part of the accuracy.** It is a planning estimate, always
  shown as a range with a survey caveat. Do not surface the midpoint alone.

## Lead notifications

A saved lead is **always** written to `data/leads.jsonl` first, so an email
problem can never lose one. The email is then attempted and its outcome stored
on the lead as `notification: { attempted, sent, reason }`.

| Variable | Required for email | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | Without it, leads are stored and nothing is sent. |
| `LEAD_NOTIFY_EMAIL` | yes | Where new-lead emails go. **No fallback** — if unset the email is skipped and logged. |
| `LEAD_FROM_EMAIL` | no | Defaults to Resend's test sender, which only delivers to your own Resend account address. Verify a domain at resend.com/domains and set this to an address on it. |

`checkEmailConfig()` prints a warning at startup for each of these that would
stop delivery, so a misconfiguration is visible before the first lead arrives
rather than after.

If a send fails, the lead is appended to `data/notification-failures.jsonl`
with the reason, giving you a durable list to work through. That file is
written with `fs` directly rather than through `store.js`, so it still works
when the database is the thing that's broken.

Three bugs this replaced, each of which silently lost leads:

- The recipient fell back to the **homeowner's own address** when
  `LEAD_NOTIFY_EMAIL` was unset, so the internal "New lead" email — quote total
  included — went to the customer instead of to you.
- The Resend SDK resolves with `{ data: null, error }` on an API failure rather
  than throwing, so the `try/catch` around the send caught nothing and a
  rejected send was indistinguishable from a delivered one.
- Lead fields were interpolated into the email HTML unescaped.

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
