// src/posting/lib/embeds.js: the embed a post carries (record, video,
// images, link card, recordWithMedia) and the gallery normalization.
// Swift: VirgaPosting/Lib/Embeds.swift.
//
// Inputs from src/posting/lib/embeds.test.js, plus aspect ratios that round,
// are zero, negative, strings or missing; associated refs that are deduped,
// capped, trimmed or malformed; every precedence of video, images and card;
// and gallery embeds raw, viewed and inside recordWithMedia.

import {
  buildExternalEmbed,
  buildImageRecord,
  buildImagesEmbed,
  buildPostEmbed,
  buildRecordEmbed,
  buildVideoEmbed,
  combineRecordWithMedia,
  normalizeImageEmbed,
} from '../../../src/posting/lib/embeds.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/embeds.js'];

const blob = (cid) => ({
  $type: 'blob',
  ref: { $link: cid },
  mimeType: 'image/jpeg',
  size: 1,
});
const QUOTE = {
  kind: 'post',
  uri: 'at://did:plc:q/app.bsky.feed.post/3q',
  cid: 'bafyq',
};
const images = [
  { id: 'a', alt: 'one', aspectRatio: { width: 2, height: 1 } },
  { id: 'b', alt: '' },
];
const card = { url: 'https://e.com', title: 'T', description: '', thumb: null };

const RATIOS = [
  undefined,
  null,
  { width: 16, height: 9 },
  { width: 0, height: 3 },
  { width: 5 },
  { width: 4.5, height: 3.49 },
  { width: 0.4, height: 0.6 },
  { width: -1, height: 2 },
  { width: '1920', height: '1080' },
  { width: 'wide', height: 2 },
  { width: true, height: 1 },
  { width: 1e9, height: 1 },
  'square',
  [1, 2],
];

const REFS = [
  undefined,
  null,
  [],
  [{ uri: 'at://a/site.standard.document/1', cid: 'c' }],
  [
    { uri: ' at://a/x/1 ', cid: ' c1 ' },
    { uri: 'at://a/x/1', cid: 'c2' },
    { uri: 'https://not.at', cid: 'c' },
    { uri: 'at://a/x/2', cid: '' },
    { uri: 'at://a/x/3' },
    null,
    'at://a/x/4',
    [],
    { uri: 5, cid: 'c' },
    { uri: 'at://a/x/5', cid: 'c5' },
    { uri: 'at://a/x/6', cid: 'c6' },
    { uri: 'at://a/x/7', cid: 'c7' },
    { uri: 'at://a/x/8', cid: 'c8' },
  ],
  'not an array',
  { uri: 'at://a/x/1', cid: 'c' },
];

const POSTS = [
  {
    $id: 'nothing attached',
    post: { text: 'hi', images: [], video: null, record: null, card: null },
  },
  {
    $id: 'images in order',
    post: { images },
    blobs: { images: [blob('1'), blob('2')] },
  },
  {
    $id: 'fewer blobs than images',
    post: { images },
    blobs: { images: [blob('1')] },
  },
  { $id: 'images without blobs', post: { images }, blobs: {} },
  {
    $id: 'video first',
    post: { images, video: { alt: 'v' }, card },
    blobs: { video: blob('v'), images: [blob('1'), blob('2')] },
  },
  {
    $id: 'then images',
    post: { images, video: { alt: 'v' }, card },
    blobs: { images: [blob('1'), blob('2')] },
  },
  { $id: 'then a card', post: { card }, blobs: {} },
  { $id: 'card with thumb', post: { card }, blobs: { cardThumb: blob('t') } },
  { $id: 'card without url', post: { card: { title: 'x' } }, blobs: {} },
  {
    $id: 'video with ratio',
    post: { video: { alt: '', aspectRatio: { width: 1080, height: 1920 } } },
    blobs: { video: blob('v') },
  },
  {
    $id: 'video without blob falls to images',
    post: { video: { alt: 'v' }, images },
    blobs: { images: [blob('1'), blob('2')] },
  },
  {
    $id: 'record with media',
    post: { record: QUOTE, card },
    blobs: { cardThumb: blob('t') },
  },
  { $id: 'record alone', post: { record: QUOTE }, blobs: {} },
  ...['feed', 'list', 'starterpack'].map((kind) => ({
    $id: `record ${kind}`,
    post: { record: { kind, uri: `at://did:plc:x/${kind}/1`, cid: 'bafyk' } },
    blobs: {},
  })),
  {
    $id: 'record without cid',
    post: { record: { kind: 'post', uri: 'at://x' } },
    blobs: {},
  },
  {
    $id: 'record without cid keeps media',
    post: { record: { uri: 'at://x' }, card },
    blobs: {},
  },
  {
    $id: 'record with images',
    post: { record: QUOTE, images },
    blobs: { images: [blob('1'), blob('2')] },
  },
  {
    $id: 'card with refs',
    post: {
      card: { ...card, associatedRefs: [{ uri: 'at://a/b/c', cid: 'd' }] },
    },
    blobs: {},
  },
  { $id: 'null post', post: null, blobs: {} },
  { $id: 'no blobs given', post: { card } },
  // `blobs.images[i]` of a string is its i-th character.
  {
    $id: 'image blobs as a string',
    post: { images: [{ alt: 'a' }, { alt: 'b' }, { alt: 'c' }] },
    blobs: { images: 'x\u{1F98B}' },
  },
];

