import { describe, expect, it } from 'vitest';
import {
  LOOKUP_PATH,
  eventPhrase,
  eventsCsvRows,
  filterEvents,
  interactionIndex,
  interactionModel,
  isDid,
  keepsMentions,
  lookupHref,
  matchPeople,
  parseActorInput,
  peopleDirectory,
} from './interactionModel.js';

const ME = 'did:plc:me';
const ADA = 'did:plc:ada'; // events both ways, follows and is followed
const BO = 'did:plc:bo'; // only ever engaged with you
const CY = 'did:plc:cy'; // only ever engaged with by you
const DEE = 'did:plc:dee'; // a follower with no events at all
const STRANGER = 'did:plc:stranger'; // nowhere in the archive

const NOW = new Date(2026, 10, 14, 12).getTime();

/** A local moment as ISO, so buckets land in the month the test names. */
const at = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).toISOString();
const monthStart = (year, month) => new Date(year, month - 1, 1).getTime();

let n = 0;
const inbound = (did, kind, when, extra = {}) => ({ uri: `at://${did}/app.bsky.feed.${kind === 'like' || kind === 'repost' ? kind : 'post'}/in${n++}`, did, kind, at: when, ...extra });
const outbound = (did, kind, when, extra = {}) => ({ uri: `at://${ME}/app.bsky.feed.${kind}/out${n++}`, did, kind, at: when, ...extra });
const post = (rkey, when, extra = {}) => ({ uri: `at://${ME}/app.bsky.feed.post/${rkey}`, rkey, at: when, text: `post ${rkey}`, replyTo: null, quoteOf: null, hasMedia: false, likes: 0, reposts: 0, replies: 0, quotes: 0, ...extra });

function archiveOf(parts = {}) {
  return {
    did: ME,
    rev: Math.random(),
    nowMs: NOW,
    posts: [],
    followers: [],
    following: [],
    blocks: [],
    inbound: [],
    outbound: [],
    actors: new Map(),
    meta: { posts: { complete: true }, followers: { complete: true }, following: { complete: true } },
    ...parts,
  };
}

/** One archive with someone of every sort in it. */
function world() {
  return archiveOf({
    inbound: [
      inbound(ADA, 'like', at(2026, 8, 3)),
      inbound(ADA, 'like', at(2026, 8, 20)),
      inbound(ADA, 'reply', at(2026, 9, 2)),
      inbound(ADA, 'mention', at(2026, 11, 1)),
      inbound(BO, 'repost', at(2026, 7, 9)),
      inbound(BO, 'quote', at(2026, 10, 5)),
    ],
    outbound: [
      outbound(ADA, 'like', at(2024, 3, 10)),
      outbound(ADA, 'like', at(2026, 9, 3)),
      outbound(ADA, 'repost', at(2026, 9, 4)),
      outbound(CY, 'like', at(2025, 1, 15)),
    ],
    posts: [
      post('own', at(2026, 6, 1)),
      post('thread', at(2026, 6, 2), { replyTo: ME }),
      post('toada', at(2026, 9, 5), { replyTo: ADA, text: 'Agreed, and thank you' }),
      post('quoteada', at(2026, 10, 1), { quoteOf: ADA }),
      post('both', at(2026, 10, 2), { replyTo: ADA, quoteOf: ADA }),
      post('tocy', at(2025, 2, 1), { replyTo: CY }),
    ],
    followers: [
      { did: ADA, handle: 'ada.example.com', displayName: 'Ada Lindqvist', avatar: '', followedAt: at(2025, 5, 5) },
      { did: DEE, handle: 'dee.example.com', displayName: '', avatar: '', followedAt: null },
    ],
    following: [
      { uri: `at://${ME}/app.bsky.graph.follow/a1`, did: ADA, followedAt: at(2025, 6, 1) },
      { uri: `at://${ME}/app.bsky.graph.follow/c1`, did: CY, followedAt: null },
    ],
  });
}

