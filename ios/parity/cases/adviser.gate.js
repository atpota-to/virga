// src/posting/adviser/{gate,gateController,useAdviserRead}.js: the read's
// bounds and choices, whether the adviser can be asked, the sheet's usage
// line, and whole checks played against the web's own controller with its
// side effects stood in (the server's answer, the conversation, the
// allowance, a clock that never moves and a hold that ends at once): what
// the composer is told to do, the busy state, the sheet as it opens, what
// was sent and what was read. Swift: VirgaPosting/Adviser/{Gate,
// GateController,UseAdviserRead}.swift.
//
// Scenarios from gateController.test.js, plus results that aren't there,
// failures without words, quotes and scheduled posts.

import {
  ADVISER_CHOICES,
  ADVISER_CHOICE_LABELS,
  ADVISER_CONTEXT_TIMEOUT_MS,
  ADVISER_GATE_TIMEOUT_MS,
  ADVISER_TIMEOUT_MESSAGE,
  adviserReadChoices,
  withinMs,
} from '../../../src/posting/adviser/gate.js';
import {
  ADVISER_DECISIONS,
  INITIAL_ADVISER_VIEW,
  SHEET_STATUSES,
  adviserGateEnabled,
  adviserUsageLineFor,
  createAdviserGateController,
} from '../../../src/posting/adviser/gateController.js';
import {
  DEFAULT_ADVISER_SETTINGS,
  nextPostingAdviserState,
} from '../../../src/posting/adviser/setup.js';
import { each, value } from './_helpers.js';

export const sources = [
  'src/posting/adviser/gate.js',
  'src/posting/adviser/gateController.js',
  'src/posting/adviser/useAdviserRead.js',
];

const ME = 'did:plc:me';
const OTHER = 'did:plc:other';
const NOW = Date.parse('2026-11-12T12:00:00Z');
const postUri = (did, rkey = 'r1') => `at://${did}/app.bsky.feed.post/${rkey}`;

const seeded = nextPostingAdviserState(DEFAULT_ADVISER_SETTINGS);
const withSetup = (patch) => ({ ...seeded, ...patch });

const state = (posts = ['a draft'], patch = {}) => ({
  asDid: ME,
  posts: posts.map((text, i) => ({ id: `p${i}`, text })),
  ...patch,
});

const OK = {
  sentiment: { label: 'neutral', score: 0 },
  checks: [
    { id: 'reduceNegativity', label: 'Reduce negativity', status: 'ok' },
  ],
  overallStatus: 'ok',
  writing: { issues: [] },
};
const CONFLICT = {
  ...OK,
  checks: [
    {
      id: 'limitTopic',
      label: 'Limit topics',
      status: 'conflict',
      excerpt: null,
    },
  ],
  overallStatus: 'conflict',
};
const typo = (found, replacement) => ({
  ...OK,
  writing: { issues: [{ type: 'typo', found, replacement, note: 'twice' }] },
});
const CONTEXT = {
  kind: 'reply',
  thread: [{ author: 'Sam', text: 'the post' }],
  target: { author: 'Sam', text: 'the post' },
};
const REPLY = {
  uri: postUri(OTHER),
  cid: 'c',
  root: { uri: postUri(OTHER), cid: 'c' },
  author: { did: OTHER, handle: 'sam.test' },
  text: 'the post',
};

/**
 * One check: the controller configured with `settings`, a requester (or
 * none) and AI access; `answer` is the server's (`{ result }` or `{ error:
 * { message, code, status } }`), `context` the conversation the stand-in
 * reads, `atLimit` and `usage` the allowance as this browser knows it.
 * Played to the sheet (if one opens), then `decide` is the writer's answer.
 */
async function play({
  settings = seeded,
  requester = true,
  canUseAi = true,
  did = ME,
  check: input,
  mode,
  answer = { result: OK },
  context = CONTEXT,
  atLimit = false,
  usage = null,
  decide,
}) {
  const views = [];
  const payloads = [];
  const gathers = [];
  let sheetSeen;
  const sheetOpened = new Promise((resolve) => {
    sheetSeen = resolve;
  });
  const ctl = createAdviserGateController({
    analyzePost: async (_req, payload) => {
      payloads.push(payload);
      if (answer.error)
        throw Object.assign(
          new Error(answer.error.message ?? ''),
          answer.error,
        );
      return answer.result;
    },
    gatherReplyContext: async (_s, kind) => {
      gathers.push(kind);
      return context ? { ...context, kind } : null;
    },
    atLimit: () => atLimit,
    readUsage: () => usage,
    sleep: () => Promise.resolve(),
    now: () => 0,
    onChange: (view) => {
      views.push(view);
      if (view.sheet) sheetSeen(view.sheet);
    },
  });
  ctl.configure({
    did,
    settings,
    requester: requester ? { did, request: () => {} } : null,
    canUseAi,
  });
  const done = ctl.check(input, mode ? { mode } : undefined);
  const first = await Promise.race([
    done.then((decision) => ({ decision })),
    sheetOpened.then((sheet) => ({ sheet })),
  ]);
  let decision = first.decision;
  const sheet = first.sheet ?? null;
  if (sheet) {
    ctl.decide(decide);
    decision = await done;
  }
  return {
    decision,
    sheet,
    busy: views.find((v) => v.busy)?.busy ?? null,
    payloads,
    gathers,
    usageVersion: ctl.getView().usageVersion,
    after: { busy: ctl.getView().busy, sheet: ctl.getView().sheet },
    enabled: ctl.isEnabled(),
  };
}

