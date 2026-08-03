/* Tailwind 3, deliberately.

   The Play CDN this replaced served v3, and v4 changes things this page uses:
   `border` with no colour defaults to currentColor rather than grey-200,
   `outline-none` means outline-style:none rather than a transparent ring, and
   shadow and space-y scales shift. Upgrading is a separate job with its own
   visual diff — this build exists to render what was already there.

   The content globs matter more than they look. Class names must appear whole
   in the source: the scanner reads these files as text, so

     `bg-white ${active ? 'text-white' : 'text-zinc-500'}`   is found
     `text-${colour}-500`                                    is not

   and the second fails silently, rendering unstyled with no error. */
module.exports = {
  content: ['./index.html', './legal/*.html', './guided-demo.html'],
  theme: { extend: {} },
  plugins: [],
};
