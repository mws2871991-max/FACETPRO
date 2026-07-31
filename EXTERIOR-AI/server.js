const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const store = require('./store');
const measure = require('./measure');
const emails = require('./emails');

const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8'));

/* These are real supplier and labour rates, not placeholders, which makes
   staleness the risk rather than obvious wrongness: quoting this year's jobs
   on last year's material prices looks entirely plausible and is silently
   wrong. Warn once at startup rather than let it drift unnoticed. */
const CATALOGUE_STALE_AFTER_DAYS = 180;

function checkCatalogueAge(now = new Date()) {
  const updated = Date.parse(catalogue.updated);
  if (!Number.isFinite(updated)) {
    console.warn(`catalogue.json has no usable "updated" date ("${catalogue.updated}") — can't tell how current these prices are.`);
    return;
  }
  const days = Math.floor((now.getTime() - updated) / 86400000);
  if (days > CATALOGUE_STALE_AFTER_DAYS) {
    console.warn(`Catalogue prices were last updated ${catalogue.updated} (${days} days ago). ` +
                 'These are real rates and they move — review catalogue.json and bump "updated".');
  } else {
    console.log(`Catalogue v${catalogue.version}, prices updated ${catalogue.updated} (${days} days ago).`);
  }
}

const app = express();
app.set('trust proxy', 1);

// No CORS headers: the front end is served from this same origin, so it never
// needs them. Sending `Access-Control-Allow-Origin: *` only let any website
// read these endpoints from a visitor's browser.

app.use(express.json({ limit: '20mb' }));

/* ── STATIC FILES ──
   Deny by default. Serving __dirname wholesale published the entire project —
   data/leads.jsonl (bypassing the /api/leads password outright), server.js,
   store.js, catalogue.json and the package files were all downloadable.

   Only these are public: the two HTML pages, robots/sitemap, /assets and
   /legal. Anything else 404s. */
const PUBLIC_FILES = new Set([
  '/index.html',
  '/guided-demo.html',
  '/robots.txt',
  '/sitemap.xml',
]);
const PUBLIC_DIRS = ['/assets/', '/legal/'];

// Belt and braces: even inside a public directory, never hand out source,
// data, config or documentation. Keeps assets/swatches/CREDITS.md private and
// stops a stray file dropped into /assets from being published by accident.
const BLOCKED_EXTENSIONS = /\.(js|mjs|cjs|json|jsonl|md|env|lock|ya?ml|sh|py|sql|log|bak|ini|conf|pem|key|crt)$/i;

function isPublicPath(rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch (_) { return false; }
  if (decoded.includes('\0')) return false;

  // Normalise first, so `/assets/../server.js` is judged as `/server.js`.
  // Without this the prefix check below would wave the traversal straight
  // through — express.static resolves it to a file that is still inside the
  // project root, so it would happily serve it.
  const p = path.posix.normalize(decoded);
  if (!p.startsWith('/')) return false;
  if (BLOCKED_EXTENSIONS.test(p)) return false;
  if (p === '/') return true;
  if (PUBLIC_FILES.has(p)) return true;
  return PUBLIC_DIRS.some(dir => p.startsWith(dir) && p.length > dir.length);
}

const serveStatic = express.static(__dirname, {
  dotfiles: 'deny',   // .env, .git, .gitignore — never served
  index: 'index.html',
  redirect: false,
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || !isPublicPath(req.path)) return next();
  serveStatic(req, res, next);
});

/* ── RATE LIMITERS ── */
const detectLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please wait a minute and try again.' }
});
const renderLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many renders — please wait a minute.' }
});
const leadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many submissions — please wait a minute.' }
});
/* ── DAILY CAP ON PAID ENDPOINTS ──
   The per-IP rate limiters above don't bound the bill: enough distinct IPs can
   still run up unlimited Anthropic and Replicate spend. This is a global cap
   across all callers, counted per UTC day and checked before we call either
   provider.

   The counter is written to data/usage.json so a restart doesn't reset it —
   otherwise a crash loop would hand out a fresh allowance each time. Two
   caveats: it's per process (a multi-instance deployment gets one allowance
   each, so use a shared store if you scale out), and quota is consumed when a
   call is dispatched rather than when it succeeds, since a provider error may
   still have been billed.

   Set either limit to 0 to switch that endpoint off entirely. */
function envLimit(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`${name}="${raw}" is not a non-negative integer — using default ${fallback}.`);
    return fallback;
  }
  return n;
}

const DAILY_LIMITS = {
  detect: envLimit('DAILY_DETECT_LIMIT', 50),
  render: envLimit('DAILY_RENDER_LIMIT', 50),
};

const USAGE_FILE = path.join(__dirname, 'data', 'usage.json');
const utcDay = () => new Date().toISOString().slice(0, 10);

function readUsageFile() {
  try {
    const saved = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    if (saved && saved.day === utcDay()) {
      return { day: saved.day, detect: saved.detect | 0, render: saved.render | 0 };
    }
  } catch (_) { /* no file yet, unreadable, or from a previous day */ }
  return null;
}

let usage = readUsageFile() || { day: utcDay(), detect: 0, render: 0 };

function persistUsage() {
  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
  } catch (err) {
    // Never fail a request because the counter couldn't be written — the
    // in-memory count still holds for this process.
    console.error('Could not write usage counter:', err.message);
  }
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

