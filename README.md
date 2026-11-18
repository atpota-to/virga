# Virga

Analytics for a Bluesky account and the rest of its atproto repo, and a place to write,
schedule and look after its posts. Anyone can sign in with their handle and see their own
numbers: followers, blocks, posts, engagement, the people behind it, and what every app has
written to their repo. Several accounts can be signed in at once.

The numbers are worked out in the browser. The app reads from the signed-in account's PDS,
Bluesky's public API and Constellation, and keeps what it gathers in that browser's
IndexedDB; the archive is never sent anywhere. What has to happen while the browser is
closed (long sessions, scheduled posts, post timers) and the optional post adviser go
through Virga's server: Vercel functions in this repo (`api/`, `server/`) with a schema of
their own, `virga`, in a Supabase database (`supabase/migrations/`). The server also keeps
the record that an account agreed to the [Terms of Service](TERMS_OF_SERVICE.md) and
[Privacy Policy](PRIVACY_POLICY.md), which every account is asked to do on the way in.

## Status

A first pass, ported from the Analytics studio in [dame.is](https://github.com/dame-is/dame.is)
(`/admin?view=analytics`), which only its owner could use. Not deployed yet.

What has been checked, as of 2026-11-12:

- Every page (the dashboards and their editing, the reports, the tools, the
  posting pages, the composer and its dialogs, settings, the front page), the first build
  and a second sync, posting, scheduling and timers end to end, two accounts and switching
  between them, against made-up data and a fake Virga server in the harness (below), at
  phone and desktop widths, in the light and dark themes.
- That a real browser sign-in starts: from a local dev server, bsky.social accepted the
  request with the original permissions and showed its sign-in page.
- Virga's server (sign-in, the XRPC proxy, scheduling, timers, limits and the AI
  endpoints) by its own tests, with the SQL run on PGlite (Postgres in WebAssembly), and the
  real client modules talking to the real server handlers in-process.

