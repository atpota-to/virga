// src/posting/composer/{editing,highlight,threadEdits,media,languages}.js:
// the editor's text edits, its highlight runs, splitting and renumbering a
// thread with the undo, sorting picked and dropped files, and the language
// picker's names and search. Swift: VirgaPosting/Composer/*.swift.
//
// Inputs are the modules' own tests' plus unicode and emoji (offsets are
// UTF-16), boundaries and loose shapes. Files are _composer.js markers and
// fresh post ids are canonIds'.

import {
  replaceRange,
  insertMention,
  pasteAsInlineLink,
  misleadingLinkNotes,
  removeLinkFromText,
  limitAnnouncement,
  NEAR_LIMIT_LEFT,
} from '../../../src/posting/composer/editing.js';
import {
  facetRanges,
  highlightSegments,
} from '../../../src/posting/composer/highlight.js';
import {
  splitTexts,
  planSplit,
  planRenumber,
  undoStands,
  undoAction,
  undoLine,
} from '../../../src/posting/composer/threadEdits.js';
import {
  IMAGE_INPUT_ACCEPT,
  pastedImageFiles,
  sortIncomingFiles,
  formatDuration,
  missingAltCount,
} from '../../../src/posting/composer/media.js';
import {
  LANGUAGE_CODES,
  ADULT_LABEL_OPTIONS,
  GRAPHIC_LABEL,
  languageName,
  searchLanguages,
  langsSummary,
  labelsSummary,
} from '../../../src/posting/composer/languages.js';
import { detectFacets } from '../../../src/posting/lib/facets.js';
import {
  applyInlineLinks,
  findInlineLinks,
} from '../../../src/posting/lib/inlineLinks.js';
import { each, value } from './_helpers.js';
import { canonIds, file, markFiles, withFiles } from './_composer.js';

export const sources = [
  'src/posting/composer/editing.js',
  'src/posting/composer/highlight.js',
  'src/posting/composer/threadEdits.js',
  'src/posting/composer/media.js',
  'src/posting/composer/languages.js',
];

const settle = (result, input) =>
  canonIds(JSON.parse(JSON.stringify(markFiles(result) ?? null)), input);

// ---- editing ----------------------------------------------------------------

