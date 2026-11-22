// src/posting/templates/editorDrafts.js: a template as the editor's draft
// and back, the variables brought in line with the text, the kind of thing
// an embed attaches, and a draft made from the reply being written (the
// replied-to author's first name becoming a blank, except inside links,
// email addresses, handles, hashtags and domains). Swift:
// VirgaPosting/Templates/EditorDrafts.swift.
//
// Inputs from editorDrafts.test.js and library/model.test.js's drafts, plus
// names with apostrophes, hyphens, marks and emoji, names next to every kind
// of punctuation and protected span, keys of other types, drafts missing
// their parts and round trips of every template in _templates.js.

import * as ED from '../../../src/posting/templates/editorDrafts.js';
import { normalizeTemplateRecord } from '../../../src/posting/templates/postTemplates.js';
import { each, value } from './_helpers.js';
import { RECORDS, TEMPLATES } from './_templates.js';

export const sources = ['src/posting/templates/editorDrafts.js'];

const POST = 'at://did:plc:me/app.bsky.feed.post/3kq';
const STAMP_EMBED = {
  $type: 'app.bsky.embed.record',
  record: { uri: POST, cid: 'cid-stamina' },
};

const EMBEDS = {
  none: null,
  undefined: undefined,
  zero: 0,
  string: 'app.bsky.embed.record',
  post: { $type: 'app.bsky.embed.record', record: { uri: POST } },
  feed: {
    $type: 'app.bsky.embed.record',
    record: { uri: 'at://x/app.bsky.feed.generator/f' },
  },
  list: {
    $type: 'app.bsky.embed.record',
    record: { uri: 'at://x/app.bsky.graph.list/l' },
  },
  starterpack: {
    $type: 'app.bsky.embed.record',
    record: { uri: 'at://x/app.bsky.graph.starterpack/s' },
  },
  link: {
    $type: 'app.bsky.embed.external',
    external: { uri: 'https://a.example' },
  },
  linkEmpty: { $type: 'app.bsky.embed.external', external: { uri: '' } },
  linkNumber: { $type: 'app.bsky.embed.external', external: { uri: 5 } },
  linkNone: { $type: 'app.bsky.embed.external' },
  images: { $type: 'app.bsky.embed.images', images: [] },
  withMedia: {
    $type: 'app.bsky.embed.recordWithMedia',
    record: { record: { uri: POST } },
  },
  noType: { record: { uri: POST } },
  array: [1, 2],
  emptyObject: {},
  recordNoUri: { $type: 'app.bsky.embed.record', record: {} },
  recordNull: { $type: 'app.bsky.embed.record', record: null },
  postQuery: { $type: 'app.bsky.embed.record', record: { uri: `${POST}?x=1` } },
  postHash: { $type: 'app.bsky.embed.record', record: { uri: `${POST}#x` } },
  postTrailingSlash: {
    $type: 'app.bsky.embed.record',
    record: { uri: `${POST}/` },
  },
  postExtraPath: {
    $type: 'app.bsky.embed.record',
    record: { uri: 'at://x/app.bsky.feed.post/a/b' },
  },
  postNewline: { $type: 'app.bsky.embed.record', record: { uri: `${POST}\n` } },
  postNoAuthority: {
    $type: 'app.bsky.embed.record',
    record: { uri: 'at:///app.bsky.feed.post/a' },
  },
  postHttp: {
    $type: 'app.bsky.embed.record',
    record: { uri: 'https://x/app.bsky.feed.post/a' },
  },
  postUpper: {
    $type: 'app.bsky.embed.record',
    record: { uri: 'at://x/APP.BSKY.FEED.POST/a' },
  },
  postNumber: { $type: 'app.bsky.embed.record', record: { uri: 7 } },
  typeCase: { $type: 'App.bsky.embed.record', record: { uri: POST } },
};

const reply = {
  uri: 'at://did:plc:wren/app.bsky.feed.post/1',
  cid: 'c1',
  root: { uri: 'at://did:plc:wren/app.bsky.feed.post/1', cid: 'c1' },
  author: {
    did: 'did:plc:wren',
    handle: 'wren.example',
    displayName: 'Wren Okafor',
  },
  text: 'Is there an app?',
};
const replyTo = {
  author: { handle: 'moss.example', displayName: 'Moss Green' },
};
const wren = { author: { handle: 'wren.example', displayName: 'wren' } };
const named = (displayName) => ({
  author: { handle: 'n.example', displayName },
});

