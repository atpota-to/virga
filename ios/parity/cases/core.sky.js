// The sky behind every page. Swift: VirgaCore/Lib/Sky.swift.

import {
  SKY_CHOICES,
  SKY_PHASES,
  hourOf,
  phaseAtHour,
  skyColor,
  skyFor,
  themeOf,
} from '../../../src/lib/sky.js';
import { each, value } from './_helpers.js';
import { inZone } from './_zones.js';

export const sources = ['src/lib/sky.js'];

const HOURS = [
  0,
  4.99,
  5,
  6.5,
  7.99,
  8,
  12,
  16.99,
  17,
  18,
  19.99,
  20,
  23,
  23.99,
  24,
  30,
  -1,
  -25,
  48.5,
  1e9,
  'six',
  '6',
  '',
  null,
  true,
  [7],
  'NaN',
];

export default async function cases() {
  const out = [value('constants', { SKY_PHASES, SKY_CHOICES })];
  out.push(
    ...(await each(
      'phaseAtHour',
      HOURS.map((hour) => ({ hour })),
      ({ hour }) => phaseAtHour(hour),
    )),
  );
  out.push(
    ...(await each(
      'skyFor',
      [...SKY_CHOICES, 'noon', null, '', 'Night'].flatMap((choice) =>
        [false, true].flatMap((dark) =>
          [0, 6, 12, 18, 22, 3.5].map((hour) => ({ choice, dark, hour })),
        ),
      ),
      ({ choice, dark, hour }) => skyFor(choice, { dark, hour }),
    )),
    ...(await each(
      'skyForDefaults',
      [{ choice: 'clock' }, { choice: null }, { choice: 'dusk' }],
      ({ choice }) => skyFor(choice),
    )),
  );
  out.push(
    ...(await each(
      'themeOf',
      [...SKY_PHASES, 'clock', null, 'NIGHT'].map((sky) => ({ sky })),
      ({ sky }) => themeOf(sky),
    )),
  );
  out.push(
    ...(await each(
      'skyColor',
      [...SKY_PHASES, 'clock', null].flatMap((sky) =>
        ['normal', 'high', 'system', null].map((contrast) => ({
          sky,
          contrast,
        })),
      ),
      ({ sky, contrast }) =>
        contrast === null ? skyColor(sky) : skyColor(sky, contrast),
    )),
  );
  out.push(
    ...(await each(
      'hourOf',
      ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Chatham'].flatMap(
        (zone) =>
          [
            Date.UTC(2026, 10, 14, 17, 30),
            Date.UTC(2026, 10, 14, 0, 0),
            Date.UTC(2026, 10, 14, 23, 59, 59),
            Date.UTC(2026, 2, 8, 7, 15),
          ].map((time) => ({ zone, time })),
      ),
      ({ zone, time }) => inZone(zone, () => hourOf(new Date(time))),
    )),
  );
  return out;
}
