// The reports: one page each for followers, blocks, posts, engagement,
// people and the repo, every one answering for the period in its header.
// Each chart has a table twin; each page says how its numbers are counted,
// folded away under "How this is counted"; each can add its main chart to a
// dashboard and export what it shows.

import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  AtSign,
  Download,
  Heart,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  Quote,
  Repeat2,
} from 'lucide-react';
import BarList from '../charts/BarList.jsx';
import ChartTable from '../charts/ChartTable.jsx';
import SeriesChart from '../charts/SeriesChart.jsx';
import { fmtFigure, fmtRate, unitLabel, unitNoun } from '../charts/format.js';
import Button from '../components/Button.jsx';
import Delta from '../components/Delta.jsx';
import Figures from '../components/Figures.jsx';
import Menu from '../components/Menu.jsx';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportPosts, exportRows } from '../archive/exports.js';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import { WIDGETS } from '../dashboards/catalog.js';
import { ENGAGEMENT_KINDS, EVENT_KINDS, bucketLabel, engagementOf } from '../lib/analytics.js';
import { Link, navigate, usePath } from '../lib/router.jsx';
import { formatDateShort, relativeTime } from '../lib/time.js';
import { PersonRow, useFollow, useWantActors } from '../people/people.jsx';
import { PageHeader, PeriodPicker, periodPhrase, usePeriod, useToast } from '../shell/bits.jsx';
import {
  GIVEN_NOUN,
  atmosphereModel,
  blocksModel,
  engagementModel,
  followerLogModel,
  followersModel,
  givenModel,
  peopleModel,
  postsModel,
  relationSets,
} from './models.js';
import PostRow, { postText } from './PostRow.jsx';
import { REPORTS, REPORT_BY_KEY } from './registry.js';
import './reports.css';

const KIND_ICON = { like: Heart, repost: Repeat2, reply: MessageCircle, quote: Quote, mention: AtSign };

/** Which card each report puts on a dashboard. */
const REPORT_WIDGET = {
  followers: 'follower-growth',
  blocks: 'blocks-over-time',
  posts: 'posting-cadence',
  engagement: 'engagement-over-time',
  people: 'top-engagers',
  atmosphere: 'repo-collections',
};