describe('one account, both ways', () => {
  it('counts each direction by kind, without mixing them', () => {
    const m = interactionModel(world(), ADA);
    expect(m.totals.in).toEqual({ like: 2, repost: 0, reply: 1, quote: 0, mention: 1, total: 4 });
    // Three from the repo, then the replies and quotes in the post archive:
    // two replies and two quotes, the post that does both counted as each.
    expect(m.totals.out).toEqual({ like: 2, repost: 1, reply: 2, quote: 2, mention: null, total: 7 });
    expect(m.events).toHaveLength(11);
    expect(m.self).toBe(false);
  });

  it('has no count for the mentions you made while the posts don’t keep them', () => {
    expect(keepsMentions(world())).toBe(false);
    expect(interactionModel(world(), ADA).totals.out.mention).toBe(null);
    expect(interactionModel(world(), STRANGER).totals.out.mention).toBe(null);
  });

  it('counts the mentions you made once the posts say who they mention', () => {
    const archive = archiveOf({
      posts: [
        post('plain', at(2026, 6, 1), { mentions: [] }),
        post('named', at(2026, 6, 2), { mentions: [ADA, BO], text: 'Thanks to both of you' }),
        post('answer', at(2026, 6, 3), { replyTo: ADA, mentions: [ADA] }),
        post('older', at(2026, 5, 1)),
      ],
    });
    expect(keepsMentions(archive)).toBe(true);
    const ada = interactionModel(archive, ADA);
    expect(ada.totals.out).toEqual({ like: 0, repost: 0, reply: 1, quote: 0, mention: 2, total: 3 });
    const mention = ada.events.find((e) => e.uri.endsWith('/named'));
    expect(mention).toMatchObject({ dir: 'out', kind: 'mention', urlOwner: 'you', url: `https://bsky.app/profile/${ME}/post/named`, text: 'Thanks to both of you' });
    expect(eventPhrase(mention)).toBe('You mentioned them');
    // A reply that also names them is both, and the list of replies and quotes stays that.
    expect(ada.events.filter((e) => e.uri.endsWith('/answer')).map((e) => e.kind).sort()).toEqual(['mention', 'reply']);
    expect(ada.yourPosts.map((p) => p.rkey)).toEqual(['answer']);
    expect(interactionModel(archive, BO).totals.out).toMatchObject({ mention: 1, total: 1 });
    // Nobody mentioned is none, not unknown.
    expect(interactionModel(archive, STRANGER).totals.out.mention).toBe(0);
    expect(interactionIndex(archive).byDid.get(ADA)).toEqual({ did: ADA, in: 0, out: 3, total: 3 });
  });

  it('finds the first and the latest event each way', () => {
    const m = interactionModel(world(), ADA);
    expect(m.first.in).toMatchObject({ kind: 'like', at: at(2026, 8, 3) });
    expect(m.latest.in).toMatchObject({ kind: 'mention', at: at(2026, 11, 1) });
    expect(m.first.out).toMatchObject({ kind: 'like', at: at(2024, 3, 10) });
    expect(m.latest.out).toMatchObject({ dir: 'out', uri: `at://${ME}/app.bsky.feed.post/both` });
  });

  it('lists the events newest first, each with its direction', () => {
    const m = interactionModel(world(), ADA);
    const times = m.events.map((e) => e.atMs);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(m.events[0]).toMatchObject({ dir: 'in', kind: 'mention' });
    expect(new Set(m.events.map((e) => e.key)).size).toBe(m.events.length);
  });

  it('links an event to a post only when the archive knows the post', () => {
    const m = interactionModel(world(), ADA);
    const by = (dir, kind) => m.events.find((e) => e.dir === dir && e.kind === kind);
    // Their reply is their post.
    expect(by('in', 'reply')).toMatchObject({ urlOwner: 'them', text: '' });
    expect(by('in', 'reply').url).toMatch(new RegExp(`^https://bsky\\.app/profile/${ADA}/post/in\\d+$`));
    // Your reply is your post, with your words.
    const reply = m.events.find((e) => e.uri.endsWith('/toada'));
    expect(reply).toMatchObject({ dir: 'out', kind: 'reply', urlOwner: 'you', url: `https://bsky.app/profile/${ME}/post/toada`, text: 'Agreed, and thank you' });
    // A like is a record of its own: without a subject, no post to open.
    expect(by('in', 'like')).toMatchObject({ url: null, urlOwner: null });
    expect(by('out', 'like')).toMatchObject({ url: null, urlOwner: null });
  });

  it('opens the liked post when the event says which it was', () => {
    const archive = archiveOf({
      posts: [post('own', at(2026, 6, 1), { text: 'The heron again' })],
      inbound: [inbound(ADA, 'like', at(2026, 8, 3), { subject: `at://${ME}/app.bsky.feed.post/own` })],
      outbound: [outbound(ADA, 'like', at(2026, 8, 4), { subject: `at://${ADA}/app.bsky.feed.post/theirs` })],
    });
    const m = interactionModel(archive, ADA);
    expect(m.events.find((e) => e.dir === 'in')).toMatchObject({ url: `https://bsky.app/profile/${ME}/post/own`, urlOwner: 'you', text: 'The heron again' });
    expect(m.events.find((e) => e.dir === 'out')).toMatchObject({ url: `https://bsky.app/profile/${ADA}/post/theirs`, urlOwner: 'them', text: '' });
  });

  it('lists your replies to them and quotes of them, newest first', () => {
    const m = interactionModel(world(), ADA);
    expect(m.yourPosts.map((p) => p.rkey)).toEqual(['both', 'quoteada', 'toada']);
  });

  it('reads the relationship from the follower and follow stores', () => {
    const { relationship } = interactionModel(world(), ADA);
    expect(relationship.theyFollow).toEqual({ known: true, is: true, since: at(2025, 5, 5), left: null });
    expect(relationship.youFollow).toEqual({ known: true, is: true, since: at(2025, 6, 1) });
    expect(relationship.theyBlock).toBe(null);
  });
});

