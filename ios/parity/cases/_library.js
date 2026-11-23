// Shared inputs for the library generators (library.*.js): the posts,
// templates, feeds, lists, links and archive rows of
// src/posting/library/*.test.js, plus unicode, emoji, odd shapes and the
// clock they are dated on.

import {
  buildTemplateContext,
  normalizeTemplateRecord,
} from '../../../src/posting/templates/postTemplates.js';
import { setActiveLocale } from '../../../src/lib/locale.js';
import { inZone } from './_helpers.js';

export const SELF = 'did:plc:self';
export const OTHER = 'did:plc:other';
/** The library's clock: model.test.js's NOW. */
export const NOW = '2026-10-14T12:00:00.000Z';
export const THIS_YEAR = 2026;
export const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';

/**
 * Runs `fn` with `new Date()` (no arguments) reading `now`, the active
 * locale `locale` and the process in `zone`: the clock, locale and zone
 * model.js reads for a post's date and a context's `today`.
 */
export function onClock(
  fn,
  { now = NOW, locale = 'en-US', zone = 'UTC' } = {},
) {
  const RealDate = globalThis.Date;
  const fixed = RealDate.parse(now);
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }

    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate;
  setActiveLocale(locale);
  try {
    return inZone(zone, fn);
  } finally {
    globalThis.Date = RealDate;
    setActiveLocale('en-US');
  }
}

/** The same with an async `fn`. */
export async function onClockAsync(fn, { now = NOW, locale = 'en-US' } = {}) {
  const RealDate = globalThis.Date;
  const fixed = RealDate.parse(now);
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
  }
  globalThis.Date = FixedDate;
  setActiveLocale(locale);
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
    setActiveLocale('en-US');
  }
}

export const replyTo = {
  uri: `at://${OTHER}/app.bsky.feed.post/parent`,
  author: { did: OTHER, handle: 'moss.example', displayName: 'Moss Hollow' },
  record: {
    text: 'Why does stamina drain so fast? I keep running out on my moth walks.',
  },
};

export const replyContext = buildTemplateContext({
  replyTo,
  self: { handle: 'you.example' },
  now: new Date(NOW),
  locale: 'en-US',
});
export const newPostContext = buildTemplateContext({
  self: { handle: 'you.example' },
  now: new Date(NOW),
  locale: 'en-US',
});

export const template = (value, rkey = 'tpl1') =>
  normalizeTemplateRecord({
    uri: `at://${SELF}/net.anisota.feed.template/${rkey}`,
    cid: `cid-${rkey}`,
    value,
  });

export const ownPostUri = `at://${SELF}/app.bsky.feed.post/stamina`;
export const ownPostView = {
  uri: ownPostUri,
  cid: 'cid-stamina',
  author: { did: SELF, handle: 'you.example' },
  record: {
    text: 'A few words on stamina, since it comes up a lot.\nIt refills at 2 a minute.',
    createdAt: `${THIS_YEAR}-09-02T12:00:00Z`,
  },
};

