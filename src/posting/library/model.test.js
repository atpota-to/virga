/*
 * The embed library's pure model: shelf items for every kind, suggestions
 * for a reply and their reasons, local search, verbs and effect lines, the
 * preview of what using an item does to the post, the plan the composer
 * carries out, "/shortcut" detection, caret-aware insertion, and editor drafts.
 */

import { describe, it, expect } from 'vitest';
import {
  LIBRARY_NAME,
  LIBRARY_SHELVES,
  applyPlanFor,
  attachmentsFromState,
  dedupeById,
  engagementScore,
  isOwnThreadPost,
  isOwnThreadRow,
  itemFromArchiveRow,
  libraryContext,
  replyTextWithoutSlash,
  sortItems,
  detectSlashCommand,
  draftFromReply,
  draftFromTemplate,
  effectFor,
  insertText,
  itemFromFeed,
  itemFromLink,
  itemFromList,
  itemFromPost,
  itemFromTemplate,
  openingShelf,
  postMedia,
  previewFor,
  rankTemplatesForSlash,
  searchItems,
  shelvesFor,
  suggestItems,
  syncDraftVariables,
  templateFromDraft,
  verbFor,
} from './model.js';
import {
  buildTemplateContext,
  fillTemplate,
  normalizeTemplateRecord,
} from '../templates/postTemplates.js';

const SELF = 'did:plc:self';
const OTHER = 'did:plc:other';
const NOW = new Date('2026-10-14T12:00:00Z');
const THIS_YEAR = new Date().getFullYear();

const shortDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

const replyTo = {
  uri: `at://${OTHER}/app.bsky.feed.post/parent`,
  author: { did: OTHER, handle: 'moss.example', displayName: 'Moss Hollow' },
  record: {
    text: 'Why does stamina drain so fast? I keep running out on my moth walks.',
  },
};
const replyContext = buildTemplateContext({
  replyTo,
  self: { handle: 'you.example' },
  now: NOW,
  locale: 'en-US',
});
const newPostContext = buildTemplateContext({
  self: { handle: 'you.example' },
  now: NOW,
  locale: 'en-US',
});

const template = (value, rkey = 'tpl1') =>
  normalizeTemplateRecord({
    uri: `at://${SELF}/net.anisota.feed.template/${rkey}`,
    cid: `cid-${rkey}`,
    value,
  });

const ownPostUri = `at://${SELF}/app.bsky.feed.post/stamina`;
const ownPostView = {
  uri: ownPostUri,
  cid: 'cid-stamina',
  author: { did: SELF, handle: 'you.example' },
  record: {
    text: 'A few words on stamina, since it comes up a lot.\nIt refills at 2 a minute.',
    createdAt: `${THIS_YEAR}-09-02T12:00:00Z`,
  },
};

