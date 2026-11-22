// src/posting/library/model.js: the shelves, items of every kind, post
// pictures and titles, suggestions for a reply, local search, verbs and
// effects, the preview, the plan, caret-aware insertion, "/shortcut"
// detection and the slash menu's order. Swift:
// VirgaPosting/Library/Library*.swift.
//
// Inputs from model.test.js, plus posts in other zones and locales, odd
// counts, odd shapes, unicode and emoji, every preview note and block, and
// ranges outside the text. Every case runs on the fixed clock `now`
// (`new Date()` reads it): a post's date and a context's `today` read it.

import * as M from '../../../src/posting/library/model.js';
import { buildTemplateContext } from '../../../src/posting/templates/postTemplates.js';
import { each, toJSON, value } from './_helpers.js';
import {
  FAMILY,
  FEEDS,
  LINKS,
  LISTS,
  NOW,
  OTHER,
  PARENTS,
  POSTS,
  ROWS,
  SELF,
  TEMPLATES,
  appTemplate,
  ideaTemplate,
  linkTemplate,
  newPostContext,
  onClock,
  ownPostUri,
  ownPostView,
  ownView,
  replyContext,
  replyTo,
  stampTemplate,
  template,
} from './_library.js';

export const sources = ['src/posting/library/model.js'];

// Items are held once, in the ITEMS case, and an input names one as
// `{ $item: name }`: the fixture would otherwise repeat each template and
// view in every case that takes it.
let TABLE = {};
let names = new Map();
function refOf(obj) {
  if (!names.has(obj)) {
    const name = `i${names.size + 1}`;
    names.set(obj, name);
    TABLE[name] = obj;
  }
  return { $item: names.get(obj) };
}
const isItem = (v) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  typeof v.kind === 'string' &&
  typeof v.id === 'string' &&
  'key' in v;
function withRefs(v) {
  if (Array.isArray(v)) return v.map(withRefs);
  if (isItem(v)) return refOf(v);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = withRefs(x);
    return o;
  }
  return v;
}
/** each(), with the items in each input named rather than written out. */
async function eachRef(fn, inputs, compute) {
  const out = await each(fn, inputs, compute);
  return out.map((c, i) => {
    const input = { ...inputs[i] };
    delete input.$id;
    return { ...c, input: toJSON(withRefs(input)) ?? {} };
  });
}
const ids = (list) => list.map((i) => i.id);

// An item's members that are the input itself, written as a marker the
// Swift test puts back (`$template`, `$view`), so the fixture doesn't hold
// each template and view three times.
function marked(made, input, marker) {
  const out = { ...made };
  for (const key of ['source', 'template', 'view'])
    if (input !== undefined && out[key] === input) out[key] = marker;
  return out;
}
const markedPost = (view, opts) =>
  marked(M.itemFromPost(view, opts), view, '$view');

const clocked =
  (fn) =>
  ({ now = NOW, locale = 'en-US', zone = 'UTC', ...input }) =>
    onClock(() => fn(input), { now, locale, zone });

const at = (fn) => (input) => onClock(() => fn(input));

/** Items made on the library's clock. */
const item = {
  post: (view, opts) => at(() => M.itemFromPost(view, opts))(),
  template: (t, ctx, opts) => M.itemFromTemplate(t, ctx, opts),
  feed: (v, opts) => M.itemFromFeed(v, opts),
  list: (v) => M.itemFromList(v),
  link: (l) => M.itemFromLink(l),
};

const unresolved = buildTemplateContext({
  replyTo,
  self: {},
  now: new Date(NOW),
  locale: 'en-US',
});

const CONTEXTS = {
  reply: replyContext,
  newPost: newPostContext,
  hand: {
    their: { firstName: 'Ada' },
    my: { handle: 'me.example' },
    today: 'May 1',
  },
};

const ownPost = item.post(ownPostView, { selfDid: SELF });

/** Every kind of item, for the functions that take items. */
function allItems() {
  const t = (tpl, ctx = replyContext, opts) => item.template(tpl, ctx, opts);
  return {
    stamp: t(stampTemplate),
    stampHydrated: t(stampTemplate, replyContext, { embedView: ownPostView }),
    stampTheirs: t(stampTemplate, replyContext, { embedView: POSTS.theirs }),
    stampGone: t(stampTemplate, replyContext, { embedView: 'missing' }),
    idea: t(ideaTemplate),
    app: t(appTemplate),
    appNewPost: t(appTemplate, newPostContext),
    link: t(linkTemplate),
    linkGone: t(linkTemplate, replyContext, { embedView: 'missing' }),
    feed: t(TEMPLATES.feedTemplate),
    feedHydrated: t(TEMPLATES.feedTemplate, replyContext, {
      embedView: FEEDS.theirs,
    }),
    feedGone: t(TEMPLATES.feedTemplate, replyContext, { embedView: 'missing' }),
    list: t(TEMPLATES.listTemplate),
    listHydrated: t(TEMPLATES.listTemplate, replyContext, {
      embedView: LISTS.theirs,
    }),
    listGone: t(TEMPLATES.listTemplate, replyContext, { embedView: 'missing' }),
    images: t(TEMPLATES.imagesTemplate),
    emptyImages: t(TEMPLATES.emptyImagesTemplate),
    context: t(TEMPLATES.contextTemplate),
    family: t(TEMPLATES.emojiTemplate),
    emptyTemplate: t(template({ name: 'Nothing', text: '' }, 'nothing')),
    goneFeedOnly: t(
      template(
        {
          name: 'F',
          text: '',
          embed: {
            $type: 'app.bsky.embed.record',
            record: { uri: 'at://x/app.bsky.feed.generator/f', cid: 'c' },
          },
        },
        'f',
      ),
      replyContext,
      { embedView: 'missing' },
    ),
    goneListOnly: t(
      template(
        {
          name: 'L',
          text: ' ',
          embed: {
            $type: 'app.bsky.embed.record',
            record: { uri: 'at://x/app.bsky.graph.list/l', cid: 'c' },
          },
        },
        'l',
      ),
      replyContext,
      { embedView: 'missing' },
    ),
    goneOnly: t(
      template(
        {
          name: 'P',
          text: '',
          embed: {
            $type: 'app.bsky.embed.record',
            record: { uri: ownPostUri, cid: 'c' },
          },
        },
        'p',
      ),
      replyContext,
      { embedView: 'missing' },
    ),
    ownPost,
    theirPost: item.post(POSTS.theirs, { shelf: 'search', selfDid: SELF }),
    archived: at(() => M.itemFromArchiveRow(ROWS.post, { selfDid: SELF }))(),
    quotesOff: item.post(POSTS.quotesOff, { shelf: 'saved', selfDid: SELF }),
    pictured: item.post(POSTS.images, { selfDid: SELF }),
    linkItem: item.link({ url: 'https://docs.example.org/x', title: 'Docs' }),
    feedItem: item.feed({
      uri: 'at://x/app.bsky.feed.generator/f',
      cid: 'cf',
      displayName: 'Moths',
      creator: { handle: 'you.example' },
    }),
    feedNoCreator: item.feed({
      uri: 'at://x/app.bsky.feed.generator/g',
      displayName: 'G',
    }),
    listItem: item.list({
      uri: 'at://x/app.bsky.graph.list/l',
      cid: 'cl',
      name: 'Moth people',
      creator: { handle: 'luna.example' },
    }),
    listNoCreator: item.list({ uri: 'at://x/app.bsky.graph.list/m' }),
    nothing: { kind: 'nothing', id: 'nothing' },
  };
}

