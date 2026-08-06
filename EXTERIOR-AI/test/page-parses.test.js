/* Does the page's JavaScript actually parse?

   It did not, and nothing noticed. The single inline script had an unclosed
   array literal, so the browser threw

     Uncaught SyntaxError: Unexpected token ';'

   before executing a line of it. No upload, no visualiser, no estimate, no
   consent form — every mount point stayed empty and the page was the static
   markup and nothing else. It had been that way for at least sixteen commits.

   Four hundred and forty-two tests did not catch it, and neither did I. Every
   check I ran was against the API with curl, or against static markup with
   grep. Both keep working perfectly while the application is dead, because
   neither one runs the page. "The site returns 200" and "the site works" are
   different claims and I kept making the first while meaning the second.

   This is the cheapest possible version of the missing check: parse the
   script the way the browser will, and fail if it cannot. It would have
   caught this in under a second, on the commit that introduced it. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PAGES = ['index.html'];

/* Real JavaScript only: <script src> is a file, and application/ld+json is
   JSON, which is not valid JS and would fail here for the wrong reason. */
function inlineScripts(html) {
  return [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m => !/\bsrc=/.test(m[1]) && !/type\s*=\s*["']application\/ld\+json/i.test(m[1]))
    .map(m => m[2]);
}

for (const page of PAGES) {
  test(`${page} — every inline script parses`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    const scripts = inlineScripts(html);
    assert.ok(scripts.length, `no inline script found in ${page} — has it moved to a file?`);
    scripts.forEach((src, i) => {
      try {
        new Function(src);
      } catch (err) {
        assert.fail(`${page} inline script ${i} does not parse: ${err.message}\n` +
          'The browser throws before running any of it, so nothing on the page works.');
      }
    });
  });
}

test('the structured data is valid JSON', () => {
  /* Different failure, same shape: a broken ld+json block is ignored silently
     by the browser and by every crawler, so the page simply stops having
     structured data and nothing says so. */
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(blocks.length, 'the structured data block has gone');
  for (const b of blocks) {
    assert.doesNotThrow(() => JSON.parse(b[1]), 'the structured data is not valid JSON');
  }
});