export const stampTemplate = template(
  {
    name: 'Why stamina?',
    text: 'I wrote a little about that here.',
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: ownPostUri, cid: 'cid-stamina' },
    },
    shortcut: 'stamina',
    keywords: ['stamina'],
    use: 'reply',
  },
  'stamina',
);
export const ideaTemplate = template(
  {
    name: 'Thanks for the idea',
    text: 'Thank you, {{their.firstName}}. I like the idea of {{idea}}, and it is on our list. {{when}}',
    variables: [
      { key: 'idea', label: 'What did they suggest?' },
      {
        key: 'when',
        label: 'When?',
        kind: 'choice',
        choices: ['Soon.', 'Someday.'],
        optional: true,
      },
    ],
    shortcut: 'idea',
    use: 'reply',
  },
  'idea',
);
export const appTemplate = template(
  {
    name: 'Is there an app?',
    text: "It runs in the browser, so there's nothing to download.",
    shortcut: 'app',
    keywords: ['download', 'app'],
  },
  'app',
);
export const postOnlyTemplate = template(
  {
    name: 'Weekly walk',
    text: 'Out for the weekly walk.',
    use: 'post',
    keywords: ['stamina'],
  },
  'walk',
);
export const linkTemplate = template(
  {
    name: 'Docs',
    text: '',
    embed: {
      $type: 'app.bsky.embed.external',
      external: {
        uri: 'https://docs.example.org/start',
        title: 'Getting started',
        description: '',
      },
    },
  },
  'docs',
);
export const feedTemplate = template(
  {
    name: 'Feed',
    text: 'Try this feed',
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: `at://${OTHER}/app.bsky.feed.generator/moths`, cid: 'cf' },
    },
    group: 'Feeds',
  },
  'feed',
);
export const listTemplate = template(
  {
    name: '',
    text: '\n\n  First line of a list template\nsecond',
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: `at://${OTHER}/app.bsky.graph.list/people`, cid: 'cl' },
    },
    group: 'Feeds',
    use: 'reply',
  },
  'list',
);
export const imagesTemplate = template(
  {
    name: 'Pics',
    text: 'x',
    embed: { $type: 'app.bsky.embed.images', images: [] },
  },
  'pics',
);
export const emptyImagesTemplate = template(
  {
    name: 'Pics only',
    text: '',
    embed: { $type: 'app.bsky.embed.images', images: [] },
  },
  'pics2',
);
export const contextTemplate = template(
  {
    name: 'Me',
    text: "I'm {{my.handle}}, {{their.firstName}}. Today is {{today}}.",
    group: 'Hello',
  },
  'me',
);
export const emojiTemplate = template(
  {
    name: `${FAMILY} Family  night`,
    text: `Bring ${FAMILY} and {{thing}} 🌿`,
    variables: [{ key: 'thing', label: 'Bring what?' }],
    shortcut: '/Fam-Night',
    keywords: ['family', 'Ünïcode'],
    group: 'Hello',
  },
  'family',
);

export const TEMPLATES = {
  stampTemplate,
  ideaTemplate,
  appTemplate,
  postOnlyTemplate,
  linkTemplate,
  feedTemplate,
  listTemplate,
  imagesTemplate,
  emptyImagesTemplate,
  contextTemplate,
  emojiTemplate,
};

export const ownView = (rkey, text, extra = {}) => ({
  uri: `at://${SELF}/app.bsky.feed.post/${rkey}`,
  cid: `cid-${rkey}`,
  author: { did: SELF, handle: 'you.example' },
  record: { text, createdAt: NOW },
  ...extra,
});

export const theirView = (rkey, text, extra = {}) => ({
  uri: `at://${OTHER}/app.bsky.feed.post/${rkey}`,
  cid: `cid-${rkey}`,
  author: { did: OTHER, handle: 'luna.example' },
  record: { text, createdAt: `${THIS_YEAR}-09-02T12:00:00Z` },
  ...extra,
});

const base = {
  uri: `at://${SELF}/app.bsky.feed.post/m`,
  author: { did: SELF, handle: 'you.example' },
};

