# Deploying Facet Pro

A single long-running Node process. `server.js` serves both the API and the
site — there is no separate frontend to build and no build step at all.

## The one thing that must not be got wrong

**This app keeps state on disk.** Under `data/`:

| File | What's lost without a persistent disk |
| --- | --- |
| `leads.jsonl` | every enquiry, written and then gone |
| `usage.json` | the daily cap resets constantly — nothing bounds your Anthropic and Replicate bill |
| `detections.jsonl` | detection log |
| `notification-failures.jsonl` | the record of leads whose email didn't send |

Detection records for "measure my walls" are held **in memory**, so more than
one replica also breaks that: the lookup goes to an instance that never saw
the photo and the homeowner is told it expired.

None of this errors. It silently doesn't work. So:

- **Mount a volume at `<app>/data`.**
- **Run one replica.** Scaling out needs the storage moved to Postgres and the
  detection records and usage counter moved to a shared store first.
- **Do not deploy to a serverless platform** (Vercel, Netlify Functions,
  Lambda) without doing that work.

`GET /healthz` checks exactly this — it returns 503 if `data/` isn't writable,
so a missing volume fails the health check rather than passing quietly.

## The build step

`assets/app.css` is compiled ahead of time. The site is **unstyled without it**.

    npm run build:css

`npm start` runs `scripts/prestart-css.js` first. Where Tailwind is installed
it rebuilds; where it is not — production, which installs with
`npm ci --omit=dev` — it checks the committed file is there and warns if
`index.html` is newer than it. It refuses to start only if the stylesheet is
missing altogether, because that means every page renders unstyled.

That is why the built file is **committed**. **If your platform calls
`node server.js` directly rather than `npm start`, put `npm run build:css` in
the build command** — or make sure the committed CSS is current.

Pinned to Tailwind 3 deliberately. This replaced the Play CDN, which served v3,
and v4 changes things this page uses — `border` with no colour, `outline-none`,
the shadow and space-y scales. Upgrading is its own job with its own visual diff.

One rule that has no error message: **class names must appear whole in the
source.** The scanner reads `index.html` as text, so

    `bg-white ${active ? 'text-white' : 'text-zinc-500'}`   is found
    `text-${colour}-500`                                    is not

and the second renders unstyled, silently.

## Root directory

The app lives in **`EXTERIOR-AI/`**, not the repository root. Set the service's
root directory to `EXTERIOR-AI` or nothing will build. This is the most common
way to get this deployment wrong.

## Railway

1. New project → Deploy from GitHub → `mws2871991-max/FACETPRO`.
2. **Settings → Root Directory → `EXTERIOR-AI`**.
3. **Settings → Volumes → New Volume**, mount path `/app/data`.
4. Add the variables below.
5. Deploy. `railway.json` sets the start command, the `/healthz` check and a
   single replica.

## Render

1. New → Blueprint, or New → Web Service from the repo.
2. Root directory `EXTERIOR-AI` (already set in `render.yaml`).
3. `render.yaml` declares a 1 GB disk at the right mount path. **A paid plan is
   required for a persistent disk** — the free tier has none, which is exactly
   the failure described above.
4. Add the secret variables (everything marked `sync: false`).

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `INSTALLER_PASSWORD` | **yes** | Without it `/api/leads` returns 503 and the installer area is unusable. `openssl rand -base64 24`. |
| `INSTALLER_TOKEN_SECRET` | with installer accounts | Signs the short-lived tokens `/api/installer/login` issues. Unset means one is generated at startup, which signs every installer out on each deploy — the right failure, because a predictable default would let anyone who read the source mint a token for any installer. `openssl rand -base64 32`. |
| `INVESTOR_PASSWORD` | to serve `/investors` | Gates the investor page, which describes a pre-revenue company and what money would be spent on. s.21 FSMA restricts inducements to invest to people who have certified themselves beforehand, which a public URL cannot do — so **unset means the page 404s**, deliberately, rather than serving open. Share the link as `/investors?k=<password>` or with an `Authorization: Bearer` header. `openssl rand -base64 24`. |
| `ANTHROPIC_API_KEY` | for detection | Without it uploads return a clear error. |
| `REPLICATE_API_TOKEN` | for renders | Without it renders return a clear error. |
| `RESEND_API_KEY` | for email | Without it leads are stored but nobody is notified. |
| `LEAD_NOTIFY_EMAIL` | for email | Where new leads go. **No fallback** — unset means the email is skipped, not sent to the customer. |
| `LEAD_FROM_EMAIL` | for email | Must be on a **domain verified at resend.com/domains**. On Resend's test sender nothing reaches real homeowners, and the design-pack email refuses to send at all. |
| `SITE_URL` | recommended | Absolute base for links inside emails. `https://www.facetpro.co.uk`. |
| `SITE_MODE` | no | Defaults to `beta`. Set `live` to drop the beta badge and notices. |
| `DAILY_DETECT_LIMIT` | no | Default 50. |
| `DETECT_RATE_LIMIT` | no | Detection requests per minute per IP. Default 10, which is right for a homeowner. Exists so the test suite can send one photograph fifteen times on purpose; leave it unset in production. |
| `INSTALLER_RATE_LIMIT` | no | Installer sign-in attempts per 15 minutes per IP. Default 20. Exists for the test suite; leave it unset in production. |

