// The checks a scheduled post passes before anything is stored: shapes, times,
// gates, card refs, timers, and the failure vocabulary the client reads.

import { describe, it, expect } from 'vitest';
import {
  normalizeAssociatedRefs,
  buildEmbed,
  validateCreate,
  validateReschedule,
  validateSelfDestructSpec,
  strandsDeleteTime,
  strandedMoveError,
  collectMediaIds,
  classifyFailure,
  normalizeFailureCode,
  reorderScheduledPosts,
  NonRetryableError,
  FAILURE_CODES,
  MAX_ASSOCIATED_REFS,
  MAX_REORDER_MOVES,
  MAX_THREAD_POSTS,
  MAX_IMAGES_PER_POST,
  MAX_HORIZON_DAYS,
  isMissingTable,
  isUndefinedFunction,
} from './scheduledPosts.js';
import { HOUR, DAY, MINUTE, iso, inHours } from './testing/fixtures.js';

const DOC = {
  $type: 'com.atproto.repo.strongRef',
  uri: 'at://did:plc:5amsebbtpuqieuxuqadmmvcv/site.standard.document/3muju36lswrxu',
  cid: 'bafyreibzez7t7ucofbp73wqbstsysr4cflap7lvnwqcggsqorbkrf3irxy',
};
const PUB = {
  $type: 'com.atproto.repo.strongRef',
  uri: 'at://did:plc:5amsebbtpuqieuxuqadmmvcv/site.standard.publication/3mqeoygevsibi',
  cid: 'bafyreidlh7pnolvy77fsuuepmzupscquzc7blduyhjm4og7n7vhok4ozd4',
};

const spec = (payloadExtra = {}, extra = {}) => ({
  scheduledFor: inHours(1),
  target: 'bluesky',
  payload: { posts: [{ record: { text: 'hello moths' } }], ...payloadExtra },
  ...extra,
});

const externalSpec = (extra) =>
  spec({
    posts: [
      {
        record: { text: 'a link' },
        embed: {
          type: 'external',
          uri: 'https://onething.pckt.blog/a-post',
          title: 'T',
          description: 'D',
          ...extra,
        },
      },
    ],
  });

describe('normalizeAssociatedRefs', () => {
  it('stamps a bare uri/cid pair as a strongRef', () => {
    expect(
      normalizeAssociatedRefs([{ uri: DOC.uri, cid: DOC.cid }, PUB]),
    ).toEqual([DOC, PUB]);
  });

  it('returns null when there is nothing worth carrying', () => {
    expect(normalizeAssociatedRefs(undefined)).toBeNull();
    expect(normalizeAssociatedRefs([])).toBeNull();
    expect(
      normalizeAssociatedRefs([{ uri: 'https://example.com', cid: 'bafy' }]),
    ).toBeNull();
    expect(normalizeAssociatedRefs([{ uri: DOC.uri }])).toBeNull();
  });

  it('de-duplicates by uri and caps the list', () => {
    expect(normalizeAssociatedRefs([DOC, { ...DOC, cid: 'other' }])).toEqual([
      DOC,
    ]);
    const many = Array.from({ length: MAX_ASSOCIATED_REFS + 2 }, (_, i) => ({
      uri: `at://did:plc:x/site.standard.document/${i}`,
      cid: `bafy${i}`,
    }));
    expect(normalizeAssociatedRefs(many)).toHaveLength(MAX_ASSOCIATED_REFS);
  });
});

