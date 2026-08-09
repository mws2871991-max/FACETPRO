const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const store = require('./store');
const measure = require('./measure');
const emails = require('./emails');
const delivery = require('./delivery');
const retention = require('./retention');
const obs = require('./observability');
const installers = require('./installers');
const withdrawal = require('./withdrawal');
const routing = require('./routing');
const glazing = require('./glazing');
const resume = require('./resume');

const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8'));

/* These are real supplier and labour rates, not placeholders, which makes
   staleness the risk rather than obvious wrongness: quoting this year's jobs
   on last year's material prices looks entirely plausible and is silently
   wrong. Warn once at startup rather than let it drift unnoticed. */
const CATALOGUE_STALE_AFTER_DAYS = 180;

/* Are the window and door rates real yet?

   Every other rate in catalogue.json came from the production backend and
   says so in `source`. The glazing block arrived as plausible-looking
   inventions so the pricing module had something to run against, and it says
   so too. Producing a confident, itemised, VAT-inclusive figure from invented
   rates is the exact CPUTRs exposure the pricing comments elsewhere worry
   about — so the fact travels with the number, to the operator at startup and
   to the homeowner in the panel.

   Delete this the day a supplier rate card replaces them, along with the
   "source" line that makes it true. */
/* An explicit field rather than a reading of the prose beside it — see
   windowRatesSourced in glazing.js for why. Absent means not sourced. */
const GLAZING_RATES_SOURCED = catalogue.glazing?.sourced === true;

function checkGlazingRates() {
  if (!catalogue.glazing) return;
  if (GLAZING_RATES_SOURCED) {
    console.log(`Window and door rates: sourced (${catalogue.glazing.source}).`);
    return;
  }
  console.warn('Window and door rates are PLACEHOLDERS — catalogue.glazing.source says so. Every window estimate is labelled as a guide until a supplier rate card replaces them. Ask your installers for one.');
}

/* The gallery makes a factual claim; can we back it up?

   index.html says of the eight before/after photographs: "Real homes. Real
   work. No showroom. Photographs, not renders." That is an objective claim in
   an advertisement, and the CAP Code and the CPUTRs both expect it to be
   substantiable before publication rather than after somebody asks.

   The swatches have assets/swatches/CREDITS.md. The gallery had nothing, and
   the files carry no EXIF, so nothing on disk could answer it either way.

   Warned rather than refused: the claim may well be perfectly true and only
   undocumented, and taking the site down over a missing markdown file would be
   the wrong trade. But it says so on every boot until somebody settles it. */
function checkGalleryProvenance() {
  let page = '';
  try { page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); } catch (_) { return; }
  if (!/Photographs, not renders/i.test(page)) return;

  let provenance = '';
  try { provenance = fs.readFileSync(path.join(__dirname, 'assets', 'work', 'PROVENANCE.md'), 'utf8'); }
  catch (_) { /* absent, which is the loudest case */ }

  const unknowns = (provenance.match(/UNKNOWN/g) || []).length;
  if (!provenance) {
    console.warn('The homepage claims the gallery is "Photographs, not renders" and assets/work/PROVENANCE.md does not exist. That claim is unsubstantiated.');
  } else if (unknowns) {
    console.warn(`Gallery provenance is INCOMPLETE — ${unknowns} UNKNOWN entries in assets/work/PROVENANCE.md, while the homepage claims "Real homes. Real work. Photographs, not renders." Substantiate it or change the wording.`);
  }
}

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
// "X-Powered-By: Express" on every response tells an attacker what to target
// and tells nobody else anything.
app.disable('x-powered-by');
app.set('trust proxy', 1);

// No CORS headers: the front end is served from this same origin, so it never
// needs them. Sending `Access-Control-Allow-Origin: *` only let any website
// read these endpoints from a visitor's browser.

/* Photographs need room; nothing else does. This was one global 20 MB, so
   every endpoint on the site would accept a 20 MB body and parse it before
   any handler saw it. */
app.use(['/api/detect', '/api/render'], express.json({ limit: '12mb' }));
app.use(express.json({ limit: '128kb' }));

/* ── STATIC FILES ──
   Deny by default. Serving __dirname wholesale published the entire project —
   data/leads.jsonl (bypassing the /api/leads password outright), server.js,
   store.js, catalogue.json and the package files were all downloadable.

   Only these are public: the two HTML pages, robots/sitemap, /assets and
   /legal. Anything else 404s. */
const PUBLIC_FILES = new Set([
  '/index.html',
  /* guided-demo.html used to sit in the repository, deliberately absent from
     this list. It was an unmaintained fork of the product UI: it asked for a
     real email address and posted it to /api/lead with no consent object,
     derived a name by splitting the address on "@", and linked to neither the
     privacy notice nor the terms.

     It is now deleted rather than merely unlisted. The only thing standing
     between that file and a live form collecting personal data with no lawful
     basis was one entry missing from a set, and this codebase has spent a
     week finding things guarded by exactly that kind of arrangement — a CSS
     class nothing set, robots.txt used as access control, a CI job nobody
     read. A file that must never be served is safest when it does not exist.

     It is in the git history if the walkthrough copy is ever wanted back. */
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

/* Cache what cannot go stale, revalidate what can.

   Everything was served `max-age=0`, so roughly a megabyte of fonts and
   photographs was revalidated on every visit — cheap per file and a lot of
   round trips on a phone, on the first screen a homeowner sees.

   The split is by whether the name changes when the content does. It does not
   here: `assets/app.css` keeps its name across deploys, so a long max-age on
   it would leave people looking at the previous stylesheet with the current
   markup, which is worse than any number of round trips. Fonts and the
   before/after photographs are different — a WOFF2 or a JPEG under a fixed
   name is replaced by adding a file, not by editing one, so they can be held
   for a year and revalidated by ETag if they ever are.

   If the stylesheet ever gets a content hash in its filename, it belongs in
   the immutable set and not before. */
const IMMUTABLE = /\.(woff2?|ttf|otf|eot|jpe?g|png|gif|webp|avif|svg|ico)$/i;

const serveStatic = express.static(__dirname, {
  dotfiles: 'deny',   // .env, .git, .gitignore — never served
  index: 'index.html',
  redirect: false,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (IMMUTABLE.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      /* HTML, CSS and JS: revalidate every time. ETag makes that a 304 with no
         body, which is the cost of one round trip rather than the file. */
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  },
});

/* ── SECURITY HEADERS ──
   Article 32 asks for measures appropriate to the risk, and for a site
   handling contact details and photographs of people's homes these are the
   floor rather than the ceiling.

   Written out rather than pulled in through helmet: it is a dozen headers,
   the policy differs between the app and the legal pages, and a reader can
   see exactly what is set and why without going to another repository.

   Two policies, because the pages are genuinely different. Neither loads
   anything from another origin any more: the app used to pull Tailwind from a
   CDN and compile it in the browser, which meant granting 'unsafe-eval' and
   allowlisting that origin — on the same page that keeps the installer
   password in sessionStorage. Anything executing there could read the one
   credential that unlocks every consenting homeowner's contact details. The
   stylesheet is built now, so both are gone.

   'unsafe-inline' remains on script-src for the app: the page is a single
   file with its inline module, and splitting it out is a separate change.
   Script execution is at least confined to bytes we served. */

const CSP_APP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://replicate.delivery",   // renders, before we have stored them
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const CSP_LEGAL = [
  "default-src 'self'",
  "script-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

/* Pages that are nothing but text, and so can carry the policy with
   script-src 'none'. /investors is here for the same reason /privacy is: it
   runs no JavaScript, so it should not be permitted any. */
const isLegalPath = (p) => p === '/privacy' || p === '/terms' || p === '/investors' || p.startsWith('/legal/');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', isLegalPath(req.path) ? CSP_LEGAL : CSP_APP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  /* No referrer across origins: the withdrawal link carries its token in the
     query string, and a full referrer would hand it to anything that page
     ever loads. */
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  /* HSTS only where TLS is actually terminated. Sending it from a plain-http
     local server would pin a developer's browser to https://localhost. */
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || !isPublicPath(req.path)) return next();
  serveStatic(req, res, next);
});

/* ── RATE LIMITERS ── */
/* Ten a minute is the right number for a homeowner and the wrong number for a
   test that sends one photograph fifteen times on purpose. Overridable so the
   suite can have its own budget; unset everywhere else, which is where it
   should stay. */
const detectLimiter = rateLimit({
  /* Through envLimit like every other tuneable, rather than Number(...) || 10.
     That idiom turns "0" into 10 and "banana" into 10 silently, which is the
     opposite of what the same file does two hundred lines down for
     DAILY_DETECT_LIMIT — where a bad value is named in a warning and the
     default is used deliberately. One convention, not two. */
  windowMs: 60 * 1000, max: envLimit('DETECT_RATE_LIMIT', 10),
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
/* Withdrawing has to stay easy — Article 7(3) says as easy as giving consent
   was — so this is loose enough never to block a real person changing their
   mind, and tight enough that the token isn't worth guessing at 2^192. */
/* Someone checking two or three postcodes is a homeowner comparing houses.
   Someone checking hundreds is mapping our buyers' coverage. */
const coverageLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many checks — please wait a minute.' }
});
const withdrawLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please wait a minute and try again.' }
});
/* Everything cheap and unauthenticated.

   Separate instances, one per kind of traffic. express-rate-limit keys on IP
   per limiter, not per path, so a single app.use over seven paths was one
   shared budget of 120 — and a homeowner clicking through swatches would
   spend it on /api/quote and then find their own render 429ing. Verified: 121
   calls to /api/catalogue and both /api/quote and /r/:id were refused.

   The budgets follow the traffic. Prices update on every swatch tap, so they
   get the largest; the catalogue is fetched once a session. /r is images
   rather than API calls — a page showing a render and an email client
   fetching the same URL must never collide with swatch traffic.

   /healthz is deliberately outside all of it: a platform health check must
   never be throttled, and its disk probe is cached instead. */
const perMinute = (max, message) => rateLimit({
  windowMs: 60 * 1000, max,
  standardHeaders: true, legacyHeaders: false,
  message: { error: message },
});

app.use(['/api/config', '/api/catalogue'], perMinute(60, 'Too many requests — please wait a moment.'));
app.use(['/api/quote', '/api/whole-house'], perMinute(240, 'Too many price checks — please wait a moment.'));
app.use('/api/glazing', perMinute(120, 'Too many requests — please wait a moment.'));
app.use('/api/measure', perMinute(60, 'Too many requests — please wait a moment.'));
app.use('/r', perMinute(300, 'Too many requests — please wait a moment.'));

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

const USAGE_FILE = path.join(store.DATA_DIR, 'usage.json');
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
/* Where someone writes when the automated route fails them. The notice names
   an address, so this must be the same one. */
const PRIVACY_EMAIL = process.env.PRIVACY_EMAIL || LEAD_NOTIFY_EMAIL || 'privacy@facetpro.co.uk';
const SITE_URL = process.env.SITE_URL || 'https://facetpro.co.uk';

/* The homeowner's copy of their design. Off unless email is configured, and
   refused outright on Resend's test sender, which can only deliver to your own
   account — sending homeowner mail through it would fail for every real
   customer while looking configured. The site asks the server whether this is
   on (see /api/config) so the form never promises an email we can't send. */
/* Two different questions, and conflating them is what broke withdrawal.

   HOMEOWNER_EMAIL_ENABLED is "can we reach this person at all". It is what
   the withdrawal link depends on, so turning the design pack off must not
   take withdrawal with it. */
const HOMEOWNER_EMAIL_ENABLED =
  !!process.env.RESEND_API_KEY &&
  !LEAD_FROM_EMAIL.includes(RESEND_TEST_SENDER);

const DESIGN_PACK_ENABLED = process.env.DESIGN_PACK_EMAIL !== 'off' && HOMEOWNER_EMAIL_ENABLED;