describe('one way only', () => {
  it('someone who only engaged with you has nothing going out', () => {
    const m = interactionModel(world(), BO);
    expect(m.totals.in).toMatchObject({ repost: 1, quote: 1, total: 2 });
    expect(m.totals.out).toMatchObject({ like: 0, repost: 0, reply: 0, quote: 0, total: 0 });
    expect(m.first.out).toBe(null);
    expect(m.latest.out).toBe(null);
    expect(m.yourPosts).toEqual([]);
    expect(m.timeline.outbound.every((p) => p.v === 0)).toBe(true);
    expect(m.relationship.theyFollow.is).toBe(false);
    expect(m.relationship.youFollow.is).toBe(false);
  });

  it('someone you only engaged with has nothing coming in', () => {
    const m = interactionModel(world(), CY);
    expect(m.totals.out).toMatchObject({ like: 1, reply: 1, total: 2 });
    expect(m.totals.in.total).toBe(0);
    expect(m.first.in).toBe(null);
    expect(m.latest.in).toBe(null);
    expect(m.events.every((e) => e.dir === 'out')).toBe(true);
  });
});

describe('nothing at all', () => {
  it('a follower with no events has a relationship and an empty history', () => {
    const m = interactionModel(world(), DEE);
    expect(m.events).toEqual([]);
    expect(m.totals.in.total).toBe(0);
    expect(m.totals.out.total).toBe(0);
    expect(m.timeline).toBe(null);
    expect(m.first).toEqual({ in: null, out: null });
    expect(m.latest).toEqual({ in: null, out: null });
    expect(m.relationship.theyFollow.is).toBe(true);
  });

  it('a DID the archive has never met comes back the same shape, empty', () => {
    const m = interactionModel(world(), STRANGER);
    expect(m).toMatchObject({ did: STRANGER, self: false, events: [], yourPosts: [], timeline: null });
    expect(m.totals.in.total + m.totals.out.total).toBe(0);
    expect(m.relationship.theyFollow).toEqual({ known: true, is: false, since: null, left: null });
    expect(m.relationship.youFollow).toEqual({ known: true, is: false, since: null });
    expect(m.engagedPosts).toEqual({ known: false, counted: 0, of: 0, rows: [] });
  });

  it('doesn’t say “not following” before the follows have been read', () => {
    const m = interactionModel(archiveOf({ meta: {} }), STRANGER);
    expect(m.relationship.theyFollow.known).toBe(false);
    expect(m.relationship.youFollow.known).toBe(false);
    expect(m.coverage.postsComplete).toBe(false);
  });

  it('looking yourself up is not a history: threads aren’t interactions', () => {
    const m = interactionModel(world(), ME);
    expect(m.self).toBe(true);
    expect(m.events).toEqual([]);
    expect(m.yourPosts).toEqual([]);
  });
});

