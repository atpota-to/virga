// The Terms of Service and the Privacy Policy: which version and date an
// account agrees to, the note this device keeps of an agreement and what the
// agreement screen does with it, where each document lives and where its
// links go, and the two calls to Virga's server. Swift:
// VirgaSession/Legal/ (LegalVersion, Acceptance, LegalDocuments,
// TermsService). The network cases are recorded exchanges (_fetch.js).

import {
  MAX_REPORT_TRIES,
  TERMS_ACCEPTED_PREFIX,
  acceptFailure,
  coversCurrent,
  needsReport,
  opensGate,
  readAcceptance,
  startingStatus,
  statusFromAnswer,
  termsKey,
  writeAcceptance,
} from '../../../src/legal/acceptance.js';
import {
  DOCUMENTS,
  documentFor,
  resolveDocumentLink,
} from '../../../src/legal/documents.js';
import {
  TERMS_API,
  fetchTermsStatus,
  recordAcceptance,
  reportAcceptance,
} from '../../../src/legal/termsService.js';
import {
  PRIVACY_PATH,
  TERMS_EFFECTIVE_DATE,
  TERMS_PATH,
  TERMS_VERSION,
  formatLegalDate,
} from '../../../src/legal/version.js';
import { createBackendRequester } from '../../../src/session/backendClient.js';
import { each, value } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = [
  'src/legal/version.js',
  'src/legal/acceptance.js',
  'src/legal/documents.js',
  'src/legal/termsService.js',
];

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const SERVER = 'https://virga.example';
const TOKEN = `vg_${'0f'.repeat(32)}`;

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const errorShape = (e) => ({
  name: e?.name ?? null,
  message: e?.message ?? null,
  status: e?.status ?? null,
  code: e?.code ?? null,
});

// Every note readAcceptance may meet: the web test's, and the odd ones.
const STORED_NOTES = [
  null,
  '',
  'null',
  'not json',
  '1',
  '"1"',
  '{}',
  '[1]',
  'true',
  '{"version":"1"}',
  '{"version":0}',
  '{"version":-1}',
  '{"version":1.5}',
  '{"version":1}',
  '{"version":2}',
  '{"version":1e3}',
  '{"version":1.0,"at":"2026-11-14T10:00:00.000Z","recorded":true,"tries":0,"identity":"session"}',
  JSON.stringify({
    version: 2,
    at: 42,
    recorded: 'yes',
    tries: -3,
    identity: 'verified',
  }),
  JSON.stringify({
    version: 1,
    at: null,
    recorded: false,
    tries: 3,
    identity: 'claimed',
  }),
  JSON.stringify({ version: 1, tries: 2.5, identity: 'Session' }),
  JSON.stringify({ version: 1, tries: 7, recorded: 1 }),
  JSON.stringify({ version: 1, at: '', identity: null }),
  '{"version":1,"version":3}',
  '{"version":1,}',
];

const NOTES = [
  null,
  {
    version: TERMS_VERSION,
    at: null,
    recorded: true,
    tries: 0,
    identity: 'session',
  },
  {
    version: TERMS_VERSION,
    at: null,
    recorded: true,
    tries: 0,
    identity: 'claimed',
  },
  {
    version: TERMS_VERSION,
    at: null,
    recorded: false,
    tries: 0,
    identity: null,
  },
  {
    version: TERMS_VERSION,
    at: null,
    recorded: false,
    tries: MAX_REPORT_TRIES - 1,
    identity: null,
  },
  {
    version: TERMS_VERSION,
    at: null,
    recorded: false,
    tries: MAX_REPORT_TRIES,
    identity: null,
  },
  {
    version: TERMS_VERSION + 1,
    at: '2026-11-14T10:00:00Z',
    recorded: true,
    tries: 0,
    identity: 'session',
  },
  {
    version: TERMS_VERSION - 1 || 0,
    at: null,
    recorded: true,
    tries: 0,
    identity: 'session',
  },
];

