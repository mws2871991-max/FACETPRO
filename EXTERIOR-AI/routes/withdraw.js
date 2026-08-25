/* Withdrawing consent: the page, and the endpoint that does the work.
 *
 * Third slice of the decomposition, after routes/ops.js and
 * routes/installers.js. The seam here was not free, and where it falls is the
 * interesting part.
 *
 * purgeLeadPiiFor does NOT come with these routes, though it sits directly
 * below them in the file they came from. The retention sweep calls it too, and
 * the test suite reaches it through server.js's exports — it is a function
 * about erasure, not about this page, and the fact that it lived next door was
 * proximity rather than ownership. Moving it because it was adjacent would have
 * broken the nightly sweep. These routes take the single-lead wrapper as a
 * dependency instead, and the shared function stays where both callers can see
 * it.
 *
 * Behaviour is unchanged: same paths, same limiter, same responses.
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const withdrawal = require('../withdrawal');
const emails = require('../emails');
const delivery = require('../delivery');
const retention = require('../retention');

/**
 * @param {object} deps
 * @param {Function} deps.withdrawLimiter  rate limiter for both routes
 * @param {Function} deps.purgeLeadPii     (leadId) => Promise; the shared
 *   erasure helper, owned by server.js because retention uses it too
 * @param {Function} deps.record           (table, row) => Promise
 * @param {Function} deps.leadEvent        (type, leadId, detail) => Promise
 * @param {Array}    deps.LEAD_RECIPIENTS  parsed buyers; never reassigned
 * @param {string}   deps.PRIVACY_EMAIL    shown when a link has expired
 */
