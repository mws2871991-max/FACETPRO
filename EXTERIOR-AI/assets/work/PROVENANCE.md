# Gallery provenance — NOT YET COMPLETED

The homepage says, of these six photographs:

> **Real homes. Real work. No showroom.**
> Photographs, not renders.

That is an objective claim about goods and services in an advertisement. Under
the CAP Code and the Consumer Protection from Unfair Trading Regulations it has
to be substantiable **before** it is published, on request, without a delay to
go and find out. `assets/swatches/CREDITS.md` does this properly for the swatch
photographs; this file is the same job for the gallery, and it is not done.

The files carry no EXIF and no origin markers — they have been stripped — so
the provenance cannot be recovered from the images. It has to come from whoever
put them there.

## The homepage pair: `home-windows-white*.jpg` / `home-windows-black*.jpg` (29 September 2026)

Chosen by Mike as the main before/after on the homepage, replacing the detached pair below (which stays on /how-we-price).

| File | What it is | Source |
|---|---|---|
| `home-windows-white.jpg` (1200×900), `-sm.jpg` (600×450) | **AI-generated illustration.** Not a customer's house, not a Facet Pro render. Captioned "Illustration"; alt text starts "Illustration:". | Left half of `before_after_windows.webp` (3840×1280, Mike's Downloads, 28 Sep 2026), crop (387,130)–(1920,1280), label cropped out, lightly sharpened |
| `home-windows-black.jpg`, `-sm.jpg` | **AI-generated illustration**, same as above. Every pixel is redrawn, not just the frames, and the stone sills went black too. | Right half, same crop |

Never caption this pair as a real job or as something Facet Pro made, and never put it in Real Homes.

## The homepage pair: `detached-before*.jpg` / `detached-after*.jpg` (28 September 2026)

Not in the "Real homes" gallery, and not claimed to be a real job.

| File | What it is | Source |
|---|---|---|
| `detached-before.jpg`, `-sm.jpg` | **An illustration**, not a customer's house. Captioned "An example house". | `dilapidated_house_before_renovation.webp` (Mike's Downloads, 13 Aug 2026), resized to 1248×832, centre-cropped 4:3 |
| `detached-after.jpg`, `-sm.jpg` | **A real Facet Pro render** of the file above, made on the live site on 28 Sep 2026: Detached, Casement, Anthracite, plain glass, door and roofline kept. Nothing retouched. | Render `74bbd507068ff41685c4feb5dab70afe` (1248×832), same crop |

It replaced `semi-before-sm.jpg` / `semi-after-sm.jpg` on the page. That "after" was a staged picture (new block-paved drive, planting, a red door, a clean roofline) that Facet Pro cannot produce. Those two files stay in the tree because tests and the render prompt refer to them as a detection fixture; they are no longer shown to visitors.

## Before adding a pair

    npm run check-pair before.jpg after.jpg -- --out /tmp/diff.png

It checks what a machine can: matching dimensions, that something actually
changed, and whether any part of the frame is untouched. That last number is
the useful one, calibrated against the pairs already here — a photograph
re-finished scores under 8, generated imagery scores over 13, because
generating redraws every pixel even when it is the same house.

It cannot tell a good generated pair from a bad one, and says so rather than
guessing. The three questions below are still yours.

## What the machine could settle — 29 September 2026

`scripts/check-gallery-pair.js` was run on all three pairs. The calibrated
number is the quietest sixth: low means somewhere in the frame is genuinely
untouched, which generated imagery never manages because it redraws every
pixel even when it is the same house. A photograph re-finished scores under 8;
generated scores over 13.

| Pair | Unchanged pixels | Quietest sixth | Verdict |
|---|---|---|---|
| hero | 42.6% | **2.6** | reads as a photograph |
| newbuild | 44.0% | **7.8** | reads as a photograph |
| tilehung | 40.3% | **1.8** | reads as a photograph |

All three: "No machine-detectable problem." So **"Photographs, not renders"
is substantiable** and stays on the page.

**What this does NOT settle, and the page no longer claims:** whose job each
one was. The caption said "Every photograph here is a job this team has done"
— an objective claim about services, with UNKNOWN against every row below it.
It now reads "Every picture here is a photograph of a real house, before and
after — not a render, and not a showroom", which is exactly what the table
above supports and no more.

Answer the two columns below and the stronger claim can come back.

## Fill this in

| File | Real job? | Address or job ref | Date | Work carried out | Photographer | Homeowner permission held |
|---|---|---|---|---|---|---|
| `hero-before.jpg` | UNKNOWN | | | | | UNKNOWN |
| `hero-after.jpg` | UNKNOWN | | | | | UNKNOWN |
| `newbuild-before.jpg` | UNKNOWN | | | | | UNKNOWN |
| `newbuild-after.jpg` | UNKNOWN | | | | | UNKNOWN |
| `tilehung-before.jpg` | UNKNOWN | | | | | UNKNOWN |
| `tilehung-after.jpg` | UNKNOWN | | | | | UNKNOWN |

