// The reports, the tools and their sections, and what each feature can
// touch (ACCESS, from components/AccessBadge.jsx): whole tables, word for
// word, with each icon by name. Swift: VirgaInsights/Reports/ReportsRegistry
// .swift, Tools/ToolsRegistry.swift and Components/AccessBadge.swift.

import { REPORTS, REPORT_BY_KEY } from '../../../src/reports/registry.js';
import {
  ACCESS,
  TOOLS,
  TOOL_BY_KEY,
  TOOL_SECTIONS,
} from '../../../src/tools/registry.js';
import { value } from './_helpers.js';
import { withIconNames } from './_insights.js';

export const sources = [
  'src/reports/registry.js',
  'src/tools/registry.js',
  'src/components/AccessBadge.jsx',
];

export default async function cases() {
  return [
    value('REPORTS', withIconNames(REPORTS)),
    value('REPORT_BY_KEY', withIconNames(REPORT_BY_KEY)),
    value('TOOL_SECTIONS', TOOL_SECTIONS),
    value('TOOLS', withIconNames(TOOLS)),
    value('TOOL_BY_KEY', withIconNames(TOOL_BY_KEY)),
    value('ACCESS', withIconNames(ACCESS)),
    value('ACCESS.keys', Object.keys(ACCESS)),
  ];
}
