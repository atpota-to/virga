import { describe, it, expect } from 'vitest';
import {
  classifyFailure,
  countsFromPostView,
  unreportedMetricsFor,
  evaluateConditions,
  hasClauses,
  needsThread,
  normalizeConditions,
  parseAtUri,
  collectThreadRecords,
  normalizeEffects,
  narrowAllow,
  normalizeActorFilter,
  clauseCountKey,
  snippetFromScheduledPayload,
  validateArm,
  MAX_LIFESPAN_SECONDS,
  MIN_LIFESPAN_SECONDS,
} from './selfDestruct.js';

// A self-destruct timer ends in a deleteRecord against someone's repo, so the
// pure parts in front of that — which repo, which record, and whether the post
// earned its keep — are the ones worth locking down. Everything here is a pure
// function; the Supabase and PDS paths are covered in selfDestruct.resolve.test.js,
// selfDestruct.store.test.js and selfDestruct.pglite.test.js.

const DID = 'did:plc:abc123xyz';
const OTHER = 'did:plc:someoneelse';
const uriFor = (did, rkey, collection = 'app.bsky.feed.post') => `at://${did}/${collection}/${rkey}`;

describe('parseAtUri', () => {
  it('splits a well-formed post URI', () => {
    expect(parseAtUri(uriFor(DID, '3kabc'))).toEqual({
      did: DID,
      collection: 'app.bsky.feed.post',
      rkey: '3kabc',
    });
  });

  it('refuses anything that is not one', () => {
    // The rkey it returns is handed straight to deleteRecord, so a URI that
    // does not parse cleanly must never reach a row.
    expect(parseAtUri('https://bsky.app/profile/x/post/y')).toBeNull();
    expect(parseAtUri('at://not-a-did/app.bsky.feed.post/3k')).toBeNull();
    expect(parseAtUri('at://did:plc:abc/app.bsky.feed.post')).toBeNull();
    expect(parseAtUri('at://did:plc:abc/app.bsky.feed.post/a/b')).toBeNull();
    expect(parseAtUri(null)).toBeNull();
    expect(parseAtUri(42)).toBeNull();
  });
});

