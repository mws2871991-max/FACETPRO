# Single-trade journeys — plan

Written 2026-08-14, before any code was changed.

## The defect

Every pricing path fills in what the visitor did not choose, and always upward.

```js
// server.js, computePrice — three times
const roof = catalogue.roof.find(r => r.id === roofId) || catalogue.roof[0];
```

Absence is indistinguishable from "the first one in the catalogue". `priceGlazing`
has the same shape: pick a door and no window style, and every window in the
house is priced at the default style.

Measured, on the default 95 m² house:

| Visitor wants | Shown | Of which theirs |
|---|---|---|
| A composite front door | £7,451–£13,837 | £1,667 |
| Walls rendered | £27,372 | £6,175 — 23% |
| A conservatory | £27,372 + a guide band | £0 priced |

The door buyer is charged for eight windows. The render buyer is charged for a
roof and fascias. The conservatory buyer is charged for a whole exterior refit
and the thing they asked about is not priced at all.

## Why it matters more than a conversion leak

`/api/lead` stores `price: price.total` unconditionally. An installer pays £100
for a lead whose headline figure describes work the homeowner never asked for,
and finds out at survey. That is precisely the failure README.md warns about
happening to a competitor with a published rate card.

## Design

**Absence gets a name.** `'none'` is an accepted id for `claddingId`, `trimId`,
`roofId` and `windowStyleId`, meaning *not this trade*. An **absent** field keeps
today's default, so existing callers and the thirteen test files that assert on
price shape do not move. Opting out is explicit; nothing changes by omission.

`resolveConservatory` already returns `{ ..., indicative: true }`. That flag is
the concept the five trades lack — priced, excluded, or indicative. This work
gives the trades the same vocabulary.

## Steps

1. **`computePrice` honours `'none'`.** Excluded trades contribute nothing to
   materials, labour or waste. All three excluded → no price rather than a
   floor of scaffolding plus VAT.
2. **Scaffolding stays with the walls.** It is conditional on *some* external
   work existing, not on the roof specifically — rendering a two-storey house
   needs a scaffold, which is why the walls-only calculator already charges it.
3. **`priceGlazing` honours `windowStyleId: 'none'`.** Doors priced alone; the
   £780 access charge applies only when windows are actually being replaced;
   `minJobCharge` (£950) finally becomes reachable, which is what stops a £904
   uPVC door being quoted as a £904 job.
4. **A lead may carry no priced work.** `price` becomes nullable so a
   conservatory-only enquiry is not dressed as a £27,372 job. The installer
   portal must render a lead with no `priceBreakdown` — which it needs anyway,
   because leads stored before this change always have one and leads after it
   may not.
5. **UI.** Each trade group gets a "not this time" option and the total bar
   names what is included. It already does this for glazing — "8 windows ·
   1 door" — so the pattern exists.
6. **Two rate sets.** Once walls-only is expressible in the main estimate, the
   `wholeHouse` quick calculator either agrees with it or goes. Today the same
   job is £27,372 there and £8,313 here, which is the "same house, same number"
   promise failing inside one page.

Steps 1–4 are one change and fix all four journeys. 5 and 6 are a second pass.

## Not doing yet

Whether the conservatory should be priced properly rather than banded. That is
a product decision and needs size, glazing and groundworks the photograph
cannot supply.
