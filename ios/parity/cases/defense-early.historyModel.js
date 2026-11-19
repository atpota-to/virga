// The History page's words: what a decision came to, and what an approval
// came to in all. Swift: VirgaDefense/HistoryModel.swift. Every state of an
// add and a removal, and the counts in several locales.

import {
  decisionPhrase,
  planOutcome,
} from '../../../src/defense/historyModel.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each } from './_helpers.js';

export const sources = ['src/defense/historyModel.js'];

const d = (over) => ({
  id: 1,
  listId: 'list-1',
  planId: 'p',
  did: 'did:plc:someone',
  action: 'add',
  band: 'UNKNOWN',
  trust: 3,
  via: 'web',
  note: null,
  state: 'done',
  reason: null,
  createdAt: '2026-11-18T10:00:00.000Z',
  actedAt: null,
  undoneAt: null,
  undoes: null,
  ...over,
});

const STATES = [
  'queued',
  'sent',
  'done',
  'already',
  'vetoed',
  'failed',
  'cancelled',
  'unheard-of',
];
const REASONS = [null, '', 'you follow them', 'Invalid subject'];

const DECISIONS = [
  ...['add', 'remove'].flatMap((action) =>
    STATES.flatMap((state) =>
      REASONS.flatMap((reason) =>
        [null, '', '2026-11-18T12:00:00.000Z'].map((undoneAt) =>
          d({ action, state, reason, undoneAt }),
        ),
      ),
    ),
  ),
  d({ action: 'add', band: null, via: 'dm', note: 'block @x', undoes: null }),
  d({ action: 'remove', undoes: 41, state: 'done' }),
];

const PLANS = [
  {
    counts: {
      added: 100,
      waiting: 394,
      kept: 2,
      failed: 0,
      undone: 0,
      live: 494,
    },
  },
  { counts: { undone: 3 } },
  {},
  null,
  { counts: null },
  { counts: { added: 1, waiting: 1, kept: 1, failed: 1, undone: 1, live: 2 } },
  {
    counts: {
      added: 1234567,
      waiting: 10000,
      kept: 999,
      failed: 1000,
      undone: 12345,
      live: 1244567,
    },
  },
  { counts: { failed: 7 } },
  { counts: { kept: 5, live: 0 } },
  {
    id: '3f9a2c1b-0000-4000-8000-000000000000',
    listId: 'l',
    postUri: 'at://did:plc:me/app.bsky.feed.post/1',
    createdAt: '2026-11-18T10:00:00.000Z',
    approvedAt: '2026-11-18T10:01:00.000Z',
    bands: ['UNKNOWN', 'NOTABLE'],
    note: 'pile-on',
    totals: { rows: 494, byBand: { UNKNOWN: 480, NOTABLE: 14 } },
    counts: {
      added: 494,
      waiting: 0,
      kept: 0,
      failed: 0,
      undone: 0,
      live: 494,
    },
  },
];

const LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-DE', 'en-CH', 'en-ZA', 'en-SE'];

export default async function cases() {
  return [
    ...(await each(
      'decisionPhrase',
      DECISIONS.map((decision) => ({ decision })),
      ({ decision }) => decisionPhrase(decision),
    )),
    ...(await each(
      'planOutcome',
      PLANS.flatMap((plan) => LOCALES.map((locale) => ({ plan, locale }))),
      ({ plan, locale }) => {
        try {
          setActiveLocale(locale);
          return planOutcome(plan);
        } finally {
          setActiveLocale(DEFAULT_LOCALE);
        }
      },
    )),
  ];
}