export default async function cases() {
  TABLE = {};
  names = new Map();
  const ITEMS = allItems();
  const out = [
    value('LIBRARY_NAME', M.LIBRARY_NAME),
    value('LIBRARY_SHELVES', M.LIBRARY_SHELVES),
    value('BLOCKED_QUOTES_OFF', M.BLOCKED_QUOTES_OFF),
  ];

  out.push(
    ...(await each(
      'shelvesFor',
      [{ replying: true }, { replying: false }, {}],
      ({ replying }) => M.shelvesFor({ replying }),
    )),
    ...(await each(
      'openingShelf',
      [{ replying: true }, { replying: false }, {}],
      ({ replying }) => M.openingShelf({ replying }),
    )),
  );

  const postInputs = Object.entries(POSTS).map(([$id, post]) => ({
    $id,
    post,
  }));
  out.push(
    ...(await each(
      'postMedia',
      [...postInputs, { $id: 'undefined' }],
      ({ post }) => M.postMedia(post),
    )),
    ...(await each(
      'engagementScore',
      [
        ...postInputs,
        { $id: 'row', post: ROWS.reply },
        { $id: 'both', post: { likes: 2, quotes: 1 } },
        { $id: 'nullCounts', post: { likeCount: null, likes: 3 } },
        { $id: 'undefined' },
        { $id: 'zero', post: 0 },
      ],
      ({ post }) => M.engagementScore(post),
    )),
    ...(await each(
      'isOwnThreadPost',
      [
        ...postInputs,
        {
          $id: 'bare',
          post: { uri: `at://${SELF}/app.bsky.feed.post/1`, record: {} },
        },
        { $id: 'undefined' },
        {
          $id: 'authorDidWins',
          post: {
            uri: `at://${OTHER}/app.bsky.feed.post/x`,
            author: { did: SELF },
            record: {
              reply: { root: { uri: ownPostUri }, parent: { uri: ownPostUri } },
            },
          },
        },
        {
          $id: 'prefixOnly',
          post: {
            uri: 'at://did:plc:sel/app.bsky.feed.post/x',
            record: { reply: { root: { uri: ownPostUri } } },
          },
        },
      ],
      ({ post }) => M.isOwnThreadPost(post),
    )),
    ...(await each(
      'isOwnThreadRow',
      [
        ...Object.entries(ROWS).map(([$id, row]) => ({
          $id,
          row,
          selfDid: SELF,
        })),
        { $id: 'noSelf', row: ROWS.selfReply },
        { $id: 'undefined', selfDid: SELF },
        { $id: 'emptyReplyTo', row: { replyTo: '' }, selfDid: SELF },
      ],
      ({ row, selfDid }) => M.isOwnThreadRow(row, selfDid),
    )),
  );

  // Templates as items, in every context and with every embed view.
  const templateInputs = [];
  for (const [name, t] of Object.entries(TEMPLATES)) {
    for (const [ctxName, context] of Object.entries(CONTEXTS)) {
      templateInputs.push({ $id: `${name}-${ctxName}`, template: t, context });
    }
    templateInputs.push(
      {
        $id: `${name}-missing`,
        template: t,
        context: replyContext,
        embedView: 'missing',
      },
      {
        $id: `${name}-view`,
        template: t,
        context: replyContext,
        embedView: ownPostView,
      },
      { $id: `${name}-noContext`, template: t },
    );
  }
  templateInputs.push(
    {
      $id: 'one-question',
      template: template({ name: 'One', text: 'Try {{thing}}' }, 'one'),
      context: replyContext,
    },
    {
      $id: 'unnamed',
      template: template({ name: '  ', text: '' }, 'u'),
      context: replyContext,
    },
    {
      $id: 'raw',
      template: {
        rkey: 5,
        name: 'Raw',
        text: 'raw {{x}}',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    },
    {
      $id: 'raw-created',
      template: { name: 'C', createdAt: '2026-02-01T00:00:00Z', shortcut: 'C' },
    },
    { $id: 'undefined' },
  );
  out.push(
    ...(await each(
      'itemFromTemplate',
      templateInputs,
      ({ template: t, context, embedView }) =>
        marked(
          M.itemFromTemplate(
            t,
            context,
            embedView === undefined ? {} : { embedView },
          ),
          t,
          '$template',
        ),
    )),
  );

  // Posts on every shelf, with and without the account, a parent, in a few
  // zones and locales.
  const postItemInputs = [];
  for (const [name, view] of Object.entries(POSTS)) {
    postItemInputs.push({ $id: name, view, shelf: 'posts', selfDid: SELF });
  }
  for (const shelf of [
    'posts',
    'replies',
    'saved',
    'suggested',
    'search',
    undefined,
  ]) {
    for (const name of [
      'own',
      'reply',
      'selfReply',
      'replyInOwnThread',
      'theirs',
    ]) {
      postItemInputs.push({
        $id: `${name}-${shelf}`,
        view: POSTS[name],
        shelf,
        selfDid: SELF,
      });
    }
  }
  for (const [name, parentView] of Object.entries(PARENTS)) {
    postItemInputs.push({
      $id: `parent-${name}`,
      view: POSTS.reply,
      shelf: 'replies',
      selfDid: SELF,
      parentView,
    });
  }
  postItemInputs.push(
    { $id: 'noSelf', view: POSTS.own },
    { $id: 'undefined' },
    { $id: 'otherSelf', view: POSTS.theirs, selfDid: OTHER },
  );
  for (const zone of [
    'Pacific/Kiritimati',
    'America/Los_Angeles',
    'Asia/Kolkata',
  ]) {
    for (const name of ['newYear', 'lastYear', 'own', 'older']) {
      postItemInputs.push({
        $id: `${name}-${zone}`,
        view: POSTS[name],
        selfDid: SELF,
        zone,
      });
    }
  }
  for (const locale of ['en-GB', 'en-DE', 'en-IN']) {
    for (const name of ['own', 'older', 'lastYear']) {
      postItemInputs.push({
        $id: `${name}-${locale}`,
        view: POSTS[name],
        selfDid: SELF,
        locale,
      });
    }
  }
  postItemInputs.push({
    $id: 'january-now',
    view: POSTS.lastYear,
    selfDid: SELF,
    now: '2027-01-02T00:00:00.000Z',
  });
  out.push(
    ...(await each(
      'itemFromPost',
      postItemInputs,
      clocked(({ view, shelf, selfDid, parentView }) =>
        markedPost(view, {
          ...(shelf === undefined ? {} : { shelf }),
          selfDid,
          parentView,
        }),
      ),
    )),
    ...(await eachRef(
      'markQuotesOff',
      [
        { $id: 'post', item: ownPost },
        { $id: 'already', item: ITEMS.quotesOff },
        { $id: 'noLabel', item: { ...ownPost, label: '', subtitle: '' } },
      ],
      ({ item: i }) => M.markQuotesOff(i),
    )),
  );

  const rowInputs = [];
  for (const [name, row] of Object.entries(ROWS)) {
    rowInputs.push({ $id: name, row, selfDid: SELF });
    rowInputs.push({
      $id: `${name}-replies`,
      row,
      shelf: 'replies',
      selfDid: SELF,
    });
  }
  rowInputs.push(
    { $id: 'noSelf', row: ROWS.selfReply },
    { $id: 'emptyShelf', row: ROWS.reply, shelf: '', selfDid: SELF },
    { $id: 'undefined' },
    { $id: 'kolkata', row: ROWS.post, selfDid: SELF, zone: 'Asia/Kolkata' },
  );
  out.push(
    ...(await each(
      'itemFromArchiveRow',
      rowInputs,
      clocked(({ row, shelf, selfDid }) =>
        M.itemFromArchiveRow(row, {
          ...(shelf === undefined ? {} : { shelf }),
          selfDid,
        }),
      ),
    )),
    ...(await each(
      'itemFromLink',
      [
        ...Object.entries(LINKS).map(([$id, link]) => ({ $id, link })),
        { $id: 'undefined' },
      ],
      ({ link }) => M.itemFromLink(link),
    )),
  );

  const feedInputs = [];
  for (const [name, view] of Object.entries(FEEDS)) {
    for (const group of ['yours', 'saved', 'search', undefined]) {
      feedInputs.push({ $id: `${name}-${group}`, view, group });
    }
  }
  feedInputs.push({ $id: 'undefined' });
  out.push(
    ...(await each('itemFromFeed', feedInputs, ({ view, group }) =>
      M.itemFromFeed(view, group === undefined ? {} : { group }),
    )),
    ...(await each(
      'itemFromList',
      [
        ...Object.entries(LISTS).map(([$id, view]) => ({ $id, view })),
        { $id: 'undefined' },
      ],
      ({ view }) => M.itemFromList(view),
    )),
  );

  // sortItems over real items, and model.test.js's partial ones (by id).
  const sortable = [
    ITEMS.ownPost,
    ITEMS.archived,
    item.post(POSTS.counts, { selfDid: SELF }),
    item.post(POSTS.oddCounts, { selfDid: SELF }),
    item.post(POSTS.badDate, { selfDid: SELF }),
    item.post(POSTS.indexedOnly, { selfDid: SELF }),
    item.post(POSTS.newYear, { selfDid: SELF }),
    ITEMS.linkItem,
    item.link(LINKS.dated),
    ITEMS.stamp,
  ];
  const a = { id: 'a', at: '2026-10-01T00:00:00Z', score: 5 };
  const b = { id: 'b', at: '2026-10-03T00:00:00Z', score: 1 };
  const c = { id: 'c', at: '2026-10-02T00:00:00Z', score: 5 };
  const d = { id: 'd', at: null, score: 5 };
  const e = { id: 'e', at: '2026-10-02T00:00', score: 0 };
  out.push(
    ...(await eachRef(
      'sortItems',
      [
        { $id: 'items-date', items: sortable },
        { $id: 'items-engagement', items: sortable, by: 'engagement' },
        { $id: 'items-default', items: sortable, by: undefined },
        { $id: 'items-other', items: sortable, by: 'other' },
        { $id: 'partial-date', items: [a, b, c, d, e] },
        { $id: 'partial-engagement', items: [a, b, c, d, e], by: 'engagement' },
        { $id: 'none', items: null },
        { $id: 'kolkata', items: [a, b, c, d, e], zone: 'Asia/Kolkata' },
      ],
      ({ items, by, zone = 'UTC' }) =>
        onClock(
          () => {
            const sorted =
              by === undefined ? M.sortItems(items) : M.sortItems(items, by);
            return ids(sorted);
          },
          { zone },
        ),
    )),
  );

  out.push(...(await suggestionCases()));
  out.push(...(await searchCases(ITEMS)));

  out.push(
    ...(await eachRef(
      'verbFor',
      [
        ...Object.entries(ITEMS).flatMap(([$id, i]) => [
          { $id, item: i },
          { $id: `${$id}-replying`, item: i, replying: true },
        ]),
        { $id: 'undefined' },
      ],
      ({ item: i, replying }) => M.verbFor(i, { replying }),
    )),
    ...(await eachRef(
      'effectFor',
      [
        ...Object.entries(ITEMS).flatMap(([$id, i]) => [
          { $id, item: i, context: replyContext },
          { $id: `${$id}-newPost`, item: i, context: newPostContext },
          { $id: `${$id}-noContext`, item: i },
        ]),
        {
          $id: 'bug-one-question',
          item: item.template(
            template(
              {
                name: 'Bug',
                text: 'Which {{device}}?',
                embed: stampTemplate.embed,
              },
              'bug',
            ),
            replyContext,
            { embedView: ownPostView },
          ),
          context: replyContext,
        },
        { $id: 'undefined' },
      ],
      ({ item: i, context }) => M.effectFor(i, context),
    )),
  );

  out.push(...(await contextCases()));
  out.push(...(await insertCases()));
  out.push(...(await previewCases(ITEMS)));
  out.push(...(await planCases(ITEMS)));
  out.push(...(await slashCases()));
  out.push(value('ITEMS', TABLE));
  return out;
}

async function suggestionCases() {
  const templates = [
    appTemplate,
    stampTemplate,
    TEMPLATES.postOnlyTemplate,
  ].map((t) => item.template(t, replyContext));
  const mothsUri = `at://${SELF}/app.bsky.feed.post/moths`;
  const posts = [
    item.post(ownPostView, { selfDid: SELF }),
    item.post(
      {
        ...ownPostView,
        uri: mothsUri,
        record: {
          text: 'Moth walks need patience and stamina',
          createdAt: NOW,
        },
      },
      { selfDid: SELF },
    ),
    item.post(
      {
        ...ownPostView,
        uri: `at://${SELF}/app.bsky.feed.post/unrelated`,
        record: { text: 'Soup tonight', createdAt: NOW },
      },
      { selfDid: SELF },
    ),
  ];
  const feeds = [
    item.feed(
      {
        uri: `at://${SELF}/app.bsky.feed.generator/m`,
        displayName: 'Moth photos',
      },
      { group: 'yours' },
    ),
  ];
  const own = (rkey, text) => item.post(ownView(rkey, text), { selfDid: SELF });
  const fixtureParent =
    'why does virga have a stamina bar lol. feels like a game telling me to go outside. also is there a feed for moth photos?';
  const feed = (n) =>
    item.feed({
      uri: `at://${SELF}/app.bsky.feed.generator/f${n}`,
      displayName: `Moth ${['alpha', 'beta', 'gamma', 'delta', 'omega'][n]}`,
    });
  const four = [0, 1, 2, 3].map(feed);
  const bakers = [1, 2, 3, 4].map((n) =>
    item.list({
      uri: `at://${SELF}/app.bsky.graph.list/l${n}`,
      name: `Bakers ${n}`,
    }),
  );
  const many = item.template(
    template(
      { name: 'Both', text: 'x', keywords: ['stamina', 'walks'] },
      'both',
    ),
    replyContext,
  );
  const three = item.template(
    template(
      {
        name: 'Three',
        text: 'x',
        keywords: ['stamina', 'walks', 'moth', 'running'],
      },
      'three',
    ),
    replyContext,
  );
  const parentItem = item.post(
    { ...replyTo, record: { text: 'Moth walks and stamina' } },
    { selfDid: SELF },
  );
  const reply = at(() =>
    M.itemFromPost(
      {
        ...ownPostView,
        uri: `at://${SELF}/app.bsky.feed.post/r`,
        record: { text: 'Soup tonight', createdAt: NOW },
      },
      {
        shelf: 'replies',
        selfDid: SELF,
        parentView: {
          author: { handle: 'moss.example' },
          record: { text: 'moth walks and stamina' },
        },
      },
    ),
  )();
  const words = (rkey, text) => own(rkey, text);
  const oddKinds = [
    {
      ...feeds[0],
      id: 'proto-1',
      kind: 'toString',
      title: 'Moth photos',
      excerpt: '',
    },
    {
      ...feeds[0],
      id: 'proto-2',
      kind: 'constructor',
      title: 'Moth photos',
      excerpt: '',
    },
    {
      ...feeds[0],
      id: 'proto-3',
      kind: '__proto__',
      title: 'Moth photos',
      excerpt: '',
    },
    {
      ...feeds[0],
      id: 'proto-4',
      kind: 'hasOwnProperty',
      title: 'Moth photos',
      excerpt: '',
    },
    {
      ...feeds[0],
      id: 'link-1',
      kind: 'link',
      title: 'Moth photos',
      excerpt: '',
    },
  ];
  return eachRef(
    'suggestItems',
    [
      {
        $id: 'fixture',
        templates,
        posts,
        feeds,
        lists: [],
        parentText: replyTo.record.text,
      },
      {
        $id: 'limit-1',
        templates,
        posts,
        feeds,
        lists: [],
        parentText: replyTo.record.text,
        limit: 1,
      },
      {
        $id: 'limit-0',
        templates,
        posts,
        parentText: replyTo.record.text,
        limit: 0,
      },
      { $id: 'blank-parent', templates, posts, parentText: '  \n ' },
      { $id: 'no-parent', templates, posts },
      {
        $id: 'two-or-long',
        posts: [
          own('two', 'Lost a game save once, here is what helped'),
          own('one', 'The game is quiet at night'),
        ],
        parentText: 'My game save is gone again',
      },
      {
        $id: 'distinctive',
        posts: [
          own(
            'stamina',
            "A few words on stamina, since it comes up a lot.\nIt starts at 100 and refills at 2 a minute while you're away.",
          ),
          own(
            'pds',
            "Your game progress, lists, settings and mutes live on your own PDS.\nThat's why they follow you from your phone to your laptop.",
          ),
          own(
            'name',
            "Why the name: Virga is a genus of North American silk moths.\nThe levels follow a moth's life, from caterpillar to cocoon to moth.",
          ),
        ],
        feeds: [
          item.feed({
            uri: `at://${SELF}/app.bsky.feed.generator/moth-photos`,
            displayName: 'Moth photos',
            description: 'Posts tagged #mothing that include a photo',
          }),
          item.feed(
            {
              uri: `at://${OTHER}/app.bsky.feed.generator/quiet`,
              displayName: 'Quiet hours',
              description: 'Slower posts from people you follow',
            },
            { group: 'saved' },
          ),
        ],
        lists: [
          item.list({
            uri: `at://${SELF}/app.bsky.graph.list/moth-people`,
            name: 'Moth people',
            description: 'Accounts who post about moths',
          }),
        ],
        parentText: fixtureParent,
      },
      { $id: 'four-feeds', feeds: four, parentText: 'moth season' },
      {
        $id: 'five-feeds',
        feeds: [...four, feed(4)],
        parentText: 'moth season',
      },
      {
        $id: 'one-in-five',
        feeds: [feed(0)],
        lists: bakers,
        parentText: 'moth season',
      },
      {
        $id: 'contractions',
        posts: [own('c', "I can't believe it doesn't load, don't ask")],
        parentText: "I don't know why it doesn't work",
      },
      {
        $id: 'unpunctuated',
        lists: [
          item.list({
            uri: `at://${SELF}/app.bsky.graph.list/u`,
            name: 'dont youre doesnt wont',
          }),
        ],
        parentText: 'dont youre doesnt wont',
      },
      {
        $id: 'curly',
        lists: [
          item.list({
            uri: `at://${SELF}/app.bsky.graph.list/folks`,
            name: 'Folks you’re missing',
          }),
        ],
        parentText: "you're right",
      },
      {
        $id: 'platform',
        feeds: [
          item.feed({
            uri: `at://${SELF}/app.bsky.feed.generator/art`,
            displayName: 'Bluesky art',
          }),
        ],
        parentText: 'I love Bluesky and Anisota so much',
      },
      {
        $id: 'possessive',
        feeds: [
          item.feed({
            uri: `at://${SELF}/app.bsky.feed.generator/moths`,
            displayName: 'Moths at night',
          }),
        ],
        parentText: "the moth's wings",
      },
      {
        $id: 'hits-order',
        templates: [...templates, many, three],
        parentText: replyTo.record.text,
      },
      {
        $id: 'parent-left-out',
        posts: [parentItem],
        parentText: replyTo.record.text,
        parentUri: replyTo.uri,
      },
      {
        $id: 'parent-uri-other',
        posts: [parentItem],
        parentText: replyTo.record.text,
        parentUri: 'at://else',
      },
      {
        $id: 'bare',
        templates: [stampTemplate, null, TEMPLATES.postOnlyTemplate],
        feeds: [
          {
            uri: `at://${SELF}/app.bsky.feed.generator/m`,
            displayName: 'Moth photos',
          },
        ],
        posts: [ownPostView, { ...ownView('w', 'moth walks'), cid: undefined }],
        lists: [
          { uri: `at://${SELF}/app.bsky.graph.list/x`, name: 'Stamina club' },
        ],
        parentText: replyTo.record.text,
        context: replyContext,
        selfDid: SELF,
      },
      {
        $id: 'reply-own-words',
        posts: [reply],
        parentText: replyTo.record.text,
      },
      {
        $id: 'stopwords-links-handles',
        feeds: [
          item.feed(
            {
              uri: 'at://x/app.bsky.feed.generator/y',
              displayName: 'Things about that example',
            },
            { group: 'saved' },
          ),
        ],
        parentText:
          'things about that https://example.com/x @example.bsky.social',
      },
      {
        $id: 'links-case',
        feeds: [
          item.feed({
            uri: 'at://x/app.bsky.feed.generator/z',
            displayName: 'Examples gallery',
          }),
        ],
        parentText:
          'HTTPS://examples.gallery.example/a and Https://gallery.example',
      },
      {
        $id: 'plurals',
        posts: [
          words('p1', 'glasses classes buses kisses'),
          words('p2', 'buss glass class'),
        ],
        parentText: 'glass class bus kiss',
      },
      {
        $id: 'unicode-words',
        posts: [
          words('u1', 'Müller straße naïve café ΟΔΟΣ ΚΑΛΗΜΕΡΑ'),
          words('u2', 'Ünïcode ﬁnally İstanbul'),
          words('u3', 'été café décor'),
          words('u4', `${FAMILY} 東京タワー 東京 ٣٤٥٦ ১২৩৪`),
        ],
        parentText:
          'müller STRASSE naive cafe οδος καλημερα ünïcode finally istanbul été café décor 東京タワー ٣٤٥٦',
      },
      {
        $id: 'apostrophes',
        posts: [
          words('a1', "moths' moth’s rock'n'roll o'clock y’all"),
          words('a2', "James's Bess's"),
        ],
        parentText: "moths rock'n'roll james bess's o’clock",
      },
      {
        $id: 'numbers',
        posts: [words('n1', '12345 2026 1234a')],
        parentText: 'the 12345 2026 1234a',
      },
      { $id: 'odd-kinds', feeds: oddKinds, parentText: 'moth photos' },
      {
        $id: 'odd-kinds-common',
        feeds: [...oddKinds, ...four],
        parentText: 'moth photos alpha',
      },
      {
        $id: 'duplicates',
        posts: [posts[1], posts[1]],
        feeds: [...feeds, ...feeds],
        parentText: replyTo.record.text,
      },
      {
        $id: 'templates-only-replies',
        templates: [
          item.template(TEMPLATES.postOnlyTemplate, replyContext),
          item.template(TEMPLATES.emojiTemplate, replyContext),
        ],
        parentText: 'A unicode FAMILY trip, ünïcode',
      },
    ],
    ({ templates: t, posts: p, feeds: f, lists: l, ...rest }) =>
      onClock(() =>
        M.suggestItems({
          templates: t,
          posts: p,
          feeds: f,
          lists: l,
          ...rest,
        }).map((i) => ({
          id: i.id,
          shelf: i.shelf,
          reason: i.reason,
        })),
      ),
  );
}

async function searchCases(ITEMS) {
  const items = [
    item.template(stampTemplate, replyContext),
    item.template(ideaTemplate, replyContext),
    item.template(appTemplate, replyContext),
    ownPost,
    item.link({ url: 'https://docs.example.org/stamina', title: 'Docs' }),
  ];
  const pictured = item.post(
    {
      uri: `at://${SELF}/app.bsky.feed.post/pic`,
      author: { did: SELF, handle: 'you.example' },
      record: {
        text: '',
        createdAt: '2026-10-29T12:00:00Z',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'Clouds over the Blue Ridge' }],
        },
      },
    },
    { selfDid: SELF },
  );
  const all = Object.values(ITEMS);
  const twins = [
    item.template(
      template({ name: 'Twin A', text: 'a', shortcut: 'twin' }, 'twin'),
      replyContext,
    ),
    item.template(
      template({ name: 'Twin B', text: 'b', shortcut: 'twin' }, 'twin'),
      replyContext,
    ),
  ];
  return [
    ...(await eachRef(
      'searchItems',
      [
        { $id: 'upper', items, query: 'STAMINA' },
        { $id: 'label', items, query: 'link · docs' },
        { $id: 'blank', items, query: '   ' },
        { $id: 'alt', items: [...items, pictured], query: 'blue ridge' },
        { $id: 'slash', items, query: '/sta', replying: true },
        { $id: 'bare-slash', items, query: '/', replying: true },
        { $id: 'bare-slash-post', items, query: '/', replying: false },
        { $id: 'slash-none', items, query: '/zzz' },
        { $id: 'slash-name', items, query: '/thanks', replying: true },
        { $id: 'doubled', items: [...items, items[0]], query: 'stamina' },
        { $id: 'all-the', items: all, query: 'the' },
        { $id: 'all-slash', items: all, query: ' / ', replying: true },
        { $id: 'twins', items: twins, query: '/twin' },
        {
          $id: 'sigma',
          items: [
            item.feed({
              uri: 'at://x/app.bsky.feed.generator/s',
              displayName: 'ΟΔΟΣ',
            }),
          ],
          query: 'οδος',
        },
        {
          $id: 'dotted',
          items: [
            item.feed({
              uri: 'at://x/app.bsky.feed.generator/i',
              displayName: 'İstanbul',
            }),
          ],
          query: 'i̇stan',
        },
        {
          $id: 'nfc',
          items: [
            item.feed({
              uri: 'at://x/app.bsky.feed.generator/c',
              displayName: 'café',
            }),
          ],
          query: 'café',
        },
        { $id: 'none', items: null, query: 'x' },
        { $id: 'undefined-query', items },
      ],
      ({ items: list, query, replying }) =>
        ids(M.searchItems(list, query, { replying })),
    )),
    ...(await eachRef(
      'dedupeById',
      [
        {
          $id: 'set',
          items: [...items, items[0]],
          seenIds: ['template:stamina'],
          asSet: true,
        },
        {
          $id: 'array',
          items: [...items, items[0]],
          seenIds: ['template:idea'],
        },
        { $id: 'none', items: [...items, items[0]] },
        { $id: 'null-items', items: null },
        {
          $id: 'nfc',
          items: [
            { ...items[0], id: 'x:é' },
            { ...items[0], id: 'x:é' },
          ],
        },
      ],
      ({ items: list, seenIds, asSet }) =>
        ids(M.dedupeById(list, asSet ? new Set(seenIds) : seenIds)),
    )),
  ];
}

