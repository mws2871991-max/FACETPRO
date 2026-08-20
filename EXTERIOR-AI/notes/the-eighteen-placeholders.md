# The eighteen placeholders

`npm run check-legal` reports 18 distinct placeholders across 45 places, and
they are the gate on revenue. `server.js` refuses to start a deployment with
`LEAD_CAPTURE=on` while any of them remain, so no lead reaches Anglian or
Zenith until this list is empty. Nothing unlawful is happening in the meantime
— capture is off, so no homeowner has typed anything into this site.

This is that list, grouped by who can actually answer it. The script is the
authority on where they are; run it for exact line numbers, because it prints
at most six locations per placeholder and several appear more often than that.

None of these can be filled in from the code. That is the whole difficulty:
they are facts about a business, and the codebase has no way to know them.

## Group 1 — who the entity is

Four fields, one afternoon, and everything else in the notice hangs off them.

| Placeholder | Times | Where |
| --- | --- | --- |
| `[COMPANY LEGAL NAME]` | 2 | `legal/privacy.html:50`, `legal/terms.html:38` |
| `[COMPANY NUMBER]` | 2 | `legal/privacy.html:52`, `legal/terms.html:38` |
| `[REGISTERED ADDRESS]` | 2 | `legal/privacy.html:53`, `legal/terms.html:38` |
| `[ICO REGISTRATION NUMBER]` | 1 | `legal/privacy.html:55` |

The ICO number is the one with a lead time. Registration is an online form and
a fee, but it is not instant, and `DEPLOY.md` already names it as a
precondition for turning capture on. Start it before the rest of this list,
not after.

## Group 2 — how to reach you

| Placeholder | Times | Where |
| --- | --- | --- |
| `[PRIVACY EMAIL]` | 11 | `legal/privacy.html` (54, 56, 107, 246, 253, 263, …) |
| `[CONTACT EMAIL]` | 6 | `legal/terms.html` (39, 77, 138, …) |
| `[CONTACT PHONE]` | 2 | `legal/terms.html:39`, `legal/terms.html:138` |
| `[COMPLAINTS ADDRESS]` | 2 | `legal/privacy.html:254`, `legal/terms.html:138` |
| `[COMPLAINTS FORM URL]` | 2 | `legal/privacy.html:252` |

`[PRIVACY EMAIL]` is the single most repeated placeholder on the site, and it
has a matching environment variable: `PRIVACY_EMAIL` must equal what goes into
the notice, because it is what someone sees when their withdrawal link has
expired. Set both or neither.

The complaints pair is the ICO's own escalation route, not yours — the notice
has to tell people they can complain to the regulator and how.

## Group 3 — where the data sits

**This group needs a decision before it needs an answer, and the current
answer is probably not the one the notice wants.**

Railway reports the service region as `sfo` — San Francisco — and the database
is `postgres.railway.internal`, in the same project and therefore the same
place. So as configured today, a UK homeowner's name, email, phone and
photograph would be stored in the United States.

| Placeholder | Times | Where |
| --- | --- | --- |
| `[REGION]` | 2 | `legal/privacy.html:116`, `legal/privacy.html:130` |
| `[CRM PROVIDER — DELETE THIS LINE IF YOU DO NOT USE ONE]` | 1 | `legal/privacy.html:117` |
| `[DELETE ROW IF UK/EEA HOSTED, OTHERWISE SPECIFY]` | 1 | `legal/privacy.html:130` |
| `[UK EXTENSION TO THE EU–US DATA PRIVACY FRAMEWORK …]` | 3 | `legal/privacy.html:127–129` |

Read the last two together. The template offers a row you delete if you host in
the UK or EEA, and a transfer mechanism to name if you do not. On `sfo` you
cannot delete it, and the three-line UK Extension block stops being boilerplate
and becomes a live claim you have to be able to stand behind.

There are two ways out and they are not equal:

- **Move the service and database to a UK or EU region.** Railway offers
  European regions; confirm which in the dashboard, as the CLI cannot list
  them. This deletes one placeholder outright, makes `[REGION]` trivially
  answerable, and removes the transfer question rather than documenting it. Do
  it before there is data to migrate — which is now, while capture is off and
  the tables are empty.
