# View counts

Bluesky started showing view counts on 2026-11-19, in v1.138 of its app, as a beta you turn
on in its settings. Its announcement: "Now you can see how many people your posts are
reaching. The numbers are private — they only appear on your own posts and only to you."
([bsky.app/profile/bsky.app/post/3n2opitxdyc2j](https://bsky.app/profile/bsky.app/post/3n2opitxdyc2j))

This is how Virga reads them, what it does with them, and what is still open. Everything
under "What the AppView does" was read from Bluesky's source on 2026-11-20, not from a
live account: nobody has run Virga against a real account's view counts yet.

## What the AppView does

The field is `viewCount`, an optional integer on `app.bsky.feed.defs#postView`. It was added
to the lexicon on 2026-11-13 ([bluesky-social/bsky#94](https://github.com/bluesky-social/bsky),
commit `f03410e`), whose description is: "Approximate number of times the post has been
viewed. Only included in authenticated responses to the post's author when eligible to see
the count. Counts less than 100 are omitted." The `app.bsky` lexicons now live in that
repository, not in `bluesky-social/atproto`.

The AppView's code is in `bluesky-social/atproto`, `packages/bsky`:

- `src/views/index.ts` fills in `viewCount` only when the request's viewer is the post's
  author. A read that isn't signed in, or is signed in as anyone else, gets nothing.
- `src/hydration/feed.ts` (`getPostViewCounts`) reads a feature called `unique_views` from
  the dataplane, 100 posts at a time, with one 100 ms budget for the lot. On a timeout or
  any other failure it logs and returns no counts at all, and the posts come back without
  them. It drops anything under 100.
- `src/hydration/hydrator.ts` asks only for posts by the viewer, and only for posts whose
  `indexedAt` and `sortedAt` are both on or after `BSKY_POST_VIEW_COUNTS_START_AT`, a
  server setting. A post imported later with an older date gets no count. The setting's
  value isn't published.
- `tests/views/post-view-counts.test.ts` shows the counts coming through `getPosts`,
  `getPostThread` and `getAuthorFeed`, for the author only.

Bluesky's app (`bluesky-social/social-app`,
`src/screens/PostThread/components/PostViewCount.tsx`) shows the count on the open post
only, behind the beta flag `post_view_counts:enable`, and hides it from anyone who hasn't
declared an age or has declared one under 18. Its tooltip says: "This view count estimates
how often your post was seen in Bluesky’s apps. Only you can see this number."

So, as far as can be told from the code:

- No count is not zero views. It is under 100, from before the start date, or a lookup that
  timed out.
- It is not clear whether a view is a person or a time the post was shown. The lexicon says
  "times the post has been viewed", the tooltip "how often", the announcement "how many
  people", and the feature is called `unique_views`. Virga's screens don't claim either.
- Views in other apps probably aren't counted ("seen in Bluesky’s apps").
- There is no history: the AppView gives a post's count now, nothing by day.

## How Virga reads them

- **The permission.** `rpc:app.bsky.feed.getPosts?aud=did:web:api.bsky.app%23bsky_appview`,
  added to the ordinary sign-in (`src/config.js`, the `views` group). The archive's post
  sweep reads the public AppView, which can't carry the count, so the views are a second,
  signed-in read. A session from before this has `getPosts` missing; the Views report says
  so and offers Sign in again. Nobody is made to sign in again for it.
- **The age rule.** Before reading, the sync reads the account's preferences
  (`getPreferences`, already in the sign-in) for `app.bsky.actor.defs#declaredAgePref`.
  Its PDS works that out from the birthday it holds and hands an app only the
  `isOverAge13/16/18` flags, never the date (`packages/pds`, `actor-store/preference`).
  Virga reads view counts only when `isOverAge18` is true, as Bluesky's app shows them.
  A PDS that doesn't work the preference out reads as no age given, so view counts aren't
  read for it.
- **The switch.** Settings › Data and sync can turn view counts off on the browser. Off,
  none are read or shown, and the kept ones can be deleted.
- **The read.** `sweepViews` in `src/lib/analyticsSync.js`: `getPosts`, 25 posts a call,
  three calls at a time, through the account's own agent (the same path `getFollowers`
  takes). Each batch is written as it lands.
- **The canary.** A batch in which every post that had a count before comes back without
  one is the AppView's lookup timing out, not a hundred posts dropping under 100. It is
  asked once more, and left out if it comes back the same, so those posts are due again
  next sync.
- **Which posts, how often** (`viewsDue` in `src/lib/views.js`). Posts under two days old at
  every sync; then every six hours to a week, daily to a month, weekly to six months,
  monthly after. At most 1,500 posts a sync, newest first. The first walk back through old
  posts stops after 300 past the oldest post with a count (or 300 in all while none has
  one), and a post over 30 days old isn't read again once it is clearly from before Bluesky
  counted, or has been read twice without a count.

## What Virga keeps

The `views` store in the account's IndexedDB (`src/lib/analyticsStore.js`, version 2), one
row per post: the highest count read, when it was last read with a count and at all, and up
to 48 readings as `[ms, count]`. A missing count never takes away a known one, and an
estimate that dips is held at its highest. `meta.views` holds the last sync's outcome and
`since`, when counts were first read. None of it is sent to Virga's server; for a long
session the read passes through it, as every signed-in read does. The JSON export includes
the store; the posts CSV gains a `views` column, blank where there is no count.

## What it shows

- **Reports › Views**: views on the window's posts by the day each was made; views gained
  between Virga's readings; the typical post (the median, "under 100" when the middle post
  has no count); engagement per 100 views; the same by format; the most seen posts, and the
  most engaging for their views among posts with 300 or more. It starts at the oldest post
  with a count, and says so.
- **Seven dashboard cards** (Views, Engagement per view, Views by post date, Views gained,
  the rate as a chart, Views by format, Most seen), and a **Views** dashboard to start from
  under New dashboard. New accounts don't start with it.
- **Best time to post** can read views instead of engagement.
- An eye and the count beside the other counts in the Engagement report's top posts,
  Archive search and Posting › Posted.
- **Post this chart** for the view charts, so sharing one is the author's choice.

"Views gained" is the closest Virga can get to views by day. It spreads each rise evenly over
the time between two readings, and a browser only reads while it's open, so a gap of days
flattens a post's first hours into the whole gap. Posts made before Virga first read counts
add only what they gained after their first reading.

## Not done, and why

- **Post timers on views** ("delete this unless it reaches 1,000 views"). The timers run on
  Virga's server and read counts from the public AppView; a views condition would need the
  server to read as the account. The harder part is that no count means "under 100" or "the
  lookup timed out", and the timers' rule is that anything uncertain keeps the post. Read
  that way, a post that really is under 100 would never be deleted by its timer. That needs
  a decision about what the timer should do, not just code.
- **Readings while the browser is closed.** A server cron could read counts on a schedule
  and give a real curve, but then a copy of the archive's numbers would be kept on Virga's
  server, which the Privacy Policy says doesn't happen.
- **How fast a post collects its views** (half its views by which hour). The readings are too
  far apart unless Virga stays open.
- **Views per follower.** Views include people who don't follow the account, so the ratio
  would read as something it isn't.

## Still to check

- A real sign-in granting the new permission, and a real `getPosts` through the PDS proxy
  returning `viewCount`, for both a browser session and a long session.
- The real start date, which will show as the oldest post with a count.
- That self-hosted PDSes return `declaredAgePref` (an older PDS may not, and its accounts
  would then read as having no age given).
- Bluesky calls this a beta. If the field moves or the 100 floor changes,
  `src/lib/views.js` is where that lands.
