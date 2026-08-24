# Facet Pro — developer handover

Written 2026-08-04, corrected 2026-08-05 and again 2026-08-06 against the current commit. Every claim below was checked
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
curl -sI https://www.facetpro.co.uk/                      # the live site
curl -s  https://www.facetpro.co.uk/healthz               # storageWritable, mode
curl -s -H "Authorization: Bearer $INSTALLER_PASSWORD" \
        https://www.facetpro.co.uk/api/ops                # 503 = password unset
```

---

## Deployment — read this before you push

**Pushing to `main` deploys only once `RAILWAY_TOKEN` is set.**
Railway's own GitHub connection has been broken since the repository was
renamed `facetpro` → `FACETPRO`; reconnecting failed because Railway's GitHub
App grant still refers to the old name.

`.github/workflows/deploy.yml` routes around it: on a push to `main` it runs
the suite and then deploys with the Railway CLI, which needs nothing from the
GitHub App. **It needs one secret to work.** Until `RAILWAY_TOKEN` exists the
job builds, tests, and prints a warning saying nothing was deployed — see the
setup note at the top of that file.

Deploys can still be made by hand from a working copy:

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

### The project has two resources and only one of them serves anything

| Service | What it is |
|---|---|
| `facetpro-visualiser` | **The live site.** This is what you deploy to |
| `Postgres` | The database. Ours are the 12 tables in the `facetpro_visualiser` schema; `public` is now empty |

The project is still *named* `facetpro-backend`, after a service that no longer
exists, which is why older notes confuse the two. The name is cosmetic.

**The first Facet Pro was removed on 7 August 2026.** There were two complete
products: this one, and a FastAPI backend behind a Vercel front end on
`www.facetpro.co.uk`, sharing this project's Postgres. The `facetpro-backend`
service is deleted and its 17 tables have been dropped from `public` — which is
what `test/postgres.test.js` used to be warning about when it mentioned "the
FastAPI backend's tables", and why seven table names collided.

Before it went: a full export of all 145 rows across 17 tables, with the column
definitions so the schema is recoverable too, saved to
`~/Desktop/facetpro-old-system-backup-20260807.json`. The drop refused to run
until it had checked that every live row was accounted for in that file. Of the
six homeowner records, five were `example.com` fixtures and the sixth was the
founder's own Gmail address from a test on 26 July — no third party's data was
in it. What the schema knew that this product does not is in
`notes/from-the-first-facetpro.md`.

**Two things it left behind.** `www.facetpro.co.uk` still resolves to the
Vercel front end, which now has no backend to call — the DNS needs moving to
this service, and the custom domain must be added from the Railway dashboard
because the CLI refuses that one mutation on this plan. And the deleted service
held its own `OPENAI_API_KEY`, `REPLICATE_API_TOKEN` and `RESEND_API_KEY`:
deleting a service does not revoke a key, so those are still live at the
providers until somebody revokes them.

---

## What is actually configured on the live service

Checked 2026-08-04, again on 2026-08-06, and again on 2026-08-24 against the
live service. Five rows moved on the last check; the dates below say which.

| Variable | State | Consequence |
|---|---|---|
| `REPLICATE_API_TOKEN` | **set** | Renders work. Verified with a real photograph |
| `ANTHROPIC_API_KEY` | **set** | Works. The no-credit problem recorded here was fixed on 7 August; re-verified 24 August with a live call, and detection returns sixteen correctly-labelled elements on a real photograph. This row said "the account has no credit" for seventeen days after it stopped being true, while the section below already recorded the fix — a contradiction inside one document, which is worse than either version alone |
| `RESEND_API_KEY` | missing | No email at all |
| `LEAD_FROM_EMAIL` | missing | Needs a domain verified at resend.com |
| `LEAD_RECIPIENTS` | missing | `/api/coverage` reports `installers: 0` |
| `DATABASE_URL` | **set** (24 Aug) | Postgres, in this project. Storage is no longer the ephemeral container filesystem — see storage, below |
| `INSTALLER_PASSWORD` | **set** (19 Aug) | The shared operator credential for the read-only ops endpoints — `/api/ops`, `/api/funnel`, `/api/deliveries`, `/api/measurements`. It was unset on the deployment, so all four returned 503 in production and nothing said so: `/api/leads` uses a different guard and answers 401 either way, which is exactly what the old post-deploy check told you to look for. See `DEPLOY.md` |
| `INVESTOR_PASSWORD` | **set** | Gates `/investors`. Unset means that page 404s, deliberately — see below |
| `INSTALLER_TOKEN_SECRET` | **set** (24 Aug) | Signs installer sign-in tokens. Unset would mean one is generated at boot, signing every installer out on each deploy |
| `LEAD_CAPTURE` | set (`off`) | Correct. Must stay off until the legal pages are finished |
| `SITE_MODE` | `beta` | Shows the calibration honesty badge. Keep until measurements are validated |

The Replicate token was copied from `facetpro-backend` and has **not been
rotated**, despite having sat in plaintext on the owner's Desktop. It works,
so nothing is broken — but it should be replaced before this is shown widely.

### Storage: Postgres, as of 24 August

**This section used to say there was no volume on the live service and that
everything written to `./data` was lost on every deploy. That is no longer
true** — `DATABASE_URL` is set, `/healthz` reports `"storageWritable": true`,
and `/api/ops` reports `"storage": "postgres"`. `facetpro-visualiser` still has
no volume of its own; it no longer needs one, because the rows are in Postgres
rather than on the container filesystem.

The old warning left one casualty worth knowing about. The 391 KB render this
document records as proof that renders work was written to `./data` before the
database was connected, and is gone. The renders table holds one row today —
505 KB, 10 August — which is the oldest surviving render, not the first one
ever made.

`data/usage.json`, the daily counter bounding Anthropic and Replicate spend,
is still a file: the cap is meant to survive restarts precisely so a crash loop
cannot hand out a fresh allowance each time. With a live paid key on a public
URL, set a billing limit at both providers as well rather than relying on it.

The startup guard still applies and is still the right one: the app refuses to
start with lead capture on and no `DATABASE_URL`, so you get a hard failure
rather than silent data loss.

Run **one replica**. Detection records and the usage counter are in memory.

---

## What works, verified on the live host

- The site serves: `/`, `/privacy`, `/terms`, CSS, self-hosted fonts — all 200
- `/api/glazing` prices a house, including the market-spread comparison
- `/api/coverage` answers postcode queries (POST only; a GET correctly 404s)
- **Renders work.** A real photograph was rendered end to end and served back
  through the capability URL at `/r/:id`. That first render was a 391 KB JPEG
  and no longer exists — see storage above. Renders are now requested as PNG:
  the client already re-encodes the photograph once before upload, and asking
  for JPEG back put a second lossy pass on the one image the product exists to
  show. Expect a few MB each rather than ~500 KB

## What does not work

- ~~**Detection and measurement.** The Anthropic account has no credit.~~
  **Fixed 7 August** — the account was topped up and detection has been run
  against the live host many times since.
- **Email, and therefore the paid path.** The startup log says it plainly:
  *"Installer quotes: UNAVAILABLE — no homeowner email, so no withdrawal link,
  so that consent is refused and the box is hidden. This is the paid path."*

---

## The measurement has never been checked against a real house

`npm run validate` exists, works, and has never had anything to work on:

```
Skipping "Detached 4": knownWallAreaM2 is missing or not a positive number.
No usable samples.
```

All sixteen rows in `data/survey-samples.example.json` are empty templates. So
the door-reference photogrammetry — 1.98 m, the number the whole measured path
turns on — has never been compared against a property whose wall area somebody
actually surveyed.

Two things make this sharper than it sounds.

**The measured path has not run on a real house either.** Every real photograph
put through the live service so far has had no front door in shot, so it
exercised the *counted* path instead. The measured path is covered by
synthetic fixtures built from metres, which prove the arithmetic is
self-consistent and prove nothing about a real elevation.

**The page positions us against exactly this failure.** It says a competitor
*"produces confident figures that are wrong, and finds out at survey."* Nobody
has checked whether ours survive a survey.

What is *not* wrong: no accuracy figure is claimed anywhere in the copy. The
headline describes what the product does — measure, visualise, price — and the
estimate panel says which method produced the number and calls itself an
estimate throughout. There is no false claim to withdraw. There is an unproven
one to prove.

**To close it**, `scripts/validate-measurements.js` wants per property: house
type, frontage, depth, storeys, wall height, and the surveyed `knownWallAreaM2`
— optionally with the `detections` array from `/api/detect` and the photo's
aspect ratio, which exercises detection quality as well as the geometry. Six
properties is enough to state an honest error range. Twenty-four years of
selling this work is likely to have produced them already.

Until then `SITE_MODE` stays `beta`, which is what that setting is for.

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

## Added 6 August

**Installer accounts.** `installers.js`. One account per installer, as a
`passwordHash` on the `LEAD_RECIPIENTS` entry — scrypt, per-installer salt.
`POST /api/installer/login` exchanges a name and password for a token good
for four hours and for one installer, and the browser stores that rather than
the password. `/api/leads` shows a signed-in installer only the leads the
delivery log says they actually received; the shared `INSTALLER_PASSWORD`
still works and is scoped `all` rather than pretending to be somebody.
`npm run installer-password -- "the password"` makes a hash.

Verification evidence is stored with them — company number, insurance provider
and expiry, trade body, parent company. That is the answer to the placeholder
in `legal/terms.html` asking what "vetted" means.

**Observability.** `observability.js` and `GET /api/ops`, behind the
installer password. A bounded ring of recent failures, counts by kind, today's
spend against the caps. Six of its nine tests are about scrubbing personal
data out of error messages rather than about recording them. In memory only,
and it says so in its own output, because the live service has no volume.

**Backups.** `scripts/backup-and-verify.js` exports every table, restores it
into a scratch schema and compares by checksum. The privacy notice promises
"we test that we can restore them" and nobody ever had. The first run failed:
every timestamp shifted by the machine's UTC offset and microseconds were
truncated, because a JavaScript `Date` carries neither. Row counts matched
perfectly throughout. Fixed by round-tripping raw text.

**A second Facet Pro.** `facetpro-backend` was not dead weight — it was the
older product's live API. It was removed on 7 August; see the services table
above. `notes/from-the-first-facetpro.md` records what its schema knew, which
is now the only trace of it besides the backup.

---

## The apex domain, and a mistake worth not repeating

`www.facetpro.co.uk` is live on Railway. The bare domain is not, and cannot be
moved the way I first said.

**What I got wrong.** I gave a CNAME record for `@` pointing at a Railway
target. The apex carries MX records — `mx00.ionos.co.uk`, `mx01.ionos.co.uk` —
and SPF, and DNS forbids a CNAME coexisting with any other record at the same
name. Following that instruction at the registrar would at best have been
rejected and at worst taken the email with it. IONOS also does not offer
ALIAS, ANAME or CNAME flattening, which is the usual way round the apex
problem, so there was no version of that advice that worked here.

The custom domain I created on Railway for `facetpro.co.uk` could therefore
never validate. It has been deleted; the service lists only its Railway URL and
`www.facetpro.co.uk`.

**Where that leaves the bare domain.** `facetpro.co.uk` still resolves to
Vercel, which 307s to `www`. It works, and Vercel is load-bearing for exactly
that one redirect — delete the project and the bare domain stops resolving.

Two ways out, both fine:

- **IONOS domain forwarding** — set `facetpro.co.uk` → `https://www.facetpro.co.uk`
  in the IONOS panel, confirm the redirect still works, and only then delete
  the Vercel project. The `76.76.21.21` A record stays until step two passes,
  so nothing is lost if it does not.