describe('validateCreate', () => {
  it('normalizes a good body', () => {
    const res = validateCreate({ ...spec(), queued: 1 });
    expect(res.ok).toBe(true);
    expect(res.value).toMatchObject({
      target: 'bluesky',
      queued: true,
      gates: { threadgate: null, postgate: null },
      selfDestruct: null,
    });
    expect(res.value.scheduledFor).toMatch(/Z$/);
  });

  it('defaults the target to bluesky and refuses any other', () => {
    expect(validateCreate({ ...spec(), target: undefined }).ok).toBe(true);
    for (const target of ['other-app', 'BLUESKY', '']) {
      expect(validateCreate({ ...spec(), target })).toEqual({
        ok: false,
        error: 'target must be one of: bluesky',
      });
    }
  });

  it('applies the time guards', () => {
    expect(validateCreate({ ...spec(), scheduledFor: undefined }).error).toBe(
      'scheduledFor is required',
    );
    expect(validateCreate({ ...spec(), scheduledFor: 'soon' }).error).toBe(
      'scheduledFor is not a valid datetime',
    );
    expect(
      validateCreate({ ...spec(), scheduledFor: iso(Date.now() - MINUTE) })
        .error,
    ).toBe('scheduledFor must be in the future');
    expect(
      validateCreate({
        ...spec(),
        scheduledFor: iso(Date.now() + (MAX_HORIZON_DAYS + 1) * DAY),
      }).error,
    ).toBe('scheduledFor must be within 90 days');
    expect(
      validateCreate({
        ...spec(),
        scheduledFor: iso(Date.now() + (MAX_HORIZON_DAYS - 1) * DAY),
      }).ok,
    ).toBe(true);
  });

  it('checks the posts', () => {
    expect(validateCreate({ ...spec(), payload: null }).error).toBe(
      'payload is required',
    );
    expect(validateCreate(spec({ posts: [] })).error).toBe(
      'payload.posts must be a non-empty array',
    );
    const thread = Array.from({ length: MAX_THREAD_POSTS + 1 }, () => ({
      record: { text: 'x' },
    }));
    expect(validateCreate(spec({ posts: thread })).error).toBe(
      'a thread can have at most 25 posts',
    );
    expect(
      validateCreate(spec({ posts: thread.slice(0, MAX_THREAD_POSTS) })).ok,
    ).toBe(true);
    expect(validateCreate(spec({ posts: [{}] })).error).toBe(
      'posts[0].record is required',
    );
    expect(
      validateCreate(spec({ posts: [{ record: { text: 'x'.repeat(3001) } }] }))
        .error,
    ).toBe('posts[0] text exceeds 3000 characters');
    expect(
      validateCreate(spec({ posts: [{ record: { text: '   ' } }] })).error,
    ).toBe('posts[0] needs text or an embed');
  });

  it('checks embeds', () => {
    const withEmbed = (embed) =>
      validateCreate(spec({ posts: [{ record: { text: '' }, embed }] }));
    expect(withEmbed({ type: 'images', images: [] }).error).toBe(
      'posts[0]: images embed needs at least one image',
    );
    const images = (n) =>
      Array.from({ length: n }, (_, i) => ({ mediaId: `p0-img${i}` }));
    expect(
      withEmbed({ type: 'images', images: images(MAX_IMAGES_PER_POST) }).ok,
    ).toBe(true);
    expect(
      withEmbed({ type: 'images', images: images(MAX_IMAGES_PER_POST + 1) })
        .error,
    ).toBe('posts[0]: a post can have at most 10 images');
    expect(
      withEmbed({ type: 'images', images: [{ alt: 'no id' }] }).error,
    ).toBe('posts[0]: each image needs a mediaId');
    expect(withEmbed({ type: 'external' }).error).toBe(
      'posts[0]: external embed needs a uri',
    );
    expect(
      withEmbed({
        type: 'external',
        uri: 'https://a.example',
        thumbUrl: 'http://169.254.169.254/',
      }).error,
    ).toBe('posts[0]: external embed thumbUrl must be a public https URL');
    expect(withEmbed({ type: 'record', uri: 'at://x' }).error).toBe(
      'posts[0]: record embed needs uri and cid',
    );
    expect(withEmbed({ type: 'recordWithMedia', uri: 'at://x' }).error).toBe(
      'posts[0]: recordWithMedia needs the quoted uri and cid',
    );
    expect(
      withEmbed({
        type: 'recordWithMedia',
        uri: 'at://x',
        cid: 'c',
        media: { type: 'recordWithMedia', uri: 'at://y', cid: 'd' },
      }).error,
    ).toBe('posts[0]: nested recordWithMedia is not allowed');
    expect(
      withEmbed({
        type: 'recordWithMedia',
        uri: 'at://x',
        cid: 'c',
        media: { type: 'images', images: images(2) },
      }).ok,
    ).toBe(true);
    expect(withEmbed({ type: 'video' }).error).toBe(
      'posts[0]: unknown embed type: video',
    );
  });

  it('accepts associatedRefs a card can carry and refuses malformed ones', () => {
    const res = validateCreate(externalSpec({ associatedRefs: [DOC, PUB] }));
    expect(res.ok).toBe(true);
    expect(res.value.posts[0].embed.associatedRefs).toEqual([DOC, PUB]);
    expect(validateCreate(externalSpec()).ok).toBe(true);
    expect(
      validateCreate(externalSpec({ associatedRefs: 'at://nope' })).error,
    ).toMatch(/must be an array/);
    expect(
      validateCreate(
        externalSpec({
          associatedRefs: [{ uri: 'https://example.com', cid: 'bafy' }],
        }),
      ).error,
    ).toMatch(/at:\/\/ uri and a cid/);
    const many = Array.from({ length: MAX_ASSOCIATED_REFS + 1 }, (_, i) => ({
      uri: `at://did:plc:x/site.standard.document/${i}`,
      cid: `bafy${i}`,
    }));
    expect(
      validateCreate(externalSpec({ associatedRefs: many })).error,
    ).toMatch(/at most/);
  });
});