describe('follows without a date', () => {
  it('says a follow is there but can’t be dated', () => {
    const dee = interactionModel(world(), DEE).relationship;
    expect(dee.theyFollow).toMatchObject({ is: true, since: null });
    const cy = interactionModel(world(), CY).relationship;
    expect(cy.youFollow).toMatchObject({ is: true, since: null });
  });

  it('treats an unreadable date as no date', () => {
    const archive = archiveOf({
      followers: [{ did: ADA, handle: 'ada.example.com', followedAt: 'not a date' }],
      following: [{ uri: `at://${ME}/app.bsky.graph.follow/self`, did: ADA, followedAt: '' }],
    });
    const { relationship } = interactionModel(archive, ADA);
    expect(relationship.theyFollow).toMatchObject({ is: true, since: null });
    expect(relationship.youFollow).toMatchObject({ is: true, since: null });
  });

  it('dates a doubled follow by its older record', () => {
    const archive = archiveOf({
      following: [
        { uri: `at://${ME}/app.bsky.graph.follow/b`, did: ADA, followedAt: at(2025, 9, 1) },
        { uri: `at://${ME}/app.bsky.graph.follow/a`, did: ADA, followedAt: at(2024, 2, 1) },
        { uri: `at://${ME}/app.bsky.graph.follow/c`, did: ADA, followedAt: null },
      ],
    });
    expect(interactionModel(archive, ADA).relationship.youFollow.since).toBe(at(2024, 2, 1));
  });

  it('remembers someone who left, from the unfollow log', () => {
    const noticedAt = new Date(2026, 9, 20).getTime();
    const since = new Date(2026, 9, 13).getTime();
    const archive = archiveOf({
      meta: {
        followers: { complete: true },
        followerLog: {
          entries: [
            { did: BO, kind: 'lost', at: noticedAt, since, followedAt: at(2025, 1, 1) },
            { did: BO, kind: 'gained', at: 1, since: null, followedAt: at(2025, 1, 1) },
          ],
        },
      },
    });
    expect(interactionModel(archive, BO).relationship.theyFollow).toEqual({
      known: true,
      is: false,
      since: null,
      left: { noticedAt, since, followedAt: at(2025, 1, 1) },
    });
    // Someone who came back is a follower, whatever the log remembers.
    const back = archiveOf({ ...archive, rev: Math.random(), followers: [{ did: BO, handle: 'bo.example.com', followedAt: at(2026, 11, 1) }] });
    expect(interactionModel(back, BO).relationship.theyFollow).toMatchObject({ is: true, left: null });
  });

  it('says when they block you, and how', () => {
    const archive = archiveOf({
      blocks: [
        { uri: 'at://x/app.bsky.graph.listblock/1', did: BO, blockedAt: at(2026, 3, 1), source: 'list' },
        { uri: `at://${BO}/app.bsky.graph.block/1`, did: BO, blockedAt: at(2026, 5, 1), source: 'direct' },
        { uri: `at://${CY}/app.bsky.graph.block/1`, did: CY, blockedAt: at(2026, 1, 1), source: 'direct' },
      ],
    });
    expect(interactionModel(archive, BO).relationship.theyBlock).toEqual({ since: at(2026, 3, 1), direct: true, list: true });
    expect(interactionModel(archive, ADA).relationship.theyBlock).toBe(null);
  });
});

