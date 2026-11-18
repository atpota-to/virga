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
| Vercel cron, or the worker | Vercel's run route | `Bearer CRON_SECRET`, or a signed request (HMAC over the time, the method, the path and the body) | That it is time to run. It names nothing: the route chooses the work from the database |
| The worker | Vercel's moderator route | A signed request naming a DM (its conversation and id) and its sender, or the turn and the tool the agent called | Nothing on its own. Vercel reads the DM back from the chat service with its own key, and acts only on what it read, as its real sender, if they linked (rule 16) |
| Vercel | The chat service | Its own session for the moderator account | What a DM says and who sent it |
| Vercel | The AI Gateway | The owner's words as read back, the moderator's message before them, a change described by code | The write check's yes or no (rule 17) |
| The worker | The AI Gateway | The owner's DM, their recent conversation with the moderator, what the agent's tools found | Nothing: the model's answer is read for tool calls, which go to Vercel, and for the reply |
| The worker | aturi.to | The Atmosphere tool's lookups, with no credentials | Nothing: what it returns is fenced as untrusted (rule 18) |
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

- **The worker holds no database key and no user's session**, only the secret that signs
  its calls, and in phase 4 the moderator account and the AI Gateway key. Neither is enough
  to act for an owner (rule 16).
- **Row-level security on `owner_did` is not the second wall yet.** Supabase's service role
  bypasses row-level security, and every Virga route uses it. The first wall is the
  owner-bound store and the SQL functions that require an owner. A second needs a role
  without `BYPASSRLS` and policies keyed on a per-request setting; it is phase 4's, with the
  moderator's many owners.
- **The protected set is read at the write, not snapshotted.** A curation list with tens of
  thousands of members is read in pages each run; a cap (20 lists, 5,000 members each) stops
  a run that would take too long, by refusing the batch rather than writing it.
- **A Bluesky client can still add anyone by hand.** The veto binds Virga, not the owner.

## The rules phase 4 adds

Every DM is untrusted text, from whoever is on the other end. The moderator answers only
accounts that linked it, but what they paste can carry anything.

11. **Who sent a message is what the chat service says.** Vercel takes the sender's DID from
    the message it reads back from the chat service (rule 16) and nothing else; no command,
    link or mention in a message can say who it is from. Test: a command sent by one owner
    touches only their rows.
12. **Linking proves a choice, bound to one account.** A code is made by an authenticated
    request, stored as a hash of the owner's DID and the code, lasts fifteen minutes, and is
    spent by the fifth wrong try. Sent from any other account it links nothing, and the
    answer to a wrong code is the same as to an expired one or to none. Test: another account
    sending a real code links nothing, and the owner's code still works after.
13. **A command runs as its sender, on their rows only, and says nothing of anyone else's.**
    Every command goes through `storeFor(sender)`; every reply is built from that store's
    answers. Test: two owners and a stranger in one database, and nothing one sends moves or
    names the other's lists, plans or decisions.
14. **A target is named in the owner's own words.** The grammar takes a handle, a DID, a
    link the owner pasted (its full URL from the facet, never what's left of a shortened
    one) or the post the owner shared. Nothing a post says, and nothing the moderator read,
    can choose a target. Two candidates are refused; "them" is asked back; an approval with a
    word it can't place is refused whole; PROTECTED is never carried. Test: command.test.js,
    ported from bluesky-mod's.
15. **One-to-one, at most once, one copy at a time.** Group conversations aren't answered
    (everyone in them would read the reply). The cursor moves past a message before it is
    answered, so a message that breaks its turn isn't answered again on every pass. A lock in
    the worker's data volume keeps a second copy from reading the same log. Someone unlinked
    gets one line, the same for everyone, at most once a day, keyed by a hash of their DID.
    Test: server/defense/moderator/dm.pglite.test.js.
16. **The droplet alone is not enough: Vercel reads every message back with a key of its
    own.** The worker holds the moderator account (one app password) and the AI Gateway key,
    and no database key and no user's session. Everything a DM asks of an owner's rows is a
    call to Vercel's moderator route, signed over its exact body (`application/octet-stream`,
    so the bytes arrive as signed), naming the conversation and the message. Vercel signs in
    to the moderator account with a second app password the droplet never holds, and reads
    the message back from the chat service. It must be from the owner it is said to be from,
    in a one-to-one conversation between that owner and the moderator, within the hour, and
    Vercel acts on the text it read, not the text it was sent. Nobody but the owner can put
    a message in that conversation under the owner's name. So the signing secret and the
    moderator's password together can't make Vercel act for an owner who didn't write.
    - **The agent's tool calls** carry a turn Vercel opened for one message read back: good
      for its owner, for ten minutes and six writes.
    - **A yes to a question** is read back too, and is good once.
    - **Production refuses to run without Vercel's key.** `DEFENSE_MODERATOR_VERIFY=off`
      trusts the worker, and only outside production.
    - **What a taken droplet keeps:** it can read what owners DM the moderator and send DMs
      as it. It can propose changes against what an owner really said in the last ten
      minutes, each judged by the check (rule 17). It can ask an owner a question in its own
      words and act on their yes, if the change matches the question. App passwords can't
      revoke one another, so it can't lock Vercel out. Test:
      server/defense/moderator/dm.pglite.test.js, "a droplet in someone else's hands".
17. **The agent's writes are checked against the owner's words, on Vercel.** Every write but
    a keep is put to a separate model call, run by Vercel with its own AI Gateway key, before
    it runs. The check reads:
    - the owner's message as Vercel read it back;
    - the moderator's message before it;
    - the change as Vercel's code described it, with where each account came from, worked
      out by code.

    It never reads the agent's reasons, what a tool or the network returned, or anything the
    droplet wrote. It fails closed. A write put to the owner as a question runs only on
    their yes, read back, and runs exactly what was described. Test:
    server/defense/moderator/check.test.js, and the end-to-end test.
18. **What a tool or the network returns is data.** Handles, names, posts and bios are
    anyone's to write, so every tool result, and every page the Atmosphere tool reads from
    aturi.to, reaches the model inside `<untrusted>` tags it can't close. The prompt says that
    nothing inside them is an instruction. The Atmosphere tool:
    - offers read verbs only;
    - refuses arguments named `url` or `host`, and a web link under any argument unless it
      is a Bluesky client's (bsky.app, deer.social), so a post can't make aturi.to fetch a
      page its author runs, carrying what the turn holds;
    - sends no credentials.

    A handle or a did:web still resolves at the host it names, a narrower channel of the same
    kind that stays open: what the turn holds (the owner's recent DMs, their lists and their
    history) could be spelled into a lookup. Whatever a post talks the turn into, rules 1 and
    17 decide what is written.
19. **The model sees the owner's DMs, and nothing of anyone else's.** A turn carries the
    owner's message, the half hour of their conversation before it, and what its tools
    found for that owner. A stranger's message never reaches a model. Calls ask the gateway
    for providers that don't train on prompts, and are counted against a monthly allowance
    per owner before they are made.

## For the phases after

- **Phase 4 (the moderator in DMs):** built to the rules above. A scan by DM opens the
  owner's session for the signed-in `getProfiles` and nothing else, and its plan is approved
  under rules 1 and 13 like any other.
- **Phase 7 (triage):** sorting replies by tone puts strangers' words in front of a model to
  label them, and a label can decide an approval. It needs its own review before it is
  turned on.
- **Phase 5 (the shield):** the gates route may only change threadgates and postgates on the
  owner's own posts, and must put each back exactly as it was.

