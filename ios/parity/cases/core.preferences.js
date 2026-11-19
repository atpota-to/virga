// How Virga looks for whoever is at this device. Swift:
// VirgaCore/Lib/Preferences.swift and PreferencesModel.swift. Every stored
// value readPreferences may meet (the web test's, and what an earlier
// version stored), the attributes for every choice on every device, and
// the formats a set of preferences means.

import {
  ACCENT_CHOICES,
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  SKY_CHOICES,
  applyFormats,
  effectiveContrast,
  readPreferences,
  rootAttributes,
  writePreferences,
} from '../../../src/lib/preferences.jsx';
import {
  DEFAULT_LOCALE,
  DEFAULT_WEEK_START,
  activeLocale,
  activeWeekStart,
  setActiveLocale,
  setActiveWeekStart,
} from '../../../src/lib/locale.js';
import { each, value } from './_helpers.js';

export const sources = ['src/lib/preferences.jsx'];

const store = (stored) => ({
  getItem: (key) => (key === PREFERENCES_KEY ? stored : null),
});

const STORED = [
  null,
  '',
  '{not json',
  'null',
  '5',
  '0',
  'true',
  '"dark"',
  '[]',
  '[{"sky":"dusk"}]',
  '{}',
  JSON.stringify({
    sky: 'dusk',
    density: 'roomy',
    liveSky: true,
    period: '90d',
    extra: 1,
  }),
  JSON.stringify({ liveSky: 'yes' }),
  JSON.stringify({ theme: 'dark' }),
  JSON.stringify({ theme: 'light', sky: true }),
  JSON.stringify({ theme: 'system', sky: false, skyTime: 'dusk' }),
  JSON.stringify({ theme: 'dark', sky: 'dawn' }),
  JSON.stringify({ theme: 'dark', sky: 'clock' }),
  JSON.stringify({ theme: 'light', sky: false, liveSky: true }),
  JSON.stringify({ theme: 'dark', sky: 'noon' }),
  JSON.stringify({ sky: true, liveSky: false }),
  JSON.stringify({ locale: 'en-GB', weekStart: 'sunday' }),
  JSON.stringify({ locale: 'tlh', weekStart: 'someday' }),
  JSON.stringify({ locale: 'en-gb', weekStart: 'Sunday' }),
  JSON.stringify({
    period: 'custom',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
  }),
  JSON.stringify({ period: 'custom', periodFrom: '2026-10-01' }),
  JSON.stringify({
    period: 'custom',
    periodFrom: 'October',
    periodTo: '2026-10-31',
  }),
  JSON.stringify({
    period: 'custom',
    periodFrom: '2026-10-01\n',
    periodTo: '2026-10-31',
  }),
  JSON.stringify({
    period: 'custom',
    periodFrom: '２０２６-10-01',
    periodTo: '2026-10-31',
  }),
  JSON.stringify({
    period: '7d',
    periodFrom: '2026-10-01',
    periodTo: 20261031,
  }),
  JSON.stringify({ accent: 'teal', contrast: 'high', sky: 'dusk' }),
  JSON.stringify({ accent: '#ff00ff', contrast: 'max', sky: 'noon' }),
  JSON.stringify({ sidebar: 'collapsed', density: 'compact' }),
  JSON.stringify({ sidebar: 'hidden', density: 'COMPACT' }),
  JSON.stringify({ accent: 3, sky: null, period: ['30d'] }),
  JSON.stringify({
    ...DEFAULT_PREFERENCES,
    sky: 'night',
    accent: 'graphite',
    contrast: 'normal',
    density: 'compact',
    period: 'all',
    sidebar: 'collapsed',
    locale: 'en-IN',
    weekStart: 'saturday',
    liveSky: true,
  }),
  ...SKY_CHOICES.map((sky) => JSON.stringify({ sky })),
  ...ACCENT_CHOICES.map((accent) => JSON.stringify({ accent })),
  // What JSON.parse reads (or refuses) that other JSON readers don't: the
  // stored text decides whether anything is kept.
  '{"sky":"dusk",}',
  '\uFEFF{"sky":"dusk"}',
  ' \n\t{"sky":"dusk"}\r\n ',
  '\u00a0{"sky":"dusk"}',
  '{"sky":"dusk","sky":"night"}',
  '{"sky":"dusk","big":1e400}',
  '{"sky":"dusk","half":"\\ud800"}',
  '{"sky":"dusk","n":01}',
  '{"sky":"dusk"} x',
  "{'sky':'dusk'}",
  '{"sky":"dusk"/*c*/}',
  '{"sky":"du\\u0073k"}',
  '{"sky":"dusk","theme":"dark","sky":3}',
];