describe('validateCreate gates', () => {
  it('keeps threadgate [] (nobody can reply)', () => {
    const res = validateCreate(spec({ gates: { threadgate: [] } }));
    expect(res.ok).toBe(true);
    expect(res.value.gates.threadgate).toEqual([]);
  });

  it('keeps rules and turns absent gates into nulls', () => {
    const rules = [{ $type: 'app.bsky.feed.threadgate#followingRule' }];
    expect(
      validateCreate(spec({ gates: { threadgate: rules } })).value.gates
        .threadgate,
    ).toEqual(rules);
    expect(validateCreate(spec()).value.gates).toEqual({
      threadgate: null,
      postgate: null,
    });
    const postgate = [{ $type: 'app.bsky.feed.postgate#disableRule' }];
    expect(validateCreate(spec({ gates: { postgate } })).value.gates).toEqual({
      threadgate: null,
      postgate,
    });
  });
});

describe('validateSelfDestructSpec', () => {
  const timer = (extra) => ({ lifespanSeconds: 3600, ...extra });

  it('is null when absent and refuses a non-object', () => {
    expect(validateSelfDestructSpec(null)).toEqual({ value: null });
    expect(validateSelfDestructSpec(undefined)).toEqual({ value: null });
    expect(validateSelfDestructSpec('soon').error).toBe(
      'selfDestruct must be an object',
    );
  });

  it('bounds the lifespan', () => {
    expect(validateSelfDestructSpec({}).error).toBe(
      'selfDestruct.lifespanSeconds is required',
    );
    expect(validateSelfDestructSpec({ lifespanSeconds: 299 }).error).toBe(
      'a post has to stand for at least 5 minutes',
    );
    expect(
      validateSelfDestructSpec({ lifespanSeconds: 31 * 86400 }).error,
    ).toBe('a timer can run for at most 30 days');
    expect(
      validateSelfDestructSpec({ lifespanSeconds: 300.9 }).value
        .lifespanSeconds,
    ).toBe(300);
  });

  it('refuses a pinned deleteAt earlier than the publish time', () => {
    const scheduledForMs = Date.now() + DAY;
    const res = validateSelfDestructSpec(
      timer({ deleteAt: iso(Date.now() + 2 * HOUR) }),
      scheduledForMs,
    );
    expect(res.error).toMatch(/before this post would even publish/);
    expect(validateSelfDestructSpec(timer({ deleteAt: 'later' })).error).toBe(
      'selfDestruct.deleteAt is not a valid datetime',
    );
  });

  it('accepts a deleteAt comfortably after the publish time, normalized', () => {
    const scheduledForMs = Date.now() + 2 * HOUR;
    const fine = iso(scheduledForMs + 6 * HOUR);
    const res = validateSelfDestructSpec(
      timer({ deleteAt: fine }),
      scheduledForMs,
    );
    expect(res.error).toBeUndefined();
    expect(res.value.deleteAt).toBe(fine);
    // Exactly five minutes after is allowed.
    expect(
      validateSelfDestructSpec(
        timer({ deleteAt: iso(scheduledForMs + 5 * MINUTE) }),
        scheduledForMs,
      ).error,
    ).toBeUndefined();
  });

  it('is lenient about a past deleteAt when no scheduled time is given', () => {
    expect(
      validateSelfDestructSpec(timer({ deleteAt: iso(Date.now() - HOUR) }))
        .error,
    ).toBeUndefined();
  });

  it('refuses an effect or a rule the server does not recognise instead of deleting', () => {
    expect(
      validateSelfDestructSpec(timer({ effects: [{ action: 'archive' }] }))
        .error,
    ).toMatch(/does not know how to do/);
    expect(
      validateSelfDestructSpec(timer({ conditions: { sense: 'sometimes' } }))
        .error,
    ).toBeTruthy();
  });

  it('carries the parsed conditions and effects', () => {
    const res = validateSelfDestructSpec(
      timer({
        conditions: {
          sense: 'unless',
          clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
        },
      }),
    );
    expect(res.value.conditions.clauses).toHaveLength(1);
    expect(Array.isArray(res.value.effects) || res.value.effects === null).toBe(
      true,
    );
  });

  it('runs inside validateCreate against the scheduled time', () => {
    const scheduledFor = inHours(24);
    const res = validateCreate({
      ...spec({ selfDestruct: timer({ deleteAt: inHours(2) }) }),
      scheduledFor,
    });
    expect(res).toEqual({
      ok: false,
      error: expect.stringMatching(/before this post would even publish/),
    });
  });
});

