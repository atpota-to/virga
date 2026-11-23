// src/posting/drafts/draftMedia.js: the paths Virga mints and reads, the
// media a state carries, and the store's operations over the web's own
// in-memory store (what draftMedia.js serves without IndexedDB): keeping a
// state's files, giving them back, forgetting and pruning them. Each case
// records what the call returned and what the store held after. Swift:
// VirgaPosting/Drafts/DraftMedia.swift over MemoryDraftMedia; the FileStore
// store is held to the same API by behaviour tests.
//
// Inputs from draftMedia.test.js, and more: files of every shape, Virga's
// paths and other apps', blobs, previews that throw, entries without a
// savedAt, keep lists of every kind.

import { each, value } from './_helpers.js';
import { loadFresh, withUuids } from './_publish.js';

export const sources = ['src/posting/drafts/draftMedia.js'];

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';

const file = (name, type = 'image/jpeg', size = 3) => ({ name, type, size });
const marker = (name, type = 'image/jpeg', size = 3) => ({
  $file: true,
  name,
  type,
  size,
  lastModified: 0,
});

const state = (posts) => ({ asDid: ALICE, posts });

const PREVIEWS = {
  none: null,
  named: (f) => `blob:${f.name}`,
  throws: () => {
    throw new Error('no preview');
  },
  empty: () => null,
};

