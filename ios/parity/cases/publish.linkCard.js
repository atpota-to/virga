// src/posting/lib/linkCard.js: the refs a card names, the card the card
// service (cardyb) gives for a link, the thumbnail fetched and shrunk, and
// the thumbnail uploaded as the write account (through Virga's server), as
// recorded exchanges. The re-encode and decode are scripted. Swift:
// VirgaPosting/Lib/LinkCard.swift, replayed through MockTransport.
//
// Inputs from linkCard.test.js, and more: every way the service's answer can
// be odd (an error, a failure, not JSON, the wrong types, long text cut at
// an emoji), addresses that aren't web addresses, a caller's deadline, image
// types, and every reason an upload is left out.

import { each } from './_helpers.js';
import { recordFetch, json, offline } from './_fetch.js';
import { markFiles, withFiles, file } from './_composer.js';
import {
  ME,
  NOW,
  OTHER,
  agentFor,
  hangs,
  loadFresh,
  pds,
  rawCid,
  scriptedImages,
  withFixedDate,
  withTimers,
} from './_publish.js';

export const sources = ['src/posting/lib/linkCard.js'];

const BLOB = {
  $type: 'blob',
  ref: { $link: rawCid('thumb') },
  mimeType: 'image/jpeg',
  size: 10,
};
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';

const image = (size = 10, contentType = 'image/png') => ({
  bytes: new Uint8Array(size),
  contentType,
});

/** Runs `fn` with fetch recorded; the card service answers `answer(request)`. */
async function recorded(answer, fn, server = null) {
  const out = await withFixedDate(NOW, () =>
    recordFetch(
      (request, index) => {
        if (server && request.url.startsWith('https://server.example/'))
          return server.responder(request, index);
        if (answer === 'offline') return offline();
        return typeof answer === 'function' ? answer(request, index) : answer;
      },
      () => withTimers([], fn),
      { now: NOW },
    ),
  );
  return server ? hangs(out, server) : out;
}

