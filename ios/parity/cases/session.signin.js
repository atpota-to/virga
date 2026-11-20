// Signing in a step at a time (src/signin/): the card's reducer run over
// event sequences, every sentence it says, the five hosts (a surface
// fixture), what a host's refusal is and isn't, the second try at a sign-up,
// what typing leaves in the field and how it is read, the "Is this you?"
// lookups against recorded answers, and the suggestions under the field.
// Swift: VirgaSession/SignIn/ (SignInFlow, SignInHosts, SignInIdentity,
// SignInSuggest).

import {
  FINDING_MIN_MS,
  LEAVE_DELAY_MS,
  STALL_MS,
  STEP,
  continueLabel,
  flowReducer,
  identityMeta,
  identityName,
  initialFlow,
  leavingDetail,
  leavingTitle,
  lookupFailedNotice,
  notFoundNotice,
  stallLabel,
  tripFailureNotice,
} from '../../../src/signin/flow.js';
import {
  SIGNUP_HOSTS,
  notTheHosts,
  signUpAt,
} from '../../../src/signin/hosts.js';
import {
  classifySignInInput,
  cleanTyped,
  createIdentityResolver,
  handleFromDidDocument,
  hostLabelForPds,
  hostnameOf,
  normalizeSignInInput,
} from '../../../src/signin/identity.js';
import {
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_LIMIT,
  SUGGEST_MIN_CHARS,
  moveActive,
  searchAccounts,
  suggestQuery,
} from '../../../src/signin/suggest.js';
import { each, grid, value } from './_helpers.js';
import { json, recordFetchFresh } from './_fetch.js';

export const sources = [
  'src/signin/flow.js',
  'src/signin/hosts.js',
  'src/signin/identity.js',
  'src/signin/suggest.js',
];

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const APPVIEW = 'https://appview.test';
const PDS = 'https://puffball.us-east.host.bsky.network';
const MIRA = {
  did: DID,
  handle: 'mira.example.com',
  displayName: 'Mira Okafor',
  avatar: null,
  host: 'bsky.social',
  pds: 'https://pds.test',
};

/** An error as the generators write one, made into the error the web code meets. */
function errorOf(shape) {
  if (shape == null) return shape ?? undefined;
  const make = shape.name === 'TypeError' ? TypeError : Error;
  const error = new make(shape.message ?? '');
  for (const [k, v] of Object.entries(shape)) {
    if (k === 'message') continue;
    if (k === 'name')
      Object.defineProperty(error, 'name', {
        value: v,
        configurable: true,
        writable: true,
      });
    else error[k] = v;
  }
  return error;
}

const ERRORS = [
  { name: 'Error', message: 'x', code: 'HANDLE_NOT_FOUND' },
  { name: 'Error', message: 'x', code: 'AUTHORIZE_FAILED' },
  { name: 'Error', message: 'x', code: 'VIRGA_CLIENT_UNAVAILABLE' },
  { name: 'Error', message: 'x', status: 503 },
  { name: 'Error', message: 'x', code: 'OTHER', status: 503 },
  { name: 'Error', message: 'x', code: 7, status: 503 },
  { name: 'TypeError', message: 'Failed to fetch', code: 'NETWORK_ERROR' },
  { name: 'Error', message: 'x', code: 'RATE_LIMITED' },
  { name: 'Error', message: 'x', code: 'REDIRECT_NOT_ALLOWED' },
  { name: 'Error', message: 'x', code: 'INTERNAL', status: 500 },
  { name: 'Error', message: 'x', code: 'CANCELLED' },
  { name: 'Error', message: 'redirect_uri is not allowed' },
  { name: 'Error', message: 'Origin is not an Allowed Frontend' },
  { name: 'Error', message: 'Failed to resolve identity: nobody.example' },
  { name: 'Error', message: 'Invalid handle "x"' },
  { name: 'Error', message: 'invalid DID' },
  { name: 'Error', message: 'Handle must be a valid domain' },
  {
    name: 'Error',
    message: 'Failed to resolve OAuth server metadata for https://pds.example',
  },
  {
    name: 'Error',
    message: 'https://pds.example is not protected by issuer x',
  },
  { name: 'Error', message: 'Server does not support PAR' },
  { name: 'Error', message: 'invalid_scope: unknown' },
  { name: 'Error', message: 'The SCOPE is wrong' },
  { name: 'TypeError', message: 'Failed to fetch' },
  {
    name: 'TypeError',
    message: 'NetworkError when attempting to fetch resource.',
  },
  { name: 'TypeError', message: 'Load failed' },
  { name: 'TypeError', message: 'x is not a function' },
  { name: 'Error', message: 'Failed to fetch' },
  { name: 'AbortError', message: 'The operation was aborted' },
  {
    name: 'AbortError',
    message: 'The sign-in was called off',
    code: 'CANCELLED',
  },
  { name: 'Error', message: 'User navigated back' },
  { name: 'Error', message: 'request aborted by the user' },
  { name: 'Error', message: 'invalid_request: unsupported prompt' },
  { name: 'Error', message: '' },
  null,
];

