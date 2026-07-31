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
| `ANTHROPIC_API_KEY` | for detection | Without it uploads return a clear error. |
| `REPLICATE_API_TOKEN` | for renders | Without it renders return a clear error. |
| `RESEND_API_KEY` | for email | Without it leads are stored but nobody is notified. |
| `LEAD_NOTIFY_EMAIL` | for email | Where new leads go. **No fallback** — unset means the email is skipped, not sent to the customer. |
| `LEAD_FROM_EMAIL` | for email | Must be on a **domain verified at resend.com/domains**. On Resend's test sender nothing reaches real homeowners, and the design-pack email refuses to send at all. |
| `SITE_URL` | recommended | Absolute base for links inside emails. `https://www.facetpro.co.uk`. |
| `SITE_MODE` | no | Defaults to `beta`. Set `live` to drop the beta badge and notices. |
| `DAILY_DETECT_LIMIT` | no | Default 50. |
| `DAILY_RENDER_LIMIT` | no | Default 50. The only thing bounding render spend. |
| `PORT` | no | The host sets this. |

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
