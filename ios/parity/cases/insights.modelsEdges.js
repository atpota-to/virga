// The report models (src/reports/models.js) at their edges: hand-made
// archives (ios/parity/cases/_reports.js) from the models' own tests and
// beyond (nothing at all; undated and unreadable rows; a DID twice; DIDs
// that differ only in normalization; every format, length band and place
// in a thread; tags in several cases; ties broken by name; rows from before
// the Content report; lists of every purpose; a follower log), then the
// small pure functions and the tables. Swift: VirgaInsights/Reports/
// ReportModels*.swift.

import { customPeriod } from '../../../src/lib/periods.js';
import {
  BEST_TIME_MIN_POSTS,
  CONTENT_FORMATS,
  CONTENT_MIN_POSTS,
  GIVEN_NOUN,
  LENGTH_BANDS,
  THREAD_PLACES,
  WEEKDAYS,
  WEEKDAYS_LONG,
  contentModel,
  contentReady,
  contentStandout,
  formatOf,
  hourColumns,
  hourRange,
  median,
  weekdayOrder,
} from '../../../src/reports/models.js';
import { each, value } from './_helpers.js';
import { under } from './_archive.js';
import {
  EDGE_NOW,
  MODELS,
  NOW,
  contexts,
  edgeArchives,
  harnessArchives,
  modelCases,
  preset,
} from './_reports.js';

export const sources = ['src/reports/models.js'];

