/* ─────────────────────────────────────────────────────────────────────────
   Lead delivery to multiple buyers.

   Each lead goes to several companies and each pays per lead, so a delivery
   that silently fails is money gone with nothing to show for it. That changes
   what this code has to do compared with a fire-and-forget webhook:

   - every attempt is recorded, successful or not, because the record is the
     billing evidence
   - a failure is retried, and a permanent failure is written somewhere a human
     will look rather than to a console line
   - one buyer being down must not stop the others receiving the lead
   - recipient URLs can carry tokens, so they never appear in a response or a
     log line

   Pure-ish: takes a fetch implementation so it can be tested without network.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const routing = require('./routing');
const installers = require('./installers');

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 10000;
// Between attempts. Short — the homeowner has already been told we're done,
// but a buyer's transient blip shouldn't need a manual re-send.
const BACKOFF_MS = [1000, 3000];

/* Recipients come from LEAD_RECIPIENTS as JSON:

     [{"id":"anglian","name":"Anglian","url":"https://...","headers":{...}}]

   JSON rather than numbered variables because the list changes as contracts
   change, and one variable is harder to half-update than six. A malformed
   value is refused loudly rather than silently delivering to nobody. */
function parseRecipients(raw, { legacyUrl } = {}) {
  const out = [];
  const problems = [];

  if (raw && raw.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      problems.push(`LEAD_RECIPIENTS is not valid JSON (${err.message}) — no leads will be delivered.`);
      return { recipients: [], problems };
    }
    if (!Array.isArray(parsed)) {
      problems.push('LEAD_RECIPIENTS must be a JSON array — no leads will be delivered.');
      return { recipients: [], problems };
    }
    parsed.forEach((r, i) => {
      const id = String(r?.id || '').trim();
      const url = String(r?.url || '').trim();
      if (!id) { problems.push(`LEAD_RECIPIENTS[${i}] has no id — skipped.`); return; }
      if (!/^https:\/\//i.test(url)) {
        problems.push(`LEAD_RECIPIENTS[${i}] (${id}) has no https url — skipped. Lead data must not travel over plain http.`);
        return;
      }
      /* Optional. Postcode areas ("SW") or full outward codes ("SW11") this
         installer covers. Absent means national — see routing.js. */
      const { areas, bad } = routing.normaliseAreas(r?.areas);
      if (bad.length) problems.push(`LEAD_RECIPIENTS[${i}] (${id}) has unrecognised areas: ${bad.join(', ')} — expected a postcode area like "SW" or an outward code like "SW11".`);
      /* Which trades they buy. Absent means all of them, which is what every
         recipient configured before this existed is assumed to mean. */
      const { trades, bad: badTrades } = routing.normaliseTrades(r?.trades);
      if (badTrades.length) problems.push(`LEAD_RECIPIENTS[${i}] (${id}) has unrecognised trades: ${badTrades.join(', ')} — expected any of ${routing.TRADES.join(', ')}.`);
      /* What this buyer pays for a lead, in pounds.

         Optional, because a recipient may be a CRM rather than a buyer. But
         where it exists it is the number that goes in the delivery record,
         and the delivery record is the billing evidence — so it has to be
         what was agreed at the time the lead was sent, not what a contract
         says months later when somebody is reconciling an invoice.

         Two buyers here pay £100 and £130. One flat figure could not describe
         that, and the log could not say what any lead was worth. */
      let leadPrice = null;
      if (r?.leadPrice !== undefined && r?.leadPrice !== null && r?.leadPrice !== '') {
        const n = Number(r.leadPrice);
        if (!Number.isFinite(n) || n < 0) {
          problems.push(`LEAD_RECIPIENTS[${i}] (${id}) has leadPrice "${r.leadPrice}" — expected a number of pounds, so no fee will be recorded for this buyer.`);
        } else {
          leadPrice = n;
        }
      }
      /* An account, so this installer can log in and see their own leads
         rather than everybody's. Optional: a recipient may be a CRM with no
         human behind it, and one that cannot log in is not a fault.

         Stored as a hash — nobody needs to read it back, and LEAD_RECIPIENTS
         is visible to anyone with dashboard access. Generate one with
         `npm run installer-password`. */
      const passwordHash = String(r?.passwordHash || '').trim() || null;
      if (r?.password) {
        problems.push(`LEAD_RECIPIENTS[${i}] (${id}) has a plaintext "password" — use passwordHash and \`npm run installer-password\` to make one. The plaintext value has been ignored.`);
      }
      if (passwordHash && !/^scrypt\$/.test(passwordHash)) {
        problems.push(`LEAD_RECIPIENTS[${i}] (${id}) has a passwordHash that is not in the expected format — that installer cannot log in.`);
      }

      /* What was checked before calling them vetted. See installers.js. */
      const verification = installers.readVerification(r);

      out.push({
        id,
        name: String(r?.name || id).trim(),
        url,
        areas,
        trades,
        leadPrice,
        passwordHash,
        verification,
        headers: (r && typeof r.headers === 'object' && r.headers) || {},
      });
    });
  }

  // Backwards compatibility with the single-webhook setup.
  if (!out.length && legacyUrl && /^https:\/\//i.test(legacyUrl)) {
    out.push({ id: 'crm', name: 'CRM webhook', url: legacyUrl, areas: [], trades: [], headers: {} });
  }

  const seen = new Set();
  for (const r of out) {
    if (seen.has(r.id)) problems.push(`Duplicate recipient id "${r.id}" — deliveries will be indistinguishable.`);
    seen.add(r.id);
  }

  return { recipients: out, problems };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* One recipient, with retries. Resolves to an outcome — it never throws, so a
   single bad buyer cannot take down the delivery of the others. */
