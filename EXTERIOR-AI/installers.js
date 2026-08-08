/* Installer accounts, one per installer.

   Until now there was one shared INSTALLER_PASSWORD and one view of every
   consented lead. The privacy notice described something else entirely —
   individual accounts, two-factor authentication, an installer seeing only
   their own area — and none of the three was true. Two of the three are
   fixable here; the notice has been corrected in the meantime and can be put
   back to the stronger wording once this is in use.

   The first Facet Pro had this and its schema is recorded in
   notes/from-the-first-facetpro.md. This is that model brought into a
   codebase that also has consent, retention and erasure.

   ── where accounts live ──

   In LEAD_RECIPIENTS, beside the delivery configuration, rather than in a new
   table. The list of installers and the list of people who receive leads are
   the same list, and splitting them creates the state where somebody is
   configured to receive leads but cannot log in to see them, or the reverse.
   It also stays in the platform dashboard, which is where a secret belongs.

   A password is stored as a hash. Nobody has to be able to read it back, and
   an environment variable is visible to anyone with dashboard access.

   ── what an installer may see ──

   Only leads actually delivered to them, read from the delivery log rather
   than recomputed from today's routing. Routing changes: areas get added, a
   contract ends, the cap moves. What matters for disclosure is who received
   a lead at the time, and the delivery record is the only thing that knows.

   ── tokens ──

   Login returns a short-lived signed token carrying the installer id. The
   browser stores that instead of the password, so a future DOM mistake leaks
   something that expires in hours and grants one account, rather than the
   credential for every account for ever.

   Signed with INSTALLER_TOKEN_SECRET, or with a secret generated at startup
   when that is unset — which logs everyone out on each deploy and is the
   correct failure for something that must not be guessable. */

'use strict';

const crypto = require('crypto');

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;   // four hours: a working session, not a week

/* scrypt rather than a bare hash: a password that is short and human needs to
   be expensive to guess. Parameters are the Node defaults, which are current.

   Asynchronous, because being expensive is the point. scryptSync spends its
   50–100 ms inside the single thread that also serves every other request, so
   one installer signing in stalled the homepage for everybody — and the
   endpoint allows twenty attempts a quarter of an hour per IP, which is twenty
   chances to do it. crypto.scrypt does the same work on the threadpool.

   The cost is that hashing is now a promise, and three callers had to learn
   to wait. That is the correct trade: the alternative is a login that is
   cheap for us, which is the same as a login that is cheap to attack. */
const KEYLEN = 64;
const hashPassword = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(password), salt, KEYLEN, (err, key) => {
    if (err) reject(err); else resolve(key.toString('hex'));
  });
});

/* "scrypt$<salt>$<hash>" — self-describing, so the format can change later
   without guessing what an old value was. */
async function makePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${await hashPassword(password, salt)}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  let actual;
  try { actual = await hashPassword(password, salt); } catch (_) { return false; }
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ── tokens ──
   id.expiry.signature, base64url. Not a JWT: there is one issuer, one
   consumer and one algorithm, and a JWT library brings an algorithm-confusion
   footgun that this does not need. */
function issueToken(installerId, secret, { ttlMs = TOKEN_TTL_MS, now = Date.now() } = {}) {
  const body = `${installerId}.${now + ttlMs}`;
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${Buffer.from(body).toString('base64url')}.${sig}`;
}

function readToken(token, secret, { now = Date.now() } = {}) {
  const [bodyB64, sig] = String(token || '').split('.');
  if (!bodyB64 || !sig) return null;
  let body;
  try { body = Buffer.from(bodyB64, 'base64url').toString('utf8'); } catch (_) { return null; }

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const idx = body.lastIndexOf('.');
  if (idx < 1) return null;
  const id = body.slice(0, idx);
  const expiresAt = Number(body.slice(idx + 1));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { id, expiresAt };
}

/* ── verification ──

   What "vetted installer" means, stored as evidence rather than asserted.
   legal/terms.html has a placeholder asking for exactly this list, and the
   first Facet Pro had already worked out the fields.

   parentCompany matters more than it looks: a cap of three installers means
   nothing if two of the three are the same group under different names. */
const VERIFICATION_FIELDS = [
  'companyNumber', 'insuranceProvider', 'insurancePolicyNumber',
  'insuranceExpiresOn', 'tradeBody', 'parentCompany',
];

function readVerification(raw) {
  const v = {};
  for (const f of VERIFICATION_FIELDS) {
    const val = raw?.[f];
    if (val !== undefined && val !== null && String(val).trim() !== '') v[f] = String(val).trim();
  }
  /* An expiry that has passed is not a check that was done, it is a check
     that has lapsed — worth surfacing rather than storing quietly. */
  let insuranceExpired = null;
  if (v.insuranceExpiresOn) {
    const t = Date.parse(v.insuranceExpiresOn);
    insuranceExpired = Number.isFinite(t) ? t < Date.now() : null;
  }
  return { fields: v, insuranceExpired, verified: Object.keys(v).length > 0 };
}

module.exports = {
  makePasswordHash, verifyPassword,
  issueToken, readToken,
  readVerification, VERIFICATION_FIELDS,
  TOKEN_TTL_MS,
};
