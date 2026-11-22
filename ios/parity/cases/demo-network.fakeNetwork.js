// The network (harness/fakeNetwork.js createRouter) over the harness's
// worlds at a fixed now: its answers to a list of requests for every host
// it routes (the PLC directory, the public AppView, the accounts' PDS,
// Constellation, Bluesky's card and video services) and to ones it
// doesn't (null), each as status, content type and body (JSON shrunk,
// bytes by length and digest), or the error the route rejects with. The
// video scenario moves the router's clock between steps. Swift:
// VirgaDemo/Harness/FakeNetwork.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/FakeNetworkParityTests.swift.

import { createRouter } from '../../../harness/fakeNetwork.js';
import { mintServiceToken } from '../../../harness/fakeXrpc.js';
import {
  LAB,
  ME,
  PDS,
  activityOf,
  postRecord,
} from '../../../harness/world.js';
import { each } from './_helpers.js';
import { NOW, atTime, thrown } from './_demoWorld.js';
import { answerOf, worldsFor } from './_demoNetwork.js';

export const sources = ['harness/fakeNetwork.js'];

const APPVIEW = 'https://public.api.bsky.app/xrpc';
const CONSTELLATION = 'https://constellation.microcosm.blue';
const enc = encodeURIComponent;
const qs = (pairs) => new URLSearchParams(pairs).toString();

