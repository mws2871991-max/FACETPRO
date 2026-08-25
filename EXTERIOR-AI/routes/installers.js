/* The installer area: reconciliation, sign-in, the lead list and responses.
 *
 * Second slice of the decomposition the August 2026 audit asked for, after
 * routes/ops.js. These four belong together because they share an audience and
 * an access model, not because they sat next to each other: everything here is
 * behind installer auth, everything writes to the access log, and nothing else
 * in server.js reaches into them.
 *
 * Two different guards, and the difference is the one this codebase has already
 * been bitten by. `requireInstaller` reads a per-installer bearer token, so an
 * installer sees only their own leads. `requireInstallerPassword` is the shared
 * operator credential. A reader who assumes one covers both writes a
 * post-deploy check that cannot fail — which is what DEPLOY.md told you to run
 * for weeks while four endpoints were down.
 *
 * Behaviour is unchanged: same paths, same middleware order, same responses.
 */

'use strict';

const express = require('express');
const store = require('../store');
const installers = require('../installers');
const obs = require('../observability');

/**
 * @param {object} deps  server.js's own middleware and state.
 * @param {Function} deps.installerLimiter
 * @param {Function} deps.requireInstaller          per-installer bearer token
 * @param {Function} deps.requireInstallerPassword  shared operator password
 * @param {Function} deps.logAccess                 (endpoint) => middleware
 * @param {Function} deps.record                    (table, row) => Promise
 * @param {Function} deps.leadEvent                 (type, leadId, detail) => Promise
 * @param {Array}    deps.LEAD_RECIPIENTS           parsed buyers; never reassigned
 * @param {string}   deps.INSTALLER_TOKEN_SECRET
 */
