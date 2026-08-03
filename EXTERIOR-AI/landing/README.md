# Landing page candidates

Not served. `exterior-v5.html` is a design candidate under review, not part of
the app — `PUBLIC_FILES` in `server.js` does not list it, so it 404s like
`guided-demo.html` does. It lives here to be version-controlled and diffable
while the claims in it are worked through, because that is the whole problem
with these artifacts: the untrue parts are not the ones that look untrue.

## What has been changed so far

**Finance removed.** The page had a pay-once / pay-monthly toggle showing
`£X/mo • 0%` and `0% markup • 59 months`. Offering or brokering credit for home
improvements is an FCA-regulated activity — that is an authorisation question,
not a wording one. The monthly button is gone rather than disabled, the price
is the one-off figure, and "Updates total live • Finance recalculated" now
reads "Updates your total as you choose".

## What is still in it and cannot ship as written

- **"Full Exterior Certificate of Measurement"**, with a download. A
  certificate is a document of record; the measurement behind it is a
  door-reference estimate with ±15–20% uncertainty and no external validation,
  which `measure.js` states plainly. A homeowner can take that to an installer
  as evidence.
- **"One photo. One price. One guarantee."** The middle third is a fixed price
  from a photograph with no survey. "One photo. One quote. One contact." keeps
  the rhythm and is true.
- **"Adds £18k–£25k value + £340/yr energy saving."** An objective claim about
  somebody's property value and their bills, needing documentary
  substantiation before publication.
- **"10yr guarantee • insurance backed"** — whose? If ours, that is a
  liability we are taking on. If the installer's, it cannot be stated as a
  blanket fact.
- **Named verification** ("J. Whitmore • MICS", "Full Exterior Verified",
  postcode-level "verified" badges) — invented people and accreditations.

## What is worth keeping verbatim

- *"For your home. Not a sales funnel."*
- *"No more 5 different tradesmen quoting 5 different prices."* — the bundle
  argument told as a story rather than a discount, which is the strongest line
  in either candidate
- *"Drop ANY exterior photo here"* and *"Frame colour • brick untouched"* —
  both remove a real fear, and the second is what the render prompt enforces