describe('the timeline, by month', () => {
  it('runs from the first event either way to now, every month present', () => {
    const { timeline } = interactionModel(world(), ADA);
    expect(timeline.unit).toBe('month');
    // March 2024 through November 2026.
    expect(timeline.outbound).toHaveLength(33);
    expect(timeline.inbound).toHaveLength(33);
    expect(timeline.outbound[0]).toEqual({ t: monthStart(2024, 3), v: 1 });
    expect(timeline.outbound[1]).toEqual({ t: monthStart(2024, 4), v: 0 });
    expect(timeline.outbound.at(-1).t).toBe(monthStart(2026, 11));
    const out = Object.fromEntries(timeline.outbound.map((p) => [p.t, p.v]));
    expect(out[monthStart(2026, 9)]).toBe(3); // a like, a repost and a reply
    expect(out[monthStart(2026, 10)]).toBe(3); // a quote, and a post that is both
    expect(timeline.outbound.reduce((sum, p) => sum + p.v, 0)).toBe(7);
  });

  it('puts an event in the month it happened in, on the reader’s own calendar', () => {
    const archive = archiveOf({
      inbound: [inbound(ADA, 'like', at(2026, 6, 30, 23)), inbound(ADA, 'like', at(2026, 7, 1, 0)), inbound(ADA, 'reply', at(2026, 7, 31, 23))],
    });
    const { timeline } = interactionModel(archive, ADA);
    expect(timeline.inbound.slice(0, 3)).toEqual([
      { t: monthStart(2026, 6), v: 1 },
      { t: monthStart(2026, 7), v: 2 },
      { t: monthStart(2026, 8), v: 0 },
    ]);
  });

  it('has no inbound value for a month before the notifications begin', () => {
    // The oldest notification from anyone is Bo’s, in July 2026.
    const { timeline, coverage } = interactionModel(world(), ADA);
    expect(coverage.inboundSinceMs).toBe(Date.parse(at(2026, 7, 9)));
    const inb = Object.fromEntries(timeline.inbound.map((p) => [p.t, p.v]));
    expect(inb[monthStart(2024, 3)]).toBe(null);
    expect(inb[monthStart(2026, 6)]).toBe(null);
    expect(inb[monthStart(2026, 7)]).toBe(0); // covered from here, and Ada did nothing
    expect(inb[monthStart(2026, 8)]).toBe(2);
    expect(inb[monthStart(2026, 9)]).toBe(1);
    expect(inb[monthStart(2026, 10)]).toBe(0);
    expect(inb[monthStart(2026, 11)]).toBe(1);
    expect(timeline.inboundFromMs).toBe(monthStart(2026, 7));
    expect(timeline.inboundCovered).toBe(true);
  });

  it('marks nothing when the notifications reach as far back as the history', () => {
    const { timeline } = interactionModel(world(), BO);
    expect(timeline.inbound[0]).toEqual({ t: monthStart(2026, 7), v: 1 });
    expect(timeline.inboundFromMs).toBe(null);
  });

  it('has no inbound values at all without notifications', () => {
    const archive = archiveOf({ outbound: [outbound(ADA, 'like', at(2026, 9, 3))] });
    const { timeline, coverage } = interactionModel(archive, ADA);
    expect(coverage.inboundSinceMs).toBe(null);
    expect(timeline.inbound.every((p) => p.v === null)).toBe(true);
    expect(timeline.inboundCovered).toBe(false);
    expect(timeline.inboundFromMs).toBe(null);
  });

  it('leaves out an event it can’t date', () => {
    const archive = archiveOf({ inbound: [inbound(ADA, 'like', 'whenever'), inbound(ADA, 'like', at(2026, 10, 1))] });
    const m = interactionModel(archive, ADA);
    expect(m.events).toHaveLength(1);
    expect(m.totals.in.like).toBe(1);
  });
});

