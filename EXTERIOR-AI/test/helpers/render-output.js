/* The bytes the provider serves at its output URL.
 *
 * These stubs used to answer the Replicate API and stop there, letting the
 * output URL fall through to a real fetch of a domain that does not resolve.
 * That passed, because a failure to take a copy of the render used to fall
 * back to handing the provider's URL to the browser — so the tests were
 * exercising the degraded path without anybody intending them to, and the
 * one they thought they were testing was never run.
 *
 * That fallback is gone: an image we cannot store is now an error, because the
 * alternative is a photorealistic picture of an identified home sitting at an
 * unauthenticated URL we cannot delete, under a notice promising we delete it.
 * So the output URL has to serve bytes, the way the real one does.
 *
 * Deliberately shared rather than copied into each file. Four copies of a
 * fetch stub is how three of them end up not matching what the fourth learned.
 */

'use strict';

/* Small, and not a real JPEG — nothing downstream decodes it. It is stored
   under an id and served back verbatim. */
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]);

/* Anything that looks like a generated image sitting on a provider's host.
   Matched by extension rather than by hostname so a test can point its stub
   at example.test or at replicate.delivery and get the same answer. */
const isRenderOutput = (url) => /^https?:\/\/[^/]+\/.*\.(jpe?g|png|webp)(\?|$)/i.test(String(url));

const response = () => ({
  ok: true,
  status: 200,
  headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
  arrayBuffer: async () => BYTES.buffer.slice(BYTES.byteOffset, BYTES.byteOffset + BYTES.byteLength),
});

module.exports = { isRenderOutput, response, BYTES };