- **Leave it.** Vercel runs one redirect and nothing else. The risk is somebody
  deleting it later without knowing it was doing a job.

Do not attempt an apex CNAME on this domain.

---

## Added 7 August

**The same photograph did not give the same price.** The homepage says, in
those words, that the same house gets the same number. Five runs of one
photograph through the live service found 5, 7, 7, 8 and 8 front windows, and
priced the house at £16,889–£30,707 on one run and £25,166–£45,757 on another
— forty-nine per cent apart, each one labelled "measured from your photo".

The model is sampled, and `temperature` is deprecated on it, so there is no
setting that turns the variation down. Detection now keeps its answer against
a SHA-256 of the image bytes: one photograph is read once, and every later
upload of it returns the same measurement and the same estimate. Re-measured
on the live host afterwards — five runs, one price, nought per cent apart.

Two things this does not do, and both matter:

- **A second photograph of the same house still varies.** The cache keys on
  bytes. A homeowner who takes another picture from two steps to the left gets
  a fresh reading, and it can differ by as much as the figures above. Nothing
  currently detects that or reconciles the two.
- **It is in memory.** A deploy empties it, and the service runs one process.
  Both are fine while the answer is only needed for one session; neither is
  fine once an estimate is quoted back to somebody days later. The record
  already persists in `detections`, so the durable fix is to key that table by
  image hash rather than to add another store.