async function editingCases() {
  const all = [value('editingConstants', { NEAR_LIMIT_LEFT })];
  all.push(
    ...(await each(
      'replaceRange',
      [
        { text: 'hello world', start: 6, end: 11, insertion: 'there' },
        { text: 'abc', start: -3, end: 99, insertion: 'x' },
        { text: 'abc', start: 1, insertion: 'x' },
        { text: 'abc', start: 2, end: 1, insertion: 'x' },
        { text: 'abc', start: '2', end: 3, insertion: 'x' },
        { text: 'abc', start: 'x', end: 3, insertion: 'x' },
        { text: 'abc', start: null, end: null, insertion: null },
        { text: 'abc', start: 1.5, end: 2.5, insertion: 'yz' },
        { text: 'abc', start: 1, end: Infinity, insertion: 'z' },
        { text: '😀😀', start: 1, end: 3, insertion: '!' },
        { text: 'é 👩‍🔬', start: 1, end: 1, insertion: '́' },
        { text: 5, start: 0, end: 0, insertion: 'x' },
        { text: '', start: 0, end: 0, insertion: '' },
        { text: 'abc', start: true, end: 2, insertion: ['x'] },
      ],
      (i) => replaceRange(i.text, i.start, i.end, i.insertion),
    )),
    ...(await each(
      'insertMention',
      [
        {
          text: 'hi @wr',
          range: { start: 3, end: 6 },
          handle: 'wren.example.com',
        },
        {
          text: 'hi @wr there',
          range: { start: 3, end: 6 },
          handle: 'wren.example.com',
        },
        {
          text: 'hi @wr\nthere',
          range: { start: 3, end: 6 },
          handle: '@wren.example.com',
        },
        {
          text: 'hi @wr x',
          range: { start: 3, end: 6 },
          handle: '  wren.example.com ',
        },
        { text: 'hi @wr', range: null, handle: 'wren.example.com' },
        { text: 'hi @wr', range: { start: 3, end: 6 }, handle: '' },
        { text: 'hi @wr', range: { start: 3, end: 6 }, handle: '@' },
        { text: 'hi @wr', range: { start: 3 }, handle: 'a.b' },
        { text: '😀 @w', range: { start: 3, end: 5 }, handle: 'ü.example' },
        { text: 5, range: { start: 0, end: 0 }, handle: 'a.b' },
      ],
      (i) => insertMention(i.text, i.range, i.handle),
    )),
    ...(await each(
      'pasteAsInlineLink',
      [
        {
          text: 'read the guide now',
          start: 5,
          end: 14,
          pasted: 'https://example.org/g',
        },
        { text: 'abc', start: 1, end: 1, pasted: 'https://example.org' },
        { text: 'abc def', start: 0, end: 3, pasted: 'not a link' },
        { text: 'a\nb', start: 0, end: 3, pasted: 'https://example.org' },
        {
          text: 'see example.org now',
          start: 4,
          end: 15,
          pasted: 'https://example.org',
        },
        {
          text: 'my bank.com login',
          start: 3,
          end: 11,
          pasted: 'https://evil.example/x',
        },
        {
          text: 'my bank.com login',
          start: 3,
          end: 11,
          pasted: 'https://www.evil.example/x',
        },
        {
          text: 'go here',
          start: 3,
          end: 7,
          pasted: '  HTTPS://EXAMPLE.ORG/a  ',
        },
        { text: 'go here', start: 3, end: 7, pasted: 'https://exa mple.org' },
        { text: 'go here', start: 3, end: 7, pasted: 'ftp://example.org' },
        { text: 'go here', start: 3, end: 7, pasted: 'https://' },
        { text: 'go [here]', start: 3, end: 9, pasted: 'https://example.org' },
        { text: 'go    ', start: 2, end: 6, pasted: 'https://example.org' },
        { text: 'go 😀 here', start: 3, end: 5, pasted: 'https://example.org' },
        { text: 'go here', start: 3, end: 7, pasted: 'https://example.org/ ' },
        { text: 'go here', start: 3, end: 7, pasted: 'javascript:alert(1)' },
        { text: 'go here', start: 3, end: 7, pasted: 'http://localhost' },
        { text: 'go here', start: 3, end: 7, pasted: 5 },
        // Offsets as strings compare as strings ('7' > '10'), and only a
        // number is a finite end for the replacement.
        {
          text: 'go here and there',
          start: '10',
          end: '7',
          pasted: 'https://example.org',
        },
        {
          text: 'go here and there',
          start: '3',
          end: '17',
          pasted: 'https://example.org',
        },
        {
          text: 'go here',
          start: 3,
          end: '7',
          pasted: 'https://example.org',
        },
        {
          text: 'go here',
          start: [3],
          end: [7],
          pasted: 'https://example.org',
        },
      ],
      (i) => pasteAsInlineLink(i.text, i.start, i.end, i.pasted),
    )),
    ...(await each(
      'misleadingLinkNotes',
      [
        {
          text: 'log in at [bank.com](https://evil.example) and [ok](https://example.org)',
        },
        { text: '[a.com](https://b.com) [c.org](https://www.d.org/x)' },
        { text: 'nothing here' },
        { text: null },
        { text: '[  spaced.com  ](https://other.net)' },
      ],
      (i) => misleadingLinkNotes(i.text),
    )),
    ...(await each(
      'removeLinkFromText',
      [
        { text: 'look https://bsky.app/x here', charStart: 5, charEnd: 23 },
        { text: 'look https://bsky.app/x', charStart: 5, charEnd: 23 },
        { text: 'https://bsky.app/x here', charStart: 0, charEnd: 18 },
        { text: 'look\thttps://bsky.app/x\there', charStart: 5, charEnd: 23 },
        { text: 'look https://bsky.app/x \n', charStart: 5, charEnd: 23 },
        {
          text: 'look https://bsky.app/x here',
          charStart: 5,
          charEnd: 23,
          expect: 'https://bsky.app/x',
        },
        {
          text: 'look https://bsky.app/y here',
          charStart: 5,
          charEnd: 23,
          expect: 'https://bsky.app/x',
        },
        {
          text: 'look https://bsky.app/x here',
          charStart: 5,
          charEnd: 23,
          expect: null,
        },
        {
          text: 'look https://bsky.app/x here',
          charStart: 5,
          charEnd: 23,
          expect: 5,
        },
        { text: 'short', charStart: 2, charEnd: 99 },
        { text: 'short', charStart: 3, charEnd: 3 },
        { text: 'a  link  b', charStart: 3, charEnd: 7 },
        { text: '😀 link', charStart: 3, charEnd: 7 },
        { text: ' link', charStart: 1, charEnd: 5 },
        { text: 'x link ', charStart: 2, charEnd: 6 },
        { text: 'a long link here b', charStart: '2', charEnd: '16' },
        { text: 'a long link here b', charStart: '16', charEnd: '2' },
        { text: 'a long link here b', charStart: '2', charEnd: '9' },
        { text: 'short', charStart: '1', charEnd: '99' },
        { text: 'short', charStart: 1, charEnd: '4' },
      ],
      ({ text, ...range }) => removeLinkFromText(text, range),
    )),
    ...(await each(
      'limitAnnouncement',
      [
        { count: 12 },
        { count: 279 },
        { count: 280 },
        { count: 300 },
        { count: 301 },
        { count: 990, max: 1000 },
        { count: 981, max: 1000 },
        { count: 979.5, max: 1000 },
        { count: -5 },
      ],
      (i) =>
        limitAnnouncement(i.count, ...(i.max === undefined ? [] : [i.max])),
    )),
  );
  return all;
}

