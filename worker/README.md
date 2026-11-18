# The worker

Defense's process on the droplet (docs/DEFENSE.md). In phase 3 it does one thing: every
minute or so it calls Virga's run route, `POST /api/defense/run`, signed with
`DEFENSE_WORKER_SECRET`. That route, on Vercel, claims the lists due a write, runs the
veto, opens the session of the account that holds each list and writes a batch.
Vercel Cron calls the same route, so the worker isn't required for lists to be written; it
is the clock that will stay when the cron can't, and the place the DMs, the shield and
attack mode join it in phases 4 and 5.

It holds no database key and no session, only the secret, and calls nothing else
(docs/DEFENSE-THREATS.md). A stolen secret can make Virga write sooner what owners have
already approved, and nothing more.

## Running it

```
openssl rand -hex 32          # the secret: set it on Vercel and here
cp worker/.env.example worker/.env   # then fill it in
docker compose -f worker/compose.yaml up -d --build
docker compose -f worker/compose.yaml logs -f
```

Or without Docker: `VIRGA_URL=… DEFENSE_WORKER_SECRET=… node worker/main.js`.

| Variable | What |
| --- | --- |
| `VIRGA_URL` | Virga's deployment, an https origin |
| `DEFENSE_WORKER_SECRET` | The same value as on Vercel, 32 characters or more |
| `WORKER_INTERVAL_SECONDS` | How often to call, at least 15; 60 by default |

A failed call is tried again after twice the wait, up to ten minutes; a 401 (the secret
doesn't match Vercel's) waits ten minutes each time and says so in the log.