async function contextCases() {
  const reply = {
    uri: replyTo.uri,
    cid: 'c',
    root: { uri: replyTo.uri, cid: 'c' },
    author: replyTo.author,
    text: replyTo.record.text,
  };
  const stateWith = (post, r = null) => ({
    posts: [
      {
        id: 'p',
        text: '',
        images: [],
        video: null,
        record: null,
        card: null,
        ...post,
      },
    ],
    reply: r,
  });
  return [
    ...(await each(
      'libraryContext',
      [
        {
          $id: 'reply',
          reply,
          selfHandle: 'me.example',
          now: NOW,
          locale: 'en-US',
        },
        {
          $id: 'state',
          state: stateWith({}, reply),
          selfHandle: 'me.example',
          now: NOW,
        },
        {
          $id: 'state-null-reply',
          state: stateWith({}, reply),
          reply: null,
          now: NOW,
        },
        { $id: 'no-author', reply: { text: 'x' }, now: NOW },
        {
          $id: 'text-not-string',
          reply: { author: { handle: 'a.example' }, text: 5 },
          now: NOW,
        },
        { $id: 'nothing', now: NOW },
        { $id: 'empty-handle', selfHandle: '', now: NOW, locale: 'en-GB' },
        {
          $id: 'emoji',
          reply: {
            author: { displayName: `${FAMILY} Sam`, handle: 's.example' },
          },
          now: '2026-02-28T23:59:00.000Z',
          locale: 'en-IN',
        },
      ],
      ({ now, ...input }) => M.libraryContext({ ...input, now: new Date(now) }),
    )),
    ...(await each(
      'attachmentsFromState',
      [
        { $id: 'empty', state: stateWith({}) },
        {
          $id: 'everything',
          state: stateWith({
            record: {
              kind: 'post',
              uri: ownPostUri,
              cid: 'c',
              view: ownPostView,
            },
            card: { url: 'https://a.example', title: '' },
            images: [{ id: 'i' }],
          }),
        },
        {
          $id: 'feed',
          state: stateWith({
            record: {
              kind: 'feed',
              uri: 'at://x/app.bsky.feed.generator/f',
              view: { displayName: 'F' },
            },
          }),
        },
        {
          $id: 'feed-by',
          state: stateWith({
            record: {
              kind: 'feed',
              uri: 'at://x/app.bsky.feed.generator/f',
              view: {
                displayName: '  Moths\n',
                creator: { handle: 'c.example' },
              },
            },
            video: { id: 'v' },
            images: [{ id: 'i' }],
          }),
        },
        {
          $id: 'list-name',
          state: stateWith({
            record: {
              kind: 'list',
              uri: 'at://x/app.bsky.graph.list/l',
              view: { name: 'People' },
            },
          }),
        },
        {
          $id: 'starterpack',
          state: stateWith({
            record: {
              kind: 'starterpack',
              uri: 'at://x/app.bsky.graph.starterpack/s',
              view: {
                record: { name: 'Starter' },
                creator: { handle: 'sp.example' },
              },
            },
          }),
        },
        {
          $id: 'unknown-kind',
          state: stateWith({
            record: { kind: 'labeler', uri: 'at://x/y/z', view: {} },
          }),
        },
        {
          $id: 'post-no-view',
          state: stateWith({ record: { uri: ownPostUri } }),
        },
        {
          $id: 'post-image-title',
          state: stateWith({
            record: {
              uri: ownPostUri,
              view: {
                author: { handle: 'h.example' },
                record: { text: '' },
                embed: { $type: 'app.bsky.embed.images#view' },
              },
            },
          }),
        },
        {
          $id: 'card-title',
          state: stateWith({ card: { url: 'https://b.example', title: 'B' } }),
        },
        {
          $id: 'second-post',
          state: { posts: [{}, { text: 'two', images: [1] }] },
          postIndex: 1,
        },
        { $id: 'out-of-range', state: stateWith({}), postIndex: 3 },
        { $id: 'no-state' },
      ],
      ({ state, postIndex }) =>
        postIndex === undefined
          ? M.attachmentsFromState(state)
          : M.attachmentsFromState(state, postIndex),
    )),
  ];
}

