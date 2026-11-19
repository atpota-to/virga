// JavaScript's Date, which the Swift ports lean on wherever the web reads a
// date string or works on the local calendar (VirgaCore/Support/JSDate.swift):
// Date.parse (the ISO format and V8's legacy forms), Date.UTC and new
// Date(y, m, d, ...) with their overflow, local fields and toISOString, in
// several zones, clock changes included.

import { each } from './_helpers.js';
import { ZONES, inZone } from './_zones.js';

export const sources = ['ios/VirgaKit/Sources/VirgaCore/Support/JSDate.swift'];

const STRINGS = [
  // The ES format, and V8's extensions to it.
  '2026-03-15',
  '2026-03',
  '2026',
  '2026-03-15T12:00:00Z',
  '2026-03-15T12:00:00.123Z',
  '2026-03-15T12:00:00.123456Z',
  '2026-03-15T12:00:00.1Z',
  '2026-03-15T12:00:00.12Z',
  '2026-03-15T12:00:00.1234567891Z',
  '2026-03-15T12:00',
  '2026-03-15T12:00:30',
  '2026-03-15t12:00:00z',
  '2026-03-15T12:00:00+05:30',
  '2026-03-15T12:00:00+0530',
  '2026-03-15T12:00:00-08:00',
  '2026-03-15T12:00:00.000-00:00',
  '2026-03-15T24:00:00Z',
  '2026-03-15T24:00:01Z',
  '2026-03-15T25:00:00Z',
  '2026-03-15T12:60:00Z',
  '2026-03-15T12:00:00+24:00',
  '2026-03-15T12:00:00+05',
  '2026-03-15T12Z',
  '2026-02-30',
  '2026-02-31T00:00:00Z',
  '2026-13-01',
  '2026-00-10',
  '2026-03-32',
  '+002026-03-15T00:00:00Z',
  '-000001-01-01T00:00:00Z',
  '-000000-01-01T00:00:00Z',
  '+275760-09-13T00:00:00Z',
  '+275760-09-13T00:00:00.001Z',
  '1970-01-01T00:00:00Z',
  '0000-01-01',
  '2024-11-14T12:34:56.789Z',
  '2024-11-14T12:34:56.789123+00:00',
  // Legacy forms.
  '2026-03-15 12:00:00',
  '2026-03-15 12:00:00Z',
  '2026-03-15 12:00:00 GMT+0200',
  '2026-3-5',
  '2026/03/15',
  '2026/3/5 14:30',
  '3/15/2026',
  '3/15/26',
  '3/15/99',
  '3/15',
  '15/3/2026',
  'Mar 15 2026',
  'Mar 15, 2026 2:30 PM',
  'March 15, 2026 14:30:15',
  '15 March 2026',
  '15 Mar 2026 10:00 EST',
  'Mar 15',
  '15 Mar',
  '2026 Mar 15',
  'Sun, 15 Mar 2026 12:00:00 GMT',
  'Sun Mar 15 2026 12:00:00 GMT+0000 (Coordinated Universal Time)',
  'Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)',
  'Sun Mar 15 2026 08:00:00 GMT-0400 (Eastern Daylight Time)',
  'Mar 15 2026 12:00 PDT',
  'Mar 15 2026 12:00 UTC+5',
  'Mar 15 2026 12:00 UT',
  'Mar 15 2026 12:00 z',
  '12:00 Mar 15 2026',
  'Mar 15 2026 12:00:00.250',
  'Mar 15 2026 12::',
  'Mar 15 2026 12 PM',
  'Mar 15 2026 13 PM',
  'Mar 15 2026 0 AM',
  'Mar 15 2026 12:30 am',
  'Tuesday, March 15 2026',
  'Sept 1 2026',
  'Septembre 1 2026',
  'Ju 1 2026',
  'mar 15 2026 foo',
  'foo Mar 15 2026',
  'foo15 Mar 2026',
  '(comment) Mar 15 2026',
  'Mar (nested (comment)) 15 2026',
  'Mar 15 2026)',
  'Mar 15 2026 +0100',
  '15.03.2026',
  '-1',
  '1',
  '0',
  '1773576000000',
  '  2026-03-15  ',
  ' 2026-03-15',
  'T12:00',
  '2026-03-15T',
  '2026-03-15T12:00:00Zjunk',
  'not a date',
  '',
  ' ',
  'Invalid Date',
];

const LOCAL_PARTS = [
  [2026, 2, 15, 12, 0],
  [2026, 0, 1],
  [2026, 11, 31, 23, 59, 59, 999],
  [2026, 12, 1],
  [2026, -1, 1],
  [2026, 1, 29],
  [2026, 1, 0],
  [2026, 2, 8, 2, 30],
  [2026, 10, 1, 1, 30],
  [2026, 2, 29, 1, 30],
  [2026, 9, 25, 1, 30],
  [2026, 3, 5, 2, 15],
  [2026, 9, 4, 2, 15],
  [2026, 8, 6, 2, 45],
  [2026, 3, 5, 3, 45],
  [99, 0, 1],
  [100, 0, 1],
  [1969, 11, 31, 23, 59, 59],
  [2026, 2, 15, 25, 61, 61, 1001],
  [1900, 0, 1],
  [2026, 2, 15, 12, 0.5, 30.9],
];

const TIMES = [
  0,
  -1,
  1773576000000,
  1773576000123.9,
  -62198755200000,
  8.64e15,
  -8.64e15,
  8.64e15 + 1,
  253402300799999,
  253402300800000,
  -62167219200001,
  1772960400000,
  1793516400000,
  1774746000000,
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'parse',
      ZONES.flatMap((zone) => STRINGS.map((text) => ({ zone, text }))),
      ({ zone, text }) => inZone(zone, () => Date.parse(text)),
    )),
  );
  out.push(
    ...(await each(
      'local',
      ZONES.flatMap((zone) => LOCAL_PARTS.map((parts) => ({ zone, parts }))),
      ({ zone, parts }) => inZone(zone, () => new Date(...parts).getTime()),
    )),
  );
  out.push(
    ...(await each(
      'utc',
      LOCAL_PARTS.map((parts) => ({ parts })),
      ({ parts }) => Date.UTC(...parts),
    )),
  );
  out.push(
    ...(await each(
      'fields',
      ZONES.flatMap((zone) => TIMES.map((time) => ({ zone, time }))),
      ({ zone, time }) =>
        inZone(zone, () => {
          const d = new Date(time);
          if (Number.isNaN(d.getTime())) return null;
          return {
            year: d.getFullYear(),
            month: d.getMonth(),
            date: d.getDate(),
            day: d.getDay(),
            hours: d.getHours(),
            minutes: d.getMinutes(),
            seconds: d.getSeconds(),
            milliseconds: d.getMilliseconds(),
            timezoneOffset: d.getTimezoneOffset(),
          };
        }),
    )),
  );
  out.push(
    ...(await each(
      'toISOString',
      TIMES.map((time) => ({ time })),
      ({ time }) => new Date(time).toISOString(),
    )),
  );
  return out;
}