describe('validateReschedule', () => {
  it('applies the same time guards', () => {
    expect(validateReschedule({}).error).toBe('scheduledFor is required');
    expect(
      validateReschedule({ scheduledFor: iso(Date.now() - 1000) }).error,
    ).toBe('scheduledFor must be in the future');
    const when = inHours(3);
    expect(validateReschedule({ scheduledFor: when })).toEqual({
      ok: true,
      value: { scheduledFor: when },
    });
  });
});

describe('strandsDeleteTime', () => {
  const slot = Date.now() + DAY;
  const payload = { selfDestruct: { deleteAt: iso(slot + 9 * HOUR) } };

  it('names the pinned time a move past it would strand, on the same boundary as create', () => {
    expect(strandsDeleteTime(payload, iso(slot + 24 * HOUR))).toBe(
      iso(slot + 9 * HOUR),
    );
    expect(
      strandsDeleteTime(payload, iso(slot + 9 * HOUR - 4 * MINUTE)),
    ).toBeTruthy();
    expect(
      strandsDeleteTime(payload, iso(slot + 9 * HOUR - 5 * MINUTE)),
    ).toBeNull();
    expect(strandsDeleteTime(payload, iso(slot + HOUR))).toBeNull();
  });

  it('says nothing about a post without a pinned delete time', () => {
    expect(
      strandsDeleteTime({ selfDestruct: { lifespanSeconds: 3600 } }, iso(slot)),
    ).toBeNull();
    expect(strandsDeleteTime({}, iso(slot))).toBeNull();
  });

  it('names the post by its opening words, or as one of these posts', () => {
    const named = strandedMoveError({
      posts: [
        { record: { text: 'thursday   thoughts on moths and porch lamps' } },
      ],
    });
    expect(named).toBe(
      'the delete time on "thursday thoughts on moths and porch lam…" would come before it goes out in this order, or within five minutes of it. move it earlier, or change its lifespan first. your queue is unchanged.',
    );
    expect(strandedMoveError({ posts: [{ record: { text: '' } }] })).toMatch(
      /^the delete time on one of these posts/,
    );
  });
});

describe('collectMediaIds', () => {
  it('finds images, card thumbnails and the media under a quote', () => {
    const embed = {
      type: 'recordWithMedia',
      uri: 'at://x',
      cid: 'c',
      media: { type: 'images', images: [{ mediaId: 'a' }, { mediaId: 'b' }] },
    };
    expect(collectMediaIds(embed)).toEqual(['a', 'b']);
    expect(
      collectMediaIds({
        type: 'external',
        uri: 'https://x',
        thumbMediaId: 't',
      }),
    ).toEqual(['t']);
    expect(
      collectMediaIds({
        type: 'external',
        uri: 'https://x',
        thumbUrl: 'https://x/t.png',
      }),
    ).toEqual([]);
    expect(collectMediaIds(undefined)).toEqual([]);
  });
});

