// src/posting/library/store.js: its constants and the shelf items built from
// what it holds (postsSource, buildShelfItems, templateShelf,
// remoteQueryFor). The store itself (createLibraryStore) is held to
// store.test.js by behaviour tests in Swift (LibraryStoreBehaviourTests).
// Swift: VirgaPosting/Library/LibraryStore*.swift.

import * as ST from '../../../src/posting/library/store.js';
import { buildTemplateContext } from '../../../src/posting/templates/postTemplates.js';
import { each, value } from './_helpers.js';
import {
  FEEDS,
  LISTS,
  NOW,
  OTHER,
  ROWS,
  SELF,
  TEMPLATES,
  onClock,
  ownPostView,
  replyContext,
  template,
} from './_library.js';

export const sources = ['src/posting/library/store.js'];

const postUri = (did, rkey) => `at://${did}/app.bsky.feed.post/${rkey}`;
const view = (uri, extra = {}) => ({
  uri,
  cid: `cid-${uri.split('/').pop()}`,
  author: { did: uri.split('/')[2], handle: 'h.example' },
  record: { text: 'x', createdAt: '2026-10-01T00:00:00Z' },
  ...extra,
});
const ready = (data) => ({ status: 'ready', data });

const shortItem = (i) => ({
  id: i.id,
  shelf: i.shelf,
  label: i.label,
  group: i.group,
  embedView: i.embedView === undefined ? '$undefined' : i.embedView,
});
const short = (out) => ({
  items: out.items.map(shortItem),
  ...(out.sections
    ? {
        sections: out.sections.map((s) => ({
          ...s,
          items: s.items.map((i) => i.id),
        })),
      }
    : { total: out.total }),
});