Guarded by `test/detect-stable.test.js`, whose last test fails if the sentence
is on the page and the caching is not in the server.

**The live service is on Postgres now.** It was running on JSONL files inside
the container — so every deploy wiped the saved designs, the resume codes and
`data/usage.json`, which is the only thing bounding Anthropic and Replicate
spend. `DATABASE_URL`, `DB_SCHEMA` and `INSTALLER_TOKEN_SECRET` are set on the
service; the twelve tables are in the `facetpro_visualiser` schema, and seven
of their names collide with the FastAPI backend's tables in `public`, which is
exactly what the separate schema is for. Verified by running a detection
against the live host and watching the row appear.

**Two things about that database connection, for whoever is on call.**

Railway issues every Postgres the same certificate — `CN=localhost`, with
localhost as its only subject alternative name — signed by a self-signed
`root-ca` it also serves. We connect over the private network as
`postgres.railway.internal`, so the name can never match and the first deploy
failed on the hostname check. The fix keeps the chain check and pins that CA
in `DATABASE_CA_CERT`, waiving only the hostname, only on a
`.railway.internal` host, only for `CN=localhost`, and only when a CA is
actually supplied. `test/db-tls.test.js` is the boundary.

1. **The pinned CA expires on 14 October 2028**, and Railway may rotate it
   sooner. When it does, the service will refuse to start and say
   `self-signed certificate in certificate chain`. That is the correct
   direction to fail, but it is a total outage rather than a warning. Re-pin
   with:

   ```
   openssl s_client -starttls postgres -connect <public-proxy-host:port> -showcerts </dev/null \
     | awk '/BEGIN CERTIFICATE/{n++} n==2' | awk '/BEGIN CERT/,/END CERT/' > rootca.pem
   railway variables --service facetpro-visualiser --set "DATABASE_CA_CERT=$(cat rootca.pem)"
   ```

