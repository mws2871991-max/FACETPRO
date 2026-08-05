# What the first Facet Pro knew

There is an earlier Facet Pro: a Next.js front end on Vercel serving
`www.facetpro.co.uk`, and a FastAPI backend on Railway with 63 endpoints,
sharing this project's Postgres. It is what `test/postgres.test.js` means when
it warns about the database that "also holds the FastAPI backend's tables".

Its data is test data — 145 rows, addresses at `example.com` and
`placeholder.facetpro.co.uk`, one that might be real, nothing written since 27
July 2026. And it has no consent record, no withdrawal, no retention and no
erasure. Two columns cover the whole of data protection:
`homeowners.unsubscribe_token` and `homeowners.unsubscribed_at`. It cannot
lawfully take a paying lead without building what this codebase already has.

So it is not worth preserving as software. **The thinking in it is.** Somebody
worked out a great deal about this business and encoded it in a schema, and
when that database is deleted the reasoning goes with it. This file is that
reasoning, written down separately.

Captured 5 August 2026 from the live schema.

---

## 1. Damage detection — the strongest idea in it

```
damages: design_id, damage_type, severity, location, confidence,
         description, recommended_action, urgency,
         estimated_repair_cost_min, estimated_repair_cost_max
```

It was finding things: roof ×7, gutter ×4, soffit ×4, window ×3, fascia ×1
across 18 designs.

This is a different proposition from the one we sell. Ours is aspiration —
here is your house with better windows — and aspiration is acted on in two
years or never. Damage is **urgency**: your gutters are failing, it is £400
now and £2,000 once it reaches the fascia.

Same photograph, same detection pass, same measurements. A lead carrying a
problem closes; a lead carrying a daydream does not, and an installer knows
the difference and will pay accordingly.

`recommended_action` and `urgency` are the fields that make it a product
rather than an observation.

## 2. Installer verification — this answers a placeholder in our own Terms

```
installers: verification_status, company_number,
            insurance_provider, insurance_policy_number, insurance_expires_on,
            trade_body, verification_submitted_at, verification_decided_at,
            verification_notes, parent_company
```

`legal/terms.html` currently contains a placeholder asking us to *"list your
actual checks — verifying the company at Companies House, confirming current
public liability insurance and recording the expiry date, confirming trade
accreditation"*.

That schema is the answer, and it stores the evidence rather than the claim:
who checked, when, what they decided, and when the insurance runs out. Note
`parent_company` — it matters when two "different" installers turn out to be
one group, which is exactly the case a three-installer cap exists to prevent.

## 3. A photograph of the back

```
designs: photo_url, own_front_photo_url, back_photo_url
```

Our largest measurement assumption is the front-to-total multiplier —
inferring the whole house from one elevation. It is why the range is ±18%, and
what `npm run validate` exists to test.

The first version just asked for a second photograph. Not clever, and much
better than an assumption.

## 4. Scores a homeowner acts on

```
designs: kerb_appeal_score, energy_score, maintenance_score,
         efficiency_score, property_value_increase
```

"This adds £X to your home" is a stronger reason to act than "this looks
better", and with EPC pressure the energy figure is doing real work in the UK
right now. We already compute the measurements these would rest on.

Anything published here needs a defensible basis — a property-value claim
without one is a misleading commercial practice, and the DMCC Act is the
relevant place to look before it goes on a page.

## 5. A price per installer, not one price for everybody

```
installers: lead_price, custom_rates
```

We have two signed contracts at **£100 and £130**. Our code has a cap of three
and no per-buyer price at all, so a delivery record cannot say what the lead
was worth. Theirs could.

The delivery log is billing evidence. It should carry the fee that applied at
the time, not a number looked up later from a contract that may have changed.

## 6. Where leads die, and chasing them

```
designs: abandoned_email_1_sent_at, abandoned_email_2_sent_at
leads:   unclaimed_notice_sent_at, claim_stall_notice_sent_at,
         revisit_email_1_sent_at, revisit_email_2_sent_at
```

Four distinct failure points, each with its own chase: the homeowner abandons
mid-design; no installer claims the lead; an installer claims it and goes
quiet; the homeowner goes cold after quoting. Storing the *sent* timestamp
rather than a flag means you can see how long each stage takes.

That is the difference between generating leads and being paid for them.

**Before building any of it:** these are direct marketing under regulation 22
PECR. They need their own unbundled consent and an unsubscribe in every
message, and our notice currently promises no marketing. The mechanism is
right; the lawful basis has to come first.

## 7. Qualification fields that make a lead worth more

```
leads: budget_min, budget_max, confidence_score,
       preferred_survey_window, preferred_installation_timeframe,
       finance_interest
```

An installer buying a lead wants to know whether the person can afford the job,
when they want it done, and whether they need finance. Those answers are worth
more than the name.

`finance_interest` is a boolean with an FCA question behind it — introducing
consumer credit is a regulated activity. Capture the interest, do nothing with
it until somebody has advised on that.

## 8. Starting from an address instead of a photograph

```
designs: from-address, address-search, postcode_lat, postcode_lng
```

Most first-time visitors will not upload a photograph. Letting them start from
an address and *improve* the estimate with a photograph later is a conversion
route we do not have.

## 9. Sharing, and answering a quote in the product

```
designs: shared_url
endpoint: /designs/shared/{url}/quote/respond
```

A homeowner shows a partner. A quote is answered where the design lives rather
than in an email thread nobody can find.

---

## What we already do better, and should not give up

Consent recorded per box with the wording shown, withdrawal and erasure,
enforced retention periods, access logging, the door-reference measurement,
server-side pricing that a client cannot tamper with, and a test suite over
all of it.

The first Facet Pro understood the **business**. This one understands doing it
**properly**. The work is to bring the first one's list into the second one's
discipline — not to restart, and not to preserve a database that cannot
lawfully hold a customer.