// Reserves one call against today's allowance. Returns false when the cap is
// already spent, in which case the caller must not contact the provider.
function consumeDailyQuota(kind, res) {
  const today = utcDay();
  if (usage.day !== today) {
    usage = { day: today, detect: 0, render: 0 };
    persistUsage();
  }

  /* Re-read before deciding, so several workers on the same host share one
     allowance instead of each being handed a full one — the common shape when
     a process manager runs a worker per core. Taking the higher of disk and
     memory means an unwritable file degrades to per-process enforcement
     rather than to no enforcement.

     Not atomic: two workers can read the same value and both spend it, so the
     cap can be exceeded by roughly the number of workers. That is a rounding
     error against a daily budget, and this is a safety net rather than
     billing. Separate hosts still need a shared store — see the README. */
  const onDisk = readUsageFile();
  if (onDisk && onDisk.day === usage.day) {
    usage.detect = Math.max(usage.detect, onDisk.detect);
    usage.render = Math.max(usage.render, onDisk.render);
  }

  const limit = DAILY_LIMITS[kind];
  res.setHeader('X-Daily-Limit', String(limit));

  if (usage[kind] >= limit) {
    res.setHeader('X-Daily-Remaining', '0');
    res.setHeader('Retry-After', String(secondsUntilUtcMidnight()));
    console.warn(`Daily ${kind} limit reached (${usage[kind]}/${limit}) — refusing without calling the provider.`);
    return false;
  }

  usage[kind] += 1;
  persistUsage();
  res.setHeader('X-Daily-Remaining', String(limit - usage[kind]));
  return true;
}

/* Hitting the cap costs nothing if the homeowner just leaves — but it costs a
   lead, which is worse than the API call would have been. Neither endpoint is
   load-bearing for the rest of the journey: without detection they can still
   pick colours, price a house type and save a design; without a render they
   still have the colour preview. So the refusal says which capability is
   unavailable and that the journey continues, and the page keeps going rather
   than dead-ending on "try again tomorrow". */
const dailyLimitBody = (kind) => ({
  error: kind === 'render'
    ? 'We can’t create photorealistic pictures right now — but your colour preview and estimate still work.'
    : 'We can’t analyse photos right now — but you can still choose colours and get an estimate.',
  reason: 'daily_limit',
  kind,
  canContinue: true,
});

/* ── LEAD NOTIFICATION ──
   Three things were wrong here and each one silently lost leads:

   1. The sender was hard-coded to onboarding@resend.dev, Resend's test
      address, which only ever delivers to the Resend account owner.
   2. The recipient fell back to `email` — the homeowner's own address — when
      LEAD_NOTIFY_EMAIL wasn't set, so the internal "New lead" email, quote
      total and all, went to the customer instead of to you.
   3. The Resend SDK resolves with { data: null, error } on an API failure
      rather than throwing, so the try/catch around it caught nothing and a
      rejected send looked exactly like a successful one.

   The lead is always stored first, so a notification failure can never lose
   it, and failures are now recorded durably as well as logged. */
const RESEND_TEST_SENDER = 'onboarding@resend.dev';
const LEAD_FROM_EMAIL = process.env.LEAD_FROM_EMAIL || `Facet Pro <${RESEND_TEST_SENDER}>`;
const LEAD_NOTIFY_EMAIL = process.env.LEAD_NOTIFY_EMAIL || '';
const SITE_URL = process.env.SITE_URL || 'https://facetpro.co.uk';

/* The homeowner's copy of their design. Off unless email is configured, and
   refused outright on Resend's test sender, which can only deliver to your own
   account — sending homeowner mail through it would fail for every real
   customer while looking configured. The site asks the server whether this is
   on (see /api/config) so the form never promises an email we can't send. */
const DESIGN_PACK_ENABLED =
  process.env.DESIGN_PACK_EMAIL !== 'off' &&
  !!process.env.RESEND_API_KEY &&
  !LEAD_FROM_EMAIL.includes(RESEND_TEST_SENDER);

function checkEmailConfig() {
  // Logged first and unconditionally: "is the customer getting their design?"
  // should be answerable from the startup output in every configuration.
  console.log(DESIGN_PACK_ENABLED
    ? `Homeowner design-pack emails: ON (from ${LEAD_FROM_EMAIL}, links to ${SITE_URL})`
    : `Homeowner design-pack emails: OFF${process.env.DESIGN_PACK_EMAIL === 'off'
        ? ' (DESIGN_PACK_EMAIL=off)'
        : ' — needs RESEND_API_KEY and a LEAD_FROM_EMAIL on a verified domain'}`);

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — leads will be stored but nobody will be emailed.');
    return;
  }
  if (!LEAD_NOTIFY_EMAIL) {
    console.error('RESEND_API_KEY is set but LEAD_NOTIFY_EMAIL is not — lead emails will be SKIPPED. ' +
                  'Set LEAD_NOTIFY_EMAIL to the address that should receive new leads.');
  }
  if (LEAD_FROM_EMAIL.includes(RESEND_TEST_SENDER)) {
    console.warn(`LEAD_FROM_EMAIL uses Resend's test sender (${RESEND_TEST_SENDER}), which only ` +
                 'delivers to your own Resend account address. Verify a domain at ' +
                 'https://resend.com/domains and set LEAD_FROM_EMAIL to an address on it.');
  }
}

/* One place that actually talks to Resend, so both emails get the same
   timeout and the same error handling. The SDK reports API failures in the
   resolved value rather than throwing, which is easy to miss once, let alone
   twice. */
async function sendEmail({ to, subject, html, text, replyTo }) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await Promise.race([
    resend.emails.send({ from: LEAD_FROM_EMAIL, to, replyTo, subject, html, text }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 15s')), 15000)),
  ]);
  if (result && result.error) {
    throw new Error(result.error.message || JSON.stringify(result.error));
  }
  return result?.data?.id || null;
}

// The homeowner's design pack. Never blocks storing the lead.
async function sendDesignPack(lead, price) {
  if (!DESIGN_PACK_ENABLED) {
    return { attempted: false, sent: false, reason: 'design pack email not configured' };
  }
  try {
    const id = await sendEmail({
      to: lead.email,
      replyTo: LEAD_NOTIFY_EMAIL || undefined,
      subject: emails.designPackSubject(lead),
      html: emails.designPackHtml(lead, price, SITE_URL),
      text: emails.designPackText(lead, price, SITE_URL),
    });
    console.log(`Lead ${lead.id}: design pack sent to the homeowner.`);
    return { attempted: true, sent: true, id };
  } catch (err) {
    console.error(`Lead ${lead.id}: design pack FAILED: ${err.message}`);
    return { attempted: true, sent: false, reason: err.message };
  }
}


