// The worker: on the droplet, the one process that has to stay on. It calls
// Virga's list writer and the moderator's DM pass on a clock, signed, so lists
// are written and DMs answered whether or not Vercel Cron runs, and DMs within
// seconds rather than a minute (docs/DEFENSE.md). It holds no database key and
// no session, the moderator's included: only DEFENSE_WORKER_SECRET.
//
//   VIRGA_URL=https://virga.example DEFENSE_WORKER_SECRET=... node worker/main.js
//
// Stops cleanly on SIGTERM and SIGINT, between calls.

import { DM_PATH, RUN_PATH, driveOnce, nextDelay, readConfig } from './drive.js';

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

/** One route on its own clock, backing off on its own failures. */
async function loop(name, path, intervalMs, worth) {
  console.info(`[worker] calling ${config.base}${path} every ${Math.round(intervalMs / 1000)} s`);
  let failures = 0;
  while (!stopping) {
    const out = await driveOnce({ ...config, path });
    if (out.ok) {
      failures = 0;
      if (worth(out.summary)) console.info(`[worker] ${name}: ${JSON.stringify(out.summary)}`);
    } else {
      failures += 1;
      console.warn(`[worker] ${name} answered ${out.status || 'nothing'}: ${out.error}`);
    }
    if (stopping) break;
    await sleep(nextDelay({ intervalMs, failures, status: out.status }));
  }
}

const loops = [loop('the list writer', RUN_PATH, config.intervalMs, (s) => s?.ran && (s.written || s.vetoed || s.failed || s.held?.length || s.errors?.length))];
if (config.dmIntervalMs) loops.push(loop('the DM pass', DM_PATH, config.dmIntervalMs, (s) => s?.ran && (s.answered || s.errors?.length)));
await Promise.all(loops);
console.info('[worker] stopped');