function checkEmailConfig() {
  // Logged first and unconditionally: "is the customer getting their design?"
  // should be answerable from the startup output in every configuration.
  console.log(DESIGN_PACK_ENABLED
    ? `Homeowner design-pack emails: ON (from ${LEAD_FROM_EMAIL}, links to ${SITE_URL})`
    : `Homeowner design-pack emails: OFF${process.env.DESIGN_PACK_EMAIL === 'off'
        ? ' (DESIGN_PACK_EMAIL=off)'
        : ' — needs RESEND_API_KEY and a LEAD_FROM_EMAIL on a verified domain'}`);

  /* Louder than it looks. Without homeowner email there is no withdrawal
     link, so the installer-quotes box is hidden and that consent is refused —
     which is the whole revenue path. */
  console.log(HOMEOWNER_EMAIL_ENABLED
    ? 'Installer quotes: available (the withdrawal link can be delivered).'
    : 'Installer quotes: UNAVAILABLE — no homeowner email, so no withdrawal link, so that consent is refused and the box is hidden. This is the paid path; fix it before launch.');

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

/* The homeowner's email. Never blocks storing the lead.

   One email, not two, and which one depends on what they asked for:

     design pack           they ticked "email me my design"
     sharing confirmation  they ticked "get me quotes" but not the design pack

   The second case is why this exists. The design pack used to be the only
   email a homeowner ever received, so someone who wanted quotes but not a
   picture had their details sent to three companies and got nothing at all —
   no record of it, and no withdrawal link. Article 7(3) asks that withdrawing
   be as easy as consenting; consenting was one tick, and withdrawing was
   impossible.

   Both carry the withdrawal link, and both name the installers, which the
   notice promises. */
async function sendHomeownerEmail(lead, price, withdrawToken, recipients) {
  const wantsPack = lead.consent?.emailPack === true;
  const wantsQuotes = lead.consent?.installerQuotes === true;
  /* Asked for quotes, and nobody covers them. The site says so before they
     ask, but the box is still tickable — and the one email they must not get
     is the one headed "we've sent your enquiry on". They used to get exactly
     that: an empty installer list rendered nothing, so the template fell
     through to "we're passing your details to installers who cover your
     area", while the code already knew none did. */
  const nobodyCovers = wantsQuotes && !(recipients || []).length;
  if (!wantsPack && !wantsQuotes) {
    return { attempted: false, sent: false, reason: 'homeowner asked for neither' };
  }
  if (!HOMEOWNER_EMAIL_ENABLED) {
    return { attempted: false, sent: false, reason: 'homeowner email not configured' };
  }

  const pack = wantsPack && DESIGN_PACK_ENABLED;
  const kind = pack ? 'design pack' : (nobodyCovers ? 'no-installers notice' : 'sharing confirmation');
  if (!pack && !wantsQuotes) {
    // Wanted the pack, the pack is switched off, and nothing was shared —
    // there is nothing to confirm and no sharing to withdraw from.
    return { attempted: false, sent: false, reason: 'design pack switched off' };
  }

  try {
    const id = await sendEmail({
      to: lead.email,
      replyTo: LEAD_NOTIFY_EMAIL || undefined,
      subject: pack ? emails.designPackSubject(lead)
        : (nobodyCovers ? emails.noInstallersSubject(lead) : emails.sharingConfirmationSubject(lead)),
      html: pack
        ? emails.designPackHtml(lead, price, SITE_URL, withdrawToken, recipients)
        : (nobodyCovers
            ? emails.noInstallersHtml(lead, SITE_URL, withdrawToken)
            : emails.sharingConfirmationHtml(lead, recipients, SITE_URL, withdrawToken)),
      text: pack
        ? emails.designPackText(lead, price, SITE_URL, withdrawToken, recipients)
        : (nobodyCovers
            ? emails.noInstallersText(lead, SITE_URL, withdrawToken)
            : emails.sharingConfirmationText(lead, recipients, SITE_URL, withdrawToken)),
    });
    console.log(`Lead ${lead.id}: ${kind} sent to the homeowner.`);
    return { attempted: true, sent: true, id, kind };
  } catch (err) {
    console.error(`Lead ${lead.id}: ${kind} FAILED: ${err.message}`);
    return { attempted: true, sent: false, reason: err.message, kind };
  }
}


/* A lead that couldn't be delivered goes to its own file, so there's a durable
   list to work through rather than a console line nobody reads. Written with fs
   directly rather than through store.js: that module only knows a fixed set of
   table names, and routing this through it would also mean the failure log
   disappearing exactly when the database is the thing that's broken. */

/* ── LEAD DELIVERY ──
   Each lead goes to several buyers who pay per lead, so the delivery record is
   a billing record: it has to say what went where, whether it arrived, and how
   many attempts it took. A webhook that silently 500s is money gone. */

const { recipients: LEAD_RECIPIENTS, problems: RECIPIENT_PROBLEMS } =
  delivery.parseRecipients(process.env.LEAD_RECIPIENTS, { legacyUrl: process.env.CRM_WEBHOOK_URL });

/* The consent wording on the form says "up to three vetted installers covering
   my area". That sentence is the limit, not this setting — so the setting can
   lower it and cannot raise it. Raising the number would need the wording
   changed first, and then the people who already consented under the old
   wording are a separate problem again. */
const CONSENTED_MAX_INSTALLERS = 3;
const MAX_INSTALLERS_PER_LEAD = (() => {
  const raw = process.env.MAX_INSTALLERS_PER_LEAD;
  if (raw === undefined || raw === '') return CONSENTED_MAX_INSTALLERS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`MAX_INSTALLERS_PER_LEAD="${raw}" is not a whole number — using ${CONSENTED_MAX_INSTALLERS}.`);
    return CONSENTED_MAX_INSTALLERS;
  }
  if (n > CONSENTED_MAX_INSTALLERS) {
    console.error(`MAX_INSTALLERS_PER_LEAD=${n} is more than the ${CONSENTED_MAX_INSTALLERS} the consent wording promises — using ${CONSENTED_MAX_INSTALLERS}. Change the wording on the form first, and remember it does not apply retrospectively.`);
    return CONSENTED_MAX_INSTALLERS;
  }
  return n;
})();

function checkRecipients() {
  RECIPIENT_PROBLEMS.forEach(p => console.error(`LEAD_RECIPIENTS: ${p}`));
  if (!LEAD_RECIPIENTS.length) {
    console.warn('No lead recipients configured — leads are stored but sent to nobody. Set LEAD_RECIPIENTS.');
    return;
  }
  // Names and coverage only. The URLs can carry auth tokens and must not reach a log.
  console.log(`Lead delivery: up to ${MAX_INSTALLERS_PER_LEAD} of ${LEAD_RECIPIENTS.length} recipient(s) per lead — ` +
    LEAD_RECIPIENTS.map(r => `${r.name} (${r.areas.length ? r.areas.join('/') : 'national'})`).join(', '));
  const national = LEAD_RECIPIENTS.filter(r => !r.areas.length);
  if (national.length && LEAD_RECIPIENTS.length > national.length) {
    console.log(`  ${national.length} of those claim national coverage, so they are eligible for every postcode. Worth having that in writing.`);
  }
}

/* Delivery and failure records hold homeowner details, so they go through
   store.js like leads do — that way "stored encrypted" is true of all of it
   under Postgres, not just the leads table. Never throws: losing the record
   silently is the one outcome that must not happen, so a write failure is
   logged loudly and the request carries on. */
async function record(table, row) {
  try {
    await store.append(table, row);
    return true;
  } catch (err) {
    console.error(`Could not record ${table}:`, err.message, JSON.stringify(row).slice(0, 300));
    return false;
  }
}

const planDelivery = (lead) => routing.chooseRecipients(LEAD_RECIPIENTS, lead, { max: MAX_INSTALLERS_PER_LEAD });

async function deliverAndRecord(lead, plan) {
  /* The whole point of a separate, optional box: if they didn't ask for
     quotes, nobody gets their details. Recorded either way, so there is a
     positive record of the decision rather than an absence. */
  if (!lead.consent?.installerQuotes) {
    await record('deliveries', {
      ts: new Date().toISOString(), leadId: lead.id, postcode: lead.postcode || null,
      total: 0, delivered: 0, failed: 0, results: [],
      withheld: 'no consent to share with installers',
    });
    console.log(`Lead ${lead.id}: not shared — no installer consent.`);
    return;
  }
  if (!LEAD_RECIPIENTS.length) return;

  /* "up to three vetted installers covering my area" — the consent is
     specific, so the routing has to be. Everything about the decision is
     recorded, including who was skipped and why: a buyer asking why they
     didn't get a lead deserves an answer, and so would the ICO. */
  /* Reuses the plan from the request rather than recomputing it: the
     homeowner has already been told, by name, who is getting their details. */
  const { chosen, routing: routingRecord } = plan || planDelivery(lead);
  if (!chosen.length) {
    await record('deliveries', {
      ts: new Date().toISOString(), leadId: lead.id, postcode: lead.postcode || null,
      total: 0, delivered: 0, failed: 0, results: [], routing: routingRecord,
      withheld: routingRecord.postcodeUsable
        ? 'no configured installer covers this area'
        : 'no usable postcode, and every installer is area-restricted',
    });
    console.warn(`Lead ${lead.id}: nobody to send to — ${routingRecord.postcodeUsable ? `no installer covers ${routingRecord.outward}` : 'no usable postcode'}.`);
    return;
  }

  let results;
  const { withdrawTokenHash: _hash, ...forInstaller } = lead;
  try {
    results = await delivery.deliverLead(forInstaller, chosen, { fetchImpl: (...a) => fetch(...a) });
  } catch (err) {
    // deliverTo never throws, so this is defensive — but losing the record
    // silently is the one outcome that must not happen.
    console.error(`Lead ${lead.id}: delivery crashed:`, err.message);
    await record('deliveries', { ts: new Date().toISOString(), leadId: lead.id, delivered: 0, failed: chosen.length, results: [], routing: routingRecord, crashed: err.message });
    return;
  }

  const s = delivery.summarise(results);
  await record('deliveries', {
    ts: new Date().toISOString(),
    leadId: lead.id,
    postcode: lead.postcode || null,
    price: lead.price ?? null,
    ...s,
    results,
    routing: routingRecord,
  });

  for (const r of results.filter(x => !x.ok)) {
    console.error(`Lead ${lead.id}: delivery to ${r.name} FAILED after ${r.attempts} attempt(s) — ${r.error}`);
    await record('deliveries', { kind: 'failure',
      ts: new Date().toISOString(), leadId: lead.id, recipientId: r.id, recipientName: r.name,
      attempts: r.attempts, status: r.status, error: r.error,
      name: lead.name, email: lead.email, phone: lead.phone, postcode: lead.postcode,
    });
  }
  if (s.delivered) console.log(`Lead ${lead.id}: delivered to ${s.delivered}/${s.total} recipient(s).`);
}

function recordNotificationFailure(lead, notification, kind = 'lead-notification') {
  return record('notificationFailures', {
    ts: new Date().toISOString(),
    kind,
    leadId: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    postcode: lead.postcode,
    price: lead.price,
    reason: notification.reason,
  }).then(ok => {
    if (ok) console.error(`Lead ${lead.id}: ${kind} failed and is recorded for follow-up.`);
    return ok;
  });
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
  /* Through envLimit, like the detection limiter and the daily caps. Twenty
     attempts a quarter of an hour is right for a person signing in and wrong
     for a suite that exercises every way a sign-in can be refused. */
  windowMs: 15 * 60 * 1000, max: envLimit('INSTALLER_RATE_LIMIT', 20),
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

/* ── THE INVESTOR PAGE ──

   /investors describes a pre-revenue UK company and itemises what money would
   be spent on. In the UK, communicating an invitation or inducement to engage
   in investment activity in the course of business is restricted by s.21 FSMA
   2000, and shares in an unlisted company are a controlled investment. The
   exemptions normally relied on — certified high net worth individual,
   self-certified sophisticated investor — need the recipient to certify
   BEFORE the communication reaches them, which a public URL cannot do.
   Breach is a criminal offence and can make the resulting agreement
   unenforceable against the investor.

   It shipped served to anybody. robots.txt carried `Disallow: /investors`
   with a comment saying "sent to people directly; not for search", which is a
   request to crawlers and not access control — an intention the server did
   not enforce. Exactly the shape of the .no-js rule guarded by a class
   nothing ever set: the comment described behaviour that did not exist.

   The file also moved out of legal/ and into gated/, because /legal/ is in
   PUBLIC_DIRS and express.static was serving legal/investors.html directly,
   underneath any gate on the route. A blocklist entry would have fixed that
   for as long as somebody remembered it; a directory that was never public
   fixes it by construction.

   404 rather than 401 when unconfigured, and 401 with no detail otherwise: a
   visitor who has not been sent the link should not learn the page exists.

   This is not legal advice, and whether a given page is a financial promotion
   is a solicitor's judgement. The fix is cheap and the shape is textbook, so
   it is gated now and the advice can follow. The FCA-prescribed risk warning
   and certification statement still need to go on the page itself. */
function requireInvestorPassword(req, res, next) {
  const expected = process.env.INVESTOR_PASSWORD;
  const notFound = () => res.status(404).type('html')
    .send('<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found.');

  if (!expected) {
    console.error('INVESTOR_PASSWORD is not set — refusing to serve /investors.');
    return notFound();
  }

  /* Unfinished means unserved, on a deployment. The two placeholders on that
     page are the exemption being relied on and the FCA-prescribed risk
     warning — the parts a solicitor supplies, and the parts that make the
     difference between a document and a financial promotion nobody may
     lawfully send. Checked per request rather than at boot so the file can be
     corrected without a restart, and so this never costs more than the page
     it protects. */
  if (IS_DEPLOYED) {
    const left = investorPageUnfinished();
    if (left.length) {
      console.error(`/investors requested, and refused: ${left.length} placeholder(s) still in it — ${left.map(s => s.slice(0, 40)).join(', ')}`);
      return notFound();
    }
  }

  const header = req.get('authorization') || '';
  const supplied = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    // A link that can be pasted into an email. Drop this if you would rather
    // hand the password over separately — it is the weakest part of the gate,
    // because a URL ends up in browser history and referrer headers.
    : (req.query.k || req.get('x-investor-password') || '');

  // Compared even when nothing was supplied, so a missing password takes the
  // same time as a wrong one.
  if (!constantTimeEquals(String(supplied), expected)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Facet Pro investors"');
    return notFound();
  }
  next();
}

/* The secret that signs installer tokens.

   Generated at startup when unset, which logs every installer out on each
   deploy. That is the right failure: a predictable default would let anyone
   who read the source mint a token for any installer, and an installer
   signing in again is an inconvenience. */
const INSTALLER_TOKEN_SECRET = process.env.INSTALLER_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.INSTALLER_TOKEN_SECRET) {
  console.warn('INSTALLER_TOKEN_SECRET is not set — installer sessions will end on every deploy. Set it to keep them signed in.');
}

