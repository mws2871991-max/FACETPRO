/* The compiled stylesheet has to match the markup it was compiled from.

   assets/app.css is built ahead of time and committed, because production
   installs with `npm ci --omit=dev` and has no Tailwind to build with. That
   means a class added to index.html does nothing at all until somebody runs
   `npm run build:css` and commits the result — and the failure is silent. The
   suite stays green, the server starts, the page loads, and one element
   renders unstyled.

   It has happened twice. `w-[92px]` on the upload panel shipped as a 600px
   image crushing its caption into a two-word column, and a grid ratio went the
   same way a week later. Both were caught by looking at a browser, which is
   not a control.

   scripts/prestart-css.js does guard this, but by comparing mtimes — and git
   does not preserve mtimes, so a fresh checkout cannot rely on it. This
   compares bytes instead, which is the thing that actually matters.

   The check is a rebuild, not a heuristic. Re-implementing Tailwind's scanner
   here — extracting candidate class names and grepping for each — would be a
   second implementation that can disagree with the first, which is the bug
   this file exists to catch, one level up. */

'use strict';

/* Neither of these writes anything, but the guard is required of every test
   file without exception — see integrity.test.js. A rule with a "only when you
   write" carve-out is a rule somebody has to think about each time, and the
   file that forgets it is the one that runs beside a mounted volume. */
require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMMITTED = path.join(ROOT, 'assets', 'app.css');

const haveTailwind = (() => {
  try { require.resolve('tailwindcss/package.json', { paths: [ROOT] }); return true; }
  catch (_) { return false; }
})();

test('the committed stylesheet exists and is not empty', () => {
  /* Production serves this file and has no way to make another. Missing, every
     page is unstyled; empty is worse, because prestart's existence check
     passes. */
  assert.ok(fs.existsSync(COMMITTED), 'assets/app.css is missing — run npm run build:css');
  assert.ok(fs.statSync(COMMITTED).size > 5000,
    'assets/app.css is suspiciously small for a compiled Tailwind build');
});

test('assets/app.css is what index.html compiles to', { skip: haveTailwind ? false : 'tailwindcss not installed' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fp-css-')), 'app.css');
  try {
    /* Byte-identical arguments to scripts/prestart-css.js, which is what
       `npm run build:css` runs. If that command changes, this must change with
       it — a check that builds differently from the build proves nothing. */
    execFileSync('npx', ['tailwindcss', '-i', './styles/tailwind.css', '-o', out, '--minify'],
      { cwd: ROOT, stdio: 'pipe' });

    const fresh = fs.readFileSync(out, 'utf8');
    const committed = fs.readFileSync(COMMITTED, 'utf8');

    if (fresh === committed) return;

    /* Say which classes are missing rather than "the files differ". The whole
       failure mode is that somebody added a class and did not rebuild, so name
       it — the diff is otherwise a minified wall. */
    const rules = (css) => new Set(css.match(/\.[-\\[\]()/%.:a-zA-Z0-9_]+(?=\{|,|\s*\{)/g) || []);
    const missing = [...rules(fresh)].filter(r => !rules(committed).has(r));
    const extra = [...rules(committed)].filter(r => !rules(fresh).has(r));

    const detail = [
      missing.length ? `  in the markup but NOT in the committed CSS (${missing.length}): ${missing.slice(0, 12).join(' ')}` : '',
      extra.length ? `  in the committed CSS but no longer used (${extra.length}): ${extra.slice(0, 12).join(' ')}` : '',
      (!missing.length && !extra.length) ? '  same rules, different bytes — probably a Tailwind version change' : '',
    ].filter(Boolean).join('\n');

    assert.fail(
      'assets/app.css is out of date with index.html.\n' +
      'Run `npm run build:css` and commit the result.\n' +
      'Until you do, those classes render unstyled in production while every test passes.\n' +
      detail);
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
});