module.exports = function installerRoutes({
  installerLimiter, requireInstaller, requireInstallerPassword, logAccess,
  record, leadEvent, LEAD_RECIPIENTS, INSTALLER_TOKEN_SECRET,
}) {
  const router = express.Router();

  /* ── GET /api/deliveries ──
     Reconciliation. At £100 a delivery this is what you invoice against and
     what you check when a buyer says they never received something.

     Same password gate as the leads list. Recipient URLs are never included —
     they can carry auth tokens, and nobody reading this needs them. */
  router.get('/api/deliveries', installerLimiter, requireInstallerPassword, logAccess('/api/deliveries'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let rows = [];
    try { rows = await store.readAll('deliveries'); } catch (_) { /* nothing delivered yet */ }

    // Per-recipient totals — the figure that becomes an invoice line.
    const byRecipient = {};
    for (const row of rows) {
      for (const r of row.results || []) {
        const b = byRecipient[r.id] || (byRecipient[r.id] = { id: r.id, name: r.name, delivered: 0, failed: 0 });
        r.ok ? b.delivered++ : b.failed++;
      }
    }

    res.json({
      configured: LEAD_RECIPIENTS.map(r => ({ id: r.id, name: r.name })),
      totals: {
        leads: rows.length,
        deliveries: rows.reduce((n, r) => n + (r.total || 0), 0),
        delivered: rows.reduce((n, r) => n + (r.delivered || 0), 0),
        failed: rows.reduce((n, r) => n + (r.failed || 0), 0),
      },
      byRecipient: Object.values(byRecipient),
      recent: rows.slice(-50).reverse(),
    });
  });

  /* ── GET /api/leads ──
     Leads captured so far, newest first. Password-protected — see
     requireInstallerPassword above. */
  /* ── POST /api/installer/login ──
     An account per installer, replacing one password shared by everybody.
     Returns a short-lived token so the browser never stores the credential. */
  router.post('/api/installer/login', installerLimiter, async (req, res) => {
    const id = String(req.body?.id || '').trim();
    const password = String(req.body?.password || '');
    const who = LEAD_RECIPIENTS.find(r => r.id === id);

    /* The compare runs even when the id is unknown, so a wrong name and a wrong
       password take the same time and neither confirms the other.

       It did not. `!!who?.passwordHash && await verify(...)` short-circuits, so
       an unknown id never reached the compare at all and came back in a
       fraction of a millisecond while a known one took the full scrypt. That is
       an oracle for enumerating installer names, and making the hash
       asynchronous widened it rather than closing it.

       Written as two statements rather than reordered operands, because the
       order is the security property and `&&` invites tidying. The dummy hash
       exists precisely so there is always something to compare against. */
    const hash = who?.passwordHash || 'scrypt$00$00';
    const matches = await installers.verifyPassword(password, hash);
    const ok = matches && !!who?.passwordHash;
    if (!ok) {
      obs.record('installer-login', 'failed sign-in', { id: id ? 'supplied' : 'missing' });
      return res.status(401).json({ error: 'That name or password is not right.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      token: installers.issueToken(who.id, INSTALLER_TOKEN_SECRET),
      expiresInSeconds: Math.round(installers.TOKEN_TTL_MS / 1000),
      installer: { id: who.id, name: who.name, verification: who.verification?.fields || {} },
    });
  });

  router.get('/api/leads', installerLimiter, requireInstaller, logAccess('/api/leads'), async (req, res) => {
    // Homeowners' contact details: not for any cache between us and the browser.
    res.setHeader('Cache-Control', 'no-store');
    /* Only leads whose owner asked for installer contact.

       The delivery path was gated on this consent from the start; the portal
       was not, so it handed every installer every lead ever captured —
       including people who ticked only "email me my design pack", or nothing
       but the Terms. They were told in terms that this happens only if they ask
       for it, so the disclosure had no lawful basis and made the notice
       inaccurate as well.

       Redacted leads are excluded too: retention has already stripped them of
       personal data, and there is nothing in one an installer can act on. */
    let leads = (await store.readAll('leads'))
      .filter(l => l.consent?.installerQuotes === true && !l.redacted)
      // The withdrawal token's hash is ours, not theirs.
      .map(({ withdrawTokenHash, ...rest }) => rest);

    /* An installer signed in with their own account sees only the leads that
       were actually delivered to them.

       Read from the delivery log rather than recomputed from today's routing.
       Routing changes — areas get added, a contract ends, the cap moves — and
       what governs disclosure is who received a lead at the time, not who would
       receive it now. The delivery record is the only thing that knows, and it
       is also the billing evidence, so the two agree by construction.

       The shared password still sees everything, because that is what a single
       credential shared by every buyer always meant. It is scoped 'all' rather
       than pretending otherwise, and the response says which it was. */
    if (req.installer?.scope === 'installer') {
      const mine = new Set();
      for (const d of await store.readAll('deliveries')) {
        if (!Array.isArray(d?.results)) continue;
        if (d.results.some(r => r?.id === req.installer.id && r?.ok)) mine.add(d.leadId);
      }
      leads = leads.filter(l => mine.has(l.id));
    }

    /* Their own decisions, so the portal can show a project as already accepted
       or passed rather than offering the buttons again. The shared password sees
       every decision, because it already sees every lead — and knowing that
       somebody accepted a job is how a second buyer avoids ringing the same
       homeowner about it. */
    const decisions = await responsesFor(req.installer?.scope === 'installer' ? req.installer.id : null);

    res.json({
      leads: leads.slice().reverse(),
      decisions,
      scope: req.installer?.scope || 'all',
      installer: req.installer?.id || null,
    });
  });

  /* ── ACCEPTING OR PASSING ON A PROJECT ──

     An installer was being sent a lead and given nowhere to say what they
     thought of it. That costs three things: they cannot manage their own
     pipeline, we cannot see which leads are worth what we charge for them, and
     the routing has no feedback signal — so the fifteenth lead goes to whoever
     the hash picks regardless of who answered the previous fourteen.

     Only an installer account can respond, and only about a lead the delivery
     log says they actually received. The shared INSTALLER_PASSWORD cannot: it is
     scoped 'all' and is not a company, so a decision recorded under it would be
     attributed to nobody and would then be used to route future leads.

     Append-only. A change of mind is another row, and the latest one wins —
     nothing is overwritten, because this is the record somebody reaches for when
     a buyer disputes an invoice. */
  const LEAD_ACTIONS = ['accept', 'pass'];

  router.post('/api/installer/lead-response', installerLimiter, requireInstaller, logAccess('/api/installer/lead-response'), async (req, res) => {
    if (req.installer?.scope !== 'installer' || !req.installer.id) {
      return res.status(403).json({
        error: 'Accepting or passing needs your own installer sign-in, not the shared password.',
        reason: 'account_required',
      });
    }

    const leadId = String(req.body?.leadId || '').trim().slice(0, 40);
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!leadId) return res.status(400).json({ error: 'leadId is required.' });
    if (!LEAD_ACTIONS.includes(action)) return res.status(400).json({ error: 'action must be accept or pass.' });

    /* Did this installer receive this lead? Read from the delivery log, which is
       the same source /api/leads scopes on — so an installer cannot accept a
       lead they were never shown, and the two endpoints cannot disagree about
       what they were shown. */
    let received = false;
    for (const d of await store.readAll('deliveries')) {
      if (d?.leadId !== leadId || !Array.isArray(d.results)) continue;
      if (d.results.some(r => r?.id === req.installer.id && r?.ok)) { received = true; break; }
    }
    if (!received) return res.status(404).json({ error: 'That project was not sent to you.' });

    const record = {
      ts: new Date().toISOString(),
      leadId,
      installerId: req.installer.id,
      action,
    };
    await store.append('leadResponses', record);
    await leadEvent(`installer.${action === 'accept' ? 'accepted' : 'passed'}`, leadId, {
      installerId: req.installer.id,
    });

    if (action === 'accept') {
      store.countStage('installer_accepted').catch(() => { /* a counter never fails a decision */ });
    }
    console.log(`Lead ${leadId}: ${req.installer.id} ${action === 'accept' ? 'ACCEPTED' : 'passed'}.`);

    res.json({ ok: true, leadId, action, at: record.ts });
  });

  /* What each installer has decided, keyed by lead id. Latest row wins. */
  async function responsesFor(installerId) {
    const out = {};
    for (const r of await store.readAll('leadResponses')) {
      if (!r?.leadId) continue;
      if (installerId && r.installerId !== installerId) continue;
      out[r.leadId] = { action: r.action, at: r.ts, installerId: r.installerId };
    }
    return out;
  }

  return router;
};
