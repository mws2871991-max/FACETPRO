/* Test email setup.

   Installer-quotes consent is refused unless we can email the homeowner,
   because the withdrawal link only exists in an email — see
   `sendHomeownerEmail` in server.js. So any test that saves a lead with that
   box ticked needs email to look configured, whether or not the test is about
   email at all.

   Require this BEFORE requiring ../server: both the configuration and the
   Resend stub are read when the module loads.

   Nothing is sent. The stub records what would have gone out, which is also
   how the email tests read it. */

'use strict';

const sent = [];

function configureEmail({ from = 'hello@facetpro.co.uk' } = {}) {
  // Only the two settings that decide whether we can reach the homeowner.
  // LEAD_NOTIFY_EMAIL is deliberately left alone: it controls the internal
  // notification, and some tests are about that failing.
  process.env.RESEND_API_KEY = 'test-key-not-real';
  process.env.LEAD_FROM_EMAIL = from;

  require.cache[require.resolve('resend')] = {
    exports: {
      Resend: class {
        constructor() {
          this.emails = { send: async (message) => { sent.push(message); return { data: { id: 'stub' } }; } };
        }
      },
    },
  };
  return sent;
}

module.exports = { configureEmail, sent };
