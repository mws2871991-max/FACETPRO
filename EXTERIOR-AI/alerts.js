/* Alerts: an email to the operator when something needs a person (7 Oct 2026).

   /ops shows everything, but only to somebody looking. On launch day the
   things that cost money happen while nobody is: the daily caps run out and
   every later visitor is told "not right now"; a buyer's endpoint starts
   refusing leads; email stops sending. Each of those now sends one email.

   Sent through the same Resend account as the lead emails, to ALERT_EMAIL or,
   failing that, LEAD_NOTIFY_EMAIL. With no email configured an alert is a
   console line and nothing else, so this is safe to ship before email is.

   Never personal data: a lead reference, a buyer id, a count, a reason. No
   names, emails, phone numbers, postcodes or addresses go into an alert.

   Throttled per alert key (once an hour), and the cap warnings fire once per
   threshold per UTC day, so a bad hour is a handful of emails, not hundreds. */

'use strict';

const THROTTLE_MS = 60 * 60 * 1000;
const CAP_THRESHOLDS = [0.8, 1];
const BURST = { windowMs: 15 * 60 * 1000, requests: 10 };

const lastSent = new Map();        // key -> ms
const capsFired = new Map();       // `${day}:${kind}:${threshold}` -> true
const requestErrors = [];          // timestamps

let sendImpl = null;               // set by configure(); tests replace it
const sent = [];                   // what went out, newest last (for tests and /ops)

function to() { return process.env.ALERT_EMAIL || process.env.LEAD_NOTIFY_EMAIL || ''; }
function enabled() { return !!(process.env.RESEND_API_KEY && process.env.LEAD_FROM_EMAIL && to()); }

function configure(fn) { sendImpl = typeof fn === 'function' ? fn : null; }

async function defaultSend({ subject, text }) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({ from: process.env.LEAD_FROM_EMAIL, to: to(), subject, text });
}

/* Returns true when the alert was sent (or would have been, with no email). */
function alert(key, subject, lines, { now = Date.now() } = {}) {
  const last = lastSent.get(key);
  if (last && now - last < THROTTLE_MS) return false;
  lastSent.set(key, now);
  const text = [...lines, '', `Site: ${process.env.SITE_URL || 'https://www.facetpro.co.uk'} · details at /ops`, `Sent ${new Date(now).toISOString()} · at most once an hour for "${key}".`].join('\n');
  const full = `Facet Pro alert: ${subject}`;
  sent.push({ key, subject: full, text, at: new Date(now).toISOString() });
  while (sent.length > 50) sent.shift();
  console.warn(`[alert] ${full}`);
  if (!enabled()) return true;
  Promise.resolve()
    .then(() => (sendImpl || defaultSend)({ subject: full, text }))
    .catch((err) => console.error('[alert] could not send:', err.message));
  return true;
}

/* Called each time a photo analysis or render is counted against its cap. */
function usage(kind, used, limit, { now = Date.now() } = {}) {
  if (!(limit > 0)) return;
  const day = new Date(now).toISOString().slice(0, 10);
  for (const t of CAP_THRESHOLDS) {
    if (used < Math.ceil(limit * t)) continue;
    const k = `${day}:${kind}:${t}`;
    if (capsFired.has(k)) continue;
    capsFired.set(k, true);
    const what = kind === 'render' ? 'AI pictures' : 'photo analyses';
    alert(`cap-${kind}-${t}`, t >= 1 ? `daily ${what} used up` : `${Math.round(t * 100)}% of today's ${what} used`, [
      t >= 1
        ? `All ${limit} of today's ${what} have been used. Every visitor until midnight UTC is told it's not available right now — their estimate still works, but this costs leads.`
        : `${used} of ${limit} ${what} used today (UTC).`,
      `To raise it: Railway → variables → ${kind === 'render' ? 'DAILY_RENDER_LIMIT' : 'DAILY_DETECT_LIMIT'}, then redeploy.`,
    ], { now });
  }
  for (const k of capsFired.keys()) if (!k.startsWith(day)) capsFired.delete(k);
}

function deliveryFailed({ leadId, recipientId, status, error }, opts) {
  alert(`delivery-${recipientId}`, `a lead did not reach ${recipientId}`, [
    `Lead ${leadId} could not be delivered to ${recipientId} (${status ?? 'no response'}${error ? `: ${String(error).slice(0, 160)}` : ''}).`,
    'It is stored, and the delivery log has the detail. If this repeats, their endpoint is down — tell them, and their leads can be re-sent.',
  ], opts);
}

function emailFailed(kind, reason, opts) {
  alert(`email-${kind}`, `an email did not send (${kind})`, [
    `A ${kind} email failed: ${String(reason || 'unknown').slice(0, 200)}.`,
    'Check Resend (domain verified, key valid, not over quota). Homeowners who asked for quotes rely on these for their withdrawal link.',
  ], opts);
}

/* Every observability event comes through here (observability.addListener). */
function onEvent(entry, { now = Date.now() } = {}) {
  if (!entry) return;
  if (entry.kind === 'crash') {
    alert('crash', 'the server hit an unexpected error', [`${entry.message}`, 'It kept running, but this is a bug worth looking at.'], { now });
  } else if (entry.kind === 'storage') {
    alert('storage', 'storage is failing', [`${entry.message}`, 'Leads or designs may not be saving. Check the database in Railway.'], { now });
  } else if (entry.kind === 'request') {
    requestErrors.push(now);
    while (requestErrors.length && now - requestErrors[0] > BURST.windowMs) requestErrors.shift();
    if (requestErrors.length >= BURST.requests) {
      alert('requests', 'a burst of errors', [`${requestErrors.length} requests failed in the last 15 minutes. Latest: ${entry.message}`], { now });
    }
  }
}

function _reset() { lastSent.clear(); capsFired.clear(); requestErrors.length = 0; sent.length = 0; sendImpl = null; }

module.exports = { alert, usage, deliveryFailed, emailFailed, onEvent, configure, enabled, sent, _reset, THROTTLE_MS };