/** Each sequence starts from initialFlow(); the state after every event is recorded. */
const SEQUENCES = [
  [{ type: 'find' }, { type: 'found', identity: MIRA }],
  [
    { type: 'find' },
    { type: 'lookup-failed', notice: notFoundNotice('nobody.example.com') },
  ],
  [{ type: 'find' }, { type: 'not-me' }, { type: 'found', identity: MIRA }],
  [
    { type: 'find' },
    { type: 'not-me' },
    { type: 'lookup-failed', notice: notFoundNotice('x') },
  ],
  [
    { type: 'notice', notice: notFoundNotice('x.example') },
    { type: 'typed' },
    { type: 'typed' },
  ],
  [{ type: 'find' }, { type: 'found', identity: MIRA }, { type: 'not-me' }],
  [{ type: 'hosts' }, { type: 'hosts-back' }],
  [
    { type: 'find' },
    { type: 'found', identity: MIRA },
    { type: 'hosts' },
    { type: 'hosts-back' },
  ],
  [
    { type: 'find' },
    { type: 'found', identity: MIRA },
    { type: 'hosts' },
    { type: 'not-me' },
    { type: 'hosts' },
    { type: 'hosts-back' },
  ],
  [{ type: 'find' }, { type: 'hosts' }, { type: 'hosts-back' }],
  [{ type: 'leave', host: 'bsky.social' }, { type: 'hosts' }],
  [
    { type: 'find' },
    { type: 'found', identity: MIRA },
    { type: 'leave', host: 'bsky.social', purpose: 'signin' },
    { type: 'cancel' },
    { type: 'leave', host: 'bsky.social' },
    { type: 'sent', trip: 1 },
    { type: 'stalled', trip: 1 },
    { type: 'trip-failed', trip: 1, notice: { text: 'old' } },
    { type: 'sent', trip: 2 },
    { type: 'stalled', trip: 2 },
    { type: 'sent', trip: 2 },
    {
      type: 'trip-failed',
      trip: 2,
      notice: { about: 'trip', text: 'Couldn’t reach Virga’s server.' },
    },
  ],
  [
    { type: 'hosts' },
    { type: 'leave', host: 'eurosky.social', purpose: 'signup' },
    { type: 'cancel' },
  ],
  [{ type: 'leave' }, { type: 'cancel' }],
  [
    { type: 'leave', host: '' },
    { type: 'host-known', trip: 1, host: 'bsky.social' },
    { type: 'host-known', trip: 1, host: 'other.example' },
  ],
  [
    { type: 'leave', host: null },
    { type: 'host-known', trip: 9, host: 'bsky.social' },
    { type: 'host-known', trip: 1, host: null },
    { type: 'host-known', trip: 1, host: '' },
  ],
  [
    { type: 'leave', host: 'bsky.social', purpose: 'signup' },
    { type: 'leave', host: 'elsewhere.example' },
  ],
  [{ type: 'find' }, { type: 'leave', host: 'bsky.social' }],
  [
    { type: 'no-such-event' },
    { type: 'cancel' },
    { type: 'sent', trip: 1 },
    { type: 'stalled', trip: 1 },
    { type: 'trip-failed', trip: 1, notice: null },
  ],
  [
    { type: 'leave', host: 'x.example', purpose: 'other' },
    { type: 'trip-failed', trip: 1, notice: null },
  ],
  [
    { type: 'find' },
    { type: 'found', identity: null },
    { type: 'hosts' },
    { type: 'hosts-back' },
  ],
  [
    { type: 'find' },
    { type: 'find' },
    { type: 'found', identity: MIRA },
    { type: 'found', identity: { did: 'did:plc:other' } },
    { type: 'find' },
  ],
];

