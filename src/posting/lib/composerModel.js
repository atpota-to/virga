// The composer's state, as one value a reducer moves: every post is a
// PostDraft in `posts` (a single post is a thread of one), and the
// composer-wide choices sit beside them. The shape is the contract between
// the composer, drafts, scheduling and publishing; see ComposerState below.
//
// ComposerState = {
//   posts: PostDraft[1..25], reply, tags, langs (≤3), labels, gates, asDid,
//   schedule, lifespan, source,
// }
// PostDraft = { id, text, images (≤4), video, record, card }

import {
  countComposerGraphemes,
  composerCountText,
  detectComposerFacets,
} from './inlineLinks.js';
import { shortenLinkFacets } from './linkShortening.js';
import { utf8Length } from './richText.js';
import {
  normalizeTags,
  MAX_TAGS,
  MAX_TAG_GRAPHEMES,
  MAX_TAG_BYTES,
} from './tags.js';
import { countGraphemes } from './graphemes.js';
import { MAX_REPLY_RULES } from './gates.js';
import { VIDEO_ALT_MAX_GRAPHEMES } from './video.js';

export const MAX_POSTS = 25;
export const MAX_IMAGES = 4;
export const MAX_POST_GRAPHEMES = 300;
export const MAX_POST_BYTES = 3000;
export const MAX_LANGS = 3;
export const SCHEDULE_MIN_LEAD_MS = 60_000;
export const SCHEDULE_MAX_DAYS = 90;

/** Self-labels a post can carry; the first three are exclusive. */
export const ADULT_LABELS = ['sexual', 'nudity', 'porn'];
export const SELF_LABELS = [...ADULT_LABELS, 'graphic-media'];

const RECORD_KINDS = ['post', 'feed', 'list', 'starterpack'];