/* A lead that couldn't be delivered goes to its own file, so there's a durable
   list to work through rather than a console line nobody reads. Written with fs
   directly rather than through store.js: that module only knows a fixed set of
   table names, and routing this through it would also mean the failure log
   disappearing exactly when the database is the thing that's broken. */
const NOTIFICATION_FAILURES_FILE = path.join(__dirname, 'data', 'notification-failures.jsonl');

function recordNotificationFailure(lead, notification, kind = 'lead-notification') {
  try {
    fs.mkdirSync(path.dirname(NOTIFICATION_FAILURES_FILE), { recursive: true });
    fs.appendFileSync(NOTIFICATION_FAILURES_FILE, JSON.stringify({
      ts: new Date().toISOString(),
      kind,
      leadId: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      postcode: lead.postcode,
      price: lead.price,
      reason: notification.reason,
    }) + '\n');
    console.error(`Lead ${lead.id} recorded in data/notification-failures.jsonl — follow it up manually.`);
  } catch (err) {
    console.error(`Could not record the failed notification for lead ${lead.id}:`, err.message);
  }
}

// Returns a small status object that gets attached to the stored lead, so a
// failed notification is visible rather than lost to a console line.
async function notifyNewLead(lead, price) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { attempted: false, sent: false, reason: 'RESEND_API_KEY not set' };
  if (!LEAD_NOTIFY_EMAIL) {
    console.error(`Lead ${lead.id} stored but NOT emailed: LEAD_NOTIFY_EMAIL is not set.`);
    return { attempted: false, sent: false, reason: 'LEAD_NOTIFY_EMAIL not set' };
  }

  try {
    const id = await sendEmail({
      to: LEAD_NOTIFY_EMAIL,
      replyTo: lead.email,
      subject: `New lead: ${lead.name} — ${lead.postcode || 'no postcode'}`,
      html: emails.leadNotificationHtml(lead, price),
    });
    console.log(`Lead ${lead.id} emailed to ${LEAD_NOTIFY_EMAIL}.`);
    return { attempted: true, sent: true, id };
  } catch (err) {
    console.error(`Lead ${lead.id} email FAILED: ${err.message}`);
    return { attempted: true, sent: false, reason: err.message };
  }
}

// Slows password guessing against the installer endpoint.
const installerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts — please wait 15 minutes.' }
});

/* ── INSTALLER AUTH ──
   Leads hold homeowner names, emails, phone numbers and postcodes, so the
   endpoint that lists them is password-protected.

   Both sides are SHA-256'd before comparison: that normalises them to 32 bytes
   so timingSafeEqual can never throw on a length mismatch, and — more to the
   point — it stops the comparison itself leaking the password's length. The
   compare is then constant-time, so an attacker learns nothing from how long a
   rejection takes.

   Fails closed: with no INSTALLER_PASSWORD set, nobody gets in. */
function constantTimeEquals(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireInstallerPassword(req, res, next) {
  const expected = process.env.INSTALLER_PASSWORD;
  if (!expected) {
    console.error('INSTALLER_PASSWORD is not set — refusing to serve /api/leads.');
    return res.status(503).json({ error: 'Installer access is not configured on this server.' });
  }

  const header = req.get('authorization') || '';
  const supplied = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : (req.get('x-installer-password') || '');

  // Run the compare even when nothing was supplied, so the timing of a missing
  // password matches the timing of a wrong one.
  const ok = constantTimeEquals(supplied, expected);
  if (!ok) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Facet Pro installers"');
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  next();
}

/* ── DETECTION RECORDS ──
   /api/measure works out a wall area from the boxes /api/detect returned, and
   that area feeds the quote. If the client sent the boxes back, a tampered
   request could invent a wall area and move the price — the same reason
   computePrice never trusts a client-sent price.

   So /api/detect keeps its own copy, keyed by an unguessable id, and the
   client only ever passes the id back. The image aspect ratio is read from
   the uploaded bytes for the same reason: it is a direct multiplier on the
   computed area.

   In memory and per process: a restart drops these, which costs the homeowner
   a re-upload before they can measure, nothing more. Bounded so a flood of
   uploads can't grow it without limit. */
const DETECTION_TTL_MS = 2 * 60 * 60 * 1000;   // 2 hours
const DETECTION_MAX = 500;
const detectionRecords = new Map();

function pruneDetectionRecords() {
  const cutoff = Date.now() - DETECTION_TTL_MS;
  for (const [id, rec] of detectionRecords) {
    if (rec.at < cutoff) detectionRecords.delete(id);
  }
  // Map preserves insertion order, so the oldest are first.
  while (detectionRecords.size > DETECTION_MAX) {
    detectionRecords.delete(detectionRecords.keys().next().value);
  }
}

function saveDetectionRecord(detections, size) {
  pruneDetectionRecords();
  const id = crypto.randomUUID();
  detectionRecords.set(id, {
    at: Date.now(),
    detections,
    aspectRatio: size && size.height > 0 ? size.width / size.height : null,
    measurement: null,
  });
  return id;
}

/* Wall-measurement tuning. The defaults in measure.js come from the prototype
   survey table; these let you recalibrate per house type without a code
   change, which is how you'd fold in real surveyed properties. */
function envPositive(name) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`${name}="${raw}" is not a positive number — ignoring it and using the built-in default.`);
    return undefined;
  }
  return n;
}