Added on 2026-11-14, and checked the same way (the harness, at phone and desktop
widths, and each piece's own tests): the Content report and richer post rows, including
the one-time upgrade of an older archive; card settings, custom date ranges and the
Posting cards; chart notes and follower milestones; Post this chart; the Interaction
lookup; the accents, high contrast and the dusk and night skies; number, date and week
formats; thread splitting and the command palette; scheduled replies, repeating posts
and Post again. Not everything was looked at in every combination: the accents and high
contrast were looked at on the dashboard and Settings, not on every page; the sky only
with software rendering; the scheduling pages not in the dark theme; and only Chromium
was used.

And, as of 2026-11-14: the sign-in a step at a time (suggestions, "Is this you?", the
card before the browser leaves, the hosts for a new account, Add an account), the
agreement screen on a long session and on a browser session, with the server recording
it and with the server down, and the Terms and Privacy pages, in the harness at phone
and desktop widths in both themes. The agreement ledger's SQL and both of its routes by
their own tests on PGlite. That the five hosts offered for a new account answer, and say
they take a request for their make-an-account page (their
`/.well-known/oauth-authorization-server`, read that day).

Changed over to the Quiet sky look on 2026-11-16 (The look, below), and checked in the
harness by screenshot. Every page (41 addresses: the dashboards and customizing one, each
report, each posting page, each tool, each settings section, the legal pages, the front
page and an address that names nothing) at 360, 390, 820, 1180, 1440 and 1920 wide by
day, at 390 and 1440 at night, at 1180 at dusk and at 820 at dawn, with no console errors
and no page that scrolls sideways. The composer, its menus and dialogs and the adviser,
the sign-in a step at a time, the agreement screen, the account menu, the command
palette, a build under way and the first run, at phone and desktop sizes. High contrast
by day and at night, compact density, the folded sidebar and the other five accents were
looked at on the dashboard and on a few pages of each part, not on every page. Not
looked at: forced colours beyond one dashboard, a real on-screen keyboard over the
phone's composer, dragging a card or a report on a touch screen, a queue with more than
one post in it, the live sky on real graphics hardware, and any browser but Chromium.

Fine-tuned on 2026-11-17 for calm and consistency, above all on phones. Every page was
reviewed at each size and the findings became one set of rules: the controls the app may
use and what each one is for, the shape of a page header and of a list row, and the type
and spacing scales (The look, below). Each part of the app was then changed to follow
them, reviewed by a second pair of eyes, and the whole app reviewed again. It was checked by
measurement as well as by screenshot, with touch on for the phone sizes. Each header's
height and the height of its rows and pages, the number of distinct control styles and
type sizes in use, and the place each menu opens all stayed within set targets at 360, 390,
820, 1180, 1440 and 1920, by day and at night, with Compact density, high contrast and
forced colours looked at too. Not looked at, as before: a real on-screen keyboard,
dragging on a touch screen, and any browser but Chromium.

Added on 2026-11-17: Defense's second phase, scanning a post (below, and
[docs/DEFENSE.md](docs/DEFENSE.md)). Checked by its own tests (the scan, the canary's
candidates, the radar's layout, the page's words, the in-memory store, the scope a sign-in
asks for with and without Defense, the server's login route picking between its two scopes),
by the real scan run against the harness's crowd, and in the harness at 1440, 1180, 430, 390
and 360 wide, by night and by day: Turn on Defense, a scan of a post with its progress, the
radar and its callout, the list, an AppView that fails open, and a link that isn't a post,
with no console errors and no page that scrolls sideways. Not looked at: a real scan against
Bluesky's AppView and Constellation, a real sign-in asking for the extra permission, the
radar in high contrast and forced colours, or a phone's touch on the radar.

What has not: a real sign-in of either kind with the posting permissions, a real post, a
real long session against a deployed server and Supabase project, the crons firing on
Vercel, the adviser against the real AI gateway, an account actually made at one of the
hosts, and an agreement written to a real Supabase project. For the newer pieces that
also means: a scheduled reply's check that the post it answers is still there, a
repeating post under two workers at once (the tests run them one after the other), the
archive upgrade against a real repo, and Safari, Firefox and a Mac's ⌘K. That needs a
deployment (below) and someone to sign in.

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
| `VITE_DEFENSE` | off | `on` shows Defense. Off until the Terms and the Privacy Policy describe it (docs/DEFENSE.md); the harness turns it on |

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

Virga is a workspace with six parts. On a desk they are the sidebar; on a phone five of
them are the bar along the bottom, and Settings is behind the account.

**Dashboards** are sets of report cards you arrange yourself. Three come to start with
(Overview, Growth, Content); make more, rename, duplicate, reorder or delete them.
Customize turns a dashboard's cards into things to arrange: drag a card by its handle (or
move it with the arrow buttons), pick a size (a quarter, a third, half, two thirds or the
whole row), remove it, or add any of 36 cards from the report library beside the grid,
by its plus or by dragging it to where it should go.
Every card answers for the period picked in the header (7 days to all time, or a range of
dates you pick), and links to its full report. A card's settings, the gear in Customize,
can give it a title, a period of its own (it then says which, and stays put when the
header changes), one kind of engagement to count, and a number of rows. Besides the
numbers there are Posting cards (what goes out next, the latest drafts, timers counting
down), so a dashboard can hold both halves of Virga. The cards are listed in
`src/dashboards/catalog.js`.

**Reports**, one page each, with every chart's numbers also available as a table, a
note on how they're counted, an export, Add to dashboard, and Post this chart:

| Report | What | Where it comes from |
| --- | --- | --- |
| Followers | Growth over time, new per day or week, the newest followers and the biggest days | `app.bsky.graph.getFollowers`, signed in. Each follower's follow record has a key that dates it |
| Blocks | Who blocks the account directly or through a moderation list, over time | Constellation backlinks, then the lists' own records from the public API |
| Posts | Posts per day, week or month, share of replies, quotes and media | `app.bsky.feed.getAuthorFeed` on the public API |
| Content | What your posts are made of and what each kind typically earns: by format (text, images, video, link card, GIF, quote), length, place in a thread, tag and linked site, and how much of your media has alt text | Each post's own record: its facets, embed, tags and languages |
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
| Archive search and export | Search every post by its words, its tags (`#bees`) and the sites it links to, filter by kind and window, export CSV or JSON | Read only |
| Interaction lookup | Your whole history with one account, each way: who follows whom and since when, likes, reposts, replies, quotes and mentions by kind and by month, and every event as a dated list with links, filters and a CSV export | Read only. Them to you comes from notifications, which reach back a year at most; you to them from the repo and your posts |
| Identity inspector | DID, handle, PDS, the DID's handle and server history, what's in the repo | Read only, plus the PLC directory's audit log |

One more is listed under Later and isn't built: a list manager, which would need a
permission Virga doesn't ask for.