describe('coverage', () => {
  it('says how far back each side can speak', () => {
    const archive = archiveOf({
      inbound: [inbound(BO, 'like', at(2026, 2, 1))],
      meta: { posts: { complete: true }, inbound: { truncated: true }, outbound: { coverageMs: 0 } },
    });
    expect(interactionModel(archive, ADA).coverage).toEqual({
      inboundSinceMs: Date.parse(at(2026, 2, 1)),
      inboundTruncated: true,
      outboundSinceMs: null,
      postsComplete: true,
    });
    const partial = archiveOf({ meta: { posts: { complete: false }, outbound: { coverageMs: 1_700_000_000_000 } } });
    expect(interactionModel(partial, ADA).coverage).toMatchObject({ outboundSinceMs: 1_700_000_000_000, postsComplete: false });
  });
});

describe('which of your posts they engaged with', () => {
  it('can’t say when no event names its post', () => {
    const { engagedPosts } = interactionModel(world(), ADA);
    // Two likes and a reply could have named one; the mention never could.
    expect(engagedPosts).toEqual({ known: false, counted: 0, of: 3, rows: [] });
  });

  it('ranks your posts by how often they did, when events name them', () => {
    const own = (rkey) => `at://${ME}/app.bsky.feed.post/${rkey}`;
    const archive = archiveOf({
      posts: [post('a', at(2026, 6, 1)), post('b', at(2026, 6, 2))],
      inbound: [
        inbound(ADA, 'like', at(2026, 8, 1), { subject: own('a') }),
        inbound(ADA, 'like', at(2026, 8, 2), { subject: own('b') }),
        inbound(ADA, 'reply', at(2026, 8, 3), { subject: own('b') }),
        inbound(ADA, 'repost', at(2026, 8, 4), { subject: own('gone') }),
        inbound(ADA, 'reply', at(2026, 8, 5), { subject: `at://${BO}/app.bsky.feed.post/elsewhere` }),
        inbound(ADA, 'quote', at(2026, 8, 6)),
        inbound(BO, 'like', at(2026, 8, 7), { subject: own('a') }),
      ],
    });
    const { engagedPosts } = interactionModel(archive, ADA);
    expect(engagedPosts).toMatchObject({ known: true, counted: 5, of: 6 });
    expect(engagedPosts.rows.map((r) => [r.uri, r.total])).toEqual([
      [own('b'), 2],
      [own('gone'), 1],
      [own('a'), 1],
    ]);
    expect(engagedPosts.rows[0]).toMatchObject({ byKind: { like: 1, reply: 1 }, url: `https://bsky.app/profile/${ME}/post/b` });
    expect(engagedPosts.rows[0].post.rkey).toBe('b');
    // A post that has left the archive still counts; it just has no words.
    expect(engagedPosts.rows[1].post).toBe(null);
  });
});

describe('filters', () => {
  const events = () => interactionModel(world(), ADA).events;

  it('keeps everything with no filter', () => {
    expect(filterEvents(events())).toHaveLength(11);
    expect(filterEvents(events(), { direction: 'all', kind: 'all' })).toHaveLength(11);
  });

  it('filters by direction', () => {
    expect(filterEvents(events(), { direction: 'in' })).toHaveLength(4);
    expect(filterEvents(events(), { direction: 'out' })).toHaveLength(7);
    expect(filterEvents(events(), { direction: 'in' }).every((e) => e.dir === 'in')).toBe(true);
  });

  it('filters by kind, and by both at once', () => {
    expect(filterEvents(events(), { kind: 'like' })).toHaveLength(4);
    expect(filterEvents(events(), { kind: 'reply' })).toHaveLength(3);
    expect(filterEvents(events(), { direction: 'out', kind: 'reply' })).toHaveLength(2);
    expect(filterEvents(events(), { direction: 'in', kind: 'quote' })).toEqual([]);
    expect(filterEvents(events(), { direction: 'out', kind: 'mention' })).toEqual([]);
  });

  it('keeps the order it was given', () => {
    const likes = filterEvents(events(), { kind: 'like' }).map((e) => e.atMs);
    expect(likes).toEqual([...likes].sort((a, b) => b - a));
  });

  it('says what each event was, and who did it', () => {
    expect(eventPhrase({ dir: 'in', kind: 'like' })).toBe('They liked one of your posts');
    expect(eventPhrase({ dir: 'in', kind: 'mention' })).toBe('They mentioned you');
    expect(eventPhrase({ dir: 'out', kind: 'reply' })).toBe('You replied to them');
    expect(eventPhrase({ dir: 'sideways', kind: 'like' })).toBe('');
  });
});

