// Which Terms of Service and Privacy Policy an account agrees to. The gate in
// the browser and the ledger on Virga's server both read it from here (the
// server imports this file, as it does src/config.js), so the two can't name
// different documents. Nothing here may import anything: it also loads under
// plain Node.
//
// TERMS_VERSION goes up by one when either document changes in a way people
// should agree to again; everyone is then asked once more, and the ledger
// gets a new row for each of them. Fixing a typo doesn't change it.
// documents.test.js keeps a fingerprint of both documents beside it, so an
// edit can't pass without that being decided.
export const TERMS_VERSION = 1;

// The "Last updated" date both documents carry, as YYYY-MM-DD. The ledger
// stores it beside the version (as policy_version, the name its sibling
// tables use), so a row says which text it means on its own.
export const TERMS_EFFECTIVE_DATE = '2026-11-23';

// Where the documents are read on the site. The sign-in metadata that an
// account's server shows on its consent screen links to the same two pages.
export const TERMS_PATH = '/terms';
export const PRIVACY_PATH = '/privacy';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A YYYY-MM-DD date as the documents write it: "November 14, 2026". Spelled
 * out here rather than left to Intl, so the server, the browser and a test
 * all print the same words. Null for anything that isn't such a date.
 */
export function formatLegalDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${month} ${day}, ${match[1]}`;
}