describe('validateArm', () => {
  const base = { userDid: DID, postUri: uriFor(DID, '3kabc'), lifespanSeconds: 3600 };

  it('accepts a plain timer on the caller’s own post', () => {
    const result = validateArm(base);
    expect(result.ok).toBe(true);
    expect(result.value.collection).toBe('app.bsky.feed.post');
    expect(result.value.rkey).toBe('3kabc');
    expect(result.value.extraUris).toEqual([]);
  });

  it('refuses a post in someone else’s repo', () => {
    // The one rule that matters most: a session may only ever be pointed at its
    // own PDS.
    const result = validateArm({ ...base, postUri: uriFor(OTHER, '3kabc') });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/your own post/);
  });

  it('refuses a collection we are not willing to delete from', () => {
    const result = validateArm({ ...base, postUri: uriFor(DID, '3kabc', 'app.bsky.graph.follow') });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('a timer can only be set on a Bluesky post here');
  });

  it('holds the lifespan inside the offered range', () => {
    expect(validateArm({ ...base, lifespanSeconds: MIN_LIFESPAN_SECONDS - 1 }).ok).toBe(false);
    expect(validateArm({ ...base, lifespanSeconds: MAX_LIFESPAN_SECONDS + 1 }).ok).toBe(false);
    expect(validateArm({ ...base, lifespanSeconds: MIN_LIFESPAN_SECONDS }).ok).toBe(true);
    expect(validateArm({ ...base, lifespanSeconds: MAX_LIFESPAN_SECONDS }).ok).toBe(true);
    expect(validateArm({ ...base, lifespanSeconds: undefined }).ok).toBe(false);
  });

  it('measures the window from when the post went up', () => {
    const postedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: 3600, postedAt });
    expect(result.ok).toBe(true);
    // 10 minutes of the hour are already spent, so ~50 remain.
    const remainingMin = (new Date(result.value.checkAt).getTime() - Date.now()) / 60000;
    expect(remainingMin).toBeGreaterThan(48);
    expect(remainingMin).toBeLessThan(51);
  });

  it('falls back to now when the post is older than its own window', () => {
    // A scheduled post published hours late must not arrive already due —
    // that would delete it before anyone saw it.
    const postedAt = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: 3600, postedAt });
    expect(result.ok).toBe(true);
    const remainingMin = (new Date(result.value.checkAt).getTime() - Date.now()) / 60000;
    expect(remainingMin).toBeGreaterThan(58);
  });

  it('ignores a postedAt in the future', () => {
    const postedAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: 1800, postedAt });
    const remainingMin = (new Date(result.value.checkAt).getTime() - Date.now()) / 60000;
    expect(remainingMin).toBeLessThan(31);
    expect(remainingMin).toBeGreaterThan(28);
  });

  it('carries the rest of a thread, dropping a repeat of the root', () => {
    const result = validateArm({
      ...base,
      extraUris: [uriFor(DID, '3kabc'), uriFor(DID, '3kdef'), uriFor(DID, '3kghi')],
    });
    expect(result.ok).toBe(true);
    expect(result.value.extraUris.map((e) => e.rkey)).toEqual(['3kdef', '3kghi']);
  });

  it('refuses a thread record in another repo, or in another collection', () => {
    expect(validateArm({ ...base, extraUris: [uriFor(OTHER, '3kdef')] }).ok).toBe(false);
    expect(validateArm({ ...base, extraUris: [uriFor(DID, '3kdef', 'app.bsky.feed.repost')] }).ok).toBe(false);
    expect(validateArm({ ...base, extraUris: ['nonsense'] }).ok).toBe(false);
  });

  // ── A pinned deadline ──────────────────────────────────────────────────────
  // The custom option sends an instant instead of a duration. The floor is what
  // matters here: a post that publishes after its own deadline must not be due
  // the moment it exists.

  it('uses a pinned deadline as the deadline, and keeps the window it was sent', () => {
    const deleteAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: 2 * 3600, deleteAt });
    expect(result.ok).toBe(true);
    expect(result.value.checkAt).toBe(deleteAt);
    // The window an 'extend' spare hands back is the one the author was shown,
    // exactly as the composer measured it. Re-deriving it here would subtract
    // however long publishing took: a ten-minute timer stored as eight and a
    // half, and an extend handing back the latency instead of the promise.
    expect(result.value.lifespanSeconds).toBe(2 * 3600);
  });

  it('does not let publish latency eat into the window a deadline was given', () => {
    // Posted 96 seconds ago against a deadline 10 minutes out from when the
    // author set it. The deadline still lands where they put it; the window an
    // extend would grant is still the ten minutes they asked for.
    const postedAt = new Date(Date.now() - 96 * 1000).toISOString();
    const deleteAt = new Date(Date.now() + 504 * 1000).toISOString();
    const result = validateArm({ ...base, postedAt, lifespanSeconds: 600, deleteAt });
    expect(result.ok).toBe(true);
    expect(result.value.checkAt).toBe(deleteAt);
    expect(result.value.lifespanSeconds).toBe(600);
  });

  it('never lets a deadline make a post due on arrival', () => {
    // A scheduled post that published an hour after its own deadline. Deleting
    // it immediately would take it down before anyone saw it.
    const postedAt = new Date(Date.now() - 60 * 1000).toISOString();
    const deleteAt = new Date(Date.now() - 3600 * 1000).toISOString();
    const result = validateArm({ ...base, postedAt, deleteAt });
    expect(result.ok).toBe(true);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    // The floor is measured from when the post went up, so a little of it is
    // already spent — but the post still stands, and stands for minutes.
    expect(fromNow).toBeGreaterThan(MIN_LIFESPAN_SECONDS - 120);
    // The floor moves the deadline, not the window. What an extend would hand
    // back is still what the author asked for — a post rescued from its own
    // late publish should not also have its second chance cut to five minutes.
    expect(result.value.lifespanSeconds).toBe(3600);
  });

  // ── The floor is measured from NOW ─────────────────────────────────────────
  // postedAt is a claim about the past — a scheduled slot, a device's clock —
  // and can be most of a window stale. Measured from it, a fifteen-minute
  // timer on a post that went out fourteen minutes late was due in a minute.

  it('never lets a duration fall due sooner than the floor from now', () => {
    const postedAt = new Date(Date.now() - 14 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, postedAt, lifespanSeconds: 15 * 60 });
    expect(result.ok).toBe(true);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThanOrEqual(MIN_LIFESPAN_SECONDS - 1);
    // The floor moves the deadline, not the window.
    expect(result.value.lifespanSeconds).toBe(15 * 60);
  });

  it('never lets a pinned deadline fall due sooner than the floor from now', () => {
    // Posted 14 minutes ago with a deadline one minute out: five from now, not one.
    const postedAt = new Date(Date.now() - 14 * 60 * 1000).toISOString();
    const deleteAt = new Date(Date.now() + 60 * 1000).toISOString();
    const result = validateArm({ ...base, postedAt, lifespanSeconds: 15 * 60, deleteAt });
    expect(result.ok).toBe(true);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThanOrEqual(MIN_LIFESPAN_SECONDS - 1);
  });

  it('leaves a duration that is already past the floor alone', () => {
    const postedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, postedAt, lifespanSeconds: 3600 });
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThan(3600 - 125);
    expect(fromNow).toBeLessThan(3600 - 115);
  });

  // ── A deadline already gone, from the composer ────────────────────────────

  it('refuses, from the composer, a deadline already more than a minute gone', () => {
    const deleteAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, deleteAt }, { refusePastDeadline: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already passed/);
  });

  it('still floors, from the composer, a deadline only seconds gone', () => {
    // The round trip between the composer reading the clock and the arm.
    const deleteAt = new Date(Date.now() - 30 * 1000).toISOString();
    const result = validateArm({ ...base, deleteAt }, { refusePastDeadline: true });
    expect(result.ok).toBe(true);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThanOrEqual(MIN_LIFESPAN_SECONDS - 1);
  });

  it('still takes, from the composer, a deadline in the near future and floors it', () => {
    const deleteAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, deleteAt }, { refusePastDeadline: true });
    expect(result.ok).toBe(true);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThanOrEqual(MIN_LIFESPAN_SECONDS - 1);
    expect(fromNow).toBeLessThan(MIN_LIFESPAN_SECONDS + 5);
  });

  it('arms a long-gone deadline when nobody asked it to refuse (the publish worker)', () => {
    const deleteAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect(validateArm({ ...base, deleteAt }).ok).toBe(true);
  });

  // ── A pinned deadline the post missed, at the publish worker ──────────────
  // Flooring to five minutes was the only fallback, so a queued post moved
  // past its own delete time vanished five minutes after it went out. The
  // worker now falls back to the window the writer was shown.

  it('falls back to the window the writer was shown when the pin was missed before publish', () => {
    // Published now; the pin went by fifteen hours ago; a nine-hour window.
    const deleteAt = new Date(Date.now() - 15 * 3600 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: 9 * 3600, deleteAt, postedAt: new Date().toISOString() });
    expect(result.ok).toBe(true);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThan(9 * 3600 - 5);
    expect(fromNow).toBeLessThanOrEqual(9 * 3600 + 1);
    expect(result.value.deadlineMissed).toBe(true);
    expect(result.value.note).toMatch(/had passed before this post went out/);
  });

  it('treats a pin inside the first five minutes as missed too', () => {
    const deleteAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: 3600, deleteAt, postedAt: new Date().toISOString() });
    expect(result.value.deadlineMissed).toBe(true);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThan(3600 - 5);
  });

  it('keeps a pin the post has not missed, and says nothing', () => {
    const deleteAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: 3 * 3600, deleteAt, postedAt: new Date().toISOString() });
    expect(result.value.checkAt).toBe(deleteAt);
    expect(result.value.deadlineMissed).toBe(false);
    expect(result.value.note).toBeNull();
  });

  it('still floors a near pin from the composer, as before', () => {
    // The author is at the keyboard and picked a time three minutes out.
    const deleteAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: 3600, deleteAt }, { refusePastDeadline: true });
    expect(result.value.deadlineMissed).toBe(false);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeLessThan(MIN_LIFESPAN_SECONDS + 5);
  });

  it('never lets the window fallback come sooner than the floor', () => {
    // A post claimed to have gone up long ago with a short window: the window
    // is spent, so the floor decides.
    const postedAt = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    const deleteAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const result = validateArm({ ...base, lifespanSeconds: MIN_LIFESPAN_SECONDS, postedAt, deleteAt });
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThanOrEqual(MIN_LIFESPAN_SECONDS - 1);
  });

  it('refuses a deadline past the ceiling, or one it cannot read', () => {
    expect(validateArm({ ...base, deleteAt: new Date(Date.now() + 40 * 86400 * 1000).toISOString() }).ok).toBe(false);
    expect(validateArm({ ...base, deleteAt: 'next Thursday-ish' }).ok).toBe(false);
  });

  it('ignores an absent deadline and uses the duration', () => {
    const result = validateArm({ ...base, deleteAt: null });
    expect(result.ok).toBe(true);
    const fromNow = (new Date(result.value.checkAt).getTime() - Date.now()) / 1000;
    expect(fromNow).toBeGreaterThan(3595);
  });

  it('truncates the snippet rather than storing the whole post', () => {
    const result = validateArm({ ...base, snippet: 'x'.repeat(500) });
    expect(result.value.snippet).toHaveLength(200);
  });
});