const ERRORS = [
  null,
  { name: 'Error', message: 'x', code: 'TERMS_VERSION_MISMATCH', status: 409 },
  { name: 'Error', message: 'x', code: 'NETWORK_ERROR', status: 0 },
  { name: 'Error', message: 'x', code: 'TIMEOUT', status: 0 },
  { name: 'Error', message: 'x', code: 'RATE_LIMITED', status: 429 },
  {
    name: 'Error',
    message: 'x',
    code: 'FRONTEND_SESSION_INVALID',
    status: 401,
  },
  { name: 'Error', message: 'x', code: null, status: 401 },
  { name: 'Error', message: 'x', code: 'UNAVAILABLE', status: 503 },
  { name: 'Error', message: 'x', code: 'INTERNAL', status: 500 },
  { name: 'Error', message: 'relation "terms_acceptance" does not exist' },
  { name: 'Error', message: 'x', code: '', status: 401 },
  { name: 'Error', message: 'x', code: 'network_error', status: 0 },
];

/** A requester call through the real requester, recorded. */
function asRequester(answers, fn) {
  return recordFetch(inTurn(...answers), () => {
    const requester = createBackendRequester({
      backendUrl: SERVER,
      token: () => TOKEN,
      did: DID,
    });
    return fn(requester).catch((error) => ({ error: errorShape(error) }));
  });
}

