// src/posting/lib/video.js: the checks a video goes through, the service's
// answers read, and the upload through Bluesky's video service as recorded
// exchanges: the upload limits, the service-auth tokens the write account
// mints (recorded beside the requests), the upload, and the job's poll with
// its waits. Swift: VirgaPosting/Lib/Video.swift, replayed through
// MockTransport (RecordedFetch) with a scripted agent.

import {
  VIDEO_SERVICE_HOST,
  VIDEO_SERVICE_URL,
  VIDEO_SERVICE_DID,
  VIDEO_MAX_SIZE_BYTES,
  VIDEO_MAX_SIZE_LABEL,
  VIDEO_MAX_DURATION_SECONDS,
  VIDEO_SUPPORTED_MIME_TYPES,
  VIDEO_FILE_INPUT_ACCEPT,
  VIDEO_ALT_MAX_GRAPHEMES,
  VIDEO_UPLOAD_TOKEN_TTL_SECONDS,
  VIDEO_POLL_MAX_TIME_MS,
  VIDEO_POLL_INTERVAL_MS,
  VIDEO_POLL_FAILURE_INTERVAL_MS,
  VIDEO_POLL_MAX_CONSECUTIVE_FAILURES,
  VIDEO_POLL_MAX_COMPLETED_WITHOUT_BLOB,
  videoServiceUrl,
  formatVideoSize,
  validateVideoFile,
  normalizeJobStatus,
  isUsableVideoBlob,
  videoLimitMessage,
  getVideoUploadLimits,
  pollVideoJobStatus,
  uploadVideo,
} from '../../../src/posting/lib/video.js';
import { each, value } from './_helpers.js';
import { recordFetch, json, inTurn } from './_fetch.js';
import { file, withFiles } from './_composer.js';

export const sources = ['src/posting/lib/video.js'];

const BLOB = {
  $type: 'blob',
  ref: { $link: 'bafkreidsxjshc4mdpfla27q4hg5mr2w6dq24mwkzhzu3ykbow4ojvdu5nm' },
  mimeType: 'video/mp4',
  size: 7700058,
};
const ME = 'did:plc:mira';

/** The write account's agent: mints the scripted tokens, recording each ask. */
function agentFor(tokens, calls) {
  let n = 0;
  return {
    com: {
      atproto: {
        server: {
          getServiceAuth: async (params) => {
            calls.push(params);
            const token = tokens[Math.min(n, tokens.length - 1)];
            n += 1;
            if (token === 'throw') throw new Error('PDS said no');
            return { data: token === null ? {} : { token } };
          },
        },
      },
    },
  };
}

/** crypto.getRandomValues filled the same way every run (the upload's name). */
async function withFixedRandom(fn) {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
        return bytes;
      },
    },
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'crypto', real);
  }
}

// The upload's body is the File itself: recorded as its bytes (all zeros).
function withBodies(out, size) {
  for (const exchange of out.exchanges || []) {
    if (exchange.request.body?.$other)
      exchange.request.body = {
        $bytes: Buffer.from(new Uint8Array(size)).toString('base64'),
      };
  }
  return out;
}

const status = (state, extra = {}) => ({
  jobStatus: { jobId: 'j1', did: ME, state, ...extra },
});