/* Who is asking, or nobody.

   Accepts an installer token first. Falls back to INSTALLER_PASSWORD, which
   is the shared credential the portal used before accounts existed — kept so
   a deployment configured the old way keeps working, and marked as the whole
   estate rather than one installer, because that is what it grants. */
function identifyInstaller(req) {
  const header = req.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const supplied = bearer || req.get('x-installer-password') || '';
  if (!supplied) return null;

  const claim = installers.readToken(supplied, INSTALLER_TOKEN_SECRET);
  if (claim) {
    const who = LEAD_RECIPIENTS.find(r => r.id === claim.id);
    return who ? { id: who.id, name: who.name, scope: 'installer' } : null;
  }
  /* The shared password sees every consented lead, which is what one
     credential shared by every buyer has always meant. Once accounts exist it
     stops working on a deployment.

     Not tidiness. legal/privacy.html tells homeowners that each installer has
     their own account and sees only the enquiries sent to them. A shared
     password that still opened the whole estate would make that sentence
     false again the moment somebody used it — and this codebase has spent a
     week finding claims that nothing enforced. If the notice says it, the
     server has to mean it.

     Still works locally, because development needs a way in and no
     homeowner's details are behind it there. */
  const accountsExist = LEAD_RECIPIENTS.some(r => r.passwordHash);
  const shared = process.env.INSTALLER_PASSWORD;
  if (shared && constantTimeEquals(supplied, shared)) {
    if (accountsExist && IS_DEPLOYED) {
      obs.record('installer-login', 'shared password refused: installer accounts are configured');
      return null;
    }
    return { id: null, name: 'shared password', scope: 'all' };
  }
  return null;
}

function requireInstaller(req, res, next) {
  const who = identifyInstaller(req);
  if (!who) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Facet Pro installers"');
    return res.status(401).json({ error: 'Sign in to see your leads.' });
  }
  req.installer = who;
  next();
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

/* The same photograph, sent twice, used to come back different.

   The model is sampled, not deterministic, and `temperature` is deprecated on
   this model — so there is no dial to turn it down with. Five runs of one
   photograph through the live service found 5, 7, 7, 8 and 8 front windows,
   which priced the same house at £16,889–£30,707 on one run and
   £25,166–£45,757 on another. Forty-nine per cent apart, every one of them
   labelled "measured from your photo", and the homepage promising in as many
   words that the same house gets the same number.

   So the answer is remembered against the bytes of the image. Identical
   photograph, identical detection, identical price — not because the model
   settled down but because it is only asked once. A homeowner who reloads,
   goes back, or sends the link to their partner sees the figure they saw
   before, and it costs nothing to show them.

   Keyed on a hash of the image rather than the base64 text so a re-encode of
   the same bytes still hits. Bounded by the same TTL and ceiling as the
   records themselves, and cleared alongside them — a hash pointing at a record
   that has been pruned is a miss, not a crash. */
const detectionByImage = new Map();

/* How long a photograph's measurements are kept, so the same house keeps
   getting the same number after a deploy or a night's sleep.

   Seven days is a judgement, not a standard. Long enough to cover a reload, a
   deploy, and coming back tomorrow to show somebody — which is the behaviour
   that made the instability visible. Short enough that the table never becomes
   a lasting record of every house ever photographed, which is the thing worth
   not building. The rows hold a hash and some geometry and nothing that
   identifies anybody, and they are swept on every write. */
const DETECTION_CACHE_DAYS = 7;
const DETECTION_CACHE_MS = DETECTION_CACHE_DAYS * 24 * 60 * 60 * 1000;

function pruneDetectionRecords() {
  const cutoff = Date.now() - DETECTION_TTL_MS;
  for (const [id, rec] of detectionRecords) {
    if (rec.at < cutoff) detectionRecords.delete(id);
  }
  // Map preserves insertion order, so the oldest are first.
  while (detectionRecords.size > DETECTION_MAX) {
    detectionRecords.delete(detectionRecords.keys().next().value);
  }
  /* Drop any hash whose record has gone, so the cache cannot outgrow the thing
     it points into. */
  for (const [hash, id] of detectionByImage) {
    if (!detectionRecords.has(id)) detectionByImage.delete(hash);
  }
}

function imageFingerprint(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function saveDetectionRecord(detections, size) {
  const id = crypto.randomUUID();
  detectionRecords.set(id, {
    at: Date.now(),
    detections,
    aspectRatio: size && size.height > 0 ? size.width / size.height : null,
    measurement: null,
  });
  /* After the insert, not before. Pruning first meant the sweep saw the map at
     its limit, found nothing over, and then the new record pushed it one past
     — where it stayed until the next upload. Off by one, permanently. */
  pruneDetectionRecords();
  return id;
}

/* Wall-measurement tuning. The defaults in measure.js come from the prototype
   survey table; these let you recalibrate per house type without a code
   change, which is how you'd fold in real surveyed properties. */
/* Replicate's content filter, 0 (strictest) to 6 (most permissive). This was
   at 5 — near the top of the range — on a service where members of the public
   upload photographs of their homes, which routinely contain their children,
   their neighbours and their cars. The permissive end is for people generating
   their own images, not for a filter standing between an uploaded photograph
   of a real family home and a model.

   2 is Replicate's own default and the highest the API accepts for
   image-to-image work. Configurable, because if legitimate house photographs
   start being refused that is a product problem worth being able to fix
   without a deploy — but the default should be the cautious one. */
const RENDER_SAFETY_TOLERANCE = (() => {
  const raw = process.env.RENDER_SAFETY_TOLERANCE;
  if (raw === undefined || raw === '') return 2;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    console.error(`RENDER_SAFETY_TOLERANCE="${raw}" is not a whole number from 0 to 6 — using 2.`);
    return 2;
  }
  return n;
})();

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

/* Lead capture can be switched off so the site can be shown publicly before
   the privacy notice and terms are finished. The whole journey still
   demonstrates — photo, colours, estimate, render — but no name, email, phone
   or postcode is collected, which is the part that needs real legal pages.

   Defaults to on: a site that has quietly stopped capturing leads is its own
   kind of failure, so turning it off has to be deliberate. */
/* Off unless somebody says otherwise.

   This defaulted to on, with the argument that a site which has quietly
   stopped taking leads is its own kind of failure. That argument is fine and
   the conclusion was wrong, because the two failures are not the same size.

   Found out the hard way: the live Railway service had never had this
   variable set, so a public URL accepted names, emails, phone numbers and
   postcodes behind a privacy notice still containing [COMPANY LEGAL NAME] —
   into a container filesystem wiped on every deploy. Nobody set it wrongly.
   Nobody set it at all, and the default decided.

   A lost lead costs a hundred pounds and you find out. Quietly collecting
   personal data you cannot lawfully explain, or produce on request, is not
   recoverable. The default belongs on the side of the mistake you can undo. */
const LEAD_CAPTURE = (process.env.LEAD_CAPTURE || 'off').toLowerCase() !== 'off';

/* ── GET /healthz ──
   For the host's health check. Deliberately says almost nothing: whether the
   process is up, and whether the disk it needs is actually writable — which
   is the failure this deployment is most likely to hit, since a host without
   a mounted volume looks perfectly healthy right up until the first lead is
   silently lost. */
/* Deliberately outside the public rate limiter — a platform health check must
   never be throttled. The disk probe is cached instead: two synchronous
   syscalls per request is a poor trade when the answer changes about as often
   as the disk does, and health checks arrive every few seconds forever. */
let diskProbe = { at: 0, writable: false };
const DISK_PROBE_TTL_MS = 10_000;

function storageIsWritable() {
  const now = Date.now();
  if (now - diskProbe.at < DISK_PROBE_TTL_MS) return diskProbe.writable;
  let writable = false;
  try {
    // store.DATA_DIR, not a second guess at the same path — they must agree,
    // and the tests point it somewhere harmless.
    fs.mkdirSync(store.DATA_DIR, { recursive: true });
    fs.accessSync(store.DATA_DIR, fs.constants.W_OK);
    writable = true;
  } catch (_) { /* reported by the caller */ }
  diskProbe = { at: now, writable };
  return writable;
}

