/* Is this before-and-after usable?
 *
 * Three pairs failed three different ways in one day, and every one was found
 * by looking rather than by anything that would have stopped it:
 *
 *   - terrace-before.jpg had "118, Dysons R..." legible on the neighbour's
 *     wall. Not merely recognisable, addressable, on a public marketing page.
 *   - a generated Victorian terrace was two different houses: a street lamp in
 *     the after that is absent from the before, the neighbour's window at a
 *     different height, a different brick bond. The slider says "drag to
 *     compare before and after" of one home; it was two.
 *   - eight photographs whose provenance nobody can substantiate, under a
 *     badge reading "Photographs, not renders".
 *
 * This checks what a machine can check, and says plainly what it cannot.
 *
 *   node scripts/check-gallery-pair.js before.jpg after.jpg [--out diff.png]
 *
 * The interesting test is the third one. If a pair is one house shown twice —
 * photographed twice from the same spot, or one image edited — then the parts
 * that did NOT change should largely cancel when you subtract them. Brick
 * courses, rooflines, neighbours, kerbs. What survives should be the work:
 * frames, doors, walls. When the difference map instead renders a complete
 * building, the two images share almost nothing, and that is two houses.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outPath = outAt >= 0 ? args[outAt + 1] : null;
/* -1 when there is no --out, and `i !== outAt + 1` then reads as `i !== 0`,
   which quietly ate the first filename and printed the usage line. */
const skipAt = outAt >= 0 ? outAt + 1 : -1;
const [beforePath, afterPath] = args.filter((a, i) => !a.startsWith('--') && i !== skipAt);

if (!beforePath || !afterPath) {
  console.error('usage: node scripts/check-gallery-pair.js before.jpg after.jpg [--out diff.png]');
  process.exit(2);
}

/* Pillow rather than a node image library, because it is already on this
   machine and the alternative is adding a dependency to a repo that has
   deliberately few. If python3 or Pillow is missing this says so and stops,
   rather than half-checking and reporting a pass. */
const PY = `
import sys, json
try:
    from PIL import Image, ImageChops, ImageFilter
except Exception as e:
    print(json.dumps({"error": "Pillow is not available: " + str(e)})); sys.exit(0)

before, after, out = sys.argv[1], sys.argv[2], (sys.argv[3] or None)
a = Image.open(before).convert("RGB")
b = Image.open(after).convert("RGB")

res = {"before": {"size": a.size}, "after": {"size": b.size}}

if a.size != b.size:
    res["sameSize"] = False
    print(json.dumps(res)); sys.exit(0)
res["sameSize"] = True

w, h = a.size
diff = ImageChops.difference(a, b).convert("L")

# How much of the frame changed at all, and how much changed a lot.
px = list(diff.getdata()); n = len(px)
res["unchangedPct"] = round(100.0 * sum(1 for v in px if v <= 8) / n, 1)
res["heavilyChangedPct"] = round(100.0 * sum(1 for v in px if v > 60) / n, 1)

# Where the change is. One house re-finished changes in patches — the frames,
# the door, the walls. Two different houses differ everywhere at once, so the
# change is spread evenly across the frame rather than concentrated.
cells, spread = [], 6
for gy in range(spread):
    for gx in range(spread):
        box = (gx * w // spread, gy * h // spread, (gx + 1) * w // spread, (gy + 1) * h // spread)
        cell = list(diff.crop(box).getdata())
        cells.append(sum(cell) / max(1, len(cell)))
cells.sort()
lo, hi = cells[0], cells[-1]
res["quietestCell"] = round(lo, 1)
res["busiestCell"] = round(hi, 1)
# A pair with somewhere genuinely untouched has a quiet cell. Two houses do not.

if out:
    diff.point(lambda v: min(255, v * 4)).save(out)
    res["diffWritten"] = out

print(json.dumps(res))
`;

let report;
try {
  const raw = execFileSync('python3', ['-c', PY, beforePath, afterPath, outPath || ''], { encoding: 'utf8' });
  report = JSON.parse(raw);
} catch (err) {
  console.error('Could not run the image check:', err.message);
  process.exit(2);
}

