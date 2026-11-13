# Harness

The dashboard is behind a sign-in, so there is no way to open it locally, in a test or
from a screenshot tool without a real account. This runs the real app with one module
swapped out:

| real | harness |
| --- | --- |
| `src/session/useAtprotoSession.jsx` | `harness/fakeSession.jsx` |

(`harness/harness.js` puts the rest together and reads the address flags.)

The fake presents two made-up accounts as signed in on this browser: Mira Okafor
(`mira.example.com`), with three years of history, and Field Lab (`lab.example.org`), a
small, quiet second account to switch to and post as. Each has an agent
(`harness/fakeXrpc.js`) that answers the signed-in reads and takes the writes, and, in
the default long-session mode, a requester for Virga's server: the real one from
`src/session/backendClient.js`, pointed at a fake server (`harness/fakeServer.js`).
`harness/fakeNetwork.js` replaces `fetch`, so the public reads (the author feed, posts,
threads, profiles, feeds and lists, the DID documents, the repo download,
Constellation), Bluesky's card and video services and Virga's server are answered from
the same fixtures. Nothing leaves the machine, and a request to a host it doesn't know
is refused with a warning in the console.

## Running it

```
npm run harness      # http://127.0.0.1:5174
```

It starts where a new person does: signed in, with no archive. Press Build your archive
and the sync runs against the fixtures, including a real repo CAR built in the browser.
The archive is then in IndexedDB like any other, so the next visit opens on the charts.
Clear the site's data to start over.

| address | what you get |
| --- | --- |
| `/` | signed in as Mira, with Field Lab beside her, both on long sessions |
| `?accounts=1` | only Mira |
| `?mode=browser` | both accounts on browser sessions: the pages that need Virga's server say so |
| `?signedout` | the front page, with both accounts remembered. Signing in as anyone lands in the dashboard (as Field Lab for `lab.example.org`); `nobody` fails, to show the error |
| `?expired=lab` | that account (by handle) starts signed out; the other is open |
| `?scope=read` | the sessions were granted what Virga asked for before it could post: posts, gates, templates, drafts and uploads are refused for a missing scope (following still works) |
| `?limits=3,1,1` | limits on scheduled posts, plain timers and conditional timers per account, as the server's `SCHEDULED_POSTS_LIMIT`, `POST_TIMERS_LIMIT` and `CONDITIONAL_TIMERS_LIMIT` would set them; a blank or `0` leaves one unlimited. By default there are none, as on the server, only its flat caps (50 scheduled posts, 200 timers) |
| `?ailimits=30,15,3` | the monthly AI allowances: adviser reads, image descriptions, style readings (these are the defaults); `?ailimits=unlimited` counts nothing |
| `?ai=slow`, `?ai=down` | the adviser and alt text take longer than the composer waits, or are unavailable |
| `?cron=20` | how often, in seconds, the server's workers run (20 by default); `0` stops them |
| `/oauth/callback` | a sign-in that came back declined |
| `?latency=0` | no simulated delay on requests (60ms each by default) |

Flags combine: `/posting/scheduled?mode=browser&accounts=1`.

## The fixtures

`harness/world.js` builds the account from a seeded random number generator, dated back
from now: about 1,000 posts over three years with a long tail of engagement, 4,810
followers on a curve with two bursts, 3,400 notifications from a cast of 64 people (some
with no name, some with no picture, some with a very long name), 5,600 likes and reposts,
nine other collections in the repo, 148 direct blocks and nine lists, four of them
moderation lists with subscribers.

Field Lab is five months old, with nine posts, forty followers from the same cast and
nothing pointing at it.

On the posting side, Mira has two Bluesky drafts (one a thread), six bookmarks, two
feeds and two lists of her own, two templates in her repo, and a Bluesky setting that
lets only people she follows and people she mentions reply. Field Lab has none of it,
so the defaults show.

Nobody in it is real. It is stand-in content shaped like the real thing, for building
and looking, not for shipping.

## The agent