export default async function cases() {
  const rows = [
    {
      uri: postUri(SELF, 'a'),
      at: '2026-10-01T00:00:00Z',
      text: 'one',
      replyTo: null,
      likes: 5,
    },
    {
      uri: postUri(SELF, 'b'),
      at: '2026-10-02T00:00:00Z',
      text: 'two',
      replyTo: OTHER,
      likes: 1,
    },
    ...Object.values(ROWS),
  ];
  const feedViews = [
    view(postUri(SELF, 'f'), { likeCount: 1 }),
    view(postUri(SELF, 'g'), { likeCount: 7 }),
    view(postUri(SELF, 'h'), {
      record: { text: 'reply', createdAt: '2026-09-01T00:00:00Z' },
    }),
  ];
  const t = (rkey, v) => template({ text: 'x', ...v }, rkey);
  const context = buildTemplateContext({
    self: { handle: 'me.example' },
    now: new Date(NOW),
    locale: 'en-US',
  });
  const quoted = postUri(SELF, 'q');
  const quoting = (rkey, uri, extra = {}) =>
    t(rkey, {
      name: rkey.toUpperCase(),
      embed: { $type: 'app.bsky.embed.record', record: { uri, cid: 'c' } },
      ...extra,
    });

  return [
    value('STALE_MS', ST.STALE_MS),
    value('STORE_SHELVES', ST.STORE_SHELVES),
    value('IDLE_ENTRY', ST.IDLE_ENTRY),

    ...(await each(
      'postsSource',
      [
        { entry: { status: 'loading' } },
        { entry: ready({ items: rows }) },
        { entry: ready({ items: [] }) },
        { entry: ready(null) },
        { entry: { status: 'error' } },
        { entry: { status: 'idle' } },
        {},
      ],
      ({ entry }) => ST.postsSource(entry),
    )),

    ...(await each(
      'buildShelfItems',
      [
        {
          $id: 'posts-archive',
          shelfId: 'posts',
          archive: ready({ items: rows }),
          feed: ready({ items: feedViews }),
          did: SELF,
        },
        {
          $id: 'replies-archive',
          shelfId: 'replies',
          archive: ready({ items: rows }),
          did: SELF,
        },
        {
          $id: 'posts-engagement',
          shelfId: 'posts',
          archive: ready({ items: rows }),
          did: SELF,
          sort: 'engagement',
        },
        {
          $id: 'posts-query',
          shelfId: 'posts',
          archive: ready({ items: rows }),
          did: SELF,
          query: 'ONE',
        },
        {
          $id: 'posts-limit',
          shelfId: 'posts',
          archive: ready({ items: rows }),
          did: SELF,
          limit: 1,
        },
        {
          $id: 'posts-feed',
          shelfId: 'posts',
          archive: ready({ items: [] }),
          feed: ready({ items: feedViews }),
          did: SELF,
        },
        {
          $id: 'posts-feed-engagement',
          shelfId: 'posts',
          archive: { status: 'error' },
          feed: ready({ items: feedViews }),
          did: SELF,
          sort: 'engagement',
        },
        {
          $id: 'replies-feed',
          shelfId: 'replies',
          archive: ready({ items: [] }),
          feed: ready({ items: feedViews }),
          did: SELF,
        },
        {
          $id: 'posts-loading',
          shelfId: 'posts',
          archive: { status: 'loading' },
          feed: ready({ items: feedViews }),
          did: SELF,
        },
        { $id: 'posts-nothing', shelfId: 'posts', did: SELF },
        {
          $id: 'saved',
          shelfId: 'saved',
          entry: ready({ items: [view(postUri(OTHER, 's')), ownPostView] }),
          did: SELF,
        },
        {
          $id: 'links',
          shelfId: 'links',
          entry: ready({
            items: [
              { url: 'https://a.example' },
              { url: 'https://www.b.example/x/' },
            ],
          }),
        },
        {
          $id: 'feeds',
          shelfId: 'feeds',
          entry: ready({
            items: [
              { uri: 'at://x/app.bsky.feed.generator/own' },
              FEEDS.mine,
              FEEDS.mine,
            ],
            saved: [
              { uri: 'at://x/app.bsky.feed.generator/own' },
              { uri: 'at://y/app.bsky.feed.generator/s' },
              FEEDS.theirs,
            ],
          }),
        },
        {
          $id: 'feeds-no-saved',
          shelfId: 'feeds',
          entry: ready({ items: [FEEDS.mine] }),
        },
        {
          $id: 'lists',
          shelfId: 'lists',
          entry: ready({ items: Object.values(LISTS) }),
        },
        {
          $id: 'lists-idle',
          shelfId: 'lists',
          entry: { status: 'idle', data: null },
        },
        {
          $id: 'unknown',
          shelfId: 'search',
          entry: ready({ items: [FEEDS.mine] }),
        },
      ],
      ({ shelfId, archive, feed, entry, ...opts }) =>
        onClock(() =>
          short(
            ST.buildShelfItems(
              shelfId,
              shelfId === 'posts' || shelfId === 'replies'
                ? { archive, feed }
                : entry,
              opts,
            ),
          ),
        ),
    )),

    ...(await each(
      'templateShelf',
      [
        {
          $id: 'groups',
          templates: [
            t('a', { name: 'Alpha', group: 'Help' }),
            t('b', { name: 'Beta' }),
            t('c', { name: 'Gamma', use: 'reply' }),
            t('d', { name: 'Delta', group: 'Help' }),
          ],
          usage: { d: { count: 2 } },
          context,
          embeds: {},
          replying: false,
        },
        {
          $id: 'for-posts',
          templates: [
            t('a', { name: 'Alpha', use: 'post' }),
            t('c', { name: 'Gamma', use: 'reply' }),
          ],
          context,
          embeds: {},
          replying: false,
        },
        {
          $id: 'for-replies',
          templates: [
            t('a', { name: 'Alpha', use: 'post' }),
            t('c', { name: 'Gamma', use: 'reply' }),
          ],
          context,
          embeds: {},
          replying: true,
        },
        {
          $id: 'embeds',
          templates: [
            quoting('q', quoted),
            quoting('gone', postUri(SELF, 'gone')),
            quoting('unknown', postUri(SELF, 'unknown')),
            t('link', { name: 'Link', embed: TEMPLATES.linkTemplate.embed }),
          ],
          context,
          embeds: {
            [quoted]: { uri: quoted, author: { handle: 'me.example' } },
            [postUri(SELF, 'gone')]: 'missing',
          },
        },
        {
          $id: 'groups-spaced',
          templates: [
            t('a', { name: 'A', group: ' Help ' }),
            t('b', { name: 'B', group: 'Help' }),
            t('c', { name: 'C', group: 'Other' }),
            t('d', { name: 'D', group: 'help' }),
          ],
          context: replyContext,
          replying: true,
        },
        {
          $id: 'all-elsewhere',
          templates: [t('p', { name: 'P', use: 'post' })],
          context: replyContext,
          replying: true,
        },
        {
          $id: 'fixtures',
          templates: Object.values(TEMPLATES),
          context: replyContext,
          replying: true,
          usage: { idea: { count: 3 }, app: { count: 3 } },
        },
        { $id: 'none', templates: null },
      ],
      ({ templates, embeds, ...opts }) =>
        onClock(() =>
          short(
            ST.templateShelf(templates, {
              ...opts,
              embeds: embeds ? new Map(Object.entries(embeds)) : undefined,
            }),
          ),
        ),
    )),

    ...(await each(
      'remoteQueryFor',
      [
        { query: ' a ' },
        { query: ' ab ' },
        { query: '/idea' },
        { query: ' /idea' },
        { query: '' },
        { query: null },
        { query: 5 },
        { query: '😀' },
        { query: 'abc', minChars: 4 },
        { query: 'abcd', minChars: 4 },
        { query: 'é', minChars: 1 },
      ],
      ({ query, minChars }) =>
        minChars === undefined
          ? ST.remoteQueryFor(query)
          : ST.remoteQueryFor(query, minChars),
    )),
  ];
}