### The funnel

`GET /api/funnel` (installer password, `?days=30`) returns each stage of the
journey and what share of the previous step it kept — the table the conversion
plan asks for. `POST /api/funnel` records a stage and is what the page calls.

It counts stages, not people. A row is a day, a stage and a number: no session,
no visitor id, no IP, no user agent, no referrer. Two visitors who upload look
identical to one visitor uploading twice. That is deliberate — it answers "what
share of visitors upload" without being able to answer "did this person upload",
which is the question that would need consent, a processor agreement and a
transfer mechanism. Do not add a column that would change that.


> **Do not edit an image or a font in place.** Everything matching
> `.woff2 .jpg .jpeg .png .gif .webp .avif .svg .ico` is served
> `Cache-Control: public, max-age=31536000, immutable`, so a returning visitor
> will not re-fetch it for a year. Re-cropping `assets/work/hero-after.jpg`
> under the same name means people who have been here before keep seeing the
> old crop until 2027. Add a new file and point the markup at it, or put a
> content hash in the filename. `assets/app.css` and the HTML are deliberately
> excluded and revalidate on every request, because they *do* change under the
> same name on every deploy.

| `DAILY_RENDER_LIMIT` | no | Default 50. The only thing bounding render spend. |
| `PORT` | no | The host sets this. |
| `LEAD_CAPTURE` | no | Code defaults to `on`; `.env.example` ships `off`. With `off` the form is replaced by an honest explanation and nothing personal is read, parsed or stored. Turn it on when the legal pages have no `[PLACEHOLDERS]` left, the ICO registration is done and `DATABASE_URL` is set — under `SITE_MODE=live` the server refuses to start until the first two are true. |
| `DATABASE_URL` | **for live** | Postgres. Without it everything lands in JSONL on the container: unencrypted, and gone on the next deploy unless a volume is mounted, while the privacy notice promises encrypted and backed up. Requires `npm install pg`. |
| `DATABASE_CA_CERT` | with a database | The provider's CA certificate, PEM inline. Verification is **on** — this used to be `rejectUnauthorized: false`, which encrypts the connection carrying every homeowner's contact details without authenticating the far end. Without a CA we fall back to the system trust store, which may simply refuse. |
| `PGSSLMODE` | rarely | `disable` turns TLS off on the database connection — as does `?sslmode=disable` in `DATABASE_URL`, the usual spelling. For a Postgres with no TLS at all: a CI container, a local instance. Against a non-local host the server says loudly that every homeowner's contact details are crossing that link in clear, because they are. |
| `PGSSLROOTCERT` | alternative | A path to the same certificate, if that suits your platform better. |
| `DB_SCHEMA` | no | Default `facetpro_visualiser`. Never `public`: seven of these table names already exist in the FastAPI backend's database with entirely different columns. |
| `RAILWAY_ENVIRONMENT`, `RENDER`, `FLY_APP_NAME`, `DYNO`, `KUBERNETES_SERVICE_HOST` | set by the platform | Any of these, or `NODE_ENV=production`, tells the server it is deployed rather than on somebody's laptop. That is what decides whether an unfinished notice or a missing database is a warning or a refusal to start — not `SITE_MODE`, because what actually went wrong went wrong in `beta`. |
| `NODE_ENV` | **for live** | `production`. Express serves its default error page otherwise — stack traces, absolute paths, dependency versions. |
| `PRIVACY_EMAIL` | **for live** | Must match `[PRIVACY EMAIL]` in the privacy notice. Shown to anyone whose withdrawal link has expired. Falls back to `LEAD_NOTIFY_EMAIL`, then to `privacy@facetpro.co.uk`. |
| `LEAD_RECIPIENTS` | for revenue | JSON array of the installers who buy leads: `id`, `name`, https `url`, optional `headers`, `areas`, `trades` and `leadPrice`. No `areas` means national; no `trades` means all of them. `leadPrice` is what that buyer pays per lead, in pounds — it is written into the delivery record as billing evidence, so it must be what was agreed at the time. Absent means unpriced, which is recorded as such rather than as zero. **Carries auth tokens — set it in the platform dashboard, never in a file.** |
| `CRM_WEBHOOK_URL` | no | The old single-webhook setting. Still honoured when `LEAD_RECIPIENTS` is empty. |
| `MAX_INSTALLERS_PER_LEAD` | no | Default 3. Can lower the cap, never raise it — the consent wording on the form says "up to three", and that sentence is the limit. `0` stops sharing entirely without unconfiguring the buyers. |
| `DESIGN_PACK_EMAIL` | no | `off` stops the homeowner's design pack. It does **not** stop the withdrawal link: someone who asked for quotes still gets a confirmation carrying it. |
| `RENDER_SAFETY_TOLERANCE` | no | Default 2, Replicate's own default and their maximum for image-to-image. 0 is strictest, 6 most permissive. Members of the public upload photographs of their homes, which contain their children and their neighbours. |
| `FACETPRO_DATA_DIR` | tests only | Where the JSONL files go. The suite points it at a temp directory — without it `npm test` writes into the same directory a deployment mounts its volume on. |