describe('normalizeConditions', () => {
  it('drops a clause that says nothing', () => {
    // "Keep it if it reaches zero likes" is true of every post ever written,
    // which is not what leaving a box empty means.
    const c = normalizeConditions({ clauses: [{ metric: 'likes', value: 0 }, { metric: 'replies' }] });
    expect(c.clauses).toEqual([]);
    expect(hasClauses(c)).toBe(false);
  });

  it('reads the pre-clause shape that is already on people’s PDSes', () => {
    // Posting settings records written before clauses existed. Not optional.
    const c = normalizeConditions({ mode: 'all', minLikes: 5, minReplies: 2, onSpare: 'extend', maxExtensions: 3 });
    expect(c.logic).toBe('all');
    expect(c.sense).toBe('unless');
    expect(c.clauses).toEqual([
      { metric: 'likes', op: 'gte', value: 5 },
      { metric: 'replies', op: 'gte', value: 2 },
    ]);
    expect(c.maxExtensions).toBe(3);
  });

  it('keeps one clause per metric and orders them the way the editor lists them', () => {
    const c = normalizeConditions({ clauses: [
      { metric: 'quotes', op: 'gt', value: 5 },
      { metric: 'likes', op: 'gte', value: 1 },
      { metric: 'quotes', op: 'gte', value: 99 },
    ] });
    expect(c.clauses.map((x) => x.metric)).toEqual(['likes', 'quotes']);
    expect(c.clauses.find((x) => x.metric === 'quotes').value).toBe(5);
  });

  it('falls back to the safe reading of anything it does not recognise', () => {
    expect(normalizeConditions({ logic: 'whenever' }).logic).toBe('any');
    expect(normalizeConditions({ sense: 'maybe' }).sense).toBe('unless');
    expect(normalizeConditions({ clauses: [{ metric: 'vibes', value: 3 }] }).clauses).toEqual([]);
    expect(normalizeConditions({ clauses: [{ metric: 'likes', op: 'lt', value: 3 }] }).clauses[0].op).toBe('gte');
    expect(normalizeConditions(null).onSpare).toBe('keep');
  });

  it('bounds an extend rule', () => {
    expect(normalizeConditions({ onSpare: 'extend' }).maxExtensions).toBe(1);
    expect(normalizeConditions({ onSpare: 'extend', maxExtensions: 999 }).maxExtensions).toBe(10);
  });

  it('knows which clauses need the thread rather than the counters', () => {
    // A plain likes rule must not pay for a getPostThread call.
    expect(needsThread({ clauses: [{ metric: 'likes', value: 5 }] })).toBe(false);
    expect(needsThread({ clauses: [{ metric: 'selfReplies', value: 1 }] })).toBe(true);
  });
});

