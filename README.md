# Virga

Analytics for a Bluesky account and the rest of its atproto repo. Anyone can sign in with
their handle and see their own numbers: followers, blocks, posts, engagement, the people
behind it, and what every app has written to their repo.

Everything is worked out in the browser. There is no Virga server and no database: the
app reads from the signed-in account's PDS, Bluesky's public API and Constellation, and
keeps what it gathers in that browser's IndexedDB.

## Status

A first pass, ported from the Analytics studio in [dame.is](https://github.com/dame-is/dame.is)
(`/admin?view=analytics`), which only its owner could use. Not deployed yet.

What has been checked, as of 2026-11-12:

- The dashboard, the first build and every tab, against made-up data in the harness
  (below), at phone and desktop widths.
- That a real sign-in starts: from a local dev server, bsky.social accepted the request
  with the permissions listed below and showed its sign-in page.

What has not: finishing a real sign-in, and so the signed-in reads and the Follow button
against a real account. That needs someone to sign in.

The copy on every screen is a draft.

## Run it

Needs Node 20 or later.

```
npm install
npm run dev        # http://127.0.0.1:5173
npm run harness    # http://127.0.0.1:5174, no sign-in needed
npm test
npm run lint
npm run build
```

Open the dev server at `127.0.0.1`, not `localhost`. A local sign-in comes back to
`127.0.0.1` (the OAuth spec doesn't allow `localhost` there), and the session belongs to
the address it was started from.

## What it shows

| Tab | What | Where it comes from |
| --- | --- | --- |
| Followers | Growth over time, new per day or week, against the window before | `app.bsky.graph.getFollowers`, signed in. Each follower's follow record has a key that dates it |
| Blocks | Who blocks the account directly or through a moderation list, over time | Constellation backlinks, then the lists' own records from the public API |
| Posts | Posts per day, week or month, share of replies and media | `app.bsky.feed.getAuthorFeed` on the public API |
| Engagement | Likes, reposts, replies and quotes received, the rate per post, top posts; and the same given | Post counts from the public API; likes and reposts given from the repo |
| People | Who engages with the account and who it engages with, with Follow buttons | Notifications, signed in; the repo; follow records |
| Atmosphere | Every record in every collection, by day and by collection | The whole repo in one download, `com.atproto.sync.getRepo` |

The first build takes a minute or two for an account with thousands of posts. After
that a sync only fetches what is new. The archive can be exported as JSON, and the posts
as CSV, from More in the bar at the bottom.

## Signing in

Sign-in is atproto OAuth, in the browser (`@atproto/oauth-client-browser`). The app asks
for these permissions and no others (`src/config.js`):

| Permission | Why |
| --- | --- |
| `atproto` | To know who signed in |
| `rpc:app.bsky.graph.getFollowers` | Only a signed-in read carries each follower's follow record, which is what dates the growth curve |
| `rpc:app.bsky.notification.listNotifications` | Who liked, reposted, replied to, quoted and mentioned the account |
| `repo:app.bsky.graph.follow`, create and delete | The Follow and Following buttons on the People tab |

It can't post, like, or read messages. Everything else it reads is public and fetched
without the session. The syntax is from the
[permission spec](https://atproto.com/specs/permission) (read 2026-11-12).

A PDS that doesn't know these granular permissions will turn the sign-in down.
`transition:generic` would work there, but it grants nearly everything, so it isn't a
fallback this app uses.

## Where the data is kept

In IndexedDB, in a database per account (`virga-analytics:<did>`), so two accounts on one
browser never share rows. Signing out leaves the archive in place for next time. There
is no button yet to delete it; clearing the site's data in the browser does.

Requests go from the browser to four places: the account's PDS, `public.api.bsky.app`,
`plc.directory` and `constellation.microcosm.blue`.

## The look

The direction comes from two of the landing page explorations on the Open Social site,
Thread and Daylight:

- **The sky.** A 3D hillside (three.js, `src/hillside/`) sits behind everything: clouds
  drift, their shadows cross the hill, wind runs through the grass and the view leans a
  little with the pointer. It is at dawn on the front page and until there is an archive
  to chart. When the first build has something to draw, the sun comes up. With reduced
  motion it is a still picture, and without WebGL a flat gradient of the same sky and
  field.
- **One typeface,** Mona Sans, in sentence case. Its width axis sets the big titles apart.
  Monospace is used for code only (collection names).
- **Cards on the sky.** Anything with words or numbers is on a white card, because the
  sky behind it moves. Controls are pills. Blue is the data and whatever is pressed;
  coral is the second thing on a chart.
- **The guide.** The bar pinned to the bottom of the screen says what the archive holds
  and when it was synced, and becomes the progress while a sync runs.

Colours, type and spacing are tokens in `src/styles/theme.css`.

## The harness

`npm run harness` runs the real app with one module swapped: the session. A made-up
account is signed in, and every network request is answered from fixtures, so the whole
app can be looked at and clicked through offline. See `harness/README.md`.

## Deploying

Built for Vercel, and static apart from one small function. An authorization server has
to fetch the app's client metadata from the same origin the app is served from, so
`api/client-metadata.js` answers `/oauth-client-metadata.json` for whichever host it was
asked at (the production domain, or a preview). `vercel.json` routes it and sends every
other path to `index.html`.

On another host, serve that JSON yourself: it is the object `buildClientMetadata(origin)`
returns in `src/lib/oauthClient.js`.

## Not here yet

- **The Graph tab** from dame.is: where people sit in your follow graph, and Bluesky
  lists kept in step with it. There it reads a weekly snapshot of the follow graph from a
  database and writes lists from a cron signed in with an app password. Doing that for
  anyone means a server that holds something for each person, which is a decision of its
  own.
- **Very large accounts.** A sync reads up to 100,000 followers and 20,000 block records
  per walk, and says so when it stops short.

## Where things came from

- `src/lib/analytics*.js`, `syncProgress.js`, `carRepo.js`, `constellation.js` and their
  tests, and `src/dashboard/Dashboard.jsx`: dame.is, adjusted for many accounts.
- `src/hillside/`: the Open Social site, converted from TypeScript.