/** Post views of every shape model.js reads. */
export const POSTS = {
  own: ownPostView,
  theirs: theirView('x', 'hi'),
  reply: {
    ...ownPostView,
    uri: `at://${SELF}/app.bsky.feed.post/r1`,
    record: {
      ...ownPostView.record,
      reply: { root: { uri: replyTo.uri }, parent: { uri: replyTo.uri } },
    },
  },
  selfReply: {
    ...ownPostView,
    uri: `at://${SELF}/app.bsky.feed.post/r2`,
    record: {
      ...ownPostView.record,
      reply: { root: { uri: ownPostUri }, parent: { uri: ownPostUri } },
    },
  },
  replyInOwnThread: {
    ...ownPostView,
    uri: `at://${SELF}/app.bsky.feed.post/r3`,
    record: {
      ...ownPostView.record,
      reply: { root: { uri: ownPostUri }, parent: { uri: replyTo.uri } },
    },
  },
  rootOnly: {
    ...ownPostView,
    uri: `at://${SELF}/app.bsky.feed.post/r4`,
    record: { ...ownPostView.record, reply: { root: { uri: ownPostUri } } },
  },
  noAuthor: {
    uri: `at://${SELF}/app.bsky.feed.post/na`,
    record: {
      text: 'No author on this one',
      reply: { root: { uri: ownPostUri }, parent: { uri: ownPostUri } },
    },
  },
  noDid: {
    uri: 'https://not-at/x',
    record: { text: 'x', reply: { root: { uri: ownPostUri } } },
  },
  older: {
    ...base,
    record: { text: '', createdAt: '2020-03-04T12:00:00Z' },
  },
  images: {
    ...base,
    record: {
      text: '',
      createdAt: '2026-10-29T12:00:00Z',
      embed: {
        $type: 'app.bsky.embed.images',
        images: [{ alt: 'one' }, { alt: '' }, { alt: 'three' }],
      },
    },
    embed: {
      $type: 'app.bsky.embed.images#view',
      images: [
        { thumb: 'https://img.example/1', alt: 'Ridge  at\ndusk' },
        { thumb: 'https://img.example/2', alt: '' },
        { thumb: 'https://img.example/3', alt: 'Moth' },
      ],
    },
  },
  bareImages: {
    ...base,
    record: {
      text: '',
      createdAt: '2026-10-29T12:00:00Z',
      embed: {
        $type: 'app.bsky.embed.images',
        images: [{ alt: 'one' }, { alt: '' }, { alt: 'three' }],
      },
    },
  },
  emptyImagesView: {
    ...base,
    record: { text: '', embed: { $type: 'app.bsky.embed.images', images: [] } },
    embed: { $type: 'app.bsky.embed.images#view', images: [] },
  },
  thumbless: {
    ...base,
    record: { text: 'pics' },
    embed: {
      $type: 'app.bsky.embed.images#view',
      images: [{ alt: 'no thumb' }, { thumb: 'https://img.example/2' }],
    },
  },
  quoteWithVideo: {
    ...base,
    record: { text: 'Look', createdAt: '2026-10-29T12:00:00Z' },
    embed: {
      $type: 'app.bsky.embed.recordWithMedia#view',
      record: { record: {} },
      media: {
        $type: 'app.bsky.embed.video#view',
        thumbnail: 'https://video.example/poster.jpg',
        alt: 'A moth taking off',
      },
    },
  },
  quoteWithImagesRecord: {
    ...base,
    record: {
      text: '',
      embed: {
        $type: 'app.bsky.embed.recordWithMedia',
        record: { record: { uri: ownPostUri } },
        media: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'cat  on\tmat' }],
        },
      },
    },
  },
  quoteWithVideoRecord: {
    ...base,
    record: {
      text: '',
      embed: {
        $type: 'app.bsky.embed.recordWithMedia',
        media: { $type: 'app.bsky.embed.video', alt: ' clip ' },
      },
    },
  },
  quoteWithMediaNone: {
    ...base,
    record: {
      text: '',
      embed: { $type: 'app.bsky.embed.recordWithMedia', media: {} },
    },
  },
  videoRecord: {
    ...base,
    record: { text: '', embed: { $type: 'app.bsky.embed.video' } },
  },
  videoView: {
    ...base,
    record: { text: '' },
    embed: { $type: 'app.bsky.embed.video#view' },
  },
  external: {
    ...base,
    record: {
      text: '',
      embed: { $type: 'app.bsky.embed.external', external: {} },
    },
  },
  externalView: {
    ...base,
    record: { text: '' },
    embed: { $type: 'app.bsky.embed.external#view', external: {} },
  },
  quote: {
    ...base,
    record: {
      text: '',
      embed: { $type: 'app.bsky.embed.record', record: { uri: ownPostUri } },
    },
  },
  quoteFeed: {
    ...base,
    record: {
      text: '',
      embed: {
        $type: 'app.bsky.embed.record',
        record: { uri: `at://${OTHER}/app.bsky.feed.generator/f` },
      },
    },
  },
  quoteListView: {
    ...base,
    record: { text: '   ' },
    embed: {
      $type: 'app.bsky.embed.record#view',
      record: { uri: `at://${OTHER}/app.bsky.graph.list/l` },
    },
  },
  quoteOddUri: {
    ...base,
    record: {
      text: '',
      embed: {
        $type: 'app.bsky.embed.record',
        record: { uri: `at://${OTHER}/app.bsky.graph.list/l?x` },
      },
    },
  },
  hasMedia: { ...base, record: { text: '' }, hasMedia: true },
  counts: {
    ...ownPostView,
    likeCount: 4,
    repostCount: 1,
    replyCount: 2,
    quoteCount: 1,
  },
  oddCounts: {
    ...ownPostView,
    likeCount: '4',
    likes: 9,
    repostCount: null,
    reposts: 2,
    replyCount: -0,
    quotes: 1.5,
  },
  quotesOff: {
    ...ownPostView,
    uri: 'at://did:plc:wren/app.bsky.feed.post/q',
    author: { did: 'did:plc:wren', handle: 'wren.example' },
    viewer: { embeddingDisabled: true },
  },
  ownQuotesOff: { ...ownPostView, viewer: { embeddingDisabled: true } },
  quotesOffTruthy: {
    ...theirView('t', 'truthy'),
    viewer: { embeddingDisabled: 'yes' },
  },
  multiline: {
    ...theirView(
      'ml',
      '\n\n   \n  The real first line  \n\n second\tline \n third  ',
    ),
  },
  unicode: theirView('u', `${FAMILY} famille été\nété ΟΔΟΣ`),
  indexedOnly: {
    uri: `at://${OTHER}/app.bsky.feed.post/i`,
    author: { did: OTHER, handle: 'luna.example' },
    record: { text: 'Indexed' },
    indexedAt: `${THIS_YEAR}-01-01T00:00:00.000Z`,
  },
  badDate: theirView('bd', 'bad', {
    record: { text: 'bad date', createdAt: 'not a date' },
  }),
  newYear: theirView('ny', 'new year', {
    record: { text: 'new year', createdAt: `${THIS_YEAR}-12-31T23:30:00Z` },
  }),
  lastYear: theirView('ly', 'last year', {
    record: {
      text: 'last year',
      createdAt: `${THIS_YEAR - 1}-12-31T23:30:00Z`,
    },
  }),
  noHandle: {
    uri: `at://${OTHER}/app.bsky.feed.post/nh`,
    author: { did: OTHER },
    record: { text: 'who?' },
  },
  empty: {},
};