## Before pointing a domain at it

1. **The legal pages are unreviewed templates.** `/privacy` and `/terms` still
   display a "Template — not yet live-ready" banner and 33 placeholder fields.
   UK GDPR and consumer law apply to a beta exactly as to a launch. Complete
   them and have them reviewed, then delete the banners.
2. **Rotate the API keys** that were found loose on the Desktop — Anthropic,
   Resend, Replicate, OpenAI — before any of them reach a deployment.
3. **`www.facetpro.co.uk` currently serves a different application** on Vercel.
   Confirm what happens to it before repointing DNS.
4. Run `npm run set-domain -- https://www.facetpro.co.uk` so the canonical
   tags, Open Graph URLs, `robots.txt` and `sitemap.xml` all agree with where
   the site actually lives.

## Running the tests against Postgres

`npm test` on its own exercises the JSONL backend. Postgres is the only
backend a deployment will ever use — `refuseToStartIfStorageContradictsThe-
Notice` requires `DATABASE_URL` — so the run that matters needs a database,
and **without one the Postgres tests skip, which in a green summary is
indistinguishable from passing.**

```bash
docker run -d --name facetpro-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=facetpro_test postgres:16

DATABASE_URL="postgres://postgres:test@localhost:5433/facetpro_test?sslmode=disable" npm test
```

Two things that will otherwise cost an afternoon:

- **`?sslmode=disable` is not optional for a local container.** Without it you
  get `The server does not support SSL connections` and dozens of failures
  that look like broken tests. `store.js` warns loudly about disabled TLS
  unless the host is local, which is the right behaviour — but nothing else
  tells you the flag exists.
- **`looksDisposable()` in `test/postgres.test.js` will refuse a database
  whose name does not contain `test`, or one that is not on localhost**, unless
  you set `FACETPRO_ALLOW_DESTRUCTIVE_DB_TESTS=yes`. That is deliberate:
  `replaceAll` truncates tables by design, and the obvious database to point
  this at is the Railway one that also holds the FastAPI tables. It is a guard,
  not a bug.

CI runs the suite both ways on every push — see `.github/workflows/test.yml`.
The Postgres job is the one that covers the code path production executes; if
it is red, the JSONL job being green means very little.

## Endpoints

| | |
| --- | --- |
| `/api/detect`, `/api/render` | The paid ones. Daily caps, per-IP limits, and the bytes are checked before either provider is called. |
| `/api/quote`, `/api/measure`, `/api/whole-house`, `/api/glazing` | Pricing. Client-supplied areas and counts are never trusted. |
| `/api/coverage` | "Do you have installers near me?" — a count, never names. |
| `/api/resume`, `/api/resume/:code` | Carrying a design to a phone. Choices only: no photograph, nothing identifying. |
| `/api/lead` | The only endpoint that stores personal data. Off entirely with `LEAD_CAPTURE=off`. |
| `/api/leads`, `/api/deliveries` | Installer area. Password, rate limit, access log, `no-store`. |
| `/withdraw`, `/api/withdraw` | Article 7(3). The GET only shows a page; the POST does the work, because mail scanners open every link in an email. |
| `/r/:id` | Stored renders. |
| `/healthz` | Deliberately outside the rate limiters — a platform health check must never be throttled. |

## After deploying, check these

```bash
BASE=https://your-deployment-url

curl -s $BASE/healthz                  # {"ok":true,...,"storageWritable":true}
curl -s -o /dev/null -w '%{http_code}' $BASE/            # 200
curl -s -o /dev/null -w '%{http_code}' $BASE/server.js   # 404 — source is not served
curl -s -o /dev/null -w '%{http_code}' $BASE/api/leads   # 401 — not 503, or the password is unset
curl -s $BASE/api/catalogue | grep -c trimRates          # 0 — the cost model is not public
```

Then submit a test lead through the site and confirm it survives a redeploy.
That is the check that actually proves the volume is mounted, and it's the one
worth doing before any real homeowner uses it.
