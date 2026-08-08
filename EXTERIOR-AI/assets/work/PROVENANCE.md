# Gallery provenance — NOT YET COMPLETED

The homepage says, of these eight photographs:

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

## Fill this in

| File | Real job? | Address or job ref | Date | Work carried out | Photographer | Homeowner permission held |
|---|---|---|---|---|---|---|
| `hero-before.jpg` | UNKNOWN | | | | | UNKNOWN |
| `hero-after.jpg` | UNKNOWN | | | | | UNKNOWN |
| `terrace-before.jpg` | UNKNOWN | | | | | UNKNOWN |
| `terrace-after.jpg` | UNKNOWN | | | | | UNKNOWN |
| `newbuild-before.jpg` | UNKNOWN | | | | | UNKNOWN |
| `newbuild-after.jpg` | UNKNOWN | | | | | UNKNOWN |
| `tilehung-before.jpg` | UNKNOWN | | | | | UNKNOWN |
| `tilehung-after.jpg` | UNKNOWN | | | | | UNKNOWN |

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
