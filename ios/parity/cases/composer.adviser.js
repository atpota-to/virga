// src/posting/adviser/{analysis,setup}.js: which drafts the pre-publish
// check covers, the scenario, the writing checks, applying fixes across a
// thread; and the adviser's setup, its normalizer and the on/off switch.
// Swift: VirgaPosting/Adviser/{Analysis,Setup}.swift.

import {
  ADVISER_CHECK_SCOPES,
  normalizeAdviserScope,
  adviserScopeAllowsDraft,
  adviserScenarioFor,
  enabledWritingChecks,
  fixableWritingIssues,
  applyWritingFixes,
  applyWritingFixesToThread,
} from '../../../src/posting/adviser/analysis.js';
import {
  REVIEW_MODES,
  STYLE_SAMPLE_SIZES,
  DEFAULT_STYLE_SAMPLE_SIZE,
  ADVISER_TEXT_LIMITS,
  DEFAULT_ADVISER_SETTINGS,
  normalizeStyleSampleSize,
  normalizeAdviserSettings,
  isPostingAdviserPristine,
  nextPostingAdviserState,
} from '../../../src/posting/adviser/setup.js';
import { each, grid, value } from './_helpers.js';

export const sources = [
  'src/posting/adviser/analysis.js',
  'src/posting/adviser/setup.js',
];

const SCOPES = [
  'all',
  'topLevel',
  'replies',
  'everything',
  '',
  null,
  undefined,
  5,
];
const ISSUES = [
  { found: 'teh', replacement: 'the' },
  { found: 'recieve', replacement: 'receive' },
  { found: 'same', replacement: 'same' },
  { found: '   ', replacement: 'x' },
  { found: 'x', replacement: '  ' },
  { found: 5, replacement: 'five' },
  null,
  { found: 'across posts', replacement: 'joined' },
  { found: '😀', replacement: '🙂' },
  { found: 'é', replacement: 'é' },
];