- **Stay in `sfo` and paper it.** Then somebody has to establish what Railway
  is certified under and whether an IDTA or the UK Addendum is required. That
  is a solicitor's question and a recurring obligation, not a one-off edit.

The first is a config change made while nothing is at stake. The second is a
commitment. This note has no standing to choose between them, but the timing
argument is one-sided: every day capture stays off is a day the move is free.

`[CRM PROVIDER]` is the easy one — `CRM_WEBHOOK_URL` is unset, and so is
`LEAD_RECIPIENTS`, so there is no third party in the picture at all today.
Unless a CRM appears, delete the line as the placeholder itself instructs. If
installers are added later the notice has to say so, because they are
recipients of personal data and the consent wording already promises "up to
three".

## Group 4 — document housekeeping

| Placeholder | Times | Where |
| --- | --- | --- |
| `[DATE]` | 2 | `legal/privacy.html:31`, `legal/terms.html:31` |
| `[VERSION]` | 2 | `legal/privacy.html:31`, `legal/terms.html:31` |
| `[NUMBER]` | 2 | `legal/terms.html:139` |

Fill these last. The date is the date the notice goes live, which is not known
until the rest is done, and putting today's date in now just means editing it
again.

## Group 5 — the two that want a solicitor

| Placeholder | Times | Where |
| --- | --- | --- |
| `[CERTIFIED HIGH NET WORTH / SELF-CERTIFIED …]` | 1 | `gated/investors.html:43` |
| `[FCA-PRESCRIBED RISK WARNING — EXACT …]` | 1 | `gated/investors.html:50` |

These are not like the others. s.21 FSMA restricts inducements to invest, the
risk warning has prescribed wording that must be reproduced exactly, and the
certification categories are defined in legislation. Guessing at either is
worse than leaving the placeholder in, because a wrong version reads as
compliant.

They also do not block revenue. `/investors` 404s while `INVESTOR_PASSWORD` is
unset, and these two placeholders live only on that page. Everything in groups
1 to 4 can be finished and capture turned on without touching them — so do not
let the solicitor's timeline become the site's.

## The placeholders are not the only gate

Worth knowing before this list is finished, because clearing it will feel like
the end and is not. Checked against the Railway service on 19 August 2026,
these are all unset:

| Variable | What is missing without it |
| --- | --- |
| `LEAD_RECIPIENTS` | **No installer receives anything.** Anglian and Zenith are not configured, so a lead would be captured and stored and go nowhere. This is the revenue path, and it is currently absent. |
| `RESEND_API_KEY` | No email is sent at all. |
| `LEAD_NOTIFY_EMAIL` | Nobody is told a lead arrived. `DEPLOY.md` is explicit that there is no fallback — the email is skipped, not redirected. |
| `LEAD_FROM_EMAIL` | The homeowner's design pack refuses to send. |
| `PRIVACY_EMAIL` | Falls back to `LEAD_NOTIFY_EMAIL`, also unset, then to `privacy@facetpro.co.uk`. Whatever it ends up as must match what group 2 puts in the notice. |

So the sequence is: placeholders, then ICO, then these five, then
`LEAD_CAPTURE=on`. Turning capture on with `LEAD_RECIPIENTS` empty produces
stored leads and silence, which is the worst of both — the data protection
obligations of holding personal data with none of the revenue that justifies
taking it.

`NODE_ENV` is also unset, which `DEPLOY.md` warns leaks stack traces through
Express's default error page. It does not here: the handler at
`server.js:3929` catches everything and returns `{error, ref}` with the detail
going to the log instead. Worth setting for correctness, not urgency.

## The order

1. Start ICO registration. It has the longest lead time and nothing else waits on it.
2. Decide the hosting region, and if it is moving, move it now while the tables are empty.
3. Fill groups 1 and 2 — the facts you already know.
4. Complete group 3 against whatever group 2 decided.
5. Date and version it, delete the "Template — not yet live-ready" banners.
6. `npm run check-legal` until it reports nothing, then `LEAD_CAPTURE=on`.

Group 5 runs alongside on its own clock, and gates only `/investors`.