export default async function cases() {
  const all = [
    value('videoConstants', {
      VIDEO_SERVICE_HOST,
      VIDEO_SERVICE_URL,
      VIDEO_SERVICE_DID,
      VIDEO_MAX_SIZE_BYTES,
      VIDEO_MAX_SIZE_LABEL,
      VIDEO_MAX_DURATION_SECONDS,
      VIDEO_SUPPORTED_MIME_TYPES,
      VIDEO_FILE_INPUT_ACCEPT,
      VIDEO_ALT_MAX_GRAPHEMES,
      VIDEO_UPLOAD_TOKEN_TTL_SECONDS,
      VIDEO_POLL_MAX_TIME_MS,
      VIDEO_POLL_INTERVAL_MS,
      VIDEO_POLL_FAILURE_INTERVAL_MS,
      VIDEO_POLL_MAX_CONSECUTIVE_FAILURES,
      VIDEO_POLL_MAX_COMPLETED_WITHOUT_BLOB,
    }),
  ];
  all.push(
    ...(
      await each(
        'videoServiceUrl',
        [
          { route: '/xrpc/app.bsky.video.getUploadLimits' },
          {
            route: '/xrpc/app.bsky.video.getJobStatus',
            params: [['jobId', 'j 1/ü']],
          },
          {
            route: '/xrpc/x',
            params: [
              ['a', null],
              ['b', 5],
              ['c', true],
              ['a', 'again'],
            ],
          },
          {
            route: '/xrpc/x',
            params: [
              ['did', ME],
              ['name', 'abc.mp4'],
            ],
          },
          { route: 'no-slash', params: [] },
        ],
        (i) =>
          videoServiceUrl(
            i.route,
            i.params ? Object.fromEntries(i.params) : undefined,
          ),
      )
    ).map((c) => ({
      ...c,
      // The params as the object the web walks: its entries, in order.
      input: {
        ...c.input,
        entries: Object.entries(Object.fromEntries(c.input.params || [])),
      },
    })),
    ...(await each(
      'formatVideoSize',
      [
        0,
        1,
        1234567,
        300_000_000,
        49_950_000,
        -5,
        'x',
        null,
        '2500000',
        Infinity,
      ].map((bytes) => ({ bytes })),
      (i) => formatVideoSize(i.bytes),
    )),
    ...(await each(
      'validateVideoFile',
      [
        { file: file('a.mp4', 'video/mp4', 1000) },
        { file: file('a.mov', 'video/quicktime', VIDEO_MAX_SIZE_BYTES) },
        { file: file('a.mov', 'video/quicktime', VIDEO_MAX_SIZE_BYTES + 1) },
        { file: file('a.mkv', 'video/x-matroska', 10) },
        { file: file('a.mp4', 'video/mp4', 0) },
        { file: null },
        { file: { type: 'video/mp4', size: '10' } },
        { file: { type: 'video/mp4', size: -1 } },
      ],
      (i) => validateVideoFile(withFiles(i.file)),
    )),
    ...(await each(
      'normalizeJobStatus',
      [
        {
          result: {
            jobStatus: {
              jobId: 'j1',
              state: 'JOB_STATE_COMPLETED',
              blob: BLOB,
            },
          },
        },
        {
          result: {
            jobId: 'j1',
            state: 'JOB_STATE_COMPLETED',
            error: 'already_exists',
          },
        },
        { result: { error: 'InvalidToken', message: 'bad token' } },
        { result: { jobStatus: 'x', state: 'S' } },
        { result: { jobStatus: { other: 1 } } },
        // An array is an object to typeof: it stands in for the status.
        { result: { jobStatus: [], jobId: 'j1', state: 'S' } },
        { result: { jobStatus: [{ jobId: 'j1' }], blob: BLOB } },
        { result: { jobStatus: null, jobId: 'j1' } },
        { result: null },
        { result: 'nope' },
        { result: [] },
      ],
      (i) => normalizeJobStatus(i.result),
    )),
    ...(await each(
      'isUsableVideoBlob',
      [
        { blob: BLOB },
        { blob: { cid: 'bafkrei', mimeType: 'video/mp4' } },
        { blob: { ref: { $link: '' } } },
        { blob: { cid: '' } },
        { blob: { ref: 'bafy' } },
        { blob: 'bafy' },
        { blob: null },
        { blob: [] },
      ],
      (i) => isUsableVideoBlob(i.blob),
    )),
    ...(await each(
      'videoLimitMessage',
      [
        'User is not allowed to upload videos',
        'Uploading is disabled at the moment',
        "Failed to get user's upload stats",
        'User has exceeded daily upload bytes limit',
        'User has exceeded daily upload videos limit',
        'Account is not old enough to upload videos',
        'Confirm your email address to upload videos',
        'Something new',
        '',
        null,
        5,
      ].map((message) => ({ message })),
      // As the sentence an error carries (a message that isn't a string
      // comes back as it is, and becomes the error's text).
      (i) => String(videoLimitMessage(i.message)),
    )),
  );

  // getVideoUploadLimits: the token, then the service's answer.
  const LIMITS = [
    [
      'ok',
      ['tok-limits'],
      json({
        canUpload: true,
        remainingDailyVideos: 3,
        remainingDailyBytes: 9e9,
      }),
    ],
    [
      'refused',
      ['tok-limits'],
      json({
        canUpload: false,
        message: 'User has exceeded daily upload videos limit',
      }),
    ],
    ['server-error', ['tok-limits'], json({ error: 'InternalError' }, 500)],
    ['not-json', ['tok-limits'], { status: 200, text: 'oops' }],
    ['null-body', ['tok-limits'], json(null)],
    ['no-token', [null], json({ canUpload: true })],
    ['mint-throws', ['throw'], json({ canUpload: true })],
    ['offline', ['tok-limits'], 'offline'],
  ];
  for (const [id, tokens, answer] of LIMITS) {
    const calls = [];
    const out = await recordFetch(inTurn(answer), () =>
      getVideoUploadLimits({ did: ME, agent: agentFor(tokens, calls) }),
    );
    all.push({
      id,
      fn: 'getVideoUploadLimits',
      input: { tokens },
      output: { ...out, auth: calls },
    });
  }

  // pollVideoJobStatus: each answer in turn, the waits between them.
  const POLLS = [
    [
      'ready-at-once',
      [json(status('JOB_STATE_COMPLETED', { blob: BLOB }))],
      {},
    ],
    [
      'progress-then-ready',
      [
        json(
          status('JOB_STATE_ENCODING', { progress: 40, message: 'encoding' }),
        ),
        json(status('JOB_STATE_ENCODING')),
        json(status('JOB_STATE_COMPLETED', { blob: BLOB })),
      ],
      {},
    ],
    [
      'failed',
      [
        json(
          status('JOB_STATE_FAILED', { error: 'bad_codec', failureCode: 7 }),
        ),
      ],
      {},
    ],
    [
      'failed-with-message',
      [json(status('JOB_STATE_FAILED', { message: 'Too long', error: 'x' }))],
      {},
    ],
    ['failed-bare', [json(status('JOB_STATE_FAILED'))], {}],
    [
      'already-exists-blob',
      [
        json(
          {
            jobStatus: {
              jobId: 'j1',
              state: 'JOB_STATE_COMPLETED',
              error: 'already_exists',
              blob: BLOB,
            },
          },
          409,
        ),
      ],
      {},
    ],
    [
      'completed-no-blob',
      Array.from({ length: 4 }, () => json(status('JOB_STATE_COMPLETED'))),
      { maxCompletedWithoutBlobPolls: 2 },
    ],
    [
      'already-exists-no-blob',
      Array.from({ length: 4 }, () =>
        json(status('JOB_STATE_COMPLETED', { error: 'already_exists' })),
      ),
      { maxCompletedWithoutBlobPolls: 1 },
    ],
    // A JSON answer resets the failure count before its status is looked at
    // (a web bug: a service answering 500 with JSON is retried until the
    // 30-minute limit), so these end with a good answer.
    [
      'server-errors',
      [
        json({}, 500),
        json({}, 502),
        json({ error: 'x' }, 503),
        json(status('JOB_STATE_COMPLETED', { blob: BLOB })),
      ],
      {},
    ],
    [
      'malformed',
      [
        json({ nope: true }),
        json({ nope: true }),
        json(status('JOB_STATE_COMPLETED', { blob: BLOB })),
      ],
      {},
    ],
    [
      'not-json',
      [
        { status: 200, text: 'x' },
        { status: 200, text: 'x' },
        { status: 200, text: 'x' },
      ],
      {},
    ],
    [
      'not-json-then-error',
      [
        { status: 500, text: 'x' },
        { status: 200, text: 'x' },
        { status: 200, text: 'x' },
      ],
      { maxConsecutiveFailures: 2 },
    ],
    [
      'recovers',
      [
        json({}, 500),
        'offline',
        json(status('JOB_STATE_COMPLETED', { blob: BLOB })),
      ],
      { failureIntervalMs: 5000 },
    ],
    ['offline', ['offline', 'offline', 'offline'], { pollIntervalMs: 250 }],
    [
      'out-of-time',
      [json(status('JOB_STATE_ENCODING'))],
      { maxPollTimeMs: -1 },
    ],
    [
      'legacy-blob',
      [
        json(
          status('JOB_STATE_COMPLETED', {
            blob: { cid: 'bafkreilegacy', mimeType: 'video/mp4' },
          }),
        ),
      ],
      { maxConsecutiveFailures: 5 },
    ],
  ];
  for (const [id, answers, options] of POLLS) {
    const progress = [];
    const out = await recordFetch(inTurn(...answers), () =>
      pollVideoJobStatus('j 1', 'tok-job', (s) => progress.push(s), {
        pollIntervalMs: 10,
        ...options,
      }),
    );
    all.push({
      id,
      fn: 'pollVideoJobStatus',
      input: { options },
      output: { ...out, progress },
    });
  }

  // uploadVideo, end to end.
  const LIMITS_OK = json({ canUpload: true });
  const JOB = json({ jobId: 'j9', did: ME, state: 'JOB_STATE_CREATED' });
  const READY = json(
    status('JOB_STATE_COMPLETED', { jobId: 'j9', blob: BLOB }),
  );
  const UPLOADS = [
    [
      'processes',
      file('clip.mov', 'video/quicktime', 12),
      [
        LIMITS_OK,
        JOB,
        json(status('JOB_STATE_ENCODING', { progress: 0.5 })),
        READY,
      ],
      ['t1', 't2', 't3'],
    ],
    [
      'blob-at-once',
      file('clip.mp4', 'video/mp4', 12),
      [LIMITS_OK, json({ jobId: 'j9', blob: BLOB })],
      ['t1', 't2'],
    ],
    [
      'already-sent',
      file('clip.webm', 'video/webm', 12),
      [
        LIMITS_OK,
        json(
          {
            jobId: 'j9',
            state: 'JOB_STATE_COMPLETED',
            error: 'already_exists',
            blob: BLOB,
          },
          409,
        ),
      ],
      ['t1', 't2'],
    ],
    [
      'already-sent-no-blob',
      file('clip.mp4', 'video/mp4', 12),
      [
        LIMITS_OK,
        json(
          {
            jobId: 'j9',
            state: 'JOB_STATE_COMPLETED',
            error: 'already_exists',
          },
          409,
        ),
        READY,
      ],
      ['t1', 't2', 't3'],
    ],
    [
      'legacy',
      file('clip.mpeg', 'video/mpeg', 12),
      [LIMITS_OK, json({ jobId: 'j9', blob: { cid: 'bafkreilegacy' } })],
      ['t1', 't2'],
    ],
    [
      'legacy-with-size',
      file('clip.mp4', 'video/mp4', 12),
      [
        LIMITS_OK,
        json({
          blob: { cid: 'bafkreilegacy', mimeType: 'video/quicktime', size: 99 },
        }),
      ],
      ['t1', 't2'],
    ],
    [
      'refused',
      file('clip.mp4', 'video/mp4', 12),
      [
        LIMITS_OK,
        json(
          {
            error: 'Forbidden',
            message: 'User is not allowed to upload videos',
          },
          403,
        ),
      ],
      ['t1', 't2'],
    ],
    [
      'refused-bare',
      file('clip.mp4', 'video/mp4', 12),
      [LIMITS_OK, { status: 413, text: 'too big' }],
      ['t1', 't2'],
    ],
    [
      'no-job',
      file('clip.mp4', 'video/mp4', 12),
      [LIMITS_OK, json({ state: 'JOB_STATE_CREATED' })],
      ['t1', 't2'],
    ],
    [
      'upload-offline',
      file('clip.mp4', 'video/mp4', 12),
      [LIMITS_OK, 'offline'],
      ['t1', 't2'],
    ],
    [
      'limit',
      file('clip.mp4', 'video/mp4', 12),
      [
        json({
          canUpload: false,
          message: 'Confirm your email address to upload videos',
        }),
      ],
      ['t1'],
    ],
    [
      'limit-bare',
      file('clip.mp4', 'video/mp4', 12),
      [json({ canUpload: false })],
      ['t1'],
    ],
    [
      'no-upload-token',
      file('clip.mp4', 'video/mp4', 12),
      [LIMITS_OK],
      ['t1', null],
    ],
    ['not-a-video', file('a.png', 'image/png', 12), [], ['t1']],
    ['empty', file('a.mp4', 'video/mp4', 0), [], ['t1']],
  ];
  for (const [id, f, answers, tokens] of UPLOADS) {
    for (const pdsUrl of id === 'processes'
      ? ['https://pds.example.com', 'not a url']
      : ['https://pds.example.com']) {
      const calls = [];
      const progress = [];
      const out = await withFixedRandom(() =>
        recordFetch(inTurn(...(answers.length ? answers : [json({})])), () =>
          uploadVideo(
            { did: ME, agent: agentFor(tokens, calls), pdsUrl },
            withFiles(f),
            {
              onProgress: (p) => progress.push(p),
              poll: { pollIntervalMs: 10 },
            },
          ),
        ),
      );
      all.push({
        id: pdsUrl === 'not a url' ? `${id}/no-pds` : id,
        fn: 'uploadVideo',
        input: { file: f, tokens, pdsUrl },
        output: { ...withBodies(out, f.size), auth: calls, progress },
      });
    }
  }
  return all;
}
