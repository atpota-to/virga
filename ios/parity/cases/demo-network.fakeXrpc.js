// The signed-in agent (harness/fakeXrpc.js): the scope each call needs, the
// service tokens it mints and the video service reads back, and an agent's
// answers to scenarios of calls on fresh worlds (reads, writes and every
// refusal word for word, the scopes a session was granted, the AppView's
// known-follower counts). Draft ids, which the agent mints from the clock,
// are recorded as `$minted#<n>`. Swift: VirgaDemo/Harness/FakeXrpc.swift;
// tests in ios/VirgaKit/Tests/VirgaDemoTests/FakeXrpcParityTests.swift.

import {
  DRAFT_LIMIT,
  createFakeAgent,
  mintServiceToken,
  readServiceToken,
  scopesFor,
} from '../../../harness/fakeXrpc.js';
import { LAB, ME } from '../../../harness/world.js';
import { each, value } from './_helpers.js';
import { NOW, atTime } from './_demoWorld.js';
import { outcome, worldsFor } from './_demoNetwork.js';

export const sources = ['harness/fakeXrpc.js'];

const NSIDS = [
  'com.atproto.repo.createRecord',
  'com.atproto.repo.putRecord',
  'com.atproto.repo.deleteRecord',
  'com.atproto.repo.applyWrites',
  'com.atproto.repo.getRecord',
  'com.atproto.repo.listRecords',
  'com.atproto.repo.describeRepo',
  'com.atproto.repo.uploadBlob',
  'com.atproto.server.getServiceAuth',
  'app.bsky.graph.getFollowers',
  'app.bsky.draft.getDrafts',
  'chat.bsky.convo.getLog',
  '',
];

const INPUTS = [
  { $id: 'undefined' },
  { $id: 'null', input: null },
  { $id: 'empty', input: {} },
  { $id: 'post', input: { collection: 'app.bsky.feed.post' } },
  { $id: 'number', input: { collection: 5 } },
  { $id: 'null-collection', input: { collection: null } },
  { $id: 'object', input: { collection: { a: 1 } } },
  { $id: 'list', input: { collection: ['a', null, ['b', 'c']] } },
  { $id: 'string', input: 'a string' },
  { $id: 'array', input: [1, 2] },
  { $id: 'no-writes', input: { writes: [] } },
  {
    $id: 'writes',
    input: {
      writes: [
        {
          $type: 'com.atproto.repo.applyWrites#create',
          collection: 'app.bsky.feed.post',
        },
        {
          $type: 'com.atproto.repo.applyWrites#delete',
          collection: 'app.bsky.feed.like',
        },
        { $type: '#update' },
        { $type: 'x#y#z', collection: 'c' },
        { $type: 5, collection: 'n' },
        {},
        5,
        'str',
        [],
      ],
    },
  },
  { $id: 'writes-string', input: { writes: 'abc' } },
  { $id: 'writes-object', input: { writes: { a: 1 } } },
  { $id: 'writes-null-entry', input: { writes: [null] } },
  { $id: 'writes-zero', input: { writes: 0 } },
  { $id: 'lxm', input: { lxm: 'app.bsky.video.getUploadLimits' } },
  { $id: 'lxm-empty', input: { lxm: '' } },
  { $id: 'lxm-number', input: { lxm: 7 } },
];

const OPTS = [
  { $id: 'none' },
  { $id: 'empty', opts: {} },
  { $id: 'png', opts: { encoding: 'image/png' } },
  { $id: 'blank', opts: { encoding: '' } },
  { $id: 'number', opts: { encoding: 5 } },
  { $id: 'headers', opts: { headers: { 'content-type': 'image/jpeg' } } },
];

const scopeCases = () => {
  const out = [];
  for (const nsid of NSIDS)
    for (const { $id, ...rest } of INPUTS)
      out.push({ $id: `${nsid || 'blank'}/${$id}`, nsid, ...rest });
  for (const { $id, ...rest } of OPTS)
    out.push({
      $id: `upload/${$id}`,
      nsid: 'com.atproto.repo.uploadBlob',
      ...rest,
    });
  return out;
};

