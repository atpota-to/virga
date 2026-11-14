// What each card on a dashboard draws. Every card reads the shared models
// (reports/models.js) for the dashboard's period, so ten cards on a screen
// cost one pass over each archive, and a card says the same as the report
// it links to.
//
// A card is `({ archive, period, nowMs, size })`. Figures (kind 'stat')
// return a <Stat>; the rest return their body, and the frame around them
// (DashboardPage) draws the title, the link to the full report and the
// editing controls.

import { useState } from 'react';
import { Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react';
import BarList from '../../charts/BarList.jsx';
import Heatmap from '../../charts/Heatmap.jsx';
import SeriesChart from '../../charts/SeriesChart.jsx';
import { fmtFigure, fmtRate, unitNoun } from '../../charts/format.js';
import Delta from '../../components/Delta.jsx';
import { FollowerCountTip } from '../../components/InfoTip.jsx';
import Segmented from '../../components/Segmented.jsx';
import { movingAverage } from '../../lib/analytics.js';
import { Link } from '../../lib/router.jsx';
import { relativeTime } from '../../lib/time.js';
import { PersonRow, useFollow, useWantActors } from '../../people/people.jsx';
import PostRow from '../../reports/PostRow.jsx';
import { useChartMarks } from '../../reports/useAnnotations.js';
import { CONTENT_WIDGETS } from './content.jsx';
import { HEIGHT, ROWS, Stat, rowsFor } from './parts.jsx';
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
          <span className="stat-sub-info">
            {m.total.toLocaleString(activeLocale())} can be listed
            <FollowerCountTip profileCount={m.profileCount} listed={m.total} />
          </span>
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
      delta={period.days ? <Delta pct={m.compare.pct} title={compareTitle(period, m.compare.previous)} /> : null}
      sub={period.days ? `${m.compare.previous.toLocaleString(activeLocale())} ${periodBefore(period)}` : `${fmtFigure(m.perDay, { decimals: true })} a day`}
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
      delta={period.days ? <Delta pct={m.compare.pct} title={compareTitle(period, m.compare.previous)} /> : null}
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
      delta={period.days ? <Delta pct={m.compare.pct} title={compareTitle(period, m.compare.previous)} /> : null}
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
      delta={period.days ? <Delta pct={m.compare.pct} title={compareTitle(period, m.compare.previous)} /> : null}
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

function FollowerGrowth({ archive, period, nowMs, size }) {
  const [mode, setMode] = useState('total');
  const m = followersModel(archive, period, nowMs);
  const total = mode === 'total';
  const marks = useChartMarks(archive, total ? m.cumulative : m.counts, m.unit, { milestones: true });
  if (!archive.followers.length) return <p className="empty">Your followers haven’t been read yet.</p>;
  return (
    <>
      <div className="widget-tools">
        <Segmented
          size="sm"
          label="Chart"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'total', label: 'Total' },
            { value: 'new', label: `New per ${unitNoun(m.unit)}` },
          ]}
        />
      </div>
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
    </>
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
    <div className="widget-stack">
      <div className="widget-headline">
        <span className="widget-figure num">{m.total.toLocaleString(activeLocale())}</span>
        <span className="muted">interactions{m.ownRate != null ? `, ${fmtRate(m.ownRate)} per post` : ''}</span>
      </div>
      <BarList
        ariaLabel="Engagement by type"
        labelWidth="96px"
        rows={m.byKind.map((k) => ({ key: k.kind, label: k.label, icon: KIND_ICON[k.kind], value: k.value }))}
      />
    </div>
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
        <PostRow key={p.uri} post={p} did={archive.did} kind={kind} rank={i + 1} />
      ))}
    </ol>
  );
}

function PeopleList({ archive, rows, size, want = null, empty, value = (r) => r.total.toLocaleString(activeLocale()), meta = null, followLabel }) {
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
        />
      ))}
    </ul>
  );
}

