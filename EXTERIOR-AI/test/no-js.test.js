/* The fallback for a browser that never runs our JavaScript.

   The before/after gallery is a clipped image and a draggable handle. With no
   script, the handle does nothing and the clip is stuck at whatever the
   markup said, so a visitor gets half of one photograph and half of another
   with a line down the middle — on the section whose entire job is to prove
   the work is real.

   The stylesheet has always had a rule for this:

     .no-js .work-before { clip-path: inset(0 100% 0 0); }

   and it had never once fired, because nothing set `no-js` on <html>. A rule
   guarded by a class that does not exist is indistinguishable from no rule at
   all, and there is nothing about the page that would ever have shown it.

   Both halves are asserted here because either alone is silently useless. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the html element ships with the no-js class', () => {
  const open = html.match(/<html[^>]*>/);
  assert.ok(open, 'no <html> tag');
  assert.match(open[0], /class="[^"]*\bno-js\b/,
    'the stylesheet targets .no-js, so the page has to start in that state');
});

test('something removes the class once script runs', () => {
  assert.match(html, /classList\.remove\(['"]no-js['"]\)/,
    'the class is set but never cleared — every visitor would get the fallback');
});

test('the class is cleared before the gallery markup is reached', () => {
  /* If the removal came after the gallery, a browser with script would still
     paint one frame of the fallback. Cheap to get right, invisible when
     wrong, so it is pinned rather than trusted.

     Positions are taken with HTML comments blanked out, because the comment
     explaining this fix names `.no-js .work-before` and would otherwise count
     as the first sighting of the gallery — the test failing on its own
     documentation. Blanked rather than stripped so every remaining offset
     still lines up with the real file. */
  const code = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  const remove = code.indexOf('classList.remove(');
  const gallery = code.indexOf('work-before');
  assert.ok(remove > -1, 'no classList.remove call outside a comment');
  assert.ok(gallery > -1, 'no gallery markup outside a comment');
  assert.ok(remove < gallery,
    'the class is removed after the gallery renders, so JS users see a flash of the fallback');
});

test('the rule the class exists to trigger is still there', () => {
  /* Deleting the CSS rule would leave the class, the script and these tests
     all passing while the fallback quietly stopped existing. */
  assert.match(html, /\.no-js\s+\.work-before\s*\{[^}]*clip-path/,
    'the .no-js fallback rule has gone; the class now guards nothing');
});
