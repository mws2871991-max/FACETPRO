/* A photograph taken on a phone is usually stored the wrong way round.

   The sensor writes landscape pixels and records, in an EXIF tag, which way up
   the picture was actually taken. Every viewer applies that tag; a parser that
   reads only the start-of-frame dimensions does not, and gets a portrait
   photograph back as landscape.

   On the measured path that is not cosmetic. Area resolves as

     aspect x 1.98^2 x (wallW% x wallH%) / doorH%^2

   so `aspect` is a term in the answer, and the detection boxes come back as
   percentages of the image the model was shown — which is the upright one.
   Reading the header alone puts those two in different frames.

   Measured on a real iPhone photograph of a Victorian terrace, through the
   live service:

     header dimensions (1600x1200)   average window 2.70 m   £20,089
     the photograph as it is (1200x1600)  average window 1.52 m   £14,482

   2.70 m average window width is not a real house. The estimate was 39% high,
   labelled "measured from your photo", which is the strongest claim the
   product makes.

   Why nothing caught it: every fixture in this suite is synthesised from
   metres and carries no EXIF at all, so the frame and the boxes always agreed.
   The client re-encodes through a canvas — which does apply orientation — but
   only for images over 1600px on the long edge. Anything already resized by a
   messaging app arrives under that and goes up untouched. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');

const { sniffImage } = require('../measure');

/* A JPEG with a real APP1/EXIF block, built by hand so the test does not
   depend on a fixture file. Little-endian TIFF, one IFD entry: orientation. */
function jpegWithOrientation(orientation, width = 1600, height = 1200) {
  const parts = [Buffer.from([0xff, 0xd8])];

  if (orientation !== null) {
    const tiff = Buffer.alloc(26);
    tiff.write('II', 0, 'latin1');
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);          // first IFD at offset 8
    tiff.writeUInt16LE(1, 8);          // one entry
    tiff.writeUInt16LE(0x0112, 10);    // Orientation
    tiff.writeUInt16LE(3, 12);         // SHORT
    tiff.writeUInt32LE(1, 14);         // count
    tiff.writeUInt16LE(orientation, 18);
    tiff.writeUInt32LE(0, 22);         // no next IFD

    const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const app1 = Buffer.alloc(4);
    app1.writeUInt16BE(0xffe1, 0);
    app1.writeUInt16BE(exif.length + 2, 2);
    parts.push(app1, exif);
  }

  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof, Buffer.alloc(32));

  return Buffer.concat(parts);
}

test('a quarter-turned photograph is reported as it is seen, not as it is stored', () => {
  /* 6 and 8 are the two quarter turns a phone records. Stored 1600x1200,
     shown 1200x1600. */
  for (const orientation of [5, 6, 7, 8]) {
    const r = sniffImage(jpegWithOrientation(orientation));
    assert.strictEqual(r.width, 1200, `orientation ${orientation} kept the stored width`);
    assert.strictEqual(r.height, 1600, `orientation ${orientation} kept the stored height`);
    assert.ok(r.width / r.height < 1, 'a portrait photograph must not report a landscape aspect');
  }
});

test('an upright photograph is left exactly alone', () => {
  for (const orientation of [1, 2, 3, 4]) {
    const r = sniffImage(jpegWithOrientation(orientation));
    assert.strictEqual(r.width, 1600, `orientation ${orientation} was turned when it should not have been`);
    assert.strictEqual(r.height, 1200);
  }
});

test('a JPEG with no EXIF at all still works', () => {
  const r = sniffImage(jpegWithOrientation(null));
  assert.strictEqual(r.mime, 'image/jpeg');
  assert.strictEqual(r.width, 1600);
  assert.strictEqual(r.height, 1200);
});

test('a malformed EXIF block is ignored rather than fatal', () => {
  /* An unreadable tag is not a reason to refuse somebody's photograph. */
  const good = jpegWithOrientation(6);
  const truncated = Buffer.concat([good.subarray(0, 12), good.subarray(40)]);
  const r = sniffImage(truncated);
  assert.ok(r === null || r.mime === 'image/jpeg', 'a damaged EXIF block threw instead of being skipped');
});

test('the orientation is reported, so a caller can tell why', () => {
  assert.strictEqual(sniffImage(jpegWithOrientation(6)).orientation, 6);
  assert.strictEqual(sniffImage(jpegWithOrientation(1)).orientation, 1);
});

test('the aspect ratio the wall-area formula receives is the upright one', () => {
  /* The formula multiplies by aspect, so the error is proportional and
     invisible — no bound is exceeded, nothing looks wrong, every number is
     simply out by the frame's proportions. */
  const stored = sniffImage(jpegWithOrientation(6));
  const asShown = stored.width / stored.height;
  const asStored = 1600 / 1200;
  assert.ok(Math.abs(asShown - 0.75) < 1e-9);
  assert.ok(Math.abs(asStored / asShown - 1.777) < 0.01,
    'the two frames differ by the square of the proportions — that is the size of the error');
});
