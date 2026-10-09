'use strict';
/* Strip location and other metadata from an uploaded photo (security
   handoff, 9 Oct, priority 1).

   A phone photograph usually carries the GPS position of the house in its
   EXIF block, and the photo goes on to Anthropic and Replicate in the US.
   The page re-encodes large photos through a canvas, which drops EXIF, but a
   photo that is already small, or that the browser cannot decode, went up
   as it was taken. This is the server's backstop, run on every upload in
   readImage before the bytes go anywhere.

   JPEG: every APPn segment except APP0 (JFIF) and APP14 (Adobe colour
   transform, needed to decode some CMYK/YCCK files) is dropped, as are
   comments. If the photo had an EXIF orientation other than "upright", a
   minimal EXIF block holding only that orientation is written back, so the
   picture is still the right way up and nothing else survives.
   PNG: eXIf and the text chunks (tEXt, zTXt, iTXt) are dropped.
   WebP: the EXIF and XMP chunks are dropped and the VP8X flags cleared.

   Anything that does not parse cleanly is handed back unchanged rather than
   half-rewritten: refusing the photo is readImage's job, not this one's. */

function jpegOrientation(app1) {
  // app1 is the segment payload: "Exif\0\0" then a TIFF header.
  if (app1.length < 14 || app1.toString('latin1', 0, 6) !== 'Exif\0\0') return 1;
  const t = app1.subarray(6);
  const le = t.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) break;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}

function orientationOnlyApp1(orientation) {
  // Big-endian TIFF, one IFD entry: Orientation (0x0112), SHORT, count 1.
  const body = Buffer.from([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,             // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // MM, 42, IFD at 8
    0x00, 0x01,                                     // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // orientation, SHORT, 1
    0x00, orientation, 0x00, 0x00,                  // value
    0x00, 0x00, 0x00, 0x00,                         // no next IFD
  ]);
  const seg = Buffer.alloc(4);
  seg[0] = 0xff; seg[1] = 0xe1; seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([seg, body]);
}

function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const keep = [buf.subarray(0, 2)];
  let orientation = 1;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }                 // fill byte
    if (marker === 0xda) { keep.push(buf.subarray(i)); break; } // start of scan: the rest is image data
    if (marker === 0xd9) { keep.push(buf.subarray(i)); break; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    const seg = buf.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe1) orientation = Math.max(orientation, jpegOrientation(buf.subarray(i + 4, i + 2 + len)));
    if (marker === 0xfe || (isApp && marker !== 0xe0 && marker !== 0xee)) {
      // dropped: comments and every APPn except JFIF and Adobe
    } else {
      keep.push(seg);
    }
    i += 2 + len;
  }
  if (orientation !== 1) keep.splice(1, 0, orientationOnlyApp1(orientation));
  return Buffer.concat(keep);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);
function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const keep = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) return null;
    if (!PNG_DROP.has(type)) keep.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(keep);
}

function stripWebp(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const keep = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > buf.length) return null;
    if (type !== 'EXIF' && type !== 'XMP ') {
      let chunk = buf.subarray(i, Math.min(end, buf.length));
      if (type === 'VP8X' && len >= 1) { chunk = Buffer.from(chunk); chunk[8] &= ~0x0c; }   // clear EXIF and XMP flags
      keep.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(keep);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

function stripMetadata(buffer, mime) {
  try {
    const out = mime === 'image/jpeg' ? stripJpeg(buffer)
      : mime === 'image/png' ? stripPng(buffer)
      : mime === 'image/webp' ? stripWebp(buffer)
      : null;
    return out && out.length ? out : buffer;
  } catch (_) {
    return buffer;
  }
}

module.exports = { stripMetadata, jpegOrientation, orientationOnlyApp1 };