const TOKENS = [
  {
    iss: ME.did,
    aud: 'did:web:video.bsky.app',
    lxm: 'app.bsky.video.getUploadLimits',
    exp: 1794700060,
  },
  {
    iss: ME.did,
    aud: 'did:web:pds.harness.example',
    lxm: 'com.atproto.repo.uploadBlob',
    exp: 1794703600,
  },
  { iss: LAB.did, aud: 'did:web:x', exp: 1794700060.5 },
  { iss: ME.did, aud: 'did:web:x', lxm: '', exp: 0 },
  { iss: ME.did, aud: 'did:web:x', lxm: null, exp: -1 },
  { aud: 'did:web:x', exp: 1 },
  { iss: 'did:plc:café', aud: 'did:web:x', lxm: 'a.b.c', exp: 2 },
  { iss: 'did:plc:\u{1F600}', aud: 'did:web:x', exp: 3 },
  { iss: ME.did, aud: 5, lxm: true, exp: 'soon' },
  {},
];

const minted = (claims) => mintServiceToken(claims);
const b64 = (text) => btoa(text);

const READS = [
  minted(TOKENS[0]),
  `Bearer ${minted(TOKENS[0])}`,
  `bearer\t\t${minted(TOKENS[1])}`,
  `BEARER  ${minted(TOKENS[2])}`,
  `Bearer${minted(TOKENS[0])}`,
  `Bearer \u00a0${minted(TOKENS[0])}`,
  ` Bearer ${minted(TOKENS[0])}`,
  minted(TOKENS[6]),
  minted(TOKENS[9]),
  `${minted(TOKENS[0])}\n`,
  `${minted(TOKENS[0])}x`,
  'harness..unsigned',
  'harness.a.b.unsigned',
  'harness.!!!!.unsigned',
  `harness.${b64('not json')}.unsigned`,
  `harness.${b64('5')}.unsigned`,
  `harness.${b64('null')}.unsigned`,
  `harness.${b64('"text"')}.unsigned`,
  `harness.${b64('{"a":1}').replace(/=+$/, '')}.unsigned`,
  `harness.${b64('{"ab":1}').slice(0, 4)} ${b64('{"ab":1}').slice(4)}.unsigned`,
  `harness.${b64('{"a":1}')}=.unsigned`,
  `harness.${b64('{"a":"ÿ"}')}.unsigned`,
  `harness.e.unsigned`,
  'HARNESS.e30=.unsigned',
  'harness.e30=.UNSIGNED',
  '',
  null,
  undefined,
];

/**
 * One step of an agent scenario. `swapFrom` names an earlier step whose
 * answer's CID is this one's `swapRecord`; `draftId` the n-th draft id the
 * agent minted, put in the input at `draft.id` (`idAt: 'draft'`) or `id`.
 */
async function step(agent, minted, s, earlier) {
  const target = s.proxy
    ? agent.withProxy('bsky_appview', 'did:web:api.bsky.app')
    : agent;
  let input = s.bytes ? Uint8Array.from(s.bytes) : s.input;
  if (s.swapFrom !== undefined)
    input = { ...input, swapRecord: earlier[s.swapFrom].result.data.cid };
  if (s.draftId !== undefined)
    input =
      s.idAt === 'draft'
        ? { ...input, draft: { ...input.draft, id: minted[s.draftId] } }
        : { ...input, id: minted[s.draftId] };
  return outcome(
    () => target.handle(s.nsid, input, s.opts),
    (answer) => {
      const id = answer?.data?.id;
      if (s.nsid === 'app.bsky.draft.createDraft' && typeof id === 'string')
        minted.push(id);
      return scrub(answer, minted);
    },
  );
}