export default async function cases() {
  return [
    value('TERMS_VERSION', TERMS_VERSION),
    value('TERMS_EFFECTIVE_DATE', TERMS_EFFECTIVE_DATE),
    value('TERMS_PATH', TERMS_PATH),
    value('PRIVACY_PATH', PRIVACY_PATH),
    value('TERMS_ACCEPTED_PREFIX', TERMS_ACCEPTED_PREFIX),
    value('MAX_REPORT_TRIES', MAX_REPORT_TRIES),
    value('TERMS_API', TERMS_API),
    value(
      'DOCUMENTS',
      Object.values(DOCUMENTS).map(({ key, title, short, path, file }) => ({
        key,
        title,
        short,
        path,
        file,
      })),
    ),

    ...(await each(
      'formatLegalDate',
      [
        '2026-11-14',
        '2027-01-05',
        TERMS_EFFECTIVE_DATE,
        '2026-12-31',
        '2026-02-31',
        '0000-01-01',
        '',
        '14/11/2026',
        '2026-13-01',
        '2026-00-10',
        '2026-02-00',
        '2026-02-32',
        'November 14, 2026',
        null,
        '2026-1-05',
        '2026-01-05 ',
        ' 2026-01-05',
        '2026-01-05\n',
        '２０２６-01-05',
        '12026-01-05',
        20261114,
      ].map((isoDate) => ({ isoDate })),
      ({ isoDate }) => formatLegalDate(isoDate),
    )),

    ...(await each(
      'termsKey',
      [DID, 'did:web:example.com', ''].map((did) => ({ did })),
      ({ did }) => termsKey(did),
    )),

    ...(await each(
      'readAcceptance',
      [
        ...STORED_NOTES.map((stored) => ({ stored, did: DID })),
        { stored: '{"version":1}', did: null },
        { stored: '{"version":1}', did: '' },
      ],
      ({ stored, did }) => {
        const storage = memoryStorage(
          stored === null ? {} : { [termsKey(DID)]: stored },
        );
        return readAcceptance(storage, did);
      },
    )),

    // The exact text kept, so another reader (the web's, an older build's)
    // reads the note the same way.
    ...(await each(
      'writeAcceptance',
      [
        { did: DID, options: {} },
        { did: DID, options: null },
        {
          did: DID,
          options: {
            at: '2026-11-14T10:00:00.000Z',
            recorded: true,
            identity: 'session',
          },
        },
        {
          did: DID,
          options: {
            version: 2,
            at: 42,
            recorded: true,
            tries: 3,
            identity: 'claimed',
          },
        },
        { did: DID, options: { at: 'quote " and \\ and ✓' } },
        { did: null, options: {} },
        { did: '', options: {} },
      ],
      ({ did, options }) => {
        const storage = memoryStorage();
        writeAcceptance(storage, did, options ?? undefined);
        return Object.fromEntries(storage.map);
      },
    )),

    ...(await each(
      'coversCurrent',
      [
        ...NOTES.map((entry) => ({ entry })),
        { entry: { version: 3 }, version: 3 },
        { entry: { version: 1 }, version: 2 },
      ],
      ({ entry, version }) => coversCurrent(entry, version),
    )),

    ...(await each(
      'needsReport',
      [
        ...NOTES.map((entry) => ({ entry })),
        { entry: { version: 1, recorded: false, tries: 0 }, version: 2 },
      ],
      ({ entry, version }) => needsReport(entry, version),
    )),

    ...(await each(
      'opensGate',
      NOTES.flatMap((entry) =>
        ['backend', 'browser', null].map((mode) => ({ entry, mode })),
      ),
      ({ entry, mode }) => opensGate(entry, { mode }),
    )),

    ...(await each(
      'startingStatus',
      NOTES.flatMap((entry) =>
        ['backend', 'browser'].flatMap((mode) =>
          [true, false].map((canAsk) => ({ entry, mode, canAsk })),
        ),
      ),
      ({ entry, mode, canAsk }) => startingStatus({ entry, mode, canAsk }),
    )),

    ...(await each(
      'statusFromAnswer',
      [
        { accepted: true, version: TERMS_VERSION },
        { accepted: false, version: TERMS_VERSION },
        { accepted: true, version: TERMS_VERSION + 1 },
        { accepted: 'true', version: TERMS_VERSION },
        { accepted: true, version: String(TERMS_VERSION) },
        { accepted: true, version: null },
        { accepted: true },
        null,
        {},
      ].map((answer) => ({ answer })),
      ({ answer }) => statusFromAnswer(answer),
    )),

    ...(await each(
      'acceptFailure',
      ERRORS.map((error) => ({ error })),
      ({ error }) =>
        acceptFailure(error && Object.assign(new Error(error.message), error)),
    )),

    ...(await each(
      'documentFor',
      [
        TERMS_PATH,
        PRIVACY_PATH,
        '/terms/',
        '/terms///',
        '/privacy/',
        '/',
        '',
        null,
        '//',
        '/terms/more',
        '/termsandconditions',
        '/settings/terms',
        '/privacy-policy',
        '/Terms',
        'terms',
      ].map((path) => ({ path })),
      ({ path }) => documentFor(path),
    )),

    ...(await each(
      'resolveDocumentLink',
      [
        'PRIVACY_POLICY.md',
        'TERMS_OF_SERVICE.md',
        'TERMS_OF_SERVICE.md#disputes',
        'PRIVACY_POLICY.md#your-choices-and-rights',
        'PRIVACY_POLICY.md#',
        'PRIVACY_POLICY.md#a b',
        'privacy_policy.md',
        'README.md',
        'README.md#x',
        '#contact',
        '#',
        '/privacy#contact',
        '/terms/#x',
        '/privacy',
        '/settings/account',
        'https://atproto.com',
        'HTTPS://ATPROTO.COM',
        'http://plain.example',
        'mailto:someone@example.com',
        'MAILTO:someone@example.com',
        'javascript:alert(1)',
        '',
        null,
      ].map((href) => ({ href })),
      ({ href }) => resolveDocumentLink(href),
    )),

    // fetchTermsStatus through the account's requester.
    ...(await each(
      'fetchTermsStatus',
      [
        {
          $id: 'agreed',
          answers: [
            json({
              success: true,
              version: TERMS_VERSION,
              accepted: true,
              acceptedAt: '2026-11-14T10:00:00Z',
            }),
          ],
        },
        {
          $id: 'not-a-plain-yes',
          answers: [json({ success: true, accepted: 'yes' })],
        },
        {
          $id: 'odd-fields',
          answers: [
            json({ success: true, accepted: true, acceptedAt: 0, version: 0 }),
          ],
        },
        {
          $id: 'number-at',
          answers: [
            json({
              success: true,
              accepted: false,
              acceptedAt: 42,
              version: '1',
            }),
          ],
        },
        {
          $id: 'unavailable',
          answers: [
            json({ success: false, code: 'UNAVAILABLE', error: 'down' }, 503),
          ],
        },
        { $id: 'a-page', answers: [{ status: 200, text: '<!doctype html>' }] },
        { $id: 'offline', answers: ['offline'] },
      ],
      ({ answers }) =>
        asRequester(answers, (requester) => fetchTermsStatus(requester)),
    )),

    ...(await each(
      'recordAcceptance',
      [
        {
          $id: 'recorded',
          answers: [
            json({
              success: true,
              acceptedAt: '2026-11-14T10:00:00Z',
              identity: 'session',
              created: true,
            }),
          ],
        },
        {
          $id: 'version-2',
          version: 2,
          answers: [
            json({ success: true, acceptedAt: 'x', identity: 'session' }),
          ],
        },
        { $id: 'empty', answers: [json(null)] },
        { $id: 'bare', answers: [json({})] },
        { $id: 'success-only', answers: [json({ success: true })] },
        {
          $id: 'claimed',
          answers: [json({ success: true, identity: 'claimed' })],
        },
        {
          $id: 'no-time',
          answers: [json({ success: true, identity: 'session' })],
        },
        {
          $id: 'number-time',
          answers: [
            json({ success: true, identity: 'session', acceptedAt: 42 }),
          ],
        },
        { $id: 'a-page', answers: [{ status: 200, text: '<!doctype html>' }] },
        {
          $id: 'mismatch',
          answers: [
            json(
              {
                success: false,
                code: 'TERMS_VERSION_MISMATCH',
                error: 'changed',
              },
              409,
            ),
          ],
        },
        { $id: 'offline', answers: ['offline'] },
      ],
      ({ answers, version }) =>
        asRequester(answers, (requester) =>
          recordAcceptance(
            requester,
            version === undefined ? undefined : { version },
          ),
        ),
    )),

    ...(await each(
      'reportAcceptance',
      [
        {
          $id: 'claimed',
          answers: [
            json({
              success: true,
              version: TERMS_VERSION,
              identity: 'claimed',
            }),
          ],
        },
        { $id: 'no-identity', answers: [json({ success: true })] },
        {
          $id: 'no-did',
          did: null,
          answers: [json({ success: true, identity: '' })],
        },
        {
          $id: 'version-3',
          version: 3,
          answers: [json({ success: true, identity: 'claimed' })],
        },
        {
          $id: 'mismatch',
          answers: [
            json(
              {
                success: false,
                code: 'TERMS_VERSION_MISMATCH',
                error: 'changed',
              },
              409,
            ),
          ],
        },
        {
          $id: 'refused',
          answers: [
            json(
              { success: false, code: 'SESSION_REQUIRED', error: 'no' },
              401,
            ),
          ],
        },
        { $id: 'a-page', answers: [{ status: 200, text: '<!doctype html>' }] },
        { $id: 'not-success', answers: [json({ hello: 'world' })] },
        { $id: 'offline', answers: ['offline'] },
        { $id: 'no-address', backendUrl: '', answers: [] },
        {
          $id: 'prefix',
          backendUrl: 'https://other.example/base/',
          answers: [json({ success: true })],
        },
      ],
      ({ answers, did = DID, version, backendUrl = SERVER }) =>
        recordFetch(inTurn(...answers), () =>
          reportAcceptance({
            did: did ?? undefined,
            version,
            backendUrl,
          }).catch((error) => ({ error: errorShape(error) })),
        ),
    )),
  ];
}
