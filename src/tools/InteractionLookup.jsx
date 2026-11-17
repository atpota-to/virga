// Your whole history with one account, from what the archive already holds:
// who follows whom, every like, repost, reply, quote and mention on record,
// and when. The two directions are never added together: "them to you" and
// "you to them" sit side by side, in the same two colours all the way down.
//
// The chosen account lives in the address (`?who=<did>`), so a history can be
// linked to and reloaded. Nothing is written anywhere, and nothing is fetched
// but the profile of an account the archive hasn't met.

import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowDownLeft, ArrowUpRight, AtSign, Download, ExternalLink, Heart, MessageCircle, Quote, Repeat2, X } from 'lucide-react';
import ChartTable from '../charts/ChartTable.jsx';
import SeriesChart from '../charts/SeriesChart.jsx';
import { fmtCount } from '../charts/format.js';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import Menu from '../components/Menu.jsx';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportRows } from '../archive/exports.js';
import { bucketLabel } from '../lib/analytics.js';
import { getProfile } from '../lib/atproto.js';
import { activeLocale, fmtInt } from '../lib/locale.js';
import { formatDateShort } from '../lib/time.js';
import { cardFor, displayName, profileUrl, useWantActors } from '../people/people.jsx';
import PostRow, { postText } from '../reports/PostRow.jsx';
import { ToolHeader } from './ToolPage.jsx';
import {
  DIRECTIONS,
  KIND_LABEL,
  LOOKUP_KINDS,
  LOOKUP_PATH,
  eventPhrase,
  eventsCsvRows,
  filterEvents,
  interactionIndex,
  interactionModel,
  isDid,
  kindsLine,
  lookupHref,
  matchPeople,
  parseActorInput,
  peopleDirectory,
} from './interactionModel.js';

const KIND_ICON = { like: Heart, repost: Repeat2, reply: MessageCircle, quote: Quote, mention: AtSign };
const DIRECTION_ICON = { in: ArrowDownLeft, out: ArrowUpRight };
const DIRECTION_LABEL = { in: 'Them to you', out: 'You to them' };
const KIND_ONE = { like: 'a like', repost: 'a repost', reply: 'a reply', quote: 'a quote', mention: 'a mention' };

const START_PAGE = 12;
const POSTS_PAGE = 5;
const EVENTS_PAGE = 30;
/** How many of the busiest accounts get their names read up front, so the search can find them by name. */
const NAMES_UP_FRONT = 50;

/* ------------------------------------------------------------------ */
/* The address                                                          */
/* ------------------------------------------------------------------ */