const TEXTS = [
  '',
  'Hello',
  'a\nb',
  'Thanks /idea',
  'a /x b',
  'Look at this thread',
  'Try /fe this',
  'a\t/x\tb',
  `${FAMILY}x`,
  'é /sc b',
];
const RANGES = [
  undefined,
  null,
  { start: 0, end: 0 },
  { start: 1, end: 1 },
  { start: 2, end: 4 },
  { start: 4, end: 2 },
  { start: 7, end: 12 },
  { start: 99, end: 120 },
  { start: -3, end: 2 },
  { start: 1.9, end: 3.1 },
  { start: '1', end: '3' },
  { start: Number.NaN, end: 2 },
  { end: 3 },
];
const ADDITIONS = [null, '', 'X', ' lead', 'trail ', 'Thank you.', '\nline'];

async function insertCases() {
  // One case per text and range, with every addition in turn.
  const inputs = [];
  for (const text of TEXTS)
    for (const range of RANGES)
      inputs.push({ text, range, insertions: ADDITIONS });
  inputs.push(
    { text: 'Hello', insertions: ['there'] },
    { text: 5, insertions: [7], range: { start: 1, end: 1 } },
  );
  return [
    ...(await each('insertText', inputs, ({ text, insertions, range }) =>
      insertions.map((insertion) =>
        range === undefined
          ? M.insertText(text, insertion)
          : M.insertText(text, insertion, range),
      ),
    )),
    ...(await each(
      'replyTextWithoutSlash',
      [
        { text: 'Thanks /idea', insertion: { start: 7, end: 12 } },
        { text: 'Thanks Moss', insertion: { start: 7, end: 11 } },
        { text: 'Thanks', insertion: null },
        { text: 'a /x b', insertion: { start: 2, end: 4 } },
        { text: 'a /x and more', insertion: { start: 2, end: 13 } },
        { text: 'a /x', insertion: { start: -2, end: 4 } },
        { text: 'a /x', insertion: { start: 2, end: 2 } },
        { text: 'a /x', insertion: { start: 2.5, end: 4 } },
        { text: '/x', insertion: { start: 0, end: 99 } },
        { text: 5, insertion: { start: 0, end: 1 } },
        { text: '/x', insertion: { start: 0 } },
      ],
      ({ text, insertion }) => M.replyTextWithoutSlash(text, insertion),
    )),
  ];
}