const SCENARIOS = [
  {
    $id: 'gate/adviser-off',
    settings: DEFAULT_ADVISER_SETTINGS,
    check: state(),
  },
  {
    $id: 'gate/browser-account',
    requester: false,
    canUseAi: false,
    check: state(),
  },
  { $id: 'gate/no-ai', canUseAi: false, check: state() },
  {
    $id: 'gate/check-before-posting-off',
    settings: withSetup({ checkBeforePublish: false }),
    check: state(),
  },
  {
    $id: 'gate/scope-leaves-it-out',
    settings: withSetup({ checkScope: 'replies' }),
    check: state(),
  },
  { $id: 'gate/used-up', atLimit: true, check: state() },
  { $id: 'gate/empty-post', check: state(['  ']) },
  { $id: 'gate/nothing-significant', check: state(['hello there']) },
  {
    $id: 'gate/a-caution-goes-through',
    answer: {
      result: {
        ...OK,
        overallStatus: 'caution',
        checks: [{ id: 'x', label: 'X', status: 'caution' }],
      },
    },
    check: state(),
  },
  {
    $id: 'gate/conflict-publish-anyway',
    answer: { result: CONFLICT },
    check: state(['about politics']),
    decide: 'publish',
  },
  {
    $id: 'gate/typo-save-as-draft',
    answer: { result: typo('the the', 'the') },
    check: state(['see the the thing']),
    decide: 'draft',
  },
  {
    $id: 'gate/always-keep-editing',
    settings: withSetup({ reviewMode: 'always' }),
    check: state(),
    decide: 'edit',
  },
  {
    $id: 'gate/closing-is-keep-editing',
    answer: { result: CONFLICT },
    check: state(),
    decide: 'anything else',
  },
  {
    $id: 'gate/fails-open',
    answer: { error: { message: 'down', status: 503 } },
    check: state(),
  },
  { $id: 'gate/no-result', answer: { result: null }, check: state() },
  {
    $id: 'gate/monthly-limit-fails-open',
    answer: {
      error: { message: 'used up', code: 'monthly_limit', status: 429 },
    },
    check: state(),
  },
  {
    $id: 'gate/mode-anything-but-manual',
    mode: 'other',
    answer: { result: CONFLICT },
    check: state(),
    decide: 'publish',
  },
  {
    $id: 'gate/a-scheduled-post-can-still-publish',
    answer: { result: CONFLICT },
    check: state(['x'], { schedule: { mode: 'queue' } }),
    decide: 'publish',
  },
  {
    $id: 'manual/cannot-be-asked',
    mode: 'manual',
    requester: false,
    check: state(),
  },
  {
    $id: 'manual/needs-text',
    mode: 'manual',
    check: state(['']),
    decide: 'edit',
  },
  {
    $id: 'manual/needs-text-thread',
    mode: 'manual',
    check: state(['  ', '\n']),
    decide: 'publish',
  },
  {
    $id: 'manual/nothing-set-up',
    mode: 'manual',
    settings: { ...DEFAULT_ADVISER_SETTINGS, enabled: true },
    check: state(),
    decide: 'edit',
  },
  {
    $id: 'manual/asks-at-the-limit',
    mode: 'manual',
    atLimit: true,
    check: state(['fine']),
    decide: 'edit',
  },
  {
    $id: 'manual/the-limit-sheet',
    mode: 'manual',
    atLimit: true,
    answer: {
      error: { message: 'used up', code: 'monthly_limit', status: 429 },
    },
    check: state(),
    decide: 'edit',
  },
  {
    $id: 'manual/ignores-the-scope',
    mode: 'manual',
    settings: withSetup({ checkBeforePublish: false, checkScope: 'replies' }),
    check: state(['fine']),
    decide: 'publish',
  },
  {
    $id: 'manual/another-failure',
    mode: 'manual',
    answer: {
      error: { message: 'AI help isn’t available right now.', status: 503 },
    },
    check: state(),
    decide: 'edit',
  },
  {
    $id: 'manual/a-failure-without-words',
    mode: 'manual',
    answer: { error: { message: '', code: 'odd' } },
    check: state(),
    decide: 'draft',
  },
  {
    $id: 'manual/scheduled',
    mode: 'manual',
    check: state(['x'], { schedule: { mode: 'queue' } }),
    decide: 'edit',
  },
  {
    $id: 'manual/no-result',
    mode: 'manual',
    answer: { result: null },
    check: state(),
    decide: 'edit',
  },
  {
    $id: 'manual/usage-line',
    mode: 'manual',
    usage: { month: '2026-11', used: 12, limit: 30 },
    check: state(),
    decide: 'edit',
  },
  {
    $id: 'room/a-reply-to-someone-else',
    settings: withSetup({ reviewMode: 'always' }),
    check: state(['i disagree'], { reply: REPLY }),
    decide: 'edit',
  },
  {
    $id: 'room/off',
    settings: withSetup({ checkReplyContext: false }),
    check: state(['ok'], {
      reply: {
        uri: postUri(OTHER),
        cid: 'c',
        root: { uri: postUri(OTHER), cid: 'c' },
      },
    }),
  },
  {
    $id: 'room/a-quote',
    mode: 'manual',
    check: {
      asDid: ME,
      posts: [
        {
          id: 'p0',
          text: 'quoting',
          record: { kind: 'post', uri: postUri(OTHER), cid: 'c' },
        },
      ],
    },
    decide: 'edit',
  },
  {
    $id: 'room/nothing-read',
    mode: 'manual',
    context: null,
    check: state(['mine'], {
      reply: {
        uri: postUri(ME),
        cid: 'c',
        root: { uri: postUri(ME), cid: 'c' },
      },
    }),
    decide: 'edit',
  },
  {
    $id: 'other-account/asDid-wins',
    did: OTHER,
    settings: withSetup({ reviewMode: 'always' }),
    check: state(['x'], {
      reply: {
        uri: postUri(OTHER),
        cid: 'c',
        root: { uri: postUri(OTHER), cid: 'c' },
      },
    }),
    decide: 'edit',
  },
  {
    $id: 'other-account/no-asDid',
    did: OTHER,
    settings: withSetup({ reviewMode: 'always' }),
    check: {
      posts: [{ id: 'p0', text: 'x' }],
      reply: { uri: postUri(OTHER), cid: 'c' },
    },
    decide: 'edit',
  },
  {
    $id: 'thread/fixes',
    settings: withSetup({ reviewMode: 'always' }),
    answer: {
      result: {
        ...OK,
        writing: {
          issues: [
            { type: 'typo', found: 'the the', replacement: 'the', note: '' },
            { type: 'grammar', found: ' i ', replacement: ' I ', note: '' },
          ],
        },
      },
    },
    check: state(['first post', 'see the the thing', 'and i think so']),
    decide: 'publish',
  },
];

