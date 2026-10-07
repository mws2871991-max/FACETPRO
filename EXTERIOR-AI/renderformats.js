/* Renders, in the smallest format each browser can show (7 Oct 2026).

   The provider hands back a 1248x832 RGBA PNG of about 1.3-1.6 MB, and that is
   what every phone downloaded to see its own house: several seconds on a weak
   signal, at the exact moment the product is supposed to land. The same
   picture is about 55 KB as AVIF, 80 KB as WebP and 125 KB as JPEG, with no
   difference anyone can see at twice its size.

   The stored bytes are left exactly as they arrived. Retention, withdrawal and
   every test that reads a render keep working on the original, and nothing
   here can lose a picture: if an encode fails, the original is served.

   Converted copies are kept in memory, bounded by size and by age, so a
   render is encoded once rather than on every view. /r/:id still asks the
   store first on every request, so a deleted render is a 404 whether or not
   a converted copy is still sitting here; the age limit makes sure it does
   not sit here long. */

'use strict';

let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* no encoder: serve the original */ }

/* Chosen by eye on real renders at 2x: window frames, tile-hanging, brick. */
const ENCODE = {
  avif: (s) => s.avif({ quality: 55, effort: 4 }),
  webp: (s) => s.webp({ quality: 80, effort: 4 }),
  // JPEG has no transparency; the renders are opaque, so white is never seen.
  jpeg: (s) => s.flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true }),
};
const MIME = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg' };

const MAX_BYTES = 48 * 1024 * 1024;
const MAX_AGE_MS = 60 * 60 * 1000;
const cache = new Map();      // `${id}:${format}` -> { bytes, at }, oldest first
const pending = new Map();    // the same key -> the encode in flight
let held = 0;

/* What this request should get. A download is always JPEG: the file is saved
   as .jpg and has to open on any computer, and Windows will not open AVIF.
   Otherwise the best the browser says it takes; JPEG for anything that says
   nothing, which is what an email client opening the design pack does. */
function pick(accept, { download = false } = {}) {
  if (download) return 'jpeg';
  const a = String(accept || '').toLowerCase();
  if (a.includes('image/avif')) return 'avif';
  if (a.includes('image/webp')) return 'webp';
  return 'jpeg';
}

function remember(key, bytes) {
  cache.set(key, { bytes, at: Date.now() });
  held += bytes.length;
  for (const [k, v] of cache) {
    if (held <= MAX_BYTES) break;
    cache.delete(k);
    held -= v.bytes.length;
  }
}

function recall(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MAX_AGE_MS) {
    cache.delete(key);
    held -= hit.bytes.length;
    return null;
  }
  return hit.bytes;
}

/* The render in `format`, or null when it cannot be had — no encoder, or
   bytes the encoder will not read. The caller serves the original then. */
async function encoded(id, original, format) {
  if (!sharp || !ENCODE[format]) return null;
  const key = `${id}:${format}`;
  const hit = recall(key);
  if (hit) return hit;
  if (pending.has(key)) return pending.get(key);
  const job = ENCODE[format](sharp(Buffer.from(original)))
    .toBuffer()
    .then((bytes) => { remember(key, bytes); return bytes; })
    .catch(() => null)
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/* Called as a render is stored, so the page asking for it a moment later
   finds it ready rather than waiting the half-second an AVIF takes. Not
   awaited; a failure here is only a slower first view. */
function warm(id, original) {
  for (const f of ['avif', 'webp']) encoded(id, original, f);
}

function forget(ids) {
  for (const id of ids || []) {
    for (const f of Object.keys(ENCODE)) {
      const key = `${id}:${f}`;
      const hit = cache.get(key);
      if (hit) { cache.delete(key); held -= hit.bytes.length; }
    }
  }
}

module.exports = { pick, encoded, warm, forget, MIME, available: () => !!sharp };