function subscribeToAddress(listener) {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

const readSearch = () => window.location.search;

/**
 * The chosen account, kept in the address. Choosing someone is a new history
 * entry, so Back returns to whoever was there before. The router's own
 * `navigate` isn't used: it tells its listeners about paths, and here only
 * the query changes.
 */
function useWho() {
  const search = useSyncExternalStore(subscribeToAddress, readSearch, () => '');
  const who = new URLSearchParams(search).get('who') || null;
  const choose = useCallback((next, { replace = false } = {}) => {
    const href = lookupHref(next, window.location.search);
    if (href === `${window.location.pathname}${window.location.search}`) return;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
    // The History API is silent about its own moves.
    window.dispatchEvent(new PopStateEvent('popstate'));
    if (!replace) window.scrollTo(0, 0);
  }, []);

  // A move to another page carries the query string along (lib/router.jsx).
  // The chosen account stays here: nothing else reads it, and coming back
  // through the Tools page should start fresh.
  useEffect(
    () => () => {
      if (window.location.pathname.replace(/\/+$/, '') === LOOKUP_PATH) return;
      const params = new URLSearchParams(window.location.search);
      if (!params.has('who')) return;
      params.delete('who');
      const rest = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    },
    [],
  );

  return [who, choose];
}

/** A link to someone's history that moves within the page on a plain click. */
function PickLink({ did, onChoose, children, ...rest }) {
  return (
    <a
      href={lookupHref(did, typeof window === 'undefined' ? '' : window.location.search)}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onChoose(did);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

/**
 * A section: its heading, with `tools` at the heading's right, and
 * `toolbar` (what narrows the list under it) over the heading, so the
 * heading's count sits right over the rows it counts.
 */
function Card({ title, sub = null, tools = null, toolbar = null, children, className = '' }) {
  return (
    <section className={`card ${className}`.trim()} aria-label={title}>
      {toolbar}
      <div className="card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {tools}
      </div>
      {children}
    </section>
  );
}

/**
 * How many there are each way, as two counts that never touch. In a list
 * under a legend that names the two columns, the counts go without their
 * arrows (`arrows={false}`); the suggestions under the field have no
 * legend, so they keep them.
 */
function PairCount({ incoming, outgoing, arrows = true }) {
  return (
    <span className="lookup-pair num">
      <span data-dir="in" title={`${fmtInt(incoming)} them to you`}>
        {arrows && <ArrowDownLeft size={13} aria-hidden="true" />}
        {fmtInt(incoming)}
        <span className="visually-hidden"> them to you</span>
      </span>
      <span data-dir="out" title={`${fmtInt(outgoing)} you to them`}>
        {arrows && <ArrowUpRight size={13} aria-hidden="true" />}
        {fmtInt(outgoing)}
        <span className="visually-hidden"> you to them</span>
      </span>
    </span>
  );
}

function nounOf(n, one, many) {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ */
/* Choosing someone                                                     */
/* ------------------------------------------------------------------ */

/**
 * The search field: a combobox over the people the archive knows, with one
 * more option when what was typed is a whole handle or DID, which looks the
 * account up on Bluesky. ↑ and ↓ move through the suggestions, Enter takes
 * one, Escape closes them.
 */
function PersonSearch({ directory, onChoose, hint = null }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // { tone: 'info' | 'error', text } under the field, or null.
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    const typed = parseActorInput(query);
    const people = matchPeople(directory, query, { limit: 7 }).map((person) => ({ key: person.did, person }));
    // A whole handle that isn't already one of the suggestions can be
    // anyone: offer to ask Bluesky. A DID is offered only when nothing
    // matches, because half a DID reads as a whole one, and while it still
    // matches people the archive knows it is a search.
    const listed = typed?.kind === 'did' ? people.length > 0 : people.some((o) => o.person.handle.toLowerCase() === typed?.value);
    if (typed && !listed) people.push({ key: 'lookup', lookup: typed });
    return people;
  }, [directory, query]);
  const shown = open && query.trim() ? options : [];
  const listId = `${id}-list`;

  const done = (did) => {
    setQuery('');
    setOpen(false);
    setStatus(null);
    onChoose(did);
  };

  async function lookUp(actor) {
    if (actor.kind === 'did') {
      done(actor.value);
      return;
    }
    setBusy(true);
    setOpen(false);
    setStatus({ tone: 'info', text: `Looking up @${actor.value}…` });
    try {
      const profile = await getProfile(actor.value);
      if (!profile?.did) throw Object.assign(new Error('no DID in the answer'), { status: 400 });
      done(profile.did);
    } catch (err) {
      // The AppView answers 400 for a handle it can't resolve; anything
      // else is the request itself failing.
      setStatus({
        tone: 'error',
        text: err?.status === 400 ? `Bluesky doesn’t know an account called @${actor.value}.` : `Couldn’t reach Bluesky to look up @${actor.value}. Try again in a moment.`,
      });
    } finally {
      setBusy(false);
    }
  }

  const take = (option) => {
    if (!option) return;
    if (option.lookup) lookUp(option.lookup);
    else done(option.person.did);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (!shown.length) return;
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!query.trim()) return;
      if (shown.length) take(shown[Math.min(active, shown.length - 1)]);
      else if (options.length) setOpen(true);
      else setStatus({ tone: 'info', text: `Nobody your archive knows matches “${query.trim()}”. To look up anyone else, type their whole handle (name.example.com) or their DID.` });
    }
  };

  return (
    <section className="lookup-search" aria-label="Choose an account">
      <div className="lookup-combo">
        <label className="search search--lg">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3" />
          </svg>
          <span className="visually-hidden">Find an account</span>
          <input
            className="input input--lg"
            type="text"
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown.length ? `${id}-opt-${Math.min(active, shown.length - 1)}` : undefined}
            aria-describedby={status || hint ? `${id}-status` : undefined}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search by name, handle or DID"
            value={query}
            disabled={busy}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
              setStatus(null);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        {shown.length > 0 && (
          <ul id={listId} className="lookup-options" role="listbox" aria-label="Accounts">
            {shown.map((option, i) => {
              const selected = i === Math.min(active, shown.length - 1);
              const common = {
                id: `${id}-opt-${i}`,
                role: 'option',
                'aria-selected': selected,
                className: 'lookup-option',
                // Keeps the field focused, so the list doesn't close under the press.
                onPointerDown: (e) => e.preventDefault(),
                onPointerMove: () => active !== i && setActive(i),
                onClick: () => take(option),
              };
              if (option.lookup) {
                const shownAs = option.lookup.kind === 'did' ? option.lookup.value : `@${option.lookup.value}`;
                return (
                  <li key={option.key} {...common}>
                    <span className="lookup-option-glyph" aria-hidden="true">
                      <AtSign size={14} />
                    </span>
                    <span className="lookup-option-text">
                      <span className="lookup-option-name">{option.lookup.kind === 'did' ? 'Open this DID' : `Look up ${shownAs} on Bluesky`}</span>
                      <span className="lookup-option-meta">{option.lookup.kind === 'did' ? shownAs : 'Not someone your archive knows by that handle'}</span>
                    </span>
                  </li>
                );
              }
              const p = option.person;
              return (
                <li key={option.key} {...common}>
                  <Avatar src={p.avatar} name={p.displayName || p.handle || '?'} size="sm" />
                  <span className="lookup-option-text">
                    <span className="lookup-option-name">{p.displayName || (p.handle ? `@${p.handle}` : p.did)}</span>
                    <span className="lookup-option-meta">
                      {/* Someone with no name set is listed by their handle, which needn't be said twice. */}
                      {[p.displayName && p.handle ? `@${p.handle}` : null, p.handle ? null : 'Known by DID only', p.followsYou ? 'follows you' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {p.total > 0 && <PairCount incoming={p.in} outgoing={p.out} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {(status || hint) && (
        <p id={`${id}-status`} className={`lookup-status${status?.tone === 'error' ? ' is-error' : ''}`} role="status">
          {status ? status.text : hint}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Nobody chosen                                                        */
/* ------------------------------------------------------------------ */

function StartingPoint({ archive, onChoose }) {
  const [limit, setLimit] = useState(START_PAGE);
  const { ranked } = interactionIndex(archive);
  const shown = ranked.slice(0, limit);
  const names = useMemo(() => ranked.slice(0, Math.max(limit, NAMES_UP_FRONT)).map((r) => r.did), [ranked, limit]);
  useWantActors(archive, names);

  return (
    <Card
      title="People you interact with most"
      sub="Everything on record, each way. Choose someone to see your history with them."
      className="card--flush lookup-start"
      tools={
        <span className="lookup-legend" aria-hidden="true">
          <span data-dir="in">
            <ArrowDownLeft size={13} />
            Them to you
          </span>
          <span data-dir="out">
            <ArrowUpRight size={13} />
            You to them
          </span>
        </span>
      }
    >
      {shown.length ? (
        <ol className="tool-rows">
          {shown.map((r) => {
            const card = cardFor(archive, r.did);
            const name = displayName(card, r.did);
            return (
              <li key={r.did} className="lookup-pick-row">
                <PickLink did={r.did} onChoose={onChoose} className="lookup-pick">
                  <Avatar src={card?.avatar} name={card?.displayName || card?.handle || '?'} />
                  <span className="person-main">
                    <span className="person-name">{name}</span>
                    <span className="person-meta">{card?.handle ? (card.displayName ? `@${card.handle}` : '') : card ? '' : 'Reading their name…'}</span>
                  </span>
                  <PairCount incoming={r.in} outgoing={r.out} arrows={false} />
                </PickLink>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="empty">No interactions on record yet. Search for someone above to see whether they follow you.</p>
      )}
      {ranked.length > shown.length && (
        <div className="card-foot">
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + START_PAGE)}>
            Show {Math.min(START_PAGE, ranked.length - shown.length)} more
          </Button>
          <span className="num">
            {fmtInt(shown.length)} of {fmtInt(ranked.length)}
          </span>
        </div>
      )}
      <p className="card-caption">
        Them to you comes from your notifications, which reach back about a year at most. You to them comes from your repo and your posts,
        and goes all the way back.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Someone chosen                                                       */
/* ------------------------------------------------------------------ */

function theyFollowText(rel) {
  if (!rel.known) return 'Not known yet. Your follower list arrives with a sync.';
  if (rel.is) return rel.since ? `Yes, since ${formatDateShort(rel.since)}` : 'Yes, date not known';
  if (rel.left) {
    const after = rel.left.followedAt ? `, after following since ${formatDateShort(rel.left.followedAt)}` : '';
    return rel.left.since
      ? `No. They stopped between ${formatDateShort(rel.left.since)} and ${formatDateShort(rel.left.noticedAt)}${after}.`
      : `No. They had stopped by ${formatDateShort(rel.left.noticedAt)}${after}.`;
  }
  return 'No';
}

function youFollowText(rel) {
  if (!rel.known) return 'Not known yet. Who you follow arrives with the next sync.';
  if (rel.is) return rel.since ? `Yes, since ${formatDateShort(rel.since)}` : 'Yes, date not known';
  return 'No';
}

function theyBlockText(block) {
  const how = block.direct && block.list ? 'directly and through a moderation list' : block.list ? 'through a moderation list' : 'directly';
  return block.since ? `Since ${formatDateShort(block.since)}, ${how}` : `Yes, ${how}; date not known`;
}

function PersonCard({ archive, who, model, onClear }) {
  const card = cardFor(archive, who);
  const name = displayName(card, who);
  const rel = model.relationship;
  return (
    <section className="lookup-person" aria-label="The account">
      <div className="lookup-person-top">
        <Avatar src={card?.avatar} name={card?.displayName || card?.handle || '?'} size="lg" />
        <div className="lookup-person-main">
          <span className="identity-name">{name}</span>
          {card?.handle && card.displayName && <span className="muted">@{card.handle}</span>}
          {/* Without a card the name above is the DID already. */}
          {card?.handle && <code className="kv-code lookup-did">{who}</code>}
        </div>
        <div className="head-actions lookup-person-actions">
          <a className="link-action" href={profileUrl(card, who)} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} aria-hidden="true" />
            Open on Bluesky
          </a>
          <button type="button" className="link-action" onClick={onClear}>
            <X size={14} aria-hidden="true" />
            Choose someone else
          </button>
        </div>
      </div>
      {!model.self && (
        <dl className="kv lookup-facts">
          <div className="kv-row kv-row--inline">
            <dt>They follow you</dt>
            <dd>{theyFollowText(rel.theyFollow)}</dd>
          </div>
          <div className="kv-row kv-row--inline">
            <dt>You follow them</dt>
            <dd>{youFollowText(rel.youFollow)}</dd>
          </div>
          {rel.theyBlock && (
            <div className="kv-row kv-row--inline">
              <dt>They block you</dt>
              <dd>{theyBlockText(rel.theyBlock)}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

/** One cell of the totals: the count, and a bar sized against the biggest count either way. */
function TotalCell({ value, max, dir }) {
  if (value == null) {
    return (
      <td className="is-num" title="Not on record">
        <span className="lookup-total">
          <span className="lookup-total-n">—</span>
        </span>
        <span className="visually-hidden">Not on record</span>
      </td>
    );
  }
  return (
    <td className="is-num">
      <span className="lookup-total">
        <span className="lookup-total-track" aria-hidden="true">
          <span className="lookup-total-fill" data-dir={dir} style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
        </span>
        <span className="lookup-total-n">{fmtInt(value)}</span>
      </span>
    </td>
  );
}

function EdgeCell({ event }) {
  if (!event) return <td className="is-num lookup-edge">None</td>;
  return (
    <td className="is-num lookup-edge">
      {formatDateShort(event.atMs)}
      <span className="lookup-edge-kind">{KIND_ONE[event.kind] || event.kind}</span>
    </td>
  );
}

function DirectionHead({ dir }) {
  const Icon = DIRECTION_ICON[dir];
  return (
    <th scope="col" className="is-num">
      <span className="lookup-dir" data-dir={dir}>
        <Icon size={14} aria-hidden="true" />
        {DIRECTION_LABEL[dir]}
      </span>
    </th>
  );
}

function Totals({ model }) {
  const { totals, first, latest } = model;
  const max = Math.max(1, ...LOOKUP_KINDS.flatMap((k) => [totals.in[k] || 0, totals.out[k] || 0]));
  return (
    <Card title="By kind, each way" className="lookup-totals-card">
      <div className="table-scroll">
        <table className="table lookup-totals">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <DirectionHead dir="in" />
              <DirectionHead dir="out" />
            </tr>
          </thead>
          <tbody>
            {LOOKUP_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <tr key={k}>
                  <th scope="row">
                    <span className="lookup-kind">
                      <Icon size={14} aria-hidden="true" />
                      {KIND_LABEL[k]}
                    </span>
                  </th>
                  <TotalCell value={totals.in[k]} max={max} dir="in" />
                  <TotalCell value={totals.out[k]} max={max} dir="out" />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="lookup-totals-sum">
              <th scope="row">All kinds</th>
              <td className="is-num">{fmtInt(totals.in.total)}</td>
              <td className="is-num">{fmtInt(totals.out.total)}</td>
            </tr>
            <tr>
              <th scope="row">First on record</th>
              <EdgeCell event={first.in} />
              <EdgeCell event={first.out} />
            </tr>
            <tr>
              <th scope="row">Latest</th>
              <EdgeCell event={latest.in} />
              <EdgeCell event={latest.out} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function Timeline({ model, name }) {
  const t = model.timeline;
  const months = t.inbound.length;
  let caption = null;
  if (!t.inboundCovered) caption = 'There are no notifications on record, so only your side has values.';
  else if (t.inboundFromMs != null) {
    caption = `Them to you starts in ${bucketLabel(t.inboundFromMs, 'month')}, where your notifications begin. The months before it have no value, which isn’t the same as none.`;
  }
  return (
    <Card title="Interactions per month" sub={`Each way, from the first on record to now: ${nounOf(months, 'month', 'months')}`}>
      <SeriesChart
        series={t.inbound}
        seriesLabel="Them to you"
        secondary={{ series: t.outbound, label: 'You to them' }}
        mode="line"
        unit="month"
        height={240}
        format={(v) => (v == null ? 'not on record' : fmtCount(v))}
        ariaLabel={`Interactions with ${name} per month, them to you and you to them`}
      />
      <ChartTable series={t.inbound} secondary={t.outbound} unit="month" valueHead="Them to you" secondaryHead="You to them" />
      {caption && <p className="card-caption">{caption}</p>}
    </Card>
  );
}

/**
 * Which of your posts they engaged with most. The archive can only say for
 * events that name their post, and today's don't, so until they do this is
 * a card that says so in a line, not an empty ranking.
 */
function EngagedPosts({ model }) {
  const [limit, setLimit] = useState(POSTS_PAGE);
  const { engagedPosts } = model;
  const shown = engagedPosts.rows.slice(0, limit);
  if (!engagedPosts.known) {
    return (
      <section className="card lookup-cannot-card" aria-label="Your posts they engaged with most">
        <h2 className="card-title">Your posts they engaged with most</h2>
        <p className="card-sub lookup-cannot">
          {engagedPosts.of
            ? 'The archive keeps who engaged and when, not which post it was for, so there’s no ranking to show. Their replies, quotes and mentions are in the list below, each with a link to their post.'
            : 'They haven’t liked, reposted, replied to or quoted you, as far as your notifications reach.'}
        </p>
      </section>
    );
  }
  return (
    <Card
      title="Your posts they engaged with most"
      sub={engagedPosts.counted < engagedPosts.of ? `From the ${fmtInt(engagedPosts.counted)} of ${fmtInt(engagedPosts.of)} events that say which post` : null}
      className="card--flush"
    >
      {shown.length ? (
        <ol className="widget-rows report-rows">
          {shown.map((row, i) => (
            <li key={row.uri} className="post-row">
              <span className="post-rank num">{i + 1}</span>
              <div className="post-main">
                <a className="post-text" href={row.url} target="_blank" rel="noopener noreferrer" title="Open on Bluesky">
                  {row.post ? postText(row.post) : 'A post that isn’t in your archive'}
                </a>
                <span className="meta num">
                  {row.post && <span>{formatDateShort(row.post.at)}</span>}
                  <span>{kindsLine(row.byKind)}</span>
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">None of the events that name a post name one of yours.</p>
      )}
      {engagedPosts.rows.length > shown.length && (
        <div className="card-foot">
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + POSTS_PAGE * 2)}>
            Show {Math.min(POSTS_PAGE * 2, engagedPosts.rows.length - shown.length)} more
          </Button>
          <span className="num">
            {fmtInt(shown.length)} of {fmtInt(engagedPosts.rows.length)}
          </span>
        </div>
      )}
    </Card>
  );
}

function YourPosts({ archive, model, who }) {
  const [limit, setLimit] = useState(POSTS_PAGE);
  const posts = model.yourPosts;
  const shown = posts.slice(0, limit);
  const replies = posts.filter((p) => p.replyTo === who).length;
  const quotes = posts.filter((p) => p.quoteOf === who).length;
  return (
    <Card
      title="Your replies to them and quotes of them"
      sub={posts.length ? `${nounOf(replies, 'reply', 'replies')} and ${nounOf(quotes, 'quote', 'quotes')}, newest first` : null}
      className="card--flush"
    >
      {shown.length ? (
        <ol className="widget-rows report-rows">
          {shown.map((p) => (
            <PostRow key={p.uri} post={p} did={archive.did} />
          ))}
        </ol>
      ) : (
        <p className="empty">You haven’t replied to them or quoted them{model.coverage.postsComplete ? '.' : ', in the part of your posts archived so far.'}</p>
      )}
      {posts.length > shown.length && (
        <div className="card-foot">
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + POSTS_PAGE * 2)}>
            Show {Math.min(POSTS_PAGE * 2, posts.length - shown.length)} more
          </Button>
          <span className="num">
            {fmtInt(shown.length)} of {fmtInt(posts.length)}
          </span>
        </div>
      )}
    </Card>
  );
}

function EventRow({ event }) {
  const Icon = KIND_ICON[event.kind] || Heart;
  const when = new Date(event.atMs);
  return (
    <li className="lookup-event" data-dir={event.dir}>
      <time className="lookup-event-date num" dateTime={event.at} title={when.toLocaleString(activeLocale(), { dateStyle: 'medium', timeStyle: 'short' })}>
        {formatDateShort(event.atMs)}
      </time>
      <span className="lookup-event-glyph" data-dir={event.dir} aria-hidden="true">
        <Icon size={14} />
      </span>
      <span className="lookup-event-main">
        <span className="lookup-event-what">{eventPhrase(event)}</span>
        {event.text && <span className="lookup-event-text">{event.text}</span>}
      </span>
      {event.url && (
        <a className="table-link lookup-event-link" href={event.url} target="_blank" rel="noopener noreferrer">
          {event.urlOwner === 'you' ? 'Your post' : 'Their post'}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

function Events({ model, name, shown: filtered, direction, kind, onDirection, onKind, onExport }) {
  const [limit, setLimit] = useState(EVENTS_PAGE);
  const total = model.events.length;
  const rows = filtered.slice(0, limit);
  const narrowed = direction !== 'all' || kind !== 'all';
  const none =
    kind === 'mention' && direction === 'out' && model.totals.out.mention == null
      ? 'Mentions you made aren’t on record.'
      : 'Nothing on record matches these filters.';
  // Over what it exports: one file when the list is whole, a choice when
  // the filters have narrowed it.
  const exportTool = narrowed ? (
    <Menu
      variant="link"
      label="Export"
      icon={Download}
      items={[
        {
          icon: Download,
          label: `These ${nounOf(filtered.length, 'event', 'events')} (CSV)`,
          hint: 'What the list shows, with its filters.',
          onSelect: () => onExport(filtered),
        },
        {
          icon: Download,
          label: `All ${nounOf(total, 'event', 'events')} (CSV)`,
          hint: `Everything on record with ${name}, each way.`,
          onSelect: () => onExport(model.events),
        },
      ]}
    />
  ) : (
    <button type="button" className="link-action" onClick={() => onExport(model.events)}>
      <Download size={14} aria-hidden="true" />
      Export
    </button>
  );
  return (
    <Card
      title="Every interaction"
      sub={
        <span className="num" role="status">
          {narrowed ? `${fmtInt(filtered.length)} of ${nounOf(total, 'event', 'events')}` : nounOf(total, 'event', 'events')}, newest first
        </span>
      }
      className="card--flush lookup-events-card"
      tools={exportTool}
      toolbar={
        <div className="list-toolbar lookup-filters">
          <Segmented
            size="sm"
            label="Direction"
            value={direction}
            onChange={(v) => {
              onDirection(v);
              setLimit(EVENTS_PAGE);
            }}
            options={DIRECTIONS.map((d) => ({ value: d.key, label: d.label, icon: DIRECTION_ICON[d.key] }))}
          />
          <Segmented
            size="sm"
            className="kind-filter"
            label="Kind"
            value={kind}
            onChange={(v) => {
              onKind(v);
              setLimit(EVENTS_PAGE);
            }}
            options={[{ value: 'all', label: 'All' }, ...LOOKUP_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], icon: KIND_ICON[k], title: KIND_LABEL[k] }))]}
          />
        </div>
      }
    >
      {rows.length ? (
        <ol className="tool-rows lookup-events">
          {rows.map((event) => (
            <EventRow key={event.key} event={event} />
          ))}
        </ol>
      ) : (
        <p className="empty">{none}</p>
      )}
      {filtered.length > rows.length && (
        <div className="card-foot">
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + EVENTS_PAGE)}>
            Show {Math.min(EVENTS_PAGE, filtered.length - rows.length)} more
          </Button>
          <span className="num">
            {fmtInt(rows.length)} of {fmtInt(filtered.length)}
          </span>
        </div>
      )}
    </Card>
  );
}

function HowCounted({ model }) {
  const { coverage, totals, engagedPosts } = model;
  return (
    <details className="disclosure how-counted">
      <summary>How this is counted</summary>
      <div className="how-counted-body">
        <p>
          Them to you comes from your notifications: likes, reposts, replies, quotes and mentions aimed at you. Notifications only go back
          as far as Bluesky had kept them when your archive was first built, and a year at most
          {coverage.inboundSinceMs != null ? `. Yours reach back to ${formatDateShort(coverage.inboundSinceMs)}` : '. Yours hold nothing yet'}; what
          anyone did before that isn’t on record.
          {coverage.inboundTruncated ? ' The last sync stopped before it reached the end of them, so the next one may find more.' : ''}
        </p>
        <p>
          You to them comes from two places. Your likes and reposts are records in your repo
          {coverage.outboundSinceMs != null ? `, read back to ${formatDateShort(coverage.outboundSinceMs)} so far` : ', every one you have ever made'}. Your replies
          and quotes are read from your posts{coverage.postsComplete ? '' : ', which are still being archived'}.
          {totals.out.mention == null
            ? ' Who your posts mention isn’t on record, so mentions are counted them to you only.'
            : ' So are your mentions; a post that replies to them and also mentions them counts as both.'}
        </p>
        <p>
          A reply, a quote or a mention is a post, and is listed with a link to it. A like or a repost is listed without one: the archive
          keeps that it happened and when, not which post it was
          {engagedPosts.known ? ', except where the event says so.' : ', which is also why it can’t rank your posts by how much they engaged with them.'}
        </p>
        <p>
          Who follows whom is as of your last sync, and each follow is dated by its own record; where that can’t be read, the date is left
          out. A follow that has ended leaves no record: someone who stopped following you shows only if the unfollow tracker saw it
          happen.
        </p>
        <p>Months are counted on your own calendar. Everything is read from the archive in this browser.</p>
      </div>
    </details>
  );
}

function Chosen({ tool, archive, who, search, onClear }) {
  const [direction, setDirection] = useState('all');
  const [kind, setKind] = useState('all');
  const wanted = useMemo(() => [who], [who]);
  useWantActors(archive, wanted);
  const model = interactionModel(archive, who);
  const card = cardFor(archive, who);
  const name = displayName(card, who);
  const filtered = useMemo(() => filterEvents(model.events, { direction, kind }), [model.events, direction, kind]);

  const exportEvents = (events) =>
    exportRows(archive, `interactions-${String(card?.handle || who).replace(/[^a-z0-9.-]+/gi, '-')}`, eventsCsvRows(events, { did: who, handle: card?.handle || '' }));

  return (
    <>
      <ToolHeader tool={tool} />
      <div className="page-body">
        {search}
        <PersonCard archive={archive} who={who} model={model} onClear={onClear} />
        {model.self ? (
          <p className="empty">This is the account you’re signed in with. Replies to your own posts are threads, so there’s no history to show.</p>
        ) : model.events.length === 0 ? (
          <p className="empty">
            Nothing on record between you and {name}
            {model.coverage.inboundSinceMs != null ? `. Your notifications reach back to ${formatDateShort(model.coverage.inboundSinceMs)}; anything before that wouldn’t show.` : '.'}
          </p>
        ) : (
          <>
            <div className="report-split lookup-top">
              <Totals model={model} />
              <Timeline model={model} name={name} />
            </div>
            {model.engagedPosts.known ? (
              <div className="report-split">
                <EngagedPosts model={model} />
                <YourPosts archive={archive} model={model} who={who} />
              </div>
            ) : (
              <>
                <EngagedPosts model={model} />
                <YourPosts archive={archive} model={model} who={who} />
              </>
            )}
            <Events model={model} name={name} shown={filtered} direction={direction} kind={kind} onDirection={setDirection} onKind={setKind} onExport={exportEvents} />
          </>
        )}
        {!model.self && <HowCounted model={model} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                             */
/* ------------------------------------------------------------------ */

export default function InteractionLookup({ tool }) {
  const archive = useArchive();
  const [who, choose] = useWho();
  // How looking up an address that names a handle rather than a DID (typed
  // by hand, or shared that way) ended: { for, status: 'missing' | 'failed' }.
  const [resolved, setResolved] = useState(null);

  const directory = useMemo(
    () => peopleDirectory(archive, (did) => cardFor(archive, did)),
    // The archive object is new on every render; these are what the list is made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [archive.did, archive.rev, archive.followRev, archive.actors],
  );

  const named = who && !isDid(who) ? who : null;
  const namedHandle = named ? parseActorInput(named)?.value || null : null;
  useEffect(() => {
    if (!namedHandle) return undefined;
    let gone = false;
    getProfile(namedHandle)
      .then((profile) => {
        if (gone) return;
        // The address takes the DID in place of the handle: a handle can change hands.
        if (profile?.did) choose(profile.did, { replace: true });
        else setResolved({ for: named, status: 'missing' });
      })
      .catch((err) => !gone && setResolved({ for: named, status: err?.status === 400 ? 'missing' : 'failed' }));
    return () => {
      gone = true;
    };
  }, [named, namedHandle, choose]);

  const clear = () => choose(null);

  if (who && !named) {
    return (
      <Chosen
        key={who}
        tool={tool}
        archive={archive}
        who={who}
        onClear={clear}
        search={<PersonSearch directory={directory} onChoose={choose} />}
      />
    );
  }

  const state = !named ? null : !namedHandle ? 'missing' : resolved?.for === named ? resolved.status : 'looking';
  return (
    <>
      <ToolHeader tool={tool} />
      <div className="page-body">
        <PersonSearch
          directory={directory}
          onChoose={choose}
          hint="Suggestions are the people your archive knows. To look up anyone else, type their whole handle or their DID."
        />
        {state === 'looking' && (
          <p className="empty" role="status">
            Looking up {named}…
          </p>
        )}
        {(state === 'missing' || state === 'failed') && (
          <p className="callout callout--warn" role="alert">
            {state === 'missing' ? `The address names “${named}”, which Bluesky doesn’t know as an account.` : `Couldn’t reach Bluesky to look up “${named}”. Reload to try again.`}
          </p>
        )}
        {state !== 'looking' && <StartingPoint archive={archive} onChoose={choose} />}
      </div>
    </>
  );
}
