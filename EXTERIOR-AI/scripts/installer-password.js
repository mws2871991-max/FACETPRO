/* Make a passwordHash for LEAD_RECIPIENTS.

     npm run installer-password -- "the password"
  
   Prints the hash and nothing else, so it can be piped. The password is not
   echoed and is not written anywhere — paste the hash into the platform
   dashboard, and give the password to the installer by whatever means you
   would use for any other credential. */
'use strict';
const { makePasswordHash } = require('../installers');
const pw = process.argv[2];
if (!pw) {
  console.error('Usage: npm run installer-password -- "the password"');
  console.error('A password you have chosen, not one you have reused.');
  process.exit(1);
}
if (pw.length < 12) {
  console.error(`That is ${pw.length} characters. Use at least 12 — this guards every lead that installer has bought.`);
  process.exit(1);
}
console.log(makePasswordHash(pw));
