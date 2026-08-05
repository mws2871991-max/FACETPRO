# Facet Pro — developer handover

Written 2026-08-04, corrected 2026-08-05 against the current commit. Every claim below was checked
against the running service rather than inferred from the code, because the
two previous handovers were both wrong in the same direction: they described
what somebody intended to do as though it had been done.

This file lives with the code so it can be corrected in the same commit as
whatever it describes. If you change something here, check it first — a
handover that is confidently wrong costs more than no handover at all.

---

## How to check anything in this file

```
cd EXTERIOR-AI
npm test                                    # JSONL backend only — see DEPLOY.md
                                            # for how to run it against Postgres,
                                            # which is the backend production uses
railway variables --service facetpro-visualiser --json   # names AND values — do not paste output anywhere
curl -sI https://facetpro-visualiser-production.up.railway.app/
```

---

## Deployment — read this before you push

**Pushing to `main` does NOT deploy.** Railway's GitHub connection is broken
and has been since the repository was renamed `facetpro` → `FACETPRO`.
Reconnecting it failed: the repo does not appear in Railway's list, because
Railway's GitHub App grant still refers to the old name.

Deploys are currently made from a working copy:

```
cd EXTERIOR-AI
railway up --service facetpro-visualiser
```

That uploads the directory (honouring `.gitignore`, so no `node_modules`, no
`.env`, no lead data) and builds on Railway. It takes about a minute.

**To fix it properly:** github.com/settings/installations → Railway →
Configure → give it access to `FACETPRO` → then Railway → service → Settings
→ Source → connect the repo, branch `main`, **root directory `EXTERIOR-AI`**.
Until somebody does that, anyone who pushes and walks away will believe they
have shipped something they have not. That mistake already cost a day and a
half once.

### The project has three services and only one of them serves anything

| Service | What it is |
|---|---|
| `facetpro-visualiser` | **The live site.** This is what you deploy to |
| `facetpro-backend` | Serves nothing. Holds a Replicate token, a Resend key and `DATABASE_URL` |
| `Postgres` | The database. Currently reachable only from `facetpro-backend` |

The project is *named* `facetpro-backend`, which is why earlier notes said the
site was served from a service of that name. It is not.

---

## What is actually configured on the live service

Checked 2026-08-04.

| Variable | State | Consequence |
|---|---|---|
| `REPLICATE_API_TOKEN` | **set** | Renders work. Verified with a real photograph |
| `ANTHROPIC_API_KEY` | **set** | The key authenticates. **The account has no credit**, so detection returns a 502 and the journey still stops at the first step. Top up at console.anthropic.com/settings/billing |
| `RESEND_API_KEY` | missing | No email at all |
| `LEAD_FROM_EMAIL` | missing | Needs a domain verified at resend.com |
| `LEAD_RECIPIENTS` | missing | `/api/coverage` reports `installers: 0` |
| `DATABASE_URL` | missing | See storage, below |
| `INSTALLER_PASSWORD` | missing | Installer routes 503 — fails closed, by design |
| `INVESTOR_PASSWORD` | **set** | Gates `/investors`. Unset means that page 404s, deliberately — see below |
| `LEAD_CAPTURE` | set (`off`) | Correct. Must stay off until the legal pages are finished |
| `SITE_MODE` | `beta` | Shows the calibration honesty badge. Keep until measurements are validated |

The Replicate token was copied from `facetpro-backend` and has **not been
rotated**, despite having sat in plaintext on the owner's Desktop. It works,
so nothing is broken — but it should be replaced before this is shown widely.

### Storage: there is no volume on the live service

The only volume in the project is `postgres-volume`, attached to Postgres.
`facetpro-visualiser` has none, and `FACETPRO_DATA_DIR` is unset, so the app
writes to `./data` inside the container. **Everything written there is lost on
every deploy and every restart.**

Today that costs little — lead capture is off, so no personal data is
involved. Two things it does cost:

- **Saved designs and resume codes** do not survive a restart.
- **`data/usage.json`**, the daily counter that bounds Anthropic and Replicate
  spend, resets. The cap is meant to survive restarts precisely so a crash
  loop cannot hand out a fresh allowance each time. With a live paid key on a
  public URL, that is the one worth caring about — set a billing limit at both
  providers as well.

Before lead capture is switched on you need **either** a persistent volume
mounted at the data directory **or** `DATABASE_URL` pointing at the Postgres
that already exists in this project. The app refuses to start with lead
capture on and neither in place, so you will get a hard failure rather than
silent data loss.

Run **one replica**. Detection records and the usage counter are in memory.

---

## What works, verified on the live host

- The site serves: `/`, `/privacy`, `/terms`, CSS, self-hosted fonts — all 200
- `/api/glazing` prices a house, including the market-spread comparison
- `/api/coverage` answers postcode queries (POST only; a GET correctly 404s)
- **Renders work.** A real photograph was rendered end to end and served back
  through the capability URL at `/r/:id` as a 391 KB JPEG

## What does not work

- **Detection and measurement.** The key is set and valid; the Anthropic
  account has no credit, so `/api/detect` returns a 502. This is the half that
  finds the windows and sizes the house, so the journey stops at the first
  step. One top-up fixes it.
