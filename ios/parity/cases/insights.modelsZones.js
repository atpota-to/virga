// The report models (src/reports/models.js) in other zones and formats:
// weeks from Sunday and Saturday, a 24-hour clock, zones with half and
// quarter hours, clock changes in both hemispheres. Local days, weeks,
// months and hours move every bucket, the best-time grid and the custom
// ranges. Over the harness's account and the hand-made best-time archive.
// Swift: VirgaInsights/Reports/ReportModels*.swift.

import {
  EDGE_NOW,
  NOW,
  contexts,
  edgeArchives,
  harnessArchives,
  modelCases,
  preset,
} from './_reports.js';
import { customPeriod } from '../../../src/lib/periods.js';
import { under } from './_archive.js';

export const sources = ['src/reports/models.js'];

const FORMATS = [
  { zone: 'America/New_York', locale: 'en-US', weekStart: 0 },
  { zone: 'Asia/Kolkata', locale: 'en-IN', weekStart: 1 },
  { zone: 'Australia/Lord_Howe', locale: 'en-GB', weekStart: 6 },
  { zone: 'Pacific/Chatham', locale: 'en-DE', weekStart: 1 },
];

const FNS = [
  'followersModel',
  'blocksModel',
  'postsModel',
  'engagementModel',
  'givenModel',
  'peopleModel',
  'bestTimeModel',
  'contentModel',
];

export default async function cases() {
  const out = [];
  const archives = { ...harnessArchives(), ...edgeArchives() };
  const context = contexts(5000);
  const inputs = {};
  const add = (fn, input) => (inputs[fn] ||= []).push(input);
  for (const formats of FORMATS) {
    const custom = under(formats, () =>
      customPeriod('2026-03-25', '2026-04-10', NOW),
    );
    for (const period of [preset('30d'), preset('1y'), custom])
      for (const fn of FNS)
        add(fn, {
          $id: `mira-${formats.zone}-${period.key}`,
          archive: 'mira',
          nowMs: NOW,
          period,
          options: {},
          ...formats,
        });
    add('bestTimeModel', {
      $id: `bestTime-${formats.zone}`,
      archive: 'bestTime',
      nowMs: EDGE_NOW,
      period: preset('all'),
      options: {},
      ...formats,
    });
    add('bestTimeModel', {
      $id: `bestTime-${formats.zone}-1`,
      archive: 'bestTime',
      nowMs: EDGE_NOW,
      period: preset('all'),
      options: { block: 1 },
      ...formats,
    });
    add('followersModel', {
      $id: `people-${formats.zone}`,
      archive: 'people',
      nowMs: EDGE_NOW,
      period: preset('30d'),
      options: {},
      ...formats,
    });
    add('engagementModel', {
      $id: `mira-${formats.zone}-90d-week`,
      archive: 'mira',
      nowMs: NOW,
      period: preset('90d'),
      options: { unit: 'week', rateUnit: 'week' },
      ...formats,
    });
  }
  for (const fn of Object.keys(inputs))
    out.push(...(await modelCases(fn, inputs[fn], archives, context)));
  return out;
}