async function previewCases(ITEMS) {
  const stateWith = (post, r = null) => ({
    posts: [
      {
        id: 'p',
        text: '',
        images: [],
        video: null,
        record: null,
        card: null,
        ...post,
      },
    ],
    reply: r,
  });
  const reply = {
    uri: replyTo.uri,
    author: replyTo.author,
    text: replyTo.record.text,
  };
  const ATTACHMENTS = {
    none: { record: null, link: null, media: null },
    record: { record: { by: 'x', title: 'y' }, link: null, media: null },
    partialRecord: { record: { by: 'x' }, link: null, media: null },
    link: {
      record: null,
      link: { url: 'https://a.example', title: 'A' },
      media: null,
    },
    linkImages: {
      record: null,
      link: { url: 'https://a.example', title: 'A' },
      media: 'images',
    },
    video: { record: null, link: null, media: 'video' },
    images: { record: null, link: null, media: 'images' },
  };
  // What each slot does with what a post already carries.
  const ATTACHED = [
    'stampHydrated',
    'stampGone',
    'link',
    'feedHydrated',
    'images',
    'emptyTemplate',
    'ownPost',
    'quotesOff',
    'linkItem',
    'feedItem',
    'listItem',
    'nothing',
  ];
  const inputs = [];
  for (const [name, i] of Object.entries(ITEMS)) {
    inputs.push({ $id: name, item: i, opts: { context: replyContext } });
    inputs.push({
      $id: `${name}-locked`,
      item: i,
      opts: { context: replyContext, quoteSlotLocked: true },
    });
    for (const [aName, attachments] of Object.entries(ATTACHMENTS)) {
      if (aName === 'none' || !ATTACHED.includes(name)) continue;
      inputs.push({
        $id: `${name}-${aName}`,
        item: i,
        opts: { context: replyContext, attachments },
      });
    }
    inputs.push({
      $id: `${name}-selection`,
      item: i,
      opts: {
        currentText: 'Look at this thread',
        insertion: { start: 8, end: 19 },
        context: replyContext,
      },
    });
    inputs.push({
      $id: `${name}-slash`,
      item: i,
      opts: {
        currentText: 'Try /fe this',
        insertion: { start: 4, end: 7 },
        context: replyContext,
      },
    });
  }
  const idea = ITEMS.idea;
  inputs.push(
    {
      $id: 'joins',
      item: idea,
      opts: {
        currentText: 'Hello there/idea and more',
        insertion: { start: 11, end: 16 },
        answers: { idea: 'pinned feeds', when: 'Soon.' },
        context: replyContext,
      },
    },
    {
      $id: 'optional-empty',
      item: idea,
      opts: {
        currentText: '',
        answers: { idea: 'pins' },
        context: replyContext,
      },
    },
    {
      $id: 'blank-label',
      item: idea,
      opts: { currentText: '', answers: {}, context: replyContext },
    },
    {
      $id: 'inline-link',
      item: ITEMS.app,
      opts: {
        currentText:
          'See [the docs](https://docs.example.org/a/very/long/path/indeed).',
        context: replyContext,
        maxLength: 300,
      },
    },
    {
      $id: 'over-limit',
      item: ITEMS.app,
      opts: {
        currentText:
          'See [the docs](https://docs.example.org/a/very/long/path/indeed).',
        context: replyContext,
        maxLength: 20,
      },
    },
    {
      $id: 'spacing',
      item: item.template(
        template(
          {
            name: 'Glad',
            text: 'Glad you like it :) see you ;)\nCode:\n    indented. Bonjour {{their.firstName}} ! Ça va ?',
          },
          'glad',
        ),
        replyContext,
      ),
      opts: { currentText: '', context: replyContext },
    },
    {
      $id: 'context-answered',
      item: item.template(
        template({ name: 'Me', text: "I'm {{my.handle}}" }, 'me'),
        unresolved,
      ),
      opts: {
        currentText: '',
        answers: { 'my.handle': '@alt.test' },
        context: replyContext,
      },
    },
    {
      $id: 'context-unresolved',
      item: item.template(
        template({ name: 'Me', text: "I'm {{my.handle}}" }, 'me'),
        unresolved,
      ),
      opts: {
        currentText: '',
        answers: { 'my.handle': '@alt.test' },
        context: unresolved,
      },
    },
    {
      $id: 'state',
      item: ownPost,
      opts: {
        state: stateWith({
          text: 'Hi',
          record: { kind: 'post', uri: ownPostUri, cid: 'c' },
        }),
        context: replyContext,
      },
    },
    {
      $id: 'state-context',
      item: ITEMS.context,
      opts: {
        state: stateWith(
          { text: 'Hi', card: { url: 'https://a.example' }, video: {} },
          reply,
        ),
      },
    },
    {
      $id: 'state-link',
      item: ITEMS.linkItem,
      opts: {
        state: stateWith({
          text: 'Hi',
          card: { url: 'https://a.example' },
          images: [{}],
        }),
      },
    },
    {
      $id: 'state-post-index',
      item: ITEMS.app,
      opts: {
        state: { posts: [{ text: 'one' }, { text: 'two' }], reply: null },
        postIndex: 1,
      },
    },
    {
      $id: 'state-and-text',
      item: ITEMS.app,
      opts: {
        state: stateWith({ text: 'from state' }),
        currentText: 'given',
        attachments: ATTACHMENTS.record,
      },
    },
    { $id: 'no-options', item: ITEMS.app },
    {
      $id: 'own-quotes-off',
      item: item.post(POSTS.ownQuotesOff, { selfDid: SELF }),
      opts: { currentText: '' },
    },
    {
      $id: 'truthy-quotes-off',
      item: { ...ownPost, quotesOff: 'yes' },
      opts: { currentText: '' },
    },
    {
      $id: 'emoji-addition',
      item: ITEMS.family,
      opts: {
        currentText: `${FAMILY}${FAMILY}`,
        insertion: { start: 11, end: 11 },
        answers: { thing: '🌿' },
        context: replyContext,
      },
    },
    {
      $id: 'range-fractional',
      item: ITEMS.app,
      opts: {
        currentText: 'abcdef',
        insertion: { start: 2.9, end: 1.2 },
        context: replyContext,
      },
    },
    { $id: 'undefined-item', opts: { currentText: 'x' } },
  );
  return eachRef('previewFor', inputs, ({ item: i, opts }) =>
    onClock(() =>
      opts === undefined ? M.previewFor(i) : M.previewFor(i, opts),
    ),
  );
}