// ---- highlight --------------------------------------------------------------

const LIVE = [
  'hi @wren.example.com see https://example.org #moths ok',
  'read [the guide](https://example.org/g) now',
  'tag #rain and #雨 and #a😀b',
  'emoji 👩‍🔬 then https://example.org/😀 and @a.example',
  '[bank.com](https://evil.example) is misleading',
  '[a](https://a.example) [b](https://b.example) #t',
  'just words',
  '',
  'é #tag é',
  '[label #tag](https://x.example) after',
];

async function live(text) {
  const links = findInlineLinks(text).filter((l) => !l.misleading);
  const result = await detectFacets(text, { skipMentionResolution: true });
  return { facets: applyInlineLinks(text, links, result).facets, links };
}

async function highlightCases() {
  const inputs = [];
  for (const text of LIVE) {
    const { facets, links } = await live(text);
    inputs.push({ text, facets, links });
  }
  const tag = (bs, be, type = 'app.bsky.richtext.facet#tag') => ({
    index: { byteStart: bs, byteEnd: be },
    features: [{ $type: type }],
  });
  const loose = [
    { text: 'short', facets: [tag(0, 99)] },
    { text: 'short', facets: [tag(3, 1)] },
    { text: 'short', facets: [tag(1, 1)] },
    { text: 'short', facets: [tag(-2, 2)] },
    { text: 'short', facets: [tag(1, 3, 'app.bsky.richtext.facet#other')] },
    { text: 'short', facets: [{ index: { byteStart: 0, byteEnd: 2 } }] },
    { text: 'short', facets: [null, 5, {}] },
    { text: 'short', facets: [tag(0.5, 2.5)] },
    { text: 'short', facets: [tag('0', 2)] },
    { text: 'short', facets: null },
    { text: 'short', facets: 'x' },
    { text: 5, facets: [tag(0, 1)] },
    { text: '😀ab', facets: [tag(0, 4), tag(4, 6)] },
    { text: '😀ab', facets: [tag(2, 5)] },
    { text: 'abcdef', facets: [tag(0, 3), tag(1, 4), tag(3, 6)] },
    { text: 'abcdef', facets: [tag(2, 4), tag(0, 6)] },
    {
      text: 'abcdef',
      facets: [],
      links: [{ start: 1, end: 5, labelStart: 2, labelEnd: 3 }],
    },
    {
      text: 'abcdef',
      facets: [tag(0, 2)],
      links: [{ start: 1, end: 5, labelStart: 2, labelEnd: 3 }],
    },
    {
      text: 'abcdef',
      facets: [],
      links: [
        { start: 3, end: 3 },
        null,
        { start: 0, end: 2, labelStart: 0, labelEnd: 2 },
      ],
    },
    { text: 'abcdef', facets: [], links: null },
    // Offsets that aren't numbers: two strings compare as strings, and only
    // a number is the text's end.
    { text: 'short', facets: [tag('3', '10')] },
    { text: 'short', facets: [tag('1', '5')] },
    { text: 'short', facets: [tag(1, '5')] },
    { text: 'short', facets: [tag('1', 5)] },
    {
      text: 'abcdefghijkl',
      facets: [],
      links: [{ start: '2', end: '10', labelStart: '3', labelEnd: '9' }],
    },
    {
      text: 'abcdefghijkl',
      facets: [],
      links: [{ start: '9', end: '10', labelStart: '9', labelEnd: '10' }],
    },
    {
      text: 'abcdefghijkl',
      facets: [tag(0, 4)],
      links: [{ start: 1, end: '3', labelStart: 2, labelEnd: '3' }],
    },
  ];
  inputs.push(...loose);
  return [
    ...(await each('facetRanges', inputs, (i) =>
      facetRanges(i.text, i.facets),
    )),
    ...(await each('highlightSegments', inputs, (i) =>
      highlightSegments(i.text, i.facets, i.links),
    )),
  ];
}