const MEASURE_TUNING = (() => {
  const calibration = {};
  const coverageCentre = {};
  const frontToTotal = {};
  for (const type of measure.HOUSE_TYPE_KEYS) {
    const upper = type.toUpperCase();
    const factor = envPositive(`WALL_CALIBRATION_${upper}`);
    const centre = envPositive(`WALL_COVERAGE_${upper}`);
    const ratio = envPositive(`WALL_FRONT_TO_TOTAL_${upper}`);
    if (factor !== undefined) calibration[type] = factor;
    if (centre !== undefined) coverageCentre[type] = centre;
    if (ratio !== undefined) frontToTotal[type] = ratio;
  }
  return {
    calibration,
    coverageCentre,
    frontToTotal,
    coverageTolerance: envPositive('WALL_COVERAGE_TOLERANCE'),
  };
})();

function logMeasureTuning() {
  const parts = measure.HOUSE_TYPE_KEYS.map(type => {
    const t = measure.tuningFor(type, MEASURE_TUNING);
    const overridden = MEASURE_TUNING.calibration[type] !== undefined
      || MEASURE_TUNING.coverageCentre[type] !== undefined
      || MEASURE_TUNING.frontToTotal[type] !== undefined ? '*' : '';
    return `${type} ${t.calibrationFactor}/${t.coverageCentre.toFixed(2)}/×${t.frontToTotal.toFixed(2)}${overridden}`;
  });
  console.log(`Wall measurement (factor/coverage/front-to-total) — ${parts.join(', ')}${parts.some(p => p.includes('*')) ? '   * env override' : ''}`);
}

/* ── GET /api/config ──
   What the front end needs to know about how this server is set up. Only
   booleans about our own behaviour — no keys, no addresses. Exists so the
   lead form can promise a design-pack email only when one will actually be
   sent, rather than saying it and hoping. */
/* Beta is the default, deliberately. Everything on this site is honest about
   its own uncertainty — estimates are planning figures, renders are a guide,
   the wall measurement is calibrated but unproven against real properties —
   and saying "beta" out loud is the plainest version of that. Set
   SITE_MODE=live to remove it once you're confident, rather than the reverse:
   forgetting to add a beta badge is worse than forgetting to remove one. */
const SITE_MODE = (process.env.SITE_MODE || 'beta').toLowerCase() === 'live' ? 'live' : 'beta';

/* ── GET /healthz ──
   For the host's health check. Deliberately says almost nothing: whether the
   process is up, and whether the disk it needs is actually writable — which
   is the failure this deployment is most likely to hit, since a host without
   a mounted volume looks perfectly healthy right up until the first lead is
   silently lost. */
app.get('/healthz', (req, res) => {
  let storageWritable = false;
  try {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.accessSync(path.join(__dirname, 'data'), fs.constants.W_OK);
    storageWritable = true;
  } catch (_) { /* reported below */ }

  res.status(storageWritable ? 200 : 503).json({
    ok: storageWritable,
    mode: SITE_MODE,
    storageWritable,
  });
});

app.get('/api/config', (req, res) => {
  res.json({ designPackEmail: DESIGN_PACK_ENABLED, beta: SITE_MODE === 'beta' });
});

/* ── GET /api/catalogue ── */
/* Built by allowlist, not by deleting known-bad keys.

   Stripping `internalNote` and `source` from the top level wasn't enough: the
   response was also publishing the whole cost model — labour rates, the
   material-versus-labour split on every trim item, the waste allowance and the
   scaffolding charge — none of which the page reads. That hands a competitor
   the exact basis of every quote, and tells a customer what the margin on
   their job looks like.

   The nested notes carried it too ("fascia £35/m + £12/m labour, from
   quote_generator.py"), naming an internal file into the bargain.

   So: send what the interface actually renders and nothing else. Same reasoning
   as the static-file allowlist — enumerate what's public rather than guess at
   what isn't, so the next section added here is private until someone says
   otherwise. */
const swatchFields = ({ id, name, hex, image }) => ({ id, name, hex, image });

function buildPublicCatalogue(c) {
  const pick = (obj, keys) => obj ? Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]])) : undefined;

  return {
    version: c.version,
    updated: c.updated,
    note: c.note,
    // Swatches: what to draw. Prices come from /api/quote, computed here.
    cladding: (c.cladding || []).map(swatchFields),
    trim: (c.trim || []).map(swatchFields),
    roof: (c.roof || []).map(swatchFields),
    // The optional sections do display their own figures, so those stay —
    // but only the fields the cards render.
    wholeHouse: c.wholeHouse && {
      note: c.wholeHouse.note,
      areaMinM2: c.wholeHouse.areaMinM2, areaMaxM2: c.wholeHouse.areaMaxM2, areaDefaultM2: c.wholeHouse.areaDefaultM2,
      finishes: c.wholeHouse.finishes.map(f => pick(f, ['id', 'name', 'hex', 'textureType', 'pricePerM2', 'lightScore', 'bestFor', 'bestseller'])),
      roofColours: c.wholeHouse.roofColours.map(x => pick(x, ['id', 'name', 'hex'])),
      windowColours: c.wholeHouse.windowColours.map(x => pick(x, ['id', 'name', 'hex'])),
    },
    conservatories: c.conservatories && {
      note: c.conservatories.note,
      styles: c.conservatories.styles.map(s => pick(s, ['id', 'name', 'priceMin', 'priceMax', 'bestFor', 'footprint', 'lightPct', 'description', 'pros', 'cons'])),
    },
    windowsDoors: c.windowsDoors && {
      note: c.windowsDoors.note,
      windowStyles: c.windowsDoors.windowStyles.map(s => pick(s, ['id', 'name', 'detail', 'description'])),
      doorStyles: c.windowsDoors.doorStyles.map(s => pick(s, ['id', 'name', 'detail', 'description'])),
      colours: c.windowsDoors.colours.map(x => pick(x, ['id', 'name', 'hex'])),
    },
    fsgc: c.fsgc && Object.fromEntries([
      ['note', c.fsgc.note],
      ...['fascia', 'soffit', 'guttering', 'cladding'].map(k => [
        k, (c.fsgc[k] || []).map(i => pick(i, ['id', 'name', 'pricePerM', 'tagline', 'colours', 'guaranteeYears', 'bestseller'])),
      ]),
    ]),
  };
}