describe('everyone the archive knows', () => {
  it('counts events with each account, each way, and ranks them', () => {
    const { byDid, ranked } = interactionIndex(world());
    expect(byDid.get(ADA)).toEqual({ did: ADA, in: 4, out: 7, total: 11 });
    expect(byDid.get(BO)).toEqual({ did: BO, in: 2, out: 0, total: 2 });
    expect(byDid.get(CY)).toEqual({ did: CY, in: 0, out: 2, total: 2 });
    // Replies to your own posts are threading, and nobody’s history.
    expect(byDid.has(ME)).toBe(false);
    expect(ranked.map((r) => r.did)).toEqual([ADA, BO, CY]);
  });

  it('agrees with the model about every account', () => {
    const archive = world();
    for (const row of interactionIndex(archive).ranked) {
      const m = interactionModel(archive, row.did);
      expect([row.in, row.out]).toEqual([m.totals.in.total, m.totals.out.total]);
    }
  });

  const cards = new Map([
    [ADA, { handle: 'ada.example.com', displayName: 'Ada Lindqvist', avatar: 'a.png' }],
    [BO, { handle: 'bo.lindqvist.example.org', displayName: '' }],
    [DEE, { handle: 'dee.example.com', displayName: 'Adaeze Okonkwo' }],
  ]);
  const directory = () => peopleDirectory(world(), (did) => cards.get(did) || null);

  it('gathers the accounts behind events, followers and follows, once each', () => {
    const people = directory();
    expect(people.map((p) => p.did).sort()).toEqual([ADA, BO, CY, DEE].sort());
    expect(people.find((p) => p.did === ADA)).toEqual({
      did: ADA,
      handle: 'ada.example.com',
      displayName: 'Ada Lindqvist',
      avatar: 'a.png',
      in: 4,
      out: 7,
      total: 11,
      followsYou: true,
      youFollow: true,
    });
    expect(people.find((p) => p.did === DEE)).toMatchObject({ total: 0, followsYou: true, youFollow: false });
    expect(people.find((p) => p.did === CY)).toMatchObject({ handle: '', displayName: '', youFollow: true });
  });

  it('suggests by name or handle, the closest match first, then the most history', () => {
    const dids = (q) => matchPeople(directory(), q).map((p) => p.did);
    expect(dids('ada')).toEqual([ADA, DEE]); // both start with it; Ada has the history
    expect(dids('Ada L')).toEqual([ADA]);
    expect(dids('lind')).toEqual([ADA, BO]); // a word of a name, a label of a handle
    expect(dids('@bo.lind')).toEqual([BO]);
    expect(dids('example.com')).toEqual([ADA, DEE]);
    expect(dids('okonkwo')).toEqual([DEE]);
    expect(dids('zzz')).toEqual([]);
    expect(dids('')).toEqual([]);
    expect(dids('   ')).toEqual([]);
  });

  it('finds someone known only by DID by their DID', () => {
    const dids = (q) => matchPeople(directory(), q).map((p) => p.did);
    expect(dids(CY)).toEqual([CY]);
    expect(dids('did:plc:c')).toEqual([CY]);
    expect(dids('cy')).toEqual([]);
  });

  it('keeps to the limit', () => {
    expect(matchPeople(directory(), 'example', { limit: 2 })).toHaveLength(2);
    expect(matchPeople(directory(), 'example', { limit: 0 })).toEqual([]);
  });
});

