// A DM to the moderator, read the same way by the worker and by Vercel.
// Swift: VirgaDefense/DmMessage.swift. Messages and conversations as the
// chat service gives them, and as a stranger could shape them.

import {
  answerTo,
  composeMessage,
  isDirect,
  sharedUri,
} from '../../../src/defense/dmMessage.js';
import { each } from './_helpers.js';

export const sources = ['src/defense/dmMessage.js', 'src/defense/command.js'];

const POST = 'at://did:plc:author/app.bsky.feed.post/3xyz';
const LINK = 'https://bsky.app/profile/jo.example.com/post/3lxyz';

const link = (uri) => ({
  index: { byteStart: 0, byteEnd: 24 },
  features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
});
const mention = (did) => ({
  index: { byteStart: 0, byteEnd: 10 },
  features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
});
const recordEmbed = (record) => ({
  $type: 'app.bsky.embed.record#view',
  record,
});

const MESSAGES = [
  // worker/agent.test.js
  {
    text: 'block this',
    embed: { record: { uri: 'at://did:plc:a/app.bsky.feed.post/3x' } },
    facets: [
      {
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://bsky.app/profile/x.example.com',
          },
        ],
      },
    ],
  },
  { text: 'hi' },
  { text: 'block this', embed: recordEmbed({ uri: POST }) },
  { text: 'scan', embed: recordEmbed({ record: { uri: POST } }) },
  { text: 'x', embed: recordEmbed({ uri: null, record: { uri: POST } }) },
  { text: 'x', embed: recordEmbed({ uri: 5, record: { uri: POST } }) },
  { text: 'x', embed: recordEmbed({ uri: 'https://example.com' }) },
  { text: 'x', embed: recordEmbed({ uri: 'AT://did:plc:a/x/y' }) },
  { text: 'x', embed: recordEmbed({ uri: '' }) },
  { text: 'x', embed: { record: null } },
  { text: 'x', embed: 'at://nope' },
  { text: 'block bsky.app/profile/jo.e...', facets: [link(LINK)] },
  { text: `block ${LINK}`, facets: [link(LINK)] },
  { text: 'block @jo', facets: [mention('did:plc:jojojojojojo')] },
  {
    text: 'two of them',
    facets: [
      mention('did:plc:a'),
      mention('did:plc:b'),
      link(LINK),
      link('https://x.example'),
    ],
  },
  {
    text: 'everything at once',
    embed: recordEmbed({ uri: POST }),
    facets: [link(LINK), mention('did:plc:a')],
  },
  { text: '', embed: recordEmbed({ uri: POST }) },
  { text: null, facets: [mention('did:plc:a')] },
  { text: 42, facets: [link('42')] },
  { text: ['a', 'b'] },
  { text: { a: 1 } },
  { text: 0 },
  { text: false },
  { text: '😀 emoji and “quotes”\nnew line' },
  {
    text: 'contains https://bsky.app/profile/jo',
    facets: [link('https://bsky.app/profile/jo')],
  },
  { text: 'contains part', facets: [link('part of it')] },
  { text: 'é vs é', facets: [link('é')] },
  { text: 'K and K', facets: [link('K')] },
  {
    facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: 7 }] }],
  },
  {},
  null,
  undefined,
  // facets the web can't iterate: it throws
  { text: 'block @x', facets: {} },
  { text: 'block @x', facets: 3 },
  { text: 'block @x', facets: [link(LINK), { features: { 0: 'x' } }] },
  {
    text: 'shared, then broken',
    embed: recordEmbed({ uri: POST }),
    facets: [mention('did:plc:a'), { features: true }],
  },
  { text: 'a string of facets', facets: 'abc' },
];

const CONVOS = [
  { kind: { $type: 'chat.bsky.convo.defs#directConvo' } },
  { kind: { $type: 'chat.bsky.convo.defs#groupConvo' }, members: [{}, {}] },
  { kind: { $type: '' }, members: [{}, {}] },
  { kind: { $type: 1 }, members: [{}, {}] },
  { kind: {}, members: [{}, {}] },
  { members: [{}, {}] },
  { members: [{}, {}, {}] },
  { members: [{}] },
  { members: 'ab' },
  { members: { length: 2 } },
  { kind: { $type: 'CHAT.BSKY.CONVO.DEFS#DIRECTCONVO' } },
  { kind: 'chat.bsky.convo.defs#directConvo', members: [{}, {}] },
  {},
  null,
  undefined,
];

const ANSWERS = [
  // worker/agent.test.js
  'Yes!',
  'go ahead.',
  'Nope',
  'yes but only the first two',
  'block @x',
  'yes',
  'Yes.',
  'YES!!!',
  '  y  ',
  'yep',
  'yeah',
  'yup',
  'ok',
  'OK!',
  'okay',
  'sure',
  'do it',
  'do it.',
  'go ahead',
  'go on',
  'please do',
  'confirm',
  '👍',
  '👍🏽',
  '👍🏿!',
  '👍🏽🏽',
  '👍👍',
  'no',
  'n',
  'nope',
  "don't",
  'dont',
  'don’t',
  'do not',
  'cancel',
  'stop',
  'never mind',
  'nevermind',
  'never  mind',
  '👎',
  '👎🏻',
  'yes please',
  'no thanks',
  'yes!. ',
  'yes\u00a0',
  'yes\u0085',
  'yes?',
  'y e s',
  'Ｙｅｓ',
  'İ',
  '',
  null,
  undefined,
  0,
  42,
  'maybe',
  'okay.!.!',
  '.yes',
];

export default async function cases() {
  return [
    ...(await each(
      'sharedUri',
      MESSAGES.map((message) => ({ message })),
      ({ message }) => sharedUri(message),
    )),
    ...(await each(
      'composeMessage',
      MESSAGES.map((message) => ({ message })),
      ({ message }) => composeMessage(message),
    )),
    ...(await each(
      'isDirect',
      CONVOS.map((convo) => ({ convo })),
      ({ convo }) => isDirect(convo),
    )),
    ...(await each(
      'answerTo',
      ANSWERS.map((text) => ({ text })),
      ({ text }) => answerTo(text),
    )),
  ];
}