describe('evaluateConditions', () => {
  const counts = { likes: 5, replies: 2, reposts: 1, quotes: 6, selfReplies: 0 };

  it('never spares a timer with nothing to clear', () => {
    expect(evaluateConditions({}, { likes: 500 }).spare).toBe(false);
  });

  it('honours the operator', () => {
    expect(evaluateConditions({ clauses: [{ metric: 'likes', op: 'gte', value: 5 }] }, counts).matched).toBe(true);
    // The whole point of gt: five likes is not more than five.
    expect(evaluateConditions({ clauses: [{ metric: 'likes', op: 'gt', value: 5 }] }, counts).matched).toBe(false);
    expect(evaluateConditions({ clauses: [{ metric: 'quotes', op: 'gt', value: 5 }] }, counts).matched).toBe(true);
  });

  it("'any' takes one, 'all' takes every one", () => {
    const clauses = [{ metric: 'likes', value: 5 }, { metric: 'replies', value: 9 }];
    expect(evaluateConditions({ logic: 'any', clauses }, counts).matched).toBe(true);
    expect(evaluateConditions({ logic: 'all', clauses }, counts).matched).toBe(false);
  });

  it('the sense decides what a match costs the post', () => {
    const clauses = [{ metric: 'replies', op: 'gt', value: 5 }];
    const busy = { replies: 9 };
    const quiet = { replies: 1 };
    // "delete it only if more than 5 replies" — the example this was built for.
    expect(evaluateConditions({ sense: 'onlyIf', clauses }, busy).spare).toBe(false);
    expect(evaluateConditions({ sense: 'onlyIf', clauses }, quiet).spare).toBe(true);
    // The same clause read the other way keeps the busy post instead.
    expect(evaluateConditions({ sense: 'unless', clauses }, busy).spare).toBe(true);
    expect(evaluateConditions({ sense: 'unless', clauses }, quiet).spare).toBe(false);
  });

  it('reads quotes on their own, not as reposts', () => {
    const clauses = [{ metric: 'reposts', value: 5 }];
    // Six quotes and one repost must not read as seven reposts.
    expect(evaluateConditions({ clauses }, counts).matched).toBe(false);
  });

  it('counts the author’s own replies when asked', () => {
    const clauses = [{ metric: 'selfReplies', value: 1 }];
    expect(evaluateConditions({ clauses }, { selfReplies: 0 }).spare).toBe(false);
    expect(evaluateConditions({ clauses }, { selfReplies: 2 }).spare).toBe(true);
  });

  it('says why, in words the row can carry', () => {
    // The sentence is what the timers page shows and what the row keeps, so a
    // 'gt' clause has to read as the author wrote it: "more than 5", not "5".
    expect(evaluateConditions({ clauses: [{ metric: 'replies', value: 1 }] }, { replies: 3 }).reason)
      .toBe('matched with 3 replies');
    expect(evaluateConditions({ clauses: [{ metric: 'likes', value: 5 }] }, { likes: 2 }).reason)
      .toBe('below 2 of 5 likes');
  });
});