describe('naming an account', () => {
  it('reads a handle or a DID typed in full', () => {
    expect(parseActorInput('ada.example.com')).toEqual({ kind: 'handle', value: 'ada.example.com' });
    expect(parseActorInput('  @Ada.Example.com ')).toEqual({ kind: 'handle', value: 'ada.example.com' });
    expect(parseActorInput('did:plc:z72i7hdynmk6r22z27h6tvur')).toEqual({ kind: 'did', value: 'did:plc:z72i7hdynmk6r22z27h6tvur' });
    expect(parseActorInput('did:web:example.com')).toEqual({ kind: 'did', value: 'did:web:example.com' });
    expect(parseActorInput('at://did:plc:abc')).toEqual({ kind: 'did', value: 'did:plc:abc' });
  });

  it('reads the account out of a pasted profile link', () => {
    expect(parseActorInput('https://bsky.app/profile/ada.example.com')).toEqual({ kind: 'handle', value: 'ada.example.com' });
    expect(parseActorInput('https://bsky.app/profile/did:plc:abc/post/3kabc')).toEqual({ kind: 'did', value: 'did:plc:abc' });
  });

  it('takes half a name for a search, not an account', () => {
    for (const text of ['', '   ', 'ada', '@ada', 'ada lindqvist', 'did:', 'did:key:z6Mk', 'ada.', '.com', 'a b.com', 'example.123']) {
      expect(parseActorInput(text)).toBe(null);
    }
  });

  it('knows a DID when it sees one', () => {
    expect(isDid('did:plc:abc')).toBe(true);
    expect(isDid('ada.example.com')).toBe(false);
    expect(isDid(null)).toBe(false);
  });

  it('writes the address of one account’s history, keeping the rest of the query', () => {
    expect(lookupHref(ADA)).toBe(`${LOOKUP_PATH}?who=did:plc:ada`);
    expect(lookupHref(ADA, '?latency=0')).toBe(`${LOOKUP_PATH}?latency=0&who=did:plc:ada`);
    expect(lookupHref(BO, '?who=did:plc:ada&latency=0')).toBe(`${LOOKUP_PATH}?latency=0&who=did:plc:bo`);
    expect(lookupHref(null, '?who=did:plc:ada')).toBe(LOOKUP_PATH);
    expect(lookupHref(null, '?who=did:plc:ada&accounts=1')).toBe(`${LOOKUP_PATH}?accounts=1`);
    expect(new URLSearchParams(lookupHref('did:web:example.com%3A8080').split('?')[1]).get('who')).toBe('did:web:example.com%3A8080');
  });
});

describe('the export', () => {
  it('writes one row per event under a header, both directions told apart', () => {
    const m = interactionModel(world(), ADA);
    const rows = eventsCsvRows(m.events, { did: ADA, handle: 'ada.example.com' });
    expect(rows[0]).toEqual(['at', 'direction', 'kind', 'their_did', 'their_handle', 'post_url', 'post_by', 'text', 'record_uri']);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.length === 9)).toBe(true);
    expect(rows[1].slice(0, 5)).toEqual([at(2026, 11, 1), 'them to you', 'mention', ADA, 'ada.example.com']);
    const reply = rows.find((r) => r[8].endsWith('/toada'));
    expect(reply).toEqual([at(2026, 9, 5), 'you to them', 'reply', ADA, 'ada.example.com', `https://bsky.app/profile/${ME}/post/toada`, 'you', 'Agreed, and thank you', `at://${ME}/app.bsky.feed.post/toada`]);
    const like = rows.find((r) => r[1] === 'you to them' && r[2] === 'like');
    expect(like.slice(5, 8)).toEqual(['', '', '']);
  });

  it('exports what a filter leaves, and a header alone for nothing', () => {
    const m = interactionModel(world(), ADA);
    expect(eventsCsvRows(filterEvents(m.events, { direction: 'in', kind: 'like' }), { did: ADA })).toHaveLength(3);
    expect(eventsCsvRows([], { did: STRANGER })).toHaveLength(1);
  });

  it('keeps a post’s line breaks as plain newlines', () => {
    const rows = eventsCsvRows([{ at: at(2026, 1, 1), dir: 'out', kind: 'reply', url: null, urlOwner: null, text: 'one\r\ntwo\rthree', uri: 'at://x' }], { did: ADA });
    expect(rows[1][7]).toBe('one\ntwo\nthree');
  });
});
