/* ─────────────────────────────────────────────────────────────────────────
   Withdrawing consent.

   The privacy notice makes four promises, and this file exists to make all
   four true rather than aspirational:

     "you can change your mind about either at any time by ... using the link
      in any email we send you"          -> a working link, not a mailto:
     "withdrawing is as easy as agreeing was"   (Article 7(3))
     "we will tell the installer you have withdrawn"  (Article 19)
     "we will tell you which installers received your details"

   Three things worth being careful about, all reflected below.

   The token is stored hashed. It arrives in an email and it is the only
   credential on the withdrawal page, so the raw value lives in the email and
   nowhere else. Storing it in the clear would mean anyone who could read the
   leads store — including the installer portal — could withdraw on a
   homeowner's behalf or trigger the erasure branch.

   Withdrawal is never a GET. Outlook Safe Links, Gmail's image proxy and
   every corporate mail scanner fetch the URLs in an email before a human
   sees them; a GET that erased someone's record would fire on delivery. So
   the link opens a page, and the page posts.

   Each consent is withdrawn separately, because each was given separately.
   Bundling them back together at the exit would undo the point of splitting
   them at the entrance.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const crypto = require('crypto');

const SCOPES = {
  // What the homeowner is choosing, and what each choice actually does.
  installerQuotes: {
    label: 'Stop sharing my details with installers',
    tellRecipients: true,
    askRecipientsToErase: false,
  },
  emailPack: {
    label: 'Stop emailing me about my design',
    tellRecipients: false,
    askRecipientsToErase: false,
  },
  all: {
    label: 'Delete everything you hold about me',
    tellRecipients: true,
    askRecipientsToErase: true,
  },
};

const isScope = (s) => Object.prototype.hasOwnProperty.call(SCOPES, s);

/* A token for the link, and the hash we keep. The raw value is returned once
   and must go straight into the email — it is not recoverable afterwards. */
function newToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  return { token, hash: hashToken(token) };
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

/* Find the lead a token belongs to, without leaking which tokens exist
   through timing. Every candidate is compared; the loop does not exit early. */
function findByToken(leads, token) {
  const wanted = Buffer.from(hashToken(token), 'utf8');
  let found = null;
  for (const lead of leads || []) {
    const stored = lead?.withdrawTokenHash;
    if (typeof stored !== 'string' || stored.length !== wanted.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(stored, 'utf8'), wanted)) found = lead;
  }
  // A token on an already-erased record is spent — there is nothing left to
  // withdraw, and honouring it would only confirm the record existed.
  return found && !found.redacted ? found : null;
}

/* Apply a withdrawal to a lead, returning a new lead rather than mutating.

   'all' hands off to retention.redactLead so that erasure here and erasure on
   schedule cannot drift apart: one definition of what survives, which is the
   evidence of what was agreed and now of what was withdrawn. */
function applyWithdrawal(lead, scope, { now = new Date().toISOString(), ipHash = null, redactLead } = {}) {
  if (!isScope(scope)) throw new Error(`unknown withdrawal scope: ${scope}`);

  const entry = { at: now, scope, ipHash: ipHash || null };
  const history = [...(lead.withdrawals || []), entry];

  if (scope === 'all') {
    if (typeof redactLead !== 'function') throw new Error('applyWithdrawal: redactLead is required for scope "all"');
    const redacted = redactLead(lead);
    return {
      ...redacted,
      withdrawals: history,
      withdrawnAt: now,
      // Spent: the record it pointed at no longer holds anything personal.
      withdrawTokenHash: null,
      consent: { ...(lead.consent || {}), installerQuotes: false, emailPack: false, withdrawnAt: now },
    };
  }

  return {
    ...lead,
    withdrawals: history,
    withdrawnAt: now,
    consent: { ...(lead.consent || {}), [scope]: false, withdrawnAt: now },
  };
}

/* Which installers actually received this lead — the ones we owe an Article 19
   notification, and the ones we promised to be able to name on request.

   Read from the delivery log rather than from the recipient configuration,
   because those are different questions: the configuration is who we would
   send to today, the log is who holds their details. A buyer removed from the
   configuration last month still has the data. */
function recipientsWhoReceived(deliveries, leadId) {
  const seen = new Map();
  for (const row of deliveries || []) {
    if (row?.leadId !== leadId) continue;
    for (const r of row.results || []) {
      if (r?.ok && r.id && !seen.has(r.id)) seen.set(r.id, { id: r.id, name: r.name || r.id, at: r.at || row.ts });
    }
  }
  return [...seen.values()];
}

/* What we send them. Deliberately minimal: they already hold the lead, so
   this identifies it and says what has changed — repeating the personal data
   in a withdrawal notice would be an odd way to honour one. */
function withdrawalPayload(leadId, scope, at = new Date().toISOString()) {
  const rule = SCOPES[scope];
  return {
    type: 'consent_withdrawn',
    leadId,
    at,
    scope,
    erasureRequested: rule.askRecipientsToErase,
    message: rule.askRecipientsToErase
      ? 'The homeowner has withdrawn consent and asked that their details be erased. Please delete this lead from your systems and confirm.'
      : 'The homeowner has withdrawn consent for us to share their details. Please do not contact them further on the basis of this enquiry.',
  };
}

module.exports = {
  SCOPES, isScope, newToken, hashToken, findByToken, applyWithdrawal,
  recipientsWhoReceived, withdrawalPayload,
};