const GALLERIES = [
  {
    $type: 'app.bsky.embed.gallery',
    items: [
      { image: 'b', alt: 'a', aspectRatio: { width: 1, height: 1 } },
      { image: 'c' },
    ],
  },
  {
    $type: 'app.bsky.embed.gallery#view',
    items: [
      { thumbnail: 't', fullsize: 'f' },
      {
        thumbnail: 't2',
        fullsize: 'f2',
        alt: 'x',
        aspectRatio: { width: 3, height: 4 },
      },
    ],
  },
  {
    $type: 'app.bsky.embed.recordWithMedia#view',
    record: {},
    media: {
      $type: 'app.bsky.embed.gallery#view',
      items: [{ thumbnail: 't', fullsize: 'f' }],
    },
  },
  {
    $type: 'app.bsky.embed.recordWithMedia',
    record: { record: { uri: 'at://x', cid: 'y' } },
    media: { $type: 'app.bsky.embed.gallery', items: [] },
  },
  { $type: 'app.bsky.embed.gallery' },
  { $type: 'app.bsky.embed.external', external: {} },
  {
    $type: 'app.bsky.embed.recordWithMedia',
    media: { $type: 'app.bsky.embed.images' },
  },
  { $type: '' },
  { notype: true },
  null,
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'buildRecordEmbed',
      [{ uri: 'at://x', cid: 'c', extra: 1 }, { uri: 'at://x' }, {}].map(
        (record) => ({ record }),
      ),
      ({ record }) => buildRecordEmbed(record),
    )),
  );
  const rec = buildRecordEmbed({ uri: 'at://x', cid: 'c' });
  out.push(
    ...(await each(
      'combineRecordWithMedia',
      [
        { media: { $type: 'app.bsky.embed.images', images: [] } },
        { media: null },
        { media: 0 },
        { media: '' },
      ].map(({ media }) => ({ record: rec, media })),
      ({ record, media }) => combineRecordWithMedia(record, media),
    )),
  );
  out.push(
    ...(await each(
      'buildVideoEmbed',
      [
        ...RATIOS.map((aspectRatio) => ({ blob: 'b', alt: 'a', aspectRatio })),
        { blob: 'b' },
        { blob: blob('v'), alt: '' },
        { alt: 'no blob' },
        { blob: 'b', alt: 7 },
      ],
      (input) => buildVideoEmbed(input),
    )),
  );
  out.push(
    ...(await each(
      'buildImageRecord',
      [
        ...RATIOS.map((aspectRatio) => ({ blob: 'b', alt: 'x', aspectRatio })),
        { blob: 'b' },
        { alt: 'only alt' },
      ],
      (input) => buildImageRecord(input),
    )),
  );
  out.push(
    ...(await each(
      'buildImagesEmbed',
      [{ records: [] }, { records: [{ alt: '', image: 'b' }] }],
      ({ records }) => buildImagesEmbed(records),
    )),
  );
  out.push(
    ...(await each(
      'buildExternalEmbed',
      [
        ...REFS.map((associatedRefs) => ({
          card: {
            url: 'https://e.com',
            title: 'T',
            description: 'D',
            associatedRefs,
          },
          thumb: blob('thumb'),
        })),
        { card: { url: 'https://e.com' } },
        {
          card: { url: 'https://e.com', title: '', description: null },
          thumb: null,
        },
        { card: {} },
      ],
      ({ card, thumb }) => buildExternalEmbed(card, thumb),
    )),
  );
  out.push(
    ...(await each('buildPostEmbed', POSTS, ({ post, blobs }) =>
      blobs === undefined ? buildPostEmbed(post) : buildPostEmbed(post, blobs),
    )),
  );
  out.push(
    ...(await each(
      'normalizeImageEmbed',
      GALLERIES.map((embed) => ({ embed })),
      ({ embed }) => normalizeImageEmbed(embed),
    )),
  );
  return out;
}