if (report.error) {
  console.error(report.error);
  process.exit(2);
}

const name = (p) => path.basename(p);
const fail = [];
const warn = [];

console.log(`\n  ${name(beforePath)}  →  ${name(afterPath)}\n`);

if (!report.sameSize) {
  fail.push(`different dimensions — ${report.before.size.join('×')} against ${report.after.size.join('×')}. The slider overlays them, so they must match.`);
} else {
  console.log(`  size                 ${report.before.size.join('×')}`);
  console.log(`  unchanged pixels     ${report.unchangedPct}%`);
  console.log(`  heavily changed      ${report.heavilyChangedPct}%`);
  console.log(`  quietest sixth       ${report.quietestCell}  (low means somewhere genuinely untouched)`);
  console.log(`  busiest sixth        ${report.busiestCell}`);
  if (report.diffWritten) console.log(`  difference map       ${report.diffWritten}`);
  console.log('');

  /* Calibrated against every pair whose answer was already known, rather than
     guessed. Quietest-sixth score, and what each pair actually is:

       tile-hung, real job, same photo re-finished     1.8
       hero bay semi, real job                         2.6
       newbuild, real job                              7.8
       semi, GENERATED, verified same house           13.3
       terrace, GENERATED, verifiably two houses      17.7

     So the measure separates "one photograph, re-finished" from "regenerated
     imagery" cleanly — under 8 against over 13. What it does NOT do is
     separate a good regenerated pair from a bad one: 13.3 against 17.7, on a
     sample of two. Both redraw every pixel, so both lose the untouched region
     this test looks for.

     The first draft refused at 12, which failed the verified-good semi pair
     and would have refused it confidently. A checker that says REFUSED when it
     means "I cannot tell" is worse than no checker, because somebody believes
     it. So: pass what is provably fine, and hand back the cases only a person
     can settle, saying which is which. */
  if (report.quietestCell >= 8) {
    warn.push(`nothing in this frame is untouched (quietest sixth ${report.quietestCell}; a photograph re-finished scores under 8). That means one of two things and this cannot tell them apart: either the images were generated, which redraws every pixel even when it is the same house — or they are two different houses. Open the difference map. If it draws a complete building rather than picking out the work, look hard at the roofline, the neighbours' windows and any street furniture. A street lamp appearing in the "after" is how the last one was caught.`);
  }
  if (report.heavilyChangedPct > 45) {
    warn.push(`${report.heavilyChangedPct}% of the frame changed heavily. That is a lot for a re-finish — check the camera has not moved.`);
  }
  if (report.heavilyChangedPct < 1.5) {
    warn.push(`only ${report.heavilyChangedPct}% changed heavily. Check the "after" actually shows the work.`);
  }
}

for (const f of [beforePath, afterPath]) {
  const kb = Math.round(fs.statSync(f).size / 1024);
  if (kb > 400) warn.push(`${name(f)} is ${kb} KB — the gallery renders at about 500 px wide, so this is heavier than it needs to be.`);
}

if (fail.length) {
  console.log('  REFUSED');
  fail.forEach(f => console.log(`    - ${f}`));
} else {
  console.log('  No machine-detectable problem.');
}
if (warn.length) {
  console.log('\n  Worth a look');
  warn.forEach(w => console.log(`    - ${w}`));
}

/* The three questions no script can answer, printed every time, because a
   clean pass on the measurable half reads as a clean pass on all of it. */
console.log(`
  Still yours to answer — assets/work/PROVENANCE.md

    1. Is it a real job, or generated? If generated, it cannot sit under
       "Photographs, not renders" and the badge, heading, body copy and alt
       text all have to change with it.
    2. Is anything in the frame identifying? Open both at full size and look
       for a house number, a street sign, a number plate. "118, Dysons R..."
       was legible and nobody noticed for weeks.
    3. Do you have the homeowner's permission, in writing, recorded in
       PROVENANCE.md?
`);

process.exit(fail.length ? 1 : 0);