**Notes and milestones.** Followers, Posts and Engagement each end with a notes card: a
day and a few words ("Changed my handle", "The zine went out"), marked on every chart
over time, on the reports and the dashboards. The follower charts also mark the round
numbers the count has passed (1,000, 2,500, 5,000, …) on the day the follower who made
each one arrived. Those are counted from the followers the account has today, so the
real count got there on that day or a little before.

**Post this chart** (on a report, or the picture button on a dashboard card) draws the
card as a 1200 by 675 picture under the sky on screen, and writes its alt text from the
chart's own numbers: what it shows, whose, over what window, where it starts and ends,
its highest and lowest point, anything marked on it, and every value while the chart is
short enough to list. The description can be edited; the picture can be saved, or opened
in the composer already attached and described. Nothing is posted from the dialog.

**Posting**: write, schedule and look after posts, for any signed-in account.

| Page | What |
| --- | --- |
| Overview | What goes out next, the latest drafts, recent posts, live timers, and New post |
| Drafts | Bluesky's private drafts (so they're in any app that reads them), with Open, Post now, Schedule and Delete. Pictures and video in a draft stay on the device that saved them |
| Scheduled | Scheduled and queued posts by day, with a week's calendar; edit, post now, retry, remove; skip one occurrence of a repeating post or stop it repeating; reorder the queue by dragging or with the keyboard |
| Weekly schedule | The times each week that a queued post goes out, in a time zone, with suggestions from the archive's best times |
| Timers | Posts set to delete themselves, limit replies or turn off quotes after a while or when something happens (a number of likes, replies, quotes, …), counting down and settled |
| Posted | Your posts from the archive: reply, quote, change who can reply or quote, put on a timer, save as a template, delete, or post again (opens it in the composer with its words, links, tags, languages, quote or link card and pictures, to post, schedule or queue). Published posts aren't edited in place |
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

A post that runs past 300 characters offers to split itself into a thread, right under
its text. The cuts fall at paragraph breaks, then sentence ends, then between words,
never inside a link, a mention, a hashtag or an emoji, and each post is counted the way
Bluesky counts it. The posts can be numbered (2/5, on a line of their own at the end; off
unless Settings › Posting or the box on the offer says so). Undo, or Ctrl or ⌘ Z, puts
the original text back, and a numbered thread that has changed since offers Renumber.

A reply can be scheduled for a set time, though not added to the queue. A post scheduled
for a set time can repeat every day, week, two weeks or month, ending never, on a date or
after a number of times.

Ctrl K (⌘K on a Mac) opens a command palette: go to any dashboard, report, tool, posting
page or settings section, start a post, sync, set the period or the sky, switch
account, or customize the dashboard you're on. The sidebar's Search or jump to opens it
too, as does the search button in the phone's app bar.

The **post adviser** is off until it's turned on, per account, and only for long
sessions. It reads a post against goals you pick (and, if asked, proofreads it and checks
it against a reading of your style) before it goes out or when you ask, and never stops a
post: after ten seconds it lets it through. It can also describe an image for its alt
text. Settings › Posting says exactly what is sent and to whom.

Scheduling, the queue, timers and the adviser need a long session, because Virga's server
does them while the browser is closed. On a browser-session account those pages say so
and offer to reconnect. They keep running while any browser is signed in to Virga with a
long session for the account; signing out of the last one stops them until it signs in
that way again, so a sign-out with posts or timers waiting asks first. Scheduled videos
aren't offered.

A scheduled reply goes out only if the post it answers is still there at its time:
Virga's server asks that post's PDS first, and if the post is gone the reply isn't posted
and the Scheduled page says why; if it can't find out, it tries again before giving up. A
repeating post has one occurrence waiting at a time and counts as one scheduled post.
When an occurrence goes out, fails for good or is skipped, the next is created at the
same wall-clock time in the zone it was scheduled in, so 9:00 stays 9:00 across a clock
change and the 31st falls on the last day of a shorter month. A failed occurrence stays
listed to retry while the series carries on. Each occurrence is its own post; a reply
can't repeat.

**Settings**: the accounts, the archive (sync, rebuild, export, ask the browser to keep
it, delete it), the dashboards, posting (languages, default reply settings, the default
action, numbering a split thread, alt text, the weekly schedule, a default timer, the adviser), appearance (the sky,
the accent, contrast, density, the sidebar, how numbers, dates and the week are written, the
live sky), the permissions, and where the data comes from.

The first build takes a minute or two for an account with thousands of posts. After
that a sync only fetches what is new, and runs by itself when the archive is more than an
hour old.

## Defense