function detailOf(row) {
  return Object.entries(row.byKind || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
    .join(', ');
}

function TopEngagers({ archive, period, nowMs, size, kind = 'all', rows = null }) {
  const m = peopleModel(archive, period, nowMs, { kind });
  return <PeopleList archive={archive} rows={m.inbound} size={size} want={rows} meta={detailOf} empty="Nobody has engaged with you in this window yet." />;
}

function YouEngageWith({ archive, period, nowMs, size, kind = 'all', rows = null }) {
  const m = peopleModel(archive, period, nowMs, { kind });
  return <PeopleList archive={archive} rows={m.outbound} size={size} want={rows} meta={detailOf} empty="You haven’t engaged with anyone in this window." />;
}

function FollowBack({ archive, period, nowMs, size, def, rows: want = null }) {
  const rows = followBackModel(archive, period, nowMs);
  return (
    <>
      <PeopleList
        archive={archive}
        rows={rows}
        size={size}
        want={want}
        meta={(r) => `${r.total} interaction${r.total === 1 ? '' : 's'}`}
        value={() => null}
        followLabel="Follow back"
        empty="Everyone who follows you and engages, you already follow."
      />
      {rows.length > rowsFor(size, want) && (
        <p className="widget-foot">
          <Link to={def.href}>See all {rows.length.toLocaleString(activeLocale())}</Link>
        </p>
      )}
    </>
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
      empty="Nobody new in this window."
    />
  );
}

function Unfollows({ archive, size, def, rows: want = null }) {
  const m = followerLogModel(archive);
  if (!m.tracking) {
    return <p className="empty">Unfollows are found by comparing two syncs. Counting starts with your next one.</p>;
  }
  const rows = m.lost.slice(0, rowsFor(size, want));
  return (
    <>
      <PeopleList
        archive={archive}
        rows={rows}
        size={size}
        want={want}
        value={() => null}
        meta={(r) => `noticed ${relativeTime(r.at)}`}
        empty={`Nobody has unfollowed you since ${relativeTime(m.since)}.`}
      />
      {m.lost.length > rows.length && (
        <p className="widget-foot">
          <Link to={def.href}>See all {m.lost.length.toLocaleString(activeLocale())}</Link>
        </p>
      )}
    </>
  );
}

function ListsOn({ archive, size, def, rows: want = null }) {
  // One row fewer than a plain list of this size: the headline takes its place.
  const n = want || ROWS[size] - 1;
  if (!archive.meta.lists) return <p className="empty">Lists are read at the next sync.</p>;
  const lists = listsModel(archive);
  if (!lists.length) return <p className="empty">You aren’t on any lists.</p>;
  const mod = lists.filter((l) => l.purpose === 'moderation').length;
  return (
    <div className="widget-stack">
      <div className="widget-headline">
        <span className="widget-figure num">{lists.length.toLocaleString(activeLocale())}</span>
        <span className="muted">lists, {mod.toLocaleString(activeLocale())} of them moderation lists</span>
      </div>
      <ul className="widget-rows">
        {lists.slice(0, n).map((l) => (
          <li key={l.uri} className="list-row">
            <span className="list-row-name">{l.name || 'Untitled list'}</span>
            <span className={`badge${l.purpose === 'moderation' ? ' badge--danger' : ''}`}>{l.purpose}</span>
            <span className="list-row-subs num">{l.subscribers != null ? `${l.subscribers.toLocaleString(activeLocale())} subscribers` : ''}</span>
          </li>
        ))}
      </ul>
      {lists.length > n && (
        <p className="widget-foot">
          <Link to={def.href}>See all {lists.length.toLocaleString(activeLocale())}</Link>
        </p>
      )}
    </div>
  );
}

function RepoCollections({ archive, period, nowMs, size, rows: want = null }) {
  const m = atmosphereModel(archive, period, nowMs);
  if (!m) return <p className="empty">The repo is read at the next sync.</p>;
  const n = want || ROWS[size] + 3;
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