const publicCatalogue = buildPublicCatalogue(catalogue);

app.get('/api/catalogue', (req, res) => {
  res.json(publicCatalogue);
});

/* ── helper: compute price server-side from catalogue + selections ──
   Never trust a client-submitted price — always recompute here so a
   tampered request can't create a lead with a fake quote. */
function computePrice({ claddingId, trimId, roofId, footprintM2, trimLengthM }) {
  const cladding = catalogue.cladding.find(c => c.id === claddingId) || catalogue.cladding[0];
  const trim = catalogue.trim.find(t => t.id === trimId) || catalogue.trim[0];
  const roof = catalogue.roof.find(r => r.id === roofId) || catalogue.roof[0];
  const claddingArea = footprintM2 && footprintM2 > 0 ? footprintM2 : catalogue.defaultFootprintM2;
  const roofArea = claddingArea * 0.55; // roof area is typically smaller than wall footprint
  const trimLength = trimLengthM && trimLengthM > 0 ? trimLengthM : catalogue.defaultTrimLengthM;

  // Real methodology from quote_generator.py: materials + labour (real per-m²/per-m rates)
  // + fixed scaffolding + waste allowance, then VAT on top.
  // Trim colour is cosmetic — fascia/soffit/guttering cost is the same real rate
  // regardless of which colour is picked, matching how the real business prices it.
  const tr = catalogue.trimRates;
  const claddingMaterial = cladding.pricePerM2 * claddingArea;
  const roofMaterial = roof.pricePerM2 * roofArea;
  const trimMaterial = (tr.fasciaPerM + tr.soffitPerM + tr.gutteringPerM) * trimLength;
  const materialsSubtotal = claddingMaterial + roofMaterial + trimMaterial;

  const claddingLabour = catalogue.labour.claddingPerM2 * claddingArea;
  const roofLabour = catalogue.labour.roofPerM2 * roofArea;
  const trimLabour = (tr.fasciaLabourPerM + tr.soffitLabourPerM + tr.gutteringLabourPerM) * trimLength;
  const labourSubtotal = claddingLabour + roofLabour + trimLabour;

  const scaffolding = catalogue.scaffoldingCost;
  const waste = materialsSubtotal * catalogue.wastePct;
  const subtotal = materialsSubtotal + labourSubtotal + scaffolding + waste;
  const vat = subtotal * catalogue.vatPct;
  const total = subtotal + vat;

  return {
    cladding: Math.round(claddingMaterial + claddingLabour),
    roof: Math.round(roofMaterial + roofLabour),
    trim: Math.round(trimMaterial + trimLabour),
    scaffolding: Math.round(scaffolding),
    waste: Math.round(waste),
    vat: Math.round(vat),
    total: Math.round(total),
    footprintM2: claddingArea,
    trimLengthM: trimLength,
    selections: {
      cladding: `${cladding.name} (${cladding.materialLabel})`,
      trim: `${trim.name} (Fascia/Soffit/Guttering)`,
      roof: `${roof.name} (${roof.materialLabel})`
    }
  };
}

/* Which wall area sizes the quote, in priority order:

     1. A figure the homeowner typed in. Their own house, their own number —
        and the Terms say the manual entry is the override.
     2. A measurement this server produced for their photo, looked up by
        detectionId so the client can't send an area of its own.
     3. The generic default footprint from catalogue.json.

   Returns the source as well, so the lead records how the figure was arrived
   at rather than presenting an estimate as if it were measured. */
function resolveFootprint({ footprintM2, detectionId, houseType }) {
  const manual = Number(footprintM2);
  if (Number.isFinite(manual) && manual > 0) {
    return { m2: manual, source: 'manual_entry', measurement: null, exact: true };
  }
  const record = detectionId ? detectionRecords.get(String(detectionId)) : null;
  if (record && record.measurement) {
    return {
      m2: record.measurement.m2,
      source: `photo_${record.measurement.method}`,
      measurement: record.measurement,
      exact: true,
    };
  }
  // Before we've seen the house, a house type is a far better basis than one
  // generic footprint: catalogue.defaultFootprintM2 is 95 m², which matches
  // none of our own priors (terrace 50, end 80, semi 85, detached 130) and so
  // is a precise-looking figure for no particular house. Not exact, so the
  // caller shows a range rather than a single number.
  if (houseType !== undefined && houseType !== null && String(houseType) !== '') {
    const key = measure.houseTypeKey(houseType);
    const prior = measure.HOUSE_TYPE_PRIORS[key];
    return {
      m2: prior.wallM2,
      source: 'house_type_prior',
      houseType: key,
      houseTypeLabel: prior.label,
      measurement: null,
      exact: false,
    };
  }
  return { m2: null, source: 'default_footprint', measurement: null, exact: false };
}

/* When the wall area is a typical figure rather than this house's, quote a
   range. Price isn't proportional to area — scaffolding is fixed and VAT
   rides on top — so recompute at each end rather than scaling the total.
   ±25% matches the uncertainty measure.js already attaches to a prior. */
const PRIOR_AREA_UNCERTAINTY = 0.25;

function priceRange(selections, m2) {
  const area = m2 && m2 > 0 ? m2 : catalogue.defaultFootprintM2;
  const at = (a) => computePrice({ ...selections, footprintM2: a }).total;
  const round500 = (n) => Math.round(n / 500) * 500;
  return {
    low: round500(at(area * (1 - PRIOR_AREA_UNCERTAINTY))),
    high: round500(at(area * (1 + PRIOR_AREA_UNCERTAINTY))),
  };
}

