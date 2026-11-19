// Settings' sections (word for word, in order) and the keys of a radio
// group. Swift: VirgaInsights/Settings/SettingsSections.swift and
// RadioKeys.swift.

import { SECTIONS } from '../../../src/settings/sections.js';
import { radioKeyTarget } from '../../../src/settings/radioKeys.js';
import { each, grid, value } from './_helpers.js';

export const sources = [
  'src/settings/sections.js',
  'src/settings/radioKeys.js',
];

export default async function cases() {
  return [
    value('SECTIONS', SECTIONS),
    ...(await each(
      'radioKeyTarget',
      grid({
        key: [
          'ArrowRight',
          'ArrowDown',
          'ArrowLeft',
          'ArrowUp',
          'Home',
          'End',
          'Tab',
          ' ',
          'Enter',
          'a',
          'Escape',
          'arrowright',
          'PageDown',
        ],
        index: [-1, 0, 1, 2, 5, 6, 9],
        count: [-1, 0, 1, 3, 6],
      }),
      ({ key, index, count }) => radioKeyTarget(key, index, count),
    )),
  ];
}
