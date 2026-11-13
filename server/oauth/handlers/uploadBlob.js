// POST /api/oauth/upload-blob?encoding=<mime>: upload a blob as the account.
//
// The body is the raw bytes (application/octet-stream); the blob's real type
// is in `encoding`. Vercel caps a request body at 4.5 MB, which images clear
// once the app has compressed them; videos go to the video service directly.
//
//   200 { success: true, data: { blob } }

import { Agent } from '@atproto/api';
import { bearerToken, methodGuard, readRaw, sendJson } from '../../http.js';
import { envInt } from '../../env.js';
import { getOAuthClient } from '../client.js';
import { sendUnavailable, unavailableReason } from '../config.js';
import { getStorage } from '../storage.js';
import { extractBlobPayload } from '../blobPayload.js';
import { isInvalidTokenError, restoreWithRetry } from '../restore.js';
import { isRetriableConnectError } from '../xrpcErrors.js';
import { queryParam } from '../respond.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The request body as Vercel left it, without tripping its parse-on-read getter. */
function presetBody(req) {
  try {
    return req.body;
  } catch {
    return undefined;
  }
}

async function readPayload(req) {
  const body = presetBody(req);
  // A JSON envelope ({ blob: <base64>, encoding }) arrives already parsed.
  if (
    body &&
    typeof body === 'object' &&
    !Buffer.isBuffer(body) &&
    !(body instanceof Uint8Array)
  ) {
    return extractBlobPayload(body);
  }
  return extractBlobPayload(await readRaw(req), queryParam(req, 'encoding'));
}

function statusFor(error) {
  const status = error && error.status;
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 500;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return undefined;

  try {
    const token = bearerToken(req);
    if (!token)
      return sendJson(res, 401, {
        success: false,
        error: 'Missing or invalid authorization header',
      });

    const unavailable = unavailableReason();
    if (unavailable) return sendUnavailable(res, unavailable);

    // A transient failure is kept apart from a dead token, so a store blip is
    // a retry rather than a sign-in prompt.
    const validation =
      await getStorage().frontendSessionStore.validateWithDetails(token);
    if (!validation.userDid) {
      return validation.error
        ? sendJson(res, 503, {
            success: false,
            error: 'Session validation temporarily unavailable, please retry',
            code: 'VALIDATION_TRANSIENT_ERROR',
          })
        : sendJson(res, 401, {
            success: false,
            error: 'Invalid or expired session',
            code: 'FRONTEND_SESSION_INVALID',
          });
    }
    const userDid = validation.userDid;

    const payload = await readPayload(req);
    if (payload.error)
      return sendJson(res, 400, { success: false, error: payload.error });
    const { uint8Array, encoding } = payload;

    const oauthClient = getOAuthClient();
    let oauthSession = await restoreWithRetry(oauthClient, userDid, {
      tag: 'oauth/upload-blob',
    });
    if (!oauthSession) {
      return sendJson(res, 401, {
        success: false,
        error: 'OAuth session not found or expired. Please re-authenticate.',
        code: 'OAUTH_SESSION_MISSING',
      });
    }

    // Each forward to the PDS is bounded: one hung connection would otherwise
    // burn the whole invocation, and the browser would upload the bytes again
    // from scratch. Retries reuse the bytes already here, and blob uploads are
    // content-addressed, so none of them can duplicate anything:
    //   forward timeout  abort and retry once, then 504
    //   "Invalid token"  a refresh race: restore fresh and retry once, then 401
    //   connect failure  the request never left; retry once after 500 ms
    const forwardTimeoutMs = envInt(
      process.env,
      'UPLOAD_FORWARD_TIMEOUT_MS',
      12000,
    );
    let tokenRetries = 0;
    let connectRetries = 0;
    let timeoutRetries = 0;
    let result = null;
    for (;;) {
      const controller = new AbortController();
      let timer = null;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            Object.assign(new Error('PDS blob upload timed out'), {
              forwardTimedOut: true,
            }),
          );
        }, forwardTimeoutMs);
      });
      try {
        const upload = new Agent(oauthSession).uploadBlob(uint8Array, {
          encoding,
          signal: controller.signal,
        });
        // The losing side of the race settles in the background; keep its rejection handled.
        upload.catch(() => {});
        result = await Promise.race([upload, deadline]);
        break;
      } catch (uploadError) {
        if (uploadError?.forwardTimedOut || controller.signal.aborted) {
          if (timeoutRetries < 1) {
            timeoutRetries++;
            console.warn(
              `[oauth/upload-blob] the PDS took over ${forwardTimeoutMs} ms; retrying once`,
            );
            continue;
          }
          return sendJson(res, 504, {
            success: false,
            error:
              'The PDS took too long to accept the upload. Please try again.',
            code: 'PDS_UPLOAD_TIMEOUT',
          });
        }

        const invalidToken = isInvalidTokenError(uploadError);
        if (invalidToken && tokenRetries < 1) {
          tokenRetries++;
          console.warn(
            '[oauth/upload-blob] "Invalid token"; restoring the session again',
          );
          await sleep(1200);
          try {
            const fresh = await oauthClient.restoreSession(userDid, {
              fresh: true,
            });
            if (fresh) {
              oauthSession = fresh;
              continue;
            }
          } catch (restoreError) {
            console.warn(
              `[oauth/upload-blob] fresh restore failed: ${restoreError?.message || restoreError}`,
            );
          }
        }
        if (invalidToken) {
          oauthClient.evictSession(userDid);
          return sendJson(res, 401, {
            success: false,
            error:
              'OAuth session expired. Automatic re-authentication required.',
            code: 'OAUTH_SESSION_MISSING',
          });
        }

        if (isRetriableConnectError(uploadError) && connectRetries < 1) {
          connectRetries++;
          console.warn('[oauth/upload-blob] connect failure; retrying once');
          await sleep(500);
          continue;
        }
        throw uploadError;
      } finally {
        // Settled either way: the deadline must never fire later.
        clearTimeout(timer);
      }
    }

    return sendJson(res, 200, {
      success: true,
      data: { blob: result.data.blob },
    });
  } catch (error) {
    console.error(`[oauth/upload-blob] ${error?.message || error}`);
    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('expired') ||
      message.includes('invalid') ||
      message.includes('unauthorized')
    ) {
      return sendJson(res, 401, {
        success: false,
        error: 'Session expired. Please re-authenticate.',
        code: 'SESSION_EXPIRED',
      });
    }
    return sendJson(res, statusFor(error), {
      success: false,
      error: error?.message || 'Internal error',
    });
  }
}