/* ── POST /api/quote ── */
// Recomputes a price live from catalogue data as the user changes swatches —
// no AI call, instant. Real numbers (from catalogue.json), not a client guess.
app.post('/api/quote', (req, res) => {
  const { claddingId, trimId, roofId, footprintM2, trimLengthM, detectionId, houseType } = req.body || {};
  const footprint = resolveFootprint({ footprintM2, detectionId, houseType });
  const price = computePrice({ claddingId, trimId, roofId, footprintM2: footprint.m2, trimLengthM });
  res.json({
    ...price,
    footprintSource: footprint.source,
    measurement: footprint.measurement,
    houseType: footprint.houseType || null,
    houseTypeLabel: footprint.houseTypeLabel || null,
    // Only when the area is a typical figure rather than this house's. The
    // front end shows this instead of the exact total, so a number that looks
    // precise is never attached to a house we haven't seen.
    exact: footprint.exact,
    range: footprint.exact ? null : priceRange({ claddingId, trimId, roofId, trimLengthM }, footprint.m2),
  });
});

/* ── POST /api/detect ──
   Real AI detection via Claude vision. Requires ANTHROPIC_API_KEY. */
app.post('/api/detect', detectLimiter, async (req, res) => {
  const { image, mimeType, sessionId } = req.body || {};
  if (!image || !mimeType) return res.status(400).json({ error: 'Missing image or mimeType.' });
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowed.includes(mimeType)) return res.status(400).json({ error: 'Unsupported image type.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set — see .env.example.' });

  // Checked last, after validation, so a malformed request doesn't spend quota.
  if (!consumeDailyQuota('detect', res)) return res.status(429).json(dailyLimitBody('detect'));

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
            { type: 'text', text: `Detect every exterior architectural element on this UK home. Return ONLY a JSON array, no markdown. Detect ALL of these element types if visible:

- "window": any window
- "door-front": the main front door
- "roof": the main roof surface
- "cladding": exterior wall cladding/render/brick surface
- "fascia": the fascia board (under the roofline edge)
- "soffit": the soffit (underside of the roof overhang)
- "guttering": guttering/downpipes

Each item must have: {"type":"one of above","label":"short human label e.g. Main Roof","confidence":0.0-1.0,"x_pct":0-100,"y_pct":0-100,"w_pct":1-100,"h_pct":1-100,"notes":"one sentence description including material/colour if visible"}

Coordinates: x_pct/y_pct = top-left corner, w_pct/h_pct = width/height, all as % of image dimensions.

Finally add: {"type":"analysis","summary":"2-3 sentence overview of the property","era":"victorian|edwardian|inter-war|post-war|modern|contemporary","wallMaterial":"red-brick|yellow-brick|grey-brick|render|stone|pebbledash|timber|other"}` }
          ]
        }]
      })
    });
  } catch (err) {
    return res.status(502).json({ error: "Couldn't reach the detection service." });
  }

  if (!anthropicRes.ok) {
    let detail = '';
    try { detail = (await anthropicRes.json())?.error?.message || ''; } catch (_) {}
    console.error(`Anthropic error: HTTP ${anthropicRes.status} — ${detail}`);
    if (anthropicRes.status === 401) return res.status(500).json({ error: 'API key rejected.' });
    if (anthropicRes.status === 429) return res.status(429).json({ error: 'Rate limit hit — try again shortly.' });
    if (anthropicRes.status >= 500) return res.status(502).json({ error: 'Detection service error — try again.' });
    return res.status(502).json({ error: `Detection failed (HTTP ${anthropicRes.status}).${detail ? ' ' + detail : ''}` });
  }

  let data;
  try { data = await anthropicRes.json(); } catch (_) {
    return res.status(502).json({ error: 'Unreadable response from detection service.' });
  }

  const raw = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  const arrMatch = raw.replace(/```json|```/g, '').trim().match(/\[[\s\S]*\]/);
  let detections = [];
  if (arrMatch) {
    try { detections = JSON.parse(arrMatch[0]); } catch (_) {}
  }

  const elementCount = detections.filter(d => d.type !== 'analysis').length;
  await store.append('detections', { ts: new Date().toISOString(), sessionId: sessionId || null, elementCount, mimeType });

  // Aspect ratio comes from the image itself, never from the client.
  let size = null;
  try { size = measure.imageSize(Buffer.from(image, 'base64')); } catch (_) { /* unreadable header — measuring falls back */ }
  const detectionId = saveDetectionRecord(detections, size);

  // canMeasure tells the UI whether to offer the step at all, so we don't
  // invite someone to measure a photo we already know we can't scale.
  const hasDoor = detections.some(d => d.type === 'door-front');
  const hasWall = detections.some(d => d.type === 'cladding');

  res.json({ detections, detectionId, canMeasure: hasWall, scaleReference: hasDoor && !!size });
});

/* Conservatory styles are guide price RANGES, not a computed quote — there is
   nothing to calculate, so there's no endpoint for them; /api/catalogue serves
   the list and the page renders it.

   What does need care is the lead: resolve the style from our own catalogue by
   id so a submission can't attach an invented price to itself, the same rule
   computePrice follows. */
/* Window, door and roofline preferences. None of these change the quote —
   the pricing engine treats trim as a single sourced rate regardless of
   profile, and window/door pricing isn't modelled at all. They're captured
   because they tell the installer what the homeowner actually wants.

   Resolved from our own catalogue by id, so a lead can't invent a product or
   a price, and unknown ids drop out rather than being echoed back. */
function pick(list, id, fields) {
  if (!Array.isArray(list) || !id) return null;
  const found = list.find(x => x.id === id);
  if (!found) return null;
  return Object.fromEntries(fields.filter(f => found[f] !== undefined).map(f => [f, found[f]]));
}

