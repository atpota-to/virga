// The worker: on the droplet, the one process that has to stay on. In phase 3
// it calls Virga's run route on a clock, signed, so lists are written whether
// or not Vercel Cron runs (docs/DEFENSE.md). It holds no database key and no
// session: only DEFENSE_WORKER_SECRET.
//
//   VIRGA_URL=https://virga.example DEFENSE_WORKER_SECRET=... node worker/main.js
//
// Stops cleanly on SIGTERM and SIGINT, between calls.

import { driveOnce, nextDelay, readConfig } from './drive.js';

let config;
try {
  config = readConfig(process.env);
} catch (err) {
  console.error(`[worker] ${err.message}`);
  process.exit(1);
}

let stopping = false;
let wake = null;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    stopping = true;
    wake?.();
  });
}

const sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });

console.info(`[worker] calling ${config.base} every ${Math.round(config.intervalMs / 1000)} s`);
let failures = 0;
while (!stopping) {
  const out = await driveOnce(config);
  if (out.ok) {
    failures = 0;
    const s = out.summary;
    if (s?.ran && (s.written || s.vetoed || s.failed || s.held?.length || s.errors?.length)) console.info(`[worker] ${JSON.stringify(s)}`);
  } else {
    failures += 1;
    console.warn(`[worker] the run route answered ${out.status || 'nothing'}: ${out.error}`);
  }
  if (stopping) break;
  await sleep(nextDelay({ intervalMs: config.intervalMs, failures, status: out.status }));
}
console.info('[worker] stopped');