const ENABLED = [
  { settings: seeded, requester: true, canUseAi: true },
  { settings: DEFAULT_ADVISER_SETTINGS, requester: true, canUseAi: true },
  { settings: seeded, requester: false, canUseAi: true },
  { settings: seeded, requester: true, canUseAi: false },
  { settings: { enabled: 'yes' }, requester: true, canUseAi: true },
  { settings: null, requester: true, canUseAi: true },
  {},
];

export default async function cases() {
  const all = [
    value('gateConstants', {
      ADVISER_GATE_TIMEOUT_MS,
      ADVISER_CONTEXT_TIMEOUT_MS,
      ADVISER_CHOICES,
      ADVISER_CHOICE_LABELS,
      ADVISER_TIMEOUT_MESSAGE,
      gateChoices: adviserReadChoices(true),
      buttonChoices: adviserReadChoices(false),
      ADVISER_DECISIONS,
      SHEET_STATUSES,
      INITIAL_ADVISER_VIEW,
    }),
  ];
  all.push(
    ...(await each(
      'withinMs',
      [{ ms: 1 }, { ms: 2.5 }, { ms: 0 }],
      async ({ ms }) => {
        const err = await withinMs(new Promise(() => {}), ms).catch((e) => e);
        return { name: err?.name, message: err?.message };
      },
    )),
  );
  all.push(
    ...(await each(
      'adviserGateEnabled',
      ENABLED,
      ({ settings, requester, canUseAi }) =>
        adviserGateEnabled({
          settings,
          requester: requester ? { did: ME } : null,
          canUseAi,
        }),
    )),
  );
  all.push(
    ...(await each(
      'adviserUsageLineFor',
      [
        { did: ME, usage: { month: '2026-11', used: 12, limit: 30 } },
        { did: ME, usage: { month: '2026-11', used: 30, limit: 30 } },
        { did: ME, usage: null },
        { did: null, usage: { month: '2026-11', used: 1, limit: 30 } },
        { did: '', usage: { month: '2026-11', used: 1, limit: 30 } },
      ],
      ({ did, usage }) =>
        adviserUsageLineFor(did, {
          readUsage: () => usage,
          now: new Date(NOW),
        }),
    )),
  );
  // Every scenario with its defaults spelled out, so the Swift side reads
  // them from the case.
  const full = (scenario) => ({
    settings: seeded,
    requester: true,
    canUseAi: true,
    did: ME,
    answer: { result: OK },
    context: CONTEXT,
    atLimit: false,
    usage: null,
    ...scenario,
  });
  all.push(
    ...(await each('check', SCENARIOS.map(full), (scenario) => play(scenario))),
  );
  return all;
}
