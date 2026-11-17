// What each card on a dashboard draws. Every card reads the shared models
// (reports/models.js) for the dashboard's period, so ten cards on a screen
// cost one pass over each archive, and a card says the same as the report
// it links to.
//
// A card is `({ archive, period, nowMs, size })`. Figures (kind 'stat')
// return a <Stat>; the rest return their body, and the frame around them
// (DashboardPage) draws the title, the link to the full report and the
// editing controls. A card with something for its heading besides the title
// (a count, its chart's modes) says what in WIDGET_HEADS, at the end.

import { Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react';
import BarList from '../../charts/BarList.jsx';
import Heatmap from '../../charts/Heatmap.jsx';
import SeriesChart from '../../charts/SeriesChart.jsx';
import { fmtFigure, fmtRate, unitNoun } from '../../charts/format.js';
import Delta from '../../components/Delta.jsx';
import { FollowerCountTip } from '../../components/InfoTip.jsx';
import { movingAverage } from '../../lib/analytics.js';
import { relativeTime } from '../../lib/time.js';
import { PersonRow, useFollow, useWantActors } from '../../people/people.jsx';
import PostRow from '../../reports/PostRow.jsx';
import { useChartMarks } from '../../reports/useAnnotations.js';
import { kindsLine } from '../../tools/interactionModel.js';
import { CONTENT_WIDGETS } from './content.jsx';
import { HEIGHT, Stat, rowsFor, rowsShown } from './parts.jsx';
import { POSTING_WIDGETS } from './posting.jsx';
import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  atmosphereModel,
  bestTimeModel,
  blocksModel,
  engagementModel,
  followBackModel,
  followerLogModel,
  followersModel,
  givenModel,
  hourColumns,
  hourRange,
  weekdayOrder,
  listsModel,
  peopleModel,
  postsModel,
} from '../../reports/models.js';
import { periodPhrase } from '../../shell/bits.jsx';
import { activeLocale } from '../../lib/locale.js';
import { periodBefore, periodWindowWord } from '../../lib/periods.js';

const KIND_ICON = { like: Heart, repost: Repeat2, reply: MessageCircle, quote: Quote };

/** "Likes" for 'like'; the given word when a card counts every kind. */
export const KIND_NOUN = { like: 'Likes', repost: 'Reposts', reply: 'Replies', quote: 'Quotes' };
function kindWord(kind, all) {
  return KIND_NOUN[kind] || all;
}

const windowWord = periodWindowWord;

function compareTitle(period, previous) {
  return period.days ? `${periodBefore(period, true)}: ${Math.round(previous).toLocaleString(activeLocale())}` : null;
}

/**
 * The change against the window before, where there is one to give: a
 * window with nothing before it (a new account, a range that starts with
 * it) has no change worth a figure, only "new".
 */
function changeOf(period, compare) {
  if (!period.days || !compare.previous) return null;
  return <Delta pct={compare.pct} title={compareTitle(period, compare.previous)} />;
}

/* ------------------------------------------------------------------ */
/* Figures                                                              */
/* ------------------------------------------------------------------ */

function StatFollowers({ archive, period, nowMs, def, title }) {
  const m = followersModel(archive, period, nowMs);
  // The profile's own counter leads: it is the number people know. What can
  // actually be listed (what every chart counts) sits under it, explained.
  const lead = m.profileCount ?? m.total;
  const differs = m.profileCount != null && m.profileCount !== m.total;
  return (
    <Stat
      icon={def.icon}
      label={title || 'Followers'}
      to={def.href}
      window="Now"
      value={fmtFigure(lead)}
      delta={<span className="delta is-up" title={`New in ${periodPhrase(period)}`}>+{m.gained.toLocaleString(activeLocale())}</span>}
      sub={
        differs ? (
          <>
            {m.total.toLocaleString(activeLocale())} can be{' '}
            <span className="stat-keep">
              listed <FollowerCountTip profileCount={m.profileCount} listed={m.total} />
            </span>
          </>
        ) : null
      }
      spark={m.cumulative.map((p) => p.v)}
    />
  );
}