describe('countsFromPostView', () => {
  it('reads the AppView’s counters', () => {
    expect(countsFromPostView({ likeCount: 4, replyCount: 1, repostCount: 2, quoteCount: 3 }))
      .toEqual({ likes: 4, replies: 1, reposts: 2, quotes: 3, selfReplies: 0 });
  });

  it('reads a real zero as a zero', () => {
    // The reference AppView sends every count on every post, zeros included.
    // Those are answers, and a rule is allowed to act on them.
    expect(countsFromPostView({ likeCount: 0, replyCount: 0, repostCount: 0, quoteCount: 0 }))
      .toEqual({ likes: 0, replies: 0, reposts: 0, quotes: 0, selfReplies: 0 });
  });

  it('marks a count the AppView never sent, rather than calling it zero', () => {
    // Every count on app.bsky.feed.defs#postView is optional. An answer that
    // omits one is silence; reading it as zero is what deletes a post that was
    // quoted. resolveSelfDestruct refuses to fire on a metric listed here.
    expect(countsFromPostView({ likeCount: 2 }).__absent)
      .toEqual(['replies', 'reposts', 'quotes']);
    expect(countsFromPostView({}).__absent).toEqual(['likes', 'replies', 'reposts', 'quotes']);
    expect(countsFromPostView(null).__absent).toEqual(['likes', 'replies', 'reposts', 'quotes']);
    // Still zeros for anything that reads them positionally.
    expect(countsFromPostView({}).likes).toBe(0);
  });

  it('uses one definition of readable for the value and for presence', () => {
    // A numeric string reads perfectly through Number(), so it is an answer.
    // Testing presence with `typeof === 'number'` while reading the value with
    // Number() marked such a count BOTH stored and missing, and the rule was
    // then held back forever on a number it actually had.
    const c = countsFromPostView({ likeCount: '4', replyCount: 0, repostCount: 2, quoteCount: 3 });
    expect(c.likes).toBe(4);
    expect(c).not.toHaveProperty('__absent');
  });

  it('counts null and empty string as silence, not as zero', () => {
    const c = countsFromPostView({ likeCount: null, replyCount: '', repostCount: 2, quoteCount: 3 });
    expect(c.__absent).toEqual(['likes', 'replies']);
    expect(c.likes).toBe(0);
  });

  it('counts an unreadable value as silence too', () => {
    expect(countsFromPostView({ likeCount: 'lots', replyCount: 1, repostCount: 1, quoteCount: 1 }).__absent)
      .toEqual(['likes']);
  });

  it('leaves the marker off entirely when every count arrived', () => {
    expect(countsFromPostView({ likeCount: 0, replyCount: 0, repostCount: 0, quoteCount: 0 }))
      .not.toHaveProperty('__absent');
  });

  it('is invisible to the evaluator, like __truncated', () => {
    // readCounts skips __-prefixed keys, so the marker cannot be mistaken for
    // a metric of its own.
    const counts = countsFromPostView({ likeCount: 9 });
    const conditions = normalizeConditions({ mode: 'any', sense: 'unless', clauses: [{ metric: 'likes', value: 5 }] });
    expect(evaluateConditions(conditions, counts).spare).toBe(true);
  });

  it('keeps quotes apart from reposts', () => {
    // They were folded together at first. A post quoted five times is a
    // different social event from one reposted five times.
    const c = countsFromPostView({ repostCount: 2, quoteCount: 1 });
    expect(c.reposts).toBe(2);
    expect(c.quotes).toBe(1);
  });
});

describe('unreportedMetricsFor', () => {
  const conds = (clauses) => normalizeConditions({ mode: 'any', sense: 'unless', clauses });

  it('holds back a rule whose metric the AppView never sent', () => {
    const counts = countsFromPostView({ likeCount: 3, repostCount: 1, quoteCount: 0 }); // no replyCount
    expect(unreportedMetricsFor(conds([{ metric: 'replies', value: 2 }]), counts)).toEqual(['replies']);
  });

  it('says nothing about a metric no clause depends on', () => {
    const counts = countsFromPostView({ likeCount: 3, repostCount: 1, quoteCount: 0 });
    expect(unreportedMetricsFor(conds([{ metric: 'likes', value: 2 }]), counts)).toEqual([]);
  });

  it('leaves a FILTERED clause alone, whose number came from its own walk', () => {
    // What this stops: a clause about "quotes from people I
    // don't follow" reads counts['quotes|any|notFollowed'], worked out by
    // readFilteredQuotes from a complete getQuotes walk. It never looks at
    // counts.quotes, so an absent quoteCount says nothing about it — and
    // blocking on it would hold the rule back every run until the row died.
    const counts = countsFromPostView({ likeCount: 3, replyCount: 1, repostCount: 1 }); // no quoteCount
    expect(counts.__absent).toEqual(['quotes']);
    const filtered = conds([
      { metric: 'quotes', value: 3, from: { match: 'any', notFollowed: true, followersOver: null } },
    ]);
    expect(unreportedMetricsFor(filtered, counts)).toEqual([]);
  });

  it('still holds back an UNfiltered quotes clause on the same counts', () => {
    const counts = countsFromPostView({ likeCount: 3, replyCount: 1, repostCount: 1 });
    expect(unreportedMetricsFor(conds([{ metric: 'quotes', value: 3 }]), counts)).toEqual(['quotes']);
  });

  it('is quiet when every count arrived', () => {
    const counts = countsFromPostView({ likeCount: 0, replyCount: 0, repostCount: 0, quoteCount: 0 });
    expect(unreportedMetricsFor(conds([{ metric: 'quotes', value: 3 }]), counts)).toEqual([]);
  });
});

