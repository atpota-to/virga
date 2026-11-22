// Virga's Defense routes in the harness (harness/fakeDefense.js, as
// harness/fakeServer.js mounts them), recorded: lists made and refused (no
// name, no scope, writes off), people kept by hand, plans and approvals
// with every band and a veto at the write (the owner, someone followed,
// someone kept, a curation list's member), the list writer's batches, its
// hold when the grant lacks the list scope, undo, the history, and the
// moderator's link codes landing ten seconds on. _demoServer.js says how.
// Swift: VirgaDemo/Harness/FakeDefense.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/DemoServerParityTests.swift.

import { withDefense } from '../../../harness/harness.js';
import { LAB } from '../../../harness/world.js';
import { OAUTH_SCOPE } from '../../../src/config.js';
import {
  MINUTE,
  MIRA,
  get,
  post,
  postUri,
  scenarioCases,
} from './_demoServer.js';

export const sources = ['harness/fakeDefense.js', 'harness/fakeServer.js'];

const SCENARIOS = [
  {
    name: 'defense',
    search: '?defense=lists',
    steps: [
      { mint: MIRA },
      { mint: LAB.did },
      get('/api/defense/lists'),
      post('/api/defense/list-create', { name: '  ', purpose: 'block' }),
      post('/api/defense/list-create', { name: 'Pile-ons', purpose: 'report' }),
      post('/api/defense/list-create', null),
      post(
        '/api/defense/list-create',
        {
          name: `  Pile-ons \n\t from   the quote ${'x'.repeat(80)}`,
          purpose: 'block',
        },
        { as: 'list' },
      ),
      post(
        '/api/defense/list-create',
        { name: 'Muted', purpose: 'mute' },
        { token: 1, as: 'labList' },
      ),
      post('/api/defense/keep', {
        did: 'did:plc:virgaharnesscrowd00003',
        reason: 'an old friend',
      }),
      post('/api/defense/keep', {
        did: 'did:plc:virgaharnesscrowd00003',
        reason: '  still   a friend  ',
      }),
      post('/api/defense/keep', { did: 'did:plc:virgaharnesscrowd00009' }),
      post('/api/defense/keep', { did: 'did:PLC:x' }),
      post('/api/defense/keep', { did: ['did:plc:arrayed'] }),
      post('/api/defense/keep', null),
      post('/api/defense/unkeep', { did: 'did:plc:virgaharnesscrowd00009' }),
      post('/api/defense/unkeep', {}),
      post('/api/defense/plan', {
        listId: 'nope',
        rows: [{ did: 'did:plc:a', band: 'UNKNOWN' }],
      }),
      (ctx) =>
        post('/api/defense/plan', {
          listId: ctx.named.list.data.list.id,
          rows: [],
        }),
      (ctx) =>
        post('/api/defense/plan', {
          listId: ctx.named.list.data.list.id,
          rows: [{ did: 'did:plc:a', band: 'PROTECTED' }],
        }),
      (ctx) =>
        post('/api/defense/plan', {
          listId: ctx.named.list.data.list.id,
          rows: [null],
        }),
      (ctx) =>
        post('/api/defense/plan', {
          listId: ctx.named.labList.data.list.id,
          rows: [{ did: 'did:plc:a', band: 'UNKNOWN' }],
        }),
      (ctx) => {
        const followed = ctx.mira.follows[0].value.subject;
        const curated = (ctx.mira.ownLists || []).find(
          (l) =>
            l.purpose === 'app.bsky.graph.defs#curatelist' && l.members?.length,
        );
        return {
          ...post('/api/defense/plan', {
            listId: ctx.named.list.data.list.id,
            postUri: postUri(MIRA, ctx.mira.posts[0].rkey),
            totals: { UNKNOWN: 6 },
            rows: [
              {
                did: 'did:plc:virgaharnesscrowd00001',
                band: 'UNKNOWN',
                trust: 1,
              },
              {
                did: 'did:plc:virgaharnesscrowd00002',
                band: 'NOTABLE',
                trust: 0.4,
              },
              { did: followed, band: 'UNKNOWN', trust: 1 },
              { did: 'did:plc:virgaharnesscrowd00003', band: 'UNKNOWN' },
              { did: MIRA, band: 'UNKNOWN' },
              ...(curated
                ? [{ did: curated.members[0], band: 'PERIPHERAL' }]
                : []),
              {
                did: 'did:plc:virgaharnesscrowd00001',
                band: 'UNKNOWN',
                trust: null,
              },
              { did: ['did:plc:arrayed'], band: 'CONNECTED' },
            ],
          }),
          as: 'plan',
        };
      },
      (ctx) =>
        post('/api/defense/approve', {
          planId: ctx.named.plan.data.planId,
          bands: [],
        }),
      (ctx) =>
        post('/api/defense/approve', {
          planId: ctx.named.plan.data.planId,
          bands: ['PROTECTED'],
        }),
      post('/api/defense/approve', { planId: 'nope', bands: ['UNKNOWN'] }),
      (ctx) =>
        post('/api/defense/approve', {
          planId: ctx.named.plan.data.planId,
          bands: ['UNKNOWN', 'PERIPHERAL'],
          note: '  the quote   pile-on ',
        }),
      (ctx) =>
        post('/api/defense/approve', {
          planId: ctx.named.plan.data.planId,
          bands: ['UNKNOWN', 'NOTABLE', 'CONNECTED'],
        }),
      get('/api/defense/lists'),
      get('/api/defense/history'),
      { cron: true },
      get('/api/defense/lists'),
      get('/api/defense/history', { as: 'history' }),
      get('/api/defense/history?before=3'),
      get('/api/defense/history?before=x'),
      (ctx) =>
        post('/api/defense/undo', {
          planId: ctx.named.history.data.plans[0].id,
          note: 'sorry',
        }),
      (ctx) =>
        post('/api/defense/undo', {
          ids: [ctx.named.history.data.decisions.at(-1).id],
        }),
      post('/api/defense/undo', {}),
      { defense: true },
      get('/api/defense/history'),
      get('/api/defense/lists'),
      get('/api/defense/lists', { token: 1 }),
      // The moderator: a code lands ten seconds after it is made.
      get('/api/defense/link'),
      post('/api/defense/link-code', {}),
      get('/api/defense/link'),
      { advance: 11_000 },
      get('/api/defense/link'),
      (ctx) =>
        post('/api/defense/link-list', { listId: ctx.named.list.data.list.id }),
      (ctx) =>
        post('/api/defense/link-list', {
          listId: ctx.named.labList.data.list.id,
        }),
      post('/api/defense/link-list', {}),
      post('/api/defense/unlink', {}),
      get('/api/defense/link'),
      post('/api/defense/link-code', {}),
      { advance: 16 * MINUTE },
      get('/api/defense/link'),
      post('/api/defense/unlink', {}, { token: 1 }),
      get('/api/defense/link', { token: 1 }),
    ],
  },
  {
    name: 'defense-scope',
    search: '?defense=on',
    options: { seed: false, moderator: 'off' },
    steps: [
      { mint: MIRA },
      post('/api/defense/list-create', { name: 'X', purpose: 'block' }),
      get('/api/defense/link'),
      post('/api/defense/link-code', {}),
    ],
  },
  {
    name: 'defense-held',
    search: '?defense=lists',
    options: { seed: false, moderator: 'linked' },
    steps: [
      { mint: MIRA },
      get('/api/defense/link'),
      post(
        '/api/defense/list-create',
        { name: 'Held', purpose: 'mute' },
        { as: 'list' },
      ),
      (ctx) =>
        post(
          '/api/defense/plan',
          {
            listId: ctx.named.list.data.list.id,
            rows: [{ did: 'did:plc:virgaharnesscrowd00011', band: 'UNKNOWN' }],
          },
          { as: 'plan' },
        ),
      (ctx) =>
        post('/api/defense/approve', {
          planId: ctx.named.plan.data.planId,
          bands: ['UNKNOWN'],
        }),
      { setScope: { did: MIRA, scope: 'atproto' } },
      { advance: 1000 },
      { cron: true },
      get('/api/defense/lists'),
      { setScope: { did: MIRA, scope: withDefense(OAUTH_SCOPE, 'lists') } },
      { advance: 61_000 },
      { cron: true },
      get('/api/defense/lists'),
    ],
  },
  {
    name: 'defense-off',
    options: { seed: false, defenseWrites: false },
    search: '?defense=lists',
    steps: [
      { mint: MIRA },
      get('/api/defense/lists'),
      post('/api/defense/list-create', { name: 'X', purpose: 'block' }),
      post('/api/defense/approve', { planId: 'x', bands: ['UNKNOWN'] }),
      post('/api/defense/undo', { ids: [1] }),
      { cron: true },
    ],
  },
];

export default async function cases() {
  return scenarioCases(SCENARIOS);
}
