# The worker

Defense's process on the droplet (docs/DEFENSE.md). It calls two of Virga's routes,
signed with `DEFENSE_WORKER_SECRET`:

- **The list writer**, `POST /api/defense/run`, every minute or so. On Vercel, it claims the
  lists due a write, runs the veto, opens the session of the account that holds each list
  and writes a batch.
- **The moderator's DM pass**, `POST /api/defense/dm`, every 15 seconds. On Vercel, it reads
  the moderator account's DMs since the last pass and answers each linked owner's commands.

Vercel Cron calls both every minute, so the worker isn't required for either; it makes the
DMs answer in seconds, and is the clock that stays when the cron can't. The shield and
attack mode join it in phase 5.

It holds no database key and no session, the moderator's included: only the secret, and it
calls nothing else (docs/DEFENSE-THREATS.md). A stolen secret can make Virga write sooner
what owners have already approved, and read its DMs sooner, and nothing more.

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
| `WORKER_INTERVAL_SECONDS` | How often to call the list writer, at least 15; 60 by default |
| `WORKER_DM_SECONDS` | How often to call the DM pass, at least 5; 15 by default; 0 leaves it to Vercel Cron |

A failed call is tried again after twice the wait, up to ten minutes; a 401 (the secret
doesn't match Vercel's) waits ten minutes each time and says so in the log.
