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
      out.push({
        id,
        name: String(r?.name || id).trim(),
        url,
        areas,
        headers: (r && typeof r.headers === 'object' && r.headers) || {},
      });
    });
  }

  // Backwards compatibility with the single-webhook setup.
  if (!out.length && legacyUrl && /^https:\/\//i.test(legacyUrl)) {
    out.push({ id: 'crm', name: 'CRM webhook', url: legacyUrl, areas: [], headers: {} });
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
          headers: { 'Content-Type': 'application/json', ...recipient.headers },
          body: JSON.stringify(lead),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      lastStatus = res?.status ?? null;
      if (res && res.ok) {
        return { id: recipient.id, name: recipient.name, ok: true, status: lastStatus, attempts: attempt, at: new Date().toISOString(), startedAt: started };
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

  return { id: recipient.id, name: recipient.name, ok: false, status: lastStatus, attempts: spent, error: lastError, at: new Date().toISOString(), startedAt: started };
}

/* All recipients, concurrently. One slow buyer shouldn't delay the rest. */
async function deliverLead(lead, recipients, opts = {}) {
  if (!recipients.length) return [];
  return Promise.all(recipients.map(r => deliverTo(r, lead, opts)));
}

const summarise = (results) => ({
  total: results.length,
  delivered: results.filter(r => r.ok).length,
  failed: results.filter(r => !r.ok).length,
});

module.exports = { parseRecipients, deliverTo, deliverLead, summarise, DEFAULT_ATTEMPTS, DEFAULT_TIMEOUT_MS };