2. **Do not point `DATABASE_URL` at `DATABASE_PUBLIC_URL`.** The waiver is
   scoped to the private host on purpose; the public proxy gets ordinary
   verification, which its certificate cannot pass. It will fail closed, which
   is right, but the reason will not be obvious at three in the morning.

**Three more, the same afternoon.**

**Two processes could empty a table.** `writeAll` is DELETE-everything then
reinsert. Two of those overlapping on `leads` is not a lost update: the second
DELETE removes rows the first has already committed, and its reinsert only puts
back what it read beforehand. `numReplicas: 1` was holding the assumption, but a
rolling deploy runs the old container and the new one at once *by design* —
exactly when a retention run and a withdrawal overlap. `mutate` now does the
read and the write inside one transaction holding `pg_advisory_xact_lock`, keyed
per schema and table, so it is serialised across every process on the database
and retention on `leads` does not block a withdrawal.

**There was one index in the whole store.** Everything else was a sequential
scan — and the paths that scan are withdrawal, erasure and retention, which are
the ones with a statutory month attached and which grow with every lead ever
taken. Six added: `lead_id` on the four tables erasure joins across, `ts` on
`leads` and `access_log`. Verified present on the live database.

**The render could outlive the request.** `Prefer: wait=60` plus 45 polls at
two seconds is 150 seconds against a `requestTimeout` of 120, so the socket
closed under the handler and the homeowner got a dropped connection instead of
the 504 written for them. It is a deadline now, inside the server's own
timeout. Polls have an `AbortController` (Node's fetch has no default timeout),
`poll.ok` is checked — a 429 used to parse into an object matching neither
branch and ride out the full ninety seconds silently — and `canceled` is
terminal rather than still-running.

Covered by `test/render-poll.test.js` and three additions to
`test/postgres.test.js`, including two connections racing through `mutate`.

Also: `DETECT_RATE_LIMIT` now overrides the ten-per-minute detection limit.
It exists so the suite can send one photograph fifteen times. Leave it unset.

---

## Pricing: what is real and what is not

Substantially rewritten on 6 August from list prices the owner supplied. See
`notes/glazing-rates-from-the-trade.md` for the working.

| | Source |
|---|---|
| Cladding, roof, roofline, scaffolding, waste, VAT | Real rates from the production backend. **Never validated against a completed job** |
| Six doors, £1,085 to £4,988 inc VAT | Derived as Anglian list less the 40% discount, divided by 1.6. The composite door is the check on that rule rather than a product of it |
| Four window bands, plus **£324 net per opening light** | Confirmed by the owner, then checked against Anglian list prices for six products |

**The estimate is a range across both installers**, ×0.88 to ×1.6, with a
separate "if you don't negotiate" figure at ×2.0. Those multiples were derived
from two door products and have since held across six.

**Openers are a dimension, not a scalar.** A standard window is £570 with none
and £1,348 with two — ×2.37 — so one band price was 49% dear against a fixed
pane and 37% cheap against one with two. A photograph cannot tell which, so
the product asks and leaves the typical case standing when it is not answered.

Still not modelled: bifold widths between 2.4 m and 3 m, anything wider, and
whether the flat per-opener cost holds across band sizes.

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

**Three counters in this repository answer this question differently, and only
one of them decides whether the site starts.** Checked 24 August:

| Method | Distinct | Occurrences | Scope |
|---|---|---|---|
| `npm run check-legal` | 18 | 45 | privacy + terms + `gated/investors.html` |
| The startup guard, `server.js` `PLACEHOLDER` | **16** | **43** | privacy + terms |
| The `class="ph"` snippet this section used to recommend | 19 | 37 | privacy + terms |

The first two agree: `check-legal` is the guard's regex plus the investor page,
so 16 + 2 investor placeholders = 18, and 43 + 2 = 45. **The guard is the
authority** — it is what refuses to start a deployment with `LEAD_CAPTURE=on`,
and it matches on brackets (`/\[[A-Z][^\]]{2,200}\]/`), not on markup.

The odd one out is the `class="ph"` snippet, and it is wrong in the dangerous
direction: it finds *more* distinct values (19) but *fewer* occurrences (37)
than the guard. Some bracketed placeholders are not wrapped in `class="ph"` at
all, so the snippet never shows them. Clear all nineteen things it lists and
the deployment can still refuse to start, with no indication of what is left.

So: run `npm run check-legal`, and treat the two investor placeholders it adds
as separate — they gate `/investors` only, never the site (see the proportion
argument in `server.js`). Earlier handovers said "~13/11"; they were wrong too,
which is the pattern this table exists to end. A solicitor brief exists and the
copies sent to the solicitor are byte-identical to these files.

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
