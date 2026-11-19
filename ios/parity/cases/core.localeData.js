// The locale data the Swift port formats with (VirgaCore/Lib/LocaleData+
// Table.swift), read out of the runtime's own Intl by _localeData.js. The
// Swift test compares its table with this one, so when a new Node brings new
// CLDR data this fixture changes, the Swift test fails, and
// `node ios/parity/locale-data.mjs` writes the Swift table again. (Which
// ICU it came from is left out, so a Node upgrade that changes no data
// changes no fixture.)

import { localeTable } from './_localeData.js';
import { value } from './_helpers.js';

export const sources = ['src/lib/locale.js'];

export default async function cases() {
  const table = localeTable();
  return [
    value('formats', table.formats),
    value('names', table.names),
    value('regions', table.regions),
    value('languages', table.languages),
  ];
}
