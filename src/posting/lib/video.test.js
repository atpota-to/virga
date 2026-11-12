// Video job status: the shape of the service's answer, and the rule that only
// the service may supply a blob. A blob synthesized from the job id would
// publish a post whose video can never load, silently and permanently, so a
// completed job without a blob is an error.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getVideoUploadLimits,
  isUsableVideoBlob,
  normalizeJobStatus,
  pollVideoJobStatus,
  uploadVideo,
  validateVideoFile,
  VIDEO_MAX_SIZE_BYTES,
} from './video.js';

const BLOB = {
  $type: 'blob',
  ref: { $link: 'bafkreidsxjshc4mdpfla27q4hg5mr2w6dq24mwkzhzu3ykbow4ojvdu5nm' },
  mimeType: 'video/mp4',
  size: 7700058,
};

describe('normalizeJobStatus', () => {
  it('unwraps the lexicon shape getJobStatus returns', () => {
    const status = {
      jobId: 'j1',
      did: 'did:plc:abc',
      state: 'JOB_STATE_COMPLETED',
      blob: BLOB,
    };
    expect(normalizeJobStatus({ jobStatus: status })).toBe(status);
  });

  it('accepts the flat shape uploadVideo returns, including its already_exists form', () => {
    const flat = {
      jobId: 'j1',
      did: 'did:plc:abc',
      state: 'JOB_STATE_COMPLETED',
      error: 'already_exists',
    };
    expect(normalizeJobStatus(flat)).toBe(flat);
  });

  it('returns null for a body that carries no job status at all', () => {
    expect(
      normalizeJobStatus({ error: 'InvalidToken', message: 'bad token' }),
    ).toBeNull();
    expect(normalizeJobStatus(null)).toBeNull();
    expect(normalizeJobStatus('nope')).toBeNull();
  });
});

describe('isUsableVideoBlob', () => {
  it('accepts a blob the service actually sent', () => {
    expect(isUsableVideoBlob(BLOB)).toBe(true);
    expect(
      isUsableVideoBlob({ cid: 'bafkrei...', mimeType: 'video/mp4' }),
    ).toBe(true);
  });

  it('rejects a blob with nothing to resolve', () => {
    expect(isUsableVideoBlob({ $type: 'blob', ref: {}, size: 0 })).toBe(false);
    expect(isUsableVideoBlob({ $type: 'blob', ref: { $link: '' } })).toBe(
      false,
    );
    expect(isUsableVideoBlob(undefined)).toBe(false);
    expect(isUsableVideoBlob(null)).toBe(false);
  });
});

