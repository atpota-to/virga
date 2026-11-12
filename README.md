# Virga

Analytics for a Bluesky account and the rest of its atproto repo, and a place to write,
schedule and look after its posts. Anyone can sign in with their handle and see their own
numbers: followers, blocks, posts, engagement, the people behind it, and what every app has
written to their repo. Several accounts can be signed in at once.

The numbers are worked out in the browser. The app reads from the signed-in account's PDS,
Bluesky's public API and Constellation, and keeps what it gathers in that browser's
IndexedDB; the archive is never sent anywhere. What has to happen while the browser is
closed (long sessions, scheduled posts, post timers) and the optional post adviser go
through Virga's server, which is Anisota's backend, cocoon, hosting Virga as a second
OAuth client.

## Status

A first pass, ported from the Analytics studio in [dame.is](https://github.com/dame-is/dame.is)
(`/admin?view=analytics`), which only its owner could use. Not deployed yet.

What has been checked, as of 2026-11-12:

- Every page (the dashboards and their editing, the six reports, the seven tools, the
  posting pages, the composer and its dialogs, settings, the front page), the first build
  and a second sync, posting, scheduling and timers end to end, two accounts and switching
  between them, against made-up data and a fake Virga server in the harness (below), at
  phone and desktop widths, in the light and dark themes.
- That a real browser sign-in starts: from a local dev server, bsky.social accepted the
  request with the original permissions and showed its sign-in page.
- Cocoon's side (the Virga client, scheduling, timers, limits and the AI endpoints) by its
  own tests, including the SQL against a real Postgres.

What has not: a real sign-in of either kind with the posting permissions, a real post, a
real long session through a deployed cocoon, and the adviser against the real AI gateway.
That needs the cocoon change deployed and someone to sign in.

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

Two build settings (in `.env.local` or the host's environment):

| Variable | Default | What |
| --- | --- | --- |
| `VITE_AUTH_MODE` | `browser` | How a new sign-in is held: `browser` (OAuth in this browser, as before) or `backend` (a long session held by Virga's server) |
| `VITE_COCOON_URL` | `https://cocoon.anisota.net` | Virga's server, for long sessions, scheduling, timers and the adviser |

Open the dev server at `127.0.0.1`, not `localhost`. A local sign-in comes back to
`127.0.0.1` (the OAuth spec doesn't allow `localhost` there), and the session belongs to
the address it was started from.

## What it shows

Virga is a workspace with five parts, in the sidebar on a desk and in the tab bar on a
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

Two more are listed under Later and aren't built: an interaction lookup and a list
manager. The list manager would need a permission Virga doesn't ask for.

**Posting**: write, schedule and look after posts, for any signed-in account.

| Page | What |
| --- | --- |
| Overview | What goes out next, the latest drafts, recent posts, live timers, and New post |
| Drafts | Bluesky's private drafts (so they're in any app that reads them), with Open, Post now, Schedule and Delete. Pictures and video in a draft stay on the device that saved them |
| Scheduled | Scheduled and queued posts by day, with a week's calendar; edit, post now, retry, remove; reorder the queue by dragging or with the keyboard. Another app's rows (Anisota shares the server) are shown read-only |
| Weekly schedule | The times each week that a queued post goes out, in a time zone, with suggestions from the archive's best times |
| Timers | Posts set to delete themselves, limit replies or turn off quotes after a while or when something happens (a number of likes, replies, quotes, …), counting down and settled |
| Posted | Your posts from the archive: reply, quote, change who can reply or quote, put on a timer, save as a template, delete. Published posts aren't edited in place |
| Templates | Posts and replies to start from, with blanks to fill (`net.anisota.feed.template` records in your repo, which Anisota reads too) |
| Library | Your posts, replies, saved posts, links, feeds and lists, ready to quote or attach |

The composer is a dialog on a desk and a full-height sheet on a phone: rich text with
mentions, hashtags and `[label](url)` links (paste a link over selected words to make
one), threads, up to four images with alt text, a video, link cards, quotes and other
embeds, replies, tags, languages and content labels, who can reply and quote, and **post
as** any signed-in account without switching the app to it. The main button posts,
schedules, adds to the queue or saves a draft (the default is a setting); a timer can be
set on the way out. It keeps an unsent post for a day if the tab closes. `n` opens it from
anywhere, `/` at the start of a word offers templates, and Ctrl or ⌘ Enter runs the main
button. A link of the form `/intent/compose?text=…&url=…&tags=…` opens it filled in.

The **post adviser** is off until it's turned on, per account, and only for long
sessions. It reads a post against goals you pick (and, if asked, proofreads it and checks
it against a reading of your style) before it goes out or when you ask, and never stops a
post: after ten seconds it lets it through. It can also describe an image for its alt
text. Settings › Posting says exactly what is sent and to whom.

Scheduling, the queue, timers and the adviser need a long session, because Virga's server
does them while the browser is closed. On a browser-session account those pages say so
and offer to reconnect. They keep running while any browser is signed in to Virga with a
long session for the account; signing out of the last one stops them until it signs in
that way again, so a sign-out with posts or timers waiting asks first. Scheduled replies
and scheduled videos aren't offered.

**Settings**: the accounts, the archive (sync, rebuild, export, ask the browser to keep
it, delete it), the dashboards, posting (languages, default reply settings, the default
action, alt text, the weekly schedule, a default timer, the adviser), appearance (theme,
density, the sidebar, the live sky), the permissions, and where the data comes from.

The first build takes a minute or two for an account with thousands of posts. After
that a sync only fetches what is new, and runs by itself when the archive is more than an
hour old.

## Signing in

Sign-in is atproto OAuth, held one of two ways (`VITE_AUTH_MODE`):

- **In the browser** (`browser`, the default): `@atproto/oauth-client-browser`, as
  before. Sessions last as long as the account's server allows a public client, often a
  week or two.
- **By Virga's server** (`backend`): cocoon signs in as a confidential client and holds
  the session; the browser keeps a `vg_` token that it sends with each request, which
  cocoon passes on to the PDS. Sessions last much longer. The client metadata lives
  under Virga's own address (`/backend/*`, rewritten to cocoon's `/virga/*` by
  `vercel.json`), so the sign-in page names Virga.

Each account keeps the way it signed in, so the two live side by side. To cut over,
deploy the cocoon side (below) and set `VITE_AUTH_MODE=backend`: new sign-ins get long
sessions, and existing browser sessions carry on until they end, with Reconnect for a
longer session in the account menu and Settings › Account.

### Several accounts

Any number of accounts can be signed in at once; the account menu switches between them
in place, and each keeps its own archive, dashboards and posting settings. The composer
can post as any of them without switching the app. An account whose session ended shows
Sign back in. Signing out of one falls to the next; Remove from this browser can also
delete what it keeps here.

### Permissions

The app asks for these and no others (`src/config.js`, where each is explained in
`PERMISSION_GROUPS`; Settings › Permissions is written from the same list):

| Permission | Why |
| --- | --- |
| `atproto` | To know who signed in |
| `rpc:app.bsky.graph.getFollowers` | Only a signed-in read carries each follower's follow record, which is what dates the growth curve |
| `rpc:app.bsky.notification.listNotifications` | Who liked, reposted, replied to, quoted and mentioned the account |
| `repo:app.bsky.graph.follow`, create and delete | The Follow buttons, Follow cleanup and the Follow-back queue |
| `repo:app.bsky.feed.post`, `repo:app.bsky.feed.threadgate`, `repo:app.bsky.feed.postgate` | Posting, replying, deleting, and who can reply and quote. Update is included because a scheduled post is written with `putRecord`, so a retry can't post twice |
| `repo:net.anisota.feed.template` | Templates, kept in your repo |
| `blob:image/*`, `blob:video/*`, `rpc:com.atproto.repo.uploadBlob?aud=*`, `rpc:app.bsky.video.getUploadLimits?aud=*`, `rpc:app.bsky.video.getJobStatus?aud=*` | Images and video. Video goes through Bluesky's video service, which needs a short-lived pass from the PDS |
| `rpc:app.bsky.draft.*` (get, create, update, delete) | Bluesky's private drafts |
| `rpc:app.bsky.actor.getPreferences`, `rpc:app.bsky.bookmark.getBookmarks`, `rpc:app.bsky.feed.searchPosts` | Your default reply settings, saved posts for the library, and post search |

The `rpc:` reads go to Bluesky's AppView (`did:web:api.bsky.app#bsky_appview`). It can't
like, repost or read messages. Everything else it reads is public and fetched without the
session. The syntax is from the [permission spec](https://atproto.com/specs/permission)
(read 2026-11-12). A session from before posting arrived lacks the posting permissions;
the composer asks for a fresh sign-in rather than failing.

A PDS that doesn't know these granular permissions will turn the sign-in down.
`transition:generic` would work there, but it grants nearly everything, so it isn't a
fallback this app uses.

## Where the data is kept

In IndexedDB, in a database per account (`virga-analytics:<did>`), so two accounts on one
browser never share rows. Signing out leaves the archive in place for next time; Settings
› Data and sync deletes it. The unfollow log and the last-activity checks live there too.

In IndexedDB too, per account (`virga-posting:<did>`): the pictures and video of drafts,
which Bluesky's drafts can't hold.

In localStorage: the accounts (`virga:accounts`, `virga:account`), each long session's
token (`virga:backend-token:<did>`), each account's dashboards (`virga:dashboards:<did>`),
posting settings (`virga:posting:<did>`), an unsent post (`virga:composer-autosave:<did>`,
for a day), a copy of its templates and how often each is used, this month's adviser
allowance, the tools' Keep lists, and the preferences for whoever is at the browser
(`virga:preferences`: theme, density, the live sky, the period, the sidebar). A long
session's token sits where any script running on the page could read it, like the
browser client's own session; Remove from this browser deletes it. sessionStorage holds a
sign-in in progress (`virga:signin-pending`), a guard against sign-in loops
(`virga:reauth-attempts`) and a compose link opened before signing in
(`virga:pending-compose`).

Dashboards kept in the account's own repo, so they follow you to another browser, would
need a permission to write that one kind of record; Settings says so rather than offering
it.

Requests go from the browser to: the account's PDS; `public.api.bsky.app`, `plc.directory`
and `constellation.microcosm.blue`, as before; `cardyb.bsky.app` for link cards;
`video.bsky.app` for video; and, for long sessions, scheduling, timers and the adviser,
Virga's server (`VITE_COCOON_URL`). A scheduled post's text and pictures wait on Virga's
server until it goes out. The adviser sends the post, your goals and notes, your style
reading and, if you ask it to read replies in their conversation, other people's public
posts, to Virga's server, which passes them to an AI model through an AI gateway; alt
text sends the image. The allowance (30 adviser reads, 3 style readings and 15
descriptions a month, more for Anisota members) is counted per account and shared with
Anisota.

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
- **On a phone,** the sidebar becomes an app bar (with New post) and five tabs at the
  bottom, cards stack one to a row (figures two to a row), Customize moves cards with
  arrows, and the composer and its dialogs are full-height sheets with the main button
  under the thumb.
- **The live sky is an easter egg.** The 3D hillside from the first version
  (`src/hillside/`) is off by default. Settings › Appearance turns it on, for the
  dashboards or everywhere, at dawn, at day, or following the archive (dawn until the
  first build). Five taps on the logo turn it on or off from anywhere. With reduced
  motion it's a still picture; without WebGL, a flat gradient of the same sky.

## The harness

`npm run harness` runs the real app with one module swapped: the session. Two made-up
accounts are signed in, every network request is answered from fixtures, and a fake
Virga server schedules, publishes and runs timers in memory, so the whole app can be
looked at and clicked through offline. Flags in the address show other states: one
account (`?accounts=1`), browser sessions (`?mode=browser`), an ended session
(`?expired=lab`), a session from before posting (`?scope=read`), membership limits,
the adviser slow or down. See `harness/README.md`.

## Deploying

Built for Vercel, and static apart from one small function. An authorization server has
to fetch the app's client metadata from the same origin the app is served from, so
`api/client-metadata.js` answers `/oauth-client-metadata.json` for whichever host it was
asked at (the production domain, or a preview). `vercel.json` routes it, rewrites
`/backend/*` to cocoon's `/virga/*`, and sends every other path to `index.html`.

On another host, serve that JSON yourself (it is the object `buildClientMetadata(origin)`
returns in `src/lib/oauthClient.js`) and proxy `/backend/*` the same way.

Long sessions, scheduling, timers and the adviser need cocoon's Virga client deployed
(`docs/VIRGA_CLIENT.md` in the cocoon repo), in this order:

1. Apply cocoon's migration `039_virga_oauth_client.sql`.
2. Set cocoon's `VIRGA_OAUTH_PRIVATE_KEY_1` (an ES256 JWK as JSON; `_2` and `_3` are
   optional, for rotating keys; cocoon's `docs/VIRGA_CLIENT.md` says how to make one),
   `VIRGA_FRONTEND_URL` (Virga's origin, plus `VIRGA_EXTRA_FRONTEND_URLS` for any other
   exact origin) and
   `VIRGA_OAUTH_PUBLIC_BASE=https://<virga origin>/backend`. The base is the client_id's
   home, so it must not change once anyone has signed in. Optionally
   `VIRGA_FEATURE_LIMITS=flat`.
3. Keep `/backend/*` on Virga's deployment free of deployment protection, so the
   authorization server can fetch the metadata.
4. Set Virga's `VITE_AUTH_MODE=backend` (and `VITE_COCOON_URL` if cocoon lives elsewhere).

## How the code is laid out

| Where | What |
| --- | --- |
| `src/shell/` | The signed-in frame: sidebar, app bar and tabs, page header, sync status, routing, shortcuts |
| `src/session/` | Signing in both ways, the accounts, switching, the backend fetch handler, session checks |
| `src/accounts/` | The account menu, Settings › Account, the sign-in notices |
| `src/posting/lib/` | Rich text and facets, the composer model, images, video, link cards, gates, `publish()` |
| `src/posting/{drafts,templates,library,schedule,timers,adviser}/` | Each posting feature's logic, without UI |
| `src/posting/composer/`, `pages/`, `ui/` | The composer, the posting pages and the shared posting components |
| `src/archive/` | The archive hook (IndexedDB and the sync) and the context that shares it |
| `src/reports/models.js` | Every number, as pure functions of the archive and a period, cached per sync |
| `src/dashboards/` | Layouts, the card library and the cards themselves |
| `src/reports/`, `src/tools/`, `src/settings/` | The pages |
| `src/charts/` | The time series, sparklines, heatmaps and bar lists |
| `src/lib/router.jsx` | Real paths (`/dashboard/:id`, `/reports/:report`, `/tools/:tool`, `/posting/:page`, `/settings/:section`) on the History API |

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
- `src/session/`, `src/accounts/` and `src/posting/`: Anisota (its backend sign-in, account
  switcher, composer, drafts, templates, library, scheduling, self-destructing posts and
  post adviser), rebuilt for Virga's look and many accounts; the pure modules and their
  tests are ported close to verbatim.
