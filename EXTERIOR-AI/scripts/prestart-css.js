#!/usr/bin/env node
/* Build the stylesheet, or check the built one — whichever this machine can do.

   Both `npm run build:css` and `npm start` come through here, deliberately.
   They used to be different commands and disagreed: build:css shelled out to
   Tailwind, which skips the write when the output is byte-identical, leaving
   app.css older than index.html — and then prestart warned that a perfectly
   current stylesheet was stale. Two paths, one of them lying.

   assets/app.css is compiled ahead of time and the site is unstyled without
   it — a spectacular way to discover a deploy went wrong, and one nobody sees
   until a homeowner does.

   It cannot simply rebuild. Production installs with `npm ci --omit=dev`, so
   Tailwind is not present at start time; that is why the output is committed.
   A prestart that shells out to a missing binary would have taken the whole
   site down rather than serving the file sitting right there.

   So: rebuild where we can, verify where we cannot, and refuse to start with
   no stylesheet at all. */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = path.join(root, 'assets', 'app.css');
const markup = path.join(root, 'index.html');

const canBuild = (() => {
  try { require.resolve('tailwindcss/package.json', { paths: [root] }); return true; }
  catch (_) { return false; }
})();

if (canBuild) {
  execFileSync('npx', ['tailwindcss', '-i', './styles/tailwind.css', '-o', './assets/app.css', '--minify'],
    { cwd: root, stdio: 'inherit' });
  /* Tailwind skips the write when the output is byte-identical, so a correct
     rebuild can leave the file older than the markup — and the staleness
     check below would then warn about a stylesheet that is perfectly current.
     A warning that fires on a good build is one people learn to ignore. */
  const now = new Date();
  fs.utimesSync(css, now, now);
  process.exit(0);
}

/* No Tailwind — production. The committed file has to be good enough, so
   check that it is. */
if (!fs.existsSync(css)) {
  console.error([
    '',
    'REFUSING TO START.',
    '',
    'assets/app.css is missing and Tailwind is not installed to build it, so',
    'every page would render unstyled.',
    '',
    'Either commit the built stylesheet (npm run build:css), or add',
    '`npm run build:css` to your platform\'s build command with dev',
    'dependencies available.',
    '',
  ].join('\n'));
  process.exit(1);
}

/* Present, but possibly older than the markup it styles. Not fatal — a
   slightly stale stylesheet is a far better outcome than a dead site — but
   worth saying loudly, because the symptom is a few elements looking wrong
   rather than anything failing. */
if (fs.statSync(markup).mtimeMs > fs.statSync(css).mtimeMs) {
  console.warn('assets/app.css is older than index.html — run `npm run build:css` and commit it, or new classes will render unstyled.');
}
