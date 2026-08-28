/* What is still unfilled in the legal pages, and where.
 *
 *   npm run check-legal
 *
 * There is already a guard on this, in server.js: on a deployment with
 * LEAD_CAPTURE on, an unfinished privacy notice refuses to start the process,
 * because the alternative is collecting personal data behind a notice that
 * names nobody as the controller. That guard works — LEAD_CAPTURE is off on
 * the live site today and /api/lead answers 503 without parsing the body, so
 * no homeowner's details are being taken behind these placeholders.
 *
 * What the guard does not do is say what is left. It counts, and a count of
 * fourteen tells you the job is unfinished without telling you it is really
 * five decisions — the company, the email, the phone, the region and the
 * complaints route — repeated across thirty-nine places. That difference is
 * the difference between a task somebody starts this afternoon and a task that
 * looks like a fortnight.
 *
 * So this is the reporting half of the same guard, deliberately using the same
 * pattern rather than a second one. test/placeholder-guard.test.js pins that
 * they stay identical; two bracket-matching regexes that drift apart is how
 * six real placeholders became invisible to the last one.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* Anchored on the brackets, not on an enumeration of the characters inside
   them, and with no upper bound on the length. Kept byte-identical to
   server.js — see the note above, and the test that holds the two together.

   The 200-character cap came off on 28 August 2026: two placeholders in
   terms.html were longer than that and invisible to all three counters, one
   of them a drafting instruction to list the installer vetting checks, which
   is a claim about the service printed on a public page. */
const PLACEHOLDER = /\[[A-Z][^\]]{2,}\]/g;

/* The legal pages are the ones that gate a deployment. The investor page is
   here too because it also carries placeholders — an exemption being relied on
   and an FCA risk warning — and while it is refused at the door rather than at
   startup, it is still unfinished and still worth listing in one place. */
const PAGES = ['legal/privacy.html', 'legal/terms.html', 'gated/investors.html'];

function scan(pages = PAGES) {
  const found = [];
  for (const page of pages) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, page), 'utf8'); }
    catch (_) { continue; }
    text.split('\n').forEach((line, i) => {
      for (const match of line.match(PLACEHOLDER) || []) {
        found.push({ page, line: i + 1, token: match });
      }
    });
  }
  return found;
}

/* Exported before anything is printed, and the report only runs when this is
   the entry point — a module that calls process.exit() on require takes the
   test suite down with it. */
module.exports = { scan, PAGES, PLACEHOLDER, ROOT };

if (require.main === module) {
  const found = scan();

  if (!found.length) {
    console.log('\n  No placeholders left.\n');
    process.exit(0);
  }

  const byToken = new Map();
  for (const f of found) {
    if (!byToken.has(f.token)) byToken.set(f.token, []);
    byToken.get(f.token).push(`${f.page}:${f.line}`);
  }

  const label = (t) => (t.length > 46 ? t.slice(0, 43) + '…' : t);

  console.log(`\n  ${byToken.size} distinct placeholder${byToken.size === 1 ? '' : 's'}, in ${found.length} place${found.length === 1 ? '' : 's'}.\n`);
  for (const [token, places] of [...byToken].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${label(token).padEnd(48)} ${places.length}×`);
    /* One line can hold the same token twice — a mailto: and the text of the
       link — and printing the same reference twice reads as two jobs. */
    [...new Set(places)].forEach(p => console.log(`      ${p}`));
  }

  console.log(`
  Not one of these can be filled in from the code. They are facts about the
  business, and they fall into four groups: who the entity is (name, number,
  registered address), how to reach it (privacy email, contact email, phone,
  complaints address and form), where the data sits (Railway region, transfer
  mechanism, whether a CRM is used at all), and the two on the investor page
  that want a solicitor rather than a decision.

  Nothing unlawful is happening in the meantime. LEAD_CAPTURE is off, so no
  details are taken behind the notice, and server.js refuses to start on a
  deployment if anybody turns it on while this list is non-empty. That is the
  gate; this is the list.
`);

  process.exit(1);
}
