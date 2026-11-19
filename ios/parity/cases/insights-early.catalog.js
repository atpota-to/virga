// The report library: every card a dashboard can hold, with every field
// (its words, category, icon, sizes, default size, report and options), and
// the categories Customize groups them by. Whole tables, so a card added,
// renamed or retired on the web fails the Swift tests until the iOS app
// follows. Swift: VirgaInsights/Dashboards/Catalog.swift.

import {
  CATEGORIES,
  WIDGETS,
  WIDGET_LIST,
} from '../../../src/dashboards/catalog.js';
import { value } from './_helpers.js';
import { withIconNames } from './_insights.js';

export const sources = ['src/dashboards/catalog.js'];

export default async function cases() {
  return [
    value('CATEGORIES', CATEGORIES),
    value('WIDGETS', withIconNames(WIDGETS)),
    value('WIDGET_LIST', withIconNames(WIDGET_LIST)),
    // The order WIDGETS lists its types in (an object's keys keep it).
    value('WIDGETS.keys', Object.keys(WIDGETS)),
  ];
}
