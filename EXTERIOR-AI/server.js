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
const leadscore = require('./leadscore');

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
/* The trigger is a set of phrasings, not one string. It was a single literal
   match on "Photographs, not renders", which meant any rewording of the badge
   silenced the warning without answering it — and the badge got reworded the
   day one pair became a visualisation, while three pairs still claimed to be
   photographed jobs. A guard that a copy edit can switch off is not a guard. */
const PHOTOGRAPHY_CLAIMS = [
  /Photographs, not renders/i,
  /photographed job/i,
  /photographed from the same spot/i,
];

function checkGalleryProvenance() {
  let page = '';
  try { page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); } catch (_) { return; }
  if (!PHOTOGRAPHY_CLAIMS.some((re) => re.test(page))) return;

  let provenance = '';
  try { provenance = fs.readFileSync(path.join(__dirname, 'assets', 'work', 'PROVENANCE.md'), 'utf8'); }
  catch (_) { /* absent, which is the loudest case */ }

  const unknowns = (provenance.match(/UNKNOWN/g) || []).length;
  if (!provenance) {
    console.warn('The homepage claims the gallery is "Photographs, not renders" and assets/work/PROVENANCE.md does not exist. That claim is unsubstantiated.');
  } else if (unknowns) {
    console.warn(`Gallery provenance is INCOMPLETE — ${unknowns} UNKNOWN entries in assets/work/PROVENANCE.md, while the homepage still claims the gallery is photographed work. Substantiate it or change the wording.`);
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
  /* sitemap.xml is NOT listed, and the file is deleted.

     It is generated now — see the route further down, which builds it from
     landing.allPaths() so the sixteen landing pages cannot drift out of it. The
     static middleware runs before every route in this file, so leaving the
     entry here would have meant the route existed, looked correct, was covered
     by a test that called the function directly, and never served a single
     request. That is the exact shape of the three bugs in HANDOVER.md: a
     stated intention nothing enforced.

     Deleted rather than merely unlisted, for the same reason guided-demo.html
     was: a stale sitemap on disk is a file that starts being served again the
     moment somebody adds a plausible-looking line back to this set. */
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
  /* No provider host here any more. It was allowed so the page could show a
     render straight off Replicate's CDN when we failed to take a copy of it;
     that fallback is gone, so every image the app displays is either ours or
     the homeowner's own upload. Left as a comment rather than deleted quietly,
     because an allowance that reappears should have to argue for itself. */
  "img-src 'self' data: blob:",
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
/* Which paths get the document CSP rather than the app one. The app policy
   needs 'unsafe-inline' for scripts because the whole front end is inline in
   index.html; anything that does not run scripts should not be handed that,
   and the landing pages and share pages do not. */
const isLegalPath = (p) => p === '/privacy' || p === '/terms' || p === '/investors'
  || p.startsWith('/legal/') || p.startsWith('/cost/') || /^\/windows-[a-z-]+$/.test(p);

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
/* www, not the bare domain, and that matters more than it looks.

   Per HANDOVER.md the live service answers on www.facetpro.co.uk; the apex only
   resolves to a Vercel project that 307s to www, and it cannot be moved because
   the apex carries MX records. So every canonical URL, sitemap entry and share
   link built from the bare domain pointed at a redirect — which robots.txt
   already contradicted, since it advertises the www sitemap.

   Harmless for a human. Not harmless for sixteen new landing pages whose whole
   purpose is to be indexed: a canonical tag pointing at a redirect asks a search
   engine to resolve which URL is authoritative, and it splits whatever
   authority the pages earn across two hostnames.

   Override with SITE_URL if the domain ever moves. */
const SITE_URL = process.env.SITE_URL || 'https://www.facetpro.co.uk';

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

/* One entry in the append-only account of what happened to a lead.

   From the August 2026 code audit: prove "who was eligible, who received it,
   when they received it and whether the homeowner consented".

   Why this exists next to tables that already record most of it: every one of
   those is about the lead's current state, and the lead's current state is
   deliberately mutable — withdrawal redacts it, and should. Redaction rewrites
   what a lead IS and leaves no account of what was DONE, which is the half a
   buyer disputing an invoice, or the ICO asking what somebody agreed to, needs.

   Never contact details. Ids, decisions, counts and reasons — the things you
   would need to answer "why did this happen", not "who was it". That keeps the
   log outside the erasure path: there is nothing here to erase, so withdrawal
   does not have to choose between honouring a request and keeping its own
   evidence that it honoured it.

   Failures are logged and swallowed. An audit trail that can fail a lead is
   worse than one with a gap in it — the lead is the thing somebody paid for. */
async function leadEvent(type, leadId, detail = {}) {
  return record('leadEvents', {
    ts: new Date().toISOString(),
    eventId: crypto.randomUUID(),
    leadId: leadId || null,
    type,
    detail,
  });
}

const planDelivery = (lead) => routing.chooseRecipients(LEAD_RECIPIENTS, lead, { max: MAX_INSTALLERS_PER_LEAD });

/* Deliveries that are still in flight after their response has gone. Drained
   on shutdown — see the SIGTERM handler. */
const pendingDeliveries = new Set();

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
    await leadEvent('routing.withheld', lead.id, { reason: 'no consent to share with installers' });
    console.log(`Lead ${lead.id}: not shared — no installer consent.`);
    return;
  }
  /* Recorded, not returned on silently.

     This was a bare `return`, two lines under a comment promising "a positive
     record of the decision rather than an absence" — and an unconfigured
     LEAD_RECIPIENTS is exactly the absence it warns about. Every other way a
     lead reaches nobody writes a row: no consent, no coverage, no usable
     postcode, a crash mid-delivery. Only the one that happens before anybody
     has finished setting the service up wrote nothing at all.

     Which is the case most likely to be read back later, and the hardest to
     reconstruct: a homeowner asked for quotes, agreed to it, and nothing
     happened. Without a row, /api/deliveries cannot distinguish that from a
     lead that was never submitted. */
  if (!LEAD_RECIPIENTS.length) {
    await record('deliveries', {
      ts: new Date().toISOString(), leadId: lead.id, postcode: lead.postcode || null,
      total: 0, delivered: 0, failed: 0, results: [],
      withheld: 'no recipients configured',
    });
    await leadEvent('routing.withheld', lead.id, { reason: 'no recipients configured' });
    console.warn(`Lead ${lead.id}: consented to sharing, but LEAD_RECIPIENTS is not set — stored and sent to nobody.`);
    return;
  }

  /* "up to three vetted installers covering my area" — the consent is
     specific, so the routing has to be. Everything about the decision is
     recorded, including who was skipped and why: a buyer asking why they
     didn't get a lead deserves an answer, and so would the ICO. */
  /* Reuses the plan from the request rather than recomputing it: the
     homeowner has already been told, by name, who is getting their details. */
  const { chosen, routing: routingRecord } = plan || planDelivery(lead);

  /* The decision, before its outcome. A buyer asking "why didn't I get that
     one" is asking about this event, not about the delivery — they were either
     not eligible, or eligible and not selected, and those are different
     conversations. routingRecord already carries who was skipped and why; this
     pins it to a point in time that redaction will not rewrite. */
  await leadEvent('routing.decided', lead.id, {
    considered: LEAD_RECIPIENTS.length,
    cap: MAX_INSTALLERS_PER_LEAD,
    chosen: chosen.map(r => r.id),
    routing: routingRecord,
  });

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

  /* One event per recipient, not one per lead. The invoice is per recipient,
     the dispute is per recipient, and "delivered to 2 of 3" cannot answer
     which two. leadPrice is what that buyer pays, recorded at the moment of
     delivery rather than read back from a contract months later. */
  for (const r of results) {
    await leadEvent(r.ok ? 'delivery.succeeded' : 'delivery.failed', lead.id, {
      recipientId: r.id,
      leadPrice: r.leadPrice ?? null,
      status: r.status ?? null,
      attempts: r.attempts,
      startedAt: r.startedAt,
      at: r.at,
      ...(r.ok ? {} : { error: r.error }),
    });
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
  /* One per installer that actually received it, not one per lead. The funnel
     question this answers is "how many of the leads we qualify does a buyer
     ever see", and a lead delivered to three companies is three chances at a
     survey. Counted from the delivery results rather than from `chosen`, so a
     buyer whose endpoint was down is not counted as having received anything. */
  for (let i = 0; i < s.delivered; i++) {
    store.countStage('installer_received').catch(() => { /* a counter never fails a delivery */ });
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
  console.warn('INSTALLER_TOKEN_SECRET is not set — installer sessions will end on every deploy. Set it to keep them signed in. Reported again in the startup config block on a deployment, see checkProductionConfig.');
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

/* The cache key, versioned.

   A cached row holds the detections AND the aspect ratio derived from the
   image — so when the meaning of either changes, every stored row is quietly
   wrong and nothing says so. That happened the moment EXIF orientation was
   honoured: photographs cached before it kept the landscape ratio read from
   the header, and went on being priced from it.

   Bumping this invalidates everything in one move, which is cheaper and more
   honest than reasoning about which rows are still trustworthy. Old rows are
   never read again and expire on their own within seven days.

   Bump it whenever what we store, or how we derive it, changes:
     1  original
     2  EXIF orientation honoured — the aspect ratio of a phone photograph
        taken in portrait changed by the square of the frame's proportions */
const DETECTION_VERSION = 2;

function imageFingerprint(buffer) {
  return crypto.createHash('sha256')
    .update(`v${DETECTION_VERSION}:`)
    .update(buffer)
    .digest('hex');
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

/* Not every visitor wants the whole outside of their house.

   These three lookups used to end `|| catalogue.cladding[0]`, which made
   absence indistinguishable from "the first one in the catalogue". Somebody who
   wanted their walls rendered was quoted £27,372, of which £6,175 was render
   and £10,711 was a roof they had not asked for and could not decline. The
   defaults were silent and they always answered upward.

   So absence gets a name. `'none'` means *not this trade*; an omitted field
   still takes the catalogue default, because a client that never knew about
   opting out should behave exactly as it did. Opting out is a thing you say,
   not a thing that happens to you. */
const NONE = 'none';
const pick = (list, id) => (id === NONE ? null : (list.find(x => x.id === id) || list[0]));

/* Which rates produced a number, travelling with the number.
 *
 * The catalogue is versioned and dated, and until now neither travelled with
 * anything it priced. An installer buys a lead and works it days or weeks
 * later; the homeowner has an itemised estimate in an email; and when the two
 * disagree — because trim went up, or a band was re-sourced in between —
 * nothing in the record says which rate card either of them is holding. The
 * only honest answer available was "whatever was in the file at the time",
 * which is not an answer, because the file has since changed.
 *
 * Written to the lead as well as to the response, because the lead is the one
 * that survives. Cheap: two scalars on a JSONB column already being written,
 * so no migration and nothing to backfill. Leads written before this simply
 * have no version, which is itself the truthful record — nobody knows.
 */
const pricingVersion = () => ({
  version: catalogue.version ?? null,
  updated: catalogue.updated ?? null,
  /* Whether the glazing half rests on sourced rates or on the older estimates.
     Already surfaced to the page as ratesSourced; kept here so a stored lead
     answers it without anyone having to know what the flag was that week. */
  glazingSourced: GLAZING_RATES_SOURCED,
});

function computePrice({ claddingId, trimId, roofId, footprintM2, trimLengthM }) {
  const cladding = pick(catalogue.cladding, claddingId);
  const trim = pick(catalogue.trim, trimId);
  const roof = pick(catalogue.roof, roofId);
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
  const claddingMaterial = cladding ? cladding.pricePerM2 * claddingArea : 0;
  const roofMaterial = roof ? roof.pricePerM2 * roofArea : 0;
  const trimMaterial = trim ? (tr.fasciaPerM + tr.soffitPerM + tr.gutteringPerM) * trimLength : 0;
  const materialsSubtotal = claddingMaterial + roofMaterial + trimMaterial;

  const claddingLabour = cladding ? catalogue.labour.claddingPerM2 * claddingArea : 0;
  const roofLabour = roof ? catalogue.labour.roofPerM2 * roofArea : 0;
  const trimLabour = trim ? (tr.fasciaLabourPerM + tr.soffitLabourPerM + tr.gutteringLabourPerM) * trimLength : 0;
  const labourSubtotal = claddingLabour + roofLabour + trimLabour;

  /* Scaffolding follows the work, not the roof. Rendering the walls of a
     two-storey house needs a scaffold just as much as re-roofing it does,
     which is why the walls-only calculator has always charged it. It goes
     only when there is no external work left to reach. */
  const anyWork = Boolean(cladding || roof || trim);
  const scaffolding = anyWork ? catalogue.scaffoldingCost : 0;
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
    /* Excluded trades are absent rather than named, so nothing downstream —
       the lead, the installer portal, the homeowner's email — can print a
       finish for work that was never chosen. `priced` says plainly what this
       figure covers, because a total is only meaningful alongside its scope. */
    priced: [cladding && 'cladding', roof && 'roof', trim && 'trim'].filter(Boolean),
    selections: {
      ...(cladding ? { cladding: `${cladding.name} (${cladding.materialLabel})` } : {}),
      ...(trim ? { trim: `${trim.name} (Fascia/Soffit/Guttering)` } : {}),
      ...(roof ? { roof: `${roof.name} (${roof.materialLabel})` } : {}),
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
  const quoteStartedAt = Date.now();
  res.on('finish', () => {
    obs.time('quote_request', Date.now() - quoteStartedAt);
    obs.outcome('quote_request', res.statusCode < 400);
  });

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
    pricing: pricingVersion(),
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
  /* Named detect_request, not detect, because it measures this request and
     not the thing the homepage was claiming.

     "<60s photo to itemised estimate" covers upload, detection, measurement
     and pricing. This covers one call in the middle of that. A metric called
     `detect` sitting under a heading about photo-to-estimate time is how a
     number gets quoted for something it never measured — which is the exact
     failure the claim it replaced was guilty of. Recorded on the way out
     whatever the outcome, because a slow failure is the one worth knowing
     about. */
  const detectStartedAt = Date.now();
  res.on('finish', () => {
    obs.time('detect_request', Date.now() - detectStartedAt);
    obs.outcome('detect_request', res.statusCode < 400);
  });

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
- "door-front": the main front door, and only a pedestrian front door — never a
  garage door. Box the door LEAF ONLY: from the threshold at its foot to the top of
  the door itself. Exclude any fanlight, transom or overlight above it, any sidelight
  panels beside it, any porch canopy or arch over it, and any steps below it, even
  where they share one frame with the door. This box sets the scale for the whole
  survey: a UK front door is 1.98 m, and every centimetre of canopy, fanlight or
  doorstep inside this box makes the entire house measure smaller than it is.
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

/* ── WHAT THEY TOLD US ABOUT THE PROJECT ──

   The quote steps ask four things a photograph cannot answer: which trades
   they are actually shopping for, when, what kind of property it is, and
   whether it is theirs to spend money on. All four go to the installer and
   three of them move the lead score.

   Validated against fixed lists here rather than trusted from the browser, for
   the same reason the price is recomputed server-side: this ends up in an
   email to a buyer and in a score somebody makes spend decisions from, so a
   client that sends "timing": "<script>" or an invented trade should produce a
   null, not a stored string.

   `interests` is what they SAY they want, which is not the same as `tradesIn`
   — that reads what they actually configured. Both are kept, because the gap
   between them is useful: somebody who ticked "whole exterior" but only
   coloured the windows is a bigger job than their design shows. */
const PROJECT_INTERESTS = ['windows', 'doors', 'roof', 'cladding', 'roofline', 'multiple', 'whole-exterior'];
const PROJECT_TIMINGS = ['asap', '1-3-months', '3-6-months', 'researching'];
const PROPERTY_TYPES = ['terraced', 'semi', 'detached', 'bungalow', 'flat', 'other'];

function resolveProject(body) {
  const raw = Array.isArray(body?.projectInterests) ? body.projectInterests : [];
  const interests = [...new Set(
    raw.map(v => String(v || '').toLowerCase().trim())
       .filter(v => PROJECT_INTERESTS.includes(v)),
  )].slice(0, PROJECT_INTERESTS.length);

  const timing = PROJECT_TIMINGS.includes(String(body?.projectTiming || '')) ? String(body.projectTiming) : null;
  if (!interests.length && !timing) return null;
  return { interests, timing };
}

function resolveProperty(body) {
  const type = PROPERTY_TYPES.includes(String(body?.propertyType || '')) ? String(body.propertyType) : null;
  /* Only `true` counts. An unanswered question and a "no" are different facts,
     and the score treats the absence as unknown rather than as a denial — see
     leadscore.js. */
  const homeowner = body?.homeowner === true ? true : (body?.homeowner === false ? false : null);
  if (!type && homeowner === null) return null;
  return { type, homeowner };
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

/* Doors that open onto a garden, not onto the street. Priced from the
   catalogue like any other, never drawn onto a photograph of the front. */
const REAR_OPENINGS = new Set(['bifold', 'bifold-3m', 'sliding', 'double']);

const JOURNEY_SOURCES = ['windows', 'doors', 'cladding', 'roofline', 'roof'];

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
   under an unguessable id.

   This used to fall back to handing back Replicate's URL when that failed, so
   the homeowner still saw their render. That trade is the wrong way round. It
   bought one person one image and paid for it with a photorealistic picture of
   their identified home sitting at an unauthenticated URL we cannot delete,
   under a privacy notice that says the generated image is removed with the
   lead. A promise we cannot keep is worse than a render we cannot produce, and
   "try again" is a sentence a homeowner can act on.

   Two failures live in here and they are not the same failure, so they are
   counted apart: the fetch from the provider is a network blip and worth
   retrying, while a failed store is our database and worth knowing about
   immediately. Both now end in an error rather than a URL. */
async function ourRenderUrl(renderId) {
  if (!renderId) return null;
  const found = await store.getRender(renderId);
  return found ? `/r/${renderId}` : null;
}

/* Thrown when the bytes exist at the provider and we could not take a copy.
   A distinct type so the route can answer 502 with its own words rather than
   pattern-matching on a message. */
class RenderNotKept extends Error {}

/* Two attempts, not one. The provider's CDN drops the occasional connection
   and a second try a moment later costs a homeowner half a second, where
   giving up costs them the render. Two rather than five because past two this
   stops being a blip and starts being an outage, and holding somebody on a
   spinner through five round trips helps nobody. */
const KEEP_ATTEMPTS = 2;
const KEEP_RETRY_MS = 400;

async function keepRender(replicateUrl) {
  let bytes = null;
  let mime = 'image/jpeg';
  let lastFetchError = null;

  for (let attempt = 1; attempt <= KEEP_ATTEMPTS; attempt++) {
    try {
      /* A timeout of our own: Node's fetch has none, and the render route has
         already spent up to ninety seconds getting here. */
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let res;
      try {
        res = await fetch(replicateUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = Buffer.from(await res.arrayBuffer());
      if (!body.length) throw new Error('empty body');
      bytes = body;
      mime = res.headers.get('content-type') || 'image/jpeg';
      break;
    } catch (err) {
      lastFetchError = err;
      if (attempt < KEEP_ATTEMPTS) await new Promise(r => setTimeout(r, KEEP_RETRY_MS));
    }
  }

  if (!bytes) {
    /* Counted as its own kind. A run of these is the provider or the network,
       and nothing we can fix in the database. */
    obs.record('render', 'could not fetch the render from the provider', { reason: lastFetchError?.message });
    console.error('Could not fetch the render from the provider:', lastFetchError?.message);
    throw new RenderNotKept('fetch failed');
  }

  const id = crypto.randomBytes(16).toString('hex');
  try {
    await store.putRender(id, bytes, { mime });
  } catch (err) {
    /* And this one is ours. The bytes arrived and the database would not take
       them, which is worth being told about on the first occurrence rather
       than discovering in a weekly count. */
    obs.record('render', 'fetched the render but could not store it', { reason: err.message });
    console.error('Fetched the render but could not store it:', err.message);
    throw new RenderNotKept('store failed');
  }
  return { url: `/r/${id}`, renderId: id };
}

/* The render succeeded upstream; whether we can hand it over depends on
   whether we managed to take a copy. Shared by both success paths so the two
   cannot drift into answering differently.

   The message says try again, because trying again is what works: the
   prediction is cheap to repeat and the two failures behind this are both
   transient more often than not. It deliberately does not say the render
   failed, which would be a lie about the part that went right. */
async function respondWithRender(res, url) {
  try {
    return res.json(await keepRender(url));
  } catch (err) {
    if (err instanceof RenderNotKept) {
      return res.status(502).json({ error: "We made your image but couldn't save it — please try again." });
    }
    throw err;
  }
}

/* Fetching a design or its render by id lives in routes/designs.js — fourth
   slice. Grouped by security model rather than subject: no password, reachable
   by anyone holding the id, which is why robots.txt disallows /r/ and /s/. */
app.use(require('./routes/designs')({ perMinute, record, SITE_URL }));

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

/* Window pricing and wall measurement live in routes/measure.js — fifth slice.
   detectionRecords is passed directly because it is a const Map mutated in
   place; contrast getUsage in routes/ops.js, which must be a getter because
   that one is reassigned. */
app.use(require('./routes/measure')({
  detectionRecords, catalogue, record, MEASURE_TUNING,
  /* Shared, not moved: /api/quote uses pricingVersion and /api/detect uses
     pruneDetectionRecords.

     Passed by value, and only one of the two is safe by nature.
     pruneDetectionRecords is a `function` declaration, which hoists, so it
     would work from anywhere in this file. pricingVersion is a `const` arrow
     and does NOT — this works because the mount happens to sit below its
     declaration, not because arrows are fine to pass. Move this mount above
     line ~1493 and it throws at require, exactly as the withdrawal slice did.
     If that ever happens, wrap it: (...a) => pricingVersion(...a). */
  pricingVersion, pruneDetectionRecords, GLAZING_RATES_SOURCED,
}));

/* ── POST /api/render ──
   Real AI render via Replicate FLUX Kontext Pro. Requires REPLICATE_API_TOKEN.
   Accepts { image: 'data:image/...;base64,...', mimeType, claddingName, trimName, roofName } */
app.post('/api/render', renderLimiter, async (req, res) => {
  const { image, mimeType, claddingName, trimName, roofName,
          windowStyleName, doorStyleName, doorStyleId, windowDoorColourName } = req.body || {};
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
  const doorStyleRaw = String(doorStyleName || '').trim();
  const glazingColour = String(windowDoorColourName || '').trim();

  /* Bifolds are not front doors, and this prompt used to insist they were.

     Every door in the catalogue was passed through as "a ${style} front door",
     so choosing "Bifold, 3 m" asked for a three-metre bifold in a 0.9 m front
     doorway — in the same prompt that says "do not add, remove, move or resize
     any window, door or other opening". The two instructions cannot both be
     obeyed. The model either widens the opening, and the homeowner is shown a
     house they do not own, or ignores the style and the picture is a lie of a
     quieter kind.

     Bifolds, patio doors and double doors open onto a garden. The photograph
     is of the front, by instruction — "get the whole front in, with the front
     door visible" — and the front door is also the 1.98 m scale reference. So
     the elevation being rendered is, by design, not the one these doors are
     on. They are priced, because the price does not depend on seeing them, and
     they are not drawn, because drawing them means drawing them somewhere they
     are not. */
  const doorStyle = REAR_OPENINGS.has(doorStyleId) ? '' : doorStyleRaw;
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
        /* output_format: png, which is also the model's own default — 'jpg'
           was an override, and it cost the one thing this render is for.

           The photograph is already re-encoded once before it gets here: the
           client downscales to 1600px and writes JPEG at 0.85. Asking for JPEG
           back put a second lossy pass on top, and this model has no
           output_quality input — the whole schema is prompt, input_image,
           aspect_ratio, seed, safety_tolerance, prompt_upsampling and this —
           so there was no quality dial to raise instead. PNG or artefacts.

           They land on exactly the surfaces being sold: mortar lines, render
           grain, roof tile edges. A homeowner deciding between anthracite and
           sage is looking at texture, and JPEG spends its bit budget on the
           smooth sky above it.

           Costs storage. Roughly 500KB becomes a few MB per render, in a table
           holding renders for 183 days (retention.PERIODS.orphanRenderDays)
           with DAILY_RENDER_LIMIT at 50. Worth watching rather than worth
           refusing — and the render is the product.

           aspect_ratio stays unset because its default is match_input_image,
           which is what a before-and-after needs. prompt_upsampling stays off:
           it lets the model rewrite the prompt, and this prompt's whole job is
           telling it what not to change. */
        body: JSON.stringify({ input: { prompt, input_image: inputImage, output_format: 'png', safety_tolerance: RENDER_SAFETY_TOLERANCE } })
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
      return respondWithRender(res, url);
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
        return respondWithRender(res, url);
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

  const { claddingId, trimId, roofId, footprintM2, trimLengthM, measurementSource, detections, renderId, notes, consent, detectionId, conservatoryStyleId, journeySource, houseType } = req.body || {};

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

  /* houseType too, exactly as /api/quote passes it.
     Without it resolveFootprint fell through to catalogue.defaultFootprintM2 —
     95 m², a semi — so a detached homeowner who picked their house type but
     never uploaded a photo was shown one number and had a different, smaller
     one stored on their lead and emailed to the installer. The quote endpoint
     had always passed it; this one never had. */
  const footprint = resolveFootprint({ footprintM2, detectionId, houseType });
  const price = computePrice({ claddingId, trimId, roofId, footprintM2: footprint.m2, trimLengthM });

  /* A lead can be real and carry no priced work.

     Somebody who only wants a conservatory chooses no cladding, no roof and no
     trim — and this used to send the installer a headline price of £27,372,
     because computePrice defaulted all three. The installer pays £100, rings
     expecting a whole-house exterior refit, and finds a conservatory enquiry.
     That is the product misdescribing what it sells to the person buying it.

     So an empty `priced` means no wall price at all rather than a wrong one.
     The enquiry still stands on the conservatory interest and the glazing
     estimate, either of which may be the whole of what they want. */
  const hasPricedWork = price.priced.length > 0;

  /* The raw token goes into their email and nowhere else; we keep the hash.
     Otherwise the withdrawal link would be readable by anything that can read
     a lead, including the installer portal. */
  const { token: withdrawToken, hash: withdrawTokenHash } = withdrawal.newToken();

  const lead = {
    ts: new Date().toISOString(),
    id: newLeadId(),
    name, email, phone: phone || '', postcode: postcode || '',
    selections: hasPricedWork ? price.selections : {},
    price: hasPricedWork ? price.total : null,
    priceBreakdown: hasPricedWork ? price : null,
    /* Which rate card produced the figures above — see pricingVersion(). An
       installer may work this lead a fortnight after it was priced, and the
       catalogue will have moved by then. Recorded unconditionally, including
       when nothing was priced, because "no work chosen, under v2 rates" is
       still a fact about this lead. */
    pricing: pricingVersion(),
    // Server's own view of where the area came from — the client-sent
    // measurementSource is kept only as a record of what the UI believed.
    measurementSource: footprint.source,
    clientMeasurementSource: measurementSource || null,
    wallMeasurement: footprint.measurement,
    // Present only if they showed interest in one — useful for the installer,
    // and priced from our catalogue rather than whatever the client sent.
    conservatory: resolveConservatory(conservatoryStyleId),
    /* Which landing page sent them, validated against the same list the page
       reads. Deliberately named for what it is: where they came from, not what
       they want. Somebody can arrive from the doors page and design a whole
       exterior, so routing weights on the selections above, never on this. */
    journeySource: JOURNEY_SOURCES.includes(journeySource) ? journeySource : null,
    /* The window and door estimate, recomputed here rather than taken from
       the request — the same rule as the wall area. It is what the homeowner
       was shown, so the installer should see the same figure and know which
       method produced it. */
    glazing: resolveGlazing(req.body || {}),
    preferences: resolvePreferences(req.body || {}),
    /* What the quote steps asked, validated against fixed lists. Null when
       they saved a design without asking for quotes — the steps are only
       shown on that path, and an empty object would read as "answered". */
    project: resolveProject(req.body || {}),
    property: resolveProperty(req.body || {}),
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
  /* Scored before it is stored, so the score is part of the record rather than
     something recomputed later against weights that may have moved. The
     version is in the payload for exactly that reason: a lead scored 74 last
     month was scored by version 1, and re-scoring it under version 2 would
     quietly rewrite history an installer was billed against. */
  lead.leadScore = leadscore.score(lead);

  // Stored first, unconditionally — a notification problem must never cost a lead.
  await store.append('leads', lead);

  /* What they agreed to, and when. The lead row carries the consent record
     too, and is redacted on withdrawal — deliberately, because that is what
     withdrawal means. Article 7(1) then asks us to demonstrate that consent
     was given, about a row we have just rewritten. This is the demonstration:
     the wording version and which boxes were ticked, with no name attached. */
  await leadEvent('consent.recorded', lead.id, {
    version: lead.consent?.version ?? null,
    installerQuotes: lead.consent?.installerQuotes === true,
    emailPack: lead.consent?.emailPack === true,
    terms: lead.consent?.terms === true,
    leadScore: lead.leadScore?.score ?? null,
  });

  /* A lead is stored and scored: that is what "qualified" means here, and it
     is a thing only the server witnesses. Counted before the emails, because
     a mail provider being down does not un-qualify anybody. */
  store.countStage('lead_qualified').catch(() => { /* a counter never fails a lead */ });

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

  /* Recorded here rather than in the page, because whether a lead actually
     reached an installer is something only the server knows. */
  store.countStage('lead_sent').catch(() => { /* a counter never fails a lead */ });

  if (notification.attempted && !notification.sent) recordNotificationFailure(lead, notification, 'lead-notification');
  if (homeownerEmail.attempted && !homeownerEmail.sent) recordNotificationFailure(lead, homeownerEmail, homeownerEmail.kind || 'homeowner-email');

  /* Deliver to every buyer, after responding rather than before — the
     homeowner shouldn't wait on three third-party webhooks. The lead is
     already stored, so nothing is lost if the process dies mid-delivery; the
     reconciliation log below is what tells you it needs re-sending. */
  /* Tracked, because "nothing is lost if the process dies mid-delivery" is
     true of the lead and not of the delivery record. The lead is stored before
     this runs; the deliveries row — the evidence an installer was sent it, and
     the thing they are billed against — is written inside it. A redeploy
     landing here loses that row and the installer never hears about a lead the
     homeowner was told had been sent.

     server.close() waits for open HTTP connections, and this deliberately is
     not one: the response has already gone. So it is held here and drained
     below rather than left to the forced-exit timer. */
  const delivery = deliverAndRecord(lead, plan)
    .catch(err =>
      console.error(`Lead ${lead.id}: delivery threw after the response:`, err?.stack || err?.message || err))
    .finally(() => pendingDeliveries.delete(delivery));
  pendingDeliveries.add(delivery);

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

  /* Orphan renders: images past their period that no surviving lead points at.
     Renders are stored with lead_id null, so "orphan" is decided by cross-
     referencing leads' renderUrl, NOT the column — anything a live lead still
     references is kept. Computed here, before the early return below, so the
     sweep still happens on a day when no lead itself is due. */
  const orphanCutoff = new Date(Date.now() - retention.PERIODS.orphanRenderDays * retention.DAY).toISOString();
  let orphanRenderIds = [];
  try {
    const staleIds = await store.staleRenderIds(orphanCutoff);
    if (staleIds.length) {
      const referenced = new Set(leads
        .map(l => (l.renderUrl || '').match(/^\/r\/([A-Za-z0-9_-]+)$/)?.[1])
        .filter(Boolean));
      orphanRenderIds = staleIds.filter(id => !referenced.has(id));
    }
  } catch (_) { /* no render store yet, or none stale */ }

  if (!p.redact.length && !p.delete.length && !p.accessLogExpired && !orphanRenderIds.length) {
    return { kept: p.keep, redacted: 0, deleted: 0, accessLogRemoved: 0, rendersRemoved: 0, dryRun };
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

    /* The orphan renders identified above — deleted only on a real run. */
    if (orphanRenderIds.length) {
      summary.rendersRemoved += await store.deleteRenders(orphanRenderIds);
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

/* The installer area lives in routes/installers.js — second slice of the
   decomposition. Both guards are passed in, because the difference between them
   is the thing most easily got wrong: requireInstaller is a per-installer
   bearer token; requireInstallerPassword is the shared operator credential. */
app.use(require('./routes/installers')({
  installerLimiter, requireInstaller, requireInstallerPassword, logAccess,
  record, leadEvent, LEAD_RECIPIENTS, INSTALLER_TOKEN_SECRET,
}));

/* Withdrawing consent lives in routes/withdraw.js — third slice.

   purgeLeadPiiFor stays here on purpose: the retention sweep calls it and the
   tests reach it through this file's exports, so it is shared rather than
   owned by those routes. They take the single-lead wrapper instead. */
app.use(require('./routes/withdraw')({
  withdrawLimiter, record, leadEvent, LEAD_RECIPIENTS, PRIVACY_EMAIL,
  /* Wrapped, not passed. purgeLeadPii is a `const` declared further down this
     file, and `const` does not hoist — handing the value over here throws
     "Cannot access 'purgeLeadPii' before initialization" at require time.

     The mount cannot simply move below the definition either: Express matches
     in registration order and there is a `/:slug` catch-all later in this file,
     which would start swallowing /withdraw. So the reference is resolved when
     the route runs rather than when it is wired, exactly as getUsage is in
     routes/ops.js — for a different reason, but with the same shape. */
  purgeLeadPii: (leadId) => purgeLeadPii(leadId),
}));

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
/* ── WHICH BUILD IS THIS ──

   Caching is not the problem here; a tab left open is. HTML and CSS are served
   must-revalidate, so a returning visitor gets the new page on their next load
   and always has. But somebody who opens Facet Pro, wanders off, and comes back
   two hours later is still running the JavaScript from before the deploy —
   against a server that has moved on. That is how a page ends up showing a
   price the server would no longer produce.

   A hash of what the browser was actually given. The page asks once when it
   loads and again when it comes back to the foreground; if the answer has
   changed, the page it is running is older than the server and it says so.

   Computed at startup rather than per request — the files cannot change under
   a running process, and hashing them on every poll would be work for nothing. */
const BUILD_ID = (() => {
  const hash = crypto.createHash('sha256');
  for (const f of ['index.html', path.join('assets', 'app.css')]) {
    try { hash.update(fs.readFileSync(path.join(__dirname, f))); } catch (_) { /* absent in some tests */ }
  }
  return hash.digest('hex').slice(0, 12);
})();

app.get('/api/version', perMinute(120, 'Too many requests — please wait a moment.'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ build: BUILD_ID });
});

/* ── THE FUNNEL ──

   "We should know where every visitor stops." The plan puts conversion first,
   and conversion cannot be improved without knowing which step loses people.

   What this is NOT: analytics in the ordinary sense. There is no cookie, no
   visitor id, no IP, no user agent, no referrer and no path — a request says
   only which stage was reached, and the server adds one to a counter for that
   stage today. Two people who upload look exactly like one person uploading
   twice, and nothing here can tell them apart. That is deliberate: it makes
   the thing answer "what share of visitors upload" while being unable to
   answer "did THIS person upload", which is the only question that would need
   consent, a processor agreement and a transfer mechanism.

   The stages are an allowlist, so a client cannot invent labels and turn the
   table into free-text storage.

   ── Why the list grew ──

   It was eight stages, and it collapsed distinct failures into single steps.
   "design_created" fired on the same tick as the detection returning, so a
   photograph that arrived and a house that was successfully read were one
   number; and everything after the form was one step called lead_sent, so
   there was no way to see the difference between a lead nobody bought and a
   lead nobody was offered.

   The eight original names are kept exactly as they were. The stored rows are
   keyed by name, so renaming any of them would silently orphan the history —
   the new stages are additions, in journey order, and the old counts still
   line up underneath them.

   Two of these are recorded by the server rather than the browser, because
   only the server knows: lead_qualified (the lead saved and scored) and
   installer_received / installer_accepted (what a buyer did with it). */
/* The UX Sprint handoff asks for ten events and names the four gaps between
   them worth watching: CTA → upload, analysis → first reveal, customisation →
   price, price → save. Nine of the ten already existed. Three did not, and
   they are the ones that bracket the two gaps nobody can currently see:

   - cta_clicked      the homepage button, before any upload begins. Without
                      it `landing → upload_started` conflates "never pressed
                      the button" with "pressed it and then would not hand
                      over a photograph", which are different problems with
                      different fixes.
   - reveal_viewed    the homeowner has actually looked at their own
                      before-and-after — dragged the slider, or the automatic
                      render landed. analysis_completed only says the server
                      answered.
   - breakdown_viewed the itemised estimate was opened. estimate_viewed says a
                      figure was on screen; this says somebody wanted to know
                      what was in it.

   Appended rather than inserted: /ops renders these in array order and the
   sequence below is roughly chronological, but nothing keys off the index. */
const FUNNEL_STAGES = [
  'landing', 'cta_clicked', 'upload_started', 'upload_completed',
  'analysis_completed', 'visualisation_started', 'reveal_viewed',
  'design_created', 'design_changed',
  'estimate_viewed', 'breakdown_viewed', 'design_saved',
  'quote_started', 'quote_requested', 'quote_completed',
  'lead_qualified', 'lead_sent', 'installer_received', 'installer_accepted',
];

/* Four of the stages describe things only the server can witness — a lead
   stored and scored, a lead delivered, a buyer accepting it. A browser
   claiming any of them is either confused or inflating the numbers somebody
   makes spend decisions from, so the public endpoint refuses them. It costs
   nothing: the server records these itself, by calling store.countStage
   directly rather than by coming through here. */
const SERVER_ONLY_STAGES = new Set(['lead_qualified', 'lead_sent', 'installer_received', 'installer_accepted']);

/* ── POST /api/journey-timing ──
   The only number the server cannot measure: how long the homeowner waited.

   detect_request, measure_request and quote_request are three calls in the
   middle of a journey that starts when somebody taps upload and ends when a
   figure appears on their screen. Between them sit the upload itself, on
   whatever connection they have, and the browser doing the work. A server-side
   total would be the fast part of somebody else's experience — which is how
   "<60s photo to itemised estimate" came to be on the homepage in the first
   place.

   So the browser reports it, once, when the estimate is on screen. Bounded and
   validated because it is client-supplied: anything absurd is dropped rather
   than allowed to move a median that a claim might later rest on. */
const MAX_REPORTED_JOURNEY_MS = 15 * 60 * 1000;

app.post('/api/journey-timing', perMinute(60, 'Too many requests — please wait a moment.'), (req, res) => {
  const ms = req.body?.ms;
  const stage = String(req.body?.stage || 'photo_to_estimate');
  const allowed = ['photo_to_estimate'];
  res.status(204).end();
  if (!allowed.includes(stage)) return;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0 || ms > MAX_REPORTED_JOURNEY_MS) return;
  obs.time(stage, ms);
  obs.outcome(stage, true);
});

app.post('/api/funnel', perMinute(120, 'Too many requests — please wait a moment.'), async (req, res) => {
  const stage = String(req.body?.stage || '');
  if (!FUNNEL_STAGES.includes(stage) || SERVER_ONLY_STAGES.has(stage)) return res.status(400).json({ error: 'Unknown stage.' });

  /* The same stage, counted twice: once for everybody and once for the journey
     they came in on.

     A single total answers "where do we lose them" and cannot answer "who".
     The question worth money is whether rendering visitors convert better than
     window visitors, because that is the one that decides where to spend on
     advertising — and it was unanswerable, because the counter recorded the
     stage and nothing else.

     Written as a second key rather than a second column, so no schema moves and
     every existing total keeps its meaning: `landing` is still every landing. */
  const journey = JOURNEY_SOURCES.includes(String(req.body?.journey || '')) ? String(req.body.journey) : null;

  /* Answered before the write. A counter that fails must never cost a visitor
     their journey, and the browser is not waiting for anything useful. */
  res.status(204).end();
  try {
    await store.countStage(stage);
    if (journey) await store.countStage(`${journey}:${stage}`);
  }
  catch (err) { obs.record('funnel', 'could not record a stage', { stage, reason: err.message }); }
});

/* The operator views live in routes/ops.js.

   First slice of the decomposition the August 2026 audit asked for: three
   read-only routes with one shared guard and no writes. Dependencies are passed
   rather than imported, because they are this file's state — and `getUsage` is
   a function rather than the object because `usage` is reassigned on the UTC
   day rollover, so a captured reference would report one day's counts forever. */
app.use(require('./routes/ops')({
  installerLimiter, requireInstallerPassword,
  FUNNEL_STAGES, JOURNEY_SOURCES, DAILY_LIMITS,
  getUsage: () => usage,
  LEAD_CAPTURE, SITE_MODE,
}));

/* The pages live in routes/pages.js — sixth slice. Mounted here, as one unit,
   because this group contains the `/:slug` catch-all: Express matches in
   registration order, so it must stay after every specific single-segment
   route and before the 404 handler. __dirname is passed because the moved code
   resolves files against the app root, which is this file's directory and not
   routes/. */
app.use(require('./routes/pages')({
  perMinute, requireInvestorPassword, SITE_URL, __dirname,
  catalogue, SITE_MODE, LEAD_RECIPIENTS,
}));

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

   A placeholder is defined by its brackets. Match those.

   And match them however long they are. The bracket rewrite above dropped the
   character class but kept an upper bound of 200, which is the same mistake
   one size smaller: on 28 August 2026 two placeholders in terms.html were
   found sitting outside it — an instruction to list the actual installer
   vetting checks (349 characters) and one to name the ADR or trade scheme
   (295). Both are drafting instructions addressed to us, printed on a public
   page, and the guard could not see either. The longest a placeholder may be
   is not a fact anybody knows in advance; the whole point of anchoring on the
   brackets was to stop guessing at the contents, and a length cap is a guess
   about the contents.

   `[^\]]` cannot run past the closing bracket, so there is no runaway match to
   protect against — an unclosed bracket simply does not match. The floor of 2
   stays, so that "[1]" or an array index in a code sample is not a
   placeholder. */
const PLACEHOLDER = /\[[A-Z][^\]]{2,}\]/g;

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
  /* Say it either way, and only refuse when capture is on.

     The refusal is right to be conditional: taking somebody's details behind an
     unfinished Article 13 notice is the serious failure, and refusing to serve
     the whole site over a draft notice nobody is being asked to agree to yet
     would deny every homeowner the product to fix a page.

     But silence was wrong. This printed nothing at all with capture off, and
     meanwhile /privacy and /terms were being served to the public — indexable,
     in the sitemap, twenty-two unfilled placeholders between them — for long
     enough that an external review found them before anything here did.
     Publishing an unfinished notice and collecting behind one are different
     failures and only the second was watched. The pages now carry noindex
     while they have brackets in them (see routes/pages.js); this is the line
     that says so out loud at boot. */
  const left = PAGES_WITH_PLACEHOLDERS.reduce((n, page) => n + countPlaceholders(page), 0);
  if (left && !LEAD_CAPTURE) {
    console.warn(
      `${left} placeholder(s) still in ${PAGES_WITH_PLACEHOLDERS.join(' and ')}. ` +
      'Those pages are public. They are served with noindex and kept out of the ' +
      'sitemap until the brackets are filled, and lead capture cannot be turned ' +
      'on while they remain.');
  }

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

/* What a deployment must have configured, checked once at startup.

   From the August 2026 code audit: "create a production startup validation
   function that fails deployment if required live-mode variables are missing,
   weak or contradictory. Log only safe configuration status, never values."

   The case for it is already in this repository's history. INSTALLER_PASSWORD
   was unset on the deployment for weeks. Four operator endpoints answered 503
   the whole time, the post-deploy check in DEPLOY.md pointed at an endpoint
   guarded by something else entirely and so read 401 either way, and nothing
   anywhere said the words. A guard that runs on every boot is the only kind
   that cannot be forgotten.

   It reports; it does not refuse. The audit asked for a function that "fails
   deployment if required live-mode variables are missing", and taking that
   literally was wrong — the first version of this refused to start without
   INSTALLER_TOKEN_SECRET and immediately broke the test asserting that a
   deployment with lead capture off must serve.

   That test is right. A missing token secret signs installers out; refusing to
   start denies every homeowner the homepage, the visualiser and the estimate.
   This file already learned that lesson once, in as many words, about the
   investor page: "a guard that takes down more than the thing it is guarding
   gets deleted by whoever is on the end of the outage." The two guards above
   refuse because the alternative is collecting personal data behind an
   unfinished notice or storage that contradicts it — there is no safe
   half-measure there. Here there is, and it is this.

   Nothing below is a contradiction the site should die on:
     · No token secret — installers are signed out on each deploy.
     · No installer password — four operator endpoints 503, homeowners unaffected.
     · Capture on with no recipients or no email — the lead route already
       degrades safely, hiding the installer-quotes box when it cannot send a
       withdrawal link, so no promise is made that cannot be kept.

   Names only. Never a value, never a prefix, never a length — this runs on a
   platform whose logs are readable by anyone with dashboard access. */
function checkProductionConfig() {
  if (!IS_DEPLOYED) return;

  const warn = [];

  if (!process.env.INSTALLER_TOKEN_SECRET) {
    warn.push('INSTALLER_TOKEN_SECRET is not set — a secret is generated at boot, so every installer is signed out on each deploy. openssl rand -base64 32');
  }

  /* Operator visibility. Not fatal — the site serves homeowners perfectly well
     without it — but unset means /api/ops, /api/funnel, /api/deliveries and
     /api/measurements all return 503 together, which is exactly the failure
     that went unnoticed. */
  if (!process.env.INSTALLER_PASSWORD) {
    warn.push('INSTALLER_PASSWORD is not set — /api/ops, /api/funnel, /api/deliveries and /api/measurements all return 503.');
  }

  /* The gap the storage guard above cannot see.

     It returns early when LEAD_CAPTURE is off, on the premise that capture off
     means no personal data is handled. That premise is false, and this
     repository already proved it: /api/render calls putRender unconditionally,
     with no leadId and no reference to the capture switch, so a visitor puts an
     image of their house into storage by finishing a render, having typed
     nothing. With no DATABASE_URL that image goes to ./data on the container —
     unencrypted, and gone on the next deploy.

     A warning rather than a refusal, deliberately and narrowly: the notice's
     encryption promise is scoped to enquiries ("enquiries are stored
     encrypted"), and a standalone render is not an enquiry, so this is not the
     notice-contradicting case the guard above exists for. It is still a
     photograph of somebody's home on an ephemeral disk. */
  if (!store.hasDb) {
    warn.push('DATABASE_URL is not set — renders are images of identifiable homes and go to ./data on this container, unencrypted and lost on the next deploy. The storage guard does not catch this while LEAD_CAPTURE is off.');
  }

  if (LEAD_CAPTURE) {
    /* Past this point a homeowner can hand over their details, so anything
       that silently drops what they were promised is a fault, not a choice. */
    if (!LEAD_RECIPIENTS.length) {
      warn.push('LEAD_CAPTURE is on but no LEAD_RECIPIENTS are configured — leads will be stored and delivered to nobody.');
    }
    if (!process.env.RESEND_API_KEY) {
      warn.push('LEAD_CAPTURE is on but RESEND_API_KEY is not set — no email is sent to anybody, including the homeowner’s withdrawal link.');
    }
    if (!process.env.LEAD_NOTIFY_EMAIL) {
      warn.push('LEAD_CAPTURE is on but LEAD_NOTIFY_EMAIL is not set — nobody is told a lead arrived.');
    }
    if (!process.env.LEAD_FROM_EMAIL) {
      warn.push('LEAD_CAPTURE is on but LEAD_FROM_EMAIL is not set — the design pack refuses to send.');
    }
  }

  if (!warn.length) {
    console.log('Config: deployment checks passed — nothing missing.');
    return;
  }

  /* One block rather than scattered lines. The failure this exists to catch is
     nobody noticing, and a warning between two hundred other startup lines is
     a warning nobody notices. */
  console.warn([
    '',
    `CONFIGURATION: ${warn.length} thing(s) missing on this deployment.`,
    '',
    ...warn.map(w => `  · ${w}`),
    '',
    'None of these stop the site serving homeowners, which is why this is a',
    'warning. Set them in the platform dashboard — never in a file, and never',
    'in this repository, which is public.',
    '',
  ].join('\n'));
}

async function start() {
  refuseToStartIfStorageContradictsTheNotice();
  refuseToStartIfTheNoticeIsUnfinished();
  checkProductionConfig();
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
    /* Ten seconds was shorter than a delivery to three webhooks with retries,
       so the drain added below would have been cut off by this. */
    const forced = setTimeout(() => {
      console.error('Still busy after 30s — exiting anyway.');
      process.exit(1);
    }, 30_000);
    forced.unref();
    server.close(async () => {
      /* Before store.end(), because a delivery still running needs the pool it
         is writing its record with. */
      if (pendingDeliveries.size) {
        console.log(`Waiting on ${pendingDeliveries.size} delivery(s) still in flight.`);
        await Promise.allSettled([...pendingDeliveries]);
      }
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
module.exports = { ready, _internals: { newLeadId, readImage, runRetention, purgeLeadPiiFor, REAR_OPENINGS } };