function StatNewFollowers({ archive, period, nowMs, def, title }) {
  const m = followersModel(archive, period, nowMs);
  return (
    <Stat
      icon={def.icon}
      label={title || 'New followers'}
      to={def.href}
      window={windowWord(period)}
      value={fmtFigure(m.gained)}
      delta={changeOf(period, m.compare)}
      sub={
        !period.days
          ? `${fmtFigure(m.perDay, { decimals: true })} a day`
          : m.compare.previous
            ? `${m.compare.previous.toLocaleString(activeLocale())} ${periodBefore(period)}`
            : `None ${periodBefore(period)}`
      }
      spark={m.counts.map((p) => p.v)}
    />
  );
}

function StatUnfollows({ archive, def, title }) {
  const m = followerLogModel(archive);
  return (
    <Stat
      icon={def.icon}
      label={title || 'Unfollows'}
      to={def.href}
      window="Last sync"
      value={m.tracking ? fmtFigure(m.latestLost.length) : '—'}
      sub={
        m.tracking
          ? `${m.latestGained.length.toLocaleString(activeLocale())} arrived · ${m.lost.length.toLocaleString(activeLocale())} left in all`
          : 'Counting starts with your next sync'
      }
    />
  );
}

function StatEngagement({ archive, period, nowMs, def, title, kind = 'all' }) {
  const m = engagementModel(archive, period, nowMs, { kind });
  return (
    <Stat
      icon={def.icon}
      label={title || kindWord(kind, 'Engagement')}
      to={def.href}
      window={windowWord(period)}
      value={fmtFigure(m.total)}
      delta={changeOf(period, m.compare)}
      sub={m.ownRate != null ? `${fmtRate(m.ownRate)} per post` : 'No posts in this window'}
      spark={m.series.map((p) => p.v)}
    />
  );
}

function StatPerPost({ archive, period, nowMs, def, title, kind = 'all' }) {
  const m = engagementModel(archive, period, nowMs, { kind });
  return (
    <Stat
      icon={def.icon}
      label={title || `${kindWord(kind, 'Engagement')} per post`}
      to={def.href}
      window={windowWord(period)}
      value={m.ownRate == null ? '—' : fmtRate(m.ownRate)}
      delta={m.rateCompare ? <Delta pct={m.rateCompare.pct} title={`${periodBefore(period, true)}: ${fmtRate(m.rateCompare.previous)}`} /> : null}
      sub={`Over ${m.ownPosts.toLocaleString(activeLocale())} posts and threads`}
      spark={m.rate.map((p) => p.v)}
    />
  );
}

function StatGiven({ archive, period, nowMs, def, title, kind = 'all' }) {
  const m = givenModel(archive, period, nowMs, { kind });
  return (
    <Stat
      icon={def.icon}
      label={title || `${kindWord(kind, 'Engagement')} given`}
      to={def.href}
      window={windowWord(period)}
      value={fmtFigure(m.total)}
      delta={changeOf(period, m.compare)}
      sub={`To ${m.accounts.toLocaleString(activeLocale())} accounts`}
      spark={m.series.map((p) => p.v)}
    />
  );
}

function StatPosts({ archive, period, nowMs, def, title }) {
  const m = postsModel(archive, period, nowMs);
  const replies = m.count ? Math.round((m.replies / m.count) * 100) : 0;
  return (
    <Stat
      icon={def.icon}
      label={title || 'Posts'}
      to={def.href}
      window={windowWord(period)}
      value={fmtFigure(m.count)}
      delta={changeOf(period, m.compare)}
      sub={`${fmtFigure(m.perDay, { decimals: true })} a day · ${replies}% replies`}
      spark={m.counts.map((p) => p.v)}
    />
  );
}