// ---- thread edits -----------------------------------------------------------

const post = (id, text = '', extra = {}) => ({
  id,
  text,
  images: [],
  video: null,
  record: null,
  card: null,
  ...extra,
});
const long = (n, word = 'word') =>
  Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ');

const THREADS = [
  ['one-long', [post('p1', long(80))]],
  ['one-short', [post('p1', 'short')]],
  [
    'middle-long',
    [post('p1', 'first'), post('p2', long(120)), post('p3', 'last')],
  ],
  ['numbered', [post('p1', 'first 1/2'), post('p2', `${long(80)} 2/2`)]],
  ['numbered-stale', [post('p1', 'first 1/3'), post('p2', `${long(80)} 3/3`)]],
  ['emoji', [post('p1', '😀 '.repeat(200))]],
  [
    'full',
    Array.from({ length: 25 }, (_, i) =>
      post(`p${i}`, i === 3 ? long(80) : 'x'),
    ),
  ],
  [
    'nearly-full',
    Array.from({ length: 24 }, (_, i) =>
      post(`p${i}`, i === 0 ? long(200) : 'x'),
    ),
  ],
  ['huge', [post('p1', long(400))]],
  ['loose-text', [post('p1', 5), { id: 'p2', text: long(80) }]],
];

async function threadCases() {
  const all = [];
  const splitInputs = [];
  for (const [tid, posts] of THREADS) {
    // The big threads once; the rest with every numbering and a missing id.
    const big = posts.length > 3 || tid === 'huge';
    for (const numbering of big ? ['counter'] : [undefined, 'off', 'counter'])
      for (const id of big
        ? [posts.find((p) => p.text?.length > 300)?.id || posts[0].id]
        : [
            posts.find((p) => p.text?.length > 300)?.id || posts[0].id,
            'missing',
          ])
        splitInputs.push({
          $id: `${tid}/${numbering}/${id}`,
          posts,
          id,
          numbering,
        });
  }
  all.push(
    ...(await each('splitTexts', splitInputs, (i) =>
      splitTexts(
        i.posts,
        i.id,
        i.numbering ? { numbering: i.numbering } : undefined,
      ),
    )),
    ...(await each('planSplit', splitInputs, (i) =>
      settle(
        planSplit(
          i.posts,
          i.id,
          i.numbering ? { numbering: i.numbering } : undefined,
        ),
        i,
      ),
    )),
  );
  const renumber = [
    [post('p1', 'a 1/3'), post('p2', 'b 3/3')],
    [post('p1', 'a 1/2'), post('p2', 'b 2/2')],
    [post('p1', 'a'), post('p2', 'b')],
    [post('p1', 'only 1/1')],
    [post('p1', 'a 1/2 '), post('p2', 'b')],
    [post('dup', 'a 2/2'), post('dup', 'b 1/2')],
    [{ text: 'no id 1/2' }, post('p2', 'b 1/2')],
    [],
  ];
  all.push(
    ...(await each(
      'planRenumber',
      renumber.map((posts) => ({ posts })),
      (i) => planRenumber(i.posts),
    )),
  );
  // Undo after a split and after a renumber, then after the writer moves on.
  const thread = [post('p1', long(80)), post('p9', 'after')];
  // The split's new posts get fresh ids; name them so the inputs are fixed.
  const minted = planSplit(thread, 'p1');
  const named = new Map(minted.action.rest.map((p, i) => [p.id, `n${i + 1}`]));
  const plan = JSON.parse(
    JSON.stringify(minted, (key, v) =>
      key === 'id' && named.has(v) ? named.get(v) : v,
    ),
  );
  const made = [
    { ...thread[0], text: plan.action.text },
    ...plan.action.rest,
    thread[1],
  ];
  const renum = planRenumber(renumber[0]);
  const renumbered = renumber[0].map((p, i) => ({
    ...p,
    text: renum.undo.made[i].text,
  }));
  const undoInputs = [
    { posts: made, undo: plan.undo },
    {
      posts: made.map((p, i) => (i === 1 ? { ...p, text: `${p.text}!` } : p)),
      undo: plan.undo,
    },
    {
      posts: made.map((p, i) =>
        i === 1 ? { ...p, images: [{ id: 'i1' }] } : p,
      ),
      undo: plan.undo,
    },
    {
      posts: made.map((p, i) =>
        i === 0 ? { ...p, images: [{ id: 'i1' }] } : p,
      ),
      undo: plan.undo,
    },
    {
      posts: made.map((p, i) =>
        i === 2 ? { ...p, video: { status: 'ready' } } : p,
      ),
      undo: plan.undo,
    },
    { posts: [made[1], made[0], ...made.slice(2)], undo: plan.undo },
    { posts: made.slice(0, 2), undo: plan.undo },
    { posts: renumbered, undo: renum.undo },
    { posts: [...renumbered, post('p3', 'more')], undo: renum.undo },
    { posts: renumber[0], undo: renum.undo },
    { posts: made, undo: null },
    { posts: made, undo: { kind: 'split', made: [] } },
    { posts: null, undo: plan.undo },
  ];
  all.push(
    ...(await each('undoStands', undoInputs, (i) =>
      undoStands(i.posts, i.undo),
    )),
    ...(await each(
      'undoAction',
      [
        { undo: plan.undo },
        { undo: renum.undo },
        { undo: null },
        { undo: { kind: 'other' } },
      ],
      (i) => undoAction(i.undo),
    )),
    ...(await each(
      'undoLine',
      [
        { undo: plan.undo },
        { undo: renum.undo },
        { undo: null },
        { undo: { kind: 'split', made: [1] } },
      ],
      (i) => undoLine(i.undo),
    )),
  );
  return all.map((c) => ({ ...c, output: canonIds(c.output, c.input) }));
}

