# Virga

Analytics for a Bluesky account and the rest of its atproto repo, and a place to write,
schedule and look after its posts. Anyone can sign in with their handle and see their own
numbers: followers, blocks, posts, engagement, the people behind it, and what every app has
written to their repo. Several accounts can be signed in at once.

The numbers are worked out in the browser. The app reads from the signed-in account's PDS,
Bluesky's public API and Constellation, and keeps what it gathers in that browser's
IndexedDB; the archive is never sent anywhere. What has to happen while the browser is
closed (long sessions, scheduled posts, post timers) and the optional post adviser go
through Virga's server: Vercel functions in this repo (`api/`, `server/`) with their own
Supabase database (`supabase/migrations/`). The server also keeps the record that an
account agreed to the [Terms of Service](TERMS_OF_SERVICE.md) and
[Privacy Policy](PRIVACY_POLICY.md), which every account is asked to do on the way in.

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
- Virga's server (sign-in, the XRPC proxy, scheduling, timers, limits and the AI
  endpoints) by its own tests, with the SQL run on PGlite (Postgres in WebAssembly), and the
  real client modules talking to the real server handlers in-process.

And, as of 2026-11-14: the sign-in a step at a time (suggestions, "Is this you?", the
card before the browser leaves, the hosts for a new account, Add an account), the
agreement screen on a long session and on a browser session, with the server recording
it and with the server down, and the Terms and Privacy pages, in the harness at phone
and desktop widths in both themes. The agreement ledger's SQL and both of its routes by
their own tests on PGlite. That the five hosts offered for a new account answer, and say
they take a request for their make-an-account page (their
`/.well-known/oauth-authorization-server`, read that day).

What has not: a real sign-in of either kind with the posting permissions, a real post, a
real long session against a deployed server and Supabase project, the crons firing on
Vercel, the adviser against the real AI gateway, an account actually made at one of the
hosts, and an agreement written to a real Supabase project. That needs a deployment
(below) and someone to sign in.

The Terms of Service and the Privacy Policy are drafts too, written to match what the
code does and what Anisota's say about the same operator. They have not been read by a
lawyer, and should be before anyone is asked to agree to them.

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
| `VITE_BACKEND_URL` | `''` (this site) | Where Virga's server is. Leave it empty in a deployment; set it only to point a local dev server at a deployed one |

The server's own settings are in `.env.example` and under Deploying below.

`npm run dev` is plain Vite and runs none of the server's functions. To work on the
server locally, either run `vercel dev` (the Vercel CLI runs Vite and the functions on
one origin), or point `VITE_BACKEND_URL` at a deployment that lists
`http://127.0.0.1:5173` in its `OAUTH_EXTRA_RETURN_ORIGINS`. A real long-session sign-in
needs the server on a public https origin, because the account's server fetches its
client metadata; the harness needs no server at all.

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
| Scheduled | Scheduled and queued posts by day, with a week's calendar; edit, post now, retry, remove; reorder the queue by dragging or with the keyboard |
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

The front page and Add an account share one sign-in, a step at a time
(`src/signin/`, after Anisota's):

1. **Type a handle.** Accounts that match are suggested as it is typed, from Bluesky's
   public search (from the second character; not for a DID or an address). A pasted
   bsky.app profile link is reduced to its handle.
2. **"Is this you?"** The account is looked up before the browser goes anywhere: its
   name and picture from the public profile, its PDS from its DID document, and the page
   it signs in on from that PDS's own `/.well-known/oauth-protected-resource` (Bluesky's
   PDSes sign in at bsky.social). A handle nobody has stops here, in words. If the
   lookup itself fails, the reader can go on anyway.
3. **"Taking you to bsky.social…"** The card that names the host stays for three and a
   half seconds (`LEAVE_DELAY_MS`, the time Anisota gives it) with Cancel, then the
   browser leaves. If it is still here four seconds later, the card offers to try again.
