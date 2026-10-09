'use strict';
require('./helpers/data-dir');
/* No GPS position leaves the server with a photo (security handoff, 9 Oct).
   Phone photos carry the house's coordinates in EXIF, and the photo goes on
   to Anthropic and Replicate. These build small images with a GPS block and
   check it is gone, the orientation kept, and the picture still decodes. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const { stripMetadata, jpegOrientation } = require('../exifstrip');

/* An APP1 Exif block, big-endian: IFD0 with Orientation and a GPS IFD
   pointer, then a GPS IFD holding a latitude reference. */
function exifWithGps(orientation) {
  const t = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 12 + 4);
  t.write('MM', 0, 'latin1'); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);
  t.writeUInt16BE(2, 8);
  t.writeUInt16BE(0x0112, 10); t.writeUInt16BE(3, 12); t.writeUInt32BE(1, 14); t.writeUInt16BE(orientation, 18);
  const gpsAt = 8 + 2 + 24 + 4;
  t.writeUInt16BE(0x8825, 22); t.writeUInt16BE(4, 24); t.writeUInt32BE(1, 26); t.writeUInt32BE(gpsAt, 30);
  t.writeUInt32BE(0, 34);
  t.writeUInt16BE(1, gpsAt); t.writeUInt16BE(0x0001, gpsAt + 2); t.writeUInt16BE(2, gpsAt + 4); t.writeUInt32BE(2, gpsAt + 6); t.write('N\0', gpsAt + 10, 'latin1');
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]); head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
function jpegWithGps(orientation) {
  const raw = { width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4, 200) };
  const plain = jpeg.encode(raw, 90).data;
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 9]), Buffer.from('camera!', 'latin1')]);
  return Buffer.concat([plain.subarray(0, 2), exifWithGps(orientation), com, plain.subarray(2)]);
}

test('a JPEG loses its GPS block and comments, keeps its orientation, and still decodes', () => {
  const dirty = jpegWithGps(6);
  assert.ok(dirty.includes(Buffer.from([0x88, 0x25])), 'the fixture has a GPS pointer');
  const clean = stripMetadata(dirty, 'image/jpeg');
  assert.ok(!clean.includes(Buffer.from([0x88, 0x25])), 'GPS pointer gone');
  assert.ok(!clean.includes(Buffer.from('camera!', 'latin1')), 'comment gone');
  const app1 = clean.indexOf(Buffer.from('Exif\0\0', 'latin1'));
  assert.ok(app1 > 0, 'an orientation-only EXIF block is written back');
  assert.strictEqual(jpegOrientation(clean.subarray(app1)), 6, 'still the right way up');
  assert.strictEqual(jpeg.decode(clean).width, 8);
});

test('an upright JPEG gets no EXIF block at all', () => {
  const clean = stripMetadata(jpegWithGps(1), 'image/jpeg');
  assert.strictEqual(clean.indexOf(Buffer.from('Exif', 'latin1')), -1);
});

test('a PNG loses eXIf and text chunks', () => {
  const p = new PNG({ width: 4, height: 4 }); p.data.fill(255);
  const plain = PNG.sync.write(p);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const iend = plain.length - 12;
  const dirty = Buffer.concat([plain.subarray(0, iend), chunk('tEXt', Buffer.from('GPS\0 51.5N', 'latin1')), chunk('eXIf', Buffer.from('MM\0*', 'latin1')), plain.subarray(iend)]);
  const clean = stripMetadata(dirty, 'image/png');
  assert.ok(!clean.includes(Buffer.from('tEXt')) && !clean.includes(Buffer.from('eXIf')));
  assert.strictEqual(PNG.sync.read(clean).width, 4);
});

test('anything that does not parse is handed back unchanged, never thrown', () => {
  const junk = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]);
  assert.strictEqual(stripMetadata(junk, 'image/jpeg'), junk);
  assert.strictEqual(stripMetadata(Buffer.from('hello'), 'image/png').toString(), 'hello');
});

test('every upload is stripped before it goes anywhere, and the page always re-draws it', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(server, /const clean = stripMetadata\(buffer, found\.mime\);/);
  assert.match(page, /const scale = Math\.min\(1, MAX_UPLOAD_EDGE_PX \/ longest\);/);
  assert.doesNotMatch(page, /longest <= MAX_UPLOAD_EDGE_PX\) return asIs/);
});