export default async function cases() {
  const all = [
    value('analysisConstants', { ADVISER_CHECK_SCOPES }),
    value('setupConstants', {
      REVIEW_MODES,
      STYLE_SAMPLE_SIZES,
      DEFAULT_STYLE_SAMPLE_SIZE,
      ADVISER_TEXT_LIMITS,
      DEFAULT_ADVISER_SETTINGS,
    }),
  ];
  all.push(
    ...(await each(
      'normalizeAdviserScope',
      SCOPES.map((scope) => ({ scope })),
      (i) => normalizeAdviserScope(i.scope),
    )),
    ...(await each(
      'adviserScopeAllowsDraft',
      grid({ scope: SCOPES.slice(0, 5), repliesToOther: [true, false] }),
      (i) =>
        adviserScopeAllowsDraft(i.scope, { repliesToOther: i.repliesToOther }),
    )),
    ...(await each(
      'adviserScenarioFor',
      grid({
        repliesToOther: [true, false],
        quotesOther: [true, false],
        repliesToSelf: [true, false],
        isThread: [true, false],
      }),
      (i) => adviserScenarioFor(i),
    )),
    ...(await each(
      'enabledWritingChecks',
      [
        { checks: null },
        { checks: 'on' },
        { checks: {} },
        { checks: { typos: true } },
        { checks: { typos: 'yes', grammar: 1 } },
        {
          checks: {
            typos: true,
            grammar: true,
            clarity: true,
            customText: '  notes  ',
            styleProfile: { summary: ' casual ' },
          },
        },
        {
          checks: {
            clarity: true,
            customText: '   ',
            styleProfile: { summary: 5 },
          },
        },
        {
          checks: {
            customText: 'only notes',
            styleProfile: { summary: 'style' },
          },
        },
        { checks: [true] },
      ],
      (i) => enabledWritingChecks(i.checks),
    )),
    ...(await each(
      'fixableWritingIssues',
      [{ issues: ISSUES }, { issues: null }, { issues: 'x' }, { issues: [] }],
      (i) => fixableWritingIssues(i.issues),
    )),
    ...(await each(
      'applyWritingFixes',
      [
        { text: 'I recieve teh mail, teh end', issues: ISSUES },
        { text: 'nothing to fix', issues: ISSUES },
        { text: '😀 and é', issues: ISSUES },
        { text: 5, issues: ISSUES },
        { text: 'teh', issues: null },
      ],
      (i) => applyWritingFixes(i.text, i.issues),
    )),
    ...(await each(
      'applyWritingFixesToThread',
      [
        {
          posts: [
            { id: 1, text: 'first teh' },
            { id: 2, text: 'second recieve' },
            { id: 3, text: 'across' },
            { id: 4, text: 'posts' },
          ],
          issues: ISSUES,
        },
        { posts: [{ id: 1, text: 'clean' }], issues: ISSUES },
        {
          posts: [{ id: 1 }, { id: 2, text: 5 }, { id: 3, text: 'teh' }],
          issues: ISSUES,
        },
        { posts: 'not a thread', issues: ISSUES },
        { posts: [], issues: ISSUES },
      ],
      (i) => applyWritingFixesToThread(i.posts, i.issues),
    )),
    ...(await each(
      'normalizeStyleSampleSize',
      [100, 250, 500, '250', 300, null, undefined, 'x', 250.0, [500]].map(
        (value) => ({ value }),
      ),
      (i) => normalizeStyleSampleSize(i.value),
    )),
  );
  const RAW = [
    null,
    'on',
    [],
    {},
    DEFAULT_ADVISER_SETTINGS,
    {
      enabled: 'true',
      checkBeforePublish: true,
      reviewMode: 'always',
      checkScope: 'replies',
      checkReplyContext: 1,
      goals: {
        presets: {
          reduceNegativity: true,
          lessConfrontational: 'yes',
          limitTopic: { enabled: true, topic: 't'.repeat(250) },
        },
        customText: 'g'.repeat(600),
      },
      writingChecks: {
        typos: true,
        grammar: false,
        clarity: true,
        customText: '😀'.repeat(300),
        styleSampleSize: '500',
        styleProfile: {
          summary: 's'.repeat(1600),
          analyzedCount: '42.9',
          updatedAt: 5,
          guidance: 'g',
        },
      },
      extra: 'kept?',
    },
    {
      reviewMode: 'sometimes',
      checkScope: 'nope',
      goals: 'x',
      writingChecks: { styleProfile: { analyzedCount: -3 } },
    },
    { writingChecks: { styleProfile: { analyzedCount: Infinity } } },
  ];
  all.push(
    ...(await each(
      'normalizeAdviserSettings',
      RAW.map((raw) => ({ raw })),
      (i) => normalizeAdviserSettings(i.raw),
    )),
  );
  const STATES = [
    null,
    {},
    DEFAULT_ADVISER_SETTINGS,
    { ...DEFAULT_ADVISER_SETTINGS, enabled: true },
    { enabled: false, checkReplyContext: true },
    { goals: { customText: '  ' } },
    { goals: { customText: 'stay kind' } },
    { goals: { presets: { limitTopic: { enabled: true } } } },
    { goals: { presets: { limitTopic: { enabled: false, topic: 'cats' } } } },
    { writingChecks: { styleProfile: { summary: 'casual' } } },
    { writingChecks: { styleProfile: { guidance: '  ' } } },
    { writingChecks: { grammar: true } },
    { enabled: true, extra: { keep: 1 } },
    {
      extra: 1,
      goals: { other: 2, presets: { mine: 3 } },
      writingChecks: { customText: '' },
    },
  ];
  all.push(
    ...(await each(
      'isPostingAdviserPristine',
      STATES.map((adviser) => ({ adviser })),
      (i) => isPostingAdviserPristine(i.adviser),
    )),
    ...(await each(
      'nextPostingAdviserState',
      STATES.map((adviser) => ({ adviser })),
      (i) => nextPostingAdviserState(i.adviser),
    )),
  );
  return all;
}