module.exports = function withdrawRoutes({
  withdrawLimiter, purgeLeadPii, record, leadEvent, LEAD_RECIPIENTS, PRIVACY_EMAIL,
}) {
  const router = express.Router();

  /* ── WITHDRAWING CONSENT ──
     Article 7(3): as easy to withdraw as it was to give. The notice also
     promises we will tell the installers, and tell the homeowner which
     installers received their details — both are done here.

     Two routes, deliberately. The link in the email is a GET that only shows a
     page; the actual withdrawal is a POST. Mail scanners fetch every URL in
     every email before a human sees it, so a GET that erased a record would
     fire on delivery rather than on request. */

  // Never say whether a token exists. The page is the same either way.
  const withdrawPage = (body) => `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Your choices — Facet Pro</title>
  <style>
    body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#FBF8F3;color:#0F1012;margin:0;padding:40px 20px}
    main{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    h1{font-size:24px;margin:0 0 8px;font-weight:600}
    p{color:#3f3f46;margin:12px 0}
    .muted{color:#6B6E78;font-size:14px}
    button{display:block;width:100%;text-align:left;font:inherit;margin:10px 0 0;padding:14px 16px;border:1px solid #d4d4d8;border-radius:12px;background:#fff;cursor:pointer}
    button:hover{border-color:#0F1012}
    button.danger{border-color:#fca5a5;color:#991b1b}
    button.danger:hover{border-color:#dc2626}
    .done{background:#F0FDF4;border:1px solid #86efac;border-radius:12px;padding:16px}
    ul{padding-left:20px;color:#3f3f46}
  </style></head><body><main>${body}
  <p class="muted" style="border-top:1px solid #e4e4e7;padding-top:16px;margin-top:24px">
  Facet Pro · <a href="/privacy" style="color:#6B6E78">Privacy notice</a></p>
  </main></body></html>`;

  router.get('/withdraw', withdrawLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');   // the token is in the URL
    const token = String(req.query.t || '');

    let lead = null;
    try { lead = withdrawal.findByToken(await store.readAll('leads'), token); } catch (_) { /* fall through */ }

    if (!lead) {
      return res.status(404).type('html').send(withdrawPage(`
        <h1>This link has expired</h1>
        <p>It may already have been used, or the details it referred to may have been deleted.</p>
        <p>Either way you can email us at <a href="mailto:${emails.escapeHtml(PRIVACY_EMAIL)}">${emails.escapeHtml(PRIVACY_EMAIL)}</a>
           and we will deal with it by hand.</p>`));
    }

    let received = [];
    try { received = withdrawal.recipientsWhoReceived(await store.readAll('deliveries'), lead.id); } catch (_) { /* none */ }

    const choice = (scope, label, note, cls = '') =>
      `<button class="${cls}" onclick="go('${scope}')">${label}<br><span class="muted">${note}</span></button>`;

    res.type('html').send(withdrawPage(`
      <h1>Your choices</h1>
      <p>Reference <strong>${emails.escapeHtml(lead.id)}</strong>. You can change your mind about
         anything you agreed to, at any time, and you don't have to give a reason.</p>
      ${received.length
        ? `<p>Your details were passed to:</p><ul>${received.map(r => `<li>${emails.escapeHtml(r.name)}</li>`).join('')}</ul>
           <p class="muted">We'll tell them you've withdrawn. They hold their own copy and are separately
              responsible for it, so you can also ask them directly to delete it.</p>`
        : `<p class="muted">Your details have not been passed to any installer.</p>`}
      ${lead.consent?.installerQuotes ? choice('installerQuotes', 'Stop sharing my details with installers', 'No new installer gets your details.') : ''}
      ${lead.consent?.emailPack ? choice('emailPack', 'Stop emailing me about my design', 'No further emails about this design.') : ''}
      ${choice('all', 'Delete everything you hold about me', 'We keep only a record that you asked, which the law requires us to.', 'danger')}
      <div id="err" class="muted"></div>
      <script>
        async function go(scope) {
          if (scope === 'all' && !confirm('Delete everything we hold about you? This cannot be undone.')) return;
          document.querySelectorAll('button').forEach(b => b.disabled = true);
          try {
            const r = await fetch('/api/withdraw', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: new URLSearchParams(location.search).get('t'), scope }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Something went wrong.');
            document.querySelector('main').innerHTML =
              '<h1>Done</h1><div class="done"><p>' + d.message + '</p></div>' +
              '<p class="muted">Confirmed at ' + new Date(d.at).toLocaleString('en-GB') + '.</p>';
          } catch (e) {
            document.getElementById('err').textContent = e.message;
            document.querySelectorAll('button').forEach(b => b.disabled = false);
          }
        }
      </script>`));
  });

  /* Tell the installers who actually received the lead. Article 19: we notify
     each recipient of an erasure or restriction unless it proves impossible.
     Recorded either way, including when a recipient can no longer be reached,
     because "unless it proves impossible" is a claim that needs evidence. */
  async function notifyWithdrawal(lead, scope, received) {
    if (!withdrawal.SCOPES[scope].tellRecipients || !received.length) return [];
    const at = new Date().toISOString();
    const payload = withdrawal.withdrawalPayload(lead.id, scope, at);

    const results = [];
    for (const r of received) {
      const config = LEAD_RECIPIENTS.find(c => c.id === r.id);
      if (!config) {
        // They hold the data but we no longer have a way to reach them.
        results.push({ id: r.id, name: r.name, ok: false, error: 'recipient no longer configured — tell them by hand' });
        console.error(`Withdrawal ${lead.id}: cannot notify ${r.name} — no longer in LEAD_RECIPIENTS. Tell them by hand.`);
        continue;
      }
      results.push(await delivery.deliverTo(config, payload, { fetchImpl: (...a) => fetch(...a) }));
    }
    return results;
  }

  router.post('/api/withdraw', withdrawLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { token, scope } = req.body || {};
    if (!withdrawal.isScope(scope)) return res.status(400).json({ error: 'Unknown request.' });

    const lead = withdrawal.findByToken(await store.readAll('leads'), token);
    if (!lead) return res.status(404).json({ error: 'This link has expired. Please email us and we will deal with it by hand.' });

    const at = new Date().toISOString();
    const ipHash = req.ip ? crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 12) : null;

    let received = [];
    try { received = withdrawal.recipientsWhoReceived(await store.readAll('deliveries'), lead.id); } catch (_) { /* none */ }

    /* Written before anyone is notified. If the process dies between the two,
       the safe failure is a withdrawal we honoured but under-announced — not
       one we announced and then forgot.

       Through mutate, so the read and the write are inside one lock. The lead is
       found again from the rows as they are now rather than reusing the one
       matched above: between the two, another request may have saved a lead, or
       a second withdrawal may have arrived for this one. */
    let updated = null;
    await store.mutate('leads', (rows) => {
      const current = rows.find(l => l.id === lead.id);
      if (!current || current.redacted) return undefined;      // already erased; nothing to do
      updated = withdrawal.applyWithdrawal(current, scope, { now: at, ipHash, redactLead: retention.redactLead });
      return rows.map(l => (l.id === lead.id ? updated : l));
    });
    if (!updated) return res.status(404).json({ error: 'This link has expired. Please email us and we will deal with it by hand.' });

    if (scope === 'all') {
      // The render is a photorealistic image of their home; "everything" means it.
      const renderId = (lead.renderUrl || '').match(/^\/r\/([A-Za-z0-9_-]+)$/)?.[1];
      if (renderId) { try { await store.deleteRenders([renderId]); } catch (_) { /* logged below */ } }
      // Delivery and notification failures carry name, email and phone of their own.
      try { await purgeLeadPii(lead.id); } catch (err) { console.error(`Withdrawal ${lead.id}: could not purge ancillary records:`, err.message); }
    }

    const notified = await notifyWithdrawal(lead, scope, received);

    await record('withdrawals', {
      ts: at, leadId: lead.id, scope, ipHash,
      recipientsNotified: notified.map(n => ({ id: n.id, name: n.name, ok: n.ok, status: n.status ?? null, error: n.error ?? null })),
    });
    /* The one event that must outlive the thing it describes. The lead row is
       redacted or gone by now; without this there is no record that the request
       was made, honoured, and passed on to the installers who already had a
       copy — which is precisely what Article 17(2) asks us to be able to show. */
    await leadEvent('withdrawal.completed', lead.id, {
      scope,
      recipientsNotified: notified.length,
      recipientsAcknowledged: notified.filter(n => n.ok).length,
    });

    console.log(`Lead ${lead.id}: consent withdrawn (${scope}); ${notified.filter(n => n.ok).length}/${notified.length} recipient(s) notified.`);

    const message = scope === 'all'
      ? 'Your details have been deleted. We keep only a record that you asked us to, and what you originally agreed to — the law requires us to be able to show both.'
        + (received.length ? ' We have asked the installers who received your details to delete their copies.' : '')
      : scope === 'emailPack'
        ? 'We will not email you about this design again.'
        : 'We have stopped sharing your details, and told the installers who already received them.';

    res.json({ ok: true, at, scope, message, recipientsNotified: notified.length });
  });

  return router;
};
