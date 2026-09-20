# The window count, and what it is multiplied by

**Raised 20 September 2026**, fixing the 19 September journey review's item #4
(bays split into panes) and finding that item #5 (the tool priced two to three
times the cost pages) was mostly the same bug.

## What was wrong

`/api/detect` is asked for "any window", and it obliges:

- **Sidelights.** The glazed panels either side of a front door came back typed
  `window`. Five windows became seven.
- **Bay facets.** A three-facet curved bay came back as three boxes, a
  five-facet bay as five. Two bays became six, eight or ten depending on the
  run.

Neither is caught by IoU dedupe. Sidelights overlap nothing, and facets sit
edge to edge rather than on top of one another.

Then the front count is multiplied by `FRONT_TO_TOTAL_WINDOWS` — 2.6 for a
semi, 3.0 for a detached — so every phantom window on the front became roughly
three in the price.

## What it cost

The review's own measurements, against the cost pages built from the same
engine:

| House | Cost page | Tool, before |
|---|---|---|
| Semi | 8 windows, £7,054 – £10,150 | 18 windows, **£20,552 – £37,366** |
| Detached | 12 windows, £10,196 – £14,672 | 21 windows, **£23,839 – £43,344** |
| Bay-fronted semi | 8 windows, £7,054 – £10,150 | 21 windows, **£18,557 – £33,739** |

After dropping sidelights and merging bays:

| House | Cost page | Tool, after |
|---|---|---|
| Semi | 8 windows, £7,054 – £10,150 | 13 windows, **£9,521 – £15,533** |
| Detached | 12 windows, £10,147 – £14,601 | 15 windows, **£10,876 – £17,744** |

Roughly 2.9–3.7× becomes 1.35–1.53×, and 2.3–3.0× becomes 1.07–1.22×. Most of
the gap the review reported was the count, not the rates.

## How bays are now told apart from separate windows

By geometry, not by label. The first attempt matched labels containing "Pane"
with a `" - "` separator, which is what the model produced on 19 September. On
20 September the same photograph came back as *"Upper Bay Window Left Angled"*,
*"Upper Bay Window 2"*, *"Upper Bay Window Center"* — and the bay counted as
five windows again. Labels are model prose and they vary run to run.

Measured off both of this site's own photographs:

| | horizontal gap |
|---|---|
| Bay facets | **0.0** — they share an edge exactly |
| Separate windows | **7, 16, 31** |

Nothing observed sits between. The threshold is 2% of frame width, with
vertical overlap required so an upper bay never merges with the lower one
beneath it, and merging is transitive so five facets collapse to one unit
rather than two. Duplicate removal runs first, because a duplicate overlaps
heavily and a facet does not — merging first let the join swallow duplicates
and stopped `discarded.duplicates` reporting them.

## The open question, which is not mine to answer

**`FRONT_TO_TOTAL_WINDOWS` was calibrated against an inflated count.**

glazing.js says so itself: *"derived from plan form rather than fitted to
data, and flagged accordingly."* It was chosen while a bay counted as three or
five. Now that a bay counts as one, it is multiplying a different quantity.

The clearest evidence is `test/fixtures/no-door-bay.detections.json`, a real
detached house whose front shows two curved bays and nothing else:

| | front | whole house | estimate |
|---|---|---|---|
| Counted as facets (before) | 6 | 18 | £12,909 – £21,061 |
| Counted as windows (now) | 2 | 6 | £4,777 – £7,795 |
| House-type prior, no photo | — | 11 | £7,994 – £14,846 |

Counting correctly now lands **below** the guess. Both cannot be right, and
the count is not the thing that is wrong — two bays are two windows.

Three possibilities, and picking between them needs real houses rather than
more reasoning:

1. **The multiplier is too low for bay-fronted houses.** A front showing two
   bays is unusual precisely because bays are wide; such a house often has
   fewer front openings and a normal number everywhere else. 3.0 may want to
   be higher when the front count is small.
2. **The front count is genuinely incomplete.** This photograph was taken
   mid-build with no front door in shot; a landing window or a porch light may
   simply not have been detected. That is a detection problem, not a scaling
   one.
3. **The prior is too high.** Eleven windows for a detached is itself an
   unsourced figure.

**What would settle it:** for six real houses, the window count an installer
quoted against the count this site reads off the front. The same six
properties already needed for the wall-measurement bands and the roof-area
ratio — one visit answers all three.

Until then the count is right, the multiplier is published on screen and in
`estimateGlazing`'s output, and the homeowner can correct the number directly
("We counted 13. Not right?"), which is the honest position: the arithmetic is
checkable and the person who can see the house has the final say.

**Do not quietly retune the multiplier to make the numbers match the cost
pages.** The cost pages assume 8 and 12 windows, which are themselves typical
figures rather than measurements — matching them would be fitting one guess to
another and calling it agreement.

Related: [`roof-area-needs-a-source.md`](roof-area-needs-a-source.md), and the
plausibility bands in `measure.js`, unsourced in the same way.

---

# The neighbour's roof still changes

**Separate finding, 20 September 2026**, from verifying the same branch.

The 19 September review reported that choosing a roof turned the neighbouring
house's roof too. A fix was written — name the subject house, hold "every
neighbouring or attached house" — and it was never tested against the live
model, because that branch had no API access.

Tested now, on `assets/work/newbuild-before.jpg`, measuring mean red-minus-blue
in each region before and after (higher = more terracotta):

| Prompt strategy | main roof | left neighbour | **right neighbour** |
|---|---|---|---|
| Name the subject, hold neighbours in the list | −18 → 74 | −42 → −35 | **−2 → 90** |
| Name the frame edges inside the roof sentence | −18 → 69 | −42 → −36 | **−2 → 84** |
| State the scope first, before any instruction | −18 → 61 | −42 → −35 | **−2 → 71** |

The subject's roof and porch change correctly every time, the brick control
never moves, and the left-hand neighbour is held every time. The right-hand
one is not.

The asymmetry is the clue and it is also why this is probably not fixable with
words. The left neighbour sits fully inside the frame with sky above it. The
right one runs off the edge, so its roof plane reads as a continuation of the
subject's roofline, and FLUX Kontext edits regions rather than objects.

Three strategies, monotonic improvement (90 → 84 → 71), no resolution. The
scope-first wording is kept because it is the best of the three and is good
protection generally, but **the defect is open**.

What would actually fix it needs something other than a prompt:

- **A mask.** The detections already say where this house's roof is. The
  flux-kontext-pro endpoint takes no mask input — the whole schema is prompt,
  input_image, aspect_ratio, seed, safety_tolerance, prompt_upsampling and
  output_format — so this means a different model or an extra compositing step
  that pastes the untouched original back outside the subject's bounding box.
- **Compositing.** Cheap and reliable: re-paste the original pixels outside the
  subject house's box after the render returns. Risks a visible seam, and the
  box would have to be generous.

Both are real work and a product decision. Until then a homeowner sometimes
sees their neighbour's roof re-tiled alongside their own — cosmetically wrong,
no effect on the price, and not something the estimate claims.
