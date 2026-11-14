// The archive: everything Virga knows about the signed-in account, held in
// this browser's IndexedDB (analyticsStore, one database per account), and
// the sync that fills it (the sweeps in analyticsSync, the repo CAR) with
// its progress. Data lives in this browser: there is no analytics server, no
// tracker, nothing written anywhere but the visitor's own IndexedDB and,
// when they press Follow or Unfollow, their own repo.
//
// One instance per signed-in account (the shell keys it by DID), shared with
// every page through ArchiveContext.

import { useEffect, useRef, useState } from 'react';
import { getProfile, resolvePds, rkeyFromAtUri } from '../lib/atproto.js';
import { blockReach, compactPostFromRecord, outboundFromRecord } from '../lib/analytics.js';
import { openAnalyticsStore } from '../lib/analyticsStore.js';
import { atmosphereRowFromEntry, fetchRepoCar, readRepoCar } from '../lib/carRepo.js';
import {
  hydrateActors,
  sweepBlocks,
  sweepFollowers,
  sweepFollowing,
  sweepInbound,
  sweepOutbound,
  sweepPosts,
} from '../lib/analyticsSync.js';
import { checkActivity as readActivity } from '../lib/activity.js';
import { followerChanges, mergeFollowerLog } from '../lib/followerLog.js';
import {
  SYNC_PLAN,
  blocksFraction,
  partsFraction,
  repoDownloadFraction,
  repoReadFraction,
  repoSaveFraction,
  share,
  timeFraction,
  walkFraction,
} from '../lib/syncProgress.js';
import { formatDateShort } from '../lib/time.js';
import { onPostingEvent, POSTS_CHANGED_EVENT } from '../posting/events.js';
import { applyPostChanges, isOwnPostUri, postRowsFor } from './postChanges.js';

const DAY_MS = 86_400_000;

/** Sweeps re-run silently when the archive is older than this. */
const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

/** Recent posts get their engagement counts refreshed on every sync. */
const REHYDRATE_DAYS = 30;

/** How far back the event sweeps ever dig. Matches the longest dated period. */
const EVENT_DEPTH_DAYS = 365;

const FOLLOW = 'app.bsky.graph.follow';

/** Every object store in an account's database, for "Delete this archive". */
const ARCHIVE_STORES = ['posts', 'followers', 'following', 'blocks', 'inbound', 'outbound', 'atmosphere', 'actors', 'meta'];

const EMPTY = {
  loaded: false,
  persistent: true,
  blocked: false,
  posts: [],
  followers: [],
  following: [],
  blocks: [],
  inbound: [],
  outbound: [],
  atmosphere: [],
  meta: {},
  rev: 0,
};