async function deliverTo(recipient, lead, { fetchImpl, attempts = DEFAULT_ATTEMPTS, timeoutMs = DEFAULT_TIMEOUT_MS, onSleep = sleep } = {}) {
  const started = new Date().toISOString();
  let lastError = null;
  let lastStatus = null;
  /* What we actually spent, not what we were allowed to. A 400 breaks out on
     the first try, and this used to report three — on the record a buyer
     queries when they say they never received a lead. Evidence that overstates
     is worse than none, because it is the half nobody checks. */
  let spent = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    spent = attempt;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(recipient.url, {
          method: 'POST',
          /* Idempotency-Key is set before the recipient's own headers so a
             recipient cannot accidentally overwrite it, and is constant across
             the retries of one delivery — that is the whole point.

             From the August 2026 code audit: a buyer whose endpoint accepts a
             lead and then times out before answering gets the same lead again
             on our retry. Every attempt is recorded here, so our own log shows
             one delivery; theirs shows two, and at £100 a lead that is an
             invoice dispute where our evidence quietly disagrees with theirs.

             One key per recipient per lead, not per lead: the same lead going
             to three buyers is three distinct deliveries, and collapsing them
             under one key would let a buyer's deduplication drop a lead they
             were supposed to receive.

             This is a header a recipient may ignore. It costs nothing if they
             do, and it is the only thing that lets a careful one get it right
             — which is why it is sent rather than negotiated. */
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `${lead.id}:${recipient.id}`,
            ...recipient.headers,
          },
          body: JSON.stringify(lead),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      lastStatus = res?.status ?? null;
      if (res && res.ok) {
        return { id: recipient.id, name: recipient.name, leadPrice: recipient.leadPrice ?? null, ok: true, status: lastStatus, attempts: attempt, at: new Date().toISOString(), startedAt: started };
      }
      lastError = `HTTP ${lastStatus}`;

      // 4xx other than 408/429 won't succeed on a retry — stop wasting time.
      if (lastStatus && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 408 && lastStatus !== 429) {
        break;
      }
    } catch (err) {
      lastError = err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (err?.message || String(err));
    }

    if (attempt < attempts) await onSleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
  }

  return { id: recipient.id, name: recipient.name, leadPrice: recipient.leadPrice ?? null, ok: false, status: lastStatus, attempts: spent, error: lastError, at: new Date().toISOString(), startedAt: started };
}

/* All recipients, concurrently. One slow buyer shouldn't delay the rest. */
async function deliverLead(lead, recipients, opts = {}) {
  if (!recipients.length) return [];
  return Promise.all(recipients.map(r => deliverTo(r, lead, opts)));
}

const summarise = (results) => {
  const ok = results.filter(r => r.ok);
  const priced = ok.filter(r => typeof r.leadPrice === 'number');
  return {
    total: results.length,
    delivered: ok.length,
    failed: results.filter(r => !r.ok).length,
    /* Only what actually arrived, and only where a price was configured. A
       failed delivery is not a lead sold, and counting one would put a number
       on an invoice that the delivery log itself contradicts.

       null rather than 0 when no recipient had a price, because "nobody was
       charged" and "we do not know what this was worth" are different facts
       and only one of them is an accounting problem. */
    feeTotal: priced.length ? Number(priced.reduce((n, r) => n + r.leadPrice, 0).toFixed(2)) : null,
    feeUnpriced: ok.length - priced.length,
  };
};

module.exports = { parseRecipients, deliverTo, deliverLead, summarise, DEFAULT_ATTEMPTS, DEFAULT_TIMEOUT_MS };