describe('classifyFailure', () => {
  it('prefers a code the error already carries', () => {
    expect(classifyFailure({ code: 'SESSION_UNAVAILABLE' })).toBe('SESSION_UNAVAILABLE');
    expect(classifyFailure({ code: 'NOT_A_REAL_CODE' })).toBe('UNKNOWN');
  });

  it('reads an XRPC error’s own status and name', () => {
    expect(classifyFailure({ status: 429 })).toBe('RATE_LIMITED');
    expect(classifyFailure({ error: 'ExpiredToken' })).toBe('SESSION_UNAVAILABLE');
    expect(classifyFailure({ status: 400 })).toBe('REFUSED');
  });

  it('falls back to reading our own sentences', () => {
    expect(classifyFailure("couldn't read the counts for this post, so it was left up."))
      .toBe('ENGAGEMENT_UNAVAILABLE');
    expect(classifyFailure('the timer ran out of time before this post could be checked.'))
      .toBe('TIMED_OUT');
    expect(classifyFailure(null)).toBe('UNKNOWN');
  });
});

describe('snippetFromScheduledPayload', () => {
  it('takes the first post’s text, truncated', () => {
    expect(snippetFromScheduledPayload({ posts: [{ record: { text: 'hello' } }] })).toBe('hello');
    expect(snippetFromScheduledPayload({ posts: [{ record: { text: 'y'.repeat(400) } }] })).toHaveLength(200);
  });

  it('says nothing when there is nothing to say', () => {
    expect(snippetFromScheduledPayload({})).toBeNull();
    expect(snippetFromScheduledPayload(null)).toBeNull();
  });
});

// ── Threads that grow after the timer is armed ───────────────────────────────
// extra_uris is the thread as it stood when the timer was set, which for a post
// published from the composer is the thread as written. A self-reply added an
// hour later is not in there, and deleting the root without it leaves exactly
// the orphan the feature promises not to leave.

describe('collectThreadRecords', () => {
  const row = {
    user_did: DID,
    post_uri: uriFor(DID, 'root'),
    collection: 'app.bsky.feed.post',
    rkey: 'root',
    extra_uris: [{ uri: uriFor(DID, 'two'), collection: 'app.bsky.feed.post', rkey: 'two' }],
  };

  it('carries the thread as armed, plus what was added since', async () => {
    const parts = await collectThreadRecords(row, { selfReplyUris: [uriFor(DID, 'three')] });
    expect(parts.map((p) => p.rkey)).toEqual(['two', 'three']);
  });

  it('never names the root twice, however it arrives', async () => {
    const parts = await collectThreadRecords(row, {
      selfReplyUris: [uriFor(DID, 'root'), uriFor(DID, 'two'), uriFor(DID, 'three')],
    });
    expect(parts.map((p) => p.rkey)).toEqual(['two', 'three']);
  });

  it('refuses a URI that is not in this repo', async () => {
    // The thread read is a public call, so someone else's reply comes back in
    // it. Only the author's own records are ever deleted.
    const parts = await collectThreadRecords(row, {
      selfReplyUris: [uriFor(OTHER, 'theirs'), uriFor(DID, 'three')],
    });
    expect(parts.map((p) => p.rkey)).toEqual(['two', 'three']);
  });

  it('still takes down what the row names when nothing was added', async () => {
    const parts = await collectThreadRecords(row, { selfReplyUris: [] });
    expect(parts.map((p) => p.rkey)).toEqual(['two']);
  });
});

// ─── Effects ────────────────────────────────────────────────────────────────

