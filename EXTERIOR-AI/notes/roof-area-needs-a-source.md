# The roof area has no source

**Raised 18 September 2026**, by the render-and-roof review, which noticed the
symptom rather than the cause: the breakdown stated *"Based on 85 m² of wall"*
under a roof line of £9,584, and never said what roof area produced it.

It produced it from this, in `computePrice()`:

```js
const ROOF_AREA_FROM_WALL = 0.55;
const roofArea = claddingArea * ROOF_AREA_FROM_WALL;
```

## Why this one matters

Every other figure in that function traces to something. The material rates
and labour rates came from the production backend's own rate card
(`catalogue.json` says so, and names the files). Scaffolding, waste and VAT are
stated policy. The wall area is measured off the photograph, and when the
measurement is not trusted the page says so in as many words.

`0.55` traces to nothing. The comment beside it read *"roof area is typically
smaller than wall footprint"* — which is an argument for a number below 1, and
not an argument for this one. It is the only unsourced figure in the pricing
engine, and it decides an entire trade.

## What it currently implies

| | |
|---|---|
| Default wall area | 85 m² |
| Roof area used | **46.75 m²** |
| Slate re-roof at that area | about **£9,600** |
| `/cost/new-roof-cost` worked example | **80 m²** |
| Charcoal re-roof at 80 m² | about **£12,900** |

So the same customer is shown one roof price on the page that brought them
here and a materially different one in the tool, with no explanation, because
until now the tool never said what area it was using. It does now — that part
is fixed, and it makes the disagreement visible instead of mysterious. It does
not make either number right.

## Which is wrong

Probably both, and the arithmetic says which way.

46.75 m² is close to the *plan* area of a typical semi's footprint — that is
what you get when the pitch is ignored. A roof is not its plan: a 35° pitch
covers about 1.22× the plan area, a 45° pitch about 1.41×. A roofer prices the
slope, because the slope is what gets tiled.

So if 46.75 m² is the plan area of the house, the covered area is nearer
55–60 m², and the tool under-prices a re-roof by roughly a quarter. The cost
page's 80 m² looks high for a semi and reasonable for a detached, which
suggests it is a different house rather than a different method.

**None of that is a measurement.** It is the same shape of reasoning that put
`0.55` there in the first place, and replacing one unsourced constant with a
better-argued unsourced constant is not progress — it just moves the error
somewhere harder to find.

## What would settle it

The same thing the wall-measurement bands need, and ideally from the same
properties:

- For six real houses, the roof area an actual roofer quoted, against the wall
  area this site computes for them.
- The pitch and the plan footprint for each, so the relationship can be a
  geometry rather than a ratio.
- Whether the quote covered both slopes, and any porch, bay or dormer.

Six numbers turns a guess into a rule, and it is the same visit that fixes the
wall bands. Until then the page says the roof area is worked out from the size
of the house rather than measured, and tells the homeowner to expect a roofer
to measure it — which is true, and is the most the site can honestly claim.

## Do not quietly change it

Moving this constant moves every roof price on the site, including ones
already shown to people and any already sent to an installer. It is a
commercial decision, not a tidy-up.

Related: [`the-eighteen-placeholders.md`](the-eighteen-placeholders.md) for the
other things waiting on real-world input, and the measurement plausibility
bands in `measure.js`, which are unsourced in exactly the same way and were
raised in the 17 September review.
