// The worker: on the droplet, the one process that has to stay on.
//
//   - The list writer's clock: it calls Virga's run route, signed, so lists
//     are written whether or not Vercel Cron runs.
//   - The moderator: it holds the moderator account (DEFENSE_MODERATOR_HANDLE
//     and DEFENSE_MODERATOR_PASSWORD), reads its DMs every few seconds, and
//     answers them, with the agent when AI_GATEWAY_API_KEY is set. Whatever a
//     DM asks of an owner's lists is done by Virga's server, as that owner.
//
// It holds no database key and no user's session (docs/DEFENSE-THREATS.md).
//
//   VIRGA_URL=https://virga.example DEFENSE_WORKER_SECRET=... node worker/main.js
//
// Stops cleanly on SIGTERM and SIGINT, between calls.

import { driveOnce, nextDelay, readConfig } from './drive.js';
import { runDmPass } from './dmLoop.js';
import { modelConfig } from './model.js';
import { moderatorConfigured, openModerator } from './moderator.js';
import { fileState } from './state.js';
import { virgaClient } from './virga.js';

let config;
try {
  config = readConfig(process.env);
} catch (err) {
  console.error(`[worker] ${err.message}`);
  process.exit(1);
}

let stopping = false;
const wakers = new Set();
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    stopping = true;
    for (const wake of wakers) wake();
  });
}

const sleep = (ms) =>
  new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      wakers.delete(wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    wakers.add(wake);
  });

/** The list writer, on its clock, backing off on its own failures. */
async function writerLoop() {
  console.info(`[worker] calling ${config.base}/api/defense/run every ${Math.round(config.intervalMs / 1000)} s`);
  let failures = 0;
  while (!stopping) {
    const out = await driveOnce(config);
    if (out.ok) {
      failures = 0;
      const s = out.summary;
      if (s?.ran && (s.written || s.vetoed || s.failed || s.held?.length || s.errors?.length)) console.info(`[worker] list writer: ${JSON.stringify(s)}`);
    } else {
      failures += 1;
      console.warn(`[worker] the run route answered ${out.status || 'nothing'}: ${out.error}`);
    }
    if (stopping) break;
    await sleep(nextDelay({ intervalMs: config.intervalMs, failures, status: out.status }));
  }
}

/** The moderator's DMs, every few seconds, while this copy holds the lock. */
async function moderatorLoop() {
  const state = fileState(config.dataDir);
  while (!stopping && !(await state.lock())) {
    console.warn('[worker] another copy of the worker holds the moderator’s lock; waiting');
    await sleep(60_000);
  }
  const model = modelConfig(process.env);
  const virga = virgaClient(config);
  console.info(`[worker] reading the moderator’s DMs every ${Math.round(config.dmIntervalMs / 1000)} s${model ? `, with ${model.agent} for sentences` : ', typed commands only'}`);
  let moderator = null;
  let failures = 0;
  while (!stopping) {
    try {
      moderator ??= await openModerator({ env: process.env, state });
      const out = await runDmPass({ moderator, state, virga, model });
      await state.touch();
      failures = 0;
      if (out.answered || out.errors.length || out.seeded) console.info(`[worker] DMs: ${JSON.stringify(out)}`);
    } catch (err) {
      failures += 1;
      console.warn(`[worker] the DM pass stopped: ${err?.message || err}`);
      // Signed out, or the chat service refused the session: sign in again next time.
      if (/auth|token|session|sign/i.test(String(err?.message || err))) moderator = null;
    }
    if (stopping) break;
    await sleep(failures ? Math.min(10 * 60_000, config.dmIntervalMs * 2 ** Math.min(failures, 7)) : config.dmIntervalMs);
  }
  await state.unlock();
}

const loops = [writerLoop()];
if (moderatorConfigured(process.env)) loops.push(moderatorLoop());
else console.info('[worker] no moderator account set (DEFENSE_MODERATOR_HANDLE, DEFENSE_MODERATOR_PASSWORD); not reading DMs');
await Promise.all(loops);
console.info('[worker] stopped');
