# Defense: the threat model

Written before the worker, as docs/DEFENSE.md asks, for phase 3 (lists and writes). It
covers what phase 3 builds: the routes that store lists, plans and decisions, the run
route that writes list items as the account that holds the list, and the worker that
drives it. DM parsing, the shield and agent mode get their sections when phases 4, 5
and 7 are written; the questions they raise are listed at the end so they aren't
forgotten.

## What is worth protecting

1. **People near the owner.** The one outcome Defense exists to avoid is adding someone
   the owner follows, or keeps by hand, or has on a curation list, to a block list. A
   wrong add is visible to everyone who subscribes, and to the person added.
2. **The owner's sessions.** A long session can post, delete posts, follow, and (once
   Defense's lists are on) write lists. Whoever can open one can act as the owner.
3. **One owner's rows from another.** Lists, plans, decisions and the people kept by
   hand say who the owner is in conflict with. They are nobody else's business, and one
   owner's commands must never move another owner's list.
4. **The record.** "Why is this person on the list" is answered from the decisions. A
   write that isn't recorded can't be explained or undone.

## Who might try

- **Someone on the internet**, with no account at Virga: calls the routes, forges links
  and sign-in returns, sends crafted records into what a scan reads.
- **A Virga user** acting against another user: names another owner's list, plan or
  decision in a request, or another account's DID.
- **Someone named in a scan** who wants off the list, or wants someone else on it:
  shapes their own profile, handle or records (they control what Constellation and the
  AppView say about them).
- **Whoever gets into the worker's box.** It is the box with the wide surface (open
  sockets, DMs, models). In phase 3 it only drives the run route, but it will hold more.
- **A fault, not an attacker**: an AppView that leaves counts off, a PDS that commits a
  write and loses the reply, two runs at once, a clock stepped back.

## The boundaries, and what crosses each

| From | To | Carries | Trusted for |
| --- | --- | --- | --- |
| The browser | Vercel's Defense routes | The owner's `vg_` token, a list's name, a plan's rows (DIDs, bands, trust), the bands approved, the owner's words | Who the owner is (the token, checked against the session store). Nothing in the body is trusted for identity or for the veto |
| Vercel cron, or the worker | Vercel's run and DM routes | `Bearer CRON_SECRET`, or a signed request (HMAC over the time, the method, the path and the body) | That it is time to run. It names nothing: the route chooses the work from the database, or reads it from the chat service |
| Vercel | The holder's PDS | Writes as the holder, through the restored session | Nothing comes back that is trusted beyond the write's own result |
| Vercel | The public AppView | `getRelationships` and lists, without a session | The veto's fresh read of who the owner follows and who is on their curation lists. A failed read refuses the write |
| Vercel | Supabase | Service-role queries, every one filtered by owner | Everything stored |

## The rules phase 3 is built to

1. **The veto runs at the write, every time, from fresh reads, and fails closed.**
   `src/defense/veto.js` is one module the browser and the server both run. At the write
   the server asks the public AppView who the owner follows (no session needed, so it can't
   be faked by the session it is about to use) and reads the owner's curation lists and the
   people kept by hand. Anyone in any of them, the owner and the holder are never written,
   whatever the plan says. A read that fails refuses the whole batch. Test: a plan that names
   someone the owner follows, someone kept by hand, someone on a curation list, the owner and
   the holder writes none of them, and a batch whose follows can't be read writes nothing.
2. **The run route chooses its own work.** It takes no list, no DID and no decision from
   its caller. It claims due jobs from the database, and every subject it writes is a
   decision row created by the owner's authenticated request. So the worker's secret, if
   stolen, can make Virga do sooner what owners already approved, and nothing else.
3. **Only list items, only on lists Virga made, only in the holder's repo.** The run route
   writes `app.bsky.graph.listitem` records and nothing else, into the repo of the list's
   holder, naming a list whose row says it was made by Virga for that owner, and whose URI
   names that holder. Anything else throws before a request is made. Test: a decision row
   whose list belongs to another owner, or whose URI names another repo, is refused.
4. **Every query names its owner.** `server/defense/store.js` hands out a store bound to one
   owner DID; nothing in it reads or writes a Defense table without that DID in the filter,
   and the SQL functions take it as a required argument. Test: two owners in one PGlite
   database, and every route run as one leaves the other's rows as they were.
5. **The owner comes from the token, never the body.** As everywhere on Virga's server.
6. **Writes are idempotent across lost replies.** Each decision gets its record key (a TID)
   before it is sent, and keeps it. A decision with a key may have landed, so the next pass
   reads the key before deciding anything else about it, the veto included: someone found
   there is recorded as on the list (and taken off again if the veto now keeps them off).
   A create refused because its key is taken reads the key. Undo deletes by that key, and
   waits while the add it takes back is unconfirmed. So a retry can't add someone twice, an
   undo can't be overtaken by its own add, and the record never says "kept off" for someone
   on the list.
7. **Read first, then mark, then write, then stamp.** The veto and the holder's session are
   read before anything changes; a batch that can't go on is left as it was. A decision is
   marked sent before its write and stamped after. A run that dies between the two leaves a
   `sent` row, which the next run reconciles by its key. Nothing is written that has no row.
8. **Paced to the holder's limits, and stopped by them.** A batch at most every two minutes
   per holder (about 1,500 adds an hour, under the PDS's 5,000 points), and a rate-limit
   answer pauses that job for an hour instead of retrying.
9. **Writes are off until they are turned on.** `DEFENSE_WRITES` must be `on` on the server
   for the run route to write anything or the approve route to queue anything. Until the
   Terms, the Privacy Policy and the entitlement exist (phase 6), it stays off in
   production.
10. **What a scan read about strangers is data.** Handles, names and avatars are shown as
    text and image URLs the page already treats as untrusted; nothing in them reaches a
    query, a record or a URL path unescaped. The server keeps no handle or text: plans hold
    DIDs, bands and trust only.

## What phase 3 leaves open

- **The worker holds no database key and no session in phase 3**, only the secret that
  signs its calls to the run route. Phase 4 gives it the moderator account and the DM loop;
  it should still reach Defense's tables only through Vercel or through a database role with
  a few functions granted, never the service-role key.
- **Row-level security on `owner_did` is not the second wall yet.** Supabase's service role
  bypasses row-level security, and every Virga route uses it. The first wall is the
  owner-bound store and the SQL functions that require an owner. A second needs a role
  without `BYPASSRLS` and policies keyed on a per-request setting; it is phase 4's, with the
  moderator's many owners.
- **The protected set is read at the write, not snapshotted.** A curation list with tens of
  thousands of members is read in pages each run; a cap (20 lists, 5,000 members each) stops
  a run that would take too long, by refusing the batch rather than writing it.
- **A Bluesky client can still add anyone by hand.** The veto binds Virga, not the owner.

## For the phases after

- **Phase 4 (the moderator in DMs):** every DM is untrusted text from a stranger; linking by
  a short code must not tell anyone whether a handle uses Virga; replies must never name
  another owner's lists; the command grammar's tests come across with it.
- **Phase 5 (the shield):** the gates route may only change threadgates and postgates on the
  owner's own posts, and must put each back exactly as it was.
- **Phase 7 (agent mode):** the write check sees the owner's words, never the posts the
  agent read.
