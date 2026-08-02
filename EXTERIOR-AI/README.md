# Facet Pro

UK home exterior visualiser. A homeowner uploads one photo of their house, the app
detects the exterior elements, they try cladding/roof/trim options, get an itemised
costed estimate, see a photorealistic render of their own home, and save the design
as a lead.

Independent of any other project on this machine (`homeai`, `delivery`,
`glazeai-REDUNDANT`, etc.) — no shared code, no shared data.

## What's real right now

- **Catalogue pricing** — real. Server-computed from `catalogue.json`, using real UK
  material and labour rates and the same quote methodology as the production
  facetpro.co.uk backend: materials + labour per m², plus fixed scaffolding, a waste
  allowance and VAT. Not placeholders. See "Keeping prices current" below.
- **Lead capture** — real. Submissions are saved to `data/leads.jsonl`, with the price
  always recomputed server-side (a tampered client request can't fake a quote).
- **AI detection** (Claude vision) and **AI render** (Replicate FLUX Kontext Pro) —
  real, working code, but require API keys (see below). Without keys, they return a
  clear error instead of crashing.
- **Email + CRM push on lead capture** — real, but optional. Without `RESEND_API_KEY`
  / `CRM_WEBHOOK_URL` set, leads are still saved, you just don't get notified.

## Setup

> `.env.example` ships `LEAD_CAPTURE=off` and `SITE_MODE=beta`. Copy it and the
> site runs with the form replaced by an honest explanation rather than
> collecting anyone's details — deliberate, because copying a template and
> forgetting a line should not be how you start holding personal data. Turn
> capture on when the legal pages have no `[PLACEHOLDERS]` left in them, the
> ICO registration is done and `DATABASE_URL` is set. With `SITE_MODE=live`
> the server refuses to start until the first two of those are true.
>
> Database connections verify the server certificate. Managed providers use
> their own CA: give it in `DATABASE_CA_CERT` (the PEM inline) or
> `PGSSLROOTCERT` (a path). `NODE_ENV=production` in a real deployment.

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
  `/api/glazing`, `/api/measure`, `/api/whole-house`, `/api/coverage`,
  `/api/resume`, `/api/lead`, `/api/leads`, `/api/deliveries`,
  `/api/withdraw`, `/api/catalogue`, `/r/:id`.
- `measure.js` — wall area from a photograph, and `sniffImage`, which is what
  both paid endpoints use to check that an upload is actually an image before
  it reaches Anthropic or Replicate.
- `glazing.js` — per-unit window and door pricing. See below.
- `routing.js` — which installers a lead goes to: postcode areas, and the cap
  the consent wording promises.
- `withdrawal.js` — withdrawing consent, and who has to be told.
- `retention.js` — how long each kind of record lives, and what survives redaction.
- `resume.js` — carrying a design to another device by short code. Choices only.
- `delivery.js`, `emails.js` — sending leads to buyers, and to the homeowner.
- `scripts/check-lead-ids.js` — read-only scan for duplicate lead references,
  from before references had real entropy. Run it once before relying on the
  unique index.
- `store.js` — simple JSONL file storage. Uses Postgres instead if `DATABASE_URL`
  is set, which additionally requires `npm install pg` (not a dependency, since
  the file fallback covers local use); it now says so plainly rather than
  failing with a bare module-not-found.
- `scripts/set-domain.js` — rewrites the canonical domain across every file that
  hard-codes it. `npm run set-domain -- --check` reports the current value and
  fails if the files disagree.
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
| Bungalow | none, single storey | `2W + 2D` | 3.54 |
| Detached | none | `2W + 2D` | 3.84 |

Bungalows are a separate type because every other entry derives depth assuming
two storeys; applying that to a single-storey home halves its footprint and
badly understates the walls. Floor area 77 m² is EHS 2018-19, the 10 m frontage
is assumed as with the other types, and the calibration factor and coverage
centre are derived rather than from the survey table.

The wall's height in door-heights also gives a free read on storeys — roughly 3
for two storeys, 1.3 for a bungalow. When that disagrees with the type the
homeowner picked, the result says so, since the multiplier depends on it and
they're the one who can correct it.

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

**Status: the method is confirmed, the numbers are not.**

BRE's RdSAP manual — the UK's official domestic energy assessment method —
defines wall area as "the room height ... multiplied by the heat loss
perimeter" (the exposed wall perimeter), and for "a dwelling joined onto
another dwelling (semi-detached and terraced houses) the measurement is to the
midpoint of the party wall". Party walls excluded, exposed perimeter × height:
that is exactly the model above, and it independently confirms mid-terrace =
2.00. It says nothing about whether the frontage and depth figures used here
are right for your customers' housing stock.

No published source gives per-archetype wall areas, so the calibration is
*derived* — from plan geometry and published housing-stock averages — not
*measured*. To validate it properly, collect properties whose wall area you
know from a survey, copy `data/survey-samples.example.json` to
`data/survey-samples.json`, and run the above. (The real file is gitignored:
it will contain addresses.) Samples can be either a real `/api/detect` output plus the surveyed area
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

`npm test` runs 43 tests, offline and at no API cost — the Anthropic and
Replicate calls are stubbed:

- `test/measure.test.js` — the geometry, calibration and fallbacks.
- `test/api.test.js` — the detect → measure → quote chain end to end.
- `test/security.test.js` — installer auth (including wrong-length and
  prefix passwords), the static-file allowlist and path traversal, no-CORS,
  catalogue provenance stripping, both daily caps (asserting a capped request
  makes **no** upstream call), and lead capture: consent required, price
  recomputed server-side, lead stored even when the email fails.

Tests run serially (`--test-concurrency=1`) because the files share
`data/usage.json` and the daily-cap counter.

### Accuracy caveats

Read these before putting a number in front of a homeowner.

- **The priors are measured; the multipliers are not.** The prototype's
  calibration table (`Renderd-V4-11`, `~/Downloads`) labels itself *"avg from
  120 surveys"*, so the 50 / 85 / 130 m² figures for terrace, semi and
  detached are real. The front-to-total multipliers are still ours — the
  prototype only ever used the coverage method, so the door-reference path has
  no external validation at all.
- **The multipliers do stand up to a check against those surveys.** Dividing
  each surveyed wall area by its multiplier gives the front elevation it
  implies: terrace 25.0 m² vs 23.5 geometry (−6%), semi 27.9 vs 29.0 (+4%),
  detached 33.9 vs 38.4 (**+13%**). Detached is the outlier, most likely
  because the 9.0 m frontage assumed for it is too wide for that survey
  sample. Matching the survey would need ~3.39; set
  `WALL_FRONT_TO_TOTAL_DETACHED=3.39` if you'd rather follow the data than
  the geometry.
- **End-of-terrace is derived from measured data, not guessed.** It isn't in
  the 120-survey table, but the geometry ties it to one that is: an end of
  terrace is a mid-terrace with one more wall exposed, so
  `end = mid × (2 + D/W) / 2 = ×1.727`. Applied to the surveyed 50 m² that
  gives 86 m².
- **Bungalow's 60 m²** comes from the later `Renderd-v4` table, which lists
  m² only — its coverage centre is still ours.
- **The two methods now check each other.** Whenever a photo supports both,
  the door reading is compared against the independently calibrated coverage
  reading. Agreement within 20% keeps the tight range and `good` confidence;
  beyond that the result drops to `rough` and the range widens to at least
  cover what the other method said. Since the coverage method is what the 120
  surveys calibrated, agreement is the only external evidence the door path
  has. It's corroboration, not proof — both still read the same wall box, so
  a bad wall detection fools both at once.
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

## Windows and doors

Priced per unit, not per square metre — a window costs what its size and style
cost, and a door costs by the leaf. `glazing.js` does the geometry,
`catalogue.glazing` holds the money, the same split the wall pricing uses.

The measurement was already being computed and thrown away. `/api/detect`
returns a box for every window and for the front door; `measure.js` turns the
door box into a metres-per-pixel scale and works out each opening's area, then
discards it, because in that file an opening only exists as something to
subtract from the wall. Door height gives the scale, so window sizes do not
depend on how far back the photographer stood, and a window whose box sits
entirely above the top of the door is upstairs — which is what brings in the
access cost.

The count matters more than the geometry. Window count is discrete, so one
window missed on a five-window terrace is a 20% error no amount of precision
recovers. Hence the corrector in the panel: the homeowner's own count wins,
and it is the one number they know better than we ever will. Counts outside
1–30 are ignored rather than obeyed; a whole-house count that overflows 30 is
capped, and says so in `countNote` rather than presenting a boundary as a
measurement.

### The rates are not sourced yet

Every other rate in `catalogue.json` came from the production backend and says
so in `source`. The `glazing` block does not:

    "source": "Not sourced. Placeholder pending supplier rate card."

**That string is load-bearing.** `GLAZING_RATES_SOURCED` in `server.js` tests
it with a regex, and it drives all of it: the startup warning, `ratesSourced`
on every `/api/glazing` response, and the amber caveat under the price on the
page. Replace the rates and edit that line and every caveat turns off at once —
which is the design, and the reason to know what the line controls before
editing it.

Ask the installers who buy your leads for their rate card. They want good
leads, it costs them nothing to send one, and it makes your estimates agree
with what they will actually quote.

## Keeping prices current

`catalogue.json` holds real UK material and labour rates, not placeholders, so
the failure mode is staleness rather than obvious wrongness — quoting this
year's jobs on last year's prices looks entirely plausible and is silently
wrong. The server prints the catalogue version and age at startup, and warns
once the rates are more than 180 days old:

```
Catalogue v2, prices updated 2026-07-22 (9 days ago).
Catalogue prices were last updated 2025-01-10 (568 days ago). These are real
rates and they move — review catalogue.json and bump "updated".
```

When you revise pricing: edit the rates, then bump both `version` and
`updated` so the age check stays meaningful.

Note that "real rates" and "planning estimate" are not in conflict, and the
site says both. The rates are real; the *total* is still an estimate because
it can't know the condition of the walls and roof, access, or what a survey
will turn up. Nothing in the customer-facing copy needs to change now these
are confirmed real — it never claimed they were provisional.

## Beta mode

`SITE_MODE` defaults to `beta`, which shows a badge beside the wordmark, a
notice above the hero and a line in the footer — all explaining that the
figures are a starting point while the measurement is calibrated against real
properties. `GET /api/config` reports it and the page reveals the markup,
so one variable controls all three.

Set `SITE_MODE=live` to remove them. The default is deliberately the honest
one: forgetting to add a beta badge is worse than forgetting to remove one,
and if the page can't reach the server it assumes beta for the same reason.

## Retention and access logging

The privacy notice states retention periods as fact, so `retention.js` enforces
them — a policy nothing enforces is a statement of intent, and stating it as
fact is itself inaccurate.

| What | How long |
| --- | --- |
| Design and estimate, never shared | 6 months |
| Enquiry shared with installers | 24 months from last contact |
| Consent records and withdrawals | 6 years |
| Access logs | 12 months |

Past its period an enquiry is **redacted**, not deleted: name, email, phone and
postcode go, and the consent record stays until its own six years are up.
Deleting the evidence of what someone agreed to while the sharing it authorised
has already happened is the wrong way round — that record exists to answer a
later challenge. Only once everything is out of period is the row removed.

An undated record is never touched. Runs at startup and daily, and logs what it
did, because "we delete on schedule" needs evidence like any other claim.

`GET /api/leads` and `GET /api/deliveries` are the two endpoints exposing
personal data, and every successful read is logged: when, which endpoint, and a
truncated hash of the IP. Not the address itself — it isn't needed to
investigate a concern, and storing it would make the log a bigger liability
than the thing it protects. Refusals aren't access and aren't logged.

## Lead delivery

Each lead is POSTed to every recipient in `LEAD_RECIPIENTS`, concurrently,
with three attempts and a short backoff. Buyers pay per lead, so the record is
billing evidence rather than a log line:

- every attempt is recorded whether it succeeded or not
- one buyer being down cannot stop the others receiving the lead
- a 4xx other than 408/429 is not retried — it will not start working
- a hanging buyer times out at 10s rather than blocking
- `data/deliveries.jsonl` holds the per-lead outcome;
  `data/delivery-failures.jsonl` is the list to re-send by hand
- `GET /api/deliveries` (installer password) gives per-recipient totals

Recipient URLs must be **https** and never appear in a response or a log line —
they can carry auth tokens. A malformed `LEAD_RECIPIENTS` delivers to nobody
and says so loudly at startup, rather than quietly dropping every lead.

Delivery happens after the homeowner has been answered, so they never wait on
three third-party webhooks. The lead is stored first, so nothing is lost if the
process dies mid-delivery.

## Emails

Two emails, two audiences, and they must not be confused. Templates live in
`emails.js` as pure functions so their wording and escaping are tested
directly (`test/emails.test.js`).

### The homeowner's design pack

What the site had always implied but never sent. On saving a design the
homeowner gets their render, the finishes they chose, the itemised estimate,
the planning-estimate caveat stated plainly rather than buried, what happens
next, and how to withdraw consent.

| Variable | Effect |
| --- | --- |
| `DESIGN_PACK_EMAIL` | `off` disables it; anything else leaves it on |
| `SITE_URL` | base URL for the privacy/terms links inside the email |

It sends only when `RESEND_API_KEY` is set **and** `LEAD_FROM_EMAIL` is on a
verified domain. It is refused outright on Resend's test sender, which can
only deliver to your own account — sending customer mail through it would fail
for every real homeowner while looking configured. The startup log states
which mode you're in, in every configuration.

`GET /api/config` reports `designPackEmail`, and the lead form uses it to
decide whether to promise an email at all. With it off the copy says we'll
keep the design; with it on, that we'll email it. The confirmation message
likewise reports what actually happened, from `lead.designPack.sent`.

Render URLs and `SITE_URL` are validated before going into the markup, so a
`javascript:` or `data:` URL can't be embedded, and every interpolated field
is escaped.

### Lead notifications

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

- **Shared per host, not across hosts.** The counter is re-read from
  `data/usage.json` before each decision, so several workers on one machine
  share a single allowance rather than each getting a full one. It isn't
  atomic — two workers can read the same value and both spend it, so the cap
  can be exceeded by roughly the number of workers, which is a rounding error
  against a daily budget. Separate hosts don't share a filesystem and will each
  get their own allowance: use Redis or Postgres if you scale that way.
- **Quota is consumed on dispatch, not on success.** A provider error still
  counts, because the call may well have been billed.

Quota is checked after request validation, so a malformed request costs nothing.

## What is publicly served

Static file serving is deny-by-default. Only `index.html`, `robots.txt`,
`sitemap.xml`, `/assets/**` and `/legal/**` are reachable; the
request path is decoded and normalised before the check, so `/assets/../server.js`
is judged as `/server.js` and refused. Source, data, config and documentation
extensions (`.js`, `.json`, `.jsonl`, `.md`, `.yml`, `.lock`, keys, logs …) are
blocked even inside a public directory, and dotfiles are denied outright.

If you add a new public page or asset directory, add it to `PUBLIC_FILES` or
`PUBLIC_DIRS` in `server.js` — it will 404 until you do.

`guided-demo.html` is deliberately **not** served. It is an unmaintained fork
of the product UI: it asks for a real email address and posts it to
`/api/lead` with no consent object, and links to neither the privacy notice
nor the terms. It stays in the repo for the walkthrough copy.

The Render blueprint lives at the **repository root**, not in here — it
declares `rootDir: EXTERIOR-AI`, so a copy inside this folder would never be
found.

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

- Canonical domain: `npm run set-domain -- https://your-domain.co.uk` updates all
  seven files that reference it. `-- --check` verifies they agree.
- `index.html` carries Organization, WebSite, WebApplication and FAQPage structured
  data. Every claim in it matches what the product actually does — no invented
  ratings, review counts or testimonials. Keep it that way: fake `AggregateRating`
  is a manual-action risk with Google as well as being untrue.
- Add new pages to `sitemap.xml` as they're built.
