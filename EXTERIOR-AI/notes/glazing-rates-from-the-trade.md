# Real glazing prices — where jobs actually settle

**Source:** twenty-four years selling windows and doors for one of the two
national installers who buy leads here. This is what jobs go out at, not a
published rate card — a rate card is list, and list is the opening move.

**Status:** doors done. Windows confirmed by the owner on 6 August 2026 — see
"The bands, confirmed" below. Neither is a supplier rate card.

## Anglian list prices — 6 August 2026, and what they show

Given the same day the bands were confirmed, and they change the picture.

| item | Anglian list | less 40% | our catalogue, inc VAT | ours is |
|---|---|---|---|---|
| Composite door | £5,401 | £3,241 | £2,000 | 38% below |
| Composite door (alt) | £4,979 | £2,987 | £2,000 | 33% below |
| Sliding / double door | £5,058 | £3,035 | not priced | — |
| Standard window, 2 openers | £2,247 | £1,348 | £850 | 37% below |

Standard window with **no** openers: £950. Basis not stated.

**The gap is consistent — about 35% — and it is the same for doors as for
windows.** The doors were the figures treated as real from the start, so this
is not a windows problem. Set against the earlier note that Zenith settles a
composite door at £1,800–£2,500, our £2,000 sits squarely in Zenith's range
and roughly a third below Anglian's.

So the likely reading is not that the catalogue is wrong, but that it
describes **the cheaper of the two installers rather than the middle of the
market**. That is a product decision and it is not obviously wrong — but it
should be deliberate, and it should be said, because a homeowner shown £2,000
and quoted £3,241 by Anglian concludes the estimate was wrong.

### The list/settled question is answered

A 3 m bifold was given as **£13,304**. Less 40% that is **£7,982**, which
lands exactly at the top of the Anglian range recorded on 3 August
(£5,990–£8,000). The two sets of figures are the same prices seen from
different ends:

| | |
|---|---|
| the figures given on 6 August | **Anglian list** |
| less 40% | **Anglian settled** |
| the ranges given on 3 August | **settled**, both installers |
| our catalogue | **≈ Zenith settled** |

So nothing contradicts anything. The catalogue is internally consistent and
describes the cheaper installer.

| product | ours | Anglian settled | ours is |
|---|---|---|---|
| Composite door | £2,000 | £3,241 | 38% below |
| Standard window, 2 openers | £850 | £1,348 | 37% below |
| Bifold, 3 m | £4,000 | £7,982 | **50% below** |

The gap widens as the job gets bigger. A homeowner pricing a bifold off this
site and then calling Anglian sees double.

### Anglian list prices collected so far

| product | list | less 40% | in our catalogue? |
|---|---|---|---|
| uPVC front / back door | £2,893 | £1,736 | **no — not priced at all** |
| Composite door | £5,401 / £4,979 | £3,241 / £2,987 | yes, at £2,000 |
| Sliding door | £5,058 | £3,035 | **no** |
| Double doors | £5,058 | £3,035 | **no** |
| Bifold, 3 m | £13,304 | £7,982 | yes, at £4,000, no width |
| Standard window, no openers | £950 | £570 | one band, £850, no opener count |
| Standard window, 2 openers | £2,247 | £1,348 | as above |

Three products the catalogue does not have: **uPVC doors, sliding doors and
double doors.** uPVC is 46% cheaper than composite and is the volume product —
most back doors and a good share of front doors. Offering only composite
prices every door as though it were the expensive option.

Two dimensions the catalogue does not model: **bifold width** (a 3 m unit is
quoted, ours is one flat price) and **opener count** (×2.37 on a standard
window).

### x1.6 and x2.0 are two different questions

The spread was one band, x0.88 to x2.0, and the x2.0 end came from the bifold
— the one product where our base is wrong for an unrelated reason. Applied to
windows it produced a headline of £17,204 for a semi, against roughly £12,058
for what Anglian actually settles at. Forty-three per cent above anything real.

Going back to the 3 August figures explains it. Anglian composite ran
£2,300–£4,000. The £4,000 top is x2.0 of our base; £3,241 is the same door at
list less the full 40%. So:

| multiple | what it is |
|---|---|
| **x1.6** | the dearer installer, discount properly applied |
| **x2.0** | **the same installer**, discount not applied |