app.get('/healthz', (req, res) => {
  const storageWritable = storageIsWritable();
  res.status(storageWritable ? 200 : 503).json({
    ok: storageWritable,
    mode: SITE_MODE,
    storageWritable,
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    designPackEmail: DESIGN_PACK_ENABLED,
    /* Whether the installer-quotes box can be offered at all. Without email we
       cannot send the withdrawal link, so that consent is refused server-side
       — the form should not show a box that is going to be turned down. */
    installerQuotes: HOMEOWNER_EMAIL_ENABLED,
    beta: SITE_MODE === 'beta',
    leadCapture: LEAD_CAPTURE,
  });
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
  const pickFields = (obj, keys) => obj ? Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]])) : undefined;

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
      finishes: c.wholeHouse.finishes.map(f => pickFields(f, ['id', 'name', 'hex', 'textureType', 'pricePerM2', 'lightScore', 'bestFor', 'bestseller'])),
      roofColours: c.wholeHouse.roofColours.map(x => pickFields(x, ['id', 'name', 'hex'])),
      windowColours: c.wholeHouse.windowColours.map(x => pickFields(x, ['id', 'name', 'hex'])),
    },
    conservatories: c.conservatories && {
      note: c.conservatories.note,
      styles: c.conservatories.styles.map(s => pickFields(s, ['id', 'name', 'priceMin', 'priceMax', 'bestFor', 'footprint', 'lightPct', 'description', 'pros', 'cons'])),
    },
    windowsDoors: c.windowsDoors && {
      note: c.windowsDoors.note,
      windowStyles: c.windowsDoors.windowStyles.map(s => pickFields(s, ['id', 'name', 'detail', 'description'])),
      doorStyles: c.windowsDoors.doorStyles.map(s => pickFields(s, ['id', 'name', 'detail', 'description'])),
      colours: c.windowsDoors.colours.map(x => pickFields(x, ['id', 'name', 'hex'])),
    },
    fsgc: c.fsgc && Object.fromEntries([
      ['note', c.fsgc.note],
      ...['fascia', 'soffit', 'guttering', 'cladding'].map(k => [
        k, (c.fsgc[k] || []).map(i => pickFields(i, ['id', 'name', 'pricePerM', 'tagline', 'colours', 'guaranteeYears', 'bestseller'])),
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
/* What a house can plausibly be.

   computePrice was written never to trust a client-sent price — and then took
   the client's word for the area, which is the multiplier that produces the
   price. There was no bound at all: a request could ask for 100,000,000 m²
   and be answered with a £231bn estimate, stored, marked exact, emailed to
   the homeowner as their quote and POSTed to three installers who pay for it.

   The absurd number is not the danger. A plausible one is: a real house
   quoted at 40 m² instead of 95 produces a materially misleading price
   presented as a precise figure, which is what the CPUTRs exist for.

   Out-of-band values fall back to the measurement rather than being clamped
   to the boundary. Unlike the whole-house slider — which clamps, because a
   person dragging it has a legitimate reason to be at either end — there is
   no honest client that sends 600,000 m², so answering with 600 would dress
   a tampered request up as a real one. */
const { MANUAL_AREA_MIN_M2, MANUAL_AREA_MAX_M2, TRIM_LENGTH_MIN_M, TRIM_LENGTH_MAX_M } = require('./limits');

function computePrice({ claddingId, trimId, roofId, footprintM2, trimLengthM }) {
  const cladding = catalogue.cladding.find(c => c.id === claddingId) || catalogue.cladding[0];
  const trim = catalogue.trim.find(t => t.id === trimId) || catalogue.trim[0];
  const roof = catalogue.roof.find(r => r.id === roofId) || catalogue.roof[0];
  const area = Number(footprintM2);
  const claddingArea = Number.isFinite(area) && area >= MANUAL_AREA_MIN_M2 && area <= MANUAL_AREA_MAX_M2
    ? area : catalogue.defaultFootprintM2;
  const roofArea = claddingArea * 0.55; // roof area is typically smaller than wall footprint
  // Same reasoning as the wall area: the perimeter of a house is bounded too.
  const trimAsked = Number(trimLengthM);
  const trimLength = Number.isFinite(trimAsked) && trimAsked >= TRIM_LENGTH_MIN_M && trimAsked <= TRIM_LENGTH_MAX_M
    ? trimAsked : catalogue.defaultTrimLengthM;

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
  if (Number.isFinite(manual) && manual >= MANUAL_AREA_MIN_M2 && manual <= MANUAL_AREA_MAX_M2) {
    return { m2: manual, source: 'manual_entry', measurement: null, exact: true };
  }
  if (Number.isFinite(manual) && manual > 0) {
    console.warn(`Ignoring an implausible wall area of ${manual} m² — outside ${MANUAL_AREA_MIN_M2}–${MANUAL_AREA_MAX_M2}. Falling back to the measurement.`);
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

/* ── LEAD REFERENCES ──

   This used to be `LD-${Math.floor(2000 + Math.random() * 9000)}`: nine
   thousand possible values, drawn without checking, from a generator that was
   never meant to be unique. By the birthday paradox that is a coin flip at
   112 leads and a certainty by five hundred.

   It would not have been a cosmetic clash. lead.id is the join key for every
   cross-record operation here — withdrawal writes, retention, the erasure
   purge, the Article 19 notice, the billing reconciliation — and none of them
   tolerate a duplicate. Two homeowners sharing a reference means one of them
   clicking "delete everything" overwrites the other's record, consent
   evidence and withdrawal token included, silently.

   Sixty bits of CSPRNG entropy in Crockford's base32, which drops I, L, O and
   U so nothing is misread over the phone. Twelve characters, unambiguous, and
   unguessable — the four-digit version was also trivially enumerable. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newLeadId() {
  const bytes = crypto.randomBytes(8);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out = CROCKFORD[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return 'LD-' + out;
}

// Anthropic rejects images over 5MB, so anything larger is a wasted call and
// a wasted daily slot. Client-side downscaling makes this rare; the guard is
// what stops it costing anything when it happens.
const ANTHROPIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REPLICATE_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/* These three have to stay in this order, with room for base64's extra third:
   the body limit above the render ceiling above the detect ceiling. If the
   body limit ever drops below the base64 size of either, body-parser answers
   first with a generic message and the homeowner loses the one that tells them
   how big their photo actually was. */

/* ── IS THIS ACTUALLY AN IMAGE? ──

   Both paid endpoints used to take the client's word for it. /api/detect
   allowlisted the declared mimeType and then handed it to Anthropic as
   media_type; /api/render did not even allowlist it, and interpolated it into
   a data: URL for Replicate — or forwarded the client's own data: URL whole.
   Nothing anywhere looked at the bytes, so arbitrary base64 could be pushed
   through the API keys. The daily caps bound how much of that happens, not
   what it is.

   So the bytes are read, and what they say wins. A request whose declared type
   disagrees with its own header is refused rather than quietly corrected: at
   best it is a confused client, and there is no good reason to guess for it.

   Returns { ok: true, mime, width, height, buffer } or { ok: false, status,
   error } — never throws, because a malformed body is an ordinary request. */
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function readImage(image, declaredMime, { requireDeclared = true } = {}) {
  if (typeof image !== 'string' || image.length < 10) {
    return { ok: false, status: 400, error: 'Invalid image data.' };
  }
  // A data: URL carries its own type; anything after the comma is the payload.
  let payload = image;
  let dataUrlMime = null;
  const dataUrl = /^data:([a-z]+\/[a-z0-9.+-]+)?;base64,/i.exec(image);
  if (dataUrl) {
    dataUrlMime = dataUrl[1] ? dataUrl[1].toLowerCase() : null;
    payload = image.slice(dataUrl[0].length);
  } else if (image.startsWith('data:')) {
    return { ok: false, status: 400, error: 'Unsupported image encoding.' };
  }

  const declared = String(declaredMime || dataUrlMime || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (requireDeclared && !declared) return { ok: false, status: 400, error: 'Missing image or mimeType.' };
  if (declared && !ACCEPTED_IMAGE_TYPES.includes(declared)) {
    /* Name the format and say what to do about it.

       "Unsupported image type." is true and useless, and the type it refuses
       most often is HEIC — which is what an iPhone shoots by default. The
       upload button accepts image/*, which matches HEIC, so the picker offers
       it and the journey then stops at the first step with a sentence that
       gives a homeowner nothing to act on.

       Safari decodes HEIC, so the canvas downscale in the page converts it and
       this is never reached there. Chrome and Firefox cannot, so they fall
       back to the original bytes and land exactly here. */
    const heic = /hei[cf]|hevc/.test(declared);
    return {
      ok: false,
      status: 400,
      error: heic
        ? 'That looks like an iPhone photo (HEIC), which this browser can’t read. Open it in Photos and share or export it as JPEG, or try again in Safari.'
        : 'That file isn’t an image we can read. Please use a JPEG, PNG or WEBP.',
      reason: heic ? 'heic_not_supported' : 'unsupported_image_type',
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch (_) {
    return { ok: false, status: 400, error: 'Invalid image data.' };
  }
  if (!buffer.length) return { ok: false, status: 400, error: 'Invalid image data.' };

  const found = measure.sniffImage(buffer);
  if (!found) {
    return { ok: false, status: 400, error: 'That doesn’t look like an image. Please upload a JPEG, PNG, GIF or WebP photo.' };
  }
  if (declared && found.mime !== declared) {
    return { ok: false, status: 400, error: 'That file isn’t the type it says it is. Please upload the photo again.' };
  }
  return { ok: true, mime: found.mime, width: found.width, height: found.height, buffer, payload };
}

/* ── POST /api/detect ──
   Real AI detection via Claude vision. Requires ANTHROPIC_API_KEY. */
app.post('/api/detect', detectLimiter, async (req, res) => {
  const { image, mimeType, sessionId } = req.body || {};
  if (!image || !mimeType) return res.status(400).json({ error: 'Missing image or mimeType.' });
  const img = readImage(image, mimeType);
  if (!img.ok) return res.status(img.status).json({ error: img.error, ...(img.reason ? { reason: img.reason } : {}) });
  /* Before the quota, not after. consumeDailyQuota is irreversible, and a
     photo over the provider's limit is a request guaranteed to fail — so an
     8 MB phone picture spent one of fifty daily slots on a 400 from
     Anthropic. readImage has already decoded the buffer, so this is free. */
  if (img.buffer.length > ANTHROPIC_MAX_IMAGE_BYTES) {
    return res.status(413).json({
      error: 'That photo is too large to analyse — please use one under 5MB.',
      reason: 'image_too_large',
    });
  }

  /* Have we already read this exact photograph? Answered before the quota and
     before the key, because a cached answer costs neither.

     Two places to look, in order of cheapness. The map is this process and
     lasts until it restarts; the table outlives a deploy, which is the whole
     point of it — the map alone meant a homeowner who came back the next day,
     or simply after we shipped something, was quoted a different number for
     the same house. On a real photograph that was seven windows before a
     deploy and six after. */
  const fingerprint = imageFingerprint(img.buffer);
  const answer = (record, id) => res.json({
    detections: record.detections,
    detectionId: id,
    canMeasure: record.detections.some(d => d.type === 'cladding'),
    scaleReference: record.detections.some(d => d.type === 'door-front') && record.aspectRatio !== null,
  });

  const seenId = detectionByImage.get(fingerprint);
  const seen = seenId ? detectionRecords.get(seenId) : null;
  if (seen) return answer(seen, seenId);

  /* Not in this process — ask the store. A failure here is a cache miss and
     nothing more: the photograph still gets read, it just costs a call. */
  let stored = null;
  try {
    stored = await store.getDetectionCache(fingerprint, DETECTION_CACHE_MS);
  } catch (err) {
    obs.record('detect', 'could not read the detection cache', { reason: err.message });
  }
  if (stored) {
    const id = saveDetectionRecord(stored.detections, stored.aspectRatio !== null
      ? { width: stored.aspectRatio, height: 1 } : null);
    detectionByImage.set(fingerprint, id);
    return answer(detectionRecords.get(id), id);
  }

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
        /* 1200 was not enough and failed silently.

           The prompt used to ask for a "notes" sentence on every element,
           which nothing has ever read. A normal semi has a dozen elements, so
           the reply ran past the limit and stopped mid-object:

             {"type":"fascia","label":"Fascia

           The parser looks for a bracketed array, finds no closing bracket,
           and the JSON.parse failure was swallowed by an empty catch. So a
           perfectly good photograph of a perfectly ordinary house came back
           with zero detections and no error at all — the caller was told the
           house had nothing on it.

           Notes are gone from the prompt and the budget is four thousand,
           which fits about forty elements of pure geometry. */
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.payload } },
            { type: 'text', text: `Detect every exterior architectural element on this UK home. Return ONLY a JSON array, no markdown. Detect ALL of these element types if visible:

- "window": any window
- "door-front": the main front door
- "roof": the main roof surface
- "cladding": exterior wall cladding/render/brick surface
- "fascia": the fascia board (under the roofline edge)
- "soffit": the soffit (underside of the roof overhang)
- "guttering": guttering/downpipes

Each item must have exactly: {"type":"one of above","label":"short human label e.g. Main Roof","confidence":0.0-1.0,"x_pct":0-100,"y_pct":0-100,"w_pct":1-100,"h_pct":1-100}
Do not add any other keys, and do not describe anything in prose. Only the array.

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
    obs.record('detect', 'Anthropic refused the request', { status: anthropicRes.status, detail });
    console.error(`Anthropic error: HTTP ${anthropicRes.status} — ${detail}`);
    if (anthropicRes.status === 401) return res.status(500).json({ error: 'API key rejected.' });
    if (anthropicRes.status === 429) return res.status(429).json({ error: 'Rate limit hit — try again shortly.' });
    if (anthropicRes.status >= 500) return res.status(502).json({ error: 'Detection service error — try again.' });
    /* Everything else, including 400, without the upstream text. It used to
       be appended, and the first live call proved why that was wrong:

         Detection failed (HTTP 400). Your credit balance is too low to
         access the Anthropic API. Please go to Plans & Billing…

       A homeowner who uploaded a photograph of their house was shown the
       state of our account. The other branches above had all been written
       carefully; this one was the fallback, so it was the one nobody pictured
       a real person reading.

       The reason is already on the line above, in the log, where whoever can
       act on it will look. What reaches the browser is what the person can
       act on: nothing they did was wrong, and trying again is worth a go. */
    return res.status(502).json({ error: "We couldn't measure that photo just now — please try again." });
  }

  let data;
  try { data = await anthropicRes.json(); } catch (_) {
    return res.status(502).json({ error: 'Unreadable response from detection service.' });
  }

  const raw = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  const arrMatch = raw.replace(/```json|```/g, '').trim().match(/\[[\s\S]*\]/);
  let detections = [];
  let parseFailed = null;
  if (arrMatch) {
    try { detections = JSON.parse(arrMatch[0]); }
    catch (err) { parseFailed = err.message; }
  } else {
    parseFailed = 'no JSON array in the reply';
  }

  /* Silence here is what hid the truncation for as long as it lasted. An
     empty catch turns "the model was cut off mid-sentence" into "this house
     has no windows", and the caller cannot tell the difference — nor could
     anybody reading the logs, because there were none.

     Truncation is called out separately because it has a specific cause and a
     specific fix, and because it is the failure that will come back if the
     prompt ever grows again. */
  if (data.stop_reason === 'max_tokens') {
    obs.record('detect', 'the model was cut off before finishing the list', {
      outputTokens: data.usage?.output_tokens, parsed: detections.length,
    });
    console.error(`Detection truncated at max_tokens (${data.usage?.output_tokens} out) — the reply was cut off mid-array.`);
  }
  if (parseFailed) {
    obs.record('detect', 'could not read the detection list', { reason: parseFailed, replyChars: raw.length });
    console.error('Detection parse failed:', parseFailed, '— reply was', raw.length, 'chars');
    return res.status(502).json({ error: "We couldn't read your photo properly — please try again." });
  }

  const elementCount = detections.filter(d => d.type !== 'analysis').length;
  await store.append('detections', { ts: new Date().toISOString(), sessionId: sessionId || null, elementCount, mimeType: img.mime });

  // Aspect ratio comes from the image itself, never from the client — and it
  // was already read at the gate above, so there is nothing left to fail here.
  const size = { width: img.width, height: img.height };
  const detectionId = saveDetectionRecord(detections, size);
  detectionByImage.set(fingerprint, detectionId);

  /* Kept so a restart does not change the answer. Awaited rather than fired
     and forgotten: if this write fails the homeowner should still get their
     estimate, but we should know, because a silently unwritten cache is the
     bug this exists to fix wearing a disguise. */
  try {
    await store.putDetectionCache(fingerprint,
      { detections, aspectRatio: size && size.height > 0 ? size.width / size.height : null },
      DETECTION_CACHE_MS);
  } catch (err) {
    obs.record('detect', 'could not save the detection cache', { reason: err.message });
    console.error('Detection cache write failed:', err.message);
  }

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
function pickById(list, id, fields) {
  if (!Array.isArray(list) || !id) return null;
  const found = list.find(x => x.id === id);
  if (!found) return null;
  return Object.fromEntries(fields.filter(f => found[f] !== undefined).map(f => [f, found[f]]));
}

/* The glazing estimate for a lead. Recomputed server-side from our own
   detection record, so a client cannot send an installer a price we never
   quoted. Null when they chose nothing — most people will not. */
function resolveGlazing(body) {
  if (!catalogue.glazing) return null;
  if (!body.windowStyleId && !body.doorStyleId) return null;
  const record = body.detectionId ? detectionRecords.get(String(body.detectionId)) : null;
  try {
    const result = glazing.estimateGlazing({
      detections: record?.detections || [],
      // The record already holds the ratio — it does not hold `size`. Copying the
      // integration note's snippet verbatim read undefined here, which is not
      // an error, just a null: every estimate silently fell back to the
      // house-type prior while looking like it had measured the photograph.
      aspectRatio: record?.aspectRatio ?? null,
      houseType: body.houseType,
      selections: {
        windowStyleId: body.windowStyleId,
        doorStyleId: body.doorStyleId,
        windowDoorColourId: body.windowDoorColourId,
      },
      rates: catalogue.glazing,
      windowCountOverride: body.windowCount,
    });
    // The per-window geometry is ours to work with, not the installer's to
    // read — they get the count, the bands and the money.
    const { windows, ...summary } = result;
    return { ...summary, ratesSourced: GLAZING_RATES_SOURCED };
  } catch (err) {
    console.error('Could not attach a glazing estimate to the lead:', err.message);
    return null;
  }
}

function resolvePreferences(body) {
  const wd = catalogue.windowsDoors;
  const fs_ = catalogue.fsgc;
  const named = ['id', 'name'];
  const priced = ['id', 'name', 'pricePerM', 'guaranteeYears'];

  const windows = wd ? {
    style: pickById(wd.windowStyles, body.windowStyleId, [...named, 'detail']),
    door: pickById(wd.doorStyles, body.doorStyleId, [...named, 'detail']),
    colour: pickById(wd.colours, body.windowDoorColourId, [...named, 'hex']),
  } : null;

  const roofline = fs_ ? {
    fascia: pickById(fs_.fascia, body.fasciaId, priced),
    soffit: pickById(fs_.soffit, body.soffitId, priced),
    guttering: pickById(fs_.guttering, body.gutteringId, priced),
    cladding: pickById(fs_.cladding, body.rooflineCladdingId, priced),
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

/* Replicate's output URLs are public and expire within the hour, so linking
   to one meant three things at once: a photorealistic image of an identified
   person's home sitting at an unauthenticated URL, a design-pack email that
   breaks for anyone who opens it later, and a privacy notice claiming we keep
   the generated image when we kept a string that was already dead.

   So the bytes are fetched while the URL is still alive and stored by us,
   under an unguessable id. If fetching fails we fall back to returning
   Replicate's URL rather than losing the render entirely — the homeowner still
   sees it in that session, and the lead simply carries no render. */
async function ourRenderUrl(renderId) {
  if (!renderId) return null;
  const found = await store.getRender(renderId);
  return found ? `/r/${renderId}` : null;
}

async function keepRender(replicateUrl) {
  try {
    const res = await fetch(replicateUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error('empty body');
    const id = crypto.randomBytes(16).toString('hex');
    await store.putRender(id, bytes, { mime: res.headers.get('content-type') || 'image/jpeg' });
    return { url: `/r/${id}`, renderId: id };
  } catch (err) {
    /* Recorded, not just logged. This is the degraded path and it has a
       privacy consequence rather than only a quality one.

       When it fires, the homeowner still sees their render, which is the
       right priority. But the image is then sitting on the provider's CDN at
       an unauthenticated URL we do not control and cannot delete, and the
       privacy notice says the generated image is kept for the same period as
       the lead and then removed. A Replicate URL does not honour that — it
       expires on their schedule, not ours, and until it does the URL is the
       only credential protecting a photorealistic picture of somebody's
       identified home.

       It is also why the CSP has to allow replicate.delivery at all. If this
       turns out to be rare, that allowance can go and the fallback can become
       an honest failure instead. If it turns out to be common, that is a
       storage problem worth fixing before launch rather than a footnote. The
       only way to know which is to be able to count it, and a console.error
       nobody reads afterwards cannot. */
    obs.record('render', 'could not keep the render, fell back to the provider URL', { reason: err.message });
    console.error('Could not keep the render, falling back to the provider URL:', err.message);
    return { url: replicateUrl, renderId: null, ephemeral: true };
  }
}

/* ── GET /r/:id ──
   Serves a stored render. The id is 128 bits of randomness, so the URL is the
   capability — that is what lets it work in an email without a login, and it
   is still a great deal better than a public provider URL: we control who has
   it, how long it lives, and retention deletes it with its lead. */
app.get('/r/:id', async (req, res) => {
  const render = await store.getRender(req.params.id);
  if (!render) return res.status(404).json({ error: 'Not found.' });
  res.setHeader('Content-Type', render.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(render.bytes);
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
/* ── CARRYING A DESIGN TO A PHONE ──
   The choices, under a six-character code, for a day. No photograph and
   nothing identifying — see resume.js for why that is the whole point rather
   than a detail.

   Two rate limits, because the two directions are different requests: issuing
   is cheap and rare, redeeming is what someone would sit and guess at. */
const resumeIssueLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many codes — please wait a minute.' }
});
const resumeRedeemLimiter = rateLimit({
  windowMs: 60 * 1000, max: 15,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many tries — please wait a minute.' }
});

app.post('/api/resume', resumeIssueLimiter, async (req, res) => {
  const design = resume.buildPayload(req.body || {});
  if (!Object.keys(design).length) {
    return res.status(400).json({ error: 'There’s nothing to carry over yet — choose something first.', reason: 'nothing_to_save' });
  }
  const now = Date.now();
  const record = {
    ts: new Date(now).toISOString(),
    code: resume.newCode(),
    expiresAt: new Date(now + resume.TTL_MS).toISOString(),
    design,
  };
  try {
    await store.append('resumes', record);
  } catch (err) {
    console.error('Could not store a resume code:', err.message);
    return res.status(500).json({ error: 'We couldn’t make you a code just now.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ code: record.code, expiresAt: record.expiresAt });
});

app.get('/api/resume/:code', resumeRedeemLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!resume.isCode(req.params.code)) {
    return res.status(400).json({ error: 'That code doesn’t look right.', reason: 'bad_code' });
  }
  /* Use the index where there is one. getResume returns undefined on the
     JSONL backend, which has none, so that path still scans — but the
     database does not need to read every live code to find one row. */
  const wanted = resume.normaliseCode(req.params.code);
  let found;
  try { found = await store.getResume(wanted); } catch (_) { /* fall through */ }
  if (found === undefined) {
    let rows = [];
    try { rows = await store.readAll('resumes'); } catch (_) { /* none yet */ }
    found = resume.find(rows, wanted);
  } else if (found && resume.isExpired(found)) {
    found = null;
  }
  if (!found) {
    // Expired and never-existed are the same answer: there is nothing to tell
    // apart, and nothing worth confirming to somebody guessing.
    return res.status(404).json({ error: 'That code has expired or we don’t recognise it.', reason: 'not_found' });
  }
  res.json({ design: found.design, expiresAt: found.expiresAt });
});

/* ── POST /api/coverage ──
   "Do you have installers near me?", answered before anyone is asked for
   anything. The postcode box in the refine panel collected a postcode and did
   nothing with it; now that routing decides who receives a lead, the site can
   actually answer.

   A count, never names. Which companies buy leads in which areas is
   commercially theirs, not ours to publish on a consumer page — and a
   homeowner is told exactly who received their details at the point it
   happens, which is the moment it matters.

   Runs the real routing rather than a lookalike, so what this promises is what
   delivery does. */
app.post('/api/coverage', coverageLimiter, (req, res) => {
  const parsed = routing.parsePostcode(req.body?.postcode);
  if (!parsed) {
    return res.status(400).json({ error: 'That doesn’t look like a UK postcode.', reason: 'unreadable_postcode' });
  }
  // Same decision the delivery would make, minus the lead.
  const { chosen } = routing.chooseRecipients(LEAD_RECIPIENTS, { id: 'coverage-check', postcode: parsed.outward + ' 1AA' },
    { max: MAX_INSTALLERS_PER_LEAD });
  res.json({
    outward: parsed.outward,
    installers: chosen.length,
    cap: MAX_INSTALLERS_PER_LEAD,
  });
});

/* ── POST /api/glazing ──
   A guide price for replacing the windows and the front door.

   Reads the boxes from our own detection record rather than the request, for
   the same reason /api/measure does: the client can send an id, not a
   geometry. Never returns nothing — worst case it falls back to the house-type
   prior and says so, because a homeowner who has just uploaded a photograph of
   their house should not be told the tool has no opinion about it.

   The rates behind this are not sourced. See the warning at startup and the
   caveat the client renders — every figure here is a guide until a supplier
   rate card replaces catalogue.glazing. */
app.post('/api/glazing', (req, res) => {
  const { detectionId, houseType, windowStyleId, doorStyleId, windowDoorColourId, windowCount, openerCount } = req.body || {};

  /* No style chosen, no price. The module will happily price a default set,
     which is the right behaviour for a module and the wrong one for an
     endpoint: a figure attached to a choice nobody made is the same problem
     as an email confirming a consent nobody gave. */
  if (!windowStyleId && !doorStyleId) {
    return res.status(400).json({ error: 'Choose a window or door style first.', reason: 'nothing_chosen' });
  }

  const record = detectionId ? detectionRecords.get(String(detectionId)) : null;

  try {
    const result = glazing.estimateGlazing({
      detections: record?.detections || [],
      // The record already holds the ratio — it does not hold `size`. Copying the
      // integration note's snippet verbatim read undefined here, which is not
      // an error, just a null: every estimate silently fell back to the
      // house-type prior while looking like it had measured the photograph.
      aspectRatio: record?.aspectRatio ?? null,
      houseType,
      selections: { windowStyleId, doorStyleId, windowDoorColourId },
      rates: catalogue.glazing,
      windowCountOverride: windowCount,
      openerCount,
    });
    res.json({ ...result, ratesSourced: GLAZING_RATES_SOURCED });
  } catch (err) {
    console.error('Glazing estimate failed:', err.message);
    res.status(500).json({ error: 'We couldn’t work out a window estimate for that photo.' });
  }
});

app.post('/api/measure', (req, res) => {
  const { detectionId, houseType } = req.body || {};
  if (!detectionId) return res.status(400).json({ error: 'detectionId required.' });

  /* One normalised key for all four operations.

     The lookup used String(detectionId) and the delete and set used the raw
     value. Send `{"detectionId": ["<a real uuid>"]}` and the array stringifies
     to the same text, so the lookup succeeds — then the delete finds no such
     key and does nothing, and the set inserts a *second* entry under an array
     key that nothing will ever match or evict. Sixty a minute, each holding a
     whole detections array, and the prune below is what stops it growing
     without bound. */
  const id = String(detectionId);
  const record = detectionRecords.get(id);
  if (!record) {
    return res.status(404).json({ error: 'That photo has expired — please upload it again to measure.' });
  }
  /* Still in use — and Map preserves insertion order, so touching the
     timestamp was not enough: eviction takes the oldest inserted, not the
     oldest used. Re-inserting moves it to the back of the queue, which is
     what "keep it alive" was supposed to mean. Someone measuring a photo they
     uploaded twenty minutes ago was getting "that photo has expired"
     mid-journey. */
  record.at = Date.now();
  detectionRecords.delete(id);
  detectionRecords.set(id, record);
  pruneDetectionRecords();

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
  const { image, mimeType, claddingName, trimName, roofName,
          windowStyleName, doorStyleName, windowDoorColourName } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image required' });
  if (typeof image !== 'string' || image.length < 10) return res.status(400).json({ error: 'Invalid image data.' });
  // Size is checked on the decoded bytes below, not on the base64 string —
  // that is a third larger, so this rejected photographs that were under the
  // limit and gave no way to work out why.
  /* The type is optional here because the client may send a data: URL that
     carries its own — but whatever it claims, the bytes decide. */
  const img = readImage(image, mimeType, { requireDeclared: false });
  if (!img.ok) return res.status(img.status).json({ error: img.error, ...(img.reason ? { reason: img.reason } : {}) });
  if (img.buffer.length > REPLICATE_MAX_IMAGE_BYTES) {
    return res.status(413).json({
      error: 'That photo is too large to render — please use one under 8MB.',
      reason: 'image_too_large',
    });
  }

  const replicateKey = process.env.REPLICATE_API_TOKEN;
  if (!replicateKey) return res.status(500).json({ error: 'REPLICATE_API_TOKEN not set — see .env.example.' });

  // Checked last, after validation, so a malformed request doesn't spend quota.
  if (!consumeDailyQuota('render', res)) return res.status(429).json(dailyLimitBody('render'));

  const cladding = claddingName || 'Alabaster';
  const trim = trimName || 'Ink Trim';
  const roof = roofName || 'Slate Roof';

  /* Windows and doors change only when the homeowner has actually chosen
     something for them.

     The prompt used to say, unconditionally, that "the windows, doors ...
     must remain completely untouched and pixel-perfect" — while every one of
     the four before-and-after photographs on the site is a window-frame
     recolour. The visualiser was instructed to refuse the transformation the
     site uses as its only proof.

     Conditional rather than a straight swap, because the cladding, roof and
     trim visualiser is a real product too and freezing the frames is the
     right instruction when nobody has asked for new ones. */
  const windowStyle = String(windowStyleName || '').trim();
  const doorStyle = String(doorStyleName || '').trim();
  const glazingColour = String(windowDoorColourName || '').trim();
  const changingGlazing = !!(glazingColour && (windowStyle || doorStyle));

  const glazingChange = changingGlazing
    ? `Replace the window frames${doorStyle ? ' and the front door' : ''} with photorealistic ${windowStyle || 'casement'} windows${doorStyle ? ` and a ${doorStyle} front door` : ''}, both in ${glazingColour}. Frame proportions and opening sizes must match the existing apertures exactly — do not resize, add or remove any window or door. Glass reflections must stay consistent with the original sky and surroundings.`
    : '';

  const untouched = changingGlazing
    ? 'The brickwork, garden, path, sky and every other element must remain completely untouched and pixel-perfect to the original — only the wall cladding, trim colour, roof material, window frames and door change.'
    : 'The windows, doors, garden, path, sky and every other element must remain completely untouched and pixel-perfect to the original — only the wall cladding, trim colour, and roof material change.';

  const prompt = [
    `Replace the exterior wall cladding with a photorealistic ${cladding} finish, the window/door trim with ${trim} coloured trim, and the roof material with ${roof}.`,
    glazingChange,
    `Critically: preserve the exact perspective, shadow direction, ambient lighting colour temperature, lens distortion, camera exposure, and depth of field of the original photograph.`,
    untouched,
    /* FLUX Kontext will happily "improve" a house by adding a window. A render
       showing an opening the homeowner does not have is a complaint waiting
       to happen, and it is the kind an installer discovers on survey. */
    `Do not add, remove, move or resize any window, door or other opening.`,
    `Shadows and reflections must remain consistent with the existing light source angle and intensity.`,
    `The result must be indistinguishable from a real installation photograph.`
  ].filter(Boolean).join(' ');

  // Rebuilt from what the bytes are, so a client-supplied data: URL is never
  // forwarded to Replicate verbatim.
  const inputImage = `data:${img.mime};base64,${img.payload}`;

  /* Everything below has to finish inside the server's own requestTimeout.

     It did not. Prefer: wait=60 could hold the initial request for a minute,
     then the loop below slept 45 times for two seconds — 150 seconds against a
     requestTimeout of 120, so the socket was closed under it and the homeowner
     saw the connection drop rather than the 504 written for them here.

     A deadline rather than a count, set below the server's limit with room
     left to store the image afterwards, so the two can no longer disagree. */
  const renderStartedAt = Date.now();
  const RENDER_DEADLINE_MS = 100_000;

  try {
    const controller = new AbortController();
    const renderTimeout = setTimeout(() => controller.abort(), 120000);

    /* clearTimeout in a finally, not after the await. A throw from the fetch
       skipped it and left a 120-second timer holding the process, pointed at
       an AbortController nobody was listening to any more. */
    let predRes;
    try {
      predRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
        method: 'POST',
        signal: controller.signal,
        /* wait=60, not 90. Replicate caps this header at 60 and rejects
           anything higher with a 422 before it looks at the request at all:

           Prefer: wait=x header must specify a value between 1 and 60

         So every render this application has ever attempted was refused, and
         the failure was invisible from outside — the endpoint answered
         "Render failed (422)", which reads like a bad photograph rather than
         a header we control. It surfaced only because the live host finally
         had a Replicate token, got far enough to be rejected on merit, and
         logged Replicate's own reason.

         Nothing is lost by asking for less: the polling loop below covers a
         further 90 seconds, so a render slower than the wait is picked up
         there exactly as it always was. */
        headers: { 'Authorization': `Bearer ${replicateKey}`, 'Content-Type': 'application/json', 'Prefer': 'wait=60' },
        body: JSON.stringify({ input: { prompt, input_image: inputImage, output_format: 'jpg', safety_tolerance: RENDER_SAFETY_TOLERANCE } })
      });
    } finally {
      clearTimeout(renderTimeout);
    }

    if (!predRes.ok) {
      const err = await predRes.json().catch(() => ({}));
      obs.record('render', 'Replicate refused the render', { status: predRes.status, detail: err?.detail });
      console.error('Replicate render error:', predRes.status, err);
      /* Not the upstream status. "Render failed (422)" reads to a homeowner
         as though their photograph was rejected, and it was nothing of the
         sort — it was a header this code sent. The number belongs in the log
         line above, which is where it was eventually found. */
      return res.status(502).json({ error: "We couldn't create that image just now — please try again." });
    }

    const pred = await predRes.json();
    if (pred.status === 'succeeded' && pred.output) {
      const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      return res.json(await keepRender(url));
    }

    /* Poll until the deadline.

       Three things went unchecked here. The poll had no timeout of its own —
       Node's fetch has no default, so one hung connection held the whole
       request until the socket died. Nothing looked at poll.ok, so a 429 or a
       500 parsed into an object with no status field, matched neither branch,
       and the loop went round again for the full ninety seconds against a
       provider that was refusing us — silently, and nowhere in the logs. And a
       cancelled prediction is a terminal state that was treated as "not
       finished yet", so it also ran the clock out.

       A run of upstream failures is now given up on rather than ridden out:
       three in a row is Replicate having a bad time, and telling somebody to
       try again is more honest than making them wait for the timeout. */
    let consecutiveFailures = 0;

    while (Date.now() - renderStartedAt < RENDER_DEADLINE_MS) {
      await new Promise(r => setTimeout(r, 2000));

      const pollController = new AbortController();
      const pollTimeout = setTimeout(() => pollController.abort(), 10000);
      let poll;
      try {
        poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
          headers: { 'Authorization': `Bearer ${replicateKey}` },
          signal: pollController.signal,
        });
      } catch (err) {
        /* A refused or hung poll is not a failed render — the prediction is
           still running at the other end — so this retries rather than giving
           up on the first one. */
        if (++consecutiveFailures >= 3) {
          obs.record('render', 'could not reach Replicate while polling', { attempts: consecutiveFailures });
          return res.status(502).json({ error: "We couldn't create that image just now — please try again." });
        }
        continue;
      } finally {
        clearTimeout(pollTimeout);
      }

      if (!poll.ok) {
        if (++consecutiveFailures >= 3) {
          obs.record('render', 'Replicate kept refusing the status check', { status: poll.status });
          console.error('Replicate poll error:', poll.status);
          return res.status(502).json({ error: "We couldn't create that image just now — please try again." });
        }
        continue;
      }
      consecutiveFailures = 0;

      const p = await poll.json().catch(() => null);
      if (!p) continue;

      if (p.status === 'succeeded') {
        const url = Array.isArray(p.output) ? p.output[0] : p.output;
        return res.json(await keepRender(url));
      }
      /* Terminal either way. Waiting out the clock on a prediction that has
         already stopped is ninety seconds of a homeowner watching a spinner. */
      if (p.status === 'failed' || p.status === 'canceled') {
        obs.record('render', 'the render did not complete', { status: p.status, detail: p.error });
        return res.status(502).json({ error: 'Render failed — try again.' });
      }
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
  /* Refused before anything is read, so nothing the homeowner typed is
     logged, stored or even parsed into a lead object. The point of the
     switch is that no personal data is handled at all. */
  if (!LEAD_CAPTURE) {
    return res.status(503).json({
      error: 'We’re not taking details just yet — we’re finishing our privacy policy first. Everything else here works, so do have a look around.',
      reason: 'lead_capture_off',
    });
  }

  const { claddingId, trimId, roofId, footprintM2, trimLengthM, measurementSource, detections, renderId, notes, consent, detectionId, conservatoryStyleId } = req.body || {};

  /* Trimmed and capped at the boundary, once, before any of it is stored,
     interpolated into an email or POSTed to an installer.

     notes and the consent wording were already capped; these four were not,
     and a 500,000-character name is accepted by Postgres TEXT, breaks the
     lead notification at most email providers, and is re-read and re-parsed
     on every retention run and every withdrawal. Generous versions of real
     limits: E.164 is 15 digits plus formatting, a UK postcode is at most 8
     characters, and RFC 5321 caps an address at 254. */
  const cap = (value, max) => String(value ?? '').trim().slice(0, max);
  const name = cap(req.body?.name, 100);
  const email = cap(req.body?.email, 254);
  const phone = cap(req.body?.phone, 32);
  const postcode = cap(req.body?.postcode, 12).toUpperCase();

  if (!name || !email) return res.status(400).json({ error: 'name and email are required.' });
  // {2,} on the last label: the old pattern accepted a@b.c.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
  /* Only agreement to the Terms is required. Passing details to installers is
     a separate, optional consent — making it a condition of saving at all made
     it a condition of the service, which is the Article 7(4) problem: consent
     obtained that way is not freely given.

     So a lead saves with installerQuotes false. It simply is not delivered to
     anyone, which is what the homeowner asked for. */
  if (!consent || consent.terms !== true) {
    return res.status(400).json({ error: 'Please agree to the Terms before saving your design.' });
  }
  /* Refused rather than accepted quietly, and refused before anything is
     stored. If we cannot email them, we cannot send the withdrawal link, and
     the notice promises "the link in any email from us" — so taking this
     consent would mean sharing their details with three companies while
     leaving them no way to stop it. The same instinct as refusing to start
     live without a database: do not accept a promise you cannot keep. */
  /* Asked for quotes, but we do not know where they are. Without a postcode
     the routing can only reach installers claiming national coverage, so the
     consent they gave — "installers covering my area" — is not one we could
     honour. Checked here rather than only in the browser, because the browser
     is not where the promise lives. */
  if (consent.installerQuotes === true && !routing.parsePostcode(postcode)) {
    return res.status(400).json({
      error: 'Please add your postcode so we can find installers who cover your area.',
      reason: 'postcode_required_for_quotes',
    });
  }
  if (consent.installerQuotes === true && !HOMEOWNER_EMAIL_ENABLED) {
    console.error('Refused installer-quotes consent: homeowner email is not configured, so no withdrawal link could be sent. Set RESEND_API_KEY and a LEAD_FROM_EMAIL on a verified domain.');
    return res.status(503).json({
      error: 'We can’t pass your details to installers just now — our email isn’t set up, and we won’t share your details without being able to send you a link to undo it. Untick that box and your design will save as normal.',
      reason: 'withdrawal_link_undeliverable',
    });
  }

  const footprint = resolveFootprint({ footprintM2, detectionId });
  const price = computePrice({ claddingId, trimId, roofId, footprintM2: footprint.m2, trimLengthM });

  /* The raw token goes into their email and nowhere else; we keep the hash.
     Otherwise the withdrawal link would be readable by anything that can read
     a lead, including the installer portal. */
  const { token: withdrawToken, hash: withdrawTokenHash } = withdrawal.newToken();

  const lead = {
    ts: new Date().toISOString(),
    id: newLeadId(),
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
    /* The window and door estimate, recomputed here rather than taken from
       the request — the same rule as the wall area. It is what the homeowner
       was shown, so the installer should see the same figure and know which
       method produced it. */
    glazing: resolveGlazing(req.body || {}),
    preferences: resolvePreferences(req.body || {}),
    detectionCount: Array.isArray(detections) ? detections.length : 0,
    /* Was whatever URL the browser sent. Now an id we issued, checked against
       our own store — the server generated the render and should not be told
       about it by the client. */
    renderUrl: await ourRenderUrl(renderId),
    notes: (notes || '').slice(0, 2000),
    /* Each answer recorded separately, with the exact wording shown for each
       and the version tag — that is what makes it evidence rather than a
       boolean. Withdrawal is recorded the same way when it happens. */
    consent: {
      at: new Date().toISOString(),
      version: String(consent.version || '').slice(0, 40),
      terms: consent.terms === true,
      installerQuotes: consent.installerQuotes === true,
      emailPack: consent.emailPack === true,
      wording: typeof consent.wording === 'object' && consent.wording
        ? Object.fromEntries(Object.entries(consent.wording).slice(0, 5).map(([k, v]) => [k, String(v).slice(0, 800)]))
        : { legacy: String(consent.wording || '').slice(0, 1000) },
      /* Hashed, not raw. A consent record is kept six years; the access log
         hashes IPs and keeps them twelve months, so storing a raw address
         here treated the same identifier two different ways in one codebase
         — with the stricter treatment on the less sensitive record. The hash
         still evidences that two consents came from the same place, which is
         what it is for. */
      ipHash: req.ip ? crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 12) : null,
    },
    withdrawTokenHash,
    status: 'New lead'
  };
  // Stored first, unconditionally — a notification problem must never cost a lead.
  await store.append('leads', lead);

  /* Worked out before the email rather than inside the delivery that follows
     it, so we can name the installers to the homeowner — the notice says "we
     will tell you which installers received your details" — and so the email
     and the delivery cannot disagree about who that is. */
  const plan = lead.consent.installerQuotes ? planDelivery(lead) : null;

  // Both emails run together: neither is allowed to delay the other, and
  // neither can fail the request — the lead is already saved.
  const [notification, homeownerEmail] = await Promise.all([
    notifyNewLead(lead, price),
    sendHomeownerEmail(lead, price, withdrawToken, plan?.chosen),
  ]);
  lead.notification = notification;
  lead.homeownerEmail = homeownerEmail;

  if (notification.attempted && !notification.sent) recordNotificationFailure(lead, notification, 'lead-notification');
  if (homeownerEmail.attempted && !homeownerEmail.sent) recordNotificationFailure(lead, homeownerEmail, homeownerEmail.kind || 'homeowner-email');

  /* Deliver to every buyer, after responding rather than before — the
     homeowner shouldn't wait on three third-party webhooks. The lead is
     already stored, so nothing is lost if the process dies mid-delivery; the
     reconciliation log below is what tells you it needs re-sending. */
  deliverAndRecord(lead, plan).catch(err =>
    console.error(`Lead ${lead.id}: delivery threw after the response:`, err?.stack || err?.message || err));

  /* The hash is ours. It is no use to an installer and no use to the browser,
     and the fewer places a credential's shadow appears the better. */
  const { withdrawTokenHash: _hash, ...publicLead } = lead;
  res.json({ ok: true, lead: publicLead });
});

/* ── RETENTION ──
   The notice states periods; this enforces them. Runs once at startup and
   daily after, and logs what it did — "we delete on schedule" needs evidence
   like any other claim.

   store.js is append-only by design, so a run rewrites the leads store rather
   than deleting rows in place. That is fine at this scale and keeps one code
   path for both backends; it would need revisiting at a size where rewriting
   is expensive. */
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runRetention({ dryRun = false } = {}) {
  let leads = [], accessLog = [];
  try { leads = await store.readAll('leads'); } catch (_) { return null; }
  try { accessLog = await store.readAll('accessLog'); } catch (_) { /* none yet */ }

  const p = retention.plan(leads, accessLog);
  if (!p.redact.length && !p.delete.length && !p.accessLogExpired) {
    return { kept: p.keep, redacted: 0, deleted: 0, accessLogRemoved: 0, dryRun };
  }

  const summary = {
    ts: new Date().toISOString(),
    kept: p.keep,
    redacted: p.redact.length,
    deleted: p.delete.length,
    accessLogRemoved: p.accessLogExpired,
    rendersRemoved: 0,
    dryRun,
  };

  if (!dryRun) {
    const toDelete = new Set(p.delete.map(l => l.id));
    const toRedact = new Map(p.redact.map(l => [l.id, retention.redactLead(l)]));
    /* Inside the lock, and applied to the rows as they are rather than to the
       ones the plan was made from. A run takes a moment, and a lead saved in
       that moment must not be deleted by a plan made before it existed. */
    await store.mutate('leads', (rows) => rows
      .filter(l => !toDelete.has(l.id))
      .map(l => toRedact.get(l.id) || l));

    /* Renders belong to their lead. A deleted or redacted lead must not leave
       a photorealistic image of someone's home sitting in storage behind an
       unguessable-but-permanent URL. */
    const goneRenderIds = [...p.delete, ...p.redact]
      .map(l => (l.renderUrl || '').match(/^\/r\/([A-Za-z0-9_-]+)$/)?.[1])
      .filter(Boolean);
    if (goneRenderIds.length) {
      const removed = await store.deleteRenders(goneRenderIds);
      summary.rendersRemoved = removed;
    }

    /* The copies, which retention had been leaving behind.

       purgeLeadPii existed and was called from exactly one place — the
       withdrawal handler. So a homeowner who asked to be erased had their
       delivery-failure and notification-failure rows scrubbed, and a
       homeowner who simply reached the end of the retention period did not.
       Their name, email, phone and postcode stayed on file indefinitely,
       past the periods the privacy notice states, and survived the redaction
       that is supposed to leave only the consent record.

       Installer webhooks fail sometimes by nature, so this was not an edge
       case. What hid it was a passing test: withdrawal.test.js covers
       "erasure reaches the copies, the render and the ancillary records" and
       covers it only down the withdrawal path, which reads as though the
       whole subject is handled.

       Both sets, deleted and redacted. A deleted lead is gone from `leads`
       entirely, so anything of theirs left elsewhere is unreferenced personal
       data; a redacted one is meant to keep the consent record and nothing
       else. */
    const erasedIds = new Set([...p.delete, ...p.redact].map(l => l.id).filter(Boolean));
    if (erasedIds.size) {
      try { await purgeLeadPiiFor(erasedIds); }
      catch (err) { console.error('Retention: could not purge ancillary records:', err.message); }
    }

    /* Resume codes hold no personal data, so this is housekeeping rather
       than retention — but a store that only grows is its own problem. */
    try {
      await store.mutate('resumes', (rows) => {
        const live = rows.filter(r => !resume.isExpired(r));
        return live.length === rows.length ? undefined : live;
      });
    } catch (_) { /* table may not exist yet */ }

    if (p.accessLogExpired) {
      await store.mutate('accessLog', (rows) => rows.filter(r => !retention.isExpired(r, retention.PERIODS.accessLogDays)));
    }
    // The deletion itself is evidence that the policy is enforced.
    await record('retentionRuns', summary);
  }

  console.log(`Retention: kept ${summary.kept}, redacted ${summary.redacted}, deleted ${summary.deleted}, access-log rows removed ${summary.accessLogRemoved}${dryRun ? ' (dry run)' : ''}.`);
  return summary;
}

/* ── ACCESS LOGGING ──
   The privacy notice says access to enquiries is logged. Two endpoints expose
   personal data — the leads list and the delivery record — and both are behind
   the installer password, so this records every successful read of them.

   Deliberately minimal: when, which endpoint, how many records were returned,
   and a truncated hash of the IP. The full address isn't needed to investigate
   a concern, and storing it makes the log itself a bigger liability than the
   thing it protects. Kept 12 months, per the notice. */
function logAccess(endpoint) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode !== 200) return;      // refusals aren't access
      record('accessLog', {
        ts: new Date().toISOString(),
        endpoint,
        status: res.statusCode,
        ipHash: crypto.createHash('sha256').update(String(req.ip || '')).digest('hex').slice(0, 12),
        userAgent: String(req.get('user-agent') || '').slice(0, 120),
      });
    });
    next();
  };
}

/* ── GET /api/deliveries ──
   Reconciliation. At £100 a delivery this is what you invoice against and
   what you check when a buyer says they never received something.

   Same password gate as the leads list. Recipient URLs are never included —
   they can carry auth tokens, and nobody reading this needs them. */
app.get('/api/deliveries', installerLimiter, requireInstallerPassword, logAccess('/api/deliveries'), async (req, res) => {
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
app.post('/api/installer/login', installerLimiter, async (req, res) => {
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

app.get('/api/leads', installerLimiter, requireInstaller, logAccess('/api/leads'), async (req, res) => {
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

  res.json({
    leads: leads.slice().reverse(),
    scope: req.installer?.scope || 'all',
    installer: req.installer?.id || null,
  });
});

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

app.get('/withdraw', withdrawLimiter, async (req, res) => {
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

app.post('/api/withdraw', withdrawLimiter, async (req, res) => {
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
  console.log(`Lead ${lead.id}: consent withdrawn (${scope}); ${notified.filter(n => n.ok).length}/${notified.length} recipient(s) notified.`);

  const message = scope === 'all'
    ? 'Your details have been deleted. We keep only a record that you asked us to, and what you originally agreed to — the law requires us to be able to show both.'
      + (received.length ? ' We have asked the installers who received your details to delete their copies.' : '')
    : scope === 'emailPack'
      ? 'We will not email you about this design again.'
      : 'We have stopped sharing your details, and told the installers who already received them.';

  res.json({ ok: true, at, scope, message, recipientsNotified: notified.length });
});

/* Erasure has to reach the copies too. The delivery-failure and notification-
   failure records each carry a name, an email and a phone number so a failed
   lead can be chased by hand — which is exactly why they cannot be left behind
   when the lead itself is erased.

   Takes a set rather than one id because retention erases in batches, and a
   loop would be two table mutations per lead. One pass per table, however
   many leads. */
async function purgeLeadPiiFor(leadIds) {
  const ids = leadIds instanceof Set ? leadIds : new Set([leadIds].flat());
  if (!ids.size) return;
  const scrub = (row) => {
    if (!ids.has(row?.leadId)) return row;
    const { name, email, phone, postcode, ...rest } = row;
    return { ...rest, erased: true };
  };
  for (const table of ['deliveries', 'notificationFailures']) {
    try {
      await store.mutate(table, (rows) =>
        rows.some(r => ids.has(r?.leadId)) ? rows.map(scrub) : undefined);
    } catch (_) { /* table may not exist yet */ }
  }
}

const purgeLeadPii = (leadId) => purgeLeadPiiFor(new Set([leadId]));

/* ── LEGAL PAGES ──
   Clean URLs for the privacy notice and terms. The files also sit under
   /legal/ via express.static, so each page carries a canonical tag pointing
   back here to keep search engines on one URL. */
/* ── GET /api/ops ──

   The answer to "is anything broken", in one request, behind the same
   password as the installer area.

   Thirty-seven console.error sites existed before this and there was no way
   to read any of them without a platform log viewer. The render was refused
   by Replicate for the entire life of the codebase and nobody knew, because
   knowing required somebody to be watching at the moment it happened. This is
   the version where you can look afterwards.

   Behind the installer password rather than open: the counts alone tell an
   outsider how much traffic there is and what is failing, which is nobody's
   business. Behind the SAME password because a second one is a second thing
   to lose, and this is an operator surface either way.

   /healthz stays open and stays dumb — a platform health check must not
   depend on anything that can be slow or wrong. */
/* installerLimiter, like every other route behind this password.

   It was the one gated route without it: sixty wrong passwords got sixty 401s
   and no throttle at all, while /api/leads next door refuses after twenty. The
   same password opens every consenting homeowner's name, email, phone number
   and postcode, so an unthrottled guess-as-fast-as-you-like endpoint against it
   is the whole login throttle undone by the door nobody looked at. */
app.get('/api/ops', installerLimiter, requireInstallerPassword, (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json({
    ...obs.summary({ limit }),
    usage: { day: usage.day, detect: usage.detect, render: usage.render, caps: DAILY_LIMITS },
    storage: store.hasDb ? 'postgres' : 'jsonl files (lost on restart without a volume)',
    leadCapture: LEAD_CAPTURE ? 'on' : 'off',
    siteMode: SITE_MODE,
  });
});

app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'legal', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'legal', 'terms.html')));
/* Gated — see requireInvestorPassword. noindex and robots.txt remain, but
   they were never the control; they only keep it out of search results.
   Served from gated/, which is not in PUBLIC_DIRS, so there is no static path
   to the file. Listed in isLegalPath above so it serves under
   script-src 'none', which is what a page of pure text should get. */
app.get('/investors', requireInvestorPassword, (req, res) =>
  res.sendFile(path.join(__dirname, 'gated', 'investors.html')));

/* ── NOT FOUND, AND THINGS GOING WRONG ──
   Registered last, after every route, because Express matches in order.

   There was no error handler at all, so Express's default took over: an HTML
   page containing the stack trace, the absolute path of the deployment
   directory and the exact version of whatever dependency threw. Two separate
   problems in one page.

   The disclosure is the obvious half. The other half is that this is a JSON
   API whose own front end calls res.json() unconditionally — so a homeowner
   whose phone photo exceeded the body limit saw "Unexpected token '<'"
   rather than "that photo is too large". That was a live bug on any modern
   phone camera.

   Errors the client caused are named plainly. Anything else gets a reference
   they can quote and we can grep for, and nothing else. */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).type('html').send(
    '<!doctype html><meta charset="utf-8"><title>Not found — Facet Pro</title>' +
    '<body style="font:16px/1.6 -apple-system,sans-serif;background:#FBF8F3;color:#0F1012;padding:40px">' +
    '<p>We couldn\'t find that page. <a href="/" style="color:#0F1012">Back to Facet Pro</a>.</p>');
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err?.type === 'entity.too.large') {
    /* Say the number that actually applies to what they just tried.

       This said 15MB on every route. Nothing here has ever had a 15MB limit:
       the photo endpoints take a 12mb body and everything else 128kb, and the
       gates immediately inside those endpoints refuse a photo over 5MB for
       detection and 8MB for rendering. So the one message a homeowner sees at
       the moment their phone picture is refused named a limit that does not
       exist, and was roughly three times the real one. */
    const cap = req.path === '/api/detect' ? '5MB'
      : req.path === '/api/render' ? '8MB'
      : null;
    return res.status(413).json(cap
      ? { error: `That photo is too large — please use one under ${cap}.`, reason: 'image_too_large' }
      : { error: 'That request was too large.', reason: 'body_too_large' });
  }
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Malformed request.' });
  }

  const ref = crypto.randomBytes(6).toString('hex');
  /* Recorded as well as logged. The log line is for whoever is watching at
     the time; the record is for whoever looks afterwards, which is the case
     that has never been served. */
  obs.record('request', err?.message || 'request failed', { ref, method: req.method, path: req.path });
  console.error(`[${ref}] ${req.method} ${req.path} failed:`, err?.stack || err?.message || err);
  res.status(500).json({ error: 'Something went wrong on our side.', ref });
});

/* ── STAYING UP, AND GOING DOWN CLEANLY ──

   None of this existed. A rejected promise nobody awaited, or a throw outside
   a request, killed the process with no log line — the platform restarts it
   and the cause is invisible. Delivery to installer webhooks is fired without
   await by design, so unhandled rejections were a matter of when.

   A crash is not always the wrong answer, but an undiagnosable one is. */
process.on('unhandledRejection', (reason) => {
  obs.record('crash', 'unhandled promise rejection: ' + (reason?.message || reason));
  console.error('Unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  /* Genuinely unexpected: the process may be in an unknown state, so log
     properly and let the platform restart us rather than limping on. */
  obs.record('crash', 'uncaught exception: ' + (err?.message || err));
  console.error('Uncaught exception — exiting:', err.stack || err.message);
  process.exit(1);
});

const PORT = process.env.PORT || 3000;
/* ensureSchema was exported but never called — with DATABASE_URL set, every
   insert would have hit a table that was never created. Awaited before the
   port opens, so the process fails loudly on a bad database rather than
   accepting leads it cannot store. */
/* Refuse to start rather than quietly contradict the notice.

   Without DATABASE_URL everything lands in JSONL files on the container:
   unencrypted, and on an ephemeral filesystem unless a volume is mounted. The
   privacy notice says enquiries are stored encrypted and backed up. A warning
   at startup does not stop a deployment, and nobody reads a warning in a log
   they only open when something is already wrong — so a live deployment that
   is taking personal data and cannot store it as promised is a failure, not a
   caution. Same instinct as SITE_MODE defaulting to beta. */
/* Is this a deployment, or somebody's laptop?

   Not SITE_MODE. The guards used to key off SITE_MODE=live, and what actually
   went wrong went wrong in beta: a public Railway URL, badge and all, taking
   real names and postcodes into storage a deploy erases. Beta is precisely
   the mode a site is in while it is unfinished and pointed at a real address.

   But refusing on a developer's machine because they have no Postgres would
   be its own kind of wrong, and a guard that stops people working gets
   switched off. So the question is whether anybody but the developer can
   reach this — which the platform will tell us, and NODE_ENV covers the rest. */
const IS_DEPLOYED = process.env.NODE_ENV === 'production'
  || !!(process.env.RAILWAY_ENVIRONMENT || process.env.RENDER || process.env.FLY_APP_NAME
        || process.env.DYNO || process.env.KUBERNETES_SERVICE_HOST);

function refuseToStartIfStorageContradictsTheNotice() {
  if (store.hasDb || !LEAD_CAPTURE) return;
  if (!IS_DEPLOYED) {
    console.warn('LEAD_CAPTURE=on with no DATABASE_URL — fine locally, refused on a deployment. Leads are going to plain files under data/.');
    return;
  }
  console.error([
    '',
    'REFUSING TO START.',
    '',
    'LEAD_CAPTURE=on, but DATABASE_URL is not set. Leads would be',
    'written to plain JSONL files on this container — not encrypted, and lost on the',
    'next deploy unless a volume is mounted. The privacy notice tells people their',
    'enquiry is stored encrypted and backed up, so this would make the notice untrue',
    'about data you had already collected.',
    '',
    /* Every line here has to be a remedy that actually works. This used to
       suggest SITE_MODE=beta, left over from when the guards keyed off the
       mode — and since they now key off whether this is a deployment, that
       advice did nothing at all. An operator on a staging box would set it,
       redeploy, get the identical message and learn nothing. Wrong
       instructions in an error are worse than no instructions. */
    'Do one of these:',
    '  · set DATABASE_URL   (the intended fix — Postgres, encrypted at rest)',
    '  · set LEAD_CAPTURE=off   (staging, or a public site that takes no details)',
    '',
  ].join('\n'));
  process.exit(1);
}

/* A notice that says [COMPANY LEGAL NAME] does not tell anyone who is
   processing their details, which is the first thing Article 13 asks for. So
   a live deployment collecting personal data behind an unfinished notice is a
   failure rather than a caution.

   .env.example already says to turn lead capture on only once the
   placeholders are gone — but that is a comment in a template, and templates
   get copied and edited. This is the structural version. */
/* Anchor on the brackets, not on what is inside them.

   The previous pattern enumerated the characters a placeholder may contain —
   /\[[A-Z][A-Z0-9 &;#/,.'’-]{2,60}\]/ — and enumerating was the mistake. It
   allowed & and ; so that HTML entities would pass, but an entity's name is
   lowercase and only A-Z was in the class, so &mdash; broke the match. It also
   capped the run at sixty characters, and had no literal em dash.

   Six real placeholders slipped through, and the startup line that reports the
   count was under-reporting by the same six. Three of them were the same
   field: the international-transfer mechanism in the privacy notice, which is
   the one that says under what legal instrument a homeowner's photograph
   reaches a company in the United States. Not a field to ship blank, and it
   was invisible to the guard written to prevent exactly that.

   A placeholder is defined by its brackets. Match those. */
const PLACEHOLDER = /\[[A-Z][^\]]{2,200}\]/g;

/* The pages the guard reads. investors.html is here because a financial
   promotion carrying [FCA-PRESCRIBED RISK WARNING] is a problem in the same
   way an unfinished privacy notice is — see the LEAD_CAPTURE note below for
   why it is checked on a different condition. */
const PAGES_WITH_PLACEHOLDERS = ['legal/privacy.html', 'legal/terms.html'];

const countPlaceholders = (page) => {
  try { return (fs.readFileSync(path.join(__dirname, page), 'utf8').match(PLACEHOLDER) || []).length; }
  catch (_) { return 0; }
};

/* The investor page, checked at the door rather than at startup.

   The first version of this refused to start when INVESTOR_PASSWORD was set
   and the page still had placeholders. That was the wrong lever, and it was a
   live hazard for about an hour: INVESTOR_PASSWORD is set on the deployment,
   the page does have two placeholders, and RAILWAY_ENVIRONMENT makes
   IS_DEPLOYED true — so the next restart would have taken the whole site down
   over one gated page that nobody had opened.

   Refusing to start is the right response to an unfinished privacy notice,
   because the alternative is collecting personal data behind it and there is
   no safe half-measure. It is the wrong response to an unfinished financial
   promotion, where there is an obvious one: do not serve that page. The
   homepage, the visualiser and the estimate have nothing to do with it.

   Proportion is the point. A guard that takes down more than the thing it is
   guarding gets deleted by whoever is on the end of the outage. */
function investorPageUnfinished() {
  const found = [...new Set((() => {
    try { return fs.readFileSync(path.join(__dirname, 'gated', 'investors.html'), 'utf8').match(PLACEHOLDER) || []; }
    catch (_) { return []; }
  })())];
  return found;
}

function refuseToStartIfTheNoticeIsUnfinished() {
  /* The legal pages only, and only when LEAD_CAPTURE is on — that is when
     somebody's details are taken behind them. */
  const pages = LEAD_CAPTURE ? PAGES_WITH_PLACEHOLDERS : [];
  if (!pages.length) return;

  if (!IS_DEPLOYED) {
    const left = pages.reduce((n, page) => n + countPlaceholders(page), 0);
    if (left) console.warn(`${left} placeholder(s) left in ${pages.join(', ')} — fine locally, refused on a deployment.`);
    return;
  }
  const unfinished = [];
  for (const page of pages) {
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, page), 'utf8'); } catch (_) { continue; }
    const found = [...new Set(html.match(PLACEHOLDER) || [])];
    if (found.length) unfinished.push(`  ${page} — ${found.length} left: ${found.slice(0, 6).join(', ')}${found.length > 6 ? ' …' : ''}`);
  }
  if (!unfinished.length) return;
  console.error([
    '',
    'REFUSING TO START.',
    '',
    'A page that has to be finished before it is served is not:',
    ...unfinished,
    '',
    'These are the pages people have to agree to before a lead can be saved, and',
    'Article 13 wants the controller named at the point of collection. Fill them',
    'in, or set LEAD_CAPTURE=off until they are done.',
    '',
  ].join('\n'));
  process.exit(1);
}

async function start() {
  refuseToStartIfStorageContradictsTheNotice();
  refuseToStartIfTheNoticeIsUnfinished();
  if (store.hasDb) {
    await store.ensureSchema();
    console.log('Storage: Postgres (encrypted at rest by the provider), schema ensured.');
  } else {
    console.warn('Storage: JSONL files under data/. Set DATABASE_URL for encrypted, backed-up storage.');
  }
  return app.listen(PORT, () => {
  console.log(`Facet Pro server running on http://localhost:${PORT}`);
  console.log(`Detection rate limit: ${envLimit('DETECT_RATE_LIMIT', 10)} per minute per IP.`);
  console.log(`Daily caps — detect: ${DAILY_LIMITS.detect}, render: ${DAILY_LIMITS.render} ` +
              `(used today: ${usage.detect}/${usage.render}, UTC day ${usage.day})`);
  checkCatalogueAge();
  checkGalleryProvenance();
  console.log(SITE_MODE === 'beta'
    ? 'Site mode: BETA — the badge and notice are shown. Set SITE_MODE=live to remove them.'
    : 'Site mode: LIVE — no beta badge.');
  checkRecipients();
  runRetention().catch(err => console.error('Retention run failed:', err.message));
  setInterval(() => runRetention().catch(err => console.error('Retention run failed:', err.message)), RETENTION_INTERVAL_MS).unref();
  logMeasureTuning();
  checkEmailConfig();
  checkGlazingRates();
  });
}

/* Kept, rather than discarded, so a test can wait for it.

   start() is async, and against Postgres it has a schema to build before it
   listens: CREATE SCHEMA, several CREATE TABLE, an ALTER on leads and a unique
   index. Against JSONL that resolves within a tick, so a test file that
   requires this module and fetches immediately has always won the race by
   accident. Against a database it loses — 131 of the suite fail on `fetch
   failed`, which reads like a server bug and is really a stopwatch.

   That matters more than a flaky suite. refuseToStartIfStorageContradictsThe-
   Notice requires DATABASE_URL on any deployment, so Postgres is the only
   backend that will ever run in production, and it is the one the endpoint
   tests could never cover. */
const ready = start().then((server) => {
  if (!server) return null;

  /* A request that has been running for two minutes is not going to finish.
     Without these, a stuck upstream holds a socket open indefinitely. */
  server.headersTimeout = 65_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 61_000;

  /* Platforms send SIGTERM and then wait a moment before SIGKILL. Using that
     moment: stop accepting connections, let the ones in flight finish, and
     close the database pool so Postgres is not left holding sessions. A lead
     being written when the deploy lands should reach the store. */
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received — finishing what's in flight.`);
    const forced = setTimeout(() => {
      console.error('Still busy after 10s — exiting anyway.');
      process.exit(1);
    }, 10_000);
    forced.unref();
    server.close(async () => {
      clearTimeout(forced);
      try { await store.end(); } catch (_) { /* already gone */ }
      console.log('Closed cleanly.');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}).catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

/* Exposed for tests only. newLeadId is worth exercising directly: the property
   that matters is that fifty thousand of them are fifty thousand distinct
   values, and there is no way to observe that through an endpoint that allows
   five submissions a minute. */
module.exports = { ready, _internals: { newLeadId, readImage, runRetention, purgeLeadPiiFor } };
