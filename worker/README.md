# The worker

Defense's process on the droplet (docs/DEFENSE.md). It does two things:

- **The moderator.** It holds Virga's moderator account (`DEFENSE_MODERATOR_HANDLE` and an
  app password with DM access), reads its DMs every few seconds (`dmLoop.js`) and answers
  them:
  - Linking, the one line for anyone who hasn't linked, and typed commands are answered by
    Virga's server by code.
  - Anything else from a linked owner goes to the agent (`agent.js`), through the Vercel AI
    Gateway, when `AI_GATEWAY_API_KEY` is set. Every change it makes is first checked against
    what the owner said (`check.js`).
  - Whatever a DM asks of an owner's lists is done by Virga's server, as that owner, through
    `POST /api/defense/moderator`, signed with `DEFENSE_WORKER_SECRET`.
- **The list writer's clock.** Every minute or so it calls `POST /api/defense/run`, signed
  the same way. That route, on Vercel, claims the lists due a write, runs the veto, opens the
  session of the account that holds each list and writes a batch. Vercel Cron calls it too,
  so lists are written without the worker.

It holds no database key and no user's session (docs/DEFENSE-THREATS.md). It does hold the
moderator account and the AI Gateway key, so keep the droplet's `.env` to yourself: with it,
someone could read what owners DM the moderator, and ask Virga to do anything a linked owner's
DM could (DEFENSE-THREATS.md, rule 16).

Its state is one file in a Docker volume (`/data`): how far the DMs have been read, the
moderator's session, and the questions the agent has asked and not had answered. A lock file
beside it keeps a second copy from answering every message twice. The shield and attack mode
join it in phase 5.

## Running it

```
openssl rand -hex 32                 # the secret: set it on Vercel and here
cp worker/.env.example worker/.env   # then fill it in
docker compose -f worker/compose.yaml up -d --build
docker compose -f worker/compose.yaml logs -f
```

Or without Docker: `cd worker && npm ci && cd .. && VIRGA_URL=… DEFENSE_WORKER_SECRET=… WORKER_DATA_DIR=./worker-data node worker/main.js`.

| Variable | What |
| --- | --- |
| `VIRGA_URL` | Virga's deployment, an https origin |
| `DEFENSE_WORKER_SECRET` | The same value as on Vercel, 32 characters or more |
| `WORKER_INTERVAL_SECONDS` | How often to call the list writer, at least 15; 60 by default |
| `DEFENSE_MODERATOR_HANDLE` | The moderator account. Set it on Vercel too, where it's only shown |
| `DEFENSE_MODERATOR_PASSWORD` | An app password for it, with "Allow access to your direct messages" ticked |
| `DEFENSE_MODERATOR_SERVICE` | Where it signs in: its PDS or entryway; `https://bsky.social` by default |
| `WORKER_DM_SECONDS` | How often to read its DMs, at least 2; 5 by default |
| `WORKER_DATA_DIR` | Where its state is kept; `/data` (the volume) by default |
| `AI_GATEWAY_API_KEY` | The Vercel AI Gateway. Unset, the moderator answers typed commands only |
| `DEFENSE_AGENT_MODEL` | The agent's model, which must call tools; `deepseek/deepseek-v4.1-flash` by default |
| `DEFENSE_CHECK_MODEL` | The write check's model; the agent's by default |
| `DEFENSE_AGENT_ZDR` | `on` routes only to providers with zero data retention |

How many replies in sentences each owner gets a month is set on Vercel
(`DEFENSE_AGENT_MONTHLY_LIMIT`, 300 by default), where they're counted.

A failed call to the list writer is tried again after twice the wait, up to ten minutes; a
401 (the secret doesn't match Vercel's) waits ten minutes each time and says so in the log.
A DM pass that fails backs off the same way, and signs the moderator in again if its session
was refused.