export default async function cases() {
  const [m] = await loadFresh(['../../../src/posting/lib/linkCard.js']);
  const all = [];

  all.push(
    ...(await each(
      'normalizeAssociatedRefs',
      [
        {
          $id: 'deduped-and-capped',
          raw: [
            { uri: 'at://a/c/1', cid: 'x' },
            { uri: 'at://a/c/1', cid: 'y' },
            { uri: 'https://nope', cid: 'z' },
            { uri: 'at://a/c/2' },
            ...Array.from({ length: 6 }, (_, i) => ({
              uri: `at://b/c/${i}`,
              cid: 'c',
            })),
          ],
        },
        { $id: 'empty', raw: [] },
        { $id: 'string', raw: 'x' },
        { $id: 'null', raw: null },
        { $id: 'object', raw: { uri: 'at://a/c/1', cid: 'x' } },
        { $id: 'bad-items', raw: [null, 1, 'at://a', true, [], {}] },
        {
          $id: 'trimmed',
          raw: [{ uri: '  at://a/c/1\n', cid: '\tbafy ' }],
        },
        { $id: 'blank-cid', raw: [{ uri: 'at://a/c/1', cid: '   ' }] },
        { $id: 'number-uri', raw: [{ uri: 5, cid: 'x' }] },
        { $id: 'uppercase-scheme', raw: [{ uri: 'AT://a/c/1', cid: 'x' }] },
        { $id: 'bare-scheme', raw: [{ uri: 'at://', cid: 'x' }] },
        {
          $id: 'code-units',
          raw: [
            { uri: 'at://café/c/1', cid: 'x' },
            { uri: 'at://café/c/1', cid: 'y' },
          ],
        },
        {
          $id: 'exactly-four',
          raw: Array.from({ length: 4 }, (_, i) => ({
            uri: `at://d/c/${i}`,
            cid: `c${i}`,
          })),
        },
      ],
      ({ raw }) => m.normalizeAssociatedRefs(raw),
    )),
  );

  const long = (unit, n) => unit.repeat(n);
  const cards = [
    {
      $id: 'full',
      url: 'https://example.com/a',
      answer: json({
        title: 'A page',
        description: 'About it',
        image: 'https://cardyb.bsky.app/v1/image?url=x',
        url: 'https://example.com/final',
        associated_refs: [
          { uri: 'at://did:plc:a/site.standard.document/1', cid: 'bafy1' },
        ],
      }),
    },
    {
      $id: 'clamped',
      url: 'https://example.com',
      answer: json({ title: long('t', 300), description: long('d', 900) }),
    },
    {
      $id: 'clamped-at-emoji',
      url: 'https://example.com',
      answer: json({
        title: long('t', 199) + FAMILY,
        description: long('d', 499) + '\u{1F600}',
      }),
    },
    { $id: 'error', url: 'https://e.com', answer: json({ error: 'nope' }) },
    { $id: 'error-empty', url: 'https://e.com', answer: json({ error: '' }) },
    { $id: 'server-error', url: 'https://e.com', answer: json({}, 500) },
    { $id: 'offline', url: 'https://e.com', answer: 'offline' },
    {
      $id: 'not-json',
      url: 'https://e.com',
      answer: { status: 200, text: '<!DOCTYPE html>' },
    },
    { $id: 'json-null', url: 'https://e.com', answer: json(null) },
    { $id: 'json-zero', url: 'https://e.com', answer: json(0) },
    { $id: 'json-array', url: 'https://e.com', answer: json(['x']) },
    { $id: 'json-string', url: 'https://e.com', answer: json('page') },
    {
      $id: 'odd-types',
      url: 'https://e.com',
      answer: json({
        title: 42,
        description: { a: 1 },
        image: 7,
        associated_refs: 'x',
      }),
    },
    {
      $id: 'image-not-web',
      url: 'https://e.com',
      answer: json({ title: 'x', image: 'javascript:alert(1)' }),
    },
    {
      $id: 'image-relative',
      url: 'https://e.com',
      answer: json({ title: 'x', image: '/img.png' }),
    },
    {
      $id: 'image-normalized',
      url: 'https://e.com',
      answer: json({ title: 'x', image: '  HTTPS://IMG.Example.com/a b.png ' }),
    },
    { $id: 'not-a-web-address', url: 'javascript:alert(1)', answer: json({}) },
    { $id: 'ftp', url: 'ftp://e.com/x', answer: json({}) },
    { $id: 'empty-url', url: '', answer: json({}) },
    {
      $id: 'untrimmed-url',
      url: '  https://e.com/a?q=1&r=é  ',
      answer: json({ title: 'kept as given' }),
    },
    {
      $id: 'unicode-url',
      url: 'https://exämple.com/päge#frag',
      answer: json({ title: 'T' }),
    },
    {
      $id: 'caller-deadline',
      url: 'https://e.com',
      deadlineMs: 5000,
      answer: json({ title: 'soon' }),
    },
    {
      $id: 'caller-deadline-later',
      url: 'https://e.com',
      deadlineMs: 20000,
      answer: json({ title: 'later' }),
    },
  ];
  all.push(
    ...(await each('fetchLinkCard', cards, ({ url, answer, deadlineMs }) =>
      recorded(answer, () =>
        m.fetchLinkCard(
          url,
          deadlineMs ? { signal: AbortSignal.timeout(deadlineMs) } : {},
        ),
      ),
    )),
  );

  const thumbs = [
    { $id: 'png', imageUrl: 'https://img.example/x.png', answer: image() },
    {
      $id: 'uppercase-type',
      imageUrl: 'https://img.example/x.png',
      answer: image(12, 'IMAGE/PNG'),
    },
    {
      $id: 'type-with-params',
      imageUrl: 'https://img.example/x.png',
      answer: image(12, 'image/png; charset=binary'),
    },
    {
      $id: 'not-an-image-type',
      imageUrl: 'https://img.example/x',
      answer: image(12, 'text/html'),
    },
    {
      $id: 'octet-stream',
      imageUrl: 'https://img.example/x',
      answer: image(12, 'application/octet-stream'),
    },
    {
      $id: 'decoded',
      imageUrl: 'https://img.example/x.png',
      answer: image(),
      script: { decode: { width: 1200, height: 630 } },
    },
    {
      $id: 'not-found',
      imageUrl: 'https://img.example/x.png',
      answer: { status: 404, text: 'gone' },
    },
    {
      $id: 'not-a-web-address',
      imageUrl: 'data:image/png;base64,AAAA',
      answer: image(),
    },
    {
      $id: 'offline',
      imageUrl: 'https://img.example/x.png',
      answer: 'offline',
    },
    {
      $id: 'compress-throws',
      imageUrl: 'https://img.example/x.png',
      answer: image(),
      script: { compress: 'throw' },
    },
    {
      $id: 'still-too-big',
      imageUrl: 'https://img.example/x.png',
      answer: image(),
      script: { compress: { size: Math.floor(0.96 * 1024 * 1024) } },
    },
    {
      $id: 'caller-deadline',
      imageUrl: 'https://img.example/x.png',
      answer: image(),
      deadlineMs: 3000,
    },
    // The file's type is the response's as Node's fetch extracts it (a
    // MIME type parsed, serialized, lower-cased by the Blob), which the
    // re-encoder's call shows.
    ...[
      ['quoted-charset', 'image/png; charset="UTF-8"'],
      ['escaped-quote', 'image/png;charset="a\\"b"'],
      ['escaped-backslash', 'image/png;charset="a\\\\b"'],
      ['trailing-backslash', 'image/png;a="b\\'],
      ['list-last-wins', 'text/html, image/png'],
      ['list-last-not-image', 'image/png, text/html'],
      ['list-any-skipped', 'image/png, */*'],
      ['charset-carried', 'image/png;charset=a, image/png;x=1'],
      ['charset-carried-past-any', 'image/png;charset=A, */*, IMAGE/PNG'],
      ['charset-not-carried', 'image/png;charset=a, image/gif'],
      ['charset-own-wins', 'image/png;charset=a, image/png;charset=b'],
      ['semicolon-quoted', 'image/webp;a="x;y"'],
      ['comma-quoted', 'image/png;a="x,y"'],
      ['comma-quoted-list', 'image/png;charset=",",image/gif'],
      ['after-the-quote', 'image/png;a="b"c ;d=e'],
      ['unquoted-space', 'image/png;a=b c'],
      ['empty-quoted', 'image/png;a="'],
      ['empty-value', 'image/png;a=;b=1'],
      ['empty-name', 'image/png;=x;;y=2'],
      ['repeated-name', 'image/png;a=b;A=c'],
      ['backtick-value', 'image/png;a=`'],
      ['backtick-name', 'image/png;a`=1'],
      ['backtick-type', 'image/png`'],
      ['latin-1-value', 'image/png;a="é"'],
      ['space-in-type', 'image /png'],
      ['upper-case-everything', 'IMAGE/SVG+XML;CHARSET=X;Q="Y Z"'],
    ].map(([$id, contentType]) => ({
      $id: `type-${$id}`,
      imageUrl: 'https://img.example/x',
      answer: image(4, contentType),
    })),
  ];
  all.push(
    ...(await each(
      'fetchCardThumbnail',
      thumbs,
      async ({ imageUrl, answer, script, deadlineMs }) => {
        const images = scriptedImages(script, markFiles);
        const out = await recorded(answer, async () =>
          markFiles(
            await m.fetchCardThumbnail(imageUrl, {
              compress: images.compress,
              decode: images.decode,
              ...(deadlineMs
                ? { signal: AbortSignal.timeout(deadlineMs) }
                : {}),
            }),
          ),
        );
        if (out.result) delete out.result.lastModified;
        return { ...out, calls: images.calls };
      },
    )),
  );

  const uploads = [
    {
      $id: 'reused',
      card: {
        thumb: 'https://x',
        thumbBlob: BLOB,
        thumbBlobDid: ME,
      },
    },
    {
      $id: 'reused-anything',
      card: { thumb: 'https://x', thumbBlob: 'x', thumbBlobDid: ME },
    },
    {
      $id: 'other-accounts',
      card: {
        thumb: 'https://img.example/x',
        thumbBlob: BLOB,
        thumbBlobDid: OTHER,
      },
      answer: image(),
    },
    {
      $id: 'writers-own',
      card: { thumb: null, thumbFile: file('mine.png', 'image/png', 3 << 20) },
    },
    {
      $id: 'own-wins-over-page',
      card: {
        thumb: 'https://img.example/x',
        thumbFile: file('mine.png', 'image/png', 2048),
      },
    },
    {
      $id: 'own-fails',
      card: { thumbFile: file('mine.png', 'image/png', 2048) },
      script: { compress: null },
    },
    { $id: 'no-image', card: { thumb: null } },
    { $id: 'no-card', card: null },
    {
      $id: 'fetch-fails',
      card: { thumb: 'https://x' },
      answer: { status: 404, text: '' },
    },
    {
      $id: 'upload-fails',
      card: { thumb: 'https://x' },
      answer: image(),
      uploads: ['fail:500:upload failed'],
    },
    {
      $id: 'upload-offline',
      card: { thumb: 'https://x' },
      answer: image(),
      uploads: ['offline'],
    },
    {
      $id: 'bad-address',
      card: { thumb: 'not a url' },
      answer: image(),
    },
  ];
  all.push(
    ...(await each(
      'uploadCardThumb',
      uploads,
      async ({ card, answer, script, uploads: steps }) => {
        const images = scriptedImages(script, markFiles);
        const server = pds({ uploads: steps });
        const out = await recorded(
          answer || 'offline',
          async () =>
            m.uploadCardThumb(
              { did: ME, agent: await agentFor(ME) },
              withFiles(card),
              { compress: images.compress, decode: images.decode },
            ),
          server,
        );
        return { ...out, calls: images.calls };
      },
    )),
  );

  return all;
}