const PREFS_FOR_ATTRIBUTES = [
  DEFAULT_PREFERENCES,
  null,
  { sky: 'dusk', accent: 'rose', contrast: 'normal', density: 'compact' },
  { accent: 'mauve', density: 'roomy' },
  { sky: 'night' },
  { sky: 'day' },
  { sky: 'noon', contrast: 'max' },
  { contrast: 'high' },
  { contrast: 'normal' },
  ...ACCENT_CHOICES.map((accent) => ({ accent })),
];

export default async function cases() {
  const out = [
    value('constants', {
      PREFERENCES_KEY,
      ACCENT_CHOICES,
      SKY_CHOICES,
      DEFAULT_PREFERENCES,
    }),
  ];
  out.push(
    ...(await each(
      'readPreferences',
      STORED.map((stored) => ({ stored })),
      ({ stored }) => readPreferences(store(stored)),
    )),
    ...(await each('readPreferencesNoStore', [{}], () =>
      readPreferences(null),
    )),
  );
  out.push(
    ...(await each(
      'effectiveContrast',
      ['system', 'normal', 'high', 'max', null].flatMap((contrast) =>
        [false, true].map((systemMore) => ({ contrast, systemMore })),
      ),
      ({ contrast, systemMore }) => effectiveContrast(contrast, systemMore),
    )),
  );
  out.push(
    ...(await each(
      'rootAttributes',
      PREFS_FOR_ATTRIBUTES.flatMap((prefs) =>
        [false, true].flatMap((dark) =>
          [false, true].flatMap((moreContrast) =>
            [0, 5, 7.99, 8, 17, 20].map((hour) => ({
              prefs,
              dark,
              moreContrast,
              hour,
            })),
          ),
        ),
      ),
      ({ prefs, dark, moreContrast, hour }) =>
        rootAttributes(prefs, { dark, moreContrast, hour }),
    )),
    ...(await each(
      'rootAttributesDefaults',
      PREFS_FOR_ATTRIBUTES.map((prefs) => ({ prefs })),
      ({ prefs }) => rootAttributes(prefs),
    )),
  );
  // What writePreferences stores: JSON.stringify of what it is handed, in
  // DEFAULT_PREFERENCES' key order. A store that throws costs nothing.
  out.push(
    ...(await each(
      'writePreferences',
      [
        { prefs: DEFAULT_PREFERENCES },
        {
          prefs: readPreferences(
            store(
              JSON.stringify({
                sky: 'night',
                accent: 'rose',
                liveSky: true,
                period: 'custom',
                periodFrom: '2026-01-01',
                periodTo: '2026-01-31',
                locale: 'en-CH',
                weekStart: 'sunday',
                density: 'compact',
                sidebar: 'collapsed',
                contrast: 'high',
              }),
            ),
          ),
        },
        {
          prefs: {
            ...DEFAULT_PREFERENCES,
            periodFrom: 'quote " and \\ back',
            periodTo: '👍',
          },
        },
      ],
      ({ prefs }) => {
        const written = {};
        writePreferences(prefs, {
          setItem: (key, value) => (written[key] = value),
        });
        writePreferences(prefs, {
          setItem: () => {
            throw new Error('full');
          },
        });
        return written;
      },
    )),
  );
  // What applyFormats leaves in force. `languages` stands in for the
  // browser's, which applyFormats reads through resolveLocale's default.
  out.push(
    ...(await each(
      'applyFormats',
      [
        { locale: 'en-GB', weekStart: 'sunday' },
        { locale: 'en-GB', weekStart: 'monday' },
        { locale: 'en-US', weekStart: 'system' },
        { locale: 'en-DE', weekStart: 'system' },
        { locale: 'en-IN', weekStart: 'saturday' },
        { locale: 'system', weekStart: 'system' },
        { locale: 'tlh', weekStart: 'someday' },
      ].map((prefs) => ({ prefs })),
      ({ prefs }) => {
        try {
          const stamp = applyFormats(prefs);
          return {
            stamp,
            locale: activeLocale(),
            weekStart: activeWeekStart(),
          };
        } finally {
          setActiveLocale(DEFAULT_LOCALE);
          setActiveWeekStart(DEFAULT_WEEK_START);
        }
      },
    )),
  );
  return out;
}