4. **Make an account** lists five hosts (`src/signin/hosts.js`). Choosing one starts a
   sign-in with the host's address in place of a handle and `prompt=create`, which opens
   the host's page on making an account; a host that turns the prompt down is asked again
   without it.

A host's address typed into the field (`https://pds.example.com`) signs in there without
naming an account. The accounts this browser remembers are listed above the field, as
before.

Sign-in is atproto OAuth, held one of two ways (`VITE_AUTH_MODE`):

- **In the browser** (`browser`, the default): `@atproto/oauth-client-browser`, as
  before. Sessions last as long as the account's server allows a public client, often a
  week or two.
- **By Virga's server** (`backend`): the server (`server/oauth/`) signs in as a
  confidential client, keeps the session in Supabase (encrypted with
  `SESSION_ENCRYPTION_KEY`), and hands the browser a `vg_` token that it sends with each
  request; `/api/oauth/proxy` passes the account's calls on to its PDS. Sessions last much
  longer. The client's metadata, keys and callback are at
  `/api/oauth/client-metadata.json`, `/api/oauth/jwks.json` and `/api/oauth/callback` on
  `OAUTH_PUBLIC_URL`, so the sign-in page names Virga.

Each account keeps the way it signed in, so the two live side by side. To cut over,
deploy the server (below) and set `VITE_AUTH_MODE=backend`: new sign-ins get long
sessions, and existing browser sessions carry on until they end, with Reconnect for a
longer session in the account menu and Settings › Account.

### Agreeing to the terms

An account that signs in is shown the agreement screen before the app: its name, the
two documents (each opens in place), a box to tick and one button. Nothing of the app is
mounted, and nothing is read for the account, until it agrees; the other way on is Sign
out. The screen comes back for an account that hasn't agreed to the current version,
which means a first sign-in, another browser, or a change to the documents.

- **Which documents.** `src/legal/version.js` holds `TERMS_VERSION` and the date both
  documents carry. The browser's gate and the server's ledger both read it from there.
  Raise the version when a change should be agreed to again. A test keeps a fingerprint
  of both documents beside the version, so an edit to either fails until someone decides.
- **The record.** `POST /api/terms/accept` adds a row to `virga_terms_acceptance`: the DID, the
  version and date, the time, and the address and User-Agent the request came from. The
  server's key can add and read rows but not change or delete them. One row per account
  per version: agreeing again finds the first.
- **A long session** is recorded from the session, so the DID is one the account's host
  vouched for, and the screen stays up until the server has the row. A new browser asks
  `GET /api/terms/status` first, so an account that agreed elsewhere isn't asked twice.
- **A browser session** has no session with Virga's server, so the agreement is kept in
  the browser and reported with the DID in the body. The row is marked `claimed`, never
  counts as a long session's agreement, and the report is tried again on later visits
  until it lands. `TERMS_ACCEPT_CLAIMED=false` turns those off.