function StatBlocks({ archive, period, nowMs, def, title }) {
  if (!archive.meta.blocks) return <Stat icon={def.icon} label={title || 'Blocked by'} value="—" sub="Read at the next sync" />;
  const m = blocksModel(archive, period, nowMs);
  return (
    <Stat
      icon={def.icon}
      label={title || 'Blocked by'}
      to={def.href}
      window="Now"
      value={fmtFigure(m.total)}
      delta={<span className="delta is-down" title={`New in ${periodPhrase(period)}`}>+{m.received.toLocaleString(activeLocale())}</span>}
      sub={`${m.directTotal.toLocaleString(activeLocale())} direct · ${m.listTotal.toLocaleString(activeLocale())} via lists`}
      spark={m.cumulative.map((p) => p.v)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Charts                                                               */
/* ------------------------------------------------------------------ */

/** The total, or what was new each day; the frame draws the choice in the card's heading (WIDGET_HEADS). */
function FollowerGrowth({ archive, period, nowMs, size, view = 'total' }) {
  const m = followersModel(archive, period, nowMs);
  const total = view !== 'new';
  const marks = useChartMarks(archive, total ? m.cumulative : m.counts, m.unit, { milestones: true });
  if (!archive.followers.length) return <p className="empty">Your followers haven’t been read yet.</p>;
  return (
    <SeriesChart
      series={total ? m.cumulative : m.counts}
      mode={total ? 'line' : 'bars'}
      unit={m.unit}
      zeroBase={!total}
      height={HEIGHT[size]}
      marks={marks}
      ghost={total && m.counterGap > 0 ? { v: m.profileCount } : null}
      ariaLabel={total ? `Followers over ${periodPhrase(period)}` : `New followers per ${m.unit} over ${periodPhrase(period)}`}
    />
  );
}

function NewFollowers({ archive, period, nowMs, size }) {
  const m = followersModel(archive, period, nowMs);
  const marks = useChartMarks(archive, m.counts, m.unit, { milestones: true });
  if (!archive.followers.length) return <p className="empty">Your followers haven’t been read yet.</p>;
  return (
    <SeriesChart
      series={m.counts}
      trend={movingAverage(m.counts, 7)}
      mode="bars"
      unit={m.unit}
      height={HEIGHT[size]}
      marks={marks}
      ariaLabel={`New followers per ${m.unit} over ${periodPhrase(period)}`}
    />
  );
}

function EngagementOverTime({ archive, period, nowMs, size, kind = 'all' }) {
  const m = engagementModel(archive, period, nowMs, { kind });
  const marks = useChartMarks(archive, m.series, m.unit);
  return (
    <SeriesChart
      series={m.series}
      trend={m.trend}
      mode="bars"
      unit={m.unit}
      height={HEIGHT[size]}
      marks={marks}
      ariaLabel={`${kindWord(kind, 'Engagement')} on posts made each ${m.unit}, over ${periodPhrase(period)}`}
    />
  );
}

function EngagementRate({ archive, period, nowMs, size, kind = 'all' }) {
  const m = engagementModel(archive, period, nowMs, { kind });
  return (
    <SeriesChart
      series={m.rate}
      trend={m.rateTrend}
      mode="bars"
      unit={m.rateUnit}
      format={fmtRate}
      height={HEIGHT[size]}
      ariaLabel={`${kindWord(kind, 'Engagement')} per post, by the ${m.rateUnit} each post was made, over ${periodPhrase(period)}`}
    />
  );
}

function EngagementByType({ archive, period, nowMs }) {
  const m = engagementModel(archive, period, nowMs);
  return (
    <BarList
      ariaLabel="Engagement by type"
      labelWidth="96px"
      rows={m.byKind.map((k) => ({ key: k.kind, label: k.label, icon: KIND_ICON[k.kind], value: k.value }))}
    />
  );
}

function EngagementGiven({ archive, period, nowMs, size, kind = 'all' }) {
  const m = givenModel(archive, period, nowMs, { kind });
  return (
    <SeriesChart
      series={m.series}
      trend={m.trend}
      mode="bars"
      unit={m.unit}
      height={HEIGHT[size]}
      ariaLabel={`${kindWord(kind, 'Engagement')} given per ${m.unit} over ${periodPhrase(period)}`}
    />
  );
}

function PostingCadence({ archive, period, nowMs, size }) {
  const m = postsModel(archive, period, nowMs);
  const marks = useChartMarks(archive, m.counts, m.unit);
  return (
    <SeriesChart
      series={m.counts}
      trend={m.trend}
      mode="bars"
      unit={m.unit}
      height={HEIGHT[size]}
      marks={marks}
      ariaLabel={`Posts per ${m.unit} over ${periodPhrase(period)}`}
    />
  );
}

/**
 * Engagement per post by weekday and hour. A short period holds too few
 * posts to say anything, so under 90 days this reads the last year.
 */
export function bestTimeWindow(period) {
  return period.days && period.days < 90 ? { key: '1y', days: 365, label: 'Year' } : period;
}

export function bestTimeSentence(m) {
  if (!m.best.length) return 'Not enough posts yet to say when yours do best.';
  const top = m.best[0];
  return `Your posts do best on ${WEEKDAYS_LONG[top.day]}s, ${hourRange(top.col, m.block)}: a typical post there earns ${fmtRate(top.avg)}${m.overall != null ? `, against ${fmtRate(m.overall)} overall` : ''}.`;
}

/** The heatmap's rows, in the order the reader's week runs. */
export function bestTimeRows(m) {
  const best = m.best[0];
  return weekdayOrder().map((day) => {
    const r = m.rows[day];
    return {
      label: r.label,
      cells: r.cells.map((c, col) => ({
        value: c.avg,
        best: best && best.day === day && best.col === col,
        title: c.avg == null
          ? `${WEEKDAYS[day]} ${hourRange(col, m.block)}: ${c.posts ? `only ${c.posts} post${c.posts === 1 ? '' : 's'}` : 'no posts'}`
          : `${WEEKDAYS[day]} ${hourRange(col, m.block)}: a typical post earns ${fmtRate(c.avg)} (${c.posts} posts)`,
      })),
    };
  });
}

function BestTime({ archive, period, nowMs }) {
  const win = bestTimeWindow(period);
  const m = bestTimeModel(archive, win, nowMs);
  return (
    <div className="widget-stack">
      <p className="widget-insight">{bestTimeSentence(m)}</p>
      <Heatmap rows={bestTimeRows(m)} columns={hourColumns(m.block)} summary={bestTimeSentence(m)} />
      <p className="widget-foot">
        {m.posts.toLocaleString(activeLocale())} posts and threads over {periodPhrase(win)}, in your time zone.
      </p>
    </div>
  );
}

function BlocksOverTime({ archive, period, nowMs, size }) {
  if (!archive.meta.blocks) return <p className="empty">Blocks are read at the next sync.</p>;
  const m = blocksModel(archive, period, nowMs);
  return (
    <SeriesChart
      series={m.directCumulative}
      seriesLabel="Direct"
      secondary={{ series: m.listCumulative, label: 'Via lists' }}
      stacked
      mode="line"
      unit={m.unit}
      zeroBase={false}
      height={HEIGHT[size]}
      ariaLabel={`Block reach over ${periodPhrase(period)}, direct and through moderation lists`}
    />
  );
}

function RepoActivity({ archive, period, nowMs, size }) {
  const m = atmosphereModel(archive, period, nowMs);
  if (!m) return <p className="empty">The repo is read at the next sync.</p>;
  return (
    <SeriesChart
      series={m.series}
      trend={m.trend}
      mode="bars"
      unit={m.unit}
      height={HEIGHT[size]}
      ariaLabel={`Records written to the repo per ${m.unit} over ${periodPhrase(period)}`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Lists                                                                */
/* ------------------------------------------------------------------ */

function TopPosts({ archive, period, nowMs, size, kind = 'all', rows: want = null }) {
  const m = engagementModel(archive, period, nowMs, { kind });
  const rows = m.top.slice(0, rowsFor(size, want));
  if (!rows.length) return <p className="empty">No posts in this window.</p>;
  return (
    <ol className="widget-rows">
      {rows.map((p, i) => (
        <PostRow key={p.uri} post={p} did={archive.did} kind={kind} rank={i + 1} breakdown={false} />
      ))}
    </ol>
  );
}

/**
 * People in a card. `rel` is false for a list where everyone follows you
 * (your newest followers, the follow-back queue), which would otherwise say
 * "follows you" on every row.
 */
function PeopleList({ archive, rows, size, want = null, empty, value = (r) => r.total.toLocaleString(activeLocale()), meta = null, followLabel, rel = true }) {
  const shown = rows.slice(0, rowsFor(size, want));
  useWantActors(archive, shown.map((r) => r.did));
  const follow = useFollow(archive);
  if (!shown.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="widget-rows">
      {shown.map((r) => (
        <PersonRow
          key={r.did}
          archive={archive}
          did={r.did}
          card={r.handle != null ? { handle: r.handle, displayName: r.displayName, avatar: r.avatar } : null}
          value={value(r)}
          meta={meta?.(r)}
          follow={follow}
          followLabel={followLabel}
          rel={rel}
        />
      ))}
    </ul>
  );
}

/** What a person's count is made of, the largest first: "84 likes, 12 replies". */
function detailOf(row) {
  return kindsLine(row.byKind, { byCount: true });
}

function TopEngagers({ archive, period, nowMs, size, kind = 'all', rows = null }) {
  const m = peopleModel(archive, period, nowMs, { kind });
  return <PeopleList archive={archive} rows={m.inbound} size={size} want={rows} meta={detailOf} empty="Nobody has engaged with you in this window yet." />;
}

function YouEngageWith({ archive, period, nowMs, size, kind = 'all', rows = null }) {
  const m = peopleModel(archive, period, nowMs, { kind });
  return <PeopleList archive={archive} rows={m.outbound} size={size} want={rows} meta={detailOf} empty="You haven’t engaged with anyone in this window." />;
}

function FollowBack({ archive, period, nowMs, size, rows: want = null }) {
  const rows = followBackModel(archive, period, nowMs);
  return (
    <PeopleList
      archive={archive}
      rows={rows}
      size={size}
      want={want}
      meta={(r) => `${r.total} interaction${r.total === 1 ? '' : 's'}`}
      value={() => null}
      followLabel="Follow back"
      rel={false}
      empty="Everyone who follows you and engages, you already follow."
    />
  );
}

function NewestFollowers({ archive, period, nowMs, size, rows: want = null }) {
  const m = followersModel(archive, period, nowMs);
  const rows = m.newest.map((f) => ({ did: f.did, atMs: f.atMs }));
  return (
    <PeopleList
      archive={archive}
      rows={rows}
      size={size}
      want={want}
      value={() => null}
      meta={(r) => `followed ${relativeTime(r.atMs)}`}
      followLabel="Follow back"
      rel={false}
      empty="Nobody new in this window."
    />
  );
}

function Unfollows({ archive, size, rows: want = null }) {
  const m = followerLogModel(archive);
  if (!m.tracking) {
    return <p className="empty">Unfollows are found by comparing two syncs. Counting starts with your next one.</p>;
  }
  return (
    <PeopleList
      archive={archive}
      rows={m.lost}
      size={size}
      want={want}
      value={() => null}
      meta={(r) => `noticed ${relativeTime(r.at)}`}
      empty={`Nobody has unfollowed you since ${relativeTime(m.since)}.`}
    />
  );
}

const PURPOSE_WORD = { moderation: 'Moderation', curation: 'Curation' };

/**
 * The lists you're on, each with what it is for and who subscribes. The
 * count of them heads the card (WIDGET_HEADS). A moderation list is the one
 * to know about, so its word is a step louder; it isn't a problem to find,
 * so it carries no badge.
 */
function ListsOn({ archive, size, rows: want = null }) {
  if (!archive.meta.lists) return <p className="empty">Lists are read at the next sync.</p>;
  const lists = listsModel(archive);
  if (!lists.length) return <p className="empty">You aren’t on any lists.</p>;
  return (
    <ul className="widget-rows">
      {lists.slice(0, rowsShown('lists-on', size, want)).map((l) => (
        <li key={l.uri} className="list-row">
          <span className="list-row-name">{l.name || 'Untitled list'}</span>
          <span className="list-row-subs meta num">
            <span className={l.purpose === 'moderation' ? 'is-key' : undefined}>{PURPOSE_WORD[l.purpose] || l.purpose}</span>
            {l.subscribers != null && <span>{l.subscribers.toLocaleString(activeLocale())} subscribers</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RepoCollections({ archive, period, nowMs, size, rows: want = null }) {
  const m = atmosphereModel(archive, period, nowMs);
  if (!m) return <p className="empty">The repo is read at the next sync.</p>;
  const n = rowsShown('repo-collections', size, want);
  const rows = m.ranked.slice(0, n);
  if (!rows.length) return <p className="empty">No records written in this window.</p>;
  return (
    <div className="widget-stack">
      <BarList
        ariaLabel="Records by collection"
        labelWidth="1.4fr"
        rows={rows.map((c) => ({ key: c.collection, label: <code>{c.collection}</code>, value: c.count, title: c.collection }))}
      />
      <p className="widget-foot num">
        {m.ranked.length > n ? `And ${(m.ranked.length - n).toLocaleString(activeLocale())} more collections. ` : ''}
        {m.total.toLocaleString(activeLocale())} records in {periodPhrase(period)}.
      </p>
    </div>
  );
}

/**
 * What a card puts in its heading besides its title, for the few that have
 * something: `sub`, a count that heads the list under it ("9 lists, 3 of them
 * moderation lists"), or `views`, its chart's modes, which the frame draws as
 * a small Segmented at the heading's right (`label` names it) and hands back
 * to the card as `view`. Each reads the same cached model its card does.
 */
export const WIDGET_HEADS = {
  'follower-growth': ({ archive, period, nowMs }) => {
    if (!archive.followers.length) return null;
    const m = followersModel(archive, period, nowMs);
    return {
      label: 'Chart',
      views: [
        { value: 'total', label: 'Total' },
        { value: 'new', label: `New per ${unitNoun(m.unit)}` },
      ],
    };
  },
  'lists-on': ({ archive }) => {
    if (!archive.meta.lists) return null;
    const lists = listsModel(archive);
    if (!lists.length) return null;
    const mod = lists.filter((l) => l.purpose === 'moderation').length;
    return { sub: `${lists.length.toLocaleString(activeLocale())} ${lists.length === 1 ? 'list' : 'lists'}, ${mod.toLocaleString(activeLocale())} of them moderation lists` };
  },
};

export const WIDGET_COMPONENTS = {
  ...CONTENT_WIDGETS,
  ...POSTING_WIDGETS,
  'stat-followers': StatFollowers,
  'stat-new-followers': StatNewFollowers,
  'stat-unfollows': StatUnfollows,
  'stat-engagement': StatEngagement,
  'stat-per-post': StatPerPost,
  'stat-given': StatGiven,
  'stat-posts': StatPosts,
  'stat-blocks': StatBlocks,
  'follower-growth': FollowerGrowth,
  'new-followers': NewFollowers,
  'engagement-over-time': EngagementOverTime,
  'engagement-rate': EngagementRate,
  'engagement-by-type': EngagementByType,
  'engagement-given': EngagementGiven,
  'posting-cadence': PostingCadence,
  'best-time': BestTime,
  'blocks-over-time': BlocksOverTime,
  'repo-activity': RepoActivity,
  'top-posts': TopPosts,
  'top-engagers': TopEngagers,
  'you-engage-with': YouEngageWith,
  'follow-back': FollowBack,
  'newest-followers': NewestFollowers,
  unfollows: Unfollows,
  'lists-on': ListsOn,
  'repo-collections': RepoCollections,
};