const REPLIES = [
  {
    $id: 'composer-shapes',
    text: 'Not yet, Wren!',
    reply,
    record: { kind: 'post', uri: POST, cid: 'cq' },
  },
  {
    $id: 'card',
    text: 'Here',
    reply,
    card: { url: 'https://docs.example/a', title: 'Docs' },
  },
  {
    $id: 'record-over-card',
    text: 'x',
    reply,
    record: { uri: POST, cid: 'cq' },
    card: { url: 'https://a.example' },
  },
  {
    $id: 'moss',
    text: 'Thanks Moss! Moss, have a look. Mossy is someone else.  ',
    replyTo,
    recordEmbed: { uri: POST, cid: 'cid-stamina' },
  },
  {
    $id: 'link-url',
    text: 'Here you go',
    replyTo,
    linkUrl: 'https://docs.example.org/a',
  },
  {
    $id: 'protected',
    text: 'see https://wren.blog and https://x.example/?u=wren, ping @wren.bsky.social or wren@x.com, #wren, wren.blog or wren_art. Thanks wren. wren, hi!',
    replyTo: wren,
  },
  { $id: 'handle-only', text: 'ping @wren.bsky.social', replyTo: wren },
  {
    $id: 'http-upper',
    text: 'HTTPS://wren.example and HTTP://x.example/wren and Wren',
    replyTo: wren,
  },
  { $id: 'long-s', text: 'httpſ://x.example/wren wren', replyTo: wren },
  {
    $id: 'path',
    text: 'a/wren b-wren wren-b wren/c wren_ _wren',
    replyTo: wren,
  },
  {
    $id: 'domain-dot',
    text: 'wren. wren.x x.wren wren.. 1.wren wren.1',
    replyTo: wren,
  },
  { $id: 'possessive', text: "wren's idea, wren’s too, wren'", replyTo: wren },
  { $id: 'case', text: 'Wren WREN wren wReN', replyTo: wren },
  { $id: 'digits', text: 'wren2 2wren wren', replyTo: wren },
  { $id: 'marks', text: 'wren\u0301 wren', replyTo: wren },
  { $id: 'emoji', text: '🌿wren🌿 wren!', replyTo: wren },
  {
    $id: 'email-unicode',
    text: 'zoë@exämple.com Zoë',
    replyTo: named('Zoë Ng'),
  },
  {
    $id: 'apostrophe-name',
    text: "Thanks O'Brien, O'Brien-Smith!",
    replyTo: named("O'Brien Smith"),
  },
  {
    $id: 'hyphen-name',
    text: 'Hi Anne-Marie! Anne',
    replyTo: named('Anne-Marie Fox'),
  },
  {
    $id: 'curly-name',
    text: 'Hey D’Angelo, D’Angelo’s back',
    replyTo: named('D’Angelo'),
  },
  { $id: 'emoji-name', text: 'Hi Wren 🌿', replyTo: named('🌿 Wren Okafor') },
  {
    $id: 'combining-name',
    text: 'Merci élise, élise',
    replyTo: named('e\u0301lise D'),
  },
  {
    $id: 'cjk-name',
    text: '山田さん、ありがとう 山田',
    replyTo: named('山田 太郎'),
  },
  { $id: 'arabic-name', text: 'شكرا مريم', replyTo: named('مريم أحمد') },
  { $id: 'digit-name', text: '42 is a name', replyTo: named('42') },
  { $id: 'empty-name', text: 'Hello there', replyTo: named('') },
  { $id: 'space-name', text: 'Hello there', replyTo: named('   ') },
  { $id: 'number-name', text: 'Hello 42', replyTo: named(42) },
  { $id: 'no-author', text: 'Hello', replyTo: {} },
  { $id: 'no-reply', text: 'Hello' },
  {
    $id: 'null-reply-over-reply',
    text: 'Not yet, Wren!',
    reply,
    replyTo: null,
  },
  {
    $id: 'null-record-over-record',
    text: 'x',
    record: { uri: POST, cid: 'c' },
    recordEmbed: null,
    linkUrl: 'https://b.example',
  },
  {
    $id: 'record-no-cid',
    text: 'x',
    record: { uri: POST },
    card: { url: 'https://c.example' },
  },
  { $id: 'record-number-uri', text: 'x', record: { uri: 5, cid: 6 } },
  { $id: 'card-no-url', text: 'x', card: { title: 'Docs' } },
  { $id: 'link-number', text: 'x', linkUrl: 5 },
  {
    $id: 'link-over-card',
    text: 'x',
    card: { url: 'https://card.example' },
    linkUrl: 'https://link.example',
  },
  {
    $id: 'null-link-over-card',
    text: 'x',
    card: { url: 'https://card.example' },
    linkUrl: null,
  },
  { $id: 'trailing-space', text: 'Hi Wren \n\t\u00A0\u2028', replyTo: named('Wren') },
  { $id: 'only-space', text: ' \n ', replyTo: named('Wren') },
  { $id: 'no-text', replyTo: named('Wren') },
  { $id: 'number-text', text: 42, replyTo: named('Wren') },
  {
    $id: 'blank-in-text',
    text: 'Hi Wren, {{their.firstName}} {{idea}}',
    replyTo: named('Wren'),
  },
  { $id: 'hashtag-mid', text: '#wrenfest wren#x x#wren', replyTo: wren },
  { $id: 'mention-mid', text: 'x@wren wren@ @@wren', replyTo: wren },
  { $id: 'url-trailing', text: 'http://x.example/wren) wren)', replyTo: wren },
  {
    $id: 'long-name',
    text: 'Hi Bartholomew-Alexander',
    replyTo: named('Bartholomew-Alexander von X'),
  },
  // NAME_PROTECTED's `iu` flags let U+0345 (which folds to a letter) into
  // a handle's or an address's letters, so the name after it stays.
  { $id: 'ypogegrammeni-handle', text: '@a\u0345.wren hi', replyTo: wren },
  { $id: 'ypogegrammeni-domain', text: 'x@y.a\u0345.wren', replyTo: wren },
  {
    $id: 'ypogegrammeni-local',
    text: 'wren@a\u0345.b ok wren',
    replyTo: wren,
  },
  { $id: 'ypogegrammeni-hashtag', text: '#a\u0345 wren', replyTo: wren },
];