export const PARENTS = {
  replyTo,
  long: {
    author: { handle: 'long.example' },
    record: {
      text: 'This first line runs on and on, well past the sixty graphemes a row can hold, so it gets cut.\nsecond',
    },
  },
  punct: {
    author: { handle: 'p.example' },
    record: {
      text: 'Short words, then punctuation!!! and then some more words follow here ok',
    },
  },
  noSpace: {
    author: { handle: 'ns.example' },
    record: { text: 'x'.repeat(80) },
  },
  emoji: {
    author: { handle: 'e.example' },
    record: { text: `${FAMILY}`.repeat(70) },
  },
  emptyText: { author: { handle: 'blank.example' }, record: { text: '' } },
  noHandle: { author: {}, record: { text: 'no handle' } },
  exactly60: {
    author: { handle: 'sixty.example' },
    record: { text: 'a'.repeat(60) },
  },
};

export const FEEDS = {
  mine: {
    uri: `at://${SELF}/app.bsky.feed.generator/moths`,
    cid: 'cf1',
    displayName: 'Moth photos',
    description: 'Posts tagged #mothing',
    creator: { did: SELF, handle: 'you.example' },
    indexedAt: '2026-10-01T00:00:00.000Z',
  },
  theirs: {
    uri: `at://${OTHER}/app.bsky.feed.generator/quiet`,
    cid: 'cf2',
    displayName: '  Quiet\n hours ',
    description: 'Slower posts\nfrom people you follow',
    creator: { did: OTHER, handle: 'luna.example' },
  },
  bare: { uri: 'at://x/app.bsky.feed.generator/f' },
  noCreator: { uri: 'at://x/app.bsky.feed.generator/g', displayName: '' },
  empty: {},
};