function resolvePreferences(body) {
  const wd = catalogue.windowsDoors;
  const fs_ = catalogue.fsgc;
  const named = ['id', 'name'];
  const priced = ['id', 'name', 'pricePerM', 'guaranteeYears'];

  const windows = wd ? {
    style: pick(wd.windowStyles, body.windowStyleId, [...named, 'detail']),
    door: pick(wd.doorStyles, body.doorStyleId, [...named, 'detail']),
    colour: pick(wd.colours, body.windowDoorColourId, [...named, 'hex']),
  } : null;

  const roofline = fs_ ? {
    fascia: pick(fs_.fascia, body.fasciaId, priced),
    soffit: pick(fs_.soffit, body.soffitId, priced),
    guttering: pick(fs_.guttering, body.gutteringId, priced),
    cladding: pick(fs_.cladding, body.rooflineCladdingId, priced),
  } : null;

  const any = (o) => o && Object.values(o).some(Boolean);
  if (!any(windows) && !any(roofline)) return null;
  return {
    windows: any(windows) ? windows : null,
    roofline: any(roofline) ? roofline : null,
    // These are style choices, not a priced specification.
    note: 'Preferences only — the estimate uses our standard sourced specification.',
  };
}

function resolveConservatory(styleId) {
  const styles = catalogue.conservatories?.styles;
  if (!styles || !styleId) return null;
  const style = styles.find(s => s.id === styleId);
  if (!style) return null;
  return { id: style.id, name: style.name, priceMin: style.priceMin, priceMax: style.priceMax, indicative: true };
}

/* ── POST /api/whole-house ──
   A quicker path than the detailed visualiser: pick one finish for the whole
   house and see what it costs. The catalogue data for this has existed since
   July but nothing ever rendered it.

   The finish prices are the catalogue's own illustrative figures, and its note
   says so plainly — "White Render" at £45/m² is close to but not the same as
   the real Alabaster render at £50/m². The response carries that note and an
   `illustrative` flag so the UI can never present these as a sourced quote.

   The build-up around them is the real methodology though — same labour rate,
   scaffolding, waste and VAT as computePrice — because a bare materials figure
   would look far cheaper than the main quote for the same job and read as a
   better deal rather than a different calculation. */
app.post('/api/whole-house', (req, res) => {
  const wh = catalogue.wholeHouse;
  if (!wh) return res.status(503).json({ error: 'Whole-house finishes are not configured.' });

  const { finishId, areaM2, roofColourId, windowColourId } = req.body || {};
  const finish = wh.finishes.find(f => f.id === finishId) || wh.finishes[0];
  const roofColour = wh.roofColours.find(c => c.id === roofColourId) || wh.roofColours[0];
  const windowColour = wh.windowColours.find(c => c.id === windowColourId) || wh.windowColours[0];

  // Clamp rather than reject: the slider bounds are the sane range, and a
  // request outside them is a tampered or stale client, not a real house.
  const requested = Number(areaM2);
  const area = Number.isFinite(requested)
    ? Math.min(wh.areaMaxM2, Math.max(wh.areaMinM2, requested))
    : wh.areaDefaultM2;

  const materials = finish.pricePerM2 * area;
  const labour = catalogue.labour.claddingPerM2 * area;
  const scaffolding = catalogue.scaffoldingCost;
  const waste = materials * catalogue.wastePct;
  const subtotal = materials + labour + scaffolding + waste;
  const vat = subtotal * catalogue.vatPct;

  res.json({
    finish: { id: finish.id, name: finish.name, hex: finish.hex, pricePerM2: finish.pricePerM2, lightScore: finish.lightScore, bestFor: finish.bestFor, textureType: finish.textureType },
    roofColour, windowColour,
    areaM2: area,
    materials: Math.round(materials),
    labour: Math.round(labour),
    scaffolding: Math.round(scaffolding),
    waste: Math.round(waste),
    vat: Math.round(vat),
    total: Math.round(subtotal + vat),
    illustrative: true,
    note: wh.note,
  });
});

/* ── POST /api/measure ──
   Optional. Estimates exterior wall area from a photo already analysed by
   /api/detect, so the quote can be sized to the actual house instead of the
   generic default footprint.

   No AI call: this is geometry over the boxes /api/detect already returned,
   which is why it is not routed through the daily cap. If a segmentation
   model is ever added here, it must consume the cap like detect and render do.

   Always a planning estimate — the response carries a range and a caveat, and
   the UI must present it as such. */
app.post('/api/measure', (req, res) => {
  const { detectionId, houseType } = req.body || {};
  if (!detectionId) return res.status(400).json({ error: 'detectionId required.' });

  const record = detectionRecords.get(String(detectionId));
  if (!record) {
    return res.status(404).json({ error: 'That photo has expired — please upload it again to measure.' });
  }
  record.at = Date.now();   // still in use, keep it alive

  const result = measure.estimateWallArea({
    detections: record.detections,
    aspectRatio: record.aspectRatio,
    houseType,
    tuning: MEASURE_TUNING,
  });

  // Remembered against the record so /api/quote and /api/lead can use the
  // figure without the client being able to send one of its own.
  record.measurement = result;

  res.json({
    ...result,
    caveat: 'A planning estimate from your photo, not a survey. An installer confirms exact measurements on site.',
  });
});

/* ── POST /api/render ──
   Real AI render via Replicate FLUX Kontext Pro. Requires REPLICATE_API_TOKEN.
   Accepts { image: 'data:image/...;base64,...', mimeType, claddingName, trimName, roofName } */