const DRAFTS = {
  fromTest: {
    ...ED.draftFromTemplate(null),
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
  },
  emptyChoices: {
    ...ED.draftFromTemplate(null),
    text: 'Which {{device}}?',
    variables: [{ key: 'device', kind: 'choice', choicesText: '' }],
  },
  choicesArray: {
    text: '{{a}} {{b}}',
    variables: [
      { key: 'a', kind: 'choice', choices: [' x ', '', 'y', 5, null] },
      { key: 'b', kind: 'choice' },
    ],
  },
  quoteNone: {
    ...ED.draftFromTemplate({ name: 'Q', text: 'x', embed: STAMP_EMBED }),
    quoteMode: 'none',
  },
  keywordsArray: { text: 'x', keywords: ['A', 'a', 'B', 'b ', 'ΣΑΣ', 'σας'] },
  keywordsString: { text: 'x', keywords: 'Ab\u{1F600}a' },
  keywordsTextBoth: { text: 'x', keywordsText: 'one,two', keywords: ['three'] },
  keywordsTextNumber: { text: 'x', keywordsText: 5, keywords: ['three'] },
  keywordsUnicode: {
    text: 'x',
    keywordsText: 'ΣΑΣ, σας, İstanbul, i\u0307stanbul, é, e\u0301',
  },
  variablesOdd: {
    text: '{{a}} {{b}} {{c}} {{their.firstName}}',
    variables: [
      {
        key: 'a',
        label: '  A  ',
        hint: ' h ',
        default: '  d ',
        optional: true,
      },
      { key: 'a', label: 'A again' },
      { key: 'b', label: 5, hint: null, default: 7, optional: 'yes' },
      { key: 'c' },
      { key: 'their.firstName', label: 'Name' },
      { key: 'gone', label: 'x' },
      { key: 5, label: 'number key' },
      { label: 'no key' },
      null,
      'string',
    ],
  },
  raw: {
    uri: 5,
    cid: '',
    rkey: 7,
    name: 9,
    text: ['x'],
    use: 'later',
    group: 3,
    shortcut: ' /X ',
    langs: 'en',
    createdAt: 0,
    updatedAt: 'u',
    embed: 0,
  },
  empty: {},
  null: null,
  string: 'draft',
  extra: {
    ...ED.draftFromTemplate({ name: 'E', text: 'x' }),
    somethingElse: 1,
    quoteView: { any: 1 },
  },
};

const SYNC = {
  fromTest: {
    ...ED.draftFromTemplate(null),
    text: 'Hi {{their.firstName}}, try {{a}} and {{b}}',
    variables: [{ key: 'b', label: 'B?' }],
  },
  keepsDeleted: {
    text: '{{a}}',
    variables: [
      { key: 'b', label: 'Kept' },
      { key: 'a', label: 'A' },
    ],
  },
  contextEntry: {
    text: '{{their.firstName}} {{my.handle}} {{today}}',
    variables: [{ key: 'my.handle', label: 'Mine' }],
  },
  duplicates: {
    text: '{{a}} {{b}}',
    variables: [
      { key: 'a', label: 'first' },
      { key: 'x', label: 'x1' },
      { key: 'a', label: 'second' },
      { key: 'x', label: 'x2' },
    ],
  },
  otherKeys: {
    text: '{{a}}',
    variables: [
      { key: 5, label: 'five' },
      { key: true },
      { key: 0, label: 'falsy' },
      { key: '', label: 'empty' },
      { key: { o: 1 } },
      { key: 5, label: 'five again' },
    ],
  },
  choices: {
    text: '{{a}} {{b}} {{c}}',
    variables: [
      { key: 'a', choices: ['x', 5, 'y', null] },
      { key: 'b', choices: 'xy', choicesText: 'kept' },
      { key: 'c', choicesText: 5, label: null, kind: 'choice', optional: 'no' },
    ],
  },
  textMissing: { variables: [{ key: 'a' }] },
  // `{ ...draft, variables }` copies an array's or a string's indexes.
  arrayDraft: ['x', { key: 'a' }],
  stringDraft: 'a\u{1F33F}',
  numberText: { text: 5, variables: [] },
  null: null,
  nonObjectEntries: {
    text: '{{a}}',
    variables: [null, 'abc', 7, ['a'], { key: 'a', label: 'ok' }],
  },
  unicodeKeys: {
    text: '{{é}} {{K}}',
    variables: [
      { key: 'e\u0301', label: 'decomposed' },
      { key: 'K', label: 'kelvin' },
    ],
  },
};

