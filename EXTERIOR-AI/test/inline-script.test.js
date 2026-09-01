/* The 207 KB of JavaScript nothing else looks at.

   index.html carries the entire product — upload, detection, the visualiser,
   pricing, the lead form — in two inline <script> blocks. Every other test in
   this suite exercises the server. A syntax error in those blocks breaks the
   page for every visitor while all six hundred of them stay green, and there
   is no failure mode further from "caught by CI".

   It is not hypothetical. This file has been edited most days for a fortnight,
   often by moving large blocks between functions, which is exactly the edit
   that drops a brace.

   vm.Script compiles and does not run. That distinction is the whole trick:
   the code expects a DOM and would throw on the first line if executed, but a
   syntax error is a parse error, and parsing is enough to find it.

   Each block is compiled separately rather than concatenated, because that is
   what a browser does — two classic scripts, two parses. Joining them can hide
   an unbalanced brace in the first block by having the second close it. */

'use strict';

/* Neither of these writes anything, but the guard is required of every test
   file without exception — see integrity.test.js. A rule with a "only when you
   write" carve-out is a rule somebody has to think about each time, and the
   file that forgets it is the one that runs beside a mounted volume. */
require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

/* Inline blocks only.

   `src=` blocks are somebody else's file and are not in this repository.
   The ld+json block is structured data for search engines: it is JSON, it is
   not JavaScript, and compiling it as JavaScript fails by design — a bare
   object literal at statement position is a block with a syntax error, not an
   object. Skipping it is correct rather than convenient. */
function inlineScripts() {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/ld\+json/i.test(attrs)) continue;
    out.push({
      code: m[2],
      // Line number in index.html where this block's contents begin, so a
      // failure points at the file somebody edited rather than at an offset
      // into a string.
      startLine: html.slice(0, m.index).split('\n').length,
      attrs: attrs.trim(),
    });
  }
  return out;
}

test('the inline scripts are found at all', () => {
  const blocks = inlineScripts();
  assert.ok(blocks.length >= 2,
    `expected at least two inline blocks, found ${blocks.length} — if the page was ` +
    'restructured, fix this matcher rather than deleting the test, or the parse ' +
    'check silently stops covering anything');

  const bytes = blocks.reduce((n, b) => n + b.code.length, 0);
  assert.ok(bytes > 50_000,
    `only ${bytes} bytes of inline script matched; the product is much larger than ` +
    'that, so the matcher is probably picking up a fragment');
});

test('every inline script parses', () => {
  for (const block of inlineScripts()) {
    try {
      // Compile only. Nothing runs, so no DOM is needed and nothing this code
      // would do to a browser can happen here.
      new vm.Script(block.code, { filename: `index.html:${block.startLine}` });
    } catch (err) {
      /* vm reports the line within the block; index.html is what somebody has
         open, so translate. */
      const inBlock = Number(String(err.stack || '').match(/index\.html:\d+:(\d+)/)?.[1]);
      const where = Number.isFinite(inBlock)
        ? ` — around line ${block.startLine + inBlock - 1} of index.html`
        : '';
      assert.fail(
        `inline <script ${block.attrs}> starting at line ${block.startLine} does not parse${where}\n` +
        `${err.name}: ${err.message}`);
    }
  }
});

test('the ld+json block is valid JSON, since it is skipped above', () => {
  /* Skipping it from the parse check means nothing was checking it at all.
     It is what search engines read to describe the product, and a trailing
     comma there is invisible until a rich result quietly stops appearing. */
  const m = html.match(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(m, 'the structured-data block has gone — remove this test with it');
  assert.doesNotThrow(() => JSON.parse(m[1]),
    'the ld+json block is not valid JSON');
});