## Rejected: the generated Victorian terrace pair

`terrace-vis-before.jpg` and `terrace-vis-after.jpg` were split out of a wide
composite and put into the gallery, then taken straight back out and deleted.
They were never committed — a rejected asset sitting in the tree is an
invitation to wire it back in. This note is the record instead. The source
composite is `victorian_terrace_before_after.webp`, outside the repository.

They are not the same house. The "after" has a Victorian street lamp standing
at the kerb that does not exist in the "before"; the neighbouring property's
window sits at a different height and its brickwork is a different bond
entirely. A difference map of the two renders a complete building rather than
cancelling to black, which is what two views of one house would do.

That is the second question in this file — *is the "after" the same house as
the "before"?* — answered no. A slider captioned "drag to compare before and
after" showing two different buildings is a misleading comparison whether or
not it is labelled a visualisation, so labelling would not have rescued it.

Contrast the hero pair below, which passes the same test: the neighbouring
house, fence, railings and wheelie bins hold their positions between the two
images, down to the stickers on the bins.

## The hero pair is a visualisation, not a photograph

`semi-before-sm.jpg` and `semi-after-sm.jpg` — the pair at the top of the page —
are generated images, not photographs of a job. They came from
`dilapidated_house_before_renovation.webp` and
`renovated_semi_detached_house.webp`, cropped to the 4:3 hero box.

They are therefore **deliberately excluded from the "Photographs, not renders"
claim**, which applies to the gallery below and to those eight files only. The
hero caption was changed at the same time these went in: it used to read *"A
real job by the team behind Facet Pro — photographs, not renders"* and now
reads *"A visualisation of the finishes you can choose."* If these images are
ever moved into the gallery, that claim starts covering them and stops being
true — move the wording with them.

The after also shows a new block-paved drive and planting. Driveways and
landscaping are on the roadmap and are not priced, so the caption says so
rather than letting the picture imply an estimate covers it. This was a
deliberate decision to keep the landscaping in the image.

## The Victorian terrace pair has been removed entirely

`terrace-before.jpg` carried a house-number plaque on the neighbouring wall,
lower right, reading **118, Dysons R…** — legible at the full resolution the
site serves publicly. That made the property addressable rather than merely
recognisable, which is a different and worse thing to publish without the
homeowner's permission.

It was first cropped, 900×1200 → 816×1088, to put the plaque out of frame. Then
both files were deleted and the card taken off the page, which settles it
properly: an unanswered permission question on an identifiable, addressable
house is not something to leave live while the question waits. Cropping removed
the address; it did not establish who said yes. Removal does not need anyone to.

Both files remain in git history if permission is later obtained.

The other three pairs were checked for the same thing at the same time. `hero`
and `tilehung` carry no number, street sign or plate. `newbuild` has a house-
name plaque beside the door that is illegible even magnified eight times. Their
permission question is still open — see the table above — but none of them
hands a reader the address.

The gallery is three pairs now, so its pager is hidden: one page of cards does
not need a dot and two dead arrows. Adding a fourth home brings it back.

## Derived files

`hero-before-sm.jpg` and `hero-after-sm.jpg` are not separate photographs and
need no separate answers. They are the hero pair resized to 600×450 and centre
-cropped to the 4:3 box the page already displayed them in — the same crop the
browser was performing at render time with `object-fit: cover`, done once in
advance instead of on every visit. Nothing was retouched, recoloured or
composited. Whatever the rows above turn out to say about `hero-before.jpg` and
`hero-after.jpg` applies unchanged to these two, and if the originals cannot be
substantiated these come down with them.

## The three answers that matter

**Are they real jobs?** If any pair is stock photography, an AI render, or a
mock-up, the sentence on the homepage is false as to that pair and has to
change. "Photographs, not renders" is the specific claim, and an "after" that
was generated rather than photographed contradicts it exactly.

**Is the "after" the same house as the "before"?** The alt text says it is —
*"The same home before, with white frames"*. Two different houses presented as
one home before and after would be a misleading comparison regardless of both
being real.

**Do you have the homeowner's permission?** A house is identifiable, and these
are on a public marketing page. Permission should be in writing and recorded
here. This is the same question that stopped a real customer photograph going
into the repository on 7 August — see `test/fixtures/README.md`.

## If they cannot be substantiated

Change the wording rather than keep the photographs. "Examples of the finishes
you can choose" makes no claim about provenance and needs none. The current
sentence is doing real persuasive work — which is exactly why it has to be
true.

The server prints a warning at startup while this file still says UNKNOWN.
