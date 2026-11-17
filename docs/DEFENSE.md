# Defense: the plan

Virga's sixth part: moderation and defence for an account, hosted, as a paid feature. It
takes what [bluesky-mod](https://github.com/dame-is/bluesky-mod) does as a bot you run
yourself (a block list that can't take your own people, scans of who piled onto a post,
closing replies and quotes when strangers arrive, attack mode) and makes it something you
turn on in Virga, with the infrastructure run for you.

This is the plan as of 2026-11-17. The first piece is built: the in-browser scan and score
engine (`src/defense/`), with tests. Nothing of Defense is on screen yet.

## The idea it keeps

The bot doesn't decide who is bad. It answers a narrower question before anything is
written: **what am I about to do, and who will notice?** Everyone who engaged with a post is
sorted into bands by one signal, how many of the people you follow also follow them, and
you approve a band at a time. Accounts you follow can't be added by any path, your own
typed command included. Everything can be undone, and every change is logged with your own
words.

| Band | Means |
| --- | --- |
| `PROTECTED` | You follow them, or they're on a curation list you made, or you kept them by hand. Never added |
| `CONNECTED` | 3 or more of your follows follow them, or 1 does and they have 5,000+ followers |
| `PERIPHERAL` | 1 or 2 of your follows follow them |
| `NOTABLE` | No connection, but 10,000+ followers or very active with real reach |
| `UNKNOWN` | No connection. Most of any pile-on |

## What was checked: the vouches come from the AppView

bluesky-mod counted vouches from a snapshot of your follows' follows: 0.5 to 3 GB per
person, rebuilt weekly. That can't be multiplied by every Virga account, and it shouldn't be
kept at all if it doesn't have to be.

It doesn't have to be. Read from `@atproto/bsky` 0.5.13 (npm, 2026-11-17):

- `app.bsky.actor.getProfiles`, asked with the owner's session, hydrates
  `viewer.knownFollowers` for **every** account in the batch of 25
  (`api/app/bsky/actor/getProfiles.js`: `knownFollowersDids: skeleton.dids`).
- `count` is the dataplane's `totalKnown`: the number of the viewer's follows who follow
  that account. No 1,500 cap per follow list, which bluesky-mod's snapshot had.
- **The catch.** `hydration/actor.js` gives that lookup `AbortSignal.timeout(100)` and,
  on any error, "fails open": the field is left off every profile in the batch, and the
  request still succeeds. An absent count reads as zero, which would drop friends of
  friends into `UNKNOWN`, the band approved without a named look.

So `src/defense/score.js` sends a **canary** with every batch: an account the owner follows
that has known followers (`findCanary`). The lookup is one call per batch, so a canary
without its count means nobody in the batch was counted: the batch is asked again, the
canary is picked again once if it keeps failing (someone may have unfollowed), and after
that nothing is scored. Without any canary (the owner follows no one, or no two of their
follows follow each other) scores say `vouchCheck: 'unavailable'` and an account that
follows you counts as `CONNECTED`, as bluesky-mod's simple mode did.

What the canary can't catch: a dataplane that answers for some accounts in a batch and
not others. The open-source dataplane can't do that; the production one isn't published.
The veto doesn't rest on vouches anyway. "You follow them" comes from the public
`getRelationships` (no session), and it's checked again at the moment of every write.

This needs one more permission for the browser session, only when Defense is turned on:
`rpc:app.bsky.actor.getProfiles?aud=did:web:api.bsky.app#bsky_appview`.

## Where each piece runs

| Where | What runs there | What it holds |
| --- | --- | --- |
| **The browser** | Scans started on the web: the harvest from Constellation, the scoring, the radar, building a plan, the review | Nothing new beyond the session it already has. A scan lives in memory (IndexedDB if it should survive a reload) |
| **Vercel** (`api/`, `server/`) | Defense's routes: lists, plans, decisions, undo, settings, entitlement. **The only place a user's session is ever opened**: narrow internal routes the droplet calls to write a gate or a list item as the user | Users' OAuth sessions, encrypted, as now |
| **The droplet** (`worker/`, new) | Everything that has to stay on: the moderator account's DMs, Spacedust for the shield, Jetstream for new follows, batch writes that take hours, watches, attack mode | The moderator account's app password, Virga-held list accounts (below), a lock so one copy runs. **No user sessions** |
| **Supabase** (`virga` schema) | Defense's tables | The minimum below |

The droplet never decrypts a user's session. When the shield needs to close replies on
your post, the worker asks Vercel's internal route, which opens your session and does
exactly that and nothing else. bluesky-mod's `gates.js` is the model: list your recent
posts, read and write `threadgate` and `postgate` records on posts that are yours, and throw
before any request for anything else. The droplet is the box with the wide surface (open
sockets, DMs full of strangers' text, model calls); keeping `SESSION_ENCRYPTION_KEY` off it
means a compromised worker can't act as anyone.

Calls go from the browser when they can (point 6): a web scan's Constellation pages and
AppView batches go from the reader's own address. What can't: a scan started by DM, the
shield, watches. Those run on the droplet, and Spacedust is one connection for all
subscribers. Both are microcosm's public services. Tell them before launch, or run our own.

## What's stored

No follow graph and no profiles. Handles, names and avatars are looked up when shown.

| Table | Holds | Kept |
| --- | --- | --- |
| `defense_entitlement` | Who has Defense, the plan, until when, the payment provider's reference | While the account has it, then the law's minimum |
| `defense_list` | Each list: owner, holder account, URI, block or mute, its mode (below) | Until removed |
| `defense_decision` | Every add and removal: subject DID, band and trust when decided, where it came from (web, DM, shield), the owner's words (capped) | For good: it's what "why is this person on the list" and undo read |
| `defense_plan` | A proposed batch: post, and each row's DID, band and trust. No handles, no text | 30 days unless something was written from it |
| `defense_job` | Batch writes in progress, so the worker can carry on after a restart | Until done |
| `defense_protected` | Accounts kept off by hand | Until removed |
| `defense_shield` | Gates the shield changed and what each was before, so they go back exactly | Until put back, then 30 days |
| `defense_watch` | Posts being watched | A day each |
| `defense_link` | The owner's link to the moderator account (below) | Until unlinked |

Every row carries `owner_did`. Other people's post text is not kept: sorting replies by
tone runs in the browser when it's asked for from the web; from a DM it's held for the
answer and then dropped.

## Who holds the list

A list belongs to whichever account wrote it, and that account's name is what anyone sees
as its creator. Three ways, chosen per list:

1. **Your own account.** Simplest. The list shows on your profile under Lists. Virga
   writes it with your session (`repo:app.bsky.graph.list`, `repo:app.bsky.graph.listitem`).
2. **A helper you make.** An account of your own that only holds lists, made with Virga's
   existing "Make an account" flow on any host and signed in to Virga like a second account.
   Concealed, and it's yours to take elsewhere.
3. **One Virga holds for you.** Made and held by Virga on a PDS of Virga's own, with an
   opaque handle. The most concealed and the least effort: nothing to make.

**One moderator account for everyone, for DMs. Not one account for everyone's lists.**
Every user DMs the same Virga moderator. Holding every list on that one account fails three
ways:

- **Write limits are per account.** Bluesky's PDS allows about 5,000 points an hour, and an
  add costs 3, so roughly 1,600 adds an hour, shared by everyone. One 8,000-account sweep
  would hold up every other user for five hours. On Virga's own PDS the limit is ours to
  set, but the relay and the AppView still see one account doing all of it.
- **One takedown takes everything.** Mod lists get reported. A report that suspends the
  holder ends every user's list at once.
- **The profile lists them all.** Anyone can open the holder's Lists tab and see every
  user's list side by side.

So in mode 3, each user gets their own holder account on Virga's PDS, and the shared
moderator only talks. If one holder per user isn't welcome (below), the fallback is a pool:
a few dozen users to each holder, which still splits the limits and the blast radius.

### The moderator's conversations, kept apart

- **On Bluesky's side** they already are: every chat with the moderator is its own 1:1
  conversation, and the sender's DID is vouched for by the chat service, not by anything
  the sender typed.
- **Linking first.** The moderator answers only accounts that have Defense and have linked
  it: Settings › Defense shows a short code to send the moderator once. Everyone else gets
  the same short answer, so DMing it can't tell anyone whether a handle uses Virga.
- **Every query names its owner.** The worker's store hands out a handle bound to one
  owner DID; nothing in the worker can query Defense's tables without one. Row-level
  security on `owner_did` is a second wall under that.
- **Nothing crosses.** A command can only touch the sender's own lists. A model turn for one
  owner loads only that owner's rows. Errors and list names never mention another owner.
- **A test holds it.** Two owners in one PGlite database, and every command run as one
  leaves the other's rows untouched.

## Premium, and the bot on day one

- **Free:** scan a post and see its radar. Read-only, runs in the browser, costs Virga
  nothing, and is the reason to upgrade.
- **Paid:** lists and writes, the moderator in DMs, the shield and attack mode, watches,
  and the model features within an allowance (Virga already counts `AI_*_MONTHLY_LIMIT`).
- **The entitlement is checked in three places:** Vercel's routes, the worker before any job
  or DM action, and the page. A lapsed plan stops the bot and the shield and puts any
  closed gates back. The lists stay where they are. A Virga-held holder is kept, read-only,
  for a notice period, during which its lists can be copied to your own account.
- **Day one** means launching with the moderator, the shield and attack mode working, so
  the phases below all land before launch except the model features. Agent mode (talking
  to it in sentences) is the riskiest piece and ships when its review is done.

## What comes over from bluesky-mod

| bluesky-mod | Virga |
| --- | --- |
| `lib/score.js`, `lib/harvest.js`, `lib/limit.js` | `src/defense/`. **Done**, with the canary in place of the snapshot |
| `bot/bulkPlan.js` (proposing, `estimateWrites`) | `src/defense/plan.js` in the browser; the server stores and approves |
| `bot/listWrite.js` (the veto at the write, pacing) | `worker/`, with the veto as a shared module both sides test |
| `gates.js` | `server/defense/internal/gates.js` on Vercel, the only door to a user's session |
| `shield.js`, `ownerActivity.js`, `spacedust.js`, `jetstream.js` | `worker/`, one connection for all subscribers |
| `lib/command.js`, `bot/dmLoop.js`, `bot/operator.js` | `worker/`, rewritten for many owners; the command grammar and its tests come across |
| `panel/public/radar.js`, `lib/radar-layout.js` | A React radar under `src/defense/` |
| `bot/triage.js`, `bot/tiers.js`, `bot/botAgent.js` | Later, behind the AI allowance |
| `snapshot.js`, `drift.js`, `lease.js` | Not ported. No snapshot; the weekly re-score reads vouches live; a Postgres advisory lock replaces the file lease |

The worker lives in this repo (`worker/`) so it imports the same engine the browser runs,
and deploys to the droplet with Docker Compose, after bluesky-mod's `Dockerfile` and
`compose.yaml`. Virga's PDS goes on a droplet of its own, so a compromised worker doesn't
also hold the PDS's keys.

## The phases

1. **Engine.** Harvest, score, the canary, summaries. In the browser, no server. *Done.*
2. **Scan a post.** The Defense part in the sidebar; the getProfiles permission asked for
   when it's turned on; the canary picked from the archive's follows; the radar; harness
   fixtures, including an AppView that fails open. Free.
3. **Lists and writes.** Migrations; lists in modes 1 and 2; plans sent to the server;
   the worker's first job, batch writes with the veto at the write; decisions, undo,
   history.
4. **The moderator.** The shared account, linking, tenancy, the command grammar, background
   writes, scans by DM.
5. **The shield and attack mode.** Spacedust on the droplet, the internal gates route,
   per-post guards, attack mode, putting everything back.
6. **Premium and policy.** Entitlement and payments; the Terms and Privacy Policy;
   the security work below. Launch.
7. **Models.** Tone sorting in the browser, then agent mode in DMs with bluesky-mod's write
   check, which sees your words but never the posts the agent read.

Mode 3 (Virga-held accounts) runs alongside 4 and 5, once the PDS is cleared to host them.

## Security and policy

- **A threat model before the worker is written,** covering the internal routes, the
  tenancy, DM parsing (every message is untrusted text) and, later, agent mode.
- **An adversarial review at each phase boundary,** by someone who didn't write it, with
  the findings fixed or written down before the next phase starts. A review of the whole
  system before launch, and an outside one before charging for it.
- **Invariants as tests:** nothing in `PROTECTED` is ever written; one owner's commands
  never touch another's rows; the internal routes refuse anything but gates on the
  owner's own posts and list items on the owner's own lists.
- **The Terms and Privacy Policy** gain: the moderator account and what it reads; what's
  stored and for how long (the table above); holder accounts, who owns them and what
  happens when a plan ends; that the model features send post text to a model provider;
  that scans read Constellation and Spacedust.

## Still open

- **Holder accounts on Virga's PDS.** Bluesky's relay has capped how many accounts a new
  PDS may host (check the policy at the time), and an operator making an account per user
  may read as farming. Ask Bluesky
  before building mode 3; the pool and mode 2 are the fallbacks.
- **The moderator's chat limits.** One account answering many conversations may meet
  limits on sending messages that one person's bot never did. Measure in phase 4.
- **Spacedust with many subjects.** The subscription names every subscriber in its URL;
  past some number that needs several connections or an options message. Ask microcosm.
- **Payments.** Which provider, and whether a plan is bought per account or per person.
- **Automated-account labelling.** The moderator and the holders should say they're
  automated, in whatever way Bluesky asks for at the time.
- **bluesky-mod itself.** Keep it as the self-hosted option, or archive it once Virga's
  version launches.
