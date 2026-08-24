# What this system stores, and what removes it

From the August 2026 code audit: *"the project would benefit from one
authoritative map of every field, why it exists, lawful basis/consent
dependency, retention period and deletion/anonymisation behaviour"*, and
*"deletion/withdrawal needs to be reconciled with backup retention"*.

Compiled 24 August 2026 by reading `store.js`, `retention.js`, `server.js` and
`scripts/backup-and-verify.js`, and checked against the live database with
`npm run count-personal-data`. Where something was not traced end to end, it
says so rather than guessing.

**This is a map, not a promise.** The privacy notice is the promise. If the two
disagree, one of them is a bug — say which, out loud, rather than quietly
picking the flattering reading.

## The tables

Sixteen, all in the `facetpro_visualiser` schema. `●` holds personal data or
data about an identifiable property; `·` does not, by construction.

| Table | | What one row is | Time-based expiry |
|---|---|---|---|
| `leads` | ● | The enquiry: name, email, phone, postcode, consent record | **Yes** — 183 d design-only, 730 d if shared, consent record 2191 d |
| `renders` | ● | Image bytes of an identifiable home | **Yes** — 183 d for orphans (`orphanRenderDays`) |
| `access_log` | ● | Who read the installer area, and when | **Yes** — 365 d |
| `resumes` | · | Design choices carried to a phone; no photograph | **Yes** — 1 d |
| `deliveries` | ● | Which installer received which lead; billing evidence | **No** |
| `lead_responses` | ● | An installer's response to a lead | **No** |
| `withdrawals` | ● | A lead id and what was withdrawn | **No** — and see below |
| `notification_failures` | ● | A lead whose email did not send | **No** |
| `quotes` | ● | A quote, joined to a lead | **No** |
| `waitlist` | ● | An email address | **No** |
| `feedback` | ● | A session id and free text | **No** |
| `detections` | · | Session id, element count, mime type — no image | **No** |
| `detection_cache` | · | SHA-256 of the photograph, never the photograph | **Yes** — 7 d, swept on write |
| `measurement_observations` | · | Shape numbers, unlinkable by construction | **No, deliberately** |
| `funnel` | · | A day, a stage, a number | **No** — nothing to expire |
| `retention_runs` | · | What the sweep did | **No** |

The photograph itself is never stored. `legal/privacy.html` says it "is used to
build your visualisation and is then deleted", and the code keeps only a
SHA-256 of the bytes. The **render** generated from it is a different thing and
is kept — that distinction is the one most likely to be misread.

## Two different mechanisms, often confused

**The retention sweep** is time-based, runs every 24 h, and touches four
things: `leads`, `renders`, `access_log`, `resumes`. Periods live in one place,
`retention.js` `PERIODS`.

**Withdrawal and erasure** is person-initiated, runs on request, and reaches
further — `test/withdrawal.test.js` asserts the lead is redacted, that no
personal value survives on it, that the consent record itself survives ("the
agreement survives; the person does not"), and that installers who already
received the lead are asked to erase their copies too.

**The gap is the seven `●` tables with no time-based expiry.** Withdrawal
reaches ancillary records; the *clock* does not. A homeowner who never asks for
erasure has their `deliveries`, `quotes` and `notification_failures` rows kept
indefinitely, even after the `leads` row they belong to has been redacted or
deleted. That may well be defensible for `deliveries` — it is billing evidence
for a payment that really happened, and a business record has its own basis —
but it should be a decision that is written down, not a default that nobody
chose. `quotes`, `waitlist` and `feedback` have no such justification.

I did not trace whether lead deletion cascades to those tables at the database
level; the sweep's own accounting reports only `kept`, `redacted`, `deleted`,
`rendersRemoved` and `accessLogRemoved`, which suggests it does not. **Check
before relying on either answer.**

## Backups versus deletion

`scripts/backup-and-verify.js` exports every table, restores it into a scratch
schema, and compares by checksum. It exists because the privacy notice promises
"we test that we can restore them" and nobody ever had.

The audit's point stands and is not yet answered: **a row erased on request can
still exist in a backup taken before the request.** The backup is written to a
file off Railway, deliberately — a snapshot on the same platform as the thing
it protects is one outage from being no backup at all — which also means its
retention is whatever the operator's disk does.

Undecided, and needing a decision rather than code:

- How long backup files are kept, and where.
- Whether they are encrypted at rest, and who can read them.
- What happens to a withdrawn record that exists in one: re-run the erasure
  after a restore, or accept the gap and say so in the notice.

Until that is settled, the honest position is that erasure is complete in the
live database and not guaranteed in backups. Most organisations are in exactly
this position; the difference is whether the notice says so.

## Where the data physically is

`sfo` — San Francisco. Service and database both. See
[the eighteen placeholders](the-eighteen-placeholders.md), which covers what
that means for the international-transfer section of the notice and why the
region decision gets more expensive the longer it waits.

## Keeping this true

`npm run count-personal-data` prints live row counts per table and flags any
table it has not been told about, so a new table cannot be added without this
document being visibly out of date. Run it before trusting anything above.
