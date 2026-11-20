// Whether an account's sign-in still holds (sessionHealth.js): the lite
// check's answers, the status each gives an account, the three-round
// confirmation, the per-account checker with its time-to-live and shared
// probe, and the breaker on automatic sign-ins. Swift:
// VirgaSession/Session/SessionHealth.swift.
//
// The checker's cases are scripts: probes answer from a list in turn, the
// clock is a number the script moves, and every probe, wait and settled
// answer is recorded in order.

import {
  CONFIRM_GAP_MS,
  CONFIRM_ROUNDS,
  LITE_CHECK_TIMEOUT_MS,
  LITE_CHECK_TTL_MS,
  REAUTH_ATTEMPTS_KEY,
  REAUTH_LOOP_MAX,
  REAUTH_LOOP_WINDOW_MS,
  SESSION_CHECK_STATUS,
  clearReauthAttempts,
  confirmSessionDead,
  createSessionChecker,
  interpretLiteSessionResponse,
  reauthLooping,
  recordReauthAttempt,
  statusFromCheck,
} from '../../../src/session/sessionHealth.js';
import { each, value } from './_helpers.js';

export const sources = ['src/session/sessionHealth.js'];

const { VALID, EXPIRED, UNKNOWN } = SESSION_CHECK_STATUS;
const dead = { status: EXPIRED, definitive: true };
const alive = { status: VALID, definitive: false };
const unsure = { status: UNKNOWN, definitive: false };
const lost = { status: EXPIRED, definitive: false };

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

/** A probe answering from `answers` in turn ('throw' throws), recording each call. */
function scripted(answers, log) {
  let n = 0;
  return async (did) => {
    const answer = answers[Math.min(n, answers.length - 1)];
    n += 1;
    log.push(['probe', did ?? null]);
    if (answer === 'throw') throw new Error('offline');
    return answer;
  };
}