The sixth part, for moderation and defence, being ported from
[bluesky-mod](https://github.com/dame-is/bluesky-mod) as a hosted feature:
[docs/DEFENSE.md](docs/DEFENSE.md) is the plan, and
[docs/DEFENSE-THREATS.md](docs/DEFENSE-THREATS.md) its threat model. Four of its phases are
built: the engine (`src/defense/`: the harvest from Constellation, the
scoring and its canary), **Scan a post**, at `/defense`, **lists**: adding who a scan found
to a block or mute list in your own repo, at `/defense/lists` and `/defense/history`, and
**the moderator**: a Bluesky account you link from Defense › Lists and DM posts and
commands to (a post to scan, "approve 3f9a2c1b UNKNOWN", "block @someone", "undo",
"history"; `src/defense/command.js` is the grammar). Closing replies when strangers arrive
is still to come. It is all off unless
the build says `VITE_DEFENSE=on`, and writes nothing unless the server says
`DEFENSE_WRITES=on`.

A scan takes a link to any post, or one of yours from the last 30 days that people have been
answering, and finds everyone who engaged with it (from Constellation, so the people you
already block or mute are counted too). Each is put in a band by one thing, how many of the
people you follow also follow them, read live from Bluesky with your own session: protected
(you follow them), connected, peripheral (one or two of your follows follow them, or they
follow you), notable (widely followed, no connection) and no connection, most of any
pile-on. The result is the radar (you at the centre, a ring a band,
a slice what they did), its table, the list of everyone near you with what they did and who
you know in common, and an Export of the lot. Nothing is kept: the scan stays in the tab's
memory until another replaces it. A batch whose counts the AppView quietly left off is
caught by a canary and asked again, and scored from nothing if it never comes right
(docs/DEFENSE.md says why).

It needs one permission the ordinary sign-in doesn't ask for, so it starts with **Turn on
Defense**, which signs the account in again asking for it as well; Turn off signs in again
without it. Accounts that haven't turned it on are asked for exactly what they were asked for
before.

**Add to a list**, under a scan's result, takes the bands you tick (no connection, to start
with; never protected) to a list you pick or make. A confirmation says how many and how long.
Virga's server then writes them a batch every two minutes as the account (about 1,500 an
hour, under the PDS's limit), so it takes a long session and one more permission, asked for
when you first make a list: making list records and adding and removing their items. At
every write the veto is read again, fresh, and anyone you follow by then, keep by hand, or
have on a curation list of yours is left off; if that can't be read, nothing is written.
**Lists** shows each list, how many are on it and how many are still being written, and the
people you keep off every list. **History** shows each approval and everyone added or taken
off, with your words, and undoes an approval or one person by the very record each add
wrote. The lists are in your own repo, on your profile; block or mute one in Bluesky for it
to take effect for you.

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
mounted, and nothing of the archive is read, until it agrees (the screen itself reads the
account's public profile, for its name); the other way on is Sign out. The screen comes
back for an account that hasn't agreed to the current version, which means a first
sign-in, another browser on a browser session, or a change to the documents.

- **Which documents.** `src/legal/version.js` holds `TERMS_VERSION` and the date both
  documents carry. The browser's gate and the server's ledger both read it from there.
  Raise the version when a change should be agreed to again. A test keeps a fingerprint
  of both documents beside the version, so an edit to either fails until someone decides.
- **The record.** `POST /api/terms/accept` adds a row to `terms_acceptance` in the `virga` schema: the DID, the
  version and date, the time, and the address and User-Agent the request came from. The
  server's key can add and read rows but not change or delete them.
- **A long session** is recorded from the session, so the DID is one the account's host
  vouched for, and the screen stays up until the server has the row. One row per account
  per version: agreeing again finds the first. A new browser asks `GET /api/terms/status`
  first, so an account that agreed elsewhere isn't asked twice.
- **A browser session** has no session with Virga's server, so the agreement is kept in
  the browser and reported with the DID in the body, by a route that takes no token. The
  row is marked `claimed` and is a note, not the account's record: anyone could name any
  account. So it never counts as a long session's agreement (an account that later takes
  a long session is asked once more), it is kept once per account, version and address,
  the answer says nothing about what was already there, and one address can file 50 new
  ones a day (`TERMS_CLAIMS_PER_ADDRESS_PER_DAY`), counted in the database. The report is
  tried again on up to five later visits; after that the note in the browser is the only
  record. `TERMS_ACCEPT_CLAIMED=false` turns claims
  off.

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
| `rpc:app.bsky.actor.getProfiles`, **only once Defense is turned on** | How many of the people you follow follow each account a scan finds, which only a signed-in read of their profiles carries |
| `repo:app.bsky.graph.list` (create) and `repo:app.bsky.graph.listitem` (create, delete), **only once Defense makes lists** | Making a block or mute list in your repo, and adding and taking off the people you approved. Never a block or a mute itself, and never anyone you follow |