function useSearchParam(name, fallback) {
  usePath();
  const value = new URLSearchParams(window.location.search).get(name);
  const set = (next) => {
    const params = new URLSearchParams(window.location.search);
    if (next === fallback) params.delete(name);
    else params.set(name, next);
    const q = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  return [value ?? fallback, set];
}

/** One figure for the strip: the label, the number, and a note under it. */
function fig(label, value, { sub = null, delta, deltaTitle = null, decimals = false, unit = null } = {}) {
  const shown = typeof value === 'number' ? fmtFigure(value, { decimals }) : value;
  return {
    key: label,
    label,
    value: (
      <>
        {shown}
        {unit && <span className="fig-unit">{unit}</span>}
      </>
    ),
    note:
      sub || delta !== undefined ? (
        <span className="fig-note">
          {delta !== undefined && <Delta pct={delta} title={deltaTitle} />}
          {sub && <span>{sub}</span>}
        </span>
      ) : null,
  };
}

function ModeToggle({ value, onChange, options, label = 'Chart' }) {
  return <Segmented size="sm" label={label} value={value} onChange={onChange} options={options.map((o) => ({ value: o.key, label: o.label, title: o.title }))} />;
}

function unitOptions(units, noun) {
  return units.map((u) => ({ key: u, label: unitLabel(u), title: `${noun} per ${unitNoun(u)}` }));
}

function Card({ title, sub = null, tools = null, children, className = '' }) {
  return (
    <section className={`card ${className}`.trim()} aria-label={typeof title === 'string' ? title : undefined}>
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

function HowCounted({ children }) {
  return (
    <details className="card disclosure how-counted">
      <summary>How this is counted</summary>
      <div className="how-counted-body">{children}</div>
    </details>
  );
}

/* ================================================================== */
/* The page and the index                                               */
/* ================================================================== */

export default function ReportPage({ reportKey }) {
  const archive = useArchive();
  const [period] = usePeriod();
  const report = REPORT_BY_KEY[reportKey];
  const { dashboards, addWidget } = useDashboards();
  const toast = useToast();
  const [direction, setDirection] = useSearchParam('direction', 'received');
  const [kind, setKind] = useState('all');
  const [relation, setRelation] = useState('all');

  if (!report) {
    return (
      <div className="page-body">
        <div className="card empty-page">
          <h1 className="card-title">There’s no report called “{reportKey}”</h1>
          <div>
            <Button onClick={() => navigate('/reports')}>See every report</Button>
          </div>
        </div>
      </div>
    );
  }

  const widget = WIDGETS[REPORT_WIDGET[reportKey]];
  const kinds = reportKey === 'people' ? EVENT_KINDS : ENGAGEMENT_KINDS;
  const showKind = reportKey === 'engagement' || reportKey === 'people';
  const nowMs = archive.nowMs;

  const filters = (
    <>
      {reportKey === 'engagement' && (
        <Segmented
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'received', label: 'Received', icon: ArrowDownLeft },
            { value: 'given', label: 'Given', icon: ArrowUpRight },
          ]}
        />
      )}
      {showKind && (
        <Segmented
          className="kind-filter"
          label="Engagement type"
          value={kind}
          onChange={setKind}
          options={kinds.map((k) => ({ value: k.key, label: k.label, icon: KIND_ICON[k.key], title: k.label }))}
        />
      )}
      {reportKey === 'people' && archive.meta.following && (
        <Segmented
          label="Show people"
          value={relation}
          onChange={setRelation}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'not', label: 'Not following' },
            { value: 'following', label: 'Following' },
          ]}
        />
      )}
    </>
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Reports', to: '/reports' }]}
        title={report.label}
        sub={report.desc}
        actions={
          <>
            <PeriodPicker />
            <Button onClick={() => exportReport(archive, reportKey, period, nowMs)}>
              <Download size={15} aria-hidden="true" />
              Export
            </Button>
            {widget && (
              <Menu
                label="Add to dashboard"
                size="md"
                items={dashboards.map((d) => ({
                  icon: LayoutDashboard,
                  label: d.name,
                  hint: d.widgets.some((w) => w.type === widget.type) ? `${widget.name} is already on it` : `Add ${widget.name}`,
                  onSelect: () => {
                    addWidget(d.id, widget.type);
                    toast?.(`${widget.name} added to ${d.name}.`);
                  },
                }))}
              >
                <LayoutDashboard size={15} aria-hidden="true" />
                Add to dashboard
              </Menu>
            )}
          </>
        }
      >
        {(showKind || reportKey === 'engagement') && <div className="report-filters">{filters}</div>}
      </PageHeader>
      <div className="page-body">
        {reportKey === 'followers' && <FollowersReport archive={archive} period={period} nowMs={nowMs} />}
        {reportKey === 'blocks' && <BlocksReport archive={archive} period={period} nowMs={nowMs} />}
        {reportKey === 'posts' && <PostsReport archive={archive} period={period} nowMs={nowMs} />}
        {reportKey === 'engagement' && direction !== 'given' && (
          <EngagementReport archive={archive} period={period} nowMs={nowMs} kind={kind === 'mention' ? 'all' : kind} />
        )}
        {reportKey === 'engagement' && direction === 'given' && (
          <GivenReport archive={archive} period={period} nowMs={nowMs} kind={kind === 'mention' ? 'all' : kind} />
        )}
        {reportKey === 'people' && (
          <PeopleReport archive={archive} period={period} nowMs={nowMs} kind={kind} relation={archive.meta.following ? relation : 'all'} />
        )}
        {reportKey === 'atmosphere' && <AtmosphereReport archive={archive} period={period} nowMs={nowMs} />}
      </div>
    </>
  );
}