const LINK_TEMPLATE = {
  name: 'Docs',
  text: 'See the docs',
  embed: {
    $type: 'app.bsky.embed.external',
    external: {
      uri: 'https://docs.example.org/start',
      title: 'Start',
      description: '',
    },
  },
};

export default async function cases() {
  const out = [];
  out.push(value('BLANK_TEMPLATE', ED.BLANK_TEMPLATE));
  out.push(
    ...(await each(
      'templateEmbedKind',
      Object.entries(EMBEDS).map(([name, embed]) => ({ $id: name, embed })),
      ({ embed }) => ED.templateEmbedKind(embed),
    )),
  );
  out.push(
    ...(await each(
      'syncDraftVariables',
      Object.entries(SYNC).map(([name, draft]) => ({ $id: name, draft })),
      ({ draft }) => ED.syncDraftVariables(draft),
    )),
  );

  const templates = {
    null: null,
    empty: {},
    roundTrip: {
      ...normalizeTemplateRecord({}),
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
      embed: STAMP_EMBED,
      use: 'reply',
      group: 'Thanks',
      shortcut: 'idea',
      keywords: ['idea', 'suggest'],
      langs: ['en'],
      createdAt: '2026-09-01T00:00:00.000Z',
      uri: 'at://did:plc:me/net.anisota.feed.template/3t',
      cid: 'bafy',
      rkey: '3t',
    },
    images: { name: 'Pics', text: 'x', embed: EMBEDS.images },
    link: LINK_TEMPLATE,
    feed: { name: 'F', text: 'x', embed: EMBEDS.feed },
    list: { name: 'L', text: 'x', embed: EMBEDS.list },
    keywordsOdd: { text: 'x', keywords: ['a', null, 5, ['b', 'c'], { o: 1 }] },
    nulls: {
      text: null,
      variables: null,
      keywords: null,
      langs: null,
      embed: null,
    },
    seedDraft: ED.draftFromReply({ text: 'Not yet, Wren!', reply }).draft,
    // `(base.langs || []).slice()` keeps a string as it is.
    stringLangs: { name: 'S', text: 'x', langs: 'en' },
    emptyStringLangs: { name: 'S', text: 'x', langs: '' },
    stringTemplate: 'tpl',
    arrayTemplate: ['a', { text: 'b' }],
    extraFields: {
      name: 'X',
      text: '{{a}}',
      variables: [{ key: 'a', choicesText: 'one\ntwo', choices: ['zero'] }],
      extra: true,
    },
    ...Object.fromEntries(
      Object.entries(TEMPLATES).map(([name, t]) => [`t-${name}`, t]),
    ),
    ...Object.fromEntries(
      Object.entries(RECORDS).map(([name, entry]) => [
        `record-${name}`,
        normalizeTemplateRecord(entry),
      ]),
    ),
  };
  out.push(
    ...(await each(
      'draftFromTemplate',
      Object.entries(templates).map(([name, template]) => ({
        $id: name,
        template,
      })),
      ({ template }) => ED.draftFromTemplate(template),
    )),
  );
  // A template through the editor and back.
  out.push(
    ...(await each(
      'roundTrip',
      Object.entries(templates).map(([name, template]) => ({
        $id: name,
        template,
      })),
      ({ template }) => ED.templateFromDraft(ED.draftFromTemplate(template)),
    )),
  );
  out.push(
    ...(await each('draftFromReply', REPLIES, (args) =>
      ED.draftFromReply(args),
    )),
  );
  out.push(
    ...(await each(
      'templateFromDraft',
      Object.entries(DRAFTS).map(([name, draft]) => ({ $id: name, draft })),
      ({ draft }) => ED.templateFromDraft(draft),
    )),
  );
  return out;
}