export default async function cases() {
  return [
    value('constants', {
      LITE_CHECK_TTL_MS,
      LITE_CHECK_TIMEOUT_MS,
      CONFIRM_ROUNDS,
      CONFIRM_GAP_MS,
      REAUTH_LOOP_MAX,
      REAUTH_LOOP_WINDOW_MS,
      REAUTH_ATTEMPTS_KEY,
      SESSION_CHECK_STATUS,
    }),

    ...(await each(
      'interpretLiteSessionResponse',
      [
        {
          ok: true,
          status: 200,
          data: {
            success: true,
            authenticated: true,
            lite: true,
            oauthSessionMissing: false,
          },
        },
        {
          ok: false,
          status: 401,
          data: { success: false, code: 'FRONTEND_SESSION_INVALID' },
        },
        { ok: false, status: 403, data: { code: 'FRONTEND_SESSION_INVALID' } },
        { ok: false, status: 401, data: null },
        { ok: false, status: 403, data: null },
        { ok: false, status: 401, data: { code: 'OAUTH_SESSION_MISSING' } },
        { ok: false, status: 401, data: { code: 'frontend_session_invalid' } },
        {
          ok: true,
          status: 200,
          data: {
            success: true,
            authenticated: true,
            oauthSessionMissing: true,
          },
        },
        {
          ok: true,
          status: 200,
          data: { success: true, authenticated: true, oauthSessionMissing: 1 },
        },
        {
          ok: false,
          status: 503,
          data: { code: 'VALIDATION_TRANSIENT_ERROR' },
        },
        { ok: false, status: 500, data: null },
        { ok: false, status: 502, data: null },
        { ok: false, status: 0, data: null },
        { ok: true, status: 200, data: null },
        {
          ok: true,
          status: 200,
          data: { success: true, authenticated: false },
        },
        { ok: true, status: 200, data: { success: 1, authenticated: 'yes' } },
        { ok: true, status: 204, data: { success: true } },
      ],
      (input) => interpretLiteSessionResponse(input),
    )),

    ...(await each(
      'statusFromCheck',
      [
        dead,
        alive,
        unsure,
        lost,
        { status: VALID, definitive: true },
        { status: UNKNOWN, definitive: true },
      ],
      (input) => statusFromCheck(input),
    )),

    ...(await each(
      'confirmSessionDead',
      [
        { $id: 'dead', answers: [dead] },
        { $id: 'healed', answers: [dead, alive] },
        { $id: 'unsure-second', answers: [dead, unsure] },
        { $id: 'not-definitive', answers: [lost] },
        { $id: 'throws', answers: ['throw'] },
        { $id: 'throws-later', answers: [dead, dead, 'throw'] },
        { $id: 'one-round', answers: [dead], rounds: 1 },
        { $id: 'no-rounds', answers: [alive], rounds: 0 },
        { $id: 'five-rounds', answers: [dead], rounds: 5, gapMs: 10 },
        { $id: 'null-answer', answers: [null] },
      ],
      async ({ answers, rounds, gapMs }) => {
        const log = [];
        const verdict = await confirmSessionDead(scripted(answers, log), {
          rounds,
          gapMs,
          sleep: async (ms) => log.push(['sleep', ms]),
        });
        return { verdict, log };
      },
    )),

    // A checker run through a script of steps: `check` (with `force`),
    // `advance` the clock, `forget`, `peek`.
    ...(await each(
      'createSessionChecker',
      [
        {
          $id: 'ttl-and-sharing',
          answers: [alive],
          steps: [
            { check: 'did:plc:a', together: 2 },
            { advance: LITE_CHECK_TTL_MS - 1 },
            { check: 'did:plc:a' },
            { advance: 2 },
            { check: 'did:plc:a' },
            { check: 'did:plc:a', force: true },
            { check: 'did:plc:b' },
          ],
        },
        {
          $id: 'confirmed-dead',
          answers: [dead],
          steps: [{ check: 'did:plc:a' }],
        },
        {
          $id: 'did-not-hold',
          answers: [dead, unsure],
          steps: [{ check: 'did:plc:a' }],
        },
        {
          $id: 'healed',
          answers: [dead, alive],
          steps: [{ check: 'did:plc:a' }],
        },
        { $id: 'throws', answers: ['throw'], steps: [{ check: 'did:plc:a' }] },
        {
          $id: 'forget-and-peek',
          answers: [alive, lost],
          steps: [
            { peek: 'did:plc:a' },
            { check: 'did:plc:a' },
            { peek: 'did:plc:a' },
            { forget: 'did:plc:a' },
            { peek: 'did:plc:a' },
            { check: 'did:plc:a' },
            { peek: 'did:plc:a' },
          ],
        },
        {
          $id: 'own-ttl-and-rounds',
          answers: [dead],
          ttlMs: 10,
          rounds: 2,
          gapMs: 100,
          steps: [
            { check: 'did:plc:a' },
            { advance: 9 },
            { check: 'did:plc:a' },
            { advance: 1 },
            { check: 'did:plc:a' },
          ],
        },
      ],
      async ({ answers, steps, ttlMs, rounds, gapMs }) => {
        const log = [];
        let t = 1_000;
        const checker = createSessionChecker({
          probe: scripted(answers, log),
          now: () => t,
          ttlMs,
          rounds,
          gapMs,
          sleep: async (ms) => log.push(['sleep', ms]),
          onResult: (did, result) => log.push(['result', did, result]),
        });
        for (const s of steps) {
          if (s.advance) t += s.advance;
          else if (s.forget) checker.forget(s.forget);
          else if (s.peek) log.push(['peek', s.peek, checker.peek(s.peek)]);
          else {
            const runs = Array.from({ length: s.together || 1 }, () =>
              checker.check(s.check, { force: s.force }),
            );
            log.push(['checked', s.check, await Promise.all(runs)]);
          }
        }
        return log;
      },
    )),

    ...(await each(
      'reauthLoop',
      [
        {
          $id: 'trips-and-resets',
          steps: [
            ['record', 1_000_000],
            ['record', 1_000_001],
            ['looping', 1_000_010],
            ['record', 1_000_002],
            ['looping', 1_000_010],
            ['looping', 1_000_000 + REAUTH_LOOP_WINDOW_MS + 5],
            ['record', 1_000_000 + REAUTH_LOOP_WINDOW_MS + 1],
            ['clear'],
            ['looping', 1_000_010],
          ],
        },
        {
          $id: 'bad-json',
          stored: '{oops',
          steps: [
            ['looping', 5],
            ['record', 5],
          ],
        },
        {
          $id: 'odd-attempts',
          stored: '{"attempts":[1,"2",null,3,1e400]}',
          steps: [['record', 4]],
        },
        {
          $id: 'not-a-list',
          stored: '{"attempts":5}',
          steps: [
            ['looping', 5],
            ['record', 6],
          ],
        },
        {
          $id: 'future',
          stored: '{"attempts":[100,200,300]}',
          steps: [['looping', 50]],
        },
      ],
      ({ stored, steps }) => {
        const storage = memoryStorage(
          stored === undefined ? {} : { [REAUTH_ATTEMPTS_KEY]: stored },
        );
        return steps.map(([what, at]) => {
          let answer = null;
          if (what === 'record') recordReauthAttempt(storage, at);
          else if (what === 'clear') clearReauthAttempts(storage);
          else answer = reauthLooping(storage, at);
          return {
            answer,
            stored: storage.map.get(REAUTH_ATTEMPTS_KEY) ?? null,
          };
        });
      },
    )),
  ];
}