export default async function cases() {
  return [
    value('STEP', STEP),
    value('timings', { FINDING_MIN_MS, LEAVE_DELAY_MS, STALL_MS }),
    value('initialFlow', initialFlow()),
    value('SIGNUP_HOSTS', SIGNUP_HOSTS),
    value('suggestConstants', {
      SUGGEST_MIN_CHARS,
      SUGGEST_LIMIT,
      SUGGEST_DEBOUNCE_MS,
    }),

    ...(await each(
      'flowReducer',
      SEQUENCES.map((events) => ({ events })),
      ({ events }) => {
        let state = initialFlow();
        return events.map((event) => {
          const next = flowReducer(state, event);
          const same = next === state;
          state = next;
          return { state, same };
        });
      },
    )),

    ...(await each(
      'notices',
      [
        'nobody.example.com',
        'did:plc:x',
        'mira.example.com',
        '',
        'DID:plc:x',
        'didn.example',
      ].map((v) => ({ value: v })),
      ({ value: v }) => ({
        notFound: notFoundNotice(v),
        lookupFailed: lookupFailedNotice(v),
      }),
    )),

    ...(await each(
      'identityWords',
      [
        MIRA,
        { ...MIRA, displayName: null },
        { ...MIRA, displayName: '' },
        { did: DID, handle: null, displayName: null },
        { did: DID, handle: null, displayName: 'Only a name' },
        { did: '', handle: '', displayName: '' },
        { ...MIRA, host: null },
        { ...MIRA, host: '' },
        null,
      ].map((identity) => ({ identity })),
      ({ identity }) => ({
        identityName: identityName(identity),
        identityMeta: identityMeta(identity),
        continueLabel: continueLabel(identity),
      }),
    )),

    ...(await each(
      'leavingWords',
      grid({
        host: ['bsky.social', null, ''],
        purpose: ['signin', 'signup'],
      }).concat([{ leaving: null }]),
      ({ host, purpose, leaving }) => {
        const card = leaving === null ? null : { host, purpose };
        return {
          leavingTitle: leavingTitle(card),
          leavingDetail: leavingDetail(card),
          stallLabel: stallLabel(card),
        };
      },
    )),

    ...(await each(
      'tripFailureNotice',
      ERRORS.flatMap((error) =>
        [
          { purpose: 'signin', host: 'bsky.social' },
          { purpose: 'signup', host: 'eurosky.social' },
          { purpose: 'signup', host: null },
          null,
        ].map((leaving) => ({ error, leaving })),
      ),
      ({ error, leaving }) => tripFailureNotice(errorOf(error), leaving),
    )),

    ...(await each(
      'notTheHosts',
      ERRORS.map((error) => ({ error })),
      ({ error }) => notTheHosts(errorOf(error)),
    )),

    // signUpAt over a signIn that fails as the script says: each call's
    // host and options are recorded, and what came of it.
    ...(await each(
      'signUpAt',
      [
        { $id: 'first-try', failures: [], options: { mode: 'backend' } },
        {
          $id: 'turned-down',
          failures: [{ code: 'AUTHORIZE_FAILED', message: 'x' }],
          options: { mode: 'backend' },
        },
        {
          $id: 'library-refusal',
          failures: [{ message: 'invalid_request: unsupported prompt' }],
          options: { mode: 'browser' },
        },
        {
          $id: 'both-fail',
          failures: [
            { code: 'AUTHORIZE_FAILED', message: 'first' },
            { code: 'AUTHORIZE_FAILED', message: 'second' },
          ],
          options: {},
        },
        {
          $id: 'cancelled',
          failures: [
            {
              name: 'AbortError',
              code: 'CANCELLED',
              message: 'The sign-in was called off',
            },
          ],
          options: {},
        },
        {
          $id: 'dropped',
          failures: [{ name: 'TypeError', message: 'Failed to fetch' }],
          options: {},
        },
        {
          $id: 'network',
          failures: [{ code: 'NETWORK_ERROR', message: 'x' }],
          options: {},
        },
        {
          $id: 'rate',
          failures: [{ code: 'RATE_LIMITED', message: 'x' }],
          options: {},
        },
        {
          $id: 'navigated-back',
          failures: [{ message: 'User navigated back' }],
          options: {},
        },
        {
          $id: 'keeps-options',
          failures: [{ code: 'AUTHORIZE_FAILED', message: 'x' }],
          options: {
            mode: 'backend',
            did: DID,
            defense: 'scan',
            prompt: 'login',
          },
        },
      ],
      async ({ failures, options }) => {
        const calls = [];
        let n = 0;
        const signIn = async (hostUrl, opts) => {
          calls.push({ hostUrl, options: opts });
          const failure = failures[n++];
          if (failure) throw errorOf(failure);
          return 'gone';
        };
        try {
          const result = await signUpAt(signIn, 'https://old.example', options);
          return { calls, result };
        } catch (error) {
          return { calls, error: error.message };
        }
      },
    )),

    // What typing leaves in the field, and how it is read.
    ...(await each(
      'typed',
      [
        'mi​ra.example‮.com﻿',
        ' Mira.Example.com ',
        null,
        '  @Mira.Example.COM ',
        '@@mira.example.com',
        'mi​ra.example.com',
        'ｍｉｒａ.example.com',
        '',
        '   ',
        undefined,
        ` ${DID} `,
        'did:web:Example.com',
        'https://bsky.app/profile/Mira.example.com',
        'https://www.bsky.app/profile/mira.example.com/post/3kabc?ref=x',
        `https://bsky.app/profile/${DID}/lists`,
        'https://bsky.app/profile/%E0%A4%A',
        'https://bsky.app/profile/%F0%9F%98%80.example',
        'HTTPS://BSKY.APP/PROFILE/Mira.example.com',
        'https://www.bsky.app/www.bsky.app/profile/x',
        'https://bsky.app/profile/',
        'https://bsky.app/profile/a b',
        'http://bsky.app/profile/@mira.example.com',
        ' https://PDS.Example.com/ ',
        'https://bsky.app/about',
        'ftp://pds.example.com',
        '⁦@Mira⁩',
        'ＭＩＲＡ．ＥＸＡＭＰＬＥ．ＣＯＭ',
        '@ mira',
        'ΟΔΟΣ.example',
        'İstanbul.example',
        'did:PLC:abc',
        '@did:plc:abc',
        '​',
      ].map((raw) => ({ raw })),
      ({ raw }) => {
        const normalized = normalizeSignInInput(raw);
        return {
          cleanTyped: cleanTyped(raw),
          normalized,
          kind: classifySignInInput(normalized),
          suggestQuery: suggestQuery(raw),
        };
      },
    )),
    ...(await each(
      'classifySignInInput',
      [
        '',
        'mira.example.com',
        DID,
        'https://pds.example.com',
        'HTTP://pds.example.com',
        'did:',
        'did',
        'httpx://a',
        null,
      ].map((v) => ({ value: v })),
      ({ value: v }) => classifySignInInput(v),
    )),

    ...(await each(
      'hostnameOf',
      [
        'https://pds.example.com:8443/x',
        'not an address',
        null,
        PDS,
        'https://bsky.network',
        'https://notbsky.network.example',
        'https://pds.example.com',
        'garbage',
        'https://BSKY.Network/',
        'https://x.bsky.network.',
        'mailto:x@example.com',
        'https://[::1]:3000',
        'https://xn--bcher-kva.example',
        'https://bücher.example',
      ].map((url) => ({ url })),
      ({ url }) => ({
        hostnameOf: hostnameOf(url),
        hostLabelForPds: hostLabelForPds(url),
      }),
    )),

    ...(await each(
      'handleFromDidDocument',
      [
        { id: DID, alsoKnownAs: ['at://mira.example.com'] },
        { alsoKnownAs: ['https://example.com', 'at://Mira.Example.com'] },
        { alsoKnownAs: ['AT://Upper.Example'] },
        { alsoKnownAs: ['at://nodot'] },
        { alsoKnownAs: ['at://nodot', 'at://second.example'] },
        { alsoKnownAs: ['at://under_score.example', 'at://ok.example'] },
        { alsoKnownAs: ['at://mira.example.com/'] },
        { alsoKnownAs: [42, { at: 'x' }, 'at://fine.example'] },
        { alsoKnownAs: 'at://not.a.list' },
        {},
        null,
      ].map((doc) => ({ doc })),
      ({ doc }) => handleFromDidDocument(doc),
    )),

    ...(await each(
      'moveActive',
      [-1, 0, 1, 2, 4, 5].flatMap((index) =>
        [0, 3, 5].flatMap((count) =>
          ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].map((key) => ({
            index,
            count,
            key,
          })),
        ),
      ),
      ({ index, count, key }) => moveActive(index, count, key),
    )),

    // The lookups, against recorded answers (a fresh clock each, past the
    // DID documents earlier cases read).
    ...(await each(
      'resolveSignInHost',
      [
        {
          $id: 'named-server',
          routes: {
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
        {
          $id: 'names-none',
          routes: {
            'plc.directory': json(didDocument('https://pds.example.com')),
            'oauth-protected-resource': json({}, 404),
          },
        },
        {
          $id: 'cant-ask',
          routes: {
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': 'offline',
          },
        },
        {
          $id: 'odd-server',
          routes: {
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json({ authorization_servers: [42] }),
          },
        },
        {
          $id: 'not-a-list',
          routes: {
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json({
              authorization_servers: 'https://x.example',
            }),
          },
        },
        {
          $id: 'bad-server-url',
          routes: {
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json({
              authorization_servers: ['not a url'],
            }),
          },
        },
        {
          $id: 'no-document',
          routes: {
            'plc.directory': json({ message: 'DID not registered' }, 404),
          },
        },
        {
          $id: 'no-pds',
          routes: { 'plc.directory': json({ id: DID, service: [] }) },
        },
        {
          $id: 'document-given',
          document: didDocument('https://given.example'),
          routes: { 'oauth-protected-resource': json(PROTECTED) },
        },
        {
          $id: 'pds-with-path',
          routes: {
            'plc.directory': json(didDocument('https://pds.example.com/base/')),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
        {
          $id: 'did-web',
          did: 'did:web:mira.example.com',
          routes: {
            'mira.example.com/.well-known/did.json': json(
              didDocument('https://pds.example.com'),
            ),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
      ],
      ({ routes, document, did = DID }) =>
        recordFetchFresh(route(routes), () =>
          createIdentityResolver({ appview: APPVIEW }).resolveSignInHost(did, {
            document,
          }),
        ),
    )),

    ...(await each(
      'resolveSignInIdentity',
      [
        {
          $id: 'profile',
          input: 'mira.example.com',
          routes: {
            getProfile: json(PROFILE),
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
        {
          $id: 'invalid-handle',
          input: 'mira.example.com',
          routes: {
            getProfile: json({
              did: DID,
              handle: 'handle.invalid',
              displayName: '',
            }),
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
        {
          $id: 'not-indexed',
          input: 'new.example.com',
          routes: {
            getProfile: json(
              { error: 'InvalidRequest', message: 'Profile not found' },
              400,
            ),
            resolveHandle: json({ did: DID }),
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
        {
          $id: 'nobody',
          input: 'nobody.example.com',
          routes: {
            getProfile: json(
              { error: 'InvalidRequest', message: 'Profile not found' },
              400,
            ),
            resolveHandle: json(
              { error: 'InvalidRequest', message: 'Unable to resolve handle' },
              400,
            ),
          },
        },
        {
          $id: 'offline',
          input: 'mira.example.com',
          routes: { getProfile: 'offline', resolveHandle: 'offline' },
        },
        {
          $id: 'down',
          input: 'mira.example.com',
          routes: { getProfile: json({}, 502), resolveHandle: json({}, 503) },
        },
        {
          $id: 'busy',
          input: 'mira.example.com',
          routes: { getProfile: json({}, 429), resolveHandle: json({}, 429) },
        },
        {
          $id: 'profile-offline-handle-down',
          input: 'mira.example.com',
          routes: { getProfile: 'offline', resolveHandle: json({}, 500) },
        },
        {
          $id: 'by-did',
          input: DID,
          routes: {
            getProfile: json(
              { error: 'InvalidRequest', message: 'Profile not found' },
              400,
            ),
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
        {
          $id: 'did-no-usable-handle',
          input: DID,
          routes: {
            getProfile: json({ did: DID, handle: 'handle.invalid' }),
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
        {
          $id: 'did-unknown',
          input: DID,
          routes: {
            getProfile: json({}, 400),
            'plc.directory': json({ message: 'DID not registered' }, 404),
          },
        },
        {
          $id: 'did-gone',
          input: DID,
          routes: {
            getProfile: json({}, 400),
            'plc.directory': json({ message: 'gone' }, 410),
          },
        },
        {
          $id: 'did-directory-down',
          input: DID,
          routes: { getProfile: json({}, 400), 'plc.directory': json({}, 503) },
        },
        {
          $id: 'no-host',
          input: 'mira.example.com',
          routes: { getProfile: json(PROFILE), 'plc.directory': 'offline' },
        },
        {
          $id: 'resolved-to-odd',
          input: 'odd.example',
          routes: {
            getProfile: json({ handle: 'odd.example' }),
            resolveHandle: json({ did: 42 }, 200),
          },
        },
        {
          $id: 'encoded',
          input: 'a&b=c.example',
          routes: { getProfile: json({}, 400), resolveHandle: json({}, 400) },
        },
        {
          $id: 'not-json',
          input: 'mira.example.com',
          routes: {
            getProfile: { status: 200, text: '<html>' },
            resolveHandle: json({ did: DID }),
            'plc.directory': json(didDocument()),
            'oauth-protected-resource': json(PROTECTED),
          },
        },
      ],
      ({ input, routes }) =>
        recordFetchFresh(route(routes), () =>
          createIdentityResolver({ appview: APPVIEW })
            .resolveSignInIdentity(input)
            .catch((error) => ({
              error: {
                name: error.name,
                message: error.message,
                input: error.input ?? null,
              },
            })),
        ),
    )),

    ...(await each(
      'searchAccounts',
      [
        {
          $id: 'two',
          term: 'mir',
          answer: json({
            actors: [
              {
                did: 'did:plc:a',
                handle: 'mira.example.com',
                displayName: ' Mira Okafor ',
                avatar: 'https://cdn.test/m.jpg',
                labels: [],
              },
              { did: 'did:plc:b', handle: 'mirror.example.org' },
            ],
          }),
        },
        { $id: 'encoded', term: 'a&limit=100', answer: json({ actors: [] }) },
        {
          $id: 'malformed',
          term: 'ok',
          answer: json({
            actors: [
              { did: 'did:plc:a', handle: 'handle.invalid' },
              { handle: 'no-did.example' },
              null,
              { did: 'did:plc:c', handle: 'ok.example', displayName: '   ' },
            ],
          }),
        },
        {
          $id: 'limit-3',
          term: 'a',
          limit: 3,
          answer: json({
            actors: Array.from({ length: 9 }, (_, i) => ({
              did: `did:plc:${i}`,
              handle: `a${i}.example`,
            })),
          }),
        },
        { $id: 'no-list', term: 'mir', answer: json({}) },
        {
          $id: 'not-json',
          term: 'mir',
          answer: { status: 200, text: '<html>' },
        },
        { $id: 'refused', term: 'mir', answer: json({ error: 'x' }, 500) },
        { $id: 'offline', term: 'mir', answer: 'offline' },
        { $id: 'unicode', term: 'mïra 😀', answer: json({ actors: [] }) },
      ],
      ({ term, limit, answer }) =>
        recordFetchFresh(route({ searchActorsTypeahead: answer }), () =>
          searchAccounts(term, {
            appview: APPVIEW,
            ...(limit ? { limit } : {}),
          }).catch((error) => ({
            error: { message: error.message, status: error.status ?? null },
          })),
        ),
    )),
  ];
}

function didDocument(pds = PDS, handle = 'mira.example.com') {
  return {
    id: DID,
    alsoKnownAs: [`at://${handle}`],
    service: [
      {
        id: '#atproto_pds',
        type: 'AtprotoPersonalDataServer',
        serviceEndpoint: pds,
      },
    ],
  };
}

const PROFILE = {
  did: DID,
  handle: 'mira.example.com',
  displayName: '  Mira Okafor ',
  avatar: 'https://cdn.test/a.jpg',
};
const PROTECTED = {
  resource: PDS,
  authorization_servers: ['https://bsky.social'],
};

/** Answers by a piece of the address: a response, or 'offline'. */
function route(routes) {
  return (request) => {
    for (const [piece, answer] of Object.entries(routes)) {
      if (!request.url.includes(piece)) continue;
      if (answer === 'offline') throw new TypeError('fetch failed');
      return answer;
    }
    throw new TypeError(`no answer for ${request.url}`);
  };
}
