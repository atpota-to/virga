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

- Every page (the dashboards and their editing, the six reports, the seven tools,
  settings, the front page), the first build and a second sync, against made-up data
  in the harness (below), at phone and desktop widths, in the light and dark themes,
  and with the live sky on.
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

Virga is a workspace with four parts, in the sidebar on a desk and in the tab bar on a
phone.

**Dashboards** are sets of report cards you arrange yourself. Three come to start with
(Overview, Growth, Content); make more, rename, duplicate, reorder or delete them.
Customize turns a dashboard's cards into things to arrange: drag a card by its handle (or
move it with the arrow buttons), pick a size (a quarter, a third, half, two thirds or the
whole row), remove it, or add any of 26 cards from the report library beside the grid.
Every card answers for the period picked in the header (7 days to all time), and links to
its full report. The cards are listed in `src/dashboards/catalog.js`.

**Reports**, one page each, with every chart's numbers also available as a table, a
note on how they're counted, an export, and Add to dashboard:

| Report | What | Where it comes from |
| --- | --- | --- |
| Followers | Growth over time, new per day or week, the newest followers and the biggest days | `app.bsky.graph.getFollowers`, signed in. Each follower's follow record has a key that dates it |
| Blocks | Who blocks the account directly or through a moderation list, over time | Constellation backlinks, then the lists' own records from the public API |
| Posts | Posts per day, week or month, share of replies, quotes and media | `app.bsky.feed.getAuthorFeed` on the public API |
| Engagement | Likes, reposts, replies and quotes received, the rate per post, top posts; and the same given | Post counts from the public API; likes and reposts given from the repo |
| People | Who engages with the account and who it engages with, with Follow buttons | Notifications, signed in; the repo; follow records |
| Atmosphere | Every record in every collection, by day and by collection | The whole repo in one download, `com.atproto.sync.getRepo` |

**Tools**, each saying what it can touch:

| Tool | What it does | Touches |
| --- | --- | --- |
| Follow cleanup | Accounts you follow that went quiet, are gone, don't follow back or never interact; bulk Unfollow with Undo, and Keep to stop suggesting someone | Follow records (the permission the sign-in already asks for). Last activity is one public author-feed read per account, on request |
| Unfollow tracker | Who left and who arrived between two syncs | Read only. An unfollow takes its record with it, so each sync compares the follower list with the last one and keeps the differences |
| Follow-back queue | Followers who engage with you that you don't follow yet | Follow records |
| Best time to post | What a typical post (the median) earns by weekday and hour, in your time zone | Read only |
| Lists you're on | Every list that includes you, moderation lists and their subscribers flagged | Read only |
| Archive search and export | Search every post, filter by kind and window, export CSV or JSON | Read only |
| Identity inspector | DID, handle, PDS, the DID's handle and server history, what's in the repo | Read only, plus the PLC directory's audit log |

Three more are listed under Later and aren't built: an interaction lookup, a list manager
and scheduled posts. The last two would need permissions Virga doesn't ask for.

**Settings**: the account, the archive (sync, rebuild, export, ask the browser to keep
it, delete it), the dashboards, appearance (theme, density, the sidebar, the live sky),
the permissions, and where the data comes from.

The first build takes a minute or two for an account with thousands of posts. After
that a sync only fetches what is new, and runs by itself when the archive is more than an
hour old.

## Signing in

Sign-in is atproto OAuth, in the browser (`@atproto/oauth-client-browser`). The app asks
for these permissions and no others (`src/config.js`):

| Permission | Why |
| --- | --- |
| `atproto` | To know who signed in |
| `rpc:app.bsky.graph.getFollowers` | Only a signed-in read carries each follower's follow record, which is what dates the growth curve |
| `rpc:app.bsky.notification.listNotifications` | Who liked, reposted, replied to, quoted and mentioned the account |
| `repo:app.bsky.graph.follow`, create and delete | The Follow buttons, Follow cleanup and the Follow-back queue |

It can't post, like, or read messages. Everything else it reads is public and fetched
without the session. The syntax is from the
[permission spec](https://atproto.com/specs/permission) (read 2026-11-12).

A PDS that doesn't know these granular permissions will turn the sign-in down.
`transition:generic` would work there, but it grants nearly everything, so it isn't a
fallback this app uses.

## Where the data is kept

In IndexedDB, in a database per account (`virga-analytics:<did>`), so two accounts on one
browser never share rows. Signing out leaves the archive in place for next time; Settings
› Data and sync deletes it. The unfollow log and the last-activity checks live there too.

In localStorage: each account's dashboards (`virga:dashboards:<did>`), the tools' Keep
lists, and the preferences for whoever is at the browser (`virga:preferences`: theme,
density, the live sky, the period, the sidebar). Dashboards kept in the account's own
repo, so they follow you to another browser, would need a permission to write that one
kind of record; Settings says so rather than offering it.

Requests go from the browser to four places: the account's PDS, `public.api.bsky.app`,
`plc.directory` and `constellation.microcosm.blue`.

## The look

A quiet, light workspace (the Ledger direction), with a dark theme beside it.

- **Plain grounds and one-pixel lines.** White cards on a pale ground, small radii, no
  shadows except on what floats (menus, dialogs). Colours, type, spacing and density are
  tokens in `src/styles/theme.css`, with a dark set under `[data-theme='dark']`. The
  theme follows the system unless Settings picks one; `index.html` stamps it before the
  first paint.
- **One blue** for the data and whatever is pressed; coral for the second thing on a
  chart and a change downward. A change says which way it went, not whether that's good.
  The chart colours have their own steps in each theme, checked for colour-blind
  separation and contrast against their own surface.
- **One typeface,** Mona Sans, in sentence case, in its ordinary figures (its tabular
  ones have a slashed zero). Monospace is for code only (NSIDs, DIDs).
- **Every chart has a table.** Hover shows a value; Show as table shows them all.
- **On a phone,** the sidebar becomes an app bar and four tabs at the bottom, cards stack
  one to a row (figures two to a row), and Customize moves cards with arrows.
- **The live sky is an easter egg.** The 3D hillside from the first version
  (`src/hillside/`) is off by default. Settings › Appearance turns it on, for the
  dashboards or everywhere, at dawn, at day, or following the archive (dawn until the
  first build). Five taps on the logo turn it on or off from anywhere. With reduced
  motion it's a still picture; without WebGL, a flat gradient of the same sky.

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

## How the code is laid out

| Where | What |
| --- | --- |
| `src/shell/` | The signed-in frame: sidebar, app bar and tabs, page header, sync status, routing |
| `src/archive/` | The archive hook (IndexedDB and the sync) and the context that shares it |
| `src/reports/models.js` | Every number, as pure functions of the archive and a period, cached per sync |
| `src/dashboards/` | Layouts, the card library and the cards themselves |
| `src/reports/`, `src/tools/`, `src/settings/` | The pages |
| `src/charts/` | The time series, sparklines, heatmaps and bar lists |
| `src/lib/router.jsx` | Real paths (`/dashboard/:id`, `/reports/:report`, `/tools/:tool`, `/settings/:section`) on the History API |

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
  tests, the archive hook in `src/archive/` and the report models: dame.is, adjusted for
  many accounts.
- `src/hillside/`: the Open Social site, converted from TypeScript.