export default async function cases() {
  const out = [];
  const archives = { ...harnessArchives(), ...edgeArchives() };
  const context = contexts(3000);
  const inputs = {};
  const add = (fn, input) => (inputs[fn] ||= []).push(input);

  const periods = [
    preset('all'),
    preset('30d'),
    customPeriod('2026-11-01', '2026-11-30', EDGE_NOW),
  ];
  for (const name of Object.keys(edgeArchives()))
    for (const period of periods)
      for (const fn of Object.keys(MODELS))
        add(fn, {
          $id: `${name}-${period.key}`,
          archive: name,
          nowMs: EDGE_NOW,
          period,
          options: {},
        });
  for (const block of [1, 2, 5, 7, 24])
    add('bestTimeModel', {
      $id: `bestTime-all-block-${block}`,
      archive: 'bestTime',
      nowMs: EDGE_NOW,
      period: preset('all'),
      options: { block },
    });
  for (const kind of ['like', 'reply', 'mention', 'quote'])
    add('peopleModel', {
      $id: `people-all-${kind}`,
      archive: 'people',
      nowMs: EDGE_NOW,
      period: preset('all'),
      options: { kind },
    });
  // A "now" between the archive's own and the window's: the cache keys on
  // the archive's now, the window on the one passed in.
  add('followersModel', {
    $id: 'people-7d-later',
    archive: 'people',
    nowMs: EDGE_NOW + 3 * 86_400_000,
    period: preset('7d'),
    options: {},
  });

  for (const fn of Object.keys(inputs))
    out.push(...(await modelCases(fn, inputs[fn], archives, context)));
  for (const fn of ['listsModel', 'followerLogModel', 'relationSets'])
    out.push(
      ...(await modelCases(
        fn,
        Object.keys(edgeArchives()).map((name) => ({
          $id: name,
          archive: name,
          nowMs: EDGE_NOW,
        })),
        archives,
        context,
      )),
    );

  // The small pure functions.
  out.push(
    ...(await each(
      'median',
      [
        [],
        [1],
        [1, 2, 1000],
        [1, 3],
        [3, 1, 2, 2],
        [5, -1, 0.5, 2.25],
        [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
        [2, 2],
      ].map((values) => ({ values })),
      ({ values }) => median(values),
    )),
  );
  const hours = [];
  for (const locale of ['en-US', 'en-GB'])
    for (const block of [1, 2, 3, 4, 6, 8, 12, 24])
      for (let col = -1; col <= Math.ceil(24 / block) + 1; col++)
        hours.push({ col, block, locale });
  out.push(
    ...(await each('hourRange', hours, (input) =>
      under(input, () => hourRange(input.col, input.block)),
    )),
  );
  out.push(
    ...(await each(
      'hourColumns',
      [1, 2, 3, 4, 5, 6, 7, 8, 12, 24].flatMap((block) => [
        { block, locale: 'en-US' },
        { block, locale: 'en-GB' },
      ]),
      (input) => under(input, () => hourColumns(input.block)),
    )),
  );
  out.push(
    ...(await each(
      'weekdayOrder',
      [0, 1, 6].map((weekStart) => ({ weekStart })),
      (input) => under(input, () => weekdayOrder()),
    )),
  );
  out.push(
    ...(await each(
      'formatOf',
      [
        {},
        { quoteOf: 'did:plc:x' },
        { quoteOf: 'did:plc:x', media: 'image' },
        { media: 'gif' },
        { media: '' },
        { media: '', quoteOf: 'did:plc:x' },
        { quoteOf: '' },
        { media: null, quoteOf: null },
        { media: 'sticker' },
      ].map((post) => ({ post })),
      ({ post }) => formatOf(post),
    )),
  );
  out.push(
    ...(await each(
      'contentReady',
      [
        { posts: { shape: 2 } },
        { posts: { shape: 1 } },
        { posts: {} },
        {},
        { posts: { shape: '2' } },
        { posts: { shape: 2.5 } },
        { posts: null },
      ].map((meta) => ({ meta })),
      ({ meta }) => contentReady({ meta }),
    )),
  );
  const g = (key, typical, extra = {}) => ({
    key,
    label: key,
    posts: 3,
    total: 9,
    share: 0.5,
    typical,
    ...extra,
  });
  const standouts = [
    {
      groups: [g('text', 4), g('image', 60), g('link', null)],
      overall: 9,
      against: 'text',
    },
    {
      groups: [g('text', 4), g('image', 60), g('link', null)],
      overall: 9,
      against: null,
    },
    { groups: [g('text', 9), g('image', 4)], overall: 5, against: 'text' },
    { groups: [g('text', 9)], overall: 5, against: null },
    { groups: [g('text', 4), g('image', 5)], overall: 6, against: null },
    { groups: [g('text', 4), g('image', 5)], overall: null, against: null },
    { groups: [g('text', 4), g('image', 5)], overall: null, against: 'text' },
    { groups: [g('a', 5), g('b', 5), g('c', 2)], overall: 3, against: null },
    { groups: [g('a', 5), g('b', 5)], overall: 5, against: null },
    { groups: [g('a', 0), g('b', 0.5)], overall: 0, against: 'a' },
    { groups: [g('a', 2), g('b', 3)], overall: 1, against: 'nope' },
    { groups: [g('café', 2), g('café', 3)], overall: 1, against: 'café' },
    { groups: [], overall: 1, against: null },
  ];
  out.push(
    ...(await each(
      'contentStandout',
      standouts,
      ({ groups, overall, against }) =>
        contentStandout(groups, overall, against),
    )),
  );
  // And over the Content report's own groups.
  const real = [];
  for (const name of ['mira', 'content']) {
    const nowMs = name === 'mira' ? NOW : EDGE_NOW;
    const report = contentModel(
      context(archives[name], nowMs),
      preset('all'),
      nowMs,
    );
    for (const key of ['formats', 'lengths', 'places'])
      for (const against of [null, 'text', 'short', 'single'])
        real.push({
          $id: `${name}-${key}-${against}`,
          groups: report[key],
          overall: report.typical,
          against,
        });
  }
  out.push(
    ...(await each('contentStandout', real, ({ groups, overall, against }) =>
      contentStandout(groups, overall, against),
    )),
  );

  out.push(
    value('constants', {
      WEEKDAYS,
      WEEKDAYS_LONG,
      BEST_TIME_MIN_POSTS,
      CONTENT_FORMATS,
      LENGTH_BANDS: LENGTH_BANDS.map((b) => ({
        ...b,
        max: Number.isFinite(b.max) ? b.max : '$Infinity',
      })),
      THREAD_PLACES,
      CONTENT_MIN_POSTS,
      GIVEN_NOUN: Object.entries(GIVEN_NOUN),
    }),
  );
  return out;
}
