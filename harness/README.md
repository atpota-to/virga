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
threads, profiles, feeds and lists, relationships, the DID documents, the repo download,
Constellation, including everything pointing at a post), Bluesky's card and video services and Virga's server are answered from
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
| `?signedout` | the front page, with both accounts remembered. Type a handle and the sign-in looks it up (`mira.example.com`, `lab.example.org` and anyone in the cast are found; anything else isn't), asks "Is this you?" and takes you to the host; here that lands in the dashboard (as Field Lab for `lab.example.org`, as Mira for anyone else or for a new account). `nobody` is found by nobody, to show the error |
| `?terms=ask` | nobody has agreed to the Terms of Service and Privacy Policy, so the agreement screen stands in front of the app until you agree (it comes back on every load). `?terms=down` is the same with a server that can't record the agreement, to show the error. Combine with `?mode=browser` for a browser session, whose agreement is kept in the browser and reported |
| `?expired=lab` | that account (by handle) starts signed out; the other is open |
| `?scope=read` | the sessions were granted what Virga asked for before it could post: posts, gates, templates, drafts and uploads are refused for a missing scope (following still works) |
| `?defense=on` | the sessions were granted Defense's permission too, as after Turn on Defense. By default they weren't, so `/defense` offers to ask for it; Turn on Defense (and Turn off) changes the grant in place, for the agent and the server alike. `?defense=lists` grants the list writes as well, as after Let Defense make lists |
| `?defensewrites=off` | Virga's server doesn't write Defense's lists (its `DEFENSE_WRITES` isn't on): scans work, and Add to a list and Lists say so |
| `?appview=failopen`, `?appview=flaky` | the signed-in `getProfiles` leaves `knownFollowers` off every answer (a scan finds no canary and says it couldn't check who you know in common), or off the first answer for each batch (the canary catches it, and the batch is asked again and counted) |
| `?views=none`, `?views=failopen`, `?views=flaky` | the signed-in `getPosts` gives no view counts (no post has reached 100), leaves them off every answer (the AppView's lookup timing out), or off the first answer for each batch (the views sweep's canary asks again). By default Mira's posts from the last 150 days have counts, a few dozen views for each interaction, rising over a post's first day; older ones have none, as if Bluesky started counting then |
| `?age=minor`, `?age=undeclared` | Bluesky has the accounts down as under 18, or has no birthday for them, so Virga doesn't read view counts. By default they've said they're 18 or over |
| `?limits=3,1,1` | limits on scheduled posts, plain timers and conditional timers per account, as the server's `SCHEDULED_POSTS_LIMIT`, `POST_TIMERS_LIMIT` and `CONDITIONAL_TIMERS_LIMIT` would set them; a blank or `0` leaves one unlimited. By default there are none, as on the server, only its flat caps (50 scheduled posts, 200 timers) |
| `?ailimits=30,15,3` | the monthly AI allowances: adviser reads, image descriptions, style readings (these are the defaults); `?ailimits=unlimited` counts nothing |
| `?ai=slow`, `?ai=down` | the adviser and alt text take longer than the composer waits, or are unavailable |
| `?cron=20` | how often, in seconds, the server's workers run (20 by default); `0` stops them |
| `/oauth/callback` | a sign-in that came back declined |
| `?latency=0` | no simulated delay on requests (60ms each by default) |
| `?now=1794700000000` | the moment the made-up accounts are dated back from, in milliseconds. A post's address comes from its date, so by default every reload is a fresh set of posts and a sync adds them to the last set; with the same `now`, a reload meets the same posts, which is what checking a second sync or an archive upgrade needs |

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

For Defense, a crowd engages with Mira's posts (`harness/crowd.js`, drawn from a hash of each
post's address, so a post meets the same crowd every time): as many accounts as the post's
counts say, up to 1,800 likes, 400 reposts, 320 replies and 160 quotes, from a few of the
cast she follows, a few she doesn't, some of her followers, and 1,200 strangers, who are
more of the replies and quotes. Among the strangers some are widely followed, some post all
day, a few are followed by one or more of the people Mira follows, and a few block her. The
cast follow one another along a fixed hash, so "how many of the people you follow follow
them" is worked out for whoever asks: Field Lab sees smaller counts, and no stranger counted.
A post that isn't one of the accounts' own has nobody on it.

On the posting side, Mira has two Bluesky drafts (one a thread), six bookmarks, two
feeds and two lists of her own, two templates in her repo, and a Bluesky setting that
lets only people she follows and people she mentions reply. Field Lab has none of it,
so the defaults show.

Nobody in it is real. It is stand-in content shaped like the real thing, for building
and looking, not for shipping.

## The agent

Any property chain on the fake agent is an NSID, and calling it answers from the
account's world (`agent.app.bsky.feed.searchPosts(params)` resolves to `{ data }`, as an
`@atproto/api` Agent's call does). It answers the dashboard's reads; the signed-in
`getProfiles` with `viewer.knownFollowers`, `following`, `followedBy` and `blockedBy` (25 at
most, as the AppView takes); the repo writes
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
scheduled posts (`/api/schedule/create`, `list`, `get`, `media`, `update` with its six
kinds, `reorder`, `cancel`), scheduled replies and repeating posts among them, timers (`/api/self-destruct/create`, `list`, `cancel`),
`/api/limits/status` with what's in use, the adviser and alt text (`/api/ai/analyze-post`,
`synthesize-style`, `alt-text`), and `/api/oauth/session` and `/api/oauth/logout`. It
answers at a fixed address of its own (`SERVER_ORIGIN`, `https://server.harness.invalid`)
rather than the dev server's `/api`, which Vite would answer itself; the session stand-in
points the requester there.