export const LISTS = {
  curate: {
    uri: `at://${SELF}/app.bsky.graph.list/people`,
    cid: 'cl1',
    name: 'Moth people',
    description: 'Accounts who post about moths',
    purpose: 'app.bsky.graph.defs#curatelist',
    creator: { did: SELF, handle: 'you.example' },
    indexedAt: '2026-09-01T00:00:00.000Z',
  },
  mod: {
    uri: `at://${SELF}/app.bsky.graph.list/mods`,
    name: 'Spam',
    purpose: 'app.bsky.graph.defs#modlist',
  },
  reference: {
    uri: `at://${SELF}/app.bsky.graph.list/ref`,
    name: '',
    purpose: 'app.bsky.graph.defs#referencelist',
  },
  theirs: {
    uri: `at://${OTHER}/app.bsky.graph.list/l`,
    name: 'Theirs',
    creator: { handle: 'luna.example' },
  },
  empty: {},
};

export const LINKS = {
  branding: {
    url: 'https://www.virga.example/branding/',
    title: 'Branding & Media Kit',
  },
  bareTitle: { url: 'https://atproto.example/', title: '' },
  dated: {
    url: 'https://a.example/x?q=1#h',
    title: '  Spaced\ttitle ',
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  notUrl: { url: 'not a url', title: 'Not a URL' },
  idn: { url: 'https://www.bücher.example/ü/', title: '' },
  wwwOnly: { url: 'https://www./' },
  trailing: { url: 'https://docs.example.org/a//b///' },
  noUrl: { title: 'Nothing' },
  empty: {},
};

export const ROWS = {
  post: {
    uri: `at://${SELF}/app.bsky.feed.post/a1`,
    rkey: 'a1',
    at: '2026-10-02T00:00:00.000Z',
    text: 'First line\nsecond',
    replyTo: null,
    hasMedia: true,
    likes: 3,
    reposts: 1,
    replies: 0,
    quotes: 0,
  },
  selfReply: {
    uri: `at://${SELF}/app.bsky.feed.post/a2`,
    at: '2026-10-03T00:00:00.000Z',
    text: 'Continuing my thread',
    replyTo: SELF,
    likes: 1,
  },
  reply: {
    uri: `at://${SELF}/app.bsky.feed.post/a3`,
    at: '2025-01-03T00:00:00.000Z',
    text: 'Replying to someone',
    replyTo: OTHER,
    hasMedia: false,
    likes: 10,
    reposts: 2,
    replies: 1,
    quotes: 1,
  },
  noText: {
    uri: `at://${SELF}/app.bsky.feed.post/a4`,
    at: '2026-08-01T00:00:00.000Z',
  },
  media: {
    uri: `at://${SELF}/app.bsky.feed.post/a5`,
    at: '2026-07-01T00:00:00.000Z',
    text: '',
    hasMedia: 1,
  },
  notMine: {
    uri: `at://${OTHER}/app.bsky.feed.post/b1`,
    at: '2026-10-05T00:00:00.000Z',
    text: 'Someone else',
  },
  badDate: {
    uri: `at://${SELF}/app.bsky.feed.post/a6`,
    at: 'yesterday',
    text: 'When?',
    likes: 2,
  },
  noUri: { at: '2026-10-05T00:00:00.000Z', text: 'No uri' },
  empty: {},
};
