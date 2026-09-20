/* The list under the photograph has to agree with the count above it.

   The 20 September review, re-testing the merged count fix: the heading read
   "We found 5 windows and a front door", correctly excluding the two glazed
   panels beside the door — and the element list underneath still tagged
   "Porch Sidelight Left" as WINDOW. One box, two descriptions, on one screen,
   and the one a homeowner counts by hand is the list.

   So /api/detect marks them, using the same predicate that drops them from
   the count. Both response paths are covered here: the fresh answer and the
   cached one, because the cache is what a homeowner actually hits when they
   reload, and a fix that only lands on one of them is a fix that disappears. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3134;
const BASE = `http://127.0.0.1:${PORT}`;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    const body = [
      { type: 'cladding', label: 'Front wall', confidence: 0.9, x_pct: 2, y_pct: 5, w_pct: 90, h_pct: 70 },
      { type: 'door-front', label: 'Front door', confidence: 0.95, x_pct: 45, y_pct: 55, w_pct: 8, h_pct: 20 },
      { type: 'window', label: 'Lower Left Window', confidence: 0.9, x_pct: 10, y_pct: 55, w_pct: 12, h_pct: 14 },
      { type: 'window', label: 'Upper Left Window', confidence: 0.9, x_pct: 10, y_pct: 20, w_pct: 12, h_pct: 14 },
      // The two the count excludes and the list used to call windows.
      { type: 'window', label: 'Porch Sidelight Left', confidence: 0.9, x_pct: 41, y_pct: 55, w_pct: 3, h_pct: 20 },
      { type: 'window', label: 'Porch Sidelight Right', confidence: 0.9, x_pct: 54, y_pct: 55, w_pct: 3, h_pct: 20 },
    ];
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(body) }] }) };
  }
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
process.env.DETECT_RATE_LIMIT = '200';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

function jpeg(width = 640, height = 480) {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(64)]).toString('base64');
}

const detect = (image) => realFetch(`${BASE}/api/detect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image, mimeType: 'image/jpeg' }),
}).then(r => r.json());

const check = (body, where) => {
  const sidelights = body.detections.filter(d => /sidelight/i.test(d.label));
  assert.strictEqual(sidelights.length, 2, `${where}: the sidelights are missing from the list entirely`);
  for (const s of sidelights) {
    assert.strictEqual(s.countedWith, 'door',
      `${where}: "${s.label}" is not marked as belonging to the door, so the list will tag it WINDOW`);
  }
  const windows = body.detections.filter(d => d.type === 'window' && d.countedWith !== 'door');
  assert.strictEqual(windows.length, 2, `${where}: the ordinary windows were marked or dropped`);
  assert.strictEqual(body.frontWindowCount, 2,
    `${where}: the count and the list disagree, which is the whole bug`);
};

test('sidelights are marked as the door’s, in the fresh answer and the cached one', async () => {
  const photo = jpeg(640, 480);
  check(await detect(photo), 'fresh');
  check(await detect(photo), 'cached');
});

test('a window is still a window', async () => {
  const body = await detect(jpeg(800, 600));
  const plain = body.detections.find(d => d.label === 'Upper Left Window');
  assert.strictEqual(plain.countedWith, undefined,
    'an ordinary window must carry no marking, or every window reads as part of the door');
});
