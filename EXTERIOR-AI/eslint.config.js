/* Lint rules chosen to catch the things that have actually gone wrong here.

   This project deliberately carries almost no dependencies — four in
   production, and Tailwind for the build — so a 225-package dev tree needed a
   reason. The reason is that a dead variable in routing.js was found by a human
   reading the file, and an unclosed array in index.html took down every line of
   JavaScript on the page for sixteen commits before anyone noticed. Both are
   things a linter finds in under a second.

   So the config is small on purpose. Style is not linted: there is no
   formatter, the codebase is consistent already, and a wall of quote-mark
   complaints is how people learn to run lint with their eyes shut. Every rule
   below is either a real bug or something that has already been one.

   Run with `npm run lint`. */

'use strict';

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'data/**', 'assets/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', exports: 'writable',
        process: 'readonly', console: 'readonly', Buffer: 'readonly',
        __dirname: 'readonly', __filename: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        setImmediate: 'readonly', queueMicrotask: 'readonly',
        fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        AbortController: 'readonly', WebSocket: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly',
        structuredClone: 'readonly', globalThis: 'readonly',
      },
    },
    rules: {
      /* The routing.js case: declared, assigned, never read. */
      'no-unused-vars': ['error', {
        args: 'none',                 // Express handlers take (req, res, next) and often ignore one
        caughtErrors: 'none',         // `catch (_)` is used throughout, deliberately
        varsIgnorePattern: '^_',
        /* `const { name, email, phone, postcode, ...rest } = row` is how this
           codebase drops fields it must not keep — the redaction in scrub(),
           and the per-window geometry an installer has no business reading.
           Naming a field in order to leave it behind is the point, not an
           oversight. */
        ignoreRestSiblings: true,
      }],

      /* An assignment with no declaration is a global, and a global in a
         single-process server is shared between every request. */
      'no-undef': 'error',
      'no-implicit-globals': 'error',

      /* Two keys with the same name in one object literal: the second wins
         silently. In a catalogue or a rates table that is a pricing bug. */
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',

      /* A promise nobody waits for is how a lead gets lost without a trace.

         require-atomic-updates is deliberately NOT on. It fires on
         `lead.notification = await ...` where `lead` is a local object built
         in that handler and shared with nothing — three false positives and no
         true ones. Real shared state here goes through store.mutate, which
         holds a lock across the read and the write, and that is tested. A rule
         that is wrong more often than it is right teaches people to run lint
         with their eyes shut. */
      'no-async-promise-executor': 'error',

      /* Silently unreachable code after a return — usually a half-finished
         edit, occasionally a guard that no longer guards anything. */
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],

      /* Comparing with == against null/undefined is fine and used here;
         everything else should be explicit. */
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      /* Shadowing a name in a 3,000-line file is how the wrong variable gets
         read two hundred lines later. */
      'no-shadow-restricted-names': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',

      /* Left in by accident rather than on purpose. */
      'no-debugger': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