The client metadata declares all of these, Defense's included (`DECLARED_SCOPE`); a sign-in
asks for `OAUTH_SCOPE`, or `DEFENSE_SCOPE` for an account that has turned Defense on, and an
authorization server grants a request for less than was declared. The `rpc:` reads go to
Bluesky's AppView (`did:web:api.bsky.app#bsky_appview`). It can't
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

A post's row keeps its whole text, its counts, and what it is made of: its length, tags,
link hosts, mentions, media kind and how much of it is described, languages, and the
thread it belongs to (`POST_ROW_VERSION` 2 in `src/lib/analytics.js`). An archive built
before that has shorter rows; its next sync brings them up from the repo's own post
records, in the one download it already makes, keeping every count. Until then the
Content report says it needs a sync, and the archive search says what it can't see yet.

In IndexedDB too, per account (`virga-posting:<did>`): the pictures and video of drafts,
which Bluesky's drafts can't hold.

In localStorage: the accounts (`virga:accounts`, `virga:account`), each long session's
token (`virga:backend-token:<did>`), each account's dashboards (`virga:dashboards:<did>`),
posting settings (`virga:posting:<did>`), an unsent post (`virga:composer-autosave:<did>`,
for a day), a copy of its templates and how often each is used, this month's adviser
allowance, the tools' Keep lists, its chart notes (`virga:annotations:<did>`), a note
that the account agreed to the terms (`virga:terms-accepted:<did>`), and the preferences
for whoever is at the browser (`virga:preferences`: the sky, the accent, contrast, density,
the live sky, the period or range of dates, the sidebar, and how numbers, dates and the
week are written). A long
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
up at `dns.google` for a long one. Post again reads a post's pictures back from the
account's PDS (`com.atproto.sync.getBlob`). A Defense scan asks Constellation for
everything pointing at the post it scans (anyone's post), and asks Bluesky about everyone it
finds: their profiles signed in, and who you follow and who follows you from
`public.api.bsky.app`, without the session; none of it goes to Virga's server. The Privacy
Policy doesn't say this yet (docs/DEFENSE.md, Phase 2, as built). A scheduled post's text and pictures wait in
Virga's schema in Supabase until it goes out. The pictures (in a private Storage bucket)
are removed after publishing, or for a repeating post once its last occurrence has gone
out or it is removed; the row, with the text, stays, and so does a timer's row once it
has ended. Nothing deletes those yet. A scheduled reply's row also keeps the handle, name
and first 300 characters of the post it answers, and before it goes out Virga's server
resolves that post's account (at `plc.directory`, or its did:web host) and asks its PDS,
without signing in, whether the post is still there. The Privacy Policy lists everything
kept and sent, and has to be kept true to the code. The adviser sends the post, your goals and notes, your style
reading and, if you ask it to read replies in their conversation, other people's public
posts, to Virga's server, which passes them to an AI model through an AI gateway; alt
text sends the image. The allowance (by default 30 adviser reads, 3 style readings and
15 descriptions a month; the server's `AI_*_MONTHLY_LIMIT` settings change it) is counted
per account.

## The look

Quiet sky: your numbers set straight on the page, under a sky.

- **No boxes.** A figure is a number under a two-pixel rule; a chart is its title and the
  chart; a list is its title over a rule in ink, with hairlines between its rows. Space
  sets things apart, so the gaps are wide. Only what floats (a menu, a dialog, the
  composer) has an edge and a shadow. Buttons are pills.
- **A sky behind every page.** A wash of colour at the top that fades into the page's own
  ground, so it scrolls away as you read. There are four: dawn, day, dusk and night.
  Dawn, day and dusk are light pages that differ only in the wash; night is the dark
  theme. Settings › Appearance keeps one, or lets the sky follow the clock (dawn from
  five, day from eight, dusk from five in the evening, night from eight), and a device
  set to dark stays on night. `src/lib/sky.js` decides, `index.html` stamps the answer on
  `<html>` before the first paint (`data-sky`, and the `data-theme` it brings), and the
  browser's own toolbar takes the colour at the top of the sky.
- **Ink does the work, sparingly.** New post, in the sidebar or the bar along the bottom,
  is the pill filled with ink that is always there; inside a page, ink is kept for the
  button that confirms what you opened (a dialog, a sheet, the composer). The page you
  are on and the pressed key of a control are in ink with a line under them; links are
  ink, underlined. **The accent means one thing:** the data, or what is selected. It is blue,
  or one of five others chosen in Settings (violet, teal, amber, rose, graphite). It is
  not a colour picker: each is a full set of steps for the light pages, for night and for
  high contrast. The second thing on a chart is coral, or blue beside amber and rose,
  where coral would sit too close. A change says which way it went with its sign, not
  with a colour.
- **Checked, not eyeballed.** Colours, type, spacing and density are tokens in
  `src/styles/theme.css`, with a dark set under `[data-theme='dark']` and a high-contrast
  set of each under `[data-contrast='high']` (words at 7:1 or better, solid lines at 3:1,
  no sky, a thicker focus ring). `src/styles/theme.test.js` reads the stylesheet and holds
  every accent under every sky and contrast setting to the same numbers: words at 4.5:1
  on the page, on what floats and on both ends of the sky (7:1 in high contrast), marks
  and the focus ring at 3:1 (4.5:1) on the page and on the sky where a chart can start,
  and the two series at least 15 apart in OKLab under simulated protanopia, deuteranopia
  and tritanopia (20 with ordinary vision). Under forced colours nothing is left to a
  fill or a shadow alone.
- **One look per job.** A page's header is its title, one line, a quiet line saying what
  the page can touch, and at most one row of controls: the period, and on a dashboard
  Customize. An action sits beside what it acts on: Export over the list it exports, a
  chart's actions under the chart, an add at the head of the list it adds to, as
  underlined words with an icon. A row shows at most one labelled button and a ⋯ that
  holds the rest, with anything that deletes last and in red. Tabs narrow a list or a
  chart, chips only pick a value in a form, and a coloured badge only marks a problem
  to find; everything else is quiet words in a line, with a dot between them. The same
  number is the same size on a dashboard, a report and the index.
- **One typeface,** Instrument Sans, in sentence case and three weights, with tabular
  figures so columns line up, and one scale of sizes. Monospace is kept for identifiers
  such as DIDs.
- **Every chart has a table.** Hover shows a value; Show as table shows them all.
- **The sidebar is words.** The six parts of Virga down the side, each with its icon, and
  only the one you are in opened out into its pages. It has no ground of its own: it sits
  on the sky. It folds to a rail of icons.
- **On a phone,** the top of the page has the mark (or, on an inner page, the way back to
  the one above it), Search and the account (Settings and Sync now are in its menu), and
  a bar along the bottom has the parts as icons: the one you are in says its name (from
  430px wide; narrower, it is a tinted disc, since five parts leave no room for the name),
  and New post is the round button at its end. Cards stack one to a row (figures two to a row), a
  row of tabs that doesn't fit scrolls sideways under a faded edge, a long menu rises from
  the foot of the screen as a sheet, Customize is a list of the cards with arrows to move
  them, and the composer and its dialogs are full-height sheets with the main button under
  the thumb.
- **The live sky is an easter egg.** The 3D scene from the first version
  (`src/hillside/`) is off by default. Settings › Appearance turns it on, and five taps on
  the mark do the same from anywhere. It draws its clouds (and at night its stars) in the
  sky at the top of the page, under whichever sky the page has, laid over the wash so
  that it can only lighten it and the words on it keep their contrast. With reduced
  motion it's a still picture; in high contrast it is left out.

## The harness

`npm run harness` runs the real app with one module swapped: the session. Two made-up
accounts are signed in, every network request is answered from fixtures, and a fake
Virga server schedules, publishes and runs timers in memory, so the whole app can be
looked at and clicked through offline. Flags in the address show other states: one
account (`?accounts=1`), browser sessions (`?mode=browser`), an ended session
(`?expired=lab`), a session from before posting (`?scope=read`), limits
(`?limits=3,1,1`, `?ailimits=…`), the adviser slow or down, the agreement screen
(`?terms=ask`, `?terms=down`), Defense already turned on (`?defense=on`, or with its lists,
`?defense=lists`), a server that doesn't write lists (`?defensewrites=off`), and an AppView
whose known-followers counts fail open (`?appview=failopen`, `?appview=flaky`). See
`harness/README.md`.

## Deploying

Built for Vercel with a Supabase project. The front end is static; the server is eight
functions: `api/client-metadata.js` (the browser client's metadata, per host, as before)
and one function per area, `api/{oauth,schedule,self-destruct,ai,limits,terms,defense}/[action].js`,
each dispatching to the handlers in `server/`. `vercel.json` sets their time limits,
rewrites the two OAuth `.json` addresses, sends every other path to `index.html`, and
runs four crons every minute: `/api/schedule/run` (scheduled posts),
`/api/self-destruct/run` (post timers), `/api/defense/run` (Defense's lists; it writes
nothing until `DEFENSE_WRITES` is `on`) and `/api/defense/dm` (the moderator's DMs; it
does nothing until the moderator account is set). Defense's worker (`worker/`, for the
droplet) calls the last two more often; see worker/README.md.

Without the server settings below, the app still works with browser sign-ins; the
server's routes answer 503 and the posting pages that need it say so.

1. **Supabase.** A project of Virga's own, or one it shares with other apps: everything
   Virga keeps is in a `virga` schema, and the migrations create, replace and drop nothing
   in `public`, even where another app has tables and functions of the same names there.
   - Apply `supabase/migrations/` in order. On a project of its own, `supabase link` then
     `supabase db push`. On a shared one, paste each file into the SQL editor or apply it
     with Supabase's MCP server instead, because `db push` expects the project's whole
     migration history to be in this folder. They create the schema, the sign-in,
     scheduled-post, timer, AI-usage and terms-agreement tables (row-level security on,
     nothing for the `anon` or `authenticated` roles; only the server's service-role key
     reads them) and a private Storage bucket, `virga-scheduled-media`. The two newest:
     `20261114000100_scheduled_repeats.sql` adds the series columns and functions for
     repeating posts (without it scheduling answers as not set up), and
     `20261114000200_terms_acceptance.sql` adds the agreement ledger, and
     `20261118000100_defense_lists.sql` adds Defense's lists, plans, decisions and jobs.
   - Add `virga` to **Exposed schemas** in the project's API settings. Until it is there
     the Data API refuses every call the server makes (PostgREST's `PGRST106`), and the
     posting pages read that as the database not being set up.
   - Don't run the grants from Supabase's guide to exposing a schema. They hand the schema
     to the public API key; the migrations already give the service role what it needs,
     and take the rest back if they are applied again.
   - Apply a new migration before deploying the code that needs it. Without
     `virga.terms_acceptance`, or while the schema isn't exposed, an account on a long
     session can't get past the agreement screen.

   On a shared project the service-role key is the whole project's, so Virga's server
   holds a key that reaches the other apps' tables too, and theirs reach Virga's.
2. **A signing key.** `node scripts/generate-oauth-key.js` prints an ES256 key as
   `OAUTH_PRIVATE_KEY_1`. Keep it secret; `_2` and `_3` are for rotating keys.
3. **Vercel settings** (Production only; see `.env.example` for every option and its
   default):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `OAUTH_PUBLIC_URL`: the production origin, e.g. `https://virga.example`. The
     client_id hangs off it, so it must not change once anyone has signed in, and one
     `virga` schema serves one public URL.
   - `OAUTH_PRIVATE_KEY_1`, and `SESSION_ENCRYPTION_KEY` (`openssl rand -hex 32`), which
     encrypts the stored sessions. In production long sessions stay off until it is set:
     the Privacy Policy says sessions are encrypted, so they aren't stored any other way
   - `CRON_SECRET` (a long random string): Vercel sends it to the crons, and the run
     endpoints refuse anything without it in production
   - `AI_GATEWAY_API_KEY`, for the adviser and alt text (optional; without it they answer
     503)
   - `TERMS_ACCEPT_RATE_LIMIT` and `TERMS_ACCEPT_CLAIMED`, for the agreement ledger
     (optional; see `.env.example`). `OAUTH_TOS_URL` and `OAUTH_POLICY_URL` only if the
     consent screen should link somewhere other than this site's `/terms` and `/privacy`
   - `VITE_AUTH_MODE=backend`, to give new sign-ins long sessions
   - `VITE_DEFENSE=on` to show Defense, `DEFENSE_WRITES=on` to let it write lists,
     `DEFENSE_WORKER_SECRET` for the worker, and `DEFENSE_MODERATOR_HANDLE` and
     `DEFENSE_MODERATOR_PASSWORD` for the moderator. Leave them all off until the Terms and
     the Privacy Policy describe Defense (docs/DEFENSE.md)
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
run paths every minute from somewhere else, for example Supabase's `pg_cron` and
`pg_net` (and `/api/defense/run` the same way, or by the worker, once Defense writes):

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
Have the proxy in front write `x-real-ip` itself: the per-address limits on sign-ins and
on agreements read it, and Vercel's edge is what makes it trustworthy there.

## How the code is laid out

| Where | What |
| --- | --- |
| `src/shell/` | The signed-in frame: sidebar, app bar and tabs, page header, sync status, routing, shortcuts, the command palette (`commands.js` builds its list from the registries) |
| `src/session/` | Signing in both ways, the accounts, switching, the backend fetch handler, session checks |
| `src/signin/` | The sign-in a step at a time: the handle field and its suggestions, the account and host lookup, the steps and their words, the hosts for a new account |
| `src/legal/` | The Terms and Privacy pages (drawn from the Markdown at the root), the version both sides agree on, the agreement screen and what it keeps |
| `src/accounts/` | The account menu, Settings › Account, the sign-in notices |
| `src/posting/lib/` | Rich text and facets, the composer model, thread splitting, images, video, link cards, gates, `publish()` |
| `src/posting/{drafts,templates,library,schedule,timers,adviser}/` | Each posting feature's logic, without UI |
| `src/posting/composer/`, `pages/`, `ui/` | The composer, the posting pages and the shared posting components |
| `api/` | The server's Vercel functions: one per area, each a thin router |
| `server/oauth/` | The long-session sign-in: client metadata, keys, tokens, the XRPC proxy, uploads |
| `server/schedule/`, `server/timers/`, `server/ai/`, `server/limits/` | Scheduled posts and their worker, post timers and their worker, the adviser and alt text, limits |
| `server/terms/` | The ledger of who agreed to the Terms and Privacy Policy, and its two routes |
| `server/` | Shared server pieces (Supabase, HTTP helpers, cron auth, safe fetching) and test helpers (`server/test/`) |
| `supabase/migrations/` | The server's database: the `virga` schema and its Storage bucket |
| `src/archive/` | The archive hook (IndexedDB and the sync) and the context that shares it |
| `src/reports/models.js` | Every number, as pure functions of the archive and a period, cached per sync |
| `src/reports/annotations.js` | Chart notes and follower milestones, and where they land on a chart |
| `src/lib/periods.js`, `src/lib/locale.js` | What a period means (presets and custom ranges) and the words for it; how numbers, dates, the clock and the week are written |
| `src/lib/sky.js`, `src/lib/preferences.jsx` | Which sky a setting, a clock and a device come to; the preferences, and what they stamp on the page |
| `src/styles/` | The tokens (`theme.css`, with its test), the page and the sky (`base.css`), and the kit every page is drawn with (`controls.css`) |
| `src/share/` | A card as a picture: what it shows, its alt text, the canvas that draws it, the dialog |
| `src/dashboards/` | Layouts, the card library and the cards themselves |
| `src/reports/`, `src/tools/`, `src/settings/` | The pages |
| `src/defense/` | Defense: the harvest, the scoring and its canary, a scan in order (`scan.js`) and in memory (`scanStore.js`), the radar's layout and drawing, the veto (`veto.js`) and plans (`plan.js`) both sides run, and the Scan a post, Lists and History pages |
| `server/defense/` | Defense's routes, the store bound to one owner (`store.js`), and the list writer (`run.js`) with the worker's signed calls (`workerAuth.js`) |
| `worker/` | Defense's worker for the droplet: in phase 3, a signed call to the list writer every minute (worker/README.md) |
| `src/charts/` | The time series, sparklines, heatmaps and bar lists |
| `src/lib/router.jsx` | Real paths (`/dashboard/:id`, `/reports/:report`, `/tools/:tool`, `/posting/:page`, `/defense`, `/settings/:section`) on the History API |

## Not here yet

- **The Graph tab** from dame.is: where people sit in your follow graph, and Bluesky
  lists kept in step with it. There it reads a weekly snapshot of the follow graph from a
  database and writes lists from a cron signed in with an app password. Doing that for
  anyone means a server that holds something for each person, which is a decision of its
  own.
- **Very large accounts.** A sync reads up to 100,000 followers and 20,000 block records
  per walk, and says so when it stops short.
- **How a post grew.** A post's counts are as of the sync that last fetched it, so there
  is no curve of its first hours. A browser only syncs while it is open; doing it on
  Virga's server would mean the archive leaving the browser, which it doesn't today.
- **Dashboards and notes on other devices.** They are kept in this browser only.

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