describe('pollVideoJobStatus', () => {
  const respond = (body, { ok = true, status = 200 } = {}) => ({
    ok,
    status,
    json: async () => body,
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Drive the poll loop forward: each tick is one POLL_INTERVAL. The outcome is
  // captured up front so a rejection that lands mid-tick has a handler waiting
  // (an unhandled rejection here is a test artifact, not a finding).
  const run = async (promise, ticks = 12) => {
    const settled = promise.then(
      (value) => () => value,
      (error) => () => {
        throw error;
      },
    );
    for (let i = 0; i < ticks; i++) await vi.advanceTimersByTimeAsync(1000);
    return (await settled)();
  };

  it('resolves with the job status once the service returns a blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respond({
          jobStatus: {
            jobId: 'j1',
            did: 'did:plc:abc',
            state: 'JOB_STATE_COMPLETED',
            blob: BLOB,
          },
        }),
      ),
    );
    const status = await run(pollVideoJobStatus('j1', 'token'));
    expect(status.blob).toEqual(BLOB);
  });

  it('polls through encoding, reporting progress, until the blob lands', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respond({ jobStatus: { jobId: 'j1', state: 'JOB_STATE_CREATED' } }),
      )
      .mockResolvedValueOnce(
        respond({
          jobStatus: { jobId: 'j1', state: 'JOB_STATE_ENCODING', progress: 40 },
        }),
      )
      .mockResolvedValue(
        respond({
          jobStatus: { jobId: 'j1', state: 'JOB_STATE_COMPLETED', blob: BLOB },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    const status = await run(pollVideoJobStatus('j1', 'token', onProgress));
    expect(status.blob).toEqual(BLOB);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'JOB_STATE_ENCODING', progress: 40 }),
    );
  });

  it('never invents a blob for an already-processed video that the service did not return', async () => {
    // Must reject rather than fabricate a blob from the job id.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respond({
          jobId: 'j1',
          did: 'did:plc:abc',
          state: 'JOB_STATE_COMPLETED',
          error: 'already_exists',
        }),
      ),
    );
    await expect(run(pollVideoJobStatus('j1', 'token'))).rejects.toThrow(
      /already processed/i,
    );
  });

  it('gives a completed job a few polls to produce its blob before failing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respond({ jobStatus: { jobId: 'j1', state: 'JOB_STATE_COMPLETED' } }),
      )
      .mockResolvedValueOnce(
        respond({ jobStatus: { jobId: 'j1', state: 'JOB_STATE_COMPLETED' } }),
      )
      .mockResolvedValue(
        respond({
          jobStatus: { jobId: 'j1', state: 'JOB_STATE_COMPLETED', blob: BLOB },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const status = await run(pollVideoJobStatus('j1', 'token'));
    expect(status.blob).toEqual(BLOB);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('fails a completed job that never produces a blob, rather than resolving empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respond({ jobStatus: { jobId: 'j1', state: 'JOB_STATE_COMPLETED' } }),
        ),
    );
    await expect(run(pollVideoJobStatus('j1', 'token'))).rejects.toThrow(
      /without returning a video/i,
    );
  });

  it('rejects a failed job with the service’s explanation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respond({
          jobStatus: {
            jobId: 'j1',
            state: 'JOB_STATE_FAILED',
            message: 'Video is too long',
          },
        }),
      ),
    );
    await expect(run(pollVideoJobStatus('j1', 'token'))).rejects.toThrow(
      'Video is too long',
    );
  });

  it('still takes the blob from an error response that carries one', async () => {
    // already_exists WITH the blob is the happy path for a re-uploaded video.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respond(
          {
            jobId: 'j1',
            state: 'JOB_STATE_COMPLETED',
            error: 'already_exists',
            blob: BLOB,
          },
          { ok: false, status: 409 },
        ),
      ),
    );
    const status = await run(pollVideoJobStatus('j1', 'token'));
    expect(status.blob).toEqual(BLOB);
  });

  it('tolerates a dropped request, then gives up after repeated failures', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(
        respond({
          jobStatus: { jobId: 'j1', state: 'JOB_STATE_COMPLETED', blob: BLOB },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(run(pollVideoJobStatus('j1', 'token'))).resolves.toMatchObject(
      { blob: BLOB },
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    await expect(run(pollVideoJobStatus('j1', 'token'))).rejects.toThrow(
      'network down',
    );
  });
});

describe('validateVideoFile', () => {
  const file = (size, type = 'video/mp4') => ({ size, type, name: 'clip.mp4' });
  it('takes the supported types up to the size limit', () => {
    expect(validateVideoFile(file(10))).toEqual({ ok: true });
    expect(validateVideoFile(file(VIDEO_MAX_SIZE_BYTES))).toEqual({ ok: true });
    expect(validateVideoFile(file(VIDEO_MAX_SIZE_BYTES + 1))).toMatchObject({
      ok: false,
      code: 'VIDEO_TOO_LARGE',
    });
    expect(validateVideoFile(file(10, 'video/x-matroska'))).toMatchObject({
      ok: false,
      code: 'VIDEO_TYPE',
    });
    expect(validateVideoFile(file(0))).toMatchObject({
      ok: false,
      code: 'VIDEO_EMPTY',
    });
    expect(validateVideoFile(null)).toMatchObject({
      ok: false,
      code: 'VIDEO_MISSING',
    });
  });
});

describe('uploadVideo', () => {
  const DID = 'did:plc:writer';
  const respond = (body, { status = 200 } = {}) => ({
    ok: status < 300,
    status,
    json: async () => body,
  });

  function setup({ limits = { canUpload: true }, upload, jobs = [] } = {}) {
    const getServiceAuth = vi.fn(async ({ aud, lxm }) => ({
      data: { token: `tok:${aud}:${lxm}` },
    }));
    const target = {
      did: DID,
      pdsUrl: 'https://pds.example.com',
      agent: { com: { atproto: { server: { getServiceAuth } } } },
    };
    const calls = [];
    const fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url, init });
      const { pathname } = new URL(url);
      if (pathname.endsWith('getUploadLimits')) return respond(limits);
      if (pathname.endsWith('uploadVideo'))
        return upload
          ? upload()
          : respond({ jobId: 'job1', state: 'JOB_STATE_CREATED' });
      if (pathname.endsWith('getJobStatus'))
        return respond(
          jobs.shift() ?? {
            jobStatus: {
              jobId: 'job1',
              state: 'JOB_STATE_COMPLETED',
              blob: BLOB,
            },
          },
        );
      throw new Error(`unexpected ${url}`);
    });
    return { target, fetch, getServiceAuth, calls };
  }

  const clip = () =>
    new File([new Uint8Array(8)], 'my holiday.mp4', { type: 'video/mp4' });

  it('mints each token as the write account, with the right audience and method', async () => {
    const { target, fetch, getServiceAuth, calls } = setup();
    const now = () => Date.UTC(2026, 10, 12);
    const result = await uploadVideo(target, clip(), {
      fetch,
      now,
      poll: { pollIntervalMs: 0 },
    });
    expect(result).toEqual({ blob: BLOB, jobId: 'job1' });

    expect(getServiceAuth.mock.calls.map((c) => c[0])).toEqual([
      { aud: 'did:web:video.bsky.app', lxm: 'app.bsky.video.getUploadLimits' },
      {
        aud: 'did:web:pds.example.com',
        lxm: 'com.atproto.repo.uploadBlob',
        exp: Date.UTC(2026, 10, 12) / 1000 + 1800,
      },
      { aud: 'did:web:video.bsky.app', lxm: 'app.bsky.video.getJobStatus' },
    ]);

    const post = calls.find((c) => c.url.includes('uploadVideo'));
    const url = new URL(post.url);
    expect(url.origin).toBe('https://video.bsky.app');
    expect(url.searchParams.get('did')).toBe(DID);
    // The file's own name never leaves the device.
    expect(url.searchParams.get('name')).toMatch(/^[a-z0-9]{12}\.mp4$/);
    expect(post.init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization:
          'Bearer tok:did:web:pds.example.com:com.atproto.repo.uploadBlob',
        'Content-Type': 'video/mp4',
      },
    });
    const status = calls.find((c) => c.url.includes('getJobStatus'));
    expect(status.init.headers.Authorization).toBe(
      'Bearer tok:did:web:video.bsky.app:app.bsky.video.getJobStatus',
    );
  });

  it('refuses before uploading when the account can’t upload', async () => {
    const { target, fetch, calls } = setup({
      limits: {
        canUpload: false,
        message: 'User has exceeded daily upload bytes limit',
      },
    });
    await expect(uploadVideo(target, clip(), { fetch })).rejects.toMatchObject({
      code: 'VIDEO_LIMIT',
      message: expect.stringMatching(/today’s video upload limit/),
    });
    expect(calls.some((c) => c.url.includes('uploadVideo'))).toBe(false);
  });

  it('takes the earlier job for a video sent twice', async () => {
    const { target, fetch, calls } = setup({
      upload: () =>
        respond(
          {
            jobId: 'job1',
            state: 'JOB_STATE_COMPLETED',
            error: 'already_exists',
            blob: BLOB,
          },
          { status: 409 },
        ),
    });
    await expect(uploadVideo(target, clip(), { fetch })).resolves.toEqual({
      blob: BLOB,
      jobId: 'job1',
    });
    expect(calls.some((c) => c.url.includes('getJobStatus'))).toBe(false);
  });

  it('reports the phases it goes through', async () => {
    const { target, fetch } = setup({
      jobs: [
        {
          jobStatus: {
            jobId: 'job1',
            state: 'JOB_STATE_ENCODING',
            progress: 50,
          },
        },
      ],
    });
    const phases = [];
    await uploadVideo(target, clip(), {
      fetch,
      onProgress: (p) => phases.push(p),
      poll: { pollIntervalMs: 0 },
    });
    expect(phases).toEqual([
      { phase: 'checking' },
      { phase: 'uploading' },
      { phase: 'processing', progress: 0 },
      { phase: 'processing', progress: 50 },
    ]);
  });

  it('turns a refusal into a sentence, and refuses bad files without a request', async () => {
    const { target, fetch } = setup({
      upload: () =>
        respond({ error: 'InvalidRequest', message: 'nope' }, { status: 400 }),
    });
    await expect(uploadVideo(target, clip(), { fetch })).rejects.toMatchObject({
      code: 'VIDEO_REFUSED',
      status: 400,
    });

    const empty = setup();
    await expect(
      uploadVideo(
        empty.target,
        new File([], 'x.mkv', { type: 'video/x-matroska' }),
        { fetch: empty.fetch },
      ),
    ).rejects.toMatchObject({ code: 'VIDEO_TYPE' });
    expect(empty.fetch).not.toHaveBeenCalled();
  });

  it('needs the account’s server address for the upload token', async () => {
    const { target, fetch } = setup();
    target.pdsUrl = undefined;
    await expect(uploadVideo(target, clip(), { fetch })).rejects.toMatchObject({
      code: 'VIDEO_NO_PDS',
    });
  });

  it('stops when cancelled', async () => {
    const { target, fetch } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadVideo(target, clip(), { fetch, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reads the limits on their own', async () => {
    const { target, fetch } = setup({
      limits: { canUpload: true, remainingDailyVideos: 3 },
    });
    await expect(getVideoUploadLimits(target, { fetch })).resolves.toEqual({
      canUpload: true,
      remainingDailyVideos: 3,
    });
  });
});