export function useAnalyticsArchive(agent, did, handle) {
  const [data, setData] = useState(EMPTY);
  const [actors, setActors] = useState(() => new Map());
  // While running: { plan, done, failed, step, fraction, detail, doing } —
  // the steps this sync will take, which have finished or failed, and the
  // one under way with its own measured share (null: nothing to measure by).
  const [sync, setSync] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const storeRef = useRef(null);
  const abortRef = useRef(null);
  const autoRanRef = useRef(false);
  const attemptedActorsRef = useRef(new Set());
  const latestRef = useRef(EMPTY);

  async function reload(store) {
    const [posts, followers, following, blocks, inbound, outbound, atmosphere, actorRows, pm, fm, gm, bm, im, om, rm, logm, lm] =
      await Promise.all([
        store.all('posts'),
        store.all('followers'),
        store.all('following'),
        store.all('blocks'),
        store.all('inbound'),
        store.all('outbound'),
        store.all('atmosphere'),
        store.all('actors'),
        store.getMeta('posts'),
        store.getMeta('followers'),
        store.getMeta('following'),
        store.getMeta('blocks'),
        store.getMeta('inbound'),
        store.getMeta('outbound'),
        store.getMeta('repo'),
        store.getMeta('followerLog'),
        store.getMeta('lists'),
      ]);
    setActors(new Map(actorRows.map((a) => [a.did, a])));
    setData((prev) => ({
      loaded: true,
      persistent: store.persistent,
      // Session-only because another tab holds the database at an older
      // version, rather than because this browser refuses IndexedDB — which is
      // fixable, so the dashboard says how.
      blocked: store.blocked === true,
      posts,
      followers,
      following,
      blocks,
      inbound,
      outbound,
      atmosphere,
      meta: {
        posts: pm,
        followers: fm,
        following: gm,
        blocks: bm,
        inbound: im,
        outbound: om,
        repo: rm,
        followerLog: logm,
        lists: lm,
      },
      rev: prev.rev + 1,
    }));
    return { posts, meta: { posts: pm, blocks: bm, inbound: im, outbound: om } };
  }

  useEffect(() => {
    let cancelled = false;
    openAnalyticsStore(did).then(async (store) => {
      if (cancelled) return;
      storeRef.current = store;
      await reload(store);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // The dashboard is mounted once per account (App keys it by DID).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The one sync entry point. `mode`:
   *   'incremental'  top up posts, refresh followers, deepen events (default)
   *   'full'         clear the post archive and rebuild it from page one
   *   'resume'       continue an interrupted full build from its cursor
   */
  async function runSync(mode = 'incremental') {
    const store = storeRef.current;
    if (!store || !agent || abortRef.current) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setSyncError(null);
    const startedAt = Date.now();
    const errors = [];

    /* The bar: one segment per step, each filled by its own measurement.
       `begin` closes the step before it and returns a reporter bound to the
       new one, so a late report from a finished step can never move the
       next step's segment. A share only ever moves forward. */
    const plan = [...SYNC_PLAN];
    const done = [];
    const failed = [];
    let current = null;
    const begin = (step, { fraction = 0, detail = '', doing = null } = {}) => {
      // Starting the same step again (a repo diff falling back to a full
      // pull) restarts its segment; it never marks it finished.
      if (current && current !== step && !failed.includes(current) && !done.includes(current)) done.push(current);
      current = step;
      setSync({ plan: [...plan], done: [...done], failed: [...failed], step, fraction, detail, doing });
      return (nextFraction, nextDetail, nextDoing) =>
        setSync((s) => {
          if (!s || s.step !== step) return s;
          const fraction =
            nextFraction == null ? s.fraction : s.fraction == null ? nextFraction : Math.max(s.fraction, nextFraction);
          return {
            ...s,
            plan: [...plan],
            fraction,
            detail: nextDetail ?? s.detail,
            doing: nextDoing ?? s.doing,
          };
        });
    };
    const fail = (step, message) => {
      errors.push(`${step}: ${message}`);
      if (!failed.includes(step)) failed.push(step);
    };
    try {
      /* One public profile read up front: Bluesky's own follower/post
         counters, kept as the yardstick the sweeps are measured against.
         The follower counter in particular still counts deactivated,
         suspended and deleted accounts, so it sits ABOVE what getFollowers
         can list — recording it at sync time is what lets the Followers tab
         explain that gap with real numbers instead of leaving the owner to
         wonder why this page and their profile disagree. */
      const prof = await getProfile(did).catch(() => null);

      /* Followers — always the full set; only a full set can see unfollows.
         Measured against the last sweep's listable count rather than the
         profile counter, which runs ahead of what can be listed. */
      const followerEst = data.meta.followers?.count || prof?.followersCount || null;
      let report = begin('followers', { fraction: followerEst ? 0 : null });
      const fw = await sweepFollowers(agent, did, {
        signal: ac.signal,
        onProgress: (p) => report(share(p.fetched, followerEst), ofAbout(p.fetched, followerEst, 'followers')),
      });
      if (fw.complete) {
        /* Who left and who arrived since the last complete sweep: the one
           record of an unfollow there will ever be, since an unfollow takes
           its follow record with it. Kept as a log, newest first. */
        if (data.meta.followers?.complete && data.followers.length) {
          const changes = followerChanges(data.followers, fw.followers, {
            at: startedAt,
            since: data.meta.followers.syncedAt || null,
          });
          const held = (await store.getMeta('followerLog').catch(() => null)) || {};
          await store.setMeta('followerLog', mergeFollowerLog(held, changes, startedAt));
        }
        await store.clear('followers');
        await store.putAll('followers', fw.followers);
        await store.setMeta('followers', {
          syncedAt: startedAt,
          count: fw.followers.length,
          complete: true,
          profileCount: typeof prof?.followersCount === 'number' ? prof.followersCount : null,
        });
      } else if (fw.error) {
        fail('followers', fw.error);
      }
      if (ac.signal.aborted) return;

      /* Who the owner follows — the People tab's Follow buttons. A few pages
         of the owner's own repo; replaced only by a complete set, so a
         failed read never turns a real follow into a "Follow" button. */
      const followingEst = data.meta.following?.count || prof?.followsCount || null;
      report = begin('following', { fraction: followingEst ? 0 : null });
      const fl = await sweepFollowing(agent, did, {
        signal: ac.signal,
        onProgress: (p) => report(share(p.fetched, followingEst), ofAbout(p.fetched, followingEst, 'follows')),
      });
      if (fl.complete) {
        await store.clear('following');
        await store.putAll('following', fl.following);
        await store.setMeta('following', { syncedAt: startedAt, count: fl.following.length, complete: true });
      } else if (fl.error) {
        fail('following', fl.error);
      }
      if (ac.signal.aborted) return;

      /* Blocks received — Constellation enumerates block records in other
         repos that point at this DID. Their rkeys are TIDs, giving the same
         reconstructed timeline the follower graph uses. Replace only after
         a complete sweep so a failed request cannot erase good data. */
      const directEstimate = data.blocks.filter((b) => b.source === 'direct').length || null;
      report = begin('blocks');
      const bw = await sweepBlocks(did, {
        signal: ac.signal,
        onProgress: (p) => report(blocksFraction(p, { directEstimate }), blocksDetail(p, directEstimate)),
      });
      if (bw.complete) {
        const reach = blockReach(bw.blocks);
        await store.clear('blocks');
        await store.putAll('blocks', bw.blocks);
        await store.setMeta('blocks', {
          syncedAt: startedAt,
          count: reach.people.length,
          pathCount: bw.blocks.length,
          version: 2,
          complete: true,
        });
        // Every list the account is on, moderation or not, for Lists you're on.
        await store.setMeta('lists', { syncedAt: startedAt, lists: bw.lists || [] });
      } else if (bw.error) {
        fail('blocks', bw.error);
      }
      if (ac.signal.aborted) return;

      /* The repo CAR — every record in every collection, one download.
         Feeds the atmosphere rows and the COMPLETE outbound like/repost
         history; on a first build its post records also seed the charts
         long before the engagement hydration lands. `since=rev` keeps
         later syncs to a small diff. */
      let carEntries = null;
      const repoMeta = data.meta.repo;
      try {
        const pds = await resolvePds(did);
        // The PDS streams the CAR without a Content-Length, so a full pull
        // is measured against the size of the last one. A diff has no such
        // yardstick — it is small, and shows motion rather than a guess.
        const pull = async (since) => {
          const full = since == null;
          const totalGuess = full ? repoMeta?.bytes || null : null;
          report = begin('repo', {
            fraction: totalGuess ? 0 : null,
            doing: full ? 'Downloading the repo' : 'Downloading what changed in the repo',
          });
          const bytes = await fetchRepoCar(pds, did, {
            since,
            signal: ac.signal,
            onProgress: (p) =>
              report(repoDownloadFraction(p.bytes, p.total || totalGuess), megabytes(p.bytes, p.total || totalGuess)),
          });
          const expectedRecords = full ? data.atmosphere.length || null : null;
          report(null, '', 'Reading the repo archive');
          const parsed = await readRepoCar(bytes, {
            onProgress: (p) => report(repoReadFraction(p, { expectedRecords }), carDetail(p)),
          });
          return { parsed, size: bytes.byteLength };
        };
        let since = mode !== 'full' && repoMeta?.rev ? repoMeta.rev : null;
        let pulled;
        try {
          pulled = await pull(since);
        } catch (err) {
          // A diff 400s when the PDS no longer holds that rev; the honest
          // recovery is a full pull, not a failed phase.
          if (!since || ac.signal.aborted) throw err;
          since = null;
          pulled = await pull(null);
        }
        const { parsed } = pulled;
        if (ac.signal.aborted) return;

        const atmoRows = [];
        const outRows = [];
        for (const entry of parsed.entries) {
          const row = atmosphereRowFromEntry(entry);
          if (row) atmoRows.push(row);
          const kind =
            entry.collection === 'app.bsky.feed.like'
              ? 'like'
              : entry.collection === 'app.bsky.feed.repost'
                ? 'repost'
                : null;
          if (kind) {
            const ev = outboundFromRecord(kind, { uri: entry.uri, value: entry.record });
            if (ev) outRows.push(ev);
          }
        }
        // The size of the last FULL pull is the next one's yardstick.
        const bytesMeta = since == null ? pulled.size : (repoMeta?.bytes ?? null);
        // Writing ~190,000 rows into IndexedDB is the longest part of a full
        // pull, so it is measured too: in chunks, row by row.
        const toWrite = atmoRows.length + outRows.length;
        let written = 0;
        const saved = (rows) => {
          written += rows;
          report(repoSaveFraction(written, toWrite), `${num(written)} of ${num(toWrite)} rows`);
        };
        report(repoSaveFraction(0, toWrite), `${num(0)} of ${num(toWrite)} rows`, 'Saving the repo to this browser');
        if (since == null) {
          // Full pull: replace, so deleted records actually leave. The rev
          // is nulled first — a death mid-write must make the NEXT sync
          // pull full again, never diff across a half-written store.
          await store.clear('atmosphere');
          await store.clear('outbound');
          await store.setMeta('repo', { syncedAt: startedAt, rev: null, bytes: bytesMeta });
        }
        for (let i = 0; i < atmoRows.length; i += 5000) {
          const chunk = atmoRows.slice(i, i + 5000);
          await store.putAll('atmosphere', chunk);
          saved(chunk.length);
        }
        for (let i = 0; i < outRows.length; i += 5000) {
          const chunk = outRows.slice(i, i + 5000);
          await store.putAll('outbound', chunk);
          saved(chunk.length);
        }
        // An empty diff names no rev — nothing was written since the one held.
        await store.setMeta('repo', { syncedAt: startedAt, rev: parsed.rev || since, bytes: bytesMeta });
        // The CAR is now the complete outbound record: mark coverage as
        // total so the fallback sweep, if it ever runs again, knows it.
        await store.setMeta('outbound', { syncedAt: startedAt, coverageMs: 0, truncated: false });
        carEntries = parsed.entries;
      } catch (err) {
        if (ac.signal.aborted) return;
        if (current !== 'repo') begin('repo');
        fail('repo', err?.message || String(err));
        // Without the CAR, likes and reposts need their own walk at the end.
        plan.push('outbound');
      }
      if (ac.signal.aborted) return;

      /* Posts */
      const postsMeta = data.meta.posts;
      const full = mode === 'full' || !postsMeta;
      // Resume finishes any incomplete build. With a checkpointed cursor it
      // continues from that page; without one (the build died before its
      // first checkpoint) it walks from page one again but WITHOUT clearing,
      // so every page is an upsert and nothing already banked is lost.
      const resume = !full && mode === 'resume' && !postsMeta.complete;
      let est = data.posts.length || null;
      if ((full || resume) && prof?.postsCount) est = prof.postsCount;
      // The dates the walk is measured against: the repo's own post records
      // on a fresh build, the archive otherwise.
      let heldPosts = data.posts;
      const building = full || resume;
      report = begin('posts', {
        fraction: null,
        doing: building ? 'Archiving posts' : 'Refreshing recent posts',
      });
      if (full) {
        await store.clear('posts');
        // Mark the build as underway BEFORE page one. From here on, however
        // the tab dies — cancel, crash, the deploy auto-reload — the archive
        // reads as incomplete and resumable, never as "never started".
        await store.setMeta('posts', { syncedAt: startedAt, complete: false, cursor: null });
        heldPosts = [];
        if (carEntries) {
          // Seed the freshly-cleared archive with the repo's own post
          // records — counts all zero, because only the AppView knows them —
          // and paint the charts NOW. The sweep below overwrites every one
          // of these rows with counted rows in this same sync, so the zeros
          // are a first-build transient, never a lasting understatement.
          const seed = [];
          for (const entry of carEntries) {
            if (entry.collection !== 'app.bsky.feed.post') continue;
            const row = compactPostFromRecord(entry.uri, entry.record);
            if (row) seed.push(row);
          }
          if (seed.length) {
            report(null, `copying ${num(seed.length)} posts from the repo so the charts can draw`);
            await store.putAll('posts', seed);
            await reload(store);
          }
          heldPosts = seed;
        }
      }
      const postTimes = heldPosts
        .map((p) => Date.parse(p.at))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      // A build walks to the oldest post; a top-up walks back through the
      // recent window whose counts it refreshes.
      const postTarget = building ? (postTimes[0] ?? null) : startedAt - REHYDRATE_DAYS * DAY_MS;
      const measurable = postTarget != null && walkFraction(postTimes, null, postTarget) != null;
      const postsEst = building ? est : null;
      if (measurable || postsEst) report(0, '');
      const known = building ? null : new Set(data.posts.map((p) => p.uri));
      const ps = await sweepPosts({
        did,
        knownUris: known,
        rehydrateSinceMs: building ? -Infinity : startedAt - REHYDRATE_DAYS * DAY_MS,
        resumeCursor: resume ? postsMeta.cursor || null : null,
        signal: ac.signal,
        // Persist the page, THEN checkpoint the cursor that resumes after
        // it — in that order, so a kill between the two writes only costs
        // one page re-fetched, never a page skipped.
        onPage: async (rows, { cursor } = {}) => {
          await store.putAll('posts', rows);
          if (building && cursor) {
            await store.setMeta('posts', { syncedAt: startedAt, complete: false, cursor });
          }
        },
        onProgress: (p) =>
          report(
            (measurable ? walkFraction(postTimes, p.reachedMs, postTarget) : null) ?? share(p.fetched, postsEst),
            reachedDetail(ofAbout(p.fetched, postsEst, 'posts'), p.reachedMs),
          ),
      });
      if (ps.error) fail('posts', ps.error);
      if (building) {
        await store.setMeta('posts', {
          syncedAt: startedAt,
          complete: ps.complete,
          cursor: ps.complete ? null : ps.cursor,
        });
      } else {
        await store.setMeta('posts', { ...postsMeta, syncedAt: startedAt });
      }
      if (ac.signal.aborted) return;

      /* Inbound + outbound engagement events */
      const cutoffMs = startedAt - EVENT_DEPTH_DAYS * DAY_MS;

      const im = data.meta.inbound;
      // A top-up stops about where the last sync started; a sweep still
      // digging toward the cutoff has the cutoff to reach. Measured by time:
      // nothing held can say how many notifications lie in between.
      const inCovered = im?.coverageMs != null && im.coverageMs <= cutoffMs;
      const inTarget = inCovered && im?.syncedAt ? im.syncedAt : cutoffMs;
      report = begin('inbound');
      const inb = await sweepInbound(agent, {
        cutoffMs,
        knownUris: new Set(data.inbound.map((e) => e.uri)),
        coveredToMs: im?.coverageMs ?? null,
        signal: ac.signal,
        onPage: (rows) => store.putAll('inbound', rows),
        onProgress: (p) =>
          report(
            timeFraction(startedAt, p.reachedMs, inTarget),
            reachedDetail(`${num(p.fetched)} engagement ${p.fetched === 1 ? 'event' : 'events'} read`, p.reachedMs),
          ),
      });
      if (inb.error) fail('inbound', inb.error);
      else if (!inb.aborted) {
        const coverage = Math.min(im?.coverageMs ?? Infinity, inb.complete ? cutoffMs : (inb.reachedMs ?? Infinity));
        await store.setMeta('inbound', {
          syncedAt: startedAt,
          coverageMs: Number.isFinite(coverage) ? coverage : null,
          truncated: inb.truncated,
        });
      }
      if (ac.signal.aborted) return;

      /* Outbound — only as the fallback when the repo pull failed. A
         successful CAR already wrote the complete like/repost history, and
         a 240-page sweep after it would re-fetch a strict subset. */
      if (!carEntries) {
        const om = data.meta.outbound;
        const outCovered = om?.coverageMs != null && om.coverageMs <= cutoffMs;
        const outTarget = outCovered && om?.syncedAt ? om.syncedAt : cutoffMs;
        report = begin('outbound');
        const outb = await sweepOutbound(agent, did, {
          cutoffMs,
          knownUris: new Set(data.outbound.map((e) => e.uri)),
          coveredToMs: om?.coverageMs ?? null,
          signal: ac.signal,
          onPage: (rows) => store.putAll('outbound', rows),
          onProgress: (p) =>
            report(
              partsFraction(p.part, p.parts, timeFraction(startedAt, p.reachedMs, outTarget)),
              reachedDetail(`${p.part === 0 ? 'likes' : 'reposts'} · ${p.fetched.toLocaleString('en-US')} read`, p.reachedMs),
            ),
        });
        if (outb.error) fail('outbound', outb.error);
        else if (!outb.aborted) {
          const coverage = Math.min(om?.coverageMs ?? Infinity, outb.complete ? cutoffMs : (outb.reachedMs ?? Infinity));
          await store.setMeta('outbound', {
            syncedAt: startedAt,
            coverageMs: Number.isFinite(coverage) ? coverage : null,
            truncated: outb.truncated,
          });
        }
      }
    } finally {
      abortRef.current = null;
      // Every step has had its turn; what is left is reading the archive back
      // for the charts. Said as such, so the last step's segment doesn't sit
      // short of full while it happens.
      if (current && !failed.includes(current) && !done.includes(current) && !ac.signal.aborted) {
        done.push(current);
      }
      setSync((s) =>
        s ? { ...s, done: [...done], failed: [...failed], step: null, fraction: null, detail: '', doing: null } : s,
      );
      // One reload, one render of new charts — the sweeps persisted as they
      // went, so even an aborted sync surfaces everything it banked.
      const store2 = storeRef.current;
      if (store2) await reload(store2);
      setSync(null);
      if (errors.length) setSyncError(errors.join(' · '));
    }
  }

  /**
   * Follow or unfollow one account from the People tab: a follow record
   * written to (or every one deleted from) the owner's own repo, then the
   * archive's copy updated to match, so the button holds across a reload
   * without waiting for the next sync. Throws on failure — the row says so.
   */
  async function setFollow(subject, on) {
    const store = storeRef.current;
    if (!agent || !store || !subject) return;
    if (on) {
      const createdAt = new Date().toISOString();
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: FOLLOW,
        record: { $type: FOLLOW, subject, createdAt },
      });
      const row = { uri: res?.data?.uri, did: subject, followedAt: createdAt };
      if (!row.uri) throw new Error('the PDS did not return the follow record');
      await store.putAll('following', [row]);
      setData((prev) => ({ ...prev, following: [...prev.following, row], followRev: (prev.followRev || 0) + 1 }));
      return;
    }
    // Every record for this subject: a repo can hold more than one, and
    // deleting only the first would leave the account still followed.
    const rows = data.following.filter((f) => f.did === subject);
    for (const row of rows) {
      const rkey = rkeyFromAtUri(row.uri);
      if (rkey) await agent.com.atproto.repo.deleteRecord({ repo: did, collection: FOLLOW, rkey });
    }
    await store.remove('following', rows.map((r) => r.uri));
    setData((prev) => ({ ...prev, following: prev.following.filter((f) => f.did !== subject), followRev: (prev.followRev || 0) + 1 }));
  }

  /**
   * A post this account just made in Virga, added to the archive with zero
   * counts so it shows before the next sync, which fills the counts in.
   * Takes one `{ uri, cid, record }` or a list of them (a thread). Does
   * nothing before the first build: that build reads every post anyway.
   */
  async function notePosted(posted) {
    await applyPosts({ added: Array.isArray(posted) ? posted : [posted] });
  }

  /**
   * A post this account deleted (by hand, or a timer), taken out of the
   * archive at once instead of at the next rebuild. Takes a URI or a list.
   */
  async function noteDeleted(uris) {
    await applyPosts({ removed: Array.isArray(uris) ? uris : [uris] });
  }

  async function applyPosts({ added = [], removed = [] }) {
    const store = storeRef.current;
    if (!store || !latestRef.current.meta.posts) return;
    const rows = postRowsFor(did, added);
    const gone = removed.filter((uri) => isOwnPostUri(did, uri));
    if (!rows.length && !gone.length) return;
    const held = latestRef.current.posts;
    const posts = applyPostChanges(held, { rows, removed: gone });
    if (posts === held) return;
    // The rows as they now stand, with any counts the archive already had,
    // so the store and the state agree.
    const fresh = new Set(rows.map((r) => r.uri));
    if (gone.length) await store.remove('posts', gone);
    const kept = posts.filter((p) => fresh.has(p.uri));
    if (kept.length) await store.putAll('posts', kept);
    setData((prev) => {
      const next = applyPostChanges(prev.posts, { rows, removed: gone });
      return next === prev.posts ? prev : { ...prev, posts: next, rev: prev.rev + 1 };
    });
  }

  // The posting section says when a post was made or deleted; only this
  // account's own posts reach its archive. Another account's archive isn't
  // mounted, and catches up at its next sync.
  latestRef.current = data;
  const applyPostsRef = useRef(applyPosts);
  applyPostsRef.current = applyPosts;
  useEffect(() => {
    if (!did) return undefined;
    return onPostingEvent(
      POSTS_CHANGED_EVENT,
      (detail) => {
        applyPostsRef.current({ added: detail.added || [], removed: detail.removed || [] }).catch(() => {});
      },
      { did },
    );
  }, [did]);

  /* Pick incomplete builds back up, and top up a stale archive, quietly. */
  useEffect(() => {
    if (!data.loaded || !agent || autoRanRef.current) return;
    const pm = data.meta.posts;
    if (!pm) return; // first run is a button, never a surprise sweep
    autoRanRef.current = true;
    // An interrupted build resumes IMMEDIATELY, staleness be damned — the
    // interruption may have been the deploy auto-reload seconds ago, and an
    // incomplete archive is not a state worth being fresh in.
    if (!pm.complete) {
      runSync('resume');
      return;
    }
    // Existing archives may predate the blocks store, moderation-list reach
    // or the follows the People tab marks. Populate the current shape even
    // when posts are still fresh.
    if (data.meta.blocks?.version !== 2 || !data.meta.following || !data.meta.lists) {
      runSync('incremental');
      return;
    }
    if (Date.now() - (pm.syncedAt || 0) < AUTO_SYNC_AFTER_MS) return;
    runSync('incremental');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.loaded]);

  /** Resolve profile cards for DIDs a People list wants but the cache lacks. */
  async function wantActors(dids) {
    const attempted = attemptedActorsRef.current;
    const missing = (dids || []).filter((d) => d && !actors.get(d)?.handle && !attempted.has(d));
    if (!missing.length) return;
    missing.forEach((d) => attempted.add(d));
    const cache = new Map(actors);
    const fresh = await hydrateActors(missing, cache).catch(() => []);
    if (!fresh.length) return;
    // A card keeps what the tools learned about the account (when it was
    // last active) across a profile refresh.
    const merged = fresh.map((card) => ({ ...actors.get(card.did), ...card }));
    storeRef.current?.putAll('actors', merged);
    setActors((prev) => {
      const next = new Map(prev);
      for (const card of merged) next.set(card.did, { ...prev.get(card.did), ...card });
      return next;
    });
  }

  /**
   * When each of `dids` last posted or reposted, read one feed item per
   * account from the public AppView, and kept on their card in the actors
   * store. Used by Follow cleanup. Resolves with how many were read.
   */
  async function checkActivity(dids, { onProgress, signal } = {}) {
    const results = await readActivity(dids, { onProgress, signal });
    if (!results.length) return 0;
    const now = Date.now();
    let merged = [];
    setActors((prev) => {
      const next = new Map(prev);
      merged = results.map((r) => {
        const card = { did: r.did, ...prev.get(r.did), lastActiveAt: r.lastActiveAt, gone: r.gone, activityAt: now };
        next.set(r.did, card);
        return card;
      });
      return next;
    });
    await storeRef.current?.putAll('actors', merged);
    return results.length;
  }

  /**
   * Empty this account's archive in this browser: every store, the sync
   * marks with them. The account itself, its repo and its followers are
   * untouched; the next build reads it all again.
   */
  async function deleteArchive() {
    const store = storeRef.current;
    if (!store) return;
    abortRef.current?.abort();
    for (const name of ARCHIVE_STORES) await store.clear(name);
    autoRanRef.current = false;
    attemptedActorsRef.current = new Set();
    setSyncError(null);
    await reload(store);
  }

  return {
    ...data,
    actors,
    sync,
    syncError,
    runSync,
    setFollow,
    notePosted,
    noteDeleted,
    wantActors,
    checkActivity,
    deleteArchive,
    cancelSync: () => abortRef.current?.abort(),
    agent,
    did,
    handle,
  };
}

/* The words beside the progress. Each says what was measured, in its own unit. */

const num = (v) => Math.round(v).toLocaleString('en-US');

/** "2,300 of ~5,592 followers", or "2,300 followers" with nothing to go by. */
function ofAbout(fetched, est, noun) {
  return est ? `${num(fetched)} of ~${num(est)} ${noun}` : `${num(fetched)} ${noun}`;
}

/** A walk's count, then how far back in time it has reached. */
function reachedDetail(head, reachedMs) {
  return reachedMs != null ? `${head} · back to ${formatDateShort(reachedMs)}` : head;
}

function blocksDetail(p, directEstimate) {
  switch (p?.stage) {
    case 'direct':
      return ofAbout(p.done, directEstimate, 'direct blocks');
    case 'lists':
      return `finding the lists you’re on · ${num(p.done)} ${p.done === 1 ? 'membership' : 'memberships'}`;
    case 'check':
      return `checking ${num(p.done)} of ${num(p.total)} lists for moderation lists`;
    case 'subscribers':
      return `moderation lists ${num(p.done)} of ${num(p.total)} · ${num(p.fetched)} block paths`;
    default:
      return '';
  }
}

function megabytes(bytes, total) {
  const mb = (v) => (v / 1048576).toFixed(v < 10 * 1048576 ? 1 : 0);
  return total ? `${mb(bytes)} of ~${mb(total)} MB` : `${mb(bytes)} MB`;
}

function carDetail(p) {
  if (p?.stage === 'index') return 'indexing blocks';
  if (p?.stage === 'walk') return `${num(p.done)} records found`;
  if (p?.stage === 'decode') return `${num(p.done)} of ${num(p.total)} records`;
  return '';
}
