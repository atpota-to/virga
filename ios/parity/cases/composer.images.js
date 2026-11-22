// src/posting/lib/images.js: which files the image pipeline takes, what
// the re-encode is asked for (the budgets, quality, resolution), when its
// result is refused and with which words, the new name and type, and the
// aspect ratio. Swift: VirgaPosting/Lib/Images.swift. The re-encode and
// the decode are scripted: each case says what they hand back.

import {
  MAX_IMAGES,
  IMAGE_BUDGET,
  CARD_THUMB_BUDGET,
  IMAGE_MIME_TYPES,
  isImageFile,
  prepareImage,
} from '../../../src/posting/lib/images.js';
import { each, value } from './_helpers.js';
import { file, markFiles, withFiles } from './_composer.js';

export const sources = ['src/posting/lib/images.js'];

const MB = 1024 * 1024;

// A File's lastModified is its maker's clock: the output's is left out.
const settle = (v) =>
  JSON.parse(
    JSON.stringify(markFiles(v) ?? null, (key, val) =>
      key === 'lastModified' ? undefined : val,
    ),
  );

const FILES = [
  ['small-png', file('photo.png', 'image/png', 1000)],
  ['at-budget', file('a.jpg', 'image/jpeg', Math.floor(1.9 * MB))],
  ['over-budget', file('big.jpeg', 'image/jpeg', Math.floor(1.9 * MB) + 1)],
  ['huge-heic', file('IMG_0001.HEIC', 'image/heic', 12 * MB)],
  ['tiny', file('dot.gif', 'image/gif', 3)],
  ['no-name', { $file: true, type: 'image/webp', size: 2048 }],
  ['empty-name', file('', 'image/png', 10)],
  ['dots', file('a.b.c.png', 'image/png', 10)],
  ['trailing-dot', file('name.', 'image/png', 10)],
  ['hidden', file('.hidden', 'image/png', 10)],
  ['no-extension', file('scan', 'image/png', 10)],
  ['not-image', file('doc.pdf', 'application/pdf', 10)],
  ['no-type', file('x.png', '', 10)],
];

const SCRIPTS = [
  ['ok', { compress: { size: 500 }, decode: { width: 1200, height: 800 } }],
  [
    'ok-fractional',
    { compress: { size: 500 }, decode: { width: 1199.5, height: 800.4 } },
  ],
  ['no-decode', { compress: { size: 500 }, decode: null }],
  ['decode-throws', { compress: { size: 500 }, decode: 'throw' }],
  [
    'decode-zero',
    { compress: { size: 500 }, decode: { width: 0, height: 10 } },
  ],
  ['compress-throws', { compress: 'throw' }],
  ['compress-null', { compress: null }],
  ['compress-empty', { compress: { size: 0 } }],
  ['still-too-big', { compress: { size: Math.floor(1.9 * MB) + 1 } }],
  [
    'card-too-big',
    { compress: { size: Math.floor(0.96 * MB) }, budget: 'card' },
  ],
  [
    'card-ok',
    {
      compress: { size: Math.floor(0.9 * MB) },
      decode: { width: 1920, height: 1080 },
      budget: 'card',
    },
  ],
  ['timeout', { compress: 'hang', timeoutMs: 5 }],
];

export default async function cases() {
  const all = [
    value('imagesConstants', {
      MAX_IMAGES,
      IMAGE_BUDGET,
      CARD_THUMB_BUDGET,
      IMAGE_MIME_TYPES,
    }),
  ];
  all.push(
    ...(await each(
      'isImageFile',
      [
        ...FILES.map(([, f]) => ({ file: f })),
        { file: null },
        { file: { type: 5 } },
        { file: { type: 'image/' } },
      ],
      (i) => isImageFile(withFiles(i.file)),
    )),
  );
  const inputs = [];
  for (const [fid, f] of FILES)
    for (const [sid, script] of SCRIPTS)
      if (
        sid === 'ok' ||
        ['small-png', 'over-budget', 'huge-heic'].includes(fid)
      )
        inputs.push({ $id: `${fid}/${sid}`, file: f, script });
  all.push(
    ...(await each('prepareImage', inputs, async (i) => {
      const calls = [];
      const s = i.script;
      try {
        const out = await prepareImage(withFiles(i.file), {
          ...(s.budget === 'card' ? { budget: CARD_THUMB_BUDGET } : {}),
          ...(s.timeoutMs ? { timeoutMs: s.timeoutMs } : {}),
          compress: async (input, options) => {
            calls.push(['compress', settle(input), options]);
            if (s.compress === 'throw') throw new Error('decoder blew up');
            if (s.compress === 'hang') return new Promise(() => {});
            if (s.compress === null) return null;
            return new Blob([new Uint8Array(s.compress.size)], {
              type: 'image/jpeg',
            });
          },
          decode: async (processed) => {
            calls.push(['decode', settle(processed)]);
            if (s.decode === 'throw') throw new Error('cannot decode');
            return s.decode ?? null;
          },
        });
        return { result: settle(out), calls };
      } catch (error) {
        return { $throws: error.message, code: error.code ?? null, calls };
      }
    })),
  );
  return all;
}