/** Ids the agent minted, as `$minted#<n>`. */
function scrub(value, minted) {
  if (typeof value === 'string') {
    const i = minted.indexOf(value);
    return i === -1 ? value : `$minted#${i}`;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, minted));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, minted);
    return out;
  }
  return value;
}

const post = (text, at = NOW) => ({
  $type: 'app.bsky.feed.post',
  text,
  createdAt: new Date(at).toISOString(),
});
const template = {
  $type: 'net.anisota.feed.template',
  name: 'x',
  text: 'y',
  createdAt: new Date(NOW).toISOString(),
};
const repo = 'com.atproto.repo';
const draftPost = { posts: [{ text: 'A draft' }] };

const SCENARIOS = [
  {
    name: 'reads',
    steps: [
      {
        nsid: 'app.bsky.graph.getFollowers',
        input: { actor: ME.did, limit: 3 },
      },
      { nsid: 'app.bsky.graph.getFollowers', input: { limit: 3, cursor: '3' } },
      { nsid: 'app.bsky.graph.getFollowers', input: { limit: 100 } },
      {
        nsid: 'app.bsky.graph.getFollowers',
        input: { limit: 4, cursor: '100' },
      },
      { nsid: 'app.bsky.notification.listNotifications', input: { limit: 5 } },
      {
        nsid: 'app.bsky.notification.listNotifications',
        input: { limit: 2, cursor: '3400' },
      },
      {
        nsid: `${repo}.listRecords`,
        input: { repo: ME.did, collection: 'app.bsky.feed.post', limit: 2 },
      },
      {
        nsid: `${repo}.listRecords`,
        input: { collection: 'app.bsky.graph.follow', limit: 2, reverse: true },
      },
      {
        nsid: `${repo}.listRecords`,
        input: { repo: LAB.handle, collection: 'app.bsky.feed.post', limit: 2 },
      },
      {
        nsid: `${repo}.listRecords`,
        input: { repo: 'nobody.example', collection: 'app.bsky.feed.post' },
      },
      {
        nsid: `${repo}.listRecords`,
        input: { collection: 'net.anisota.feed.template' },
      },
      {
        nsid: `${repo}.listRecords`,
        input: { collection: 'app.bsky.actor.profile' },
      },
      { nsid: `${repo}.listRecords`, input: { collection: 'toString' } },
      {
        nsid: `${repo}.getRecord`,
        input: {
          repo: ME.did,
          collection: 'app.bsky.actor.profile',
          rkey: 'self',
        },
      },
      {
        nsid: `${repo}.getRecord`,
        input: {
          repo: ME.did,
          collection: 'app.bsky.feed.post',
          rkey: 'nothere',
        },
      },
      {
        nsid: `${repo}.getRecord`,
        input: {
          repo: LAB.did,
          collection: 'app.bsky.actor.profile',
          rkey: 'self',
        },
      },
      { nsid: `${repo}.getRecord`, input: {} },
      { nsid: `${repo}.describeRepo`, input: { repo: ME.did } },
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: {
          actors: [
            ME.did,
            LAB.handle,
            '@lab.example.com',
            'ana.example.com',
            'did:plc:nobodyatall',
            'nobody.example',
          ],
        },
      },
      { nsid: 'app.bsky.actor.getProfiles', input: { actors: LAB.did } },
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: {
          actors: Array.from({ length: 26 }, (_, i) => `did:plc:x${i}`),
        },
      },
      { nsid: 'app.bsky.actor.getProfiles', input: {} },
      { nsid: 'app.bsky.actor.getPreferences' },
      { nsid: 'app.bsky.feed.searchPosts', input: { q: 'garden', limit: 3 } },
      {
        nsid: 'app.bsky.feed.searchPosts',
        input: { q: 'garden', author: ME.handle, limit: 2, cursor: '1' },
      },
      {
        nsid: 'app.bsky.feed.searchPosts',
        input: { q: 'garden', author: 'nobody.example' },
      },
      { nsid: 'app.bsky.feed.searchPosts', input: { limit: 3 } },
      { nsid: 'app.bsky.bookmark.getBookmarks', input: {} },
      {
        nsid: 'app.bsky.bookmark.getBookmarks',
        input: { limit: 2 },
        proxy: true,
      },
      { nsid: 'app.bsky.draft.getDrafts', input: {}, proxy: true },
      {
        nsid: 'app.bsky.draft.getDrafts',
        input: { limit: 1, cursor: 1 },
        proxy: true,
      },
      { nsid: 'com.atproto.server.getServiceAuth', input: {} },
      {
        nsid: 'com.atproto.server.getServiceAuth',
        input: {
          aud: 'did:web:video.bsky.app',
          lxm: 'app.bsky.video.getUploadLimits',
          exp: Math.floor(NOW / 1000) + 1800,
        },
      },
      {
        nsid: 'com.atproto.server.getServiceAuth',
        input: {
          aud: 'did:web:x',
          lxm: 'app.bsky.video.getJobStatus',
          exp: Math.floor(NOW / 1000) + 9000,
        },
      },
      {
        nsid: 'com.atproto.server.getServiceAuth',
        input: { aud: 'did:web:x', exp: Math.floor(NOW / 1000) + 61 },
      },
      {
        nsid: 'com.atproto.server.getServiceAuth',
        input: { aud: 'did:web:x', exp: Math.floor(NOW / 1000) },
      },
      {
        nsid: 'com.atproto.server.getServiceAuth',
        input: { aud: 'did:web:x', exp: 'soon' },
      },
      {
        nsid: 'com.atproto.server.getServiceAuth',
        input: { aud: 'did:web:x' },
      },
      { nsid: 'app.bsky.unspecced.getSomething', input: {} },
      { nsid: `${repo}.uploadBlob`, bytes: [1, 2, 3, 4], opts: {} },
      {
        nsid: `${repo}.uploadBlob`,
        bytes: [1, 2, 3, 4],
        opts: { encoding: 'application/octet-stream' },
      },
      {
        nsid: `${repo}.uploadBlob`,
        bytes: [1, 2, 3, 4],
        opts: { encoding: 'image/png' },
      },
      {
        nsid: `${repo}.uploadBlob`,
        input: 'some text',
        opts: { encoding: 'text/plain' },
      },
      {
        nsid: `${repo}.uploadBlob`,
        input: { a: 1 },
        opts: { encoding: 'image/png' },
      },
      { nsid: `${repo}.uploadBlob`, opts: { encoding: 'image/png' } },
    ],
  },
  {
    name: 'writes',
    steps: [
      {
        nsid: `${repo}.createRecord`,
        input: {
          repo: ME.did,
          collection: 'net.anisota.feed.template',
          rkey: 'abc',
          record: template,
        },
      },
      {
        nsid: `${repo}.createRecord`,
        input: {
          repo: ME.did,
          collection: 'net.anisota.feed.template',
          rkey: 'abc',
          record: template,
        },
      },
      {
        nsid: `${repo}.putRecord`,
        input: {
          repo: ME.did,
          collection: 'net.anisota.feed.template',
          rkey: 'abc',
          record: template,
          swapRecord: 'bafywrong',
        },
      },
      {
        nsid: `${repo}.putRecord`,
        input: {
          repo: ME.did,
          collection: 'net.anisota.feed.template',
          rkey: 'abc',
          record: template,
          swapRecord: null,
        },
      },
      {
        nsid: `${repo}.putRecord`,
        input: {
          repo: ME.handle,
          collection: 'net.anisota.feed.template',
          rkey: 'abc',
          record: { ...template, text: 'z' },
        },
        swapFrom: 0,
      },
      {
        nsid: `${repo}.getRecord`,
        input: {
          repo: ME.did,
          collection: 'net.anisota.feed.template',
          rkey: 'abc',
        },
      },
      {
        nsid: `${repo}.createRecord`,
        input: {
          repo: LAB.did,
          collection: 'net.anisota.feed.template',
          record: template,
        },
      },
      {
        nsid: `${repo}.createRecord`,
        input: {
          repo: 5,
          collection: 'net.anisota.feed.template',
          record: template,
        },
      },
      {
        nsid: `${repo}.createRecord`,
        input: {
          collection: 'app.bsky.feed.post',
          rkey: '3mharnesspost1',
          record: post('Hello from the harness'),
        },
      },
      {
        nsid: `${repo}.createRecord`,
        input: {
          collection: 'app.bsky.feed.post',
          rkey: '3mharnesspost2',
          record: { text: 'No type' },
        },
      },
      {
        nsid: `${repo}.createRecord`,
        input: { collection: 'app.bsky.feed.post', rkey: '3mharnesspost3' },
      },
      { nsid: `${repo}.createRecord`, input: { rkey: 'x', record: template } },
      {
        nsid: `${repo}.listRecords`,
        input: { collection: 'app.bsky.feed.post', limit: 2 },
      },
      {
        nsid: `${repo}.deleteRecord`,
        input: {
          repo: ME.did,
          collection: 'app.bsky.feed.post',
          rkey: '3mharnesspost2',
          swapRecord: 'bafywrong',
        },
      },
      {
        nsid: `${repo}.deleteRecord`,
        input: {
          repo: ME.did,
          collection: 'app.bsky.feed.post',
          rkey: '3mharnesspost2',
        },
      },
      {
        nsid: `${repo}.getRecord`,
        input: {
          repo: ME.did,
          collection: 'app.bsky.feed.post',
          rkey: '3mharnesspost2',
        },
      },
      {
        nsid: `${repo}.deleteRecord`,
        input: {
          repo: ME.did,
          collection: 'app.bsky.feed.post',
          rkey: 'neverthere',
        },
      },
      {
        nsid: `${repo}.applyWrites`,
        input: {
          repo: ME.did,
          writes: [
            {
              $type: `${repo}.applyWrites#create`,
              collection: 'app.bsky.feed.post',
              rkey: '3mharnessaw001',
              value: post('One'),
            },
            {
              $type: `${repo}.applyWrites#create`,
              collection: 'app.bsky.feed.threadgate',
              rkey: '3mharnessaw001',
              value: {
                post: `at://${ME.did}/app.bsky.feed.post/3mharnessaw001`,
                allow: [],
              },
            },
            {
              $type: `${repo}.applyWrites#update`,
              collection: 'net.anisota.feed.template',
              rkey: 'abc',
              value: template,
            },
            {
              $type: `${repo}.applyWrites#delete`,
              collection: 'app.bsky.feed.post',
              rkey: '3mharnesspost1',
            },
          ],
        },
      },
      { nsid: `${repo}.applyWrites`, input: { writes: [] } },
      { nsid: `${repo}.applyWrites`, input: { writes: 'abc' } },
      {
        nsid: `${repo}.applyWrites`,
        input: {
          writes: Array.from({ length: 201 }, (_, i) => ({
            $type: `${repo}.applyWrites#delete`,
            collection: 'x',
            rkey: `k${i}`,
          })),
        },
      },
      {
        nsid: `${repo}.applyWrites`,
        input: {
          writes: [
            {
              $type: `${repo}.applyWrites#replace`,
              collection: 'x',
              rkey: 'a',
            },
          ],
        },
      },
      {
        nsid: `${repo}.applyWrites`,
        input: {
          writes: [
            {
              $type: `${repo}.applyWrites#create`,
              collection: 'x',
              rkey: 'a',
              value: {},
            },
            { $type: `${repo}.applyWrites#delete`, collection: 'x', rkey: 'a' },
          ],
        },
      },
      {
        nsid: `${repo}.applyWrites`,
        input: {
          writes: [
            {
              $type: `${repo}.applyWrites#create`,
              collection: 'app.bsky.feed.post',
              rkey: '3mharnessaw001',
              value: post('Again'),
            },
          ],
        },
      },
      {
        nsid: `${repo}.applyWrites`,
        input: {
          writes: [
            {
              $type: `${repo}.applyWrites#create`,
              collection: 'x',
              rkey: 'b',
              value: { a: 1 },
            },
            { $type: `${repo}.applyWrites#create`, collection: 'x', rkey: 'c' },
          ],
        },
      },
      { nsid: `${repo}.listRecords`, input: { collection: 'x' } },
      { nsid: `${repo}.describeRepo`, input: {} },
      {
        nsid: 'app.bsky.actor.putPreferences',
        input: {
          preferences: [
            { $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [] },
          ],
        },
      },
      { nsid: 'app.bsky.actor.getPreferences' },
      { nsid: 'app.bsky.actor.putPreferences', input: { preferences: 'nope' } },
      { nsid: 'app.bsky.actor.getPreferences' },
      {
        nsid: 'app.bsky.bookmark.createBookmark',
        input: { uri: `at://${ME.did}/app.bsky.feed.post/3mharnessaw001` },
        proxy: true,
      },
      {
        nsid: 'app.bsky.bookmark.createBookmark',
        input: { uri: `at://${ME.did}/app.bsky.feed.post/3mharnessaw001` },
        proxy: true,
      },
      {
        nsid: 'app.bsky.bookmark.getBookmarks',
        input: { limit: 2 },
        proxy: true,
      },
      {
        nsid: 'app.bsky.bookmark.deleteBookmark',
        input: { uri: `at://${ME.did}/app.bsky.feed.post/3mharnessaw001` },
        proxy: true,
      },
      {
        nsid: 'app.bsky.bookmark.getBookmarks',
        input: { limit: 1 },
        proxy: true,
      },
      {
        nsid: 'app.bsky.draft.createDraft',
        input: { draft: draftPost },
        proxy: true,
      },
      {
        nsid: 'app.bsky.draft.createDraft',
        input: { draft: { posts: [] } },
        proxy: true,
      },
      { nsid: 'app.bsky.draft.createDraft', input: {}, proxy: true },
      { nsid: 'app.bsky.draft.getDrafts', input: { limit: 2 }, proxy: true },
      {
        nsid: 'app.bsky.draft.updateDraft',
        input: { draft: { id: 'nothere', draft: draftPost } },
        proxy: true,
      },
      {
        nsid: 'app.bsky.draft.deleteDraft',
        input: { id: 'nothere' },
        proxy: true,
      },
    ],
  },
  {
    name: 'read-only',
    search: '?scope=read',
    steps: [
      {
        nsid: `${repo}.createRecord`,
        input: {
          repo: ME.did,
          collection: 'app.bsky.feed.post',
          rkey: 'abc',
          record: post('nope'),
        },
      },
      {
        nsid: `${repo}.createRecord`,
        input: {
          repo: ME.did,
          collection: 'app.bsky.graph.follow',
          rkey: 'abc',
          record: { subject: LAB.did, createdAt: new Date(NOW).toISOString() },
        },
      },
      {
        nsid: `${repo}.applyWrites`,
        input: {
          writes: [
            {
              $type: `${repo}.applyWrites#delete`,
              collection: 'app.bsky.graph.follow',
              rkey: 'abc',
            },
            {
              $type: `${repo}.applyWrites#delete`,
              collection: 'app.bsky.feed.like',
              rkey: 'abc',
            },
          ],
        },
      },
      {
        nsid: `${repo}.uploadBlob`,
        bytes: [1, 2],
        opts: { encoding: 'image/png' },
      },
      { nsid: 'app.bsky.graph.getFollowers', input: { limit: 2 } },
      { nsid: 'app.bsky.actor.getProfiles', input: { actors: [LAB.did] } },
      {
        nsid: `${repo}.listRecords`,
        input: { collection: 'app.bsky.graph.follow', limit: 1 },
      },
      {
        nsid: 'com.atproto.server.getServiceAuth',
        input: { aud: 'did:web:x', lxm: 'app.bsky.video.getUploadLimits' },
      },
    ],
  },
  {
    name: 'flaky',
    appview: 'flaky',
    steps: [
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: {
          actors: ['ana.example.com', 'did:plc:virgaharness000000000002'],
        },
      },
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: {
          actors: ['did:plc:virgaharness000000000002', 'ana.example.com'],
        },
      },
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: { actors: ['ana.example.com'] },
      },
    ],
  },
  {
    name: 'failopen',
    appview: 'failopen',
    steps: [
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: {
          actors: ['ana.example.com', 'did:plc:virgaharness000000000002'],
        },
      },
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: {
          actors: ['ana.example.com', 'did:plc:virgaharness000000000002'],
        },
      },
    ],
  },
  {
    name: 'lab',
    did: LAB.did,
    steps: [
      { nsid: 'app.bsky.graph.getFollowers', input: { limit: 3 } },
      { nsid: 'app.bsky.graph.getFollowers', input: { limit: 3 } },
      { nsid: 'app.bsky.draft.getDrafts', input: {}, proxy: true },
      { nsid: 'app.bsky.actor.getPreferences' },
      {
        nsid: `${repo}.createRecord`,
        input: { repo: ME.did, collection: 'x', rkey: 'a', record: {} },
      },
      { nsid: `${repo}.describeRepo` },
    ],
  },
  {
    name: 'drafts',
    steps: [
      {
        nsid: 'app.bsky.draft.createDraft',
        input: { draft: draftPost },
        proxy: true,
      },
      {
        nsid: 'app.bsky.draft.createDraft',
        input: { draft: { posts: [{ text: 'Second' }], langs: ['en'] } },
        proxy: true,
      },
      { nsid: 'app.bsky.draft.getDrafts', input: { limit: 3 }, proxy: true },
      {
        nsid: 'app.bsky.draft.updateDraft',
        input: { draft: { draft: { posts: [{ text: 'Edited' }] } } },
        draftId: 0,
        idAt: 'draft',
        proxy: true,
      },
      { nsid: 'app.bsky.draft.getDrafts', input: { limit: 3 }, proxy: true },
      // An update that sends no draft leaves the stored one without any.
      {
        nsid: 'app.bsky.draft.updateDraft',
        input: { draft: {} },
        draftId: 1,
        idAt: 'draft',
        proxy: true,
      },
      {
        nsid: 'app.bsky.draft.updateDraft',
        input: { draft: { draft: null } },
        draftId: 0,
        idAt: 'draft',
        proxy: true,
      },
      { nsid: 'app.bsky.draft.getDrafts', input: { limit: 3 }, proxy: true },
      {
        nsid: 'app.bsky.draft.updateDraft',
        input: { draft: null },
        proxy: true,
      },
      {
        nsid: 'app.bsky.draft.updateDraft',
        input: { draft: 'abc' },
        proxy: true,
      },
      {
        nsid: 'app.bsky.draft.deleteDraft',
        input: {},
        draftId: 1,
        proxy: true,
      },
      { nsid: 'app.bsky.draft.getDrafts', input: { limit: 3 }, proxy: true },
      { nsid: 'app.bsky.draft.deleteDraft', input: { id: 5 }, proxy: true },
      { nsid: 'app.bsky.draft.getDrafts', input: { limit: 1 }, proxy: true },
    ],
  },
  {
    name: 'odd-inputs',
    steps: [
      // NSIDs named after Object.prototype's keys, which the web's methods
      // object has too.
      ...[
        'constructor',
        '__defineGetter__',
        '__defineSetter__',
        'hasOwnProperty',
        '__lookupGetter__',
        '__lookupSetter__',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toString',
        'valueOf',
        '__proto__',
        'toLocaleString',
      ].flatMap((nsid) =>
        [
          { nsid },
          { nsid, input: null },
          { nsid, input: { a: [1, 'b'] } },
          { nsid, input: 'text' },
          { nsid, input: 7 },
          { nsid, input: [1] },
          // `Object(value)` of a primitive is its wrapper, which the
          // fixture's toJSON would spread into indexes where JSON.stringify
          // (the server's answer) writes the primitive: left out.
        ].filter(
          (s) =>
            s.nsid !== 'constructor' ||
            (typeof s.input !== 'string' && typeof s.input !== 'number'),
        ),
      ),
      { nsid: 'hasOwnProperty', proxy: true },
      { nsid: 'Constructor' },
      {
        nsid: 'app.bsky.feed.searchPosts',
        input: { q: 'garden', author: ['a', 'b'] },
      },
      { nsid: 'app.bsky.feed.searchPosts', input: { q: 'garden', author: 5 } },
      { nsid: 'app.bsky.feed.searchPosts', input: { q: 'garden', author: '' } },
      {
        nsid: 'app.bsky.feed.searchPosts',
        input: { q: 'garden', author: LAB.did },
      },
      { nsid: 'app.bsky.feed.searchPosts', input: { q: 5 } },
      {
        nsid: 'app.bsky.feed.searchPosts',
        input: { q: ['garden'], limit: 1 },
      },
      {
        nsid: `${repo}.listRecords`,
        input: {
          repo: [LAB.handle],
          collection: 'app.bsky.feed.post',
          limit: 1,
        },
      },
      {
        nsid: `${repo}.listRecords`,
        input: {
          repo: 'LAB.example.com',
          collection: 'app.bsky.feed.post',
          limit: 1,
        },
      },
      {
        nsid: `${repo}.listRecords`,
        input: {
          repo: `@${LAB.handle}`,
          collection: 'app.bsky.feed.post',
          limit: 1,
        },
      },
    ],
  },
  {
    name: 'odd-profiles',
    search: '?defense=on',
    steps: [
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: {
          actors: [
            [LAB.did],
            ['did:plc:virgaharness000000000002', 'x'],
            [LAB.handle],
            5,
            null,
            'ANA.Example.com',
            '@ana.example.com',
          ],
        },
      },
      {
        nsid: 'app.bsky.actor.getProfiles',
        input: { actors: 'ana.example.com' },
      },
      { nsid: 'app.bsky.actor.getProfiles', input: { actors: '' } },
    ],
  },
  {
    name: 'draft-limit',
    steps: [
      ...Array.from({ length: 50 }, () => ({
        nsid: 'app.bsky.draft.createDraft',
        input: { draft: draftPost },
        proxy: true,
      })),
      { nsid: 'app.bsky.draft.getDrafts', input: { limit: 100 }, proxy: true },
    ],
  },
];

export default async function cases() {
  return [
    value('DRAFT_LIMIT', DRAFT_LIMIT),
    ...(await each('scopesFor', scopeCases(), ({ nsid, input, opts }) =>
      scopesFor(nsid, input, opts),
    )),
    ...(await each(
      'mintServiceToken',
      TOKENS.map((claims, i) => ({ $id: `token#${i}`, claims })),
      ({ claims }) => mintServiceToken(claims),
    )),
    ...(await each(
      'readServiceToken',
      READS.map((token, i) => ({ $id: `read#${i}`, token })),
      ({ token }) => readServiceToken(token),
    )),
    ...(await each(
      'agent',
      SCENARIOS.map((s) => ({ $id: s.name, ...s })),
      ({ search = '', did = ME.did, appview, steps }) =>
        atTime(NOW, async () => {
          const worlds = worldsFor(search, NOW);
          const world = worlds.find((w) => w.me.did === did);
          let sweeps = 0;
          const agent = createFakeAgent(world, {
            worlds,
            scope: () => world.scope,
            appview,
            sweepCounter: { next: () => ++sweeps },
          });
          const minted = [];
          const out = [];
          for (const s of steps) out.push(await step(agent, minted, s, out));
          return out;
        }),
    )),
  ];
}
