// src/posting/library/libraryUi.js: the shelves' empty and hint copy,
// whether the search box holds a link, arrow-key moves, the template
// context a dialog's context stands for, the opening shelf, and a shelf's
// sections. Swift: VirgaPosting/Library/LibraryUI.swift.
//
// Inputs from libraryUi.test.js, plus at:// URIs in odd case, links with
// spaces and no dot, steps past the ends, and feeds of both groups.

import * as UI from '../../../src/posting/library/libraryUi.js';
import * as M from '../../../src/posting/library/model.js';
import { each, value } from './_helpers.js';
import { FEEDS, OTHER, onClock, replyContext } from './_library.js';

export const sources = ['src/posting/library/libraryUi.js'];

export default async function cases() {
  const yours = M.itemFromFeed(FEEDS.mine, { group: 'yours' });
  const saved = M.itemFromFeed(FEEDS.theirs, { group: 'saved' });
  const sourceSaved = {
    ...M.itemFromFeed(FEEDS.bare),
    source: { group: 'saved' },
  };
  const link = M.itemFromLink({ url: 'https://a.example/' });
  return [
    value('SHELF_EMPTY', UI.SHELF_EMPTY),
    value('SHELF_HINT', UI.SHELF_HINT),
    ...(await each(
      'looksLikeLink',
      [
        'https://bsky.app/profile/a.example/post/3abc',
        ' http://example.com ',
        'at://did:plc:abc/app.bsky.feed.post/3abc',
        'AT://DID:PLC:abc/APP.bsky.feed.post/3abc',
        'at://did:web:a.example/app.bsky.graph.list/x',
        'at://did:plc:abc/app.bsky.feed.post/',
        'at://did:plc:abc/app.bsky.feed.post/a/b',
        'at://did:9:abc/app.bsky.feed.post/a',
        'at://did:plc:abc/app_bsky/a',
        'at://handle.example/app.bsky.feed.post/a',
        'river walk',
        'example.com',
        'https://localhost',
        'mailto:a@b.c',
        'ftp://files.example/x',
        'https://a.example/with space',
        'https://a.example/ x',
        'https://bücher.example',
        'https://1.2.3.4/x',
        'https://[::1]/x',
        '',
        null,
        5,
      ].map((text) => ({ text })),
      ({ text }) => UI.looksLikeLink(text),
    )),
    ...(await each(
      'moveActive',
      [
        { ids: ['a', 'b', 'c'], activeId: 'a', delta: 1 },
        { ids: ['a', 'b', 'c'], activeId: 'c', delta: 1 },
        { ids: ['a', 'b', 'c'], activeId: 'a', delta: -1 },
        { ids: ['a', 'b', 'c'], activeId: null, delta: 1 },
        { ids: ['a', 'b', 'c'], activeId: 'gone', delta: -1 },
        { ids: ['a', 'b', 'c'], activeId: 'b', delta: 'first' },
        { ids: ['a', 'b', 'c'], activeId: 'b', delta: 'last' },
        { ids: [], activeId: 'a', delta: 1 },
        { ids: null, activeId: 'a', delta: 1 },
        { ids: ['a', '', null, 'b'], activeId: 'b', delta: 1 },
        { ids: ['a', 'b', 'c'], activeId: 'b', delta: 2 },
        { ids: ['a', 'b', 'c'], activeId: 'a', delta: -5 },
        { ids: ['a', 'b', 'c'], activeId: 'a', delta: 0.5 },
        { ids: ['a', 'b', 'c'], activeId: 'a', delta: 0 },
        { ids: ['é', 'é'], activeId: 'é', delta: 1 },
      ],
      ({ ids, activeId, delta }) => UI.moveActive(ids, activeId, delta),
    )),
    ...(await each(
      'templateContextFrom',
      [
        {
          $id: 'passes',
          context: { today: 'November 12', my: { handle: '@a' } },
        },
        { $id: 'real', context: replyContext },
        {
          $id: 'state-reply',
          context: {
            state: {
              reply: {
                uri: `at://${OTHER}/app.bsky.feed.post/1`,
                author: {
                  handle: 'wren.example',
                  displayName: '🌿 Wren Okafor',
                },
                text: 'hi',
              },
            },
          },
          selfHandle: 'mira.example.com',
        },
        {
          $id: 'reply-wins',
          context: {
            reply: { author: { handle: 'a.example', displayName: 'Ada' } },
            state: {
              reply: { author: { handle: 'b.example', displayName: 'Bo' } },
            },
          },
        },
        {
          $id: 'null-reply-falls-back',
          context: {
            reply: null,
            state: {
              reply: { author: { handle: 'b.example', displayName: 'Bo' } },
            },
          },
        },
        { $id: 'nothing', selfHandle: 'a.example' },
        { $id: 'today-not-string', context: { today: 5, my: { handle: 'x' } } },
      ],
      ({ context, selfHandle }) =>
        onClock(() => UI.templateContextFrom(context, { selfHandle })),
    )),
    ...(await each(
      'initialShelf',
      [
        { context: { shelf: 'saved' }, replying: false },
        { context: { shelf: 'suggested' }, replying: false },
        { context: { shelf: 'suggested' }, replying: true },
        { context: {}, replying: true },
        { context: null, replying: false },
        { context: { shelf: '' }, replying: true },
        { context: { shelf: 5 }, replying: false },
        { context: { shelf: 'nonsense' }, replying: false },
      ],
      ({ context, replying }) => UI.initialShelf(context, { replying }),
    )),
    ...(await each(
      'sectionsFor',
      [
        {
          $id: 'templates',
          shelfId: 'templates',
          items: [],
          templateSections: [
            { id: 'g', heading: 'G', muted: false, items: [link] },
          ],
        },
        { $id: 'templates-none', shelfId: 'templates', items: [link] },
        {
          $id: 'feeds-both',
          shelfId: 'feeds',
          items: [yours, saved, sourceSaved],
        },
        { $id: 'feeds-yours', shelfId: 'feeds', items: [yours] },
        { $id: 'feeds-saved', shelfId: 'feeds', items: [saved] },
        { $id: 'feeds-none', shelfId: 'feeds', items: [] },
        { $id: 'links', shelfId: 'links', items: [link] },
        { $id: 'links-none', shelfId: 'links', items: [] },
      ],
      ({ shelfId, items, templateSections }) =>
        UI.sectionsFor(shelfId, items, { templateSections }).map((s) => ({
          ...s,
          items: s.items.map((i) => i.id),
        })),
    )),
  ];
}
