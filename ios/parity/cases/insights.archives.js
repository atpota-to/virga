// The archives the report fixtures run over (ios/parity/cases/_reports.js):
// the harness's two accounts as the sync would have archived them, thinned,
// and hand-made ones for the edges. Each is one value case, its JSON text,
// which the other insights fixtures name. Swift: ReportsTestSupport.swift.

import { archiveCases, edgeArchives, harnessArchives } from './_reports.js';

export const sources = [
  'src/reports/models.js',
  'harness/world.js',
  'src/lib/analytics.js',
];

export default async function cases() {
  return archiveCases({ ...harnessArchives(), ...edgeArchives() });
}