describe('classifyFailure', () => {
  it('never invents a code outside the permitted list', () => {
    const inputs = [
      undefined,
      null,
      '',
      'something nobody has seen',
      new Error('boom'),
      { status: 500 },
      { error: 'UpstreamFailure' },
    ];
    for (const input of inputs)
      expect(FAILURE_CODES).toContain(classifyFailure(input));
    expect(classifyFailure('an unfamiliar failure')).toBe('UNKNOWN');
  });

  it("prefers a code the error carries, and ignores one that isn't a publish failure", () => {
    expect(
      classifyFailure(
        new NonRetryableError('images are gone', 'MEDIA_MISSING'),
      ),
    ).toBe('MEDIA_MISSING');
    expect(
      classifyFailure(new NonRetryableError('too many', 'QUOTA_EXCEEDED')),
    ).toBe('UNKNOWN');
    expect(normalizeFailureCode('QUOTA_EXCEEDED')).toBeNull();
  });

  it("reads the PDS's own errors", () => {
    expect(classifyFailure({ status: 429, error: 'RateLimitExceeded' })).toBe(
      'RATE_LIMITED',
    );
    expect(
      classifyFailure({
        status: 400,
        error: 'InvalidRequest',
        message: 'record too long',
      }),
    ).toBe('REFUSED');
    expect(classifyFailure({ status: 401, error: 'ExpiredToken' })).toBe(
      'SESSION_UNAVAILABLE',
    );
    expect(classifyFailure({ error: 'BlockedActor' })).toBe('REFUSED');
  });

  it('recognises its own sentences', () => {
    expect(
      classifyFailure(
        "couldn't reach your account session. reconnect your account if this keeps happening.",
      ),
    ).toBe('SESSION_UNAVAILABLE');
    expect(
      classifyFailure(
        'the publisher ran out of time before this post could be written.',
      ),
    ).toBe('TIMED_OUT');
    expect(
      classifyFailure(
        'the images for this scheduled post are missing. edit it and re-attach them.',
      ),
    ).toBe('MEDIA_MISSING');
    expect(classifyFailure('media download failed: Object not found')).toBe(
      'MEDIA_MISSING',
    );
    expect(classifyFailure('socket hang up')).toBe('TIMED_OUT');
    expect(classifyFailure('Rate limit exceeded')).toBe('RATE_LIMITED');
  });

  it('keeps TIMER_NOT_ARMED in the vocabulary', () => {
    expect(FAILURE_CODES).toEqual([
      'SESSION_UNAVAILABLE',
      'MEDIA_MISSING',
      'TIMED_OUT',
      'RATE_LIMITED',
      'REFUSED',
      'TIMER_NOT_ARMED',
      'UNKNOWN',
    ]);
    const err = Object.assign(new Error('timer not armed'), {
      code: 'TIMER_NOT_ARMED',
    });
    expect(classifyFailure(err)).toBe('TIMER_NOT_ARMED');
  });
});

describe('reorderScheduledPosts refusals, before any database', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const reorder = (moves) =>
    reorderScheduledPosts({ userDid: 'did:plc:someone', moves });

  it('refuses no account', async () => {
    await expect(
      reorderScheduledPosts({
        userDid: '',
        moves: [{ id, scheduledFor: inHours(1) }],
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'BAD_REQUEST',
      error: 'the reorder did not arrive in a shape we could read.',
    });
  });

  it('refuses an empty or oversized reorder', async () => {
    await expect(reorder([])).resolves.toEqual({
      ok: false,
      code: 'BAD_REQUEST',
      error: 'a reorder carries between one and 50 posts.',
    });
    const tooMany = Array.from({ length: MAX_REORDER_MOVES + 1 }, () => ({
      id,
      scheduledFor: inHours(1),
    }));
    await expect(reorder(tooMany)).resolves.toMatchObject({
      ok: false,
      code: 'BAD_REQUEST',
    });
  });

  it('refuses an unreadable id rather than letting Postgres fault on the cast', async () => {
    const res = await reorder([{ id: 'not-a-uuid', scheduledFor: inHours(1) }]);
    expect(res).toEqual({
      ok: false,
      code: 'BAD_REQUEST',
      error: 'a post id in that reorder could not be read.',
    });
  });

  it('refuses the same post twice', async () => {
    const res = await reorder([
      { id, scheduledFor: inHours(1) },
      { id, scheduledFor: inHours(2) },
    ]);
    expect(res).toEqual({
      ok: false,
      code: 'BAD_REQUEST',
      error: 'a post appears twice in that reorder.',
    });
  });

  it('applies the reschedule time guards to every move', async () => {
    const res = await reorder([{ id, scheduledFor: iso(Date.now() - MINUTE) }]);
    expect(res).toEqual({
      ok: false,
      code: 'BAD_REQUEST',
      error:
        'a reorder needs a new time for every post — in the future, and within 90 days.',
    });
    await expect(reorder([{ id }])).resolves.toMatchObject({
      ok: false,
      code: 'BAD_REQUEST',
    });
  });
});