describe('normalizeEffects', () => {
  it('reads an absent list as delete', () => {
    // What every row written before effects existed meant, and the only
    // outcome the feature had.
    expect(normalizeEffects(undefined)).toEqual([{ action: 'delete' }]);
    expect(normalizeEffects([])).toEqual([{ action: 'delete' }]);
    expect(normalizeEffects('nonsense')).toEqual([{ action: 'delete' }]);
  });

  it('drops actions it does not know', () => {
    expect(normalizeEffects([{ action: 'launchMissiles' }])).toEqual([{ action: 'delete' }]);
  });

  it('defaults limitReplies to followers', () => {
    expect(normalizeEffects([{ action: 'limitReplies' }]))
      .toEqual([{ action: 'limitReplies', allow: ['follower'] }]);
  });

  it('keeps an empty allow list, which means nobody', () => {
    // Distinct from an absent one: [] is the strictest gate there is, and
    // defaulting it to followers would quietly loosen what was asked for.
    expect(normalizeEffects([{ action: 'limitReplies', allow: [] }]))
      .toEqual([{ action: 'limitReplies', allow: [] }]);
  });

  it('puts deletion last however it was written', () => {
    const effects = normalizeEffects([
      { action: 'delete' },
      { action: 'limitReplies', allow: ['follower'] },
      { action: 'disableQuotes' },
    ]);
    expect(effects.map((e) => e.action)).toEqual(['limitReplies', 'disableQuotes', 'delete']);
  });

  it('never lists the same action twice', () => {
    const effects = normalizeEffects([{ action: 'disableQuotes' }, { action: 'disableQuotes' }]);
    expect(effects).toEqual([{ action: 'disableQuotes' }]);
  });

  it('carries list entries by URI, deduped and stripped of client-side names', () => {
    const moots = 'at://did:plc:someone/app.bsky.graph.list/3kmoots';
    const effects = normalizeEffects([{
      action: 'limitReplies',
      allow: ['follower', { list: moots, name: 'Moots' }, { list: moots }, { list: 'not-a-list' }],
    }]);
    expect(effects).toEqual([{ action: 'limitReplies', allow: ['follower', { list: moots }] }]);
  });
});