x2.0 is not another company. It is one conversation on a weeknight.

They are now separate: INSTALLER_SPREAD (x0.88 to x1.6) is the estimate, and
NO_HAGGLE (x2.0) is shown beneath it as what not negotiating costs — about
£3,441 on a semi, £4,568 on a detached.

Which is the better product as well as the truer one. One wide band said
"somewhere between £7,570 and £17,204", which is true and useless. Apart, the
first number is the price and the second is what the haggling is worth.

### The model is right. One number is wrong.

A sash window, 900 x 1700 including the box, at £3,890 list. Against the
standard casement with two openers at £2,247, Anglian's implied sash premium
is **x1.73**. Our styleMultipliers has sliding-sash at **x1.65**.

That is close enough to say the multipliers were well judged. And it holds
across the rest:

| | ours | Anglian settled | factor |
|---|---|---|---|
| Composite door | £2,000 | £3,241 | x1.62 |
| Standard window, 2 openers | £850 | £1,348 | x1.59 |
| Sash 900 x 1700 | £1,402 | £2,334 | x1.66 |
| Bifold, 3 m | £4,000 | £7,982 | **x2.00** |

Everything but the bifold sits at about **x1.6**, and the bifold is out
because width is not modelled — a 3 m unit is a bigger thing than our generic
one, so the gap there is a missing dimension rather than a wrong price.

**So this is not a rebuild.** The structure, the bands and the multipliers all
hold. What is wrong is a single scalar on the base prices, and it is only
wrong at all if the estimate is meant to describe Anglian rather than Zenith —
which is the open decision, not a defect.

### VAT basis confirmed — all inclusive

Every figure given on 6 August is **inclusive of VAT**, and the 40% discount
comes off the inclusive price. Our catalogue stores net and grosses up, so all
the comparisons above were inclusive against inclusive and none of them needs
revising.

| product | list | settled | ours | factor |
|---|---|---|---|---|
| uPVC front / back door | £2,893 | £1,736 | not priced | — |
| Composite door | £5,401 | £3,241 | £2,000 | x1.62 |
| Sliding / double | £5,058 | £3,035 | not priced | — |
| Bifold, 3 m | £13,304 | £7,982 | £4,000 | x2.00 |
| Window, **no** openers | £950 | £570 | £850 | **x0.67** |
| Window, 2 openers | £2,247 | £1,348 | £850 | x1.59 |
| Sash 900 x 1700 | £3,890 | £2,334 | £1,402 | x1.66 |

### The windows need a dimension, not a scalar

That x0.67 is the important row. Against a window with **no** openers our £850
is **49% too dear**; against the same window with two it is **37% too cheap**.
One number is standing in for a x2.37 spread, so it is wrong in both
directions and the average is right for almost nobody.

A scalar cannot fix that. Openers have to be a dimension of the price.

Doors are different: there the gap is a clean x1.6 and a scalar does fix it,
once uPVC, sliding and double are added. Bifold needs width.

So the work divides:

- **doors** — add three products, apply the scalar if the estimate is to
  describe Anglian
- **windows** — add opener count, which the photograph cannot supply, so ask
- **bifold** — add width The
figures given on 3 August were inclusive. These have not been stated, and it
moves everything by 20%.

### Openers matter more than size

£950 with no openers against £2,247 with two is **×2.37**. Four size bands
cannot carry that, and a photograph cannot reliably show whether a pane opens
— a fixed light and a top-opener look the same from the pavement.

So the model has to ask rather than infer, or the range has to be wide enough
to be honest about not knowing. That is a design decision waiting on the two
answers above.

### And the number the whole company is built on

The same composite door: **Anglian list £5,401, Zenith settled £1,800.** Three
times the price for identical product, depending only on who knocks and how
hard the customer pushes. The 40% discount is not a rumour; it is a documented
lever with a number on it.

That is the homepage argument, quantified by the person who sold it.

## The bands, confirmed — 6 August 2026 (superseded the same day, see above)

The four window bands were reviewed by the owner and confirmed correct, on the
same basis as the door prices: what jobs settle at, from twenty-four years
selling them.