It serves one app: an account sees and changes only its own rows, every row and timer
says it is Virga's (`clientKey: 'virga'`), and a request with a token the server doesn't
know gets 401 `FRONTEND_SESSION_INVALID`. Mira starts with a post at a time of its own
that repeats every month (the second of six), one in the queue, one that failed, one that went out without its timer, a conditional
timer counting down and one that has already deleted its post. The limits are flat:
unlimited unless `?limits=` sets some, with the caps always reported, and the AI
allowances are 30 adviser reads, 15 descriptions and 3 style readings a month.

Every 20 seconds the server's workers run: due posts are written into the account's
world at the keys reserved when they were scheduled (a reply only if the post it answers
is still there, and a repeating post's next occurrence is left waiting), and due timers read the post's
counts and delete it, limit its replies or turn off its quotes. The adviser's verdicts
come from a few word lists, so the same draft always gets the same read.

From the browser console, `__harness.cron()` runs the workers now,
`__harness.expire('lab')` ends Field Lab's long session on the server (the next request
finds out, and after three checks the account shows as signed out),
`__harness.refuse('lab')` keeps its tokens and stored grant but has the grant refused, as
a failed refresh does (the workers stop, the proxy and the full session check say the
OAuth session is missing, and the lite check says it's there until one of them has
tried it),
`__harness.agentFor(did)` is the agent the page uses, and
`__harness.server.inspect()` shows what the server holds.

## Defense's lists

The fake server answers `/api/defense/*` (`harness/fakeDefense.js`) in the real handlers'
shapes: lists, the people kept by hand, plans and their approval, the history and undo. A
list it makes is a record in the account's world, and on each tick of the server's workers
it writes one batch per account as list items there, with the same veto the real one reads
(the account, the people kept by hand, everyone it follows, the members of its curation
lists). `__harness.cron()` runs a tick now; `?cron=0` stops them, so a batch can be watched
arriving. The world is in memory, so a reload starts it over: move between Defense's pages
from the sidebar.

## Cards and video

The card service answers any web address with a title, a description and a real PNG
through its image proxy, big enough that the composer has to shrink it; an address on
`.invalid` has no card. The video service checks that each service-auth token is
addressed to the right place (the upload's to the account's PDS for `uploadBlob`, the
rest to the video service), keeps the upload as one of the account's blobs and reports
it processed after a few seconds.

`harness/world.test.js`, `fakeXrpc.test.js`, `fakeServer.test.js`, `crowd.test.js` and
`fakeDefense.test.js` run with `npm test` (`crowd.test.js` runs the real Defense scan
against the fixtures, and `fakeDefense.test.js` the real Defense client against the fake
server). They check that the real code still reads the fixtures the way it reads real
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