export default async function cases() {
  const [m] = await loadFresh(['../../../src/posting/drafts/draftMedia.js']);
  const all = [
    value('draftMediaConstants', {
      POSTING_DB_PREFIX: m.POSTING_DB_PREFIX,
      LOCAL_REF_PREFIX: m.LOCAL_REF_PREFIX,
    }),
  ];

  all.push(
    ...(await each(
      'postingDbName',
      [
        { did: ALICE },
        { did: 'did:web:café.example' },
        { did: '' },
        { did: 'did:plc:a/b' },
      ],
      ({ did }) => m.postingDbName(did),
    )),
    ...(await each(
      'isVirgaLocalRef',
      [
        { path: 'virga-media:1' },
        { path: 'virga-media:' },
        { path: 'VIRGA-MEDIA:1' },
        { path: ' virga-media:1' },
        { path: 'file:///var/mobile/photo.jpg' },
        { path: '' },
        { path: null },
        { path: 5 },
        { path: ['virga-media:1'] },
      ],
      ({ path }) => m.isVirgaLocalRef(path),
    )),
    ...(await each('newLocalRef', [{ $id: 'two' }], () =>
      withUuids(() => [m.newLocalRef(), m.newLocalRef()]),
    )),
  );

  const shapes = [
    {
      $id: 'images-and-video',
      state: state([
        {
          id: 'p1',
          images: [
            { id: 'i1', localRef: 'virga-media:1' },
            { id: 'i2', localRef: 'file:///phone/2.jpg', alt: 'two' },
            { id: 'i3' },
            { id: 'i4', localRef: '' },
          ],
        },
        { id: 'p2', images: [], video: { localRef: 'virga-media:v' } },
        { id: 'p3', video: { localRef: 5 } },
      ]),
    },
    {
      $id: 'files-and-blobs',
      state: state([
        {
          id: 'p',
          images: [
            { id: 'a', localRef: 'virga-media:gone', alt: 'first' },
            {
              id: 'b',
              localRef: 'file:///phone/photo.jpg',
              alt: 'from the phone',
            },
            {
              id: 'c',
              localRef: 'file:///phone/2.jpg',
              blob: { ref: { $link: 'b' }, mimeType: 'image/jpeg' },
            },
            { id: 'd', localRef: 'virga-media:here', file: file('d.jpg') },
            { id: 'e', localRef: 'virga-media:marker', file: marker('e.jpg') },
            {
              id: 'f',
              localRef: 'virga-media:not-a-file',
              file: { name: 'f' },
            },
          ],
          video: { localRef: 'virga-media:v', alt: 0 },
        },
      ]),
    },
    { $id: 'empty', state: state([]) },
    { $id: 'no-posts', state: {} },
    { $id: 'null', state: null },
    {
      $id: 'loose-posts',
      state: { posts: [null, { video: null }, 5, { images: [null, 0] }] },
    },
  ];
  all.push(
    ...(await each('stateLocalRefs', shapes, ({ state: s }) =>
      m.stateLocalRefs(s),
    )),
    ...(await each('missingDraftMedia', shapes, ({ state: s }) =>
      m.missingDraftMedia(s),
    )),
  );

  /**
   * One operation on a store in memory that holds `seed` first: what it
   * returned, and the store's refs and entries after.
   */
  async function onStore({ did = ALICE, seed = [], run }) {
    m.resetDraftMedia();
    const media = await m.openDraftMedia(did, { indexedDB: null });
    await media.put(seed);
    const result = await withUuids(() => run(media));
    const refs = await media.refs();
    const entries = [];
    for (const ref of refs) entries.push(await media.get(ref));
    return { result, refs, entries, persistent: media.persistent };
  }

  all.push(
    ...(await each(
      'storeDraftMedia',
      [
        {
          $id: 'new-files',
          state: state([
            {
              id: 'p1',
              images: [
                {
                  id: 'i1',
                  file: file('a.jpg'),
                  mime: 'image/jpeg',
                  alt: 'a moth',
                  previewUrl: 'blob:1',
                },
              ],
            },
            {
              id: 'p2',
              images: [],
              video: {
                file: file('v.mp4', 'video/mp4', 9),
                mime: 'video/mp4',
                status: 'idle',
              },
            },
          ]),
          now: 5,
        },
        {
          $id: 'path-or-no-file',
          state: state([
            {
              id: 'p',
              images: [
                { id: 'i', localRef: 'virga-media:kept' },
                { id: 'j', blob: { ref: { $link: 'b' } } },
              ],
            },
          ]),
        },
        {
          $id: 'held-already',
          seed: [{ ref: 'virga-media:held', file: file('h.jpg') }],
          state: state([
            {
              id: 'p',
              images: [
                { id: 'i', localRef: 'virga-media:held', file: file('h.jpg') },
              ],
            },
          ]),
          now: 7,
        },
        {
          $id: 'virga-path-not-here',
          state: state([
            {
              id: 'p',
              images: [
                { id: 'i', localRef: 'virga-media:other', file: file('o.jpg') },
              ],
            },
          ]),
          now: 8,
        },
        {
          $id: 'other-apps-path',
          state: state([
            {
              id: 'p',
              images: [
                {
                  id: 'i',
                  localRef: 'file:///phone/photo.jpg',
                  file: file('a.jpg'),
                },
              ],
            },
          ]),
          now: 9,
        },
        {
          $id: 'file-shapes',
          state: state([
            {
              id: 'p',
              images: [
                { id: 'a', file: marker('m.png', 'image/png', 4) },
                { id: 'b', file: { type: 'image/png', size: 2 } },
                { id: 'c', file: { name: 'n', size: '2', type: 'image/png' } },
                {
                  id: 'd',
                  file: { name: 5, type: '', size: 1 },
                  mime: 'image/gif',
                },
                { id: 'e', file: { name: 'e', type: '', size: 1 } },
              ],
            },
          ]),
          now: 10,
        },
        { $id: 'nothing', state: state([{ id: 'p', images: [] }]) },
      ],
      ({ state: s, seed, now }) =>
        onStore({
          seed,
          run: (media) =>
            m.storeDraftMedia(
              ALICE,
              s,
              now === undefined ? { media, now: 1 } : { media, now },
            ),
        }),
    )),
  );

  const seeded = [
    { ref: 'virga-media:1', file: file('a.jpg'), type: 'image/jpeg', size: 3 },
    {
      ref: 'virga-media:v',
      file: file('v.mp4', 'video/mp4', 9),
      type: 'video/mp4',
    },
    { ref: 'virga-media:untyped', file: file('u.png', 'image/png', 4) },
    { ref: 'virga-media:no-file' },
    { ref: 'virga-media:sized', file: file('s.jpg'), type: '', size: 0 },
  ];
  const reopened = state([
    {
      id: 'p1',
      images: [
        { id: 'x', localRef: 'virga-media:1', alt: 'a moth' },
        { id: 'y', localRef: 'virga-media:untyped', mime: 'image/webp' },
        { id: 'z', localRef: 'virga-media:no-file', alt: 'gone' },
        { id: 'w', localRef: 'virga-media:sized', previewUrl: 'blob:kept' },
        {
          id: 'u',
          localRef: 'virga-media:missing',
          blob: { ref: { $link: 'b' } },
        },
        { id: 't', localRef: 'file:///phone/1.jpg' },
        { id: 's', localRef: 'virga-media:1', file: file('already.jpg') },
      ],
    },
    {
      id: 'p2',
      images: [],
      video: { localRef: 'virga-media:v', status: 'idle' },
    },
  ]);
  all.push(
    ...(await each(
      'loadDraftMedia',
      [
        ...Object.keys(PREVIEWS).map((preview) => ({
          $id: `preview-${preview}`,
          preview,
          seed: seeded,
        })),
        // An entry whose file has no size: `size: entry.size ?? entry.file.size`
        // is undefined, and the item's own size goes with it.
        {
          $id: 'sizes-unknown',
          preview: 'none',
          seed: [
            { ref: 'virga-media:nosize', file: { name: 'q.jpg', type: '' } },
            {
              ref: 'virga-media:nullsize',
              file: { name: 'n.jpg', size: null },
              size: null,
            },
          ],
          state: state([
            {
              id: 'p1',
              images: [
                {
                  id: 'q',
                  localRef: 'virga-media:nosize',
                  size: 12,
                  mime: 'image/png',
                },
                { id: 'n', localRef: 'virga-media:nullsize', size: 13 },
              ],
              video: { localRef: 'virga-media:nosize', size: 7, alt: 'v' },
            },
          ]),
        },
      ],
      ({ preview, seed, state: given }) =>
        onStore({
          seed,
          run: (media) =>
            m.loadDraftMedia(ALICE, given || reopened, {
              media,
              makePreviewUrl: PREVIEWS[preview],
            }),
        }),
    )),
  );

  const TWO = [
    { ref: 'virga-media:a', file: file('a') },
    { ref: 'virga-media:b', file: file('b') },
  ];
  all.push(
    ...(await each(
      'removeDraftMedia',
      [
        { $id: 'only-virgas', refs: ['virga-media:a', 'file:///x'], seed: TWO },
        { $id: 'none', refs: [], seed: TWO },
        { $id: 'null', refs: null, seed: TWO },
        { $id: 'not-held', refs: ['virga-media:zzz'], seed: TWO },
        { $id: 'non-strings', refs: [5, null, 'virga-media:b'], seed: TWO },
      ],
      ({ refs, seed }) =>
        onStore({
          seed,
          run: (media) => m.removeDraftMedia(ALICE, refs, { media }),
        }),
    )),
  );

  const SIX = [
    { ref: 'virga-media:a', file: file('a') },
    { ref: 'virga-media:b', file: file('b') },
    { ref: 'virga-media:c', file: file('c') },
    { ref: 'virga-media:old', file: file('a'), savedAt: 100 },
    { ref: 'virga-media:new', file: file('b'), savedAt: 200 },
    { ref: 'virga-media:string-time', file: file('s'), savedAt: '300' },
  ];
  all.push(
    ...(await each(
      'pruneDraftMedia',
      [
        { $id: 'keep-one', keep: ['virga-media:b'], seed: SIX },
        { $id: 'keep-none', keep: [], seed: SIX },
        { $id: 'keep-null', keep: null, seed: SIX },
        {
          $id: 'keep-all',
          keep: ['virga-media:a', 'virga-media:b', 'virga-media:c'],
          seed: SIX,
        },
        { $id: 'saved-before', keep: [], savedBefore: 200, seed: SIX },
        {
          $id: 'saved-before-keep',
          keep: ['virga-media:old'],
          savedBefore: 200,
          seed: SIX,
        },
        { $id: 'saved-before-zero', keep: [], savedBefore: 0, seed: SIX },
        { $id: 'other-account', did: BOB, keep: [], seed: SIX },
      ],
      ({ keep, savedBefore, did, seed }) =>
        onStore({
          did: did || ALICE,
          seed,
          run: (media) =>
            m.pruneDraftMedia(
              did || ALICE,
              keep,
              savedBefore === undefined ? { media } : { media, savedBefore },
            ),
        }),
    )),
  );

  return all;
}
