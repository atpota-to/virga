// What every report and dashboard card draws (src/reports/models.js), over
// the harness's two accounts (ios/parity/cases/_reports.js): each model for
// every period the app offers (the presets and two custom ranges, one
// running past today), with each option. In UTC, en-US, weeks from Monday;
// insights.modelsZones.js runs them in other zones and formats, and
// insights.modelsEdges.js over hand-made archives. Each output is the
// result's JSON text. Swift: VirgaInsights/Reports/ReportModels*.swift.

import {
  NOW,
  MODELS,
  contexts,
  harnessArchives,
  modelCases,
  periodsAt,
  preset,
} from './_reports.js';

export const sources = ['src/reports/models.js'];

export default async function cases() {
  const out = [];
  const archives = harnessArchives();
  const context = contexts(1000);
  const inputs = {};
  const add = (fn, input) =>
    (inputs[fn] ||= []).push({
      archive: 'mira',
      nowMs: NOW,
      options: {},
      ...input,
    });

  for (const period of periodsAt(NOW))
    for (const fn of Object.keys(MODELS))
      add(fn, { $id: `mira-${period.key}`, period });
  for (const key of ['30d', '1y', 'all'])
    for (const fn of Object.keys(MODELS))
      add(fn, { $id: `lab-${key}`, archive: 'lab', period: preset(key) });

  // Each option, over a window where it matters.
  const opt = (fn, key, options, id) =>
    add(fn, { $id: `mira-${key}-${id}`, period: preset(key), options });
  for (const unit of ['week', 'month', 'year'])
    for (const fn of [
      'followersModel',
      'blocksModel',
      'postsModel',
      'givenModel',
      'atmosphereModel',
    ])
      opt(fn, '90d', { unit }, `unit-${unit}`);
  opt('followersModel', 'all', { unit: 'week' }, 'unit-week');
  opt('postsModel', '30d', { unit: 'week' }, 'unit-week');
  for (const kind of ['like', 'repost', 'reply', 'quote', 'mention']) {
    opt('engagementModel', '90d', { kind }, `kind-${kind}`);
    opt('givenModel', '90d', { kind }, `kind-${kind}`);
    opt('peopleModel', '1y', { kind }, `kind-${kind}`);
  }
  for (const [unit, rateUnit] of [
    ['day', 'day'],
    ['week', 'month'],
    [null, 'day'],
    ['day', 'year'],
  ])
    opt(
      'engagementModel',
      '90d',
      { unit, rateUnit },
      `units-${unit}-${rateUnit}`,
    );
  opt('engagementModel', 'all', { rateUnit: 'month' }, 'units-null-month');
  for (const block of [1, 3, 4, 6])
    opt('bestTimeModel', '1y', { block }, `block-${block}`);

  for (const fn of Object.keys(inputs))
    out.push(...(await modelCases(fn, inputs[fn], archives, context)));
  for (const fn of ['listsModel', 'followerLogModel', 'relationSets'])
    out.push(
      ...(await modelCases(
        fn,
        Object.keys(archives).map((name) => ({
          $id: name,
          archive: name,
          nowMs: NOW,
        })),
        archives,
        context,
      )),
    );
  return out;
}