/** The requests, worked out from the worlds so they name real records. */
function requests(worlds) {
  const [mira] = worlds;
  const own = (p) => `at://${ME.did}/app.bsky.feed.post/${p.rkey}`;
  const top = mira.posts.find((p) => !p.replyTo && !p.thread);
  const busy = mira.posts.find((p) => !p.replyTo && p.likes > 40) || top;
  const selfReply = mira.posts.find((p) => p.thread);
  const castReply = mira.posts.find((p) => p.replyTo);
  const withImages = mira.posts.find((p) => postRecord(p).embed);
  const cast = mira.cast[3];
  const fol = mira.followedOnly;
  const gone = fol.find((p) => activityOf(p.did) === 'gone');
  const never = fol.find((p) => activityOf(p.did) === 'never');
  const modList = mira.lists.find((l) => l.subscribers.length > 0);
  const castPost = `at://${cast.did}/app.bsky.feed.post/3mabcdefghij2`;
  return [
    // The PLC directory.
    `https://plc.directory/${ME.did}`,
    `https://plc.directory/${LAB.did}`,
    `https://plc.directory/${cast.did}`,
    `https://plc.directory/${enc(ME.did)}`,
    'https://plc.directory/did:plc:virgaharnesscrowd00007',
    'https://plc.directory/did:plc:unknownperson',
    `https://plc.directory/${ME.did}/log/audit`,
    `https://plc.directory/${LAB.did}/log/audit`,
    'https://plc.directory/did:plc:unknownperson/log/audit',
    'https://plc.directory/%E0%A4%A',
    // The public AppView.
    `${APPVIEW}/app.bsky.actor.getProfile?actor=${ME.did}`,
    `${APPVIEW}/app.bsky.actor.getProfile?actor=${LAB.handle}`,
    `${APPVIEW}/app.bsky.actor.getProfile?actor=%40ANA.example.com`,
    `${APPVIEW}/app.bsky.actor.getProfile?actor=did:plc:virgaharnesscrowd00003`,
    `${APPVIEW}/app.bsky.actor.getProfile?actor=${fol[0].did}`,
    `${APPVIEW}/app.bsky.actor.getProfile?actor=nobody.example`,
    `${APPVIEW}/app.bsky.actor.getProfile`,
    `${APPVIEW}/app.bsky.actor.getProfiles?${qs([
      ['actors', ME.did],
      ['actors', cast.handle],
      ['actors', 'nobody.example'],
      ['actors', 'did:plc:virgaharnesscrowd00009'],
    ])}`,
    `${APPVIEW}/app.bsky.graph.getRelationships?${qs([
      ['actor', ME.did],
      ['others', LAB.did],
      ['others', cast.did],
      ['others', mira.cast[40].did],
      ['others', fol[1].did],
      ['others', 'did:plc:nobody'],
    ])}`,
    `${APPVIEW}/app.bsky.graph.getRelationships?${qs([
      ['actor', LAB.handle],
      ['others', ME.did],
    ])}`,
    `${APPVIEW}/app.bsky.graph.getRelationships?${qs([['actor', ME.did], ...Array.from({ length: 31 }, (_, i) => ['others', `did:plc:x${i}`])])}`,
    `${APPVIEW}/app.bsky.graph.getRelationships?actor=nobody.example&others=${LAB.did}`,
    `${APPVIEW}/app.bsky.actor.searchActors?q=an&limit=5`,
    `${APPVIEW}/app.bsky.actor.searchActorsTypeahead?term=mi`,
    `${APPVIEW}/app.bsky.actor.searchActors?q=%40Field`,
    `${APPVIEW}/app.bsky.actor.searchActors?q=a&limit=-2`,
    `${APPVIEW}/app.bsky.actor.searchActors?q=a&limit=500`,
    `${APPVIEW}/app.bsky.actor.searchActors?q=a&limit=abc`,
    `${APPVIEW}/app.bsky.actor.searchActors?q=`,
    `${APPVIEW}/com.atproto.identity.resolveHandle?handle=${ME.handle}`,
    `${APPVIEW}/com.atproto.identity.resolveHandle?handle=nobody.example`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${ME.did}&limit=5`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${ME.handle}&limit=4&cursor=5`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${ME.did}&filter=posts_no_replies&limit=6`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${ME.did}&filter=posts_with_media&limit=3`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${ME.did}&limit=100&cursor=900`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${LAB.did}`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${cast.handle}`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${gone.did}`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${never.did}`,
    `${APPVIEW}/app.bsky.feed.getAuthorFeed?actor=nobody.example`,
    `${APPVIEW}/app.bsky.feed.getPosts?${qs([
      ['uris', own(top)],
      ['uris', castPost],
      ['uris', `at://${ME.did}/app.bsky.feed.post/nothere`],
      ['uris', 'not a uri'],
    ])}`,
    `${APPVIEW}/app.bsky.feed.getPosts?${qs([['uris', own(withImages)]])}`,
    `${APPVIEW}/app.bsky.feed.getPosts?${qs(Array.from({ length: 26 }, () => ['uris', own(top)]))}`,
    `${APPVIEW}/app.bsky.feed.getPostThread?uri=${enc(own(busy))}`,
    `${APPVIEW}/app.bsky.feed.getPostThread?uri=${enc(own(selfReply))}&depth=1&parentHeight=2`,
    `${APPVIEW}/app.bsky.feed.getPostThread?uri=${enc(own(castReply))}&depth=0`,
    `${APPVIEW}/app.bsky.feed.getPostThread?uri=${enc(own(selfReply))}&depth=abc&parentHeight=0.5`,
    `${APPVIEW}/app.bsky.feed.getPostThread?uri=${enc(castPost)}`,
    `${APPVIEW}/app.bsky.feed.getPostThread`,
    `${APPVIEW}/app.bsky.feed.getFeedGenerator?feed=${enc(mira.feeds[0].uri)}`,
    `${APPVIEW}/app.bsky.feed.getFeedGenerator?feed=at://nobody/app.bsky.feed.generator/x`,
    `${APPVIEW}/app.bsky.feed.getFeedGenerators?${qs([
      ['feeds', mira.feeds[1].uri],
      ['feeds', 'at://x/y/z'],
      ['feeds', mira.feeds[0].uri],
    ])}`,
    `${APPVIEW}/app.bsky.feed.getActorFeeds?actor=${ME.did}&limit=1`,
    `${APPVIEW}/app.bsky.feed.getActorFeeds?actor=nobody.example`,
    `${APPVIEW}/app.bsky.graph.getList?list=${enc(mira.ownLists[0].uri)}&limit=3`,
    `${APPVIEW}/app.bsky.graph.getList?list=${enc(mira.ownLists[1].uri)}&cursor=2`,
    `${APPVIEW}/app.bsky.graph.getList?list=at://nobody/app.bsky.graph.list/x`,
    `${APPVIEW}/app.bsky.graph.getLists?actor=${ME.did}`,
    `${APPVIEW}/app.bsky.graph.getLists?actor=${LAB.did}&limit=1`,
    `${APPVIEW}/com.atproto.repo.getRecord?repo=${ME.did}&collection=app.bsky.actor.profile&rkey=self`,
    `${APPVIEW}/com.atproto.repo.getRecord?repo=${ME.handle}&collection=app.bsky.feed.post&rkey=${top.rkey}`,
    `${APPVIEW}/com.atproto.repo.getRecord?repo=${ME.did}&collection=app.bsky.feed.post&rkey=nothere`,
    `${APPVIEW}/com.atproto.repo.getRecord?${qs(
      modList.uri
        .slice(5)
        .split('/')
        .map((v, i) => [['repo', 'collection', 'rkey'][i], v]),
    )}`,
    `${APPVIEW}/com.atproto.repo.getRecord?repo=${cast.did}&collection=app.bsky.feed.post&rkey=3mabcdefghij2`,
    `${APPVIEW}/com.atproto.repo.getRecord?repo=${cast.did}&collection=app.bsky.feed.post&rkey=notatid`,
    `${APPVIEW}/com.atproto.repo.getRecord`,
    `${APPVIEW}/app.bsky.unspecced.getTrends`,
    // The accounts' PDS.
    `${PDS}/.well-known/oauth-protected-resource`,
    `${PDS}/xrpc/com.atproto.sync.getRepo?did=${ME.did}`,
    `${PDS}/xrpc/com.atproto.sync.getRepo?did=${LAB.did}`,
    `${PDS}/xrpc/com.atproto.sync.getRepo?did=${ME.did}&since=3mabc`,
    `${PDS}/xrpc/com.atproto.sync.getRepo?did=${ME.handle}`,
    `${PDS}/xrpc/com.atproto.sync.getRepo`,
    `${PDS}/xrpc/com.atproto.repo.getRecord?repo=${ME.did}&collection=app.bsky.feed.post&rkey=${top.rkey}`,
    `${PDS}/xrpc/com.atproto.repo.getRecord?repo=${LAB.handle}&collection=app.bsky.actor.profile&rkey=self`,
    `${PDS}/xrpc/com.atproto.repo.getRecord?repo=nobody&collection=x&rkey=y`,
    `${PDS}/xrpc/com.atproto.repo.listRecords?repo=${ME.did}&collection=app.bsky.feed.post&limit=3`,
    `${PDS}/xrpc/com.atproto.repo.listRecords?repo=${ME.did}&collection=app.bsky.graph.follow&limit=2&cursor=2`,
    `${PDS}/xrpc/com.atproto.repo.listRecords?repo=${ME.did}&collection=net.anisota.feed.template`,
    `${PDS}/xrpc/com.atproto.repo.listRecords?repo=nobody&collection=app.bsky.feed.post`,
    `${PDS}/xrpc/com.atproto.repo.listRecords?repo=${ME.did}&collection=toString`,
    `${PDS}/xrpc/com.atproto.repo.listRecords?repo=${ME.did}`,
    `${PDS}/xrpc/com.atproto.sync.getBlob?did=${ME.did}&cid=bafkreinothere`,
    `${PDS}/xrpc/com.atproto.server.describeServer`,
    // Constellation.
    `${CONSTELLATION}/links/all?target=${enc(own(busy))}`,
    `${CONSTELLATION}/links/all?target=${enc(castPost)}`,
    `${CONSTELLATION}/links/all`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', own(busy)],
      ['source', 'app.bsky.feed.like:subject.uri'],
      ['limit', '5'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', own(busy)],
      ['source', 'app.bsky.feed.like:subject.uri'],
      ['limit', '5'],
      ['cursor', '5'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', own(busy)],
      ['source', 'app.bsky.feed.post:reply.parent.uri'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', own(busy)],
      ['source', 'app.bsky.feed.repost:subject.uri'],
      ['limit', '100'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', ME.did],
      ['source', 'app.bsky.graph.block:subject'],
      ['limit', '3'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', ME.did],
      ['source', 'app.bsky.graph.block:subject'],
      ['limit', '100'],
      ['cursor', '100'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', LAB.did],
      ['source', 'app.bsky.graph.block:subject'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', modList.uri],
      ['source', 'app.bsky.graph.listblock:subject'],
      ['limit', '4'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${qs([
      ['subject', 'did:plc:nobody'],
      ['source', 'app.bsky.graph.follow:subject'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinksCount?${qs([
      ['subject', ME.did],
      ['source', 'app.bsky.graph.block:subject'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinksCount?${qs([
      ['subject', modList.uri],
      ['source', 'app.bsky.graph.listblock:subject'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getManyToMany?${qs([
      ['subject', ME.did],
      ['source', 'app.bsky.graph.listitem:subject'],
      ['pathToOther', 'list'],
      ['limit', '2'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getManyToMany?${qs([
      ['subject', LAB.did],
      ['limit', '100'],
    ])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getManyToMany?${qs([['subject', 'did:plc:nobody']])}`,
    `${CONSTELLATION}/xrpc/blue.microcosm.links.getDistinct?subject=x`,
    // Bluesky's card service.
    `https://cardyb.bsky.app/v1/extract?url=${enc('https://example.com/')}`,
    `https://cardyb.bsky.app/v1/extract?url=${enc('https://www.example.org/repair/cafe-guide.html')}`,
    `https://cardyb.bsky.app/v1/extract?url=${enc('https://news.example.net/2026/11/the-new-bench_story')}`,
    `https://cardyb.bsky.app/v1/extract?url=${enc('https://news.example.net/%C3%A9t%C3%A9-notes')}`,
    `https://cardyb.bsky.app/v1/extract?url=${enc('https://example.net/\u{1F600}story')}`,
    `https://cardyb.bsky.app/v1/extract?url=${enc('ftp://example.com/file')}`,
    `https://cardyb.bsky.app/v1/extract?url=${enc('https://shop.invalid/')}`,
    `https://cardyb.bsky.app/v1/extract?url=${enc('not a url')}`,
    'https://cardyb.bsky.app/v1/extract',
    `https://cardyb.bsky.app/v1/extract?url=${enc('https://example.com/%E0%A4%A')}`,
    ...[
      'http://a.example/x/y.z/q.html',
      'https://a.example/__--//',
      'https://a.example/%E2%80%A8line',
      'https://a.example/\u00dfoo',
      'https://a.example/\u{1F600}',
      'mailto:x@example.com',
      '',
    ].map((href) => `https://cardyb.bsky.app/v1/extract?url=${enc(href)}`),
    `https://cardyb.bsky.app/v1/image?url=${enc('https://example.com/og/123.png')}`,
    `https://cardyb.bsky.app/v1/image?url=${enc('https://example.com/og/123.png')}`,
    'https://cardyb.bsky.app/v1/other',
    // Hosts nobody routes.
    'https://example.com/',
    'https://bsky.social/xrpc/com.atproto.server.describeServer',
    '/relative/path',
  ].map((url) => ({ url }));
}

/** The video service: tokens, an upload, its job as the clock moves. */
function videoSteps() {
  const nowSec = Math.floor(NOW / 1000);
  const token = (claims) =>
    `Bearer ${mintServiceToken({ exp: nowSec + 600, ...claims })}`;
  const limits = token({
    iss: ME.did,
    aud: 'did:web:video.bsky.app',
    lxm: 'app.bsky.video.getUploadLimits',
  });
  const status = token({
    iss: ME.did,
    aud: 'did:web:video.bsky.app',
    lxm: 'app.bsky.video.getJobStatus',
  });
  const upload = token({
    iss: ME.did,
    aud: 'did:web:pds.harness.example',
    lxm: 'com.atproto.repo.uploadBlob',
  });
  const v = 'https://video.bsky.app/xrpc';
  const body = [0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50];
  return [
    { url: `${v}/app.bsky.video.getUploadLimits` },
    {
      url: `${v}/app.bsky.video.getUploadLimits`,
      headers: { authorization: limits },
    },
    {
      url: `${v}/app.bsky.video.getUploadLimits`,
      headers: { authorization: status },
    },
    {
      url: `${v}/app.bsky.video.getUploadLimits`,
      headers: {
        authorization: token({
          aud: 'did:web:video.bsky.app',
          lxm: 'app.bsky.video.getUploadLimits',
          exp: nowSec - 1,
        }),
      },
    },
    {
      url: `${v}/app.bsky.video.getUploadLimits`,
      headers: { authorization: 'Bearer harness.e30=.unsigned' },
    },
    {
      url: `${v}/app.bsky.video.uploadVideo?did=${ME.did}&name=a.mp4`,
      method: 'POST',
      headers: { authorization: limits, 'content-type': 'video/mp4' },
      body,
    },
    {
      url: `${v}/app.bsky.video.uploadVideo?did=${LAB.did}&name=a.mp4`,
      method: 'POST',
      headers: { authorization: upload, 'content-type': 'video/mp4' },
      body,
    },
    {
      url: `${v}/app.bsky.video.uploadVideo?did=${ME.did}`,
      method: 'POST',
      headers: { authorization: upload, 'content-type': 'video/mp4' },
      body,
    },
    {
      url: `${v}/app.bsky.video.uploadVideo?did=${ME.did}&name=a.mp4`,
      method: 'POST',
      headers: { authorization: upload, 'content-type': 'video/mp4' },
      body: [],
    },
    {
      url: `${v}/app.bsky.video.uploadVideo?did=${ME.did}&name=a.mp4`,
      method: 'POST',
      headers: { authorization: upload, 'content-type': 'video/mp4' },
      body,
    },
    {
      url: `${v}/app.bsky.video.uploadVideo?did=${ME.did}&name=b.mp4`,
      method: 'POST',
      headers: { authorization: upload },
      body,
    },
    {
      url: `${v}/app.bsky.video.getJobStatus?jobId=harness-nothere`,
      headers: { authorization: status },
    },
    {
      url: `${v}/app.bsky.video.getJobStatus?jobId=$job`,
      headers: { authorization: limits },
    },
    {
      url: `${v}/app.bsky.video.getJobStatus?jobId=$job`,
      headers: { authorization: status },
    },
    {
      url: `${v}/app.bsky.video.getJobStatus?jobId=$job`,
      headers: { authorization: status },
      advance: 1234,
    },
    {
      url: `${v}/app.bsky.video.getJobStatus?jobId=$job`,
      headers: { authorization: status },
      advance: 1766,
    },
    {
      url: `${v}/app.bsky.video.getJobStatus?jobId=$job`,
      headers: { authorization: status },
      advance: 2000,
    },
    { url: `${PDS}/xrpc/com.atproto.sync.getBlob?did=${ME.did}&cid=$blob` },
    {
      url: `${v}/app.bsky.video.getServiceConfig`,
      headers: { authorization: status },
    },
  ];
}

/** Each request in turn on one router, as status, type and body. */
async function replay(steps) {
  const worlds = worldsFor('', NOW);
  let clock = NOW;
  const route = createRouter(worlds, { now: () => clock });
  const out = [];
  let job = null;
  let blob = null;
  for (const s of steps) {
    if (s.advance) clock += s.advance;
    const url = s.url.replace('$job', job).replace('$blob', blob);
    const init = { method: s.method || 'GET', headers: s.headers || {} };
    if (s.body) init.body = Uint8Array.from(s.body);
    try {
      const res = await route(url, init);
      const answer = await answerOf(res);
      const created = answer?.json?.jobStatus?.jobId;
      if (created && answer.json.jobStatus.state === 'JOB_STATE_CREATED')
        job = created;
      const ref = answer?.json?.jobStatus?.blob?.ref?.$link;
      if (ref) blob = ref;
      out.push(answer);
    } catch (error) {
      out.push(thrown(error));
    }
  }
  return out;
}

export default async function cases() {
  const worlds = worldsFor('', NOW);
  return [
    ...(await each(
      'route',
      [
        { $id: 'reads', steps: requests(worlds) },
        { $id: 'video', steps: videoSteps() },
      ],
      ({ steps }) => atTime(NOW, () => replay(steps)),
    )),
  ];
}