// ---- media ------------------------------------------------------------------

async function mediaCases() {
  const jpg = file('a.jpg', 'image/jpeg');
  const png = file('b.png', 'image/png');
  const heic = file('c.heic', 'image/heic');
  const mp4 = file('v.mp4', 'video/mp4');
  const mov = file('v.mov', 'video/quicktime');
  const avi = file('v.avi', 'video/x-msvideo');
  const pdf = file('d.pdf', 'application/pdf');
  const blank = file('e', '');
  const sets = [
    [[jpg, png]],
    [[jpg, png, heic, jpg, png]],
    [[mp4]],
    [[mp4, mov]],
    [[avi]],
    [[mp4, pdf]],
    [[mp4, pdf, blank]],
    [[mp4, jpg]],
    [[pdf]],
    [[pdf, blank, null]],
    [[]],
    [null],
    [[{ type: 'image/png', size: 3 }, { type: 5 }, 'image/png']],
  ];
  const posts = [
    {},
    { imageCount: 2 },
    { imageCount: 4 },
    { imageCount: 3 },
    { hasVideo: true },
    { allowVideo: false },
    { imageCount: 1, allowVideo: false },
  ];
  const inputs = [];
  for (const [files] of sets)
    for (const p of posts) inputs.push({ files, ...p });
  // A paste: the clipboard's items (`{ kind, type, file }`, a null file for
  // an item that gives none) and its text; `items: null` is a clipboard
  // without them, `text` left out one without getData.
  const pastes = [
    {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          file: file('image.png', 'image/png', 9),
        },
      ],
      text: '',
    },
    { items: [{ kind: 'file', type: 'image/png', file: png }], text: 'words' },
    { items: [{ kind: 'file', type: 'image/png', file: png }], text: ' \n ' },
    { items: [{ kind: 'file', type: 'image/png', file: png }] },
    { items: [{ kind: 'string', type: 'image/png', file: png }], text: '' },
    { items: [{ kind: 'file', type: 'text/html', file: png }], text: '' },
    { items: [{ kind: 'file', type: 'IMAGE/PNG', file: png }], text: '' },
    { items: [{ kind: 'file', type: 'image/png', file: null }], text: '' },
    {
      items: [{ kind: 'file', type: 'image/', file: file('x', 'image/', 2) }],
      text: '',
    },
    {
      items: [{ kind: 'file', type: 'image/png', file: file('x', '', 2) }],
      text: '',
    },
    {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          file: file('x', 'image/svg+xml', 2),
        },
      ],
      text: '',
    },
    { items: [{ kind: 'file', type: 'image/png', file: jpg }], text: '' },
    {
      items: [
        { kind: 'file', type: 'image/png', file: png },
        { kind: 'string', type: 'text/plain', file: null },
        {
          kind: 'file',
          type: 'image/gif',
          file: file('g.gif', 'image/gif', 3),
        },
      ],
      text: '',
    },
    { items: [], text: '' },
    { items: null, text: '' },
  ];
  const clipboard = ({ items, text }) => ({
    ...(items === null
      ? {}
      : {
          items: items.map((item) => ({
            kind: item.kind,
            type: item.type,
            getAsFile: () => (item.file ? withFiles(item.file) : null),
          })),
        }),
    ...(text === undefined
      ? {}
      : { getData: (t) => (t === 'text/plain' ? text : '') }),
  });
  const NOW = () => new Date('2026-11-12T10:00:00.250Z');
  return [
    value('mediaConstants', { IMAGE_INPUT_ACCEPT }),
    ...(await each('pastedImageFiles', pastes, (i) =>
      markFiles(pastedImageFiles(clipboard(i), { now: NOW })),
    )),
    ...(await each('pastedImageFiles', [{ $id: 'no-clipboard' }], () =>
      pastedImageFiles(null),
    )),
    ...(await each('sortIncomingFiles', inputs, ({ files, ...p }) =>
      settle(sortIncomingFiles(withFiles(files), p), {}),
    )),
    ...(await each(
      'formatDuration',
      [
        0,
        1,
        59,
        59.5,
        60,
        61,
        83,
        600,
        3599.4,
        3600,
        -5,
        'x',
        null,
        undefined,
        '75',
        1e7,
      ].map((seconds) => ({ seconds })),
      (i) => formatDuration(i.seconds),
    )),
    ...(await each(
      'missingAltCount',
      [
        { post: { images: [{ alt: '' }, { alt: 'a' }, { alt: '  ' }, {}] } },
        { post: { images: [] } },
        { post: {} },
        { post: null },
        { post: { images: [{ alt: ' ' }, { alt: 'x' }] } },
      ],
      (i) => missingAltCount(i.post),
    )),
  ];
}