async function planCases(ITEMS) {
  const stateWith = (post, r = null) => ({
    posts: [
      {
        id: 'p',
        text: '',
        images: [],
        video: null,
        record: null,
        card: null,
        ...post,
      },
    ],
    reply: r,
  });
  const reply = {
    uri: replyTo.uri,
    cid: 'c',
    root: { uri: replyTo.uri, cid: 'c' },
    author: replyTo.author,
    text: replyTo.record.text,
  };
  const inputs = [];
  for (const [name, i] of Object.entries(ITEMS)) {
    inputs.push({ $id: name, item: i, opts: { context: replyContext } });
    inputs.push({
      $id: `${name}-locked`,
      item: i,
      opts: { context: replyContext, quoteSlotLocked: true },
    });
    inputs.push({ $id: `${name}-none`, item: i });
  }
  inputs.push(
    {
      $id: 'idea-answers',
      item: ITEMS.idea,
      opts: { answers: { idea: 'pins' }, context: replyContext },
    },
    {
      $id: 'dialog-context',
      item: ITEMS.idea,
      opts: {
        context: { state: stateWith({}, reply) },
        answers: { idea: 'x' },
      },
    },
    {
      $id: 'dialog-reply',
      item: ITEMS.context,
      opts: { context: { reply, selfHandle: 'me.example' } },
    },
    {
      $id: 'dialog-state-fallback',
      item: ITEMS.context,
      opts: {
        state: stateWith({}, reply),
        context: { selfHandle: 'me.example' },
      },
    },
    {
      $id: 'state-only',
      item: ITEMS.context,
      opts: { state: stateWith({}, reply) },
    },
    { $id: 'context-null', item: ITEMS.context, opts: { context: null } },
    {
      $id: 'context-answered',
      item: item.template(
        template({ name: 'Me', text: "I'm {{my.handle}}" }, 'me'),
        unresolved,
      ),
      opts: { answers: { 'my.handle': '@alt.test' }, context: unresolved },
    },
    {
      $id: 'context-resolved',
      item: item.template(
        template({ name: 'Me', text: "I'm {{my.handle}}" }, 'me'),
        unresolved,
      ),
      opts: { answers: { 'my.handle': '@alt.test' }, context: replyContext },
    },
    { $id: 'bare-nothing', item: { kind: 'nothing' } },
    { $id: 'undefined-item' },
    {
      $id: 'feed-raw',
      item: item.feed({ uri: 'at://x/app.bsky.feed.generator/f', cid: 'cf' }),
    },
    {
      $id: 'list-raw',
      item: item.list({ uri: 'at://x/app.bsky.graph.list/l', cid: 'cl' }),
    },
    { $id: 'link-raw', item: item.link({ url: 'https://a.example/x' }) },
    { $id: 'link-no-url', item: item.link({}) },
    { $id: 'post-no-uri', item: item.post({ record: { text: 'x' } }) },
    {
      $id: 'template-no-source',
      item: { kind: 'template', title: 'T', id: 'template:' },
    },
    {
      $id: 'template-cid-view',
      item: item.template(stampTemplate, replyContext, {
        embedView: { ...ownPostView, cid: 'cid-new' },
      }),
      opts: { context: replyContext },
    },
    {
      $id: 'template-view-no-cid',
      item: item.template(stampTemplate, replyContext, {
        embedView: { uri: ownPostUri },
      }),
      opts: { context: replyContext },
    },
    {
      $id: 'answers-string',
      item: ITEMS.idea,
      opts: { answers: 'ab', context: replyContext },
    },
  );
  return eachRef('applyPlanFor', inputs, ({ item: i, opts }) =>
    onClock(() =>
      opts === undefined ? M.applyPlanFor(i) : M.applyPlanFor(i, opts),
    ),
  );
}

