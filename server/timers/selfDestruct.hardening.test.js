import { describe, it, expect } from 'vitest';
import * as selfDestruct from './selfDestruct.js';

// The validation boundaries of a timer: the strict effects/conditions parsers
// (an unknown rule must be refused, never silently replaced with delete), the
// replies-needs-thread rule, and thread coverage that is refused rather than
// sliced. The scheduler's own spec validation is tested beside it.

describe('parseEffects (strict arm-time reading)', () => {
  const { parseEffects } = selfDestruct;

  it('absent still means delete — the original vocabulary, not an unknown one', () => {
    expect(parseEffects(undefined).value).toEqual([{ action: 'delete' }]);
    expect(parseEffects(null).value).toEqual([{ action: 'delete' }]);
    expect(parseEffects([]).value).toEqual([{ action: 'delete' }]);
  });

  it('passes known effects through with their allow lists intact', () => {
    const res = parseEffects([{ action: 'limitReplies', allow: [] }]);
    expect(res.value).toEqual([{ action: 'limitReplies', allow: [] }]);
  });

  it('refuses an unknown action rather than substituting delete', () => {
    expect(parseEffects([{ action: 'archive' }]).error).toBeTruthy();
    expect(parseEffects([{ action: 'limitReplies' }, { action: 'petrify' }]).error).toBeTruthy();
    expect(parseEffects('delete').error).toBeTruthy();
  });
});

describe('parseConditions (strict arm-time reading)', () => {
  const { parseConditions } = selfDestruct;

  it('legacy minLikes/minReplies/minReposts still pass', () => {
    const res = parseConditions({ minLikes: 5, mode: 'all' });
    expect(res.error).toBeUndefined();
    expect(res.value.clauses).toEqual([{ metric: 'likes', op: 'gte', value: 5 }]);
    expect(res.value.logic).toBe('all');
  });

  it('refuses a clause it cannot read instead of silently deleting unconditionally', () => {
    expect(parseConditions({ clauses: [{ metric: 'vibes', value: 5 }] }).error).toBeTruthy();
    expect(parseConditions({ clauses: [{ metric: 'likes', value: 0 }] }).error).toBeTruthy();
    expect(parseConditions({ sense: 'maybe' }).error).toBeTruthy();
    expect(parseConditions({ logic: 'most' }).error).toBeTruthy();
  });

  it('refuses a who-filter that normalizes away — it would widen the rule', () => {
    const res = parseConditions({ clauses: [{ metric: 'quotes', value: 5, from: { match: 'any' } }] });
    expect(res.error).toBeTruthy();
  });

  it('refuses more filtered clauses than the evaluator will ever compute', () => {
    const res = parseConditions({
      clauses: [
        { metric: 'quotes', value: 5, from: { notFollowed: true } },
        { metric: 'quotes', value: 5, from: { followersOver: 100 } },
        { metric: 'quotes', value: 5, from: { followersOver: 200 } },
      ],
    });
    expect(res.error).toMatch(/particular people/);
  });
});

describe('validateArm strictness', () => {
  const arm = (extra) => selfDestruct.validateArm({
    userDid: 'did:plc:someone',
    postUri: 'at://did:plc:someone/app.bsky.feed.post/3kabc',
    lifespanSeconds: 3600,
    ...extra,
  });

  it('still arms a plain timer', () => {
    const res = arm({});
    expect(res.ok).toBe(true);
    expect(res.value.effects).toEqual([{ action: 'delete' }]);
  });

  it('refuses unknown effects at arm time', () => {
    const res = arm({ effects: [{ action: 'archive' }] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not know how to do/);
  });

  it('refuses unreadable conditions at arm time', () => {
    const res = arm({ conditions: { clauses: [{ metric: 'vibes', value: 3 }] } });
    expect(res.ok).toBe(false);
  });
});

describe('needsThread covers the replies counter', () => {
  it('a replies clause needs the thread, to subtract the author\'s own continuations', () => {
    expect(selfDestruct.needsThread({ clauses: [{ metric: 'replies', value: 1 }] })).toBe(true);
    expect(selfDestruct.needsThread({ clauses: [{ metric: 'selfReplies', value: 1 }] })).toBe(true);
    expect(selfDestruct.needsThread({ clauses: [{ metric: 'likes', value: 5 }] })).toBe(false);
  });
});

describe('thread-timer coverage is refused, never sliced', () => {
  const uris = (n) => Array.from({ length: n }, (_, i) => `at://did:plc:someone/app.bsky.feed.post/3k${i.toString(36).padStart(4, '0')}`);
  const arm = (extraUris) => selfDestruct.validateArm({
    userDid: 'did:plc:someone',
    postUri: 'at://did:plc:someone/app.bsky.feed.post/3kroot',
    lifespanSeconds: 3600,
    extraUris,
  });

  it('covers a long thread whole', () => {
    const res = arm(uris(100));
    expect(res.ok).toBe(true);
    expect(res.value.extraUris).toHaveLength(100);
  });

  it('refuses a thread it cannot cover whole — silent partial coverage orphans the tail', () => {
    const res = arm(uris(101));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at most 101 posts/);
  });
});

describe('parseEffects with list allow entries', () => {
  const { parseEffects } = selfDestruct;
  const moots = 'at://did:plc:someone/app.bsky.graph.list/3kmoots';

  it('accepts list entries, with or without the client-side name', () => {
    expect(parseEffects([{ action: 'limitReplies', allow: [{ list: moots }] }]).error).toBeUndefined();
    expect(parseEffects([{ action: 'limitReplies', allow: ['follower', { list: moots, name: 'Moots' }] }]).error).toBeUndefined();
  });

  it('refuses an allow entry it cannot read rather than silently narrowing', () => {
    expect(parseEffects([{ action: 'limitReplies', allow: [{ list: 'not-a-list' }] }]).error).toBeTruthy();
    expect(parseEffects([{ action: 'limitReplies', allow: [{ list: 'at://did:plc:x/app.bsky.feed.post/3k' }] }]).error).toBeTruthy();
    expect(parseEffects([{ action: 'limitReplies', allow: ['strangers'] }]).error).toBeTruthy();
  });

  it('refuses more groups than a threadgate can carry', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ list: `at://did:plc:someone/app.bsky.graph.list/3k${i}` }));
    expect(parseEffects([{ action: 'limitReplies', allow: many }]).error).toMatch(/at most 5/);
  });
});