// ---- languages --------------------------------------------------------------

async function languageCases() {
  const all = [
    value('languageConstants', {
      LANGUAGE_CODES,
      ADULT_LABEL_OPTIONS,
      GRAPHIC_LABEL,
    }),
  ];
  const codes = [
    ...LANGUAGE_CODES,
    'EN',
    ' fr ',
    'pt-BR',
    'PT-br',
    'en-GB',
    'zh-Hant',
    'es-419',
    'nl-BE',
    'xx',
    'qaa',
    '',
    null,
    'e',
    'en_US',
    '123',
    // A script and a region, named after the language: ICU's
    // "Language (Script, Region)".
    'en-Latn-US',
    'zh-Hant-HK',
    'zh-Hans-CN',
    'sr-Latn-RS',
    'fr-Latn-CA',
    'az-Cyrl-AZ',
    'en-Latn',
    'en-150',
    'fr-029',
    // Codes past the 184: three letters, legacy ones, and what ICU calls a
    // tag it has no names for (its codes), or refuses (the code itself).
    'yue',
    'fil',
    'haw',
    'iw',
    'in',
    'eng',
    'und',
    'mul',
    'yue-HK',
    'xx-US',
    'en-XX',
    'en-Qaaa',
    'en-Zzzz',
    'en-999',
    'en-ZZ',
    'en-basiceng',
    'en-US-Latn',
    'en-x-foo',
    'en-UK',
    'sr-ME',
    'pa-Arab-PK',
    'ja-Jpan-JP',
    'MM',
    'my-MM',
    'EN-latn-us',
  ];
  all.push(
    ...(await each(
      'languageName',
      codes.map((code) => ({ code })),
      (i) => languageName(i.code),
    )),
    ...(await each(
      'languageName',
      ['ff', 'en', 'pt-BR'].map((code) => ({
        $id: `en-GB/${code}`,
        code,
        locale: 'en-GB',
      })),
      (i) => languageName(i.code, i.locale),
    )),
  );
  const searches = [
    { query: '' },
    { query: '', preferred: ['fr-CA', 'en-US', 'de', 'xx', 'en_GB'] },
    { query: '', chosen: ['en', 'fr'], preferred: ['fr', 'es'] },
    { query: '', limit: 200 },
    { query: 'en' },
    { query: 'EN' },
    { query: 'span' },
    { query: 'ian' },
    { query: 'xx' },
    { query: 'nb' },
    { query: 'nor' },
    { query: 'chinese' },
    { query: 'zh', chosen: ['zh'] },
    { query: '  gre ' },
    { query: 's', limit: 20 },
    { query: 'a', limit: 0 },
    { query: 'a', limit: -2 },
    { query: '', limit: -180 },
    { query: null },
    { query: 5 },
  ];
  all.push(
    ...(await each('searchLanguages', searches, ({ query, ...options }) =>
      searchLanguages(query, options),
    )),
    ...(await each(
      'langsSummary',
      [
        { langs: ['en', 'es'] },
        { langs: [] },
        { langs: null },
        { langs: ['pt-BR', 'xx', ''] },
      ],
      (i) => langsSummary(i.langs),
    )),
    ...(await each(
      'labelsSummary',
      [
        { labels: ['nudity', 'graphic-media'] },
        { labels: ['porn', 'sexual', 'unknown'] },
        { labels: [] },
        { labels: null },
      ],
      (i) => labelsSummary(i.labels),
    )),
  );
  return all;
}

export default async function cases() {
  return [
    ...(await editingCases()),
    ...(await highlightCases()),
    ...(await threadCases()),
    ...(await mediaCases()),
    ...(await languageCases()),
  ];
}
