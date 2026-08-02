#!/usr/bin/env node
/* Are any two leads sharing a reference?

   References used to be four random digits from a pool of nine thousand,
   allocated without checking. That is a coin flip at 112 leads. lead.id is the
   join key for withdrawal, retention, the erasure purge and the Article 19
   notice, so a duplicate is not a cosmetic clash: one homeowner asking to be
   erased takes the other's record with them, consent evidence included.

   New references carry 60 bits of entropy and the database refuses a
   duplicate. Neither helps with records captured before that, which is what
   this is for.

   Read-only. It changes nothing and tells you what to look at.

     node scripts/check-lead-ids.js

   Reads DATABASE_URL if set, otherwise data/leads.jsonl — the same rule the
   application follows, so it looks where the leads actually are. */

'use strict';

const store = require('../store');

const OLD_FORMAT = /^LD-\d{4}$/;

(async () => {
  let leads;
  try {
    leads = await store.readAll('leads');
  } catch (err) {
    console.error('Could not read the leads store:', err.message);
    process.exit(2);
  }

  console.log(`Storage: ${store.hasDb ? 'Postgres' : 'data/leads.jsonl'}`);
  console.log(`Leads:   ${leads.length}`);

  const byId = new Map();
  let missing = 0;
  for (const lead of leads) {
    if (!lead?.id) { missing++; continue; }
    if (!byId.has(lead.id)) byId.set(lead.id, []);
    byId.get(lead.id).push(lead);
  }

  const oldFormat = [...byId.keys()].filter(id => OLD_FORMAT.test(id));
  const duplicates = [...byId.entries()].filter(([, group]) => group.length > 1);

  if (missing) console.log(`Leads with no reference at all: ${missing}`);
  if (oldFormat.length) {
    console.log(`\nOld four-digit references: ${oldFormat.length}`);
    console.log('These stay as they are — they still identify their own record. They are');
    console.log('only a risk in the sense that two of them may already be the same.');
  }

  if (!duplicates.length) {
    console.log('\nNo duplicate references. Safe to apply the unique index.');
    process.exit(0);
  }

  console.log(`\nDUPLICATE REFERENCES: ${duplicates.length}\n`);
  console.log('Each of these is shared by more than one person. Until they are given');
  console.log('distinct references, a withdrawal or a retention run on one will act on');
  console.log('the others as well.\n');

  for (const [id, group] of duplicates) {
    console.log(`  ${id} — ${group.length} records`);
    for (const lead of group) {
      // Enough to tell them apart and no more: this prints to a terminal and
      // may end up in a scrollback buffer or a support ticket.
      const who = lead.redacted ? '(redacted)' : `${String(lead.name || '?').slice(0, 1)}… ${maskEmail(lead.email)}`;
      console.log(`      ${lead.ts || 'undated'}  ${who}  ${lead.consent?.installerQuotes ? 'shared with installers' : 'not shared'}`);
    }
  }

  console.log('\nWhat to do: give every record after the first in each group a new');
  console.log('reference, then re-run this. If any of them were shared with installers,');
  console.log('the installers hold the old reference — tell them the new one.');
  process.exit(1);
})();

function maskEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  return at > 0 ? `${value[0]}…${value.slice(at)}` : '(none)';
}
