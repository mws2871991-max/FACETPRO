/* The automatic render and the door restore.

   The page starts the first render alongside /api/detect (startAutoRender),
   so that request has no detectionId. The restore needs the detection to know
   where the door is, and skipped every automatic render — the first picture
   every customer sees. detectionsForRestore finds the detection by the
   photograph's fingerprint instead, waiting briefly for it to land. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3251;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);

const { _internals } = require('../server');
const { detectionsForRestore, detectionRecords, detectionByImage } = _internals;

before(async () => { await require('./helpers/server-ready')(BASE); });

const door = [{ type: 'door-front', label: 'Front Door', confidence: 0.9, x_pct: 62, y_pct: 54, w_pct: 10, h_pct: 30 }];

test('found by detectionId when the page has one', async () => {
  detectionRecords.set('det-a', { detections: door });
  assert.deepStrictEqual(await detectionsForRestore({ detectionId: 'det-a', fingerprint: 'none' }, 0), door);
});

test('found by the photograph when the render set off before detection finished', async () => {
  // The render arrives first; detection lands 700ms later.
  const pending = detectionsForRestore({ detectionId: null, fingerprint: 'fp-late' }, 5000);
  setTimeout(() => {
    detectionRecords.set('det-late', { detections: door });
    detectionByImage.set('fp-late', 'det-late');
  }, 700);
  assert.deepStrictEqual(await pending, door);
});

test('gives up, rather than hanging the render, when detection never lands', async () => {
  const t0 = Date.now();
  assert.strictEqual(await detectionsForRestore({ detectionId: null, fingerprint: 'fp-never' }, 600), null);
  assert.ok(Date.now() - t0 < 2000);
});
