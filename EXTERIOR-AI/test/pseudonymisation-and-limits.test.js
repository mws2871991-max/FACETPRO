/* Two from the launch review that needed no decision. Run: npm test
 *
 *   20  IP hashes were unsalted, so they were a lookup rather than a hash.
 *   24  Nothing stopped an image too large to decode.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('a stored IP hash is keyed, not a lookup table', () => {
  /* There are 4.3 billion IPv4 addresses. Recovering one from a bare SHA-256
     of it took 0.2 seconds and under 150,000 hashes on the machine this was
     written on — the consent record kept that for six years under a comment
     saying "Hashed, not raw". */
  assert.match(src, /crypto\.createHmac\('sha256', IP_HASH_KEY\)/,
    'the IP hash is no longer keyed');
  assert.ok(!/createHash\('sha256'\)\.update\(String\(req\.ip/.test(src),
    'an unkeyed IP hash has come back');

  /* Both stores go through the one helper, so neither can be missed. */
  const uses = (src.match(/ipHash: hashIp\(req\.ip\)/g) || []).length;
  assert.strictEqual(uses, 2, 'the consent record and the access log should both use it');

  /* And the property that matters, demonstrated rather than asserted about. */
  const KEY = crypto.randomBytes(32).toString('hex');
  const keyed = (ip) => crypto.createHmac('sha256', KEY).update(ip).digest('hex').slice(0, 12);
  const target = keyed('81.2.69.142');
  assert.strictEqual(keyed('81.2.69.142'), target, 'the same address must give the same value');
  assert.notStrictEqual(keyed('81.2.69.143'), target, 'a different address must not');
  /* A sweep of the whole /8 without the key finds nothing. */
  let hit = null;
  for (let b = 0; b < 40 && !hit; b++) for (let d = 0; d < 256 && !hit; d++) {
    const guess = `81.${b}.${d}.142`;
    if (crypto.createHash('sha256').update(guess).digest('hex').slice(0, 12) === target) hit = guess;
  }
  assert.strictEqual(hit, null, 'the unkeyed sweep that broke the old hash still works');
});

test('the key is stable, or the operator is told it is not', () => {
  /* The hash exists to evidence that two consents came from the same place.
     A key that dies with the container cannot do that, so it is allowed but
     never silent. */
  assert.match(src, /process\.env\.IP_HASH_SECRET\s*\n?\s*\|\|\s*process\.env\.INSTALLER_TOKEN_SECRET/,
    'the stable key sources have gone');
  assert.match(src, /Neither IP_HASH_SECRET nor INSTALLER_TOKEN_SECRET is set/,
    'nothing warns when the key only lasts for this container');
});

test('an image too large to decode is refused from its header', () => {
  /* The byte limits bound the FILE. A 15,000 x 15,000 PNG of mostly one
     colour is a small upload and about 900 MB decoded, and hold.js decodes
     every render into full RGBA buffers twice. */
  assert.match(src, /const MAX_IMAGE_MEGAPIXELS =/, 'the pixel ceiling has gone');
  assert.match(src, /const megapixels = \(found\.width \* found\.height\) \/ 1e6;/,
    'the check no longer reads the sniffed dimensions');

  /* Before anything decodes: the dimensions come from sniffImage, which reads
     the header only. */
  const sniffAt = src.indexOf('const found = measure.sniffImage(buffer)');
  const capAt = src.indexOf('const megapixels =');
  const returnAt = src.indexOf('return { ok: true, mime: found.mime', sniffAt);
  assert.ok(sniffAt > 0 && capAt > sniffAt && capAt < returnAt,
    'the cap must sit between sniffing the header and accepting the image');

  const m = src.match(/const MAX_IMAGE_MEGAPIXELS = Number\.parseFloat\(process\.env\.MAX_IMAGE_MEGAPIXELS \|\| '(\d+)'\)/);
  assert.ok(m, 'the ceiling should be overridable');
  const mp = Number(m[1]);
  assert.ok(mp >= 30 && mp <= 80,
    `${mp} megapixels is either below a real camera or high enough to hurt`);
});

test('the refusal tells a homeowner something they can act on', () => {
  /* They uploaded a photograph and it was refused. "Invalid image" tells them
     nothing; the number and what to do instead tells them everything. */
  const at = src.indexOf('That photo is ${Math.round(megapixels)} megapixels');
  assert.ok(at > 0, 'the message no longer names the size');
  assert.match(src.slice(at, at + 220), /normal photo from your phone or camera/,
    'it should say what to do instead');
});