The documents are `TERMS_OF_SERVICE.md` and `PRIVACY_POLICY.md` at the repo's root. The
pages at `/terms` and `/privacy` are drawn from those same files (`src/legal/markdown.js`
reads the Markdown they use, and a test holds them to it), and both sign-in clients name
the pages as their `tos_uri` and `policy_uri`, so an account's host can link them from
its consent screen.

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
allowance, the tools' Keep lists, a note that the account agreed to the terms
(`virga:terms-accepted:<did>`), and the preferences for whoever is at the browser
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
`video.bsky.app` for video; `cdn.bsky.app` for pictures; and, for long sessions,
scheduling, timers, the adviser and the agreement to the terms, Virga's server (this
site's `/api/*`). Signing in sends the handle being typed to `public.api.bsky.app`; a
browser session's library also resolves it at `bsky.social`, and Virga's server looks it
up at `dns.google` for a long one. A scheduled post's text and pictures wait in Virga's
Supabase project until it goes out. The pictures (in a private Storage bucket) are
removed after publishing; the row, with the text, stays, and so does a timer's row once
it has ended. Nothing deletes those yet. The Privacy Policy lists everything kept and
sent, and has to be kept true to the code. The adviser sends the post, your goals and notes, your style
reading and, if you ask it to read replies in their conversation, other people's public
posts, to Virga's server, which passes them to an AI model through an AI gateway; alt
text sends the image. The allowance (by default 30 adviser reads, 3 style readings and
15 descriptions a month; the server's `AI_*_MONTHLY_LIMIT` settings change it) is counted
per account.

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
(`?expired=lab`), a session from before posting (`?scope=read`), limits
(`?limits=3,1,1`, `?ailimits=…`), the adviser slow or down, the agreement screen
(`?terms=ask`, `?terms=down`). See `harness/README.md`.

## Deploying

Built for Vercel with a Supabase project. The front end is static; the server is seven
functions: `api/client-metadata.js` (the browser client's metadata, per host, as before)
and one function per area, `api/{oauth,schedule,self-destruct,ai,limits,terms}/[action].js`,
each dispatching to the handlers in `server/`. `vercel.json` sets their time limits,
rewrites the two OAuth `.json` addresses, sends every other path to `index.html`, and
runs two crons every minute: `/api/schedule/run` (scheduled posts) and
`/api/self-destruct/run` (post timers).

Without the server settings below, the app still works with browser sign-ins; the
server's routes answer 503 and the posting pages that need it say so.

1. **Supabase.** Make a project of Virga's own and apply `supabase/migrations/` in order
   (`supabase link` then `supabase db push`, or paste each file into the SQL editor). They
   create the sign-in, scheduled-post, timer, AI-usage and terms-agreement tables
   (row-level security on, nothing for the `anon` or `authenticated` roles; only the
   server's service-role key reads them) and a private Storage bucket, `scheduled-media`.
   Its own project, not one another app's server already uses: the sign-in, scheduled-post
   and timer tables have the names Anisota's backend gives its own (`oauth_sessions`,
   `frontend_sessions`, `scheduled_posts`, `self_destruct_posts`), and `CREATE TABLE IF NOT
   EXISTS` would quietly leave the two sharing rows. Apply a new migration before deploying
   the code that needs it: without `virga_terms_acceptance`, an account on a long session
   can't get past the agreement screen.
2. **A signing key.** `node scripts/generate-oauth-key.js` prints an ES256 key as
   `OAUTH_PRIVATE_KEY_1`. Keep it secret; `_2` and `_3` are for rotating keys.
3. **Vercel settings** (Production only; see `.env.example` for every option and its
   default):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `OAUTH_PUBLIC_URL`: the production origin, e.g. `https://virga.example`. The
     client_id hangs off it, so it must not change once anyone has signed in, and one
     Supabase project serves one public URL.
   - `OAUTH_PRIVATE_KEY_1`, and `SESSION_ENCRYPTION_KEY` (`openssl rand -hex 32`), which
     encrypts the stored sessions
   - `CRON_SECRET` (a long random string): Vercel sends it to the crons, and the run
     endpoints refuse anything without it in production
   - `AI_GATEWAY_API_KEY`, for the adviser and alt text (optional; without it they answer
     503)
   - `TERMS_ACCEPT_RATE_LIMIT` and `TERMS_ACCEPT_CLAIMED`, for the agreement ledger
     (optional; see `.env.example`). `OAUTH_TOS_URL` and `OAUTH_POLICY_URL` only if the
     consent screen should link somewhere other than this site's `/terms` and `/privacy`
   - `VITE_AUTH_MODE=backend`, to give new sign-ins long sessions
4. **Keep `/api/oauth/*` outside Vercel's deployment protection**, so an account's server
   can fetch the client metadata and keys for the life of every sign-in. After deploying,
   `curl https://<origin>/api/oauth/client-metadata.json` should show a `client_id` that
   is exactly that URL.

Preview deployments get no OAuth key (keep the server settings to Production), so they
answer 503 on the sign-in routes and stay on browser sign-ins.

**Crons.** Scheduled posts and timers go out within about a minute of their time because
the crons run every minute. That needs a paid Vercel plan: on Hobby, Vercel refuses to
deploy a cron that runs more than once a day, so the whole site fails to deploy, browser
sign-ins included. On Hobby, delete the `crons` entries from `vercel.json`, then call the
two run paths every minute from somewhere else, for example Supabase's `pg_cron` and
`pg_net`:

```sql
select cron.schedule('virga-schedule', '* * * * *', $$
  select net.http_get(
    url := 'https://<origin>/api/schedule/run',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 60000)
$$);
select cron.schedule('virga-timers', '* * * * *', $$
  select net.http_get(
    url := 'https://<origin>/api/self-destruct/run',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 60000)
$$);
```

**Limits.** By default an account can hold 50 scheduled posts and 200 live timers at once
(`SCHEDULE_MAX_PENDING`, `TIMER_MAX_ACTIVE_PER_USER`), with no finer caps; set
`SCHEDULED_POSTS_LIMIT`, `POST_TIMERS_LIMIT` or `CONDITIONAL_TIMERS_LIMIT` to add them.
The AI allowances are `AI_ADVISER_MONTHLY_LIMIT`, `AI_STYLE_MONTHLY_LIMIT` and
`AI_ALT_TEXT_MONTHLY_LIMIT` (a number, or `unlimited`), with `AI_DAILY_LIMIT` as a
per-account daily ceiling.

On another host than Vercel, serve the browser client's metadata yourself (the object
`buildClientMetadata(origin)` returns in `src/lib/oauthClient.js`), run the `api/`
handlers as Node functions with the same paths, and call the two run paths every minute.

## How the code is laid out

| Where | What |
| --- | --- |
| `src/shell/` | The signed-in frame: sidebar, app bar and tabs, page header, sync status, routing, shortcuts |
| `src/session/` | Signing in both ways, the accounts, switching, the backend fetch handler, session checks |
| `src/signin/` | The sign-in a step at a time: the handle field and its suggestions, the account and host lookup, the steps and their words, the hosts for a new account |
| `src/legal/` | The Terms and Privacy pages (drawn from the Markdown at the root), the version both sides agree on, the agreement screen and what it keeps |
| `src/accounts/` | The account menu, Settings › Account, the sign-in notices |
| `src/posting/lib/` | Rich text and facets, the composer model, images, video, link cards, gates, `publish()` |
| `src/posting/{drafts,templates,library,schedule,timers,adviser}/` | Each posting feature's logic, without UI |
| `src/posting/composer/`, `pages/`, `ui/` | The composer, the posting pages and the shared posting components |
| `api/` | The server's Vercel functions: one per area, each a thin router |
| `server/oauth/` | The long-session sign-in: client metadata, keys, tokens, the XRPC proxy, uploads |
| `server/schedule/`, `server/timers/`, `server/ai/`, `server/limits/` | Scheduled posts and their worker, post timers and their worker, the adviser and alt text, limits |
| `server/terms/` | The ledger of who agreed to the Terms and Privacy Policy, and its two routes |
| `server/` | Shared server pieces (Supabase, HTTP helpers, cron auth, safe fetching) and test helpers (`server/test/`) |
| `supabase/migrations/` | The server's database |
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
- `server/`: Anisota's backend (cocoon), cut down to one app.
- `src/session/`, `src/accounts/` and `src/posting/`: Anisota (its backend sign-in, account
  switcher, composer, drafts, templates, library, scheduling, self-destructing posts and
  post adviser), rebuilt for Virga's look and many accounts; the pure modules and their
  tests are ported close to verbatim.
- `src/signin/`, `src/legal/` and `server/terms/`: Anisota's sign-in card (the porch) and
  its terms gate, and cocoon's acceptance ledger. The steps, the timings and the host
  list are Anisota's; the code is written for Virga, and differs where the review of
  Anisota's found gaps: the server names the version rather than taking it from the
  caller, one row per account per version, a limit per minute, and a record the server's
  key can't alter.