export function ReportsIndex() {
  const archive = useArchive();
  const [period] = usePeriod();
  const nowMs = archive.nowMs;
  const built = Boolean(archive.meta.posts);
  const headline = useMemo(() => {
    if (!built) return {};
    const f = followersModel(archive, period, nowMs);
    const b = archive.meta.blocks ? blocksModel(archive, period, nowMs) : null;
    const p = postsModel(archive, period, nowMs);
    const e = engagementModel(archive, period, nowMs);
    const pe = peopleModel(archive, period, nowMs);
    const a = atmosphereModel(archive, period, nowMs);
    return {
      followers: [fmtFigure(f.total), `+${f.gained.toLocaleString('en-US')} in ${periodPhrase(period)}`],
      blocks: b ? [fmtFigure(b.total), `blocked by, +${b.received.toLocaleString('en-US')} in ${periodPhrase(period)}`] : ['—', 'read at the next sync'],
      posts: [fmtFigure(p.count), `posts in ${periodPhrase(period)}`],
      engagement: [fmtFigure(e.total), `received in ${periodPhrase(period)}`],
      people: [fmtFigure(pe.inbound.length), `people engaged with you in ${periodPhrase(period)}`],
      atmosphere: a ? [fmtFigure(a.allTime), `records in ${a.collections ? `${a.collections} collections` : 'your repo'}`] : ['—', 'read at the next sync'],
    };
  }, [archive, period, nowMs, built]);
  return (
    <>
      <PageHeader title="Reports" sub="Every number Virga works out, one page each." actions={<PeriodPicker />} />
      <div className="page-body">
        <div className="report-index">
          {REPORTS.map((r) => {
            const Icon = r.icon;
            const h = headline[r.key];
            return (
              <Link key={r.key} to={`/reports/${r.key}`} className="card report-tile">
                <span className="report-tile-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="report-tile-name">{r.label}</span>
                <span className="report-tile-desc">{r.desc}</span>
                {h && (
                  <span className="report-tile-figure">
                    <span className="num">{h[0]}</span>
                    <span className="muted">{h[1]}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

function exportReport(archive, key, period, nowMs) {
  if (key === 'posts' || key === 'engagement') return exportPosts(archive);
  if (key === 'followers') {
    return exportRows(archive, 'followers', [
      ['did', 'handle', 'display_name', 'followed_at'],
      ...archive.followers.map((f) => [f.did, f.handle, f.displayName, f.followedAt || '']),
    ]);
  }
  if (key === 'blocks') {
    return exportRows(archive, 'blocks', [
      ['did', 'source', 'list', 'blocked_at'],
      ...archive.blocks.map((b) => [b.did, b.source, b.listUri || '', b.blockedAt || '']),
    ]);
  }
  if (key === 'people') {
    const m = peopleModel(archive, period, nowMs);
    const card = (did) => archive.actors.get(did) || relationSets(archive).followerCards.get(did) || {};
    return exportRows(archive, 'people', [
      ['direction', 'did', 'handle', 'total', 'likes', 'reposts', 'replies', 'quotes', 'mentions'],
      ...m.inbound.map((r) => ['received', r.did, card(r.did).handle || '', r.total, r.byKind.like || 0, r.byKind.repost || 0, r.byKind.reply || 0, r.byKind.quote || 0, r.byKind.mention || 0]),
      ...m.outbound.map((r) => ['given', r.did, card(r.did).handle || '', r.total, r.byKind.like || 0, r.byKind.repost || 0, r.byKind.reply || 0, r.byKind.quote || 0, '']),
    ]);
  }
  if (key === 'atmosphere') {
    const m = atmosphereModel(archive, period, nowMs);
    return exportRows(archive, 'collections', [['collection', 'records'], ...(m?.ranked || []).map((c) => [c.collection, c.count])]);
  }
  return null;
}

/* ================================================================== */
/* Followers                                                            */
/* ================================================================== */

function FollowersReport({ archive, period, nowMs }) {
  const [mode, setMode] = useState('cumulative');
  const unitPick = mode !== 'cumulative' && mode !== 'together' ? mode : null;
  const m = followersModel(archive, period, nowMs, { unit: unitPick });
  const log = followerLogModel(archive);
  const follow = useFollow(archive);
  const newest = m.newest.slice(0, 8);
  useWantActors(archive, newest.map((f) => f.did));

  if (!archive.followers.length) {
    return <p className="card empty">Your followers haven’t been read yet. Run a sync to gather the list.</p>;
  }

  const together = mode === 'together';
  const cumulative = mode === 'cumulative' || together;
  const series = cumulative ? m.cumulative : m.counts;
  const postsByDay = new Map();
  for (const p of archive.posts) {
    const t = Date.parse(p.at);
    if (!Number.isFinite(t) || p.replyTo) continue;
    const d = new Date(t);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const prev = postsByDay.get(day);
    if (!prev || (p.likes || 0) > (prev.likes || 0)) postsByDay.set(day, p);
  }
  const postNear = (t) => postsByDay.get(t) || postsByDay.get(t - 86_400_000) || null;

  return (
    <>
      <Figures
        label="Followers in figures"
        items={[
          fig('Followers', m.total, { sub: m.counterGap ? `${m.profileCount.toLocaleString('en-US')} on your profile` : null }),
          fig(period.days ? `New in ${periodPhrase(period)}` : 'Gained, all time', m.gained, {
            delta: period.days ? m.compare.pct : undefined,
            deltaTitle: period.days ? `The ${period.label.toLowerCase()} before: ${m.compare.previous.toLocaleString('en-US')}` : null,
            sub: period.days ? `${m.compare.previous.toLocaleString('en-US')} the ${period.label.toLowerCase()} before` : null,
          }),
          fig('Per day', m.perDay, { decimals: true, sub: 'Averaged over the window' }),
          fig('Unfollows at the last sync', log.tracking ? log.latestLost.length : '—', {
            sub: log.tracking ? <Link to="/tools/unfollow-tracker">Open the Unfollow tracker</Link> : 'Counted from your next sync',
          }),
        ]}
      />
      <Card
        title="Growth"
        sub={cumulative ? 'Followers over the window. The dashed reach is Bluesky’s profile counter.' : `New followers per ${unitNoun(m.unit)}, dated by each follow record`}
        tools={
          <ModeToggle
            value={mode}
            onChange={setMode}
            options={[
              { key: 'cumulative', label: 'Total', title: 'Running total over the window' },
              { key: 'together', label: 'With blocks', title: 'Followers and block reach on one chart' },
              ...unitOptions(m.units, 'New followers'),
            ]}
          />
        }
      >
        <SeriesChart
          series={series}
          seriesLabel={together ? 'Followers' : null}
          secondary={together ? { series: m.blockCumulative, label: 'Blocks' } : null}
          mode={cumulative ? 'line' : 'bars'}
          unit={m.unit}
          zeroBase={!cumulative}
          height={280}
          ghost={!together && cumulative && m.counterGap > 0 ? { v: m.profileCount } : null}
          ariaLabel={together ? `Followers and block reach over ${periodPhrase(period)}` : cumulative ? `Followers over ${periodPhrase(period)}` : `New followers per ${m.unit} over ${periodPhrase(period)}`}
        />
        <ChartTable
          series={series}
          secondary={together ? m.blockCumulative : null}
          unit={m.unit}
          valueHead={cumulative ? 'Followers' : 'New followers'}
          secondaryHead={together ? 'Blocks' : null}
        />
      </Card>
      <div className="report-split">
        <Card title="Newest followers" sub={`Who followed you in ${periodPhrase(period)}`} className="card--flush">
          {newest.length ? (
            <ul className="widget-rows report-rows">
              {newest.map((f) => (
                <PersonRow key={f.did} archive={archive} did={f.did} meta={`followed ${relativeTime(f.atMs)}`} follow={follow} followLabel="Follow back" />
              ))}
            </ul>
          ) : (
            <p className="empty">Nobody new in this window.</p>
          )}
        </Card>
        <Card title="Biggest days" sub="And your best-liked post that day or the day before" className="card--flush">
          {m.biggestDays.length ? (
            <ol className="widget-rows report-rows">
              {m.biggestDays.map((d) => {
                const post = postNear(d.t);
                return (
                  <li key={d.t} className="day-row">
                    <span className="day-row-date num">{bucketLabel(d.t, 'day')}</span>
                    <span className="day-row-n num">+{d.n.toLocaleString('en-US')}</span>
                    <span className="day-row-post">{post ? postText(post) : <span className="muted">No post that day</span>}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="empty">Nobody new in this window.</p>
          )}
        </Card>
      </div>
      <HowCounted>
        <p>
          Virga walks your follower list and dates each follower by their follow record, so the total is the followers whose accounts
          exist right now.
        </p>
        {m.counterGap > 0 && (
          <p>
            Bluesky’s profile counter says {m.profileCount.toLocaleString('en-US')}. It keeps counting deactivated, suspended and
            deleted accounts, so the {m.counterGap.toLocaleString('en-US')}-account gap is followers who can’t currently be listed.
            The dashed reach on the chart marks that counter; it is not measured growth.
          </p>
        )}
        <p>
          The curve dates each follower by their follow record, so accounts that unfollowed are invisible to it. The Unfollow tracker
          finds them by comparing two syncs.
          {m.undated > 0 && ` ${m.undated.toLocaleString('en-US')} followers carry no readable follow date and sit outside the chart.`}
        </p>
      </HowCounted>
    </>
  );
}

/* ================================================================== */
/* Blocks                                                               */
/* ================================================================== */

function BlocksReport({ archive, period, nowMs }) {
  const [mode, setMode] = useState('cumulative');
  const unitPick = !['cumulative', 'stacked', 'together'].includes(mode) ? mode : null;
  const m = blocksModel(archive, period, nowMs, { unit: unitPick });
  if (!archive.meta.blocks) {
    return <p className="card empty">Blocks haven’t been read yet. Run a sync to build this timeline.</p>;
  }
  const together = mode === 'together';
  const stacked = mode === 'stacked';
  const cumulative = mode === 'cumulative' || together || stacked;
  const series = together ? m.followerCumulative : stacked ? m.directCumulative : cumulative ? m.cumulative : m.counts;
  const secondary = together ? { series: m.cumulative, label: 'Block reach' } : stacked ? { series: m.listCumulative, label: 'Via lists' } : null;
  return (
    <>
      <Figures
        label="Blocks in figures"
        items={[
          fig('Blocked by', m.total, { sub: 'People, counted once' }),
          fig('Directly', m.directTotal),
          fig('Through lists', m.listTotal, { sub: <Link to="/tools/lists">See the lists</Link> }),
          fig(period.days ? `New in ${periodPhrase(period)}` : 'All time', m.received, {
            delta: period.days ? m.compare.pct : undefined,
            deltaTitle: period.days ? `The ${period.label.toLowerCase()} before: ${m.compare.previous.toLocaleString('en-US')}` : null,
          }),
        ]}
      />
      <Card
        title={together ? 'Followers and block reach' : stacked ? 'Block reach by path' : cumulative ? 'Block reach' : `New blocks per ${unitNoun(m.unit)}`}
        tools={
          <ModeToggle
            value={mode}
            onChange={setMode}
            options={[
              { key: 'cumulative', label: 'Total', title: 'Running total over the window' },
              { key: 'stacked', label: 'By path', title: 'Direct blocks and moderation lists, stacked' },
              { key: 'together', label: 'With followers', title: 'Block reach and followers on one chart' },
              ...unitOptions(m.units, 'New blocks'),
            ]}
          />
        }
      >
        <SeriesChart
          series={series}
          seriesLabel={together ? 'Followers' : stacked ? 'Direct' : null}
          secondary={secondary}
          stacked={stacked}
          trend={!cumulative ? m.trend : null}
          mode={cumulative ? 'line' : 'bars'}
          unit={m.unit}
          zeroBase={!cumulative}
          height={280}
          ariaLabel={`Blocks over ${periodPhrase(period)}`}
        />
        <ChartTable
          series={series}
          secondary={secondary?.series || null}
          trend={!cumulative ? m.trend : null}
          unit={m.unit}
          valueHead={together ? 'Followers' : stacked ? 'Direct' : cumulative ? 'Block reach' : 'New blocks'}
          secondaryHead={secondary?.label || null}
        />
      </Card>
      <HowCounted>
        <p>
          Reconstructed from current <code>app.bsky.graph.block</code> records and the moderation lists that currently contain you.
          List reach follows each list’s current <code>app.bsky.graph.listblock</code> subscribers, and a list block begins at the
          later of the membership and the subscription.
        </p>
        <p>
          People reached through several lists, or through both a list and a direct block, count once in the total
          {m.overlap > 0 && `; ${m.overlap.toLocaleString('en-US')} also block you directly`}. Removed blocks, memberships and
          subscriptions disappear at the next sync, so this is a picture of blocks that still exist, not a permanent history.
          {m.undated > 0 && ` ${m.undated.toLocaleString('en-US')} people have no readable date and sit outside the chart.`}
        </p>
      </HowCounted>
    </>
  );
}

/* ================================================================== */
/* Posts                                                                */
/* ================================================================== */

function PostsReport({ archive, period, nowMs }) {
  const [unitPick, setUnitPick] = useState(null);
  const m = postsModel(archive, period, nowMs, { unit: unitPick });
  if (!archive.posts.length) return <p className="card empty">The post archive is empty. Run a sync to build it.</p>;
  const pct = (n) => (m.count ? Math.round((n / m.count) * 100) : 0);
  return (
    <>
      <Figures
        label="Posts in figures"
        items={[
          fig(period.days ? `Posts in ${periodPhrase(period)}` : 'Posts, all time', m.count, {
            delta: period.days ? m.compare.pct : undefined,
            deltaTitle: period.days ? `The ${period.label.toLowerCase()} before: ${m.compare.previous.toLocaleString('en-US')}` : null,
            sub: period.days ? `${m.compare.previous.toLocaleString('en-US')} the ${period.label.toLowerCase()} before` : null,
          }),
          fig('Per day', m.perDay, { decimals: true }),
          fig('Replies', pct(m.replies), { unit: '%', sub: `${m.replies.toLocaleString('en-US')} posts` }),
          fig('With media', pct(m.withMedia), { unit: '%', sub: `${m.withMedia.toLocaleString('en-US')} posts` }),
        ]}
      />
      <div className="report-split report-split--wide">
        <Card
          title={`Posts per ${unitNoun(m.unit)}`}
          sub="With the moving average"
          tools={<ModeToggle value={m.unit} onChange={setUnitPick} options={unitOptions(m.units, 'Posts')} />}
        >
          <SeriesChart series={m.counts} trend={m.trend} mode="bars" unit={m.unit} height={260} ariaLabel={`Posts per ${m.unit} over ${periodPhrase(period)}`} />
          <ChartTable series={m.counts} trend={m.trend} unit={m.unit} valueHead="Posts" />
        </Card>
        <Card title="What kind of posts" sub={`Of the ${m.count.toLocaleString('en-US')} in the window`}>
          <BarList
            ariaLabel="Posts by kind"
            labelWidth="110px"
            max={m.count || 1}
            rows={[
              { key: 'standalone', label: 'Standalone', value: m.originals - m.quotes },
              { key: 'replies', label: 'Replies', value: m.replies },
              { key: 'quotes', label: 'Quote posts', value: m.quotes },
              { key: 'media', label: 'With media', value: m.withMedia },
            ]}
          />
        </Card>
      </div>
      <HowCounted>
        <p>
          Every post in your archive, dated by when it was written, in your time zone. Replies to other people and to yourself both
          count as posts here; the engagement rate leaves replies to other people out.
        </p>
      </HowCounted>
    </>
  );
}

/* ================================================================== */
/* Engagement                                                           */
/* ================================================================== */

function EngagementReport({ archive, period, nowMs, kind }) {
  const [unitPick, setUnitPick] = useState(null);
  const [rateUnitPick, setRateUnitPick] = useState(null);
  const m = engagementModel(archive, period, nowMs, { kind, unit: unitPick, rateUnit: rateUnitPick });
  if (!archive.posts.length) return <p className="card empty">The post archive is empty. Run a sync to build it.</p>;
  const head = kind === 'all' ? 'Engagement' : ENGAGEMENT_KINDS.find((k) => k.key === kind)?.label;
  const lower = (head || '').toLowerCase();
  return (
    <>
      <Figures
        label="Engagement in figures"
        items={[
          fig(kind === 'all' ? 'Received' : `${head} received`, m.total, {
            delta: period.days ? m.compare.pct : undefined,
            deltaTitle: period.days ? `On posts from the ${period.label.toLowerCase()} before: ${m.compare.previous.toLocaleString('en-US')}` : null,
            sub: `On ${m.posts.toLocaleString('en-US')} posts`,
          }),
          fig('Per post', m.ownRate == null ? '—' : fmtRate(m.ownRate), {
            delta: m.rateCompare ? m.rateCompare.pct : undefined,
            deltaTitle: m.rateCompare ? `The ${period.label.toLowerCase()} before: ${fmtRate(m.rateCompare.previous)}` : null,
            sub: 'Posts and threads',
          }),
          fig('Best post', m.top.length ? engagementOf(m.top[0], kind) : 0, {
            sub: m.top.length ? `${formatDateShort(m.top[0].at)}` : null,
          }),
        ]}
      />
      <div className="report-split report-split--wide">
        <Card
          title={`${head} by post date`}
          sub={`What each ${unitNoun(m.unit)}’s posts have earned, as of the last sync`}
          tools={<ModeToggle value={m.unit} onChange={setUnitPick} options={unitOptions(m.units, head)} />}
        >
          <SeriesChart series={m.series} trend={m.trend} mode="bars" unit={m.unit} height={260} ariaLabel={`${head} on posts made each ${m.unit}, over ${periodPhrase(period)}`} />
          <ChartTable series={m.series} trend={m.trend} unit={m.unit} valueHead={head} />
        </Card>
        {kind === 'all' && (
          <Card title="By type" sub={`Of ${m.total.toLocaleString('en-US')} in the window`}>
            <BarList ariaLabel="Engagement by type" labelWidth="96px" rows={m.byKind.map((k) => ({ key: k.kind, label: k.label, icon: KIND_ICON[k.kind], value: k.value }))} />
          </Card>
        )}
      </div>
      <Card
        title={kind === 'all' ? 'Engagement rate' : `${head} per post`}
        sub="Per post, over your posts and threads only, so replies to other people don’t pull it down"
        tools={<ModeToggle value={m.rateUnit} onChange={setRateUnitPick} options={unitOptions(m.units, 'Per post')} />}
      >
        <SeriesChart series={m.rate} trend={m.rateTrend} mode="bars" unit={m.rateUnit} format={fmtRate} height={240} ariaLabel={`${head} per post, by the ${m.rateUnit} each post was made`} />
        <ChartTable
          series={m.rate}
          secondary={m.rate.map((b) => ({ t: b.t, v: b.posts }))}
          trend={m.rateTrend}
          unit={m.rateUnit}
          valueHead="Per post"
          secondaryHead="Posts"
          format={fmtRate}
        />
      </Card>
      <Card title="Top posts" sub={`Ranked by ${kind === 'all' ? 'all engagement' : lower}`} className="card--flush">
        {m.top.length ? (
          <ol className="widget-rows report-rows">
            {m.top.map((p, i) => (
              <PostRow key={p.uri} post={p} did={archive.did} kind={kind} rank={i + 1} />
            ))}
          </ol>
        ) : (
          <p className="empty">No posts in this window.</p>
        )}
      </Card>
      <HowCounted>
        <p>
          Counted against the day each post was made, with counts as of the last sync. A bar is how much that {unitNoun(m.unit)}’s
          posts have earned, not when it arrived. The newest posts are still collecting engagement, so the last bars run low.
        </p>
        <p>
          The rate averages over the posts made each {unitNoun(m.rateUnit)}: your top-level posts and the replies in your own threads.
          A gap is a {unitNoun(m.rateUnit)} with nothing posted.
          {m.ownPosts > 0 && ` ${m.ownPosts.toLocaleString('en-US')} ${m.ownPosts === 1 ? 'post' : 'posts'} in this window.`}
        </p>
      </HowCounted>
    </>
  );
}

function GivenReport({ archive, period, nowMs, kind }) {
  const [unitPick, setUnitPick] = useState(null);
  const m = givenModel(archive, period, nowMs, { kind, unit: unitPick });
  if (!archive.posts.length && !archive.outbound.length) {
    return <p className="card empty">Nothing given on record yet. Run a sync to build the archive.</p>;
  }
  const head = kind === 'all' ? 'Engagement' : ENGAGEMENT_KINDS.find((k) => k.key === kind)?.label || 'Engagement';
  const coverageMs = archive.meta.outbound?.coverageMs || 0;
  return (
    <>
      <Figures
        label="Engagement given in figures"
        items={[
          fig(kind === 'all' ? 'Given' : `${head} given`, m.total, {
            delta: period.days ? m.compare.pct : undefined,
            deltaTitle: period.days ? `The ${period.label.toLowerCase()} before: ${m.compare.previous.toLocaleString('en-US')}` : null,
          }),
          fig('Per day', m.perDay, { decimals: true }),
          fig('Accounts', m.accounts, { sub: 'Engaged with' }),
        ]}
      />
      <div className="report-split report-split--wide">
        <Card title={`${head} given per ${unitNoun(m.unit)}`} sub="Counted on the day you gave it" tools={<ModeToggle value={m.unit} onChange={setUnitPick} options={unitOptions(m.units, `${head} given`)} />}>
          <SeriesChart series={m.series} trend={m.trend} mode="bars" unit={m.unit} height={260} ariaLabel={`${head} given per ${m.unit} over ${periodPhrase(period)}`} />
          <ChartTable series={m.series} trend={m.trend} unit={m.unit} valueHead={`${head} given`} />
        </Card>
        {kind === 'all' && (
          <Card title="By type">
            <BarList
              ariaLabel="Engagement given by type"
              labelWidth="96px"
              rows={m.byKind.map((k) => ({ key: k.kind, label: GIVEN_NOUN[k.kind].charAt(0).toUpperCase() + GIVEN_NOUN[k.kind].slice(1), icon: KIND_ICON[k.kind], value: k.count }))}
            />
          </Card>
        )}
      </div>
      <HowCounted>
        <p>
          Likes and reposts come from your repo
          {coverageMs > 0 ? `, which reaches back to ${formatDateShort(coverageMs)} so far` : ', every one you have ever made'}; replies
          and quotes from the post archive. Replies and quotes aimed at your own posts are threading, not engagement, and are left
          out. Who you engage with most is in the People report.
        </p>
      </HowCounted>
    </>
  );
}

/* ================================================================== */
/* People                                                               */
/* ================================================================== */

const PEOPLE_PAGE = 12;

function PeopleReport({ archive, period, nowMs, kind, relation }) {
  const m = peopleModel(archive, period, nowMs, { kind });
  const sets = relationSets(archive);
  const follow = useFollow(archive);
  const [limits, setLimits] = useState({ in: PEOPLE_PAGE, out: PEOPLE_PAGE });
  // Someone followed from "Not following" keeps their row until the filter
  // changes, now reading Following, rather than vanishing with the undo.
  const [kept, setKept] = useState(() => ({ relation, dids: new Set() }));
  const keptDids = kept.relation === relation ? kept.dids : null;
  const keep = (r) => keptDids?.has(r.did) || (relation === 'not' ? !sets.following.has(r.did) : relation === 'following' ? sets.following.has(r.did) : true);
  const inRanked = m.inbound.filter(keep);
  const outRanked = m.outbound.filter(keep);
  const inTop = inRanked.slice(0, limits.in);
  const outTop = outRanked.slice(0, limits.out);
  useWantActors(archive, [...inTop, ...outTop].map((r) => r.did));
  const notFollowing = m.inbound.filter((r) => !sets.following.has(r.did)).length;

  const followAndKeep = {
    ...follow,
    toggle: async (did) => {
      const ok = await follow.toggle(did);
      if (ok) setKept((k) => ({ relation, dids: new Set(k.relation === relation ? k.dids : []).add(did) }));
      return ok;
    },
  };

  const detail = (r) =>
    Object.entries(r.byKind)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
      .join(', ');

  const list = (rows, ranked, side, empty) => (
    <>
      {rows.length ? (
        <ul className="widget-rows report-rows">
          {rows.map((r) => (
            <PersonRow key={r.did} archive={archive} did={r.did} meta={detail(r)} value={r.total.toLocaleString('en-US')} valueTitle={detail(r)} follow={followAndKeep} />
          ))}
        </ul>
      ) : (
        <p className="empty">{empty}</p>
      )}
      {ranked.length > rows.length && (
        <div className="card-foot">
          <Button size="sm" variant="ghost" onClick={() => setLimits((l) => ({ ...l, [side]: l[side] + PEOPLE_PAGE }))}>
            Show {Math.min(PEOPLE_PAGE, ranked.length - rows.length)} more
          </Button>
          <span className="num">
            {rows.length.toLocaleString('en-US')} of {ranked.length.toLocaleString('en-US')}
          </span>
        </div>
      )}
    </>
  );

  const inCoverage =
    m.inOldest != null && period.days && m.inOldest > m.inT0
      ? `Notifications reach back to ${formatDateShort(m.inOldest)} so far, so earlier events in this window are outside them.`
      : null;

  return (
    <>
      <div className="report-split">
        <Card
          title={
            <>
              <MessagesSquare size={16} aria-hidden="true" /> They engage with you
            </>
          }
          sub={archive.meta.following && relation !== 'not' && notFollowing > 0 ? `${notFollowing.toLocaleString('en-US')} of them you don’t follow` : null}
          className="card--flush"
        >
          {list(inTop, inRanked, 'in', relation === 'not' && m.inbound.length ? 'You already follow everyone who engaged with you in this window.' : 'Nobody has engaged with you in this window yet.')}
          {inCoverage && <p className="card-caption">{inCoverage}</p>}
        </Card>
        <Card
          title={
            <>
              <Heart size={16} aria-hidden="true" /> You engage with them
            </>
          }
          className="card--flush"
        >
          {kind === 'mention'
            ? <p className="empty">Mentions are counted inbound only.</p>
            : list(outTop, outRanked, 'out', relation === 'not' && m.outbound.length ? 'You already follow everyone you engaged with in this window.' : 'You haven’t engaged with anyone in this window.')}
        </Card>
      </div>
      <HowCounted>
        <p>
          Inbound counts come from your notifications: likes, reposts, replies, quotes and mentions aimed at you. Outbound counts come
          from your repo’s like and repost history, plus the replies and quotes in your post archive.
        </p>
        <p>
          {archive.meta.following
            ? 'Following is read from the follow records in your own repo at each sync. Follow writes one there, and pressing Following deletes it.'
            : 'Who you follow arrives with the next sync; until then there are no Follow buttons, so nobody can be followed twice.'}
        </p>
      </HowCounted>
    </>
  );
}

/* ================================================================== */
/* Atmosphere                                                           */
/* ================================================================== */

function AtmosphereReport({ archive, period, nowMs }) {
  const [unitPick, setUnitPick] = useState(null);
  const [more, setMore] = useState(false);
  const m = atmosphereModel(archive, period, nowMs, { unit: unitPick });
  if (!m) {
    return (
      <div className="card empty-page">
        <h2 className="card-title">The whole repo, not just Bluesky</h2>
        <p className="card-sub">
          A sync downloads your repo’s own archive, every record in every collection back to the very first, and charts what got
          written when. {archive.sync ? 'Syncing now…' : ''}
        </p>
        {!archive.sync && (
          <div>
            <Button variant="primary" onClick={() => archive.runSync('incremental')}>
              Sync now
            </Button>
          </div>
        )}
      </div>
    );
  }
  const shown = more ? m.ranked : m.ranked.slice(0, 16);
  return (
    <>
      <Figures
        label="The repo in figures"
        items={[
          fig(period.days ? `Records in ${periodPhrase(period)}` : 'Records, all time', m.total),
          fig('Collections', m.collections, { sub: 'Written to in the window' }),
          fig('Per day', m.total / m.spanDays, { decimals: true }),
          fig('In the repo', m.allTime, { sub: 'Every record, all time' }),
        ]}
      />
      <Card title={`Records written per ${unitNoun(m.unit)}`} sub="Every app, every collection" tools={<ModeToggle value={m.unit} onChange={setUnitPick} options={unitOptions(m.units, 'Records')} />}>
        <SeriesChart series={m.series} trend={m.trend} mode="bars" unit={m.unit} height={260} ariaLabel={`Records written to the repo per ${m.unit} over ${periodPhrase(period)}`} />
        <ChartTable series={m.series} trend={m.trend} unit={m.unit} valueHead="Records" />
      </Card>
      <Card title="By collection" sub="Which apps write to your repo, and how much">
        {shown.length ? (
          <BarList ariaLabel="Records by collection" labelWidth="1.6fr" rows={shown.map((c) => ({ key: c.collection, label: <code>{c.collection}</code>, value: c.count, title: c.collection }))} />
        ) : (
          <p className="empty">No records written in this window.</p>
        )}
        {m.ranked.length > 16 && (
          <div className="card-foot">
            <Button size="sm" variant="ghost" onClick={() => setMore((v) => !v)}>
              {more ? 'Show fewer' : `Show all ${m.ranked.length} collections`}
            </Button>
          </div>
        )}
      </Card>
      <HowCounted>
        <p>
          From the repo archive: every record in every collection, dated by its record key (falling back to its own createdAt; the
          rare record with neither is left out). Pulled from your PDS {relativeTime(archive.meta.repo?.syncedAt)}; syncs top it up from
          the repo’s revision log.
        </p>
      </HowCounted>
    </>
  );
}