let idCounter = 0;
/** An id unique within this page, for posts and images. */
export function newId(prefix = 'p') {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

const plainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** An empty post. */
export function emptyPost() {
  return {
    id: newId('p'),
    text: '',
    images: [],
    video: null,
    record: null,
    card: null,
  };
}

function normalizeImage(raw) {
  if (!plainObject(raw)) return null;
  return {
    ...raw,
    id: raw.id || newId('i'),
    alt: typeof raw.alt === 'string' ? raw.alt : '',
  };
}

function normalizeVideo(raw) {
  if (!plainObject(raw)) return null;
  const status = ['idle', 'uploading', 'processing', 'ready', 'error'].includes(
    raw.status,
  )
    ? raw.status
    : raw.blob
      ? 'ready'
      : 'idle';
  return { ...raw, alt: typeof raw.alt === 'string' ? raw.alt : '', status };
}

function normalizeRecord(raw) {
  if (!plainObject(raw) || typeof raw.uri !== 'string') return null;
  return { ...raw, kind: RECORD_KINDS.includes(raw.kind) ? raw.kind : 'post' };
}

function normalizeCard(raw) {
  if (!plainObject(raw) || typeof raw.url !== 'string' || !raw.url) return null;
  return {
    ...raw,
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    thumb: typeof raw.thumb === 'string' && raw.thumb ? raw.thumb : null,
  };
}

/** A PostDraft with every field present and of the right kind. */
export function normalizePost(raw) {
  const src = plainObject(raw) ? raw : {};
  return {
    ...src,
    id: src.id || newId('p'),
    text: typeof src.text === 'string' ? src.text : '',
    images: (Array.isArray(src.images) ? src.images : [])
      .map(normalizeImage)
      .filter(Boolean),
    video: normalizeVideo(src.video),
    record: normalizeRecord(src.record),
    card: normalizeCard(src.card),
  };
}

function normalizeGates(raw) {
  const src = plainObject(raw) ? raw : {};
  return {
    custom: !!src.custom,
    reply: Array.isArray(src.reply) ? src.reply : null,
    quotes: src.quotes !== false,
  };
}

const stringList = (v) =>
  Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : [];

function normalizeSchedule(raw) {
  if (!plainObject(raw)) return null;
  if (raw.mode === 'queue') return { mode: 'queue' };
  if (raw.mode === 'at' && typeof raw.at === 'string')
    return { mode: 'at', at: raw.at };
  return null;
}

/**
 * A ComposerState with every field present: what `load` and `reset` store,
 * so a draft or an old autosave can't leave a hole the UI trips on.
 */
export function normalizeComposerState(raw) {
  const src = plainObject(raw) ? raw : {};
  const posts = (Array.isArray(src.posts) ? src.posts : [])
    .slice(0, MAX_POSTS)
    .map(normalizePost);
  return {
    ...src,
    posts: posts.length > 0 ? posts : [emptyPost()],
    reply:
      plainObject(src.reply) && typeof src.reply.uri === 'string'
        ? src.reply
        : null,
    tags: stringList(src.tags),
    langs: stringList(src.langs).slice(0, MAX_LANGS),
    labels: stringList(src.labels),
    gates: normalizeGates(src.gates),
    asDid: typeof src.asDid === 'string' ? src.asDid : '',
    schedule: normalizeSchedule(src.schedule),
    lifespan: plainObject(src.lifespan) ? src.lifespan : { enabled: false },
    source: plainObject(src.source) ? src.source : null,
  };
}

/**
 * A fresh composer for `asDid`, with the account's posting defaults
 * (`langs`; `gates` and `lifespan` when the composer has already resolved
 * them). Gates start not custom: the composer fills in the account's
 * defaults with setDefaultGates.
 * @param {{ asDid: string, defaults?: { langs?: string[], gates?: object|null, lifespan?: object } }} options
 */
export function emptyComposerState({ asDid, defaults = {} } = {}) {
  const gates = plainObject(defaults.gates) ? defaults.gates : null;
  return normalizeComposerState({
    posts: [emptyPost()],
    reply: null,
    tags: [],
    langs: stringList(defaults.langs).slice(0, MAX_LANGS),
    labels: [],
    gates: {
      custom: false,
      reply: gates?.reply ?? null,
      quotes: gates ? gates.quotes !== false : true,
    },
    asDid,
    schedule: null,
    lifespan: plainObject(defaults.lifespan)
      ? defaults.lifespan
      : { enabled: false },
    source: null,
  });
}

/** Whether a post holds anything: text, media, a record or a card. */
export function postHasContent(post) {
  return !!(
    post?.text?.trim() ||
    post?.images?.length ||
    post?.video ||
    post?.record ||
    post?.card
  );
}

/** Whether the composer holds nothing worth keeping. */
export function isEmptyComposer(state) {
  return !state?.posts?.some(postHasContent);
}

// Self-labels

/** Labels as the record's `labels` field, or null when there are none. */
export function labelsToSelfLabels(labels) {
  const values = stringList(labels).filter((l) => SELF_LABELS.includes(l));
  const unique = [...new Set(values)];
  if (unique.length === 0) return null;
  return {
    $type: 'com.atproto.label.defs#selfLabels',
    values: unique.map((val) => ({ val })),
  };
}

/** A record's `labels` field back to the composer's list. */
export function selfLabelsToLabels(selfLabels) {
  const values = Array.isArray(selfLabels?.values) ? selfLabels.values : [];
  return [
    ...new Set(
      values.map((v) => v?.val).filter((v) => SELF_LABELS.includes(v)),
    ),
  ];
}

// The reducer

function mapPost(state, index, fn) {
  if (!Number.isInteger(index) || index < 0 || index >= state.posts.length)
    return state;
  const posts = state.posts.slice();
  posts[index] = fn(posts[index]);
  return { ...state, posts };
}

const hasMedia = (post) => post.images.length > 0 || !!post.video;

function dropForeignBlobs(post, did) {
  const images = post.images.map((img) => {
    if (!img.blob || img.blobDid === did) return img;
    const { blob, blobDid, ...rest } = img; // eslint-disable-line no-unused-vars
    return rest;
  });
  let video = post.video;
  if (
    video &&
    (video.blob || video.jobId || video.status !== 'idle') &&
    video.blobDid !== did
  ) {
    const { blob, blobDid, jobId, error, ...rest } = video; // eslint-disable-line no-unused-vars
    video = { ...rest, status: 'idle' };
  }
  let card = post.card;
  if (card?.thumbBlob && card.thumbBlobDid !== did) {
    const { thumbBlob, thumbBlobDid, ...rest } = card; // eslint-disable-line no-unused-vars
    card = rest;
  }
  return { ...post, images, video, card };
}

/**
 * The composer's reducer. Unknown actions return the state unchanged.
 *
 * Media rules: a post has one media slot, so adding images drops a video and
 * the card, setting a video drops images and the card, and a card isn't
 * added beside media. Images stop at four. A record (quote, feed, list,
 * starter pack) has its own slot and sits beside any media.
 */
export function composerReducer(state, action) {
  if (!action || typeof action !== 'object') return state;
  switch (action.type) {
    case 'setText':
      return mapPost(state, action.index, (p) => ({
        ...p,
        text: String(action.text ?? ''),
      }));

    case 'addPost': {
      if (state.posts.length >= MAX_POSTS) return state;
      const after = Number.isInteger(action.after)
        ? action.after
        : state.posts.length - 1;
      const at = Math.min(Math.max(after + 1, 0), state.posts.length);
      const posts = state.posts.slice();
      posts.splice(
        at,
        0,
        action.post ? normalizePost(action.post) : emptyPost(),
      );
      return { ...state, posts };
    }

    case 'removePost': {
      const { index } = action;
      if (!Number.isInteger(index) || index < 0 || index >= state.posts.length)
        return state;
      if (state.posts.length === 1) return { ...state, posts: [emptyPost()] };
      return { ...state, posts: state.posts.filter((_, i) => i !== index) };
    }

    case 'movePost': {
      const { from, to } = action;
      const n = state.posts.length;
      if (
        ![from, to].every((i) => Number.isInteger(i) && i >= 0 && i < n) ||
        from === to
      )
        return state;
      const posts = state.posts.slice();
      const [moved] = posts.splice(from, 1);
      posts.splice(to, 0, moved);
      return { ...state, posts };
    }

    case 'addImages':
      return mapPost(state, action.index, (p) => {
        const incoming = (Array.isArray(action.images) ? action.images : [])
          .map(normalizeImage)
          .filter(Boolean);
        if (incoming.length === 0) return p;
        const images = [...p.images, ...incoming].slice(0, MAX_IMAGES);
        return { ...p, images, video: null, card: null };
      });

    case 'updateImage':
      return mapPost(state, action.index, (p) => ({
        ...p,
        images: p.images.map((img) =>
          img.id === action.id ? { ...img, ...action.patch, id: img.id } : img,
        ),
      }));

    case 'removeImage':
      return mapPost(state, action.index, (p) => ({
        ...p,
        images: p.images.filter((img) => img.id !== action.id),
      }));

    case 'moveImage':
      return mapPost(state, action.index, (p) => {
        const { from, to } = action;
        const n = p.images.length;
        if (
          ![from, to].every((i) => Number.isInteger(i) && i >= 0 && i < n) ||
          from === to
        )
          return p;
        const images = p.images.slice();
        const [moved] = images.splice(from, 1);
        images.splice(to, 0, moved);
        return { ...p, images };
      });

    case 'setVideo':
      return mapPost(state, action.index, (p) => {
        const video = normalizeVideo(action.video);
        if (!video) return { ...p, video: null };
        return { ...p, video, images: [], card: null };
      });

    case 'setRecord':
      return mapPost(state, action.index, (p) => ({
        ...p,
        record: normalizeRecord(action.record),
      }));

    case 'setCard':
      return mapPost(state, action.index, (p) => {
        const card = normalizeCard(action.card);
        if (card && hasMedia(p)) return p;
        return { ...p, card };
      });

    case 'setReply':
      return {
        ...state,
        reply: plainObject(action.reply) ? action.reply : null,
      };

    case 'setTags':
      return { ...state, tags: normalizeTags(action.tags) };

    case 'setLangs':
      return {
        ...state,
        langs: [...new Set(stringList(action.langs))].slice(0, MAX_LANGS),
      };

    case 'setLabels': {
      const labels = [
        ...new Set(
          stringList(action.labels).filter((l) => SELF_LABELS.includes(l)),
        ),
      ];
      // One adult label at most: the last one chosen wins.
      const adult = labels.filter((l) => ADULT_LABELS.includes(l));
      const keep = adult.length > 1 ? adult[adult.length - 1] : null;
      return {
        ...state,
        labels: keep
          ? labels.filter((l) => !ADULT_LABELS.includes(l) || l === keep)
          : labels,
      };
    }

    case 'setGates':
      return {
        ...state,
        gates: { ...normalizeGates(action.gates), custom: true },
      };

    case 'setDefaultGates':
      if (state.gates.custom) return state;
      return {
        ...state,
        gates: { ...normalizeGates(action.gates), custom: false },
      };

    case 'setAsDid': {
      const did = typeof action.did === 'string' ? action.did : '';
      if (!did || did === state.asDid) return state;
      return {
        ...state,
        asDid: did,
        posts: state.posts.map((p) => dropForeignBlobs(p, did)),
      };
    }

    case 'setSchedule':
      return { ...state, schedule: normalizeSchedule(action.schedule) };

    case 'setLifespan':
      return {
        ...state,
        lifespan: plainObject(action.lifespan)
          ? action.lifespan
          : { enabled: false },
      };

    case 'setSource':
      return {
        ...state,
        source: plainObject(action.source) ? action.source : null,
      };

    case 'load':
    case 'reset':
      return normalizeComposerState(action.state);

    default:
      return state;
  }
}

// Validation

const problem = (postIndex, code, message) => ({ postIndex, code, message });

/**
 * What stops the composer from being published (or, with `forSchedule`,
 * scheduled), as `[{ postIndex, code, message }]`; empty when nothing does.
 * `postIndex` is null for problems that aren't one post's.
 *
 * Lengths are counted as they will be written: inline links collapsed and
 * links shortened (`countComposerGraphemes`).
 *
 * @param {object} state
 * @param {object} [options]
 * @param {Date|number} [options.now]
 * @param {boolean} [options.forSchedule]
 * @param {boolean} [options.requireAltText]
 * @param {(rule: object) => string | null} [options.lifespanProblem] - the
 *   timers module's check, injected so this module never imports it
 * @returns {Array<{ postIndex: number | null, code: string, message: string }>}
 */
export function validateComposer(state, options = {}) {
  const {
    now = Date.now(),
    forSchedule = false,
    requireAltText = false,
    lifespanProblem,
  } = options;
  const problems = [];
  const posts = state?.posts || [];

  if (!state?.asDid)
    problems.push(problem(null, 'NO_ACCOUNT', 'Choose an account to post as.'));
  if (posts.length > MAX_POSTS) {
    problems.push(
      problem(
        null,
        'TOO_MANY_POSTS',
        `A thread can have up to ${MAX_POSTS} posts.`,
      ),
    );
  }
  if (!posts.some(postHasContent)) {
    problems.push(problem(null, 'EMPTY', 'Write something first.'));
  }

  posts.forEach((post, i) => {
    if (posts.length > 1 && !postHasContent(post)) {
      problems.push(
        problem(
          i,
          'POST_EMPTY',
          `Post ${i + 1} is empty. Write something or remove it.`,
        ),
      );
    }
    const text = post.text || '';
    const graphemes = countComposerGraphemes(text.trim());
    if (graphemes > MAX_POST_GRAPHEMES) {
      problems.push(
        problem(
          i,
          'TOO_LONG',
          `This post is ${graphemes - MAX_POST_GRAPHEMES} characters over the ${MAX_POST_GRAPHEMES} limit.`,
        ),
      );
    } else if (utf8Length(composerCountText(text.trim())) > MAX_POST_BYTES) {
      problems.push(
        problem(
          i,
          'TOO_MANY_BYTES',
          'This post has too many emoji or special characters to fit.',
        ),
      );
    }

    const images = post.images || [];
    if (images.length > MAX_IMAGES) {
      problems.push(
        problem(
          i,
          'TOO_MANY_IMAGES',
          `A post can have up to ${MAX_IMAGES} images.`,
        ),
      );
    }
    if (images.length > 0 && post.video) {
      problems.push(
        problem(
          i,
          'MEDIA_CONFLICT',
          'A post can have images or a video, not both.',
        ),
      );
    }
    if (images.some((img) => !img.file && !img.blob)) {
      problems.push(
        problem(
          i,
          'IMAGE_MISSING',
          'An image needs to be added again before this can be posted.',
        ),
      );
    }
    if (requireAltText && images.some((img) => !img.alt?.trim())) {
      problems.push(problem(i, 'ALT_MISSING', 'Add alt text to every image.'));
    }
    if (post.video) {
      if (!post.video.file && !post.video.blob) {
        problems.push(
          problem(
            i,
            'VIDEO_MISSING',
            'The video needs to be added again before this can be posted.',
          ),
        );
      }
      if (countGraphemes(post.video.alt || '') > VIDEO_ALT_MAX_GRAPHEMES) {
        problems.push(
          problem(
            i,
            'ALT_TOO_LONG',
            `Video alt text can be up to ${VIDEO_ALT_MAX_GRAPHEMES} characters.`,
          ),
        );
      }
      if (forSchedule) {
        problems.push(
          problem(
            i,
            'SCHEDULE_VIDEO',
            'Posts with video can’t be scheduled. Post it now instead.',
          ),
        );
      }
    }
    if (post.record && !post.record.cid) {
      problems.push(
        problem(
          i,
          'RECORD_UNRESOLVED',
          'The attached post or feed couldn’t be found. Remove it or try again.',
        ),
      );
    }
  });

  const tags = state?.tags || [];
  if (tags.length > MAX_TAGS) {
    problems.push(
      problem(null, 'TOO_MANY_TAGS', `A post can have up to ${MAX_TAGS} tags.`),
    );
  }
  if (
    tags.some(
      (t) =>
        !t ||
        countGraphemes(t) > MAX_TAG_GRAPHEMES ||
        utf8Length(t) > MAX_TAG_BYTES,
    )
  ) {
    problems.push(
      problem(
        null,
        'TAG_INVALID',
        `Tags can be up to ${MAX_TAG_GRAPHEMES} characters.`,
      ),
    );
  }
  if ((state?.langs || []).length > MAX_LANGS) {
    problems.push(
      problem(null, 'TOO_MANY_LANGS', `Choose up to ${MAX_LANGS} languages.`),
    );
  }
  const labels = state?.labels || [];
  if (labels.some((l) => !SELF_LABELS.includes(l))) {
    problems.push(
      problem(
        null,
        'LABEL_INVALID',
        'One of the content labels isn’t one Bluesky knows.',
      ),
    );
  }
  if (labels.filter((l) => ADULT_LABELS.includes(l)).length > 1) {
    problems.push(
      problem(null, 'LABEL_CONFLICT', 'Choose one adult content label.'),
    );
  }
  if (
    !state?.reply &&
    Array.isArray(state?.gates?.reply) &&
    state.gates.reply.length > MAX_REPLY_RULES
  ) {
    problems.push(
      problem(
        null,
        'GATES_TOO_MANY',
        `Choose up to ${MAX_REPLY_RULES} groups who can reply.`,
      ),
    );
  }

  if (forSchedule && state?.reply) {
    problems.push(
      problem(
        null,
        'SCHEDULE_REPLY',
        'Replies can’t be scheduled. Post it now instead.',
      ),
    );
  }

  const schedule = state?.schedule;
  if (forSchedule && schedule?.mode === 'at') {
    const at = Date.parse(schedule.at);
    const nowMs = new Date(now).getTime();
    if (!Number.isFinite(at)) {
      problems.push(
        problem(null, 'SCHEDULE_INVALID', 'Choose a time to post it.'),
      );
    } else if (at < nowMs + SCHEDULE_MIN_LEAD_MS) {
      problems.push(
        problem(
          null,
          'SCHEDULE_PAST',
          'Choose a time at least a minute from now.',
        ),
      );
    } else if (at > nowMs + SCHEDULE_MAX_DAYS * 86_400_000) {
      problems.push(
        problem(
          null,
          'SCHEDULE_TOO_FAR',
          `Posts can be scheduled up to ${SCHEDULE_MAX_DAYS} days ahead.`,
        ),
      );
    }
  }

  if (typeof lifespanProblem === 'function' && state?.lifespan?.enabled) {
    const message = lifespanProblem(state.lifespan);
    if (message) problems.push(problem(null, 'LIFESPAN', String(message)));
  }

  return problems;
}

// Text

function abortError() {
  const err = new Error('Cancelled.');
  err.name = 'AbortError';
  err.canceled = true;
  return err;
}

/**
 * Every post's text as it will be written, with its facets: inline links
 * collapsed, mentions resolved (an unresolvable one stays plain text), links
 * shortened. The one text pipeline publishing, drafts and scheduling share.
 *
 * @param {object} state
 * @param {{ resolveMention?: (handle: string) => Promise<string|null>, signal?: AbortSignal }} [options]
 * @returns {Promise<Array<{ text: string, facets: object[] }>>}
 */
export async function resolvePostTexts(state, { resolveMention, signal } = {}) {
  if (signal?.aborted) throw abortError();
  const results = await Promise.all(
    (state?.posts || []).map(async (post) => {
      const detected = await detectComposerFacets((post.text || '').trim(), {
        ...(resolveMention ? { resolveMention } : {}),
      });
      return shortenLinkFacets(detected.text, detected.facets || []);
    }),
  );
  if (signal?.aborted) throw abortError();
  return results.map(({ text, facets }) => ({ text, facets }));
}