const stampTemplate = template(
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
const ideaTemplate = template(
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
const appTemplate = template(
  {
    name: 'Is there an app?',
    text: "It runs in the browser, so there's nothing to download.",
    shortcut: 'app',
    keywords: ['download', 'app'],
  },
  'app',
);
const postOnlyTemplate = template(
  {
    name: 'Weekly walk',
    text: 'Out for the weekly walk.',
    use: 'post',
    keywords: ['stamina'],
  },
  'walk',
);
const linkTemplate = template(
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

describe('shelves', () => {
  it('names the library once and lists shelves in the table order', () => {
    expect(LIBRARY_NAME).toBe('Library');
    expect(LIBRARY_SHELVES.map((s) => s.id)).toEqual([
      'suggested',
      'templates',
      'posts',
      'replies',
      'saved',
      'links',
      'feeds',
      'lists',
      'search',
    ]);
    expect(LIBRARY_SHELVES.map((s) => s.label)).toEqual([
      'For this reply',
      'Templates',
      'Your posts',
      'Your replies',
      'Saved',
      'Links',
      'Feeds',
      'Lists',
      'Search',
    ]);
    expect(LIBRARY_SHELVES[0].label).toBe('For this reply');
  });

  it('offers "For this reply" only while replying and opens on it', () => {
    expect(shelvesFor({ replying: true })[0].id).toBe('suggested');
    expect(
      shelvesFor({ replying: false }).some((s) => s.id === 'suggested'),
    ).toBe(false);
    expect(openingShelf({ replying: true })).toBe('suggested');
    expect(openingShelf({ replying: false })).toBe('templates');
  });
});

describe('items', () => {
  it('makes template items keyed by rkey, with the shortcut shown and blanks as an ellipsis', () => {
    const item = itemFromTemplate(ideaTemplate, replyContext);
    expect(item).toMatchObject({
      id: 'template:idea',
      kind: 'template',
      shelf: 'templates',
      title: 'Thanks for the idea',
      label: 'Template · asks 2 questions',
      shortcut: '/idea',
      reason: '',
      source: ideaTemplate,
    });
    expect(item.excerpt).toBe(
      'Thank you, Moss. I like the idea of …, and it is on our list.',
    );
    expect(
      itemFromTemplate(stampTemplate, replyContext, { embedView: ownPostView }),
    ).toMatchObject({
      label: 'Template · quotes a post',
      embedView: ownPostView,
    });
    expect(itemFromTemplate(appTemplate, replyContext).label).toBe('Template');
    expect(
      itemFromTemplate(
        template({ name: 'One', text: 'Try {{thing}}' }, 'one'),
        replyContext,
      ).label,
    ).toBe('Template · asks a question');
  });

  it('labels own posts and replies with their date, and other people’s posts by handle', () => {
    const post = itemFromPost(ownPostView, { shelf: 'posts', selfDid: SELF });
    expect(post).toMatchObject({
      id: `post:${ownPostUri}`,
      kind: 'post',
      shelf: 'posts',
      title: 'A few words on stamina, since it comes up a lot.',
      excerpt: 'It refills at 2 a minute.',
      label: `Your post · ${shortDate(ownPostView.record.createdAt)}`,
    });
    expect(post.label).toMatch(/^Your post · \S+ \d+$/);

    const reply = itemFromPost(
      {
        ...ownPostView,
        uri: `at://${SELF}/app.bsky.feed.post/r1`,
        record: {
          ...ownPostView.record,
          reply: { root: { uri: replyTo.uri }, parent: { uri: replyTo.uri } },
        },
      },
      { shelf: 'replies', selfDid: SELF, parentView: replyTo },
    );
    expect(reply.label.startsWith('Your reply · ')).toBe(true);
    expect(reply.excerpt).toBe(
      'Replying to @moss.example: “Why does stamina drain so fast? I keep running out on my…”',
    );

    const theirs = itemFromPost(
      {
        uri: `at://${OTHER}/app.bsky.feed.post/x`,
        cid: 'c',
        author: { did: OTHER, handle: 'luna.example' },
        record: { text: 'hi', createdAt: `${THIS_YEAR}-09-02T12:00:00Z` },
      },
      { shelf: 'search', selfDid: SELF },
    );
    expect(theirs.label).toBe(
      `Post by @luna.example · ${shortDate(`${THIS_YEAR}-09-02T12:00:00Z`)}`,
    );
  });

  it('titles a post with no text by what it carries, and dates an older post with its year', () => {
    const base = {
      uri: `at://${SELF}/app.bsky.feed.post/i`,
      author: { did: SELF, handle: 'you.example' },
    };
    const make = (embed) =>
      itemFromPost(
        {
          ...base,
          record: { text: '', embed, createdAt: '2020-03-04T12:00:00Z' },
        },
        { selfDid: SELF },
      );
    expect(make({ $type: 'app.bsky.embed.images', images: [] }).title).toBe(
      'Image',
    );
    expect(make({ $type: 'app.bsky.embed.video' }).title).toBe('Video');
    expect(make({ $type: 'app.bsky.embed.external', external: {} }).title).toBe(
      'Link',
    );
    expect(
      make({ $type: 'app.bsky.embed.record', record: { uri: ownPostUri } })
        .title,
    ).toBe('Quote');
    expect(
      make({
        $type: 'app.bsky.embed.record',
        record: { uri: `at://${OTHER}/app.bsky.feed.generator/f` },
      }).title,
    ).toBe('Feed');
    expect(
      make({
        $type: 'app.bsky.embed.record',
        record: { uri: `at://${OTHER}/app.bsky.graph.list/l` },
      }).title,
    ).toBe('List');
    expect(make(undefined).label).toContain('2020');
  });

  it('carries a post’s pictures: the first thumbnail and every alt text', () => {
    const base = {
      uri: `at://${SELF}/app.bsky.feed.post/m`,
      author: { did: SELF, handle: 'you.example' },
    };
    const images = {
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
    };
    expect(itemFromPost(images, { selfDid: SELF }).media).toEqual({
      thumb: 'https://img.example/1',
      alt: 'Ridge at dusk · Moth',
    });

    // A quote with a video: the video's poster and alt text.
    const quoteWithVideo = {
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
    };
    expect(postMedia(quoteWithVideo)).toEqual({
      thumb: 'https://video.example/poster.jpg',
      alt: 'A moth taking off',
    });

    // Read as a bare record (no view): the alt text, no thumbnail.
    const bare = { ...base, record: { ...images.record } };
    expect(postMedia(bare)).toEqual({ thumb: null, alt: 'one · three' });

    expect(itemFromPost(ownPostView, { selfDid: SELF }).media).toBe(null);
    expect(
      postMedia({
        ...base,
        record: {
          text: '',
          embed: { $type: 'app.bsky.embed.external', external: {} },
        },
      }),
    ).toBe(null);
  });

  it('makes link, feed and list items', () => {
    expect(
      itemFromLink({
        url: 'https://www.virga.example/branding/',
        title: 'Branding & Media Kit',
      }),
    ).toMatchObject({
      id: 'link:https://www.virga.example/branding/',
      kind: 'link',
      title: 'Branding & Media Kit',
      excerpt: 'virga.example/branding',
      label: 'Link · virga.example',
    });
    expect(
      itemFromLink({ url: 'https://atproto.example/', title: '' }).title,
    ).toBe('https://atproto.example/');

    const feed = {
      uri: `at://${SELF}/app.bsky.feed.generator/moths`,
      displayName: 'Moth photos',
      description: 'Posts tagged #mothing',
      creator: { handle: 'you.example' },
    };
    expect(itemFromFeed(feed, { group: 'yours' })).toMatchObject({
      id: `feed:${feed.uri}`,
      kind: 'feed',
      title: 'Moth photos',
      label: 'Feed · yours',
      group: 'yours',
    });
    expect(itemFromFeed(feed, { group: 'saved' }).label).toBe('Feed · saved');
    expect(
      itemFromFeed(
        { ...feed, creator: { handle: 'luna.example' } },
        { group: 'search' },
      ).label,
    ).toBe('Feed by @luna.example');

    const list = {
      uri: `at://${SELF}/app.bsky.graph.list/people`,
      name: 'Moth people',
      description: 'Accounts who post about moths',
    };
    expect(
      itemFromList({ ...list, purpose: 'app.bsky.graph.defs#curatelist' }),
    ).toMatchObject({
      id: `list:${list.uri}`,
      kind: 'list',
      label: 'List · curation',
    });
    expect(
      itemFromList({ ...list, purpose: 'app.bsky.graph.defs#modlist' }).label,
    ).toBe('List · moderation');
    expect(
      itemFromList({ ...list, purpose: 'app.bsky.graph.defs#referencelist' })
        .label,
    ).toBe('List');
  });
});

describe('suggestions', () => {
  const templates = [appTemplate, stampTemplate, postOnlyTemplate].map((t) =>
    itemFromTemplate(t, replyContext),
  );
  const mothsUri = `at://${SELF}/app.bsky.feed.post/moths`;
  const posts = [
    itemFromPost(ownPostView, { selfDid: SELF }),
    itemFromPost(
      {
        ...ownPostView,
        uri: mothsUri,
        record: {
          text: 'Moth walks need patience and stamina',
          createdAt: NOW.toISOString(),
        },
      },
      { selfDid: SELF },
    ),
    itemFromPost(
      {
        ...ownPostView,
        uri: `at://${SELF}/app.bsky.feed.post/unrelated`,
        record: { text: 'Soup tonight', createdAt: NOW.toISOString() },
      },
      { selfDid: SELF },
    ),
  ];
  // Four posts, feeds and lists: too few to call any word common.
  const feeds = [
    itemFromFeed(
      {
        uri: `at://${SELF}/app.bsky.feed.generator/m`,
        displayName: 'Moth photos',
      },
      { group: 'yours' },
    ),
  ];
  const lists = [];

  const ownView = (rkey, text) => ({
    uri: `at://${SELF}/app.bsky.feed.post/${rkey}`,
    cid: `cid-${rkey}`,
    author: { did: SELF, handle: 'you.example' },
    record: { text, createdAt: NOW.toISOString() },
  });

  it('puts keyword-matched templates first, then items sharing words, with reasons', () => {
    const out = suggestItems({
      templates,
      posts,
      feeds,
      lists,
      parentText: replyTo.record.text,
    });
    expect(out.map((i) => i.id)).toEqual([
      'template:stamina',
      `post:${mothsUri}`,
      `post:${ownPostUri}`,
      `feed:at://${SELF}/app.bsky.feed.generator/m`,
    ]);
    expect(out[0].reason).toBe('Their post mentions “stamina”');
    // "moth" from "moths", "walk" from "walks".
    expect(out[1].reason).toBe(
      'Shares “moth”, “walk” and “stamina” with their post',
    );
    expect(out[2].reason).toBe('Shares “stamina” with their post');
    expect(out[3].reason).toBe('Shares “moth” with their post');
  });

  it('needs two shared words for a post, or one of six letters, skips templates not offered on replies, and honours the limit', () => {
    const parentText = 'My game save is gone again';
    const two = itemFromPost(
      ownView('two', 'Lost a game save once, here is what helped'),
      { selfDid: SELF },
    );
    const one = itemFromPost(ownView('one', 'The game is quiet at night'), {
      selfDid: SELF,
    });
    expect(
      suggestItems({ posts: [two, one], parentText }).map((i) => i.id),
    ).toEqual([two.id]);

    const out = suggestItems({
      templates,
      posts,
      feeds,
      lists,
      parentText: replyTo.record.text,
    });
    expect(out.some((i) => i.id === 'template:walk')).toBe(false);
    expect(
      suggestItems({
        templates,
        posts,
        feeds,
        lists,
        parentText: replyTo.record.text,
        limit: 1,
      }),
    ).toHaveLength(1);
  });

  it('counts only distinctive words once there are five or more candidates', () => {
    // As in the fixture: Moss asks about stamina and a feed for moth photos,
    // in a library where most things mention moths.
    const parentText =
      'why does virga have a stamina bar lol. feels like a game telling me to go outside. also is there a feed for moth photos?';
    const stamina = itemFromPost(
      ownView(
        'stamina',
        "A few words on stamina, since it comes up a lot.\nIt starts at 100 and refills at 2 a minute while you're away.",
      ),
      { selfDid: SELF },
    );
    const pds = itemFromPost(
      ownView(
        'pds',
        "Your game progress, lists, settings and mutes live on your own PDS.\nThat's why they follow you from your phone to your laptop.",
      ),
      { selfDid: SELF },
    );
    const name = itemFromPost(
      ownView(
        'name',
        "Why the name: Virga is a genus of North American silk moths.\nThe levels follow a moth's life, from caterpillar to cocoon to moth.",
      ),
      { selfDid: SELF },
    );
    const mothFeed = itemFromFeed({
      uri: `at://${SELF}/app.bsky.feed.generator/moth-photos`,
      displayName: 'Moth photos',
      description: 'Posts tagged #mothing that include a photo',
    });
    const quietFeed = itemFromFeed(
      {
        uri: `at://${OTHER}/app.bsky.feed.generator/quiet`,
        displayName: 'Quiet hours',
        description: 'Slower posts from people you follow',
      },
      { group: 'saved' },
    );
    const mothList = itemFromList({
      uri: `at://${SELF}/app.bsky.graph.list/moth-people`,
      name: 'Moth people',
      description: 'Accounts who post about moths',
    });

    const out = suggestItems({
      posts: [stamina, pds, name],
      feeds: [mothFeed, quietFeed],
      lists: [mothList],
      parentText,
    });
    // "moth" is in half of them, so the name post (which shares only it and
    // "Virga", five letters) and the list drop out; "game" alone is too short
    // for a post.
    expect(out.map((i) => i.id)).toEqual([stamina.id, mothFeed.id]);
    expect(out.map((i) => i.reason)).toEqual([
      'Shares “stamina” with their post',
      'Shares “photo” with their post',
    ]);
  });

  it('calls a word common only past a fifth of five or more candidates', () => {
    const feed = (n) =>
      itemFromFeed({
        uri: `at://${SELF}/app.bsky.feed.generator/f${n}`,
        displayName: `Moth ${['alpha', 'beta', 'gamma', 'delta', 'omega'][n]}`,
      });
    const four = [0, 1, 2, 3].map(feed);
    expect(
      suggestItems({ feeds: four, parentText: 'moth season' }),
    ).toHaveLength(4);
    expect(
      suggestItems({ feeds: [...four, feed(4)], parentText: 'moth season' }),
    ).toEqual([]);
    // One in five is a fifth, not more, so it still counts.
    const others = [1, 2, 3, 4].map((n) =>
      itemFromList({
        uri: `at://${SELF}/app.bsky.graph.list/l${n}`,
        name: `Bakers ${n}`,
      }),
    );
    expect(
      suggestItems({
        feeds: [feed(0)],
        lists: others,
        parentText: 'moth season',
      }).map((i) => i.id),
    ).toEqual([feed(0).id]);
  });

  it('never treats contractions or the platform as a topic', () => {
    const contractions = itemFromPost(
      ownView('c', "I can't believe it doesn't load, don't ask"),
      { selfDid: SELF },
    );
    expect(
      suggestItems({
        posts: [contractions],
        parentText: "I don't know why it doesn't work",
      }),
    ).toEqual([]);
    // Typed without the apostrophe, too; a list needs only one shared word.
    const unpunctuated = itemFromList({
      uri: `at://${SELF}/app.bsky.graph.list/u`,
      name: 'dont youre doesnt wont',
    });
    expect(
      suggestItems({
        lists: [unpunctuated],
        parentText: 'dont youre doesnt wont',
      }),
    ).toEqual([]);
    const folks = itemFromList({
      uri: `at://${SELF}/app.bsky.graph.list/folks`,
      name: 'Folks you’re missing',
    });
    expect(
      suggestItems({ lists: [folks], parentText: "you're right" }),
    ).toEqual([]);
    const bsky = itemFromFeed({
      uri: `at://${SELF}/app.bsky.feed.generator/art`,
      displayName: 'Bluesky art',
    });
    expect(
      suggestItems({
        feeds: [bsky],
        parentText: 'I love Bluesky and Anisota so much',
      }),
    ).toEqual([]);
    // A possessive is still the word itself.
    const moths = itemFromFeed({
      uri: `at://${SELF}/app.bsky.feed.generator/moths`,
      displayName: 'Moths at night',
    });
    expect(
      suggestItems({ feeds: [moths], parentText: "the moth's wings" }).map(
        (i) => i.reason,
      ),
    ).toEqual(['Shares “moth” with their post']);
  });

  it('orders templates by hits and leaves the post being replied to out', () => {
    const many = itemFromTemplate(
      template(
        { name: 'Both', text: 'x', keywords: ['stamina', 'walks'] },
        'both',
      ),
      replyContext,
    );
    const out = suggestItems({
      templates: [...templates, many],
      parentText: replyTo.record.text,
    });
    expect(out[0].id).toBe('template:both');
    expect(out[0].reason).toBe('Their post mentions “stamina”, “walks”');
    const parentItem = itemFromPost(
      { ...replyTo, record: { text: 'Moth walks and stamina' } },
      { selfDid: SELF },
    );
    expect(
      suggestItems({
        posts: [parentItem],
        parentText: replyTo.record.text,
        parentUri: replyTo.uri,
      }),
    ).toEqual([]);
  });

  it('takes bare templates and views as well as items', () => {
    const out = suggestItems({
      templates: [stampTemplate],
      feeds: [
        {
          uri: `at://${SELF}/app.bsky.feed.generator/m`,
          displayName: 'Moth photos',
        },
      ],
      parentText: replyTo.record.text,
      context: replyContext,
    });
    expect(out.map((i) => i.id)).toEqual([
      'template:stamina',
      `feed:at://${SELF}/app.bsky.feed.generator/m`,
    ]);
  });

  it('matches a reply by its own words, not the parent its excerpt quotes', () => {
    const reply = itemFromPost(
      {
        ...ownPostView,
        uri: `at://${SELF}/app.bsky.feed.post/r`,
        record: { text: 'Soup tonight', createdAt: NOW.toISOString() },
      },
      {
        shelf: 'replies',
        selfDid: SELF,
        parentView: {
          author: { handle: 'moss.example' },
          record: { text: 'moth walks and stamina' },
        },
      },
    );
    expect(
      suggestItems({ posts: [reply], parentText: replyTo.record.text }),
    ).toEqual([]);
  });

  it('ignores stopwords, short words, links and handles', () => {
    const item = itemFromFeed(
      {
        uri: 'at://x/app.bsky.feed.generator/y',
        displayName: 'Things about that example',
      },
      { group: 'saved' },
    );
    expect(
      suggestItems({
        feeds: [item],
        parentText:
          'things about that https://example.com/x @example.bsky.social',
      }),
    ).toEqual([]);
  });
});

describe('search', () => {
  const items = [
    itemFromTemplate(stampTemplate, replyContext),
    itemFromTemplate(ideaTemplate, replyContext),
    itemFromTemplate(appTemplate, replyContext),
    itemFromPost(ownPostView, { selfDid: SELF }),
    itemFromLink({ url: 'https://docs.example.org/stamina', title: 'Docs' }),
  ];

  it('matches title, excerpt, label and shortcut case-insensitively', () => {
    expect(searchItems(items, 'STAMINA').map((i) => i.id)).toEqual([
      'template:stamina',
      `post:${ownPostUri}`,
      'link:https://docs.example.org/stamina',
    ]);
    expect(searchItems(items, 'link · docs').map((i) => i.kind)).toEqual([
      'link',
    ]);
    expect(searchItems(items, '   ')).toEqual([]);
  });

  it('matches a post’s alt text', () => {
    const pictured = itemFromPost(
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
    expect(
      searchItems([...items, pictured], 'blue ridge').map((i) => i.id),
    ).toEqual([pictured.id]);
  });

  it('turns "/" into a template shortcut search', () => {
    expect(
      searchItems(items, '/sta', { replying: true }).map((i) => i.id),
    ).toEqual(['template:stamina']);
    expect(
      searchItems(items, '/', { replying: true }).map((i) => i.kind),
    ).toEqual(['template', 'template', 'template']);
    expect(searchItems(items, '/zzz')).toEqual([]);
  });

  it('dedupes by id, against seen ids and within the list', () => {
    const doubled = [...items, items[0]];
    expect(
      searchItems(doubled, 'stamina').filter(
        (i) => i.id === 'template:stamina',
      ),
    ).toHaveLength(1);
    expect(
      dedupeById(doubled, new Set(['template:stamina'])).map((i) => i.id),
    ).not.toContain('template:stamina');
    expect(dedupeById(doubled, ['template:idea']).length).toBe(
      items.length - 1,
    );
  });
});

describe('verbs and effects', () => {
  it('names the use button for each kind', () => {
    const t = itemFromTemplate(appTemplate, replyContext);
    expect(verbFor(t, { replying: true })).toBe('Put in reply');
    expect(verbFor(t, { replying: false })).toBe('Put in post');
    expect(verbFor(itemFromPost(ownPostView, { selfDid: SELF }))).toBe('Quote');
    expect(verbFor(itemFromLink({ url: 'https://a.example' }))).toBe(
      'Attach link',
    );
    expect(
      verbFor(itemFromFeed({ uri: 'at://x/app.bsky.feed.generator/f' })),
    ).toBe('Attach feed');
    expect(verbFor(itemFromList({ uri: 'at://x/app.bsky.graph.list/l' }))).toBe(
      'Attach list',
    );
    expect(verbFor({ kind: 'nothing' })).toBe(null);
  });

  it('says in one line what each item does', () => {
    expect(
      effectFor(
        itemFromTemplate(stampTemplate, replyContext, {
          embedView: ownPostView,
        }),
        replyContext,
      ),
    ).toBe('Adds text and quotes your post');
    expect(
      effectFor(itemFromTemplate(stampTemplate, replyContext), replyContext),
    ).toBe('Adds text and quotes a post');
    // The optional choice is still asked, so it counts.
    expect(
      effectFor(itemFromTemplate(ideaTemplate, replyContext), replyContext),
    ).toBe('Asks 2 questions, then adds text');
    const one = template(
      { name: 'Bug', text: 'Which {{device}}?', embed: stampTemplate.embed },
      'bug',
    );
    expect(
      effectFor(
        itemFromTemplate(one, replyContext, { embedView: ownPostView }),
        replyContext,
      ),
    ).toBe('Asks one question, then adds text and quotes your post');
    expect(
      effectFor(itemFromTemplate(appTemplate, replyContext), replyContext),
    ).toBe('Adds text to your reply');
    expect(
      effectFor(itemFromTemplate(appTemplate, newPostContext), newPostContext),
    ).toBe('Adds text to your post');
    expect(
      effectFor(itemFromTemplate(linkTemplate, replyContext), replyContext),
    ).toBe('Attaches a link card');
    expect(effectFor(itemFromPost(ownPostView, { selfDid: SELF }))).toBe(
      'Attaches this post as a quote',
    );
    expect(effectFor(itemFromLink({ url: 'https://a.example' }))).toBe(
      'Attaches a link card',
    );
    expect(
      effectFor(itemFromFeed({ uri: 'at://x/app.bsky.feed.generator/f' })),
    ).toBe('Attaches the feed as a card people can open');
    expect(
      effectFor(itemFromList({ uri: 'at://x/app.bsky.graph.list/l' })),
    ).toBe('Attaches the list as a card');
  });
});

describe('previewFor', () => {
  const joined = (preview) => preview.parts.map((p) => p.text).join('');

  it('joins existing text and the addition exactly as insertText does', () => {
    const item = itemFromTemplate(ideaTemplate, replyContext);
    const answers = { idea: 'pinned feeds', when: 'Soon.' };
    const added = fillTemplate(ideaTemplate, answers, replyContext);
    const currentText = 'Hello there/idea and more';
    const insertion = { start: 11, end: 16 };
    const preview = previewFor(item, {
      currentText,
      insertion,
      answers,
      context: replyContext,
    });
    expect(joined(preview)).toBe(
      insertText(currentText, added, insertion).text,
    );
    expect(preview.parts[0]).toEqual({ text: 'Hello there', kind: 'existing' });
    expect(preview.parts.find((p) => p.kind === 'context')).toEqual({
      text: 'Moss',
      kind: 'context',
    });
    expect(
      preview.parts.filter((p) => p.kind === 'answer').map((p) => p.text),
    ).toEqual(['pinned feeds', 'Soon.']);
    expect(preview.parts[preview.parts.length - 1]).toEqual({
      text: ' and more',
      kind: 'existing',
    });
  });

  it('tidies an empty optional blank away, as fillTemplate does', () => {
    const item = itemFromTemplate(ideaTemplate, replyContext);
    const answers = { idea: 'pins' };
    const preview = previewFor(item, {
      currentText: '',
      answers,
      context: replyContext,
    });
    expect(joined(preview)).toBe(
      fillTemplate(ideaTemplate, answers, replyContext),
    );
    expect(joined(preview).endsWith('list.')).toBe(true);
  });

  it('shows an unanswered blank by its label and counts only real text', () => {
    const preview = previewFor(itemFromTemplate(ideaTemplate, replyContext), {
      currentText: '',
      answers: {},
      context: replyContext,
    });
    expect(preview.parts.find((p) => p.kind === 'blank')).toEqual({
      text: 'idea',
      kind: 'blank',
    });
    expect(preview.count).toBe(
      fillTemplate(ideaTemplate, {}, replyContext).length,
    );
  });

  it('counts an inline link by its label and flags going over the limit', () => {
    const item = itemFromTemplate(appTemplate, replyContext);
    const currentText =
      'See [the docs](https://docs.example.org/a/very/long/path/indeed).';
    const preview = previewFor(item, {
      currentText,
      context: replyContext,
      maxLength: 300,
    });
    const full = insertText(currentText, appTemplate.text, {
      start: currentText.length,
      end: currentText.length,
    }).text;
    expect(joined(preview)).toBe(full);
    expect(preview.count).toBe(
      full.length -
        '[](https://docs.example.org/a/very/long/path/indeed)'.length,
    );
    expect(preview.overLimit).toBe(false);
    expect(
      previewFor(item, { currentText, context: replyContext, maxLength: 20 })
        .overLimit,
    ).toBe(true);
  });

  it('notes a replaced attachment, a hidden link card and a quote that is gone', () => {
    const post = itemFromPost(ownPostView, { selfDid: SELF });
    const withRecord = previewFor(post, {
      context: replyContext,
      attachments: { record: { by: 'x', title: 'y' }, link: null, media: null },
    });
    expect(withRecord.replacesAttachment).toBe(true);
    expect(withRecord.notes).toContain(
      'A post holds one attachment, so this replaces the one already there.',
    );
    expect(withRecord.attachment).toEqual({
      by: 'Your post',
      title: 'A few words on stamina, since it comes up a lot.',
    });

    const link = itemFromLink({
      url: 'https://docs.example.org/x',
      title: 'Docs',
    });
    const overLink = previewFor(link, {
      attachments: {
        record: null,
        link: { url: 'https://a.example', title: 'A' },
        media: 'images',
      },
    });
    expect(overLink.replacesAttachment).toBe(true);
    expect(overLink.notes).toEqual([
      'A post holds one attachment, so this replaces the one already there.',
      "Your images take the attachment space, so a link card won't show.",
    ]);
    expect(overLink.attachment).toEqual({
      by: 'docs.example.org',
      title: 'Docs',
    });
    expect(
      previewFor(link, {
        attachments: { record: { by: 'x' }, link: null, media: null },
      }).replacesAttachment,
    ).toBe(false);

    const gone = previewFor(
      itemFromTemplate(stampTemplate, replyContext, { embedView: 'missing' }),
      { context: replyContext },
    );
    expect(gone.notes).toEqual([
      'The post this template quotes is gone, so only its text will be added.',
    ]);
    expect(gone.attachment).toBe(null);
    expect(gone.blocked).toBe(null);
    expect(gone.usable).toBe(true);

    const goneFeedOnly = template(
      {
        name: 'F',
        text: '',
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: 'at://x/app.bsky.feed.generator/f', cid: 'c' },
        },
      },
      'f',
    );
    const emptyGone = previewFor(
      itemFromTemplate(goneFeedOnly, replyContext, { embedView: 'missing' }),
      { context: replyContext },
    );
    expect(emptyGone.blocked).toBe(
      "The feed this template attaches is gone, so there's nothing to add.",
    );
    expect(emptyGone.usable).toBe(false);
  });

  it('blocks a record while the quote slot is locked, keeping the text', () => {
    const t = previewFor(
      itemFromTemplate(stampTemplate, replyContext, { embedView: ownPostView }),
      { context: replyContext, quoteSlotLocked: true },
    );
    expect(t.blocked).toBe(
      'This post already quotes something, so only the text can be added.',
    );
    expect(t.attachment).toBe(null);
    expect(t.usable).toBe(true);

    const p = previewFor(itemFromPost(ownPostView, { selfDid: SELF }), {
      context: replyContext,
      quoteSlotLocked: true,
    });
    expect(p.blocked).toBeTruthy();
    expect(p.usable).toBe(false);

    // A link card isn't a record, so a locked quote slot doesn't stop it.
    expect(
      previewFor(itemFromLink({ url: 'https://a.example' }), {
        quoteSlotLocked: true,
      }).blocked,
    ).toBe(null);
  });

  it('previews an attachment-only item with the slash range left out', () => {
    const preview = previewFor(
      itemFromFeed({
        uri: 'at://x/app.bsky.feed.generator/f',
        displayName: 'Moths',
        creator: { handle: 'you.example' },
      }),
      {
        currentText: 'Try /fe this',
        insertion: { start: 4, end: 7 },
        context: replyContext,
      },
    );
    expect(joined(preview)).toBe('Try this');
    expect(joined(preview)).toBe(
      insertText('Try /fe this', null, { start: 4, end: 7 }).text,
    );
    expect(preview.attachment).toEqual({
      by: 'Feed by @you.example',
      title: 'Moths',
    });
  });

  it('keeps a selection of the reader’s own words when the item only attaches', () => {
    const currentText = 'Look at this thread';
    const insertion = { start: 8, end: 19 };
    const attachOnly = [
      itemFromPost(ownPostView, { selfDid: SELF }),
      itemFromLink({ url: 'https://docs.example.org/x', title: 'Docs' }),
      itemFromFeed({
        uri: 'at://x/app.bsky.feed.generator/f',
        displayName: 'Moths',
      }),
      itemFromList({
        uri: 'at://x/app.bsky.graph.list/l',
        name: 'Moth people',
      }),
      itemFromTemplate(linkTemplate, replyContext),
    ];
    for (const item of attachOnly) {
      const plan = applyPlanFor(item, { context: replyContext });
      expect(plan.insertText).toBeUndefined();
      expect(
        insertText(currentText, plan.insertText ?? null, insertion).text,
      ).toBe(currentText);
      expect(
        joined(
          previewFor(item, { currentText, insertion, context: replyContext }),
        ),
      ).toBe(currentText);
    }
    // Text from a template still takes the selection's place.
    const withText = previewFor(itemFromTemplate(appTemplate, replyContext), {
      currentText,
      insertion,
      context: replyContext,
    });
    expect(joined(withText)).toBe(
      insertText(currentText, appTemplate.text, insertion).text,
    );
    expect(joined(withText)).toBe(`Look at ${appTemplate.text}`);
  });

  it('previews a template’s own spacing exactly as it is applied', () => {
    const item = itemFromTemplate(
      template(
        {
          name: 'Glad',
          text: 'Glad you like it :) see you ;)\nCode:\n    indented. Bonjour {{their.firstName}} ! Ça va ?',
        },
        'glad',
      ),
      replyContext,
    );
    const plan = applyPlanFor(item, { context: replyContext });
    expect(plan.insertText).toBe(
      'Glad you like it :) see you ;)\nCode:\n    indented. Bonjour Moss ! Ça va ?',
    );
    expect(
      joined(previewFor(item, { currentText: '', context: replyContext })),
    ).toBe(plan.insertText);
  });

  it('previews a context key with what is applied, even with an answer left from when it was asked', () => {
    const t = template({ name: 'Me', text: "I'm {{my.handle}}" }, 'me');
    // The handle was asked (and answered) before it resolved.
    const answers = { 'my.handle': '@alt.test' };
    const unresolved = buildTemplateContext({
      replyTo,
      self: {},
      now: NOW,
      locale: 'en-US',
    });
    const item = itemFromTemplate(t, unresolved);
    expect(
      applyPlanFor(item, { answers, context: unresolved }).insertText,
    ).toBe("I'm @alt.test");
    const resolved = applyPlanFor(item, {
      answers,
      context: replyContext,
    }).insertText;
    expect(resolved).toBe("I'm @you.example");
    expect(
      joined(
        previewFor(item, { currentText: '', answers, context: replyContext }),
      ),
    ).toBe(resolved);
  });
});

describe('applyPlanFor', () => {
  it('fills a template and attaches what it quotes, with the view when it has one', () => {
    const item = itemFromTemplate(stampTemplate, replyContext, {
      embedView: ownPostView,
    });
    expect(applyPlanFor(item, { answers: {}, context: replyContext })).toEqual({
      insertText: 'I wrote a little about that here.',
      attach: {
        kind: 'post',
        uri: ownPostUri,
        cid: 'cid-stamina',
        view: ownPostView,
      },
      template: stampTemplate,
      answers: {},
      title: 'Why stamina?',
      templateRkey: 'stamina',
    });
    const unhydrated = applyPlanFor(
      itemFromTemplate(stampTemplate, replyContext),
      { context: replyContext },
    );
    expect(unhydrated.attach).toEqual({
      kind: 'post',
      uri: ownPostUri,
      cid: 'cid-stamina',
    });
    const idea = applyPlanFor(itemFromTemplate(ideaTemplate, replyContext), {
      answers: { idea: 'pins' },
      context: replyContext,
    });
    expect(idea.insertText).toBe(
      'Thank you, Moss. I like the idea of pins, and it is on our list.',
    );
    expect(idea.answers).toEqual({ idea: 'pins' });
    expect(
      applyPlanFor(itemFromTemplate(linkTemplate, replyContext), {
        context: replyContext,
      }).attach,
    ).toEqual({
      kind: 'link',
      url: 'https://docs.example.org/start',
      title: 'Getting started',
      description: '',
    });
  });

  it('drops the embed when the slot is locked or the quote is gone', () => {
    const locked = applyPlanFor(
      itemFromTemplate(stampTemplate, replyContext, { embedView: ownPostView }),
      { context: replyContext, quoteSlotLocked: true },
    );
    expect(locked.attach).toBeUndefined();
    expect(locked.insertText).toBe('I wrote a little about that here.');
    expect(
      applyPlanFor(
        itemFromTemplate(stampTemplate, replyContext, { embedView: 'missing' }),
        { context: replyContext },
      ).attach,
    ).toBeUndefined();
    // A link card survives a locked quote slot.
    expect(
      applyPlanFor(itemFromTemplate(linkTemplate, replyContext), {
        context: replyContext,
        quoteSlotLocked: true,
      }),
    ).toMatchObject({
      attach: { kind: 'link', url: 'https://docs.example.org/start' },
    });
    expect(
      applyPlanFor(itemFromTemplate(linkTemplate, replyContext), {
        context: replyContext,
      }).insertText,
    ).toBeUndefined();
  });

  it('attaches posts, feeds, lists and links', () => {
    const feed = { uri: 'at://x/app.bsky.feed.generator/f', cid: 'cf' };
    const list = { uri: 'at://x/app.bsky.graph.list/l', cid: 'cl' };
    expect(applyPlanFor(itemFromPost(ownPostView, { selfDid: SELF }))).toEqual({
      attach: {
        kind: 'post',
        uri: ownPostUri,
        cid: 'cid-stamina',
        view: ownPostView,
      },
      title: 'A few words on stamina, since it comes up a lot.',
      templateRkey: null,
    });
    expect(applyPlanFor(itemFromFeed(feed)).attach).toEqual({
      kind: 'feed',
      uri: feed.uri,
      cid: 'cf',
      view: feed,
    });
    expect(applyPlanFor(itemFromList(list)).attach).toEqual({
      kind: 'list',
      uri: list.uri,
      cid: 'cl',
      view: list,
    });
    expect(
      applyPlanFor(itemFromLink({ url: 'https://a.example/x' })).attach,
    ).toEqual({ kind: 'link', url: 'https://a.example/x' });
    expect(applyPlanFor({ kind: 'nothing' }).attach).toBeUndefined();
    expect(
      applyPlanFor(itemFromPost(ownPostView, { selfDid: SELF }), {
        quoteSlotLocked: true,
      }).attach,
    ).toBeUndefined();
    expect(
      applyPlanFor(itemFromFeed(feed), { quoteSlotLocked: true }).attach,
    ).toBeUndefined();
    expect(
      applyPlanFor(itemFromLink({ url: 'https://a.example/x' }), {
        quoteSlotLocked: true,
      }).attach,
    ).toEqual({ kind: 'link', url: 'https://a.example/x' });
  });
});

describe('detectSlashCommand', () => {
  it('finds a shortcut at the start, after a space and after a newline', () => {
    expect(detectSlashCommand('/stam', 5)).toEqual({
      start: 0,
      end: 5,
      query: 'stam',
    });
    expect(detectSlashCommand('hello /Stam', 11)).toEqual({
      start: 6,
      end: 11,
      query: 'stam',
    });
    expect(detectSlashCommand('hi\n/bug-2', 9)).toEqual({
      start: 3,
      end: 9,
      query: 'bug-2',
    });
  });

  it('gives an empty query for a bare slash', () => {
    expect(detectSlashCommand('/', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(detectSlashCommand('ok /', 4)).toEqual({
      start: 3,
      end: 4,
      query: '',
    });
  });

  it('ignores slashes inside words, URLs and "w/"', () => {
    expect(detectSlashCommand('a/b', 3)).toBe(null);
    expect(detectSlashCommand('see https://example.com/path', 28)).toBe(null);
    expect(detectSlashCommand('https://', 8)).toBe(null);
    expect(detectSlashCommand('coffee w/', 9)).toBe(null);
    expect(detectSlashCommand('coffee w/ milk', 14)).toBe(null);
  });

  it('ignores a caret inside a word or after a space', () => {
    expect(detectSlashCommand('/stamina', 4)).toBe(null);
    expect(detectSlashCommand('/stamina more', 13)).toBe(null);
    expect(detectSlashCommand('/stamina ', 9)).toBe(null);
    // The command ends at the caret even with text after it.
    expect(detectSlashCommand('/sta more', 4)).toEqual({
      start: 0,
      end: 4,
      query: 'sta',
    });
  });

  it('caps the query at 32 characters and defaults the caret to the end', () => {
    expect(detectSlashCommand(`/${'a'.repeat(33)}`)).toBe(null);
    expect(detectSlashCommand(`/${'a'.repeat(32)}`)).toEqual({
      start: 0,
      end: 33,
      query: 'a'.repeat(32),
    });
  });
});

describe('rankTemplatesForSlash', () => {
  const t = (rkey, value) => template({ text: 'x', ...value }, rkey);
  const ids = (list) => list.map((x) => x.rkey);

  it('orders by keyword hits in their post, then use, then name', () => {
    const list = [
      t('b', { name: 'Bravo', keywords: ['stamina'] }),
      t('a', { name: 'alpha' }),
      t('c', { name: 'Charlie', keywords: ['stamina', 'walks'] }),
      t('d', { name: 'Delta' }),
    ];
    const usage = { d: { count: 4 }, a: { count: 1 } };
    expect(
      ids(
        rankTemplatesForSlash(list, {
          parentText: replyTo.record.text,
          usage,
          replying: true,
        }),
      ),
    ).toEqual(['c', 'b', 'd', 'a']);
    // With no post to read, use and then name decide; case doesn't split names.
    expect(ids(rankTemplatesForSlash(list, { usage }))).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
    expect(ids(rankTemplatesForSlash(list))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts templates not offered here last, and returns a new array', () => {
    const list = [
      t('p', { name: 'Post only', use: 'post', keywords: ['stamina'] }),
      t('r', { name: 'Reply', use: 'reply' }),
      t('any', { name: 'Zed' }),
    ];
    expect(
      ids(
        rankTemplatesForSlash(list, {
          parentText: replyTo.record.text,
          replying: true,
        }),
      ),
    ).toEqual(['r', 'any', 'p']);
    expect(ids(rankTemplatesForSlash(list, { replying: false }))).toEqual([
      'p',
      'any',
      'r',
    ]);
    expect(rankTemplatesForSlash(list)).not.toBe(list);
    expect(rankTemplatesForSlash(null)).toEqual([]);
  });

  it('feeds matchShortcut an order it keeps among equal matches', () => {
    const list = [
      t('a', { name: 'A', shortcut: 'alpha' }),
      t('b', { name: 'B', shortcut: 'beta', keywords: ['stamina'] }),
    ];
    const ranked = rankTemplatesForSlash(list, {
      parentText: replyTo.record.text,
      replying: true,
    });
    expect(
      searchItems(
        ranked.map((x) => itemFromTemplate(x, replyContext)),
        '/',
        { replying: true },
      ).map((i) => i.id),
    ).toEqual(['template:b', 'template:a']);
  });
});

describe('insertText', () => {
  it('joins with one space on either side, none at the edges', () => {
    expect(insertText('', 'Hi.', { start: 0, end: 0 })).toEqual({
      text: 'Hi.',
      caret: 3,
    });
    expect(insertText('Hello', 'world', { start: 5, end: 5 })).toEqual({
      text: 'Hello world',
      caret: 11,
    });
    expect(insertText('world', 'Hello', { start: 0, end: 0 })).toEqual({
      text: 'Hello world',
      caret: 5,
    });
    expect(insertText('ab', 'X', { start: 1, end: 1 })).toEqual({
      text: 'a X b',
      caret: 3,
    });
  });

  it('adds no space next to existing whitespace', () => {
    expect(insertText('Hello ', 'world', { start: 6, end: 6 })).toEqual({
      text: 'Hello world',
      caret: 11,
    });
    expect(insertText('a\nb', 'X', { start: 2, end: 2 })).toEqual({
      text: 'a\nX b',
      caret: 3,
    });
  });

  it('replaces a range, and a null addition takes out a "/shortcut"', () => {
    expect(
      insertText('Thanks /idea', 'Thank you.', { start: 7, end: 12 }),
    ).toEqual({ text: 'Thanks Thank you.', caret: 17 });
    expect(insertText('a /x b', null, { start: 2, end: 4 })).toEqual({
      text: 'a b',
      caret: 2,
    });
    expect(insertText('a / b', null, { start: 2, end: 3 })).toEqual({
      text: 'a b',
      caret: 2,
    });
    expect(insertText('keep', null, { start: 4, end: 4 })).toEqual({
      text: 'keep',
      caret: 4,
    });
  });

  it('leaves a selection of other text be when there is nothing to put in its place', () => {
    expect(
      insertText('Look at this thread', null, { start: 8, end: 19 }),
    ).toEqual({ text: 'Look at this thread', caret: 19 });
    expect(insertText('Look at this thread', '', { start: 0, end: 4 })).toEqual(
      { text: 'Look at this thread', caret: 4 },
    );
    expect(insertText('a /x and more', null, { start: 2, end: 13 })).toEqual({
      text: 'a /x and more',
      caret: 13,
    });
    expect(
      insertText('Look at this thread', 'that', { start: 8, end: 19 }),
    ).toEqual({ text: 'Look at that', caret: 12 });
  });

  it('defaults to the end of the text and clamps a range out of bounds', () => {
    expect(insertText('Hello', 'there')).toEqual({
      text: 'Hello there',
      caret: 11,
    });
    expect(insertText('Hello', 'there', { start: 99, end: 120 })).toEqual({
      text: 'Hello there',
      caret: 11,
    });
  });
});

describe('drafts', () => {
  it('round-trips a template through a draft', () => {
    const t = template({
      name: 'Thanks for the idea',
      text: 'Thank you, {{their.firstName}}. {{idea}} is on the list. {{when}}',
      variables: [
        { key: 'their.firstName', label: 'Their name' },
        {
          key: 'idea',
          label: 'What did they suggest?',
          hint: 'A few words',
          default: 'That',
        },
        {
          key: 'when',
          label: 'When?',
          kind: 'choice',
          choices: ['Soon.', 'Someday.'],
          optional: true,
        },
      ],
      embed: stampTemplate.embed,
      use: 'reply',
      group: 'Thanks',
      shortcut: 'idea',
      keywords: ['idea', 'suggest'],
      langs: ['en'],
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const draft = draftFromTemplate(t);
    expect(draft.keywordsText).toBe('idea, suggest');
    expect(draft.quoteMode).toBe('post');
    expect(draft.quoteView).toBe(null);
    expect(draft.variables.find((v) => v.key === 'when').choicesText).toBe(
      'Soon.\nSomeday.',
    );
    expect(templateFromDraft(draft)).toEqual(t);
  });

  it('splits keywords and choices, strips the shortcut slash and drops blanks the text lost', () => {
    const draft = {
      ...draftFromTemplate(null),
      name: 'Bug',
      text: 'Which {{device}}?',
      keywordsText: 'bug, crash,\nBug, ',
      shortcut: '/Bug',
      variables: [
        {
          key: 'device',
          label: 'Device?',
          kind: 'choice',
          choicesText: 'Phone\n\n Laptop \n',
        },
        { key: 'gone', label: 'No longer in the text' },
      ],
    };
    const t = templateFromDraft(draft);
    expect(t.keywords).toEqual(['bug', 'crash']);
    expect(t.shortcut).toBe('bug');
    expect(t.variables).toEqual([
      {
        key: 'device',
        label: 'Device?',
        kind: 'choice',
        choices: ['Phone', 'Laptop'],
      },
    ]);
    expect(
      templateFromDraft({
        ...draft,
        variables: [{ key: 'device', kind: 'choice', choicesText: '' }],
      }).variables,
    ).toEqual([{ key: 'device', kind: 'choice', choices: [] }]);
  });

  it('drops the embed when the quote is set to none and keeps one the editor can’t show', () => {
    expect(
      templateFromDraft({
        ...draftFromTemplate(stampTemplate),
        quoteMode: 'none',
      }).embed,
    ).toBe(null);
    const images = { $type: 'app.bsky.embed.images', images: [] };
    const draft = draftFromTemplate(
      template({ name: 'Pics', text: 'x', embed: images }, 'pics'),
    );
    expect(draft.quoteMode).toBe('other');
    expect(templateFromDraft(draft).embed).toEqual(images);
    expect(draftFromTemplate(linkTemplate)).toMatchObject({
      quoteMode: 'link',
      quoteUrl: 'https://docs.example.org/start',
    });
  });

  it('makes a card for each asked blank as it is typed', () => {
    const draft = syncDraftVariables({
      ...draftFromTemplate(null),
      text: 'Hi {{their.firstName}}, try {{a}} and {{b}}',
      variables: [{ key: 'b', label: 'B?' }],
    });
    expect(draft.variables.map((v) => [v.key, v.label])).toEqual([
      ['a', ''],
      ['b', 'B?'],
    ]);
  });

  it('turns a reply into a draft, the author’s first name becoming a blank', () => {
    const { draft, note } = draftFromReply({
      text: 'Thanks Moss! Moss, have a look. Mossy is someone else.  ',
      replyTo,
      recordEmbed: { uri: ownPostUri, cid: 'cid-stamina' },
    });
    expect(draft.text).toBe(
      'Thanks {{their.firstName}}! {{their.firstName}}, have a look. Mossy is someone else.',
    );
    expect(note).toContain('“Moss”');
    expect(draft.use).toBe('reply');
    expect(draft.embed).toEqual({
      $type: 'app.bsky.embed.record',
      record: { uri: ownPostUri, cid: 'cid-stamina' },
    });
    expect(draft.quoteMode).toBe('post');
    expect(templateFromDraft(draft).text).toBe(draft.text);

    const withLink = draftFromReply({
      text: 'Here you go',
      replyTo,
      linkUrl: 'https://docs.example.org/a',
    });
    expect(withLink.note).toBe(null);
    expect(withLink.draft).toMatchObject({
      quoteMode: 'link',
      quoteUrl: 'https://docs.example.org/a',
    });
    expect(withLink.draft.embed.external.uri).toBe(
      'https://docs.example.org/a',
    );
  });

  it('leaves the name alone inside links, handles, email addresses, hashtags and domains', () => {
    const wren = {
      ...replyTo,
      author: { ...replyTo.author, displayName: 'wren' },
    };
    const text =
      'see https://wren.blog and https://x.example/?u=wren, ping @wren.bsky.social or wren@x.com, #wren, wren.blog or wren_art. Thanks wren. wren, hi!';
    const { draft, note } = draftFromReply({ text, replyTo: wren });
    expect(draft.text).toBe(
      'see https://wren.blog and https://x.example/?u=wren, ping @wren.bsky.social or wren@x.com, #wren, wren.blog or wren_art. Thanks {{their.firstName}}. {{their.firstName}}, hi!',
    );
    expect(note).toContain('“wren”');
    expect(
      draftFromReply({ text: 'ping @wren.bsky.social', replyTo: wren }),
    ).toMatchObject({ note: null, draft: { text: 'ping @wren.bsky.social' } });
  });
});

describe('library items as the design names them', () => {
  it('carry key, subtitle, what they point at, when, and how they did', () => {
    const post = itemFromPost(
      {
        ...ownPostView,
        likeCount: 4,
        repostCount: 1,
        replyCount: 2,
        quoteCount: 1,
      },
      { selfDid: SELF },
    );
    expect(post).toMatchObject({
      key: `post:${ownPostUri}`,
      id: `post:${ownPostUri}`,
      subtitle: post.label,
      uri: ownPostUri,
      cid: 'cid-stamina',
      at: ownPostView.record.createdAt,
      score: 8,
    });
    expect(post.view).toBe(post.source);

    const tpl = itemFromTemplate(stampTemplate, replyContext);
    expect(tpl).toMatchObject({
      key: 'template:stamina',
      template: stampTemplate,
      uri: null,
    });

    const link = itemFromLink({
      url: 'https://a.example/x',
      title: 'A',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    expect(link).toMatchObject({
      url: 'https://a.example/x',
      at: '2026-10-01T00:00:00.000Z',
    });

    const feed = itemFromFeed({
      uri: 'at://x/app.bsky.feed.generator/f',
      cid: 'cf',
      displayName: 'F',
    });
    expect(feed).toMatchObject({
      uri: 'at://x/app.bsky.feed.generator/f',
      cid: 'cf',
      view: feed.source,
    });
  });

  it('make an archive row a post with no cid yet, on the shelf its thread puts it on', () => {
    const row = {
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
    };
    const item = itemFromArchiveRow(row, { selfDid: SELF });
    expect(item).toMatchObject({
      kind: 'post',
      shelf: 'posts',
      title: 'First line',
      excerpt: 'second',
      uri: row.uri,
      cid: null,
      view: null,
      score: 4,
      at: row.at,
    });
    expect(item.label.startsWith('Your post · ')).toBe(true);
    expect(item.media).toEqual({ thumb: null, alt: '' });

    const selfReply = itemFromArchiveRow(
      { ...row, replyTo: SELF },
      { selfDid: SELF },
    );
    expect(selfReply.shelf).toBe('posts');
    const reply = itemFromArchiveRow(
      { ...row, replyTo: OTHER, hasMedia: false },
      { selfDid: SELF },
    );
    expect(reply.shelf).toBe('replies');
    expect(reply.label.startsWith('Your reply · ')).toBe(true);
    expect(isOwnThreadRow({ replyTo: OTHER }, SELF)).toBe(false);
    expect(applyPlanFor(item).attach).toEqual({
      kind: 'post',
      uri: row.uri,
      cid: null,
    });
  });

  it('sort by date or by engagement', () => {
    const a = { id: 'a', at: '2026-10-01T00:00:00Z', score: 5 };
    const b = { id: 'b', at: '2026-10-03T00:00:00Z', score: 1 };
    const c = { id: 'c', at: '2026-10-02T00:00:00Z', score: 5 };
    expect(sortItems([a, b, c]).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortItems([a, b, c], 'engagement').map((i) => i.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('know a post in your own thread from a reply to someone else', () => {
    expect(
      isOwnThreadPost({ uri: `at://${SELF}/app.bsky.feed.post/1`, record: {} }),
    ).toBe(true);
    const own = `at://${SELF}/app.bsky.feed.post/root`;
    const theirs = `at://${OTHER}/app.bsky.feed.post/root`;
    expect(
      isOwnThreadPost({
        uri: `at://${SELF}/app.bsky.feed.post/2`,
        record: { reply: { root: { uri: own }, parent: { uri: own } } },
      }),
    ).toBe(true);
    expect(
      isOwnThreadPost({
        uri: `at://${SELF}/app.bsky.feed.post/3`,
        record: { reply: { root: { uri: own }, parent: { uri: theirs } } },
      }),
    ).toBe(false);
    expect(engagementScore({ likes: 2, quotes: 1 })).toBe(3);
  });
});

describe('the composer’s side', () => {
  const stateWith = (post, reply = null) => ({
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
    reply,
  });

  it('reads what a post already carries', () => {
    expect(attachmentsFromState(stateWith({}))).toEqual({
      record: null,
      link: null,
      media: null,
    });
    expect(
      attachmentsFromState(
        stateWith({
          record: {
            kind: 'post',
            uri: ownPostUri,
            cid: 'c',
            view: ownPostView,
          },
          card: { url: 'https://a.example', title: '' },
          images: [{ id: 'i' }],
        }),
      ),
    ).toEqual({
      record: {
        by: 'Post by @you.example',
        title: 'A few words on stamina, since it comes up a lot.',
      },
      link: { url: 'https://a.example', title: 'https://a.example' },
      media: 'images',
    });
    expect(
      attachmentsFromState(
        stateWith({
          record: {
            kind: 'feed',
            uri: 'at://x/app.bsky.feed.generator/f',
            view: { displayName: 'F' },
          },
        }),
      ).record,
    ).toEqual({ by: 'Feed', title: 'F' });
  });

  it('previews against the composer’s own post when given its state', () => {
    const state = stateWith({
      text: 'Hi',
      record: { kind: 'post', uri: ownPostUri, cid: 'c' },
    });
    const preview = previewFor(itemFromPost(ownPostView, { selfDid: SELF }), {
      state,
      context: replyContext,
    });
    expect(preview.replacesAttachment).toBe(true);
    expect(preview.parts).toEqual([{ text: 'Hi', kind: 'existing' }]);
  });

  it('builds the template context from the post being replied to', () => {
    const reply = {
      uri: replyTo.uri,
      cid: 'c',
      root: { uri: replyTo.uri, cid: 'c' },
      author: replyTo.author,
      text: replyTo.record.text,
    };
    const ctx = libraryContext({
      reply,
      selfHandle: 'me.example',
      now: NOW,
      locale: 'en-US',
    });
    expect(ctx.their).toEqual({
      name: 'Moss Hollow',
      firstName: 'Moss',
      handle: 'moss.example',
    });
    expect(ctx.my.handle).toBe('me.example');
    // The dialog's own context ({ state, reply }) stands in for a template context.
    const plan = applyPlanFor(itemFromTemplate(ideaTemplate, ctx), {
      context: { state: stateWith({}, reply) },
      answers: { idea: 'x' },
    });
    expect(plan.insertText.startsWith('Thank you, Moss.')).toBe(true);
  });

  it('takes the "/shortcut" out of a reply being saved as a template', () => {
    expect(replyTextWithoutSlash('Thanks /idea', { start: 7, end: 12 })).toBe(
      'Thanks ',
    );
    expect(replyTextWithoutSlash('Thanks Moss', { start: 7, end: 11 })).toBe(
      'Thanks Moss',
    );
    expect(replyTextWithoutSlash('Thanks', null)).toBe('Thanks');
  });
});