app.post('/api/render', renderLimiter, async (req, res) => {
  const { image, mimeType, claddingName, trimName, roofName } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image required' });
  if (typeof image !== 'string' || image.length < 10) return res.status(400).json({ error: 'Invalid image data.' });
  if (image.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 20MB).' });

  const replicateKey = process.env.REPLICATE_API_TOKEN;
  if (!replicateKey) return res.status(500).json({ error: 'REPLICATE_API_TOKEN not set — see .env.example.' });

  // Checked last, after validation, so a malformed request doesn't spend quota.
  if (!consumeDailyQuota('render', res)) return res.status(429).json(dailyLimitBody('render'));

  const cladding = claddingName || 'Alabaster';
  const trim = trimName || 'Ink Trim';
  const roof = roofName || 'Slate Roof';

  const prompt = [
    `Replace the exterior wall cladding with a photorealistic ${cladding} finish, the window/door trim with ${trim} coloured trim, and the roof material with ${roof}.`,
    `Critically: preserve the exact perspective, shadow direction, ambient lighting colour temperature, lens distortion, camera exposure, and depth of field of the original photograph.`,
    `The windows, doors, garden, path, sky and every other element must remain completely untouched and pixel-perfect to the original — only the wall cladding, trim colour, and roof material change.`,
    `Shadows and reflections must remain consistent with the existing light source angle and intensity.`,
    `The result must be indistinguishable from a real installation photograph.`
  ].join(' ');

  const inputImage = image.startsWith('data:') ? image : `data:${mimeType || 'image/jpeg'};base64,${image}`;

  try {
    const controller = new AbortController();
    const renderTimeout = setTimeout(() => controller.abort(), 120000);

    const predRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${replicateKey}`, 'Content-Type': 'application/json', 'Prefer': 'wait=90' },
      body: JSON.stringify({ input: { prompt, input_image: inputImage, output_format: 'jpg', safety_tolerance: 5 } })
    });
    clearTimeout(renderTimeout);

    if (!predRes.ok) {
      const err = await predRes.json().catch(() => ({}));
      console.error('Replicate render error:', predRes.status, err);
      return res.status(502).json({ error: `Render failed (${predRes.status}).` });
    }

    const pred = await predRes.json();
    if (pred.status === 'succeeded' && pred.output) {
      const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      return res.json({ url });
    }

    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
        headers: { 'Authorization': `Bearer ${replicateKey}` }
      });
      const p = await poll.json();
      if (p.status === 'succeeded') {
        const url = Array.isArray(p.output) ? p.output[0] : p.output;
        return res.json({ url });
      }
      if (p.status === 'failed') return res.status(502).json({ error: 'Render failed — try again.' });
    }
    return res.status(504).json({ error: 'Render timed out — try again.' });

  } catch (err) {
    console.error('Render error:', err);
    return res.status(502).json({ error: "Couldn't reach the render service." });
  }
});

/* ── POST /api/lead ──
   Real lead capture. Recomputes price server-side (never trusts client price),
   stores it, emails the owner via Resend if configured, fires a CRM webhook if configured. */
app.post('/api/lead', leadLimiter, async (req, res) => {
  const { name, email, phone, postcode, claddingId, trimId, roofId, footprintM2, trimLengthM, measurementSource, detections, renderUrl, notes, consent, detectionId, conservatoryStyleId } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
  // UK GDPR: consent to pass details to installers must be freely given and
  // recorded. No tick, no lead — and we store the exact wording agreed to.
  if (!consent || consent.given !== true) {
    return res.status(400).json({ error: 'Please tick the box to agree before saving your design.' });
  }

  const footprint = resolveFootprint({ footprintM2, detectionId });
  const price = computePrice({ claddingId, trimId, roofId, footprintM2: footprint.m2, trimLengthM });

  const lead = {
    ts: new Date().toISOString(),
    id: `LD-${Math.floor(2000 + Math.random() * 9000)}`,
    name, email, phone: phone || '', postcode: postcode || '',
    selections: price.selections,
    price: price.total,
    priceBreakdown: price,
    // Server's own view of where the area came from — the client-sent
    // measurementSource is kept only as a record of what the UI believed.
    measurementSource: footprint.source,
    clientMeasurementSource: measurementSource || null,
    wallMeasurement: footprint.measurement,
    // Present only if they showed interest in one — useful for the installer,
    // and priced from our catalogue rather than whatever the client sent.
    conservatory: resolveConservatory(conservatoryStyleId),
    preferences: resolvePreferences(req.body || {}),
    detectionCount: Array.isArray(detections) ? detections.length : 0,
    renderUrl: renderUrl || null,
    notes: (notes || '').slice(0, 2000),
    consent: {
      given: true,
      at: new Date().toISOString(),
      wording: String(consent.wording || '').slice(0, 1000),
      version: String(consent.version || '').slice(0, 40)
    },
    status: 'New lead'
  };
  // Stored first, unconditionally — a notification problem must never cost a lead.
  await store.append('leads', lead);

  // Both emails run together: neither is allowed to delay the other, and
  // neither can fail the request — the lead is already saved.
  const [notification, designPack] = await Promise.all([
    notifyNewLead(lead, price),
    sendDesignPack(lead, price),
  ]);
  lead.notification = notification;
  lead.designPack = designPack;

  if (notification.attempted && !notification.sent) recordNotificationFailure(lead, notification, 'lead-notification');
  if (designPack.attempted && !designPack.sent) recordNotificationFailure(lead, designPack, 'design-pack');

  const crmWebhook = process.env.CRM_WEBHOOK_URL;
  if (crmWebhook) {
    fetch(crmWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead)
    }).catch(e => console.error('CRM webhook error:', e.message));
  }

  res.json({ ok: true, lead });
});

/* ── GET /api/leads ──
   Leads captured so far, newest first. Password-protected — see
   requireInstallerPassword above. */
app.get('/api/leads', installerLimiter, requireInstallerPassword, async (req, res) => {
  const leads = await store.readAll('leads');
  res.json({ leads: leads.slice().reverse() });
});

/* ── LEGAL PAGES ──
   Clean URLs for the privacy notice and terms. The files also sit under
   /legal/ via express.static, so each page carries a canonical tag pointing
   back here to keep search engines on one URL. */
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'legal', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'legal', 'terms.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Facet Pro server running on http://localhost:${PORT}`);
  console.log(`Daily caps — detect: ${DAILY_LIMITS.detect}, render: ${DAILY_LIMITS.render} ` +
              `(used today: ${usage.detect}/${usage.render}, UTC day ${usage.day})`);
  checkCatalogueAge();
  console.log(SITE_MODE === 'beta'
    ? 'Site mode: BETA — the badge and notice are shown. Set SITE_MODE=live to remove them.'
    : 'Site mode: LIVE — no beta badge.');
  logMeasureTuning();
  checkEmailConfig();
});