async function slashCases() {
  const t = (rkey, v) => template({ text: 'x', ...v }, rkey);
  const list = [
    t('b', { name: 'Bravo', keywords: ['stamina'] }),
    t('a', { name: 'alpha' }),
    t('c', { name: 'Charlie', keywords: ['stamina', 'walks'] }),
    t('d', { name: 'Delta' }),
  ];
  const offered = [
    t('p', { name: 'Post only', use: 'post', keywords: ['stamina'] }),
    t('r', { name: 'Reply', use: 'reply' }),
    t('any', { name: 'Zed' }),
  ];
  const names = [
    t('n1', { name: 'émile' }),
    t('n2', { name: 'Emile' }),
    t('n3', { name: 'emile' }),
    t('n4', { name: 'Zoë' }),
    t('n5', { name: 'zoe' }),
    t('n6', { name: '' }),
    t('n0', { name: '' }),
    t('n7', { name: 'Ångström' }),
    t('n8', { name: 'angstrom' }),
    t('n9', { name: '東京' }),
    t('n10', { name: 'résumé' }),
    t('n11', { name: 'resume' }),
  ];
  return [
    ...(await each(
      'detectSlashCommand',
      [
        { text: '/stam', caret: 5 },
        { text: 'hello /Stam', caret: 11 },
        { text: 'hi\n/bug-2', caret: 9 },
        { text: '/', caret: 1 },
        { text: 'ok /', caret: 4 },
        { text: 'a/b', caret: 3 },
        { text: 'see https://example.com/path', caret: 28 },
        { text: 'https://', caret: 8 },
        { text: 'coffee w/', caret: 9 },
        { text: 'coffee w/ milk', caret: 14 },
        { text: '/stamina', caret: 4 },
        { text: '/stamina more', caret: 13 },
        { text: '/stamina ', caret: 9 },
        { text: '/sta more', caret: 4 },
        { text: `/${'a'.repeat(33)}` },
        { text: `/${'a'.repeat(32)}` },
        { text: `x /${'a'.repeat(32)}`, caret: 35 },
        { text: '/ab', caret: 99 },
        { text: '/ab', caret: -1 },
        { text: '/ab', caret: 2.7 },
        { text: '/ab', caret: '2' },
        { text: '/ab', caret: Number.NaN },
        { text: 'a /x', caret: 4 },
        { text: 'a　/x', caret: 4 },
        { text: 'a​/x', caret: 4 },
        { text: '/é', caret: 2 },
        { text: '/x', caret: 2 },
        { text: '//x', caret: 3 },
        { text: '/--', caret: 3 },
        { text: 5, caret: 1 },
        { text: '/MiXeD-Case9' },
        { text: '/xé', caret: 2 },
      ],
      ({ text, caret }) => M.detectSlashCommand(text, caret),
    )),
    ...(await each(
      'rankTemplatesForSlash',
      [
        {
          $id: 'hits-use-name',
          templates: list,
          parentText: replyTo.record.text,
          usage: { d: { count: 4 }, a: { count: 1 } },
          replying: true,
        },
        {
          $id: 'use-name',
          templates: list,
          usage: { d: { count: 4 }, a: { count: 1 } },
        },
        { $id: 'name', templates: list },
        {
          $id: 'offered-replying',
          templates: offered,
          parentText: replyTo.record.text,
          replying: true,
        },
        { $id: 'offered-post', templates: offered, replying: false },
        { $id: 'null', templates: null },
        { $id: 'names', templates: names },
        { $id: 'names-reversed', templates: [...names].reverse() },
        {
          $id: 'odd-usage',
          templates: list,
          usage: {
            a: { count: '3' },
            b: { count: 'x' },
            c: null,
            d: { count: true },
          },
        },
        { $id: 'usage-not-object', templates: list, usage: 'nope' },
        { $id: 'falsy', templates: [list[0], null, list[1]] },
      ],
      ({ templates, ...opts }) =>
        M.rankTemplatesForSlash(templates, opts).map((x) => x.rkey),
    )),
  ];
}