| band | net | inc VAT | example |
|---|---|---|---|
| Small | £504 | £605 | 600 x 900 — WC, landing, porch |
| Standard | £708 | £850 | 1200 x 1200 — most bedroom and lounge |
| Large | £1,032 | £1,238 | 1800 x 1350 — front lounge, patio-side |
| Extra large | £1,416 | £1,699 | picture windows, wide mullioned units |

**The estimate below that these run at roughly half of trade is withdrawn.**
It was inferred from the gap between the placeholder door price and the real
one, and generalised to windows on the assumption they behaved the same way.
The person who sells them says they do not. That inference was mine and it was
wrong; the paragraph is kept rather than deleted because the reasoning is
still worth seeing, and because the direction it warns about is still the
dangerous one.

What this changes in the product: `catalogue.glazing.source` no longer
contains "placeholder" or "not sourced", so `ratesSourced` is true, the amber
caveat beside the window price is gone, and the market comparison — withheld
while the base was unsourced — is shown again.

What it does not change: these are one person's knowledge, not a supplier rate
card. When a rate card exists, check the bands against it rather than assuming
they agree, and expect the band *boundaries* to move as well as the prices.

## The pattern so far (superseded — see above)

The placeholders are running at roughly **half** of real. That direction is
the dangerous one: a homeowner shown £1,250 for a door who is then quoted
£2,800 does not conclude that installers vary — they conclude the estimate
was wrong, and the lead dies. Overstating loses a click; understating loses
the buyer's confidence, and the buyer is the one paying.

## Windows — the 20% uplift of 2026-08-04

| band | was | now | example |
|---|---|---|---|
| Small | £420 | £504 | 600 x 900 — WC, landing, porch |
| Standard | £590 | £708 | 1200 x 1200 — most bedroom and lounge |
| Large | £860 | £1,032 | 1800 x 1350 — front lounge, patio-side |
| Extra large | £1,180 | £1,416 | picture windows, wide mullioned units |

An across-the-board 20% on the owner's trade judgement, not a rate card and
not derived from the doors. It moves the numbers toward trade without
claiming to have arrived: if the half-of-real estimate above is right, these
are still roughly 40% light, because 0.5 x 1.2 = 0.6.

So this changes the size of the error, not its direction, and everything the
`source` field says about these being unsourced still holds. The four real
band prices remain the outstanding item, and when they land they should
*replace* these rather than be reconciled with them.

## Doors — supplied and fitted, 3-panel where stated

| | placeholder | Zenith | Anglian |
|---|---|---|---|
| Composite front door | £1,250 | £1,800 – £2,500 | £2,300 – £4,000 |
| Bifold, 3 panels | £2,950 | £3,500 – £5,000 | £5,990 – £8,000 |

The spread *within* each installer is the discount ladder — the same product,
the same house, a different number depending on how hard somebody haggles on
the night. The spread *between* them is where the two firms sit in the market.

Together they are the reason the estimate has to be a range with the reason
attached, and the reason the page says the number here does not move on how
hard you push.

## The VAT basis — settled 2026-08-04

The figures in the table above were given **inclusive of VAT**. The catalogue
stores net and adds 20% at the end, and the door prices had been entered at
their inclusive value, so every door was being shown 20% over what it
actually settles at:

| | was stored | is stored | shown to a homeowner |
|---|---|---|---|
| Composite front door | £2,000 | £1,667 | £2,000 |
| Bifold, 3 panels | £4,000 | £3,333 | £4,000 |

The `source` field had claimed these were already "converted to net". They
were not. That is the more useful lesson than the arithmetic: a note saying a
conversion happened is not evidence it happened, and the only check that
means anything is pricing one unit through the endpoint and reading the
number a homeowner would see.

The window bands are on **no stated VAT basis at all** — they are invented
figures that have never corresponded to a real quote either way. When the
four real band prices arrive, take them inclusive, divide by 1.2, and store
that.

## Still to confirm
- **Where do most settle?** The ends are the anchor and the floor. The
  estimate should centre where the bulk of jobs land.
- **Composite door spec** — standard door only, or including a side panel or
  glazed screen? Those are different animals and should not share a band.
- The four window size bands, on the same terms.
- Whether the gap between the two installers holds across all sizes or widens
  on the larger units.