- **Email, and therefore the paid path.** The startup log says it plainly:
  *"Installer quotes: UNAVAILABLE — no homeowner email, so no withdrawal link,
  so that consent is refused and the box is hidden. This is the paid path."*

---

## Two bugs worth knowing about, because of how they hid

**The render never worked.** `server.js` sent `Prefer: wait=90`. Replicate caps
that header at 60 and rejects anything higher with a 422 *before* looking at
the request. Every render this application ever attempted was refused. From
outside it read as `Render failed (422)` — which looks like a bad photograph,
not a header we control. 371 tests could not see it because none of them call
Replicate. Fixed in `cda90e4`; guarded by `test/replicate-wait.test.js`.

**The no-JS gallery fallback never ran.** `index.html` carried
`.no-js .work-before { clip-path: … }` and nothing ever put `no-js` on
`<html>`. A rule guarded by a class that does not exist is indistinguishable
from no rule at all. Fixed in `bfbea77`; guarded by `test/no-js.test.js`.

Both were invisible to the test suite and to anyone using the site normally.
Both were found by reading, not by running. Assume there are more.

**The investor page was served to anybody with the link.** `/investors`
describes a pre-revenue company and itemises what money would be spent on.
s.21 FSMA 2000 restricts communicating an inducement to invest, and the
exemptions need the reader to have certified themselves beforehand — which a
public URL cannot do. What stood in for access control was `Disallow:
/investors` in `robots.txt`, which keeps it out of search results and keeps
nobody out. It is now behind `INVESTOR_PASSWORD`, and the file moved from
`legal/` (a public static directory, so it was also served underneath the
route) to `gated/`. Guarded by `test/investors.test.js`. The FCA-prescribed
risk warning and the exemption being relied on are still placeholders for the
solicitor.

**The Postgres CI job had been red for days and nobody looked.** 131 of the
suite failed because server-based tests fetched before `start()` had built the
schema — so every endpoint that writes a lead was covered only against JSONL,
which is the backend that never runs in production. Fixed with an exported
readiness promise and `test/helpers/server-ready.js`. The last eight failures
after that were fixtures, not code: `ts: 'A'` against a `timestamptz` column,
and two tests reading `leads.jsonl` off the disk when the rows were in
Postgres.

Three bugs, one shape: a stated intention that nothing enforced. Assume there
are more.

---

## Pricing: what is real and what is not

| | Source |
|---|---|
| Cladding, roof, roofline, scaffolding, waste, VAT | Real rates from the production backend. **Never validated against a completed job** |
| Composite door £2,000 · bifold £4,000 (inc VAT) | Real settled prices, 24 years in the trade |
| **Window bands £504 / £708 / £1,032 / £1,416** | **Invented.** Uplifted 20% on judgement, on no stated VAT basis |

`catalogue.glazing.source` says so in the file, and the app labels every window
estimate as a guide. Do not present window figures as firm. When real band
prices arrive, take them **inclusive of VAT and divide by 1.2** — the catalogue
stores net and grosses up at the end. Entering inclusive figures as net is
exactly how the doors came to be shown 20% over; see
`notes/glazing-rates-from-the-trade.md`.

Wall measurement is unvalidated: `data/survey-samples.json` has 17 rows and
every `knownWallAreaM2` is `0`. `SITE_MODE=beta` exists to be honest about
this. Do not set it to `live` until `npm run validate` has real houses behind
it.

---

## Legal

`legal/privacy.html` and `legal/terms.html` contain **19 distinct placeholders
across 37 occurrences** — count them with the snippet below rather than
trusting any figure in a document, including this one:

```
grep -o 'class="ph"[^>]*>\[[^]]*\]' legal/*.html | wc -l
```

Earlier handovers said "~13/11". They were wrong. A solicitor brief exists and
the copies sent to the solicitor are byte-identical to these files.

Also outstanding: ICO registration (£52/year), and a decision on the
international-transfer mechanism — photos go to Anthropic and Replicate, both
US companies, which needs naming in the notice.

`LEAD_CAPTURE` stays `off` until all of that is signed off. The startup guard
enforces the storage half of it; nothing can enforce the ICO half but you.

---

## Repository

- The app is in **`EXTERIOR-AI/`**, not the repo root. Any host root-directory
  setting must be `EXTERIOR-AI`
- `render.yaml` stays at the repo root — it declares `rootDir: EXTERIOR-AI` and
  Render only looks for a blueprint at the root. `railway.json` lives inside
  `EXTERIOR-AI/`
- `main` and `store-renders` are currently identical. Treat `main` as the truth
- Node ≥20, Express 5. One `server.js` plus focused modules. Tailwind is a
  build step via `prestart`; the compiled CSS is committed
- `npm install && npm test && npm start`

## Housekeeping

- Railway project `valiant-acceptance` / "Home Vision AI" is an unrelated old
  Next.js experiment whose builds fail. Check it has no volume, then delete it
- The `window-vision` GitHub repo is empty and can go
- `facetpro.co.uk` is registered at IONOS and its DNS points at Vercel
  (`76.76.21.21`), serving an old site. Moving it here means adding the custom
  domain in Railway, repointing IONOS, verifying, then retiring the Vercel
  project