describe('narrowAllow', () => {
  const FOLLOWER = 'app.bsky.feed.threadgate#followerRule';
  const FOLLOWING = 'app.bsky.feed.threadgate#followingRule';
  const MENTION = 'app.bsky.feed.threadgate#mentionRule';

  const LIST = 'app.bsky.feed.threadgate#listRule';
  const moots = 'at://did:plc:someone/app.bsky.graph.list/3kmoots';

  it('writes what was asked for when there is no gate', () => {
    expect(narrowAllow(['follower'], undefined)).toEqual({ allow: [{ $type: FOLLOWER }] });
  });

  it('writes a list rule with its URI when there is no gate', () => {
    expect(narrowAllow([{ list: moots }], undefined))
      .toEqual({ allow: [{ $type: LIST, list: moots }] });
  });

  it('refuses to widen an existing gate', () => {
    // The whole point. A threadgate is one record per post, so writing
    // 'follower' over 'mention' would not narrow anything — it would open the
    // replies to every follower.
    const result = narrowAllow(['follower'], [{ $type: MENTION }]);
    expect(result.skip).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/opened them up/);
  });

  it('keeps only the rules both agree on', () => {
    const result = narrowAllow(['follower'], [{ $type: FOLLOWER }, { $type: FOLLOWING }]);
    expect(result.allow).toEqual([{ $type: FOLLOWER }]);
  });

  it('two list rules only agree when they point at the same list', () => {
    const other = 'at://did:plc:someone/app.bsky.graph.list/3kother';
    const kept = narrowAllow([{ list: moots }], [{ $type: LIST, list: moots }, { $type: FOLLOWING }]);
    expect(kept.allow).toEqual([{ $type: LIST, list: moots }]);

    const refused = narrowAllow([{ list: moots }], [{ $type: LIST, list: other }]);
    expect(refused.skip).toBe(true);
    expect(refused.ok).toBe(false);
  });

  it('says so rather than rewriting an identical gate', () => {
    const result = narrowAllow(['follower'], [{ $type: FOLLOWER }]);
    expect(result).toEqual({ skip: true, ok: true, detail: 'replies were already limited this way' });
  });

  it('leaves a gate that already closed replies to everyone', () => {
    const result = narrowAllow(['follower'], []);
    expect(result.skip).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('lets "nobody" through whatever was there', () => {
    // Closing replies to nobody is the strictest setting, so it narrows
    // anything it lands on and never has to be intersected.
    expect(narrowAllow([], [{ $type: MENTION }])).toEqual({ allow: [] });
  });
});

// ─── Who the count is about ─────────────────────────────────────────────────

describe('normalizeActorFilter', () => {
  it('reads a filter that tests nothing as no filter', () => {
    // It would silently count everyone while reading as though it were doing
    // something, which is the worst of both.
    expect(normalizeActorFilter({})).toBeNull();
    expect(normalizeActorFilter({ notFollowed: false })).toBeNull();
    expect(normalizeActorFilter(null)).toBeNull();
  });

  it('keeps the two tests and how they combine', () => {
    expect(normalizeActorFilter({ notFollowed: true, followersOver: 10000, match: 'all' }))
      .toEqual({ match: 'all', notFollowed: true, followersOver: 10000 });
  });

  it('defaults to either test being enough', () => {
    expect(normalizeActorFilter({ notFollowed: true }).match).toBe('any');
  });
});

describe('normalizeConditions with a filter', () => {
  it('keeps a filter on a metric that can carry one', () => {
    const c = normalizeConditions({ clauses: [{ metric: 'quotes', value: 10, from: { notFollowed: true } }] });
    expect(c.clauses[0].from).toEqual({ match: 'any', notFollowed: true, followersOver: null });
  });

  it('drops a filter on a metric that cannot', () => {
    // getQuotes hands back the quoting posts with their authors. A like count
    // is a number with nobody attached, so "likes from strangers" would be a
    // promise the reader could not keep.
    const c = normalizeConditions({ clauses: [{ metric: 'likes', value: 5, from: { notFollowed: true } }] });
    expect(c.clauses[0].from).toBeUndefined();
  });
});

describe('clauseCountKey', () => {
  it('leaves an unfiltered clause reading its own metric', () => {
    expect(clauseCountKey({ metric: 'quotes', op: 'gte', value: 5 })).toBe('quotes');
  });

  it('gives two different filters two different keys', () => {
    const a = clauseCountKey({ metric: 'quotes', from: { match: 'any', notFollowed: true, followersOver: null } });
    const b = clauseCountKey({ metric: 'quotes', from: { match: 'any', notFollowed: false, followersOver: 10000 } });
    expect(a).not.toBe(b);
    expect(a).not.toBe('quotes');
  });

  it('gives two clauses asking the same thing one key, so the read is shared', () => {
    const f = { match: 'any', notFollowed: true, followersOver: null };
    expect(clauseCountKey({ metric: 'quotes', from: { ...f } }))
      .toBe(clauseCountKey({ metric: 'quotes', from: { ...f } }));
  });
});

describe('evaluateConditions with a filtered clause', () => {
  const conditions = {
    sense: 'onlyIf',
    clauses: [{ metric: 'quotes', op: 'gte', value: 10, from: { notFollowed: true } }],
  };
  const key = clauseCountKey(normalizeConditions(conditions).clauses[0]);

  it('reads the filtered count, not the plain one', () => {
    // 40 quotes, but only 3 from strangers. The rule is about the 3.
    const verdict = evaluateConditions(conditions, { quotes: 40, [key]: 3 });
    expect(verdict.matched).toBe(false);
    expect(verdict.spare).toBe(true);
  });

  it('fires on the filtered count', () => {
    const verdict = evaluateConditions(conditions, { quotes: 40, [key]: 12 });
    expect(verdict.matched).toBe(true);
    expect(verdict.spare).toBe(false);
    expect(verdict.reason).toMatch(/from people you don't follow/);
  });

  it('refuses to answer when the filtered count was never worked out', () => {
    // Zero would answer "no" to a question nobody asked, and the plain count is
    // always the larger number. Which direction either errs in depends on the
    // sense, so neither is safe: this has to be a retry.
    expect(() => evaluateConditions(conditions, { quotes: 40 })).toThrow(/couldn't work out/);
  });

  it('still reads a plain clause when a filtered one sits beside it', () => {
    const both = {
      sense: 'onlyIf',
      logic: 'all',
      clauses: [
        { metric: 'likes', op: 'gte', value: 5 },
        { metric: 'quotes', op: 'gte', value: 10, from: { notFollowed: true } },
      ],
    };
    const filteredKey = clauseCountKey(normalizeConditions(both).clauses[1]);
    expect(evaluateConditions(both, { likes: 6, quotes: 40, [filteredKey]: 12 }).matched).toBe(true);
    expect(evaluateConditions(both, { likes: 2, quotes: 40, [filteredKey]: 12 }).matched).toBe(false);
  });
});

describe('the shortfall sentence', () => {
  it('reads a "more than" clause the way it was written', () => {
    const verdict = evaluateConditions(
      { clauses: [{ metric: 'replies', op: 'gt', value: 5 }] },
      { replies: 2 }
    );
    expect(verdict.reason).toBe('below 2 of more than 5 replies');
  });

  it('names who a filtered clause was about', () => {
    // "3 of 10 quotes" alone would look like the post's quote count, which is
    // a different and larger number.
    const conditions = {
      clauses: [{ metric: 'quotes', op: 'gte', value: 10, from: { notFollowed: true, followersOver: 10000 } }],
    };
    const key = clauseCountKey(normalizeConditions(conditions).clauses[0]);
    const verdict = evaluateConditions(conditions, { quotes: 40, [key]: 3 });
    expect(verdict.reason).toBe("below 3 of 10 quotes from people you don't follow or with over 10,000 followers");
  });
});