describe('buildEmbed without media', () => {
  const build = (embedSpec) =>
    buildEmbed('did:plc:author', null, embedSpec, {});

  it('writes associatedRefs onto the external embed, and leaves them off an ordinary card', async () => {
    expect(
      await build({
        type: 'external',
        uri: 'https://onething.pckt.blog/a-post',
        title: 'T',
        description: 'D',
        associatedRefs: [DOC, PUB],
      }),
    ).toEqual({
      $type: 'app.bsky.embed.external',
      external: {
        uri: 'https://onething.pckt.blog/a-post',
        title: 'T',
        description: 'D',
        associatedRefs: [DOC, PUB],
      },
    });
    const plain = await build({ type: 'external', uri: 'https://example.com' });
    expect(plain.external).toEqual({
      uri: 'https://example.com',
      title: '',
      description: '',
    });
  });

  it('carries refs through a quote-with-card, and builds a quote', async () => {
    const embed = await build({
      type: 'recordWithMedia',
      uri: 'at://did:plc:q/app.bsky.feed.post/1',
      cid: 'quotecid',
      media: {
        type: 'external',
        uri: 'https://onething.pckt.blog/a-post',
        title: 'T',
        description: 'D',
        associatedRefs: [DOC],
      },
    });
    expect(embed.$type).toBe('app.bsky.embed.recordWithMedia');
    expect(embed.record).toEqual({
      $type: 'app.bsky.embed.record',
      record: { uri: 'at://did:plc:q/app.bsky.feed.post/1', cid: 'quotecid' },
    });
    expect(embed.media.external.associatedRefs).toEqual([DOC]);
    expect(
      await build({
        type: 'record',
        uri: 'at://did:plc:q/app.bsky.feed.post/1',
        cid: 'c',
      }),
    ).toEqual({
      $type: 'app.bsky.embed.record',
      record: { uri: 'at://did:plc:q/app.bsky.feed.post/1', cid: 'c' },
    });
  });

  it('refuses, terminally, images whose bytes never reached Storage', async () => {
    const err = await build({
      type: 'images',
      images: [{ mediaId: 'p0-img0' }],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(err).toMatchObject({ code: 'MEDIA_MISSING', nonRetryable: true });
  });
});

describe('isMissingTable and isUndefinedFunction', () => {
  it('reads PostgREST and Postgres answers for a schema that isn’t there', () => {
    expect(
      isMissingTable({
        code: 'PGRST205',
        message:
          "Could not find the table 'public.scheduled_posts' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingTable({
        code: '42P01',
        message: 'relation "scheduled_posts" does not exist',
      }),
    ).toBe(true);
    expect(
      isMissingTable({ message: 'relation "scheduled_posts" does not exist' }),
    ).toBe(true);
    expect(
      isMissingTable({
        code: '42703',
        message: 'column "x" of relation "scheduled_posts" does not exist',
      }),
    ).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(
      isUndefinedFunction({
        code: 'PGRST202',
        message: 'Could not find the function public.f',
      }),
    ).toBe(true);
    expect(
      isUndefinedFunction({
        code: '42883',
        message: 'function f() does not exist',
      }),
    ).toBe(true);
    expect(isUndefinedFunction({ code: 'XX000', message: 'boom' })).toBe(false);
  });
});