Any property chain on the fake agent is an NSID, and calling it answers from the
account's world (`agent.app.bsky.feed.searchPosts(params)` resolves to `{ data }`, as an
`@atproto/api` Agent's call does). It answers the dashboard's reads; the repo writes
(`createRecord`, `putRecord`, `deleteRecord`, `applyWrites`, `getRecord`, `listRecords`,
`uploadBlob`); Bluesky drafts, kept in memory per account; preferences; bookmarks; post
search; and service-auth tokens for the video service. A method it doesn't know fails
with `MethodNotImplemented` and a console warning.

Writes land in the account's world (`harness/repo.js`) with the CIDs a PDS would give
them, so a post shows up in the author feed, in `getPosts` and `getPostThread`, in the
next repo download and in the next sync. Uploaded images come back in post views as
`data:` URLs. A post written here picks up a like every few minutes, so timers with
conditions have something to count.

It refuses what a real account would: writing to another repo, creating over a record
that's there, a swap that doesn't match, drafts or bookmarks asked of anyone but
Bluesky's AppView, and anything the session's granted scope doesn't cover (with the
PDS's "Missing required scope" wording). It doesn't check inputs against the lexicons.

## Virga's server

The fake server stands in for this repo's own (`api/`, `server/`), in its shapes:
scheduled posts (`/api/schedule/create`, `list`, `get`, `media`, `update` with its four
kinds, `reorder`, `cancel`), timers (`/api/self-destruct/create`, `list`, `cancel`),
`/api/limits/status` with what's in use, the adviser and alt text (`/api/ai/analyze-post`,
`synthesize-style`, `alt-text`), and `/api/oauth/session` and `/api/oauth/logout`. It
answers at a fixed address of its own (`SERVER_ORIGIN`, `https://server.harness.invalid`)
rather than the dev server's `/api`, which Vite would answer itself; the session stand-in
points the requester there.

It serves one app: an account sees and changes only its own rows, every row and timer
says it is Virga's (`clientKey: 'virga'`), and a request with a token the server doesn't
know gets 401 `FRONTEND_SESSION_INVALID`. Mira starts with a post at a time of its own,
one in the queue, one that failed, one that went out without its timer, a conditional
timer counting down and one that has already deleted its post. The limits are flat:
unlimited unless `?limits=` sets some, with the caps always reported, and the AI
allowances are 30 adviser reads, 15 descriptions and 3 style readings a month.

Every 20 seconds the server's workers run: due posts are written into the account's
world at the keys reserved when they were scheduled, and due timers read the post's
counts and delete it, limit its replies or turn off its quotes. The adviser's verdicts
come from a few word lists, so the same draft always gets the same read.

From the browser console, `__harness.cron()` runs the workers now,
`__harness.expire('lab')` ends Field Lab's long session on the server (the next request
finds out, and after three checks the account shows as signed out),
`__harness.agentFor(did)` is the agent the page uses, and
`__harness.server.inspect()` shows what the server holds.

## Cards and video

The card service answers any web address with a title, a description and a real PNG
through its image proxy, big enough that the composer has to shrink it; an address on
`.invalid` has no card. The video service checks that each service-auth token is
addressed to the right place (the upload's to the account's PDS for `uploadBlob`, the
rest to the video service), keeps the upload as one of the account's blobs and reports
it processed after a few seconds.

`harness/world.test.js`, `fakeXrpc.test.js` and `fakeServer.test.js` run with
`npm test`. They check that the real code still reads the fixtures the way it reads real
answers, and that the posting services (publish, drafts, scheduling, timers) work
against the fakes, which is the only thing that stops them drifting.

## What it is not

Not a mock of the protocol. It doesn't check OAuth, rate limits or lexicons, its
permission check is only the scope string, and a bug that only shows against a real PDS
or the real server will not show here.

Nothing here ships. `npm run build` uses the root `index.html` and never reads this
directory.

## What changes between syncs

So the tools have something to find:

- **Followers churn.** From the second sync on, a dozen followers have left and three
  have arrived, so the Unfollow tracker has entries. The sweep count is kept in
  localStorage with the archive; clear the site's data to start over.
- **Some follows have gone quiet.** Thirty-six follows outside the cast answer the
  activity check as quiet, never posted, or gone, for Follow cleanup.
- **The account has a history.** The PLC directory's audit log has a first handle on
  bsky.social, a handle of its own, and a move to its own PDS, for the Identity inspector.
