// The reports: one page each for followers, blocks, posts, engagement,
// people and the repo, every one answering for the period in its header.
// Each chart has a table twin; each page says how its numbers are counted,
// folded away under "How this is counted"; each can add its main chart to a
// dashboard and export what it shows.
//
// The header holds the period alone. What narrows a report (the kinds of
// engagement, a direction) is the first row of its body, as small
// segmented keys that scroll sideways when they don't fit. What can be done
// with it (Export, Post this chart, Add to dashboard) sits on the line under
// its lead chart, after Show as table, since that is what they act on; on
// a phone they fold into a ⋯ at that line's end. Add to dashboard asks which
// dashboard and how wide in a dialog.

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  AtSign,
  ChevronDown,
  ChevronUp,
  Download,
  Heart,
  ImageUp,
  LayoutDashboard,
  MessageCircle,
  Quote,
  Repeat2,
} from 'lucide-react';
import BarList from '../charts/BarList.jsx';
import ChartTable from '../charts/ChartTable.jsx';
import SeriesChart from '../charts/SeriesChart.jsx';
import { fmtFigure, fmtRate, unitNoun } from '../charts/format.js';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import Figures from '../components/Figures.jsx';
import { FollowerCountTip } from '../components/InfoTip.jsx';
import { MoreMenu } from '../components/Menu.jsx';
import Segmented, { useOverflowEdge } from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportPosts, exportRows } from '../archive/exports.js';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import { WIDGETS } from '../dashboards/catalog.js';
import { SIZES, newId } from '../dashboards/layouts.js';
import ShareDialog from '../share/ShareDialog.jsx';
import { canShare } from '../share/shareSpec.js';
import { ENGAGEMENT_KINDS, EVENT_KINDS, bucketLabel, engagementOf } from '../lib/analytics.js';
import { Link, navigate, usePath } from '../lib/router.jsx';
import { formatDateShort, relativeTime } from '../lib/time.js';
import { PersonRow, useFollow, useWantActors } from '../people/people.jsx';
import { PageHeader, PeriodPicker, periodPhrase, useIsNarrow, usePeriod, useToast } from '../shell/bits.jsx';
import { kindsLine } from '../tools/interactionModel.js';
import {
  GIVEN_NOUN,
  atmosphereModel,
  blocksModel,
  contentModel,
  contentReady,
  engagementModel,
  followerLogModel,
  followersModel,
  givenModel,
  peopleModel,
  postsModel,
  relationSets,
} from './models.js';
import ChartNotes from './ChartNotes.jsx';
import ContentReport from './ContentReport.jsx';
import PostRow, { postText } from './PostRow.jsx';
import { Card, HowCounted, ModeToggle, SyncEmpty, fig, unitOptions } from './parts.jsx';
import { REPORTS, REPORT_BY_KEY } from './registry.js';
import { useChartMarks } from './useAnnotations.js';
import './reports.css';
import { activeLocale } from '../lib/locale.js';
import { periodBefore } from '../lib/periods.js';

const KIND_ICON = { like: Heart, repost: Repeat2, reply: MessageCircle, quote: Quote, mention: AtSign };

/** Which card each report puts on a dashboard. */
const REPORT_WIDGET = {
  followers: 'follower-growth',
  blocks: 'blocks-over-time',
  posts: 'posting-cadence',
  content: 'content-formats',
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

/* ================================================================== */
/* The page and the index                                               */
/* ================================================================== */

export default function ReportPage({ reportKey }) {
  const archive = useArchive();
  const [period] = usePeriod();
  const report = REPORT_BY_KEY[reportKey];
  const [adding, setAdding] = useState(false);
  const [direction, setDirection] = useSearchParam('direction', 'received');
  const [kind, setKind] = useState('all');
  const [relation, setRelation] = useState('all');
  const [share, setShare] = useState(null);
  const phone = useIsNarrow('(max-width: 560px)');

  if (!report) {
    return (
      <>
        <PageHeader crumbs={[{ label: 'Reports', to: '/reports' }]} title={`There’s no report called “${reportKey}”`} />
        <div className="page-body">
          <div className="empty-block">
            <Button onClick={() => navigate('/reports')}>See every report</Button>
          </div>
        </div>
      </>
    );
  }

  const widget = WIDGETS[REPORT_WIDGET[reportKey]];
  const kinds = reportKey === 'people' ? EVENT_KINDS : ENGAGEMENT_KINDS;
  const showKind = reportKey === 'engagement' || reportKey === 'people';
  const nowMs = archive.nowMs;
  const canPost = widget && canShare(widget.type) && direction !== 'given';

  const filters = showKind && (
    <>
      {reportKey === 'engagement' && (
        <Segmented
          size="sm"
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'received', label: 'Received', icon: ArrowDownLeft },
            { value: 'given', label: 'Given', icon: ArrowUpRight },
          ]}
        />
      )}
      {reportKey === 'engagement' && <span className="report-filters-rule" aria-hidden="true" />}
      <Segmented
        size="sm"
        className="kind-filter"
        label="Engagement type"
        value={kind}
        onChange={setKind}
        options={kinds.map((k) => ({ value: k.key, label: k.label, icon: KIND_ICON[k.key], title: k.label }))}
      />
      {reportKey === 'people' && archive.meta.following && (
        <>
          <span className="report-filters-rule" aria-hidden="true" />
          <Segmented
            size="sm"
            label="Show people"
            value={relation}
            onChange={setRelation}
            options={[
              { value: 'all', label: 'Everyone' },
              { value: 'not', label: 'Not following' },
              { value: 'following', label: 'Following' },
            ]}
          />
        </>
      )}
    </>
  );

  // What can be done with the report's lead chart: words with a line under
  // them on the line under it, or a ⋯ at that line's end on a phone.
  const exportIt = () => exportReport(archive, reportKey, period, nowMs);
  const postIt = () => setShare({ type: widget.type, options: showKind && kind !== 'all' && kind !== 'mention' ? { kind } : {} });
  const moreActions = (
    <MoreMenu
      label={reportKey === 'people' ? 'More for this report' : 'More for this chart'}
      items={[
        { key: 'export', label: 'Export', icon: Download, onSelect: exportIt },
        canPost && { key: 'post', label: 'Post this chart as a picture', icon: ImageUp, onSelect: postIt },
        widget && { key: 'add', label: 'Add to dashboard', icon: LayoutDashboard, onSelect: () => setAdding(true) },
      ]}
    />
  );
  const wordActions = (
    <>
      <button type="button" className="link-action" onClick={exportIt}>
        <Download size={14} aria-hidden="true" />
        Export
      </button>
      {canPost && (
        <button type="button" className="link-action" title={`${widget.name}, as a picture with its description`} onClick={postIt}>
          <ImageUp size={14} aria-hidden="true" />
          Post this chart
        </button>
      )}
      {widget && (
        <button type="button" className="link-action" aria-haspopup="dialog" onClick={() => setAdding(true)}>
          <LayoutDashboard size={14} aria-hidden="true" />
          Add to dashboard
        </button>
      )}
    </>
  );
  const props = { archive, period, nowMs, actions: phone ? moreActions : wordActions };
  const people = reportKey === 'people';

  return (
    <>
      <PageHeader crumbs={[{ label: 'Reports', to: '/reports' }]} title={report.label} sub={report.desc} actions={<PeriodPicker />} />
      <div className="page-body">
        {/* People has no chart to put its actions under, so they end its
            filter row instead. */}
        {filters && (
          <ReportFilters actions={people ? wordActions : null} more={people ? moreActions : null} fold={phone}>
            {filters}
          </ReportFilters>
        )}
        {reportKey === 'followers' && <FollowersReport {...props} />}
        {reportKey === 'blocks' && <BlocksReport {...props} />}
        {reportKey === 'posts' && <PostsReport {...props} />}
        {reportKey === 'content' && <ContentReport {...props} />}
        {reportKey === 'engagement' && direction !== 'given' && <EngagementReport {...props} kind={kind === 'mention' ? 'all' : kind} />}
        {reportKey === 'engagement' && direction === 'given' && <GivenReport {...props} kind={kind === 'mention' ? 'all' : kind} />}
        {reportKey === 'people' && <PeopleReport {...props} kind={kind} relation={archive.meta.following ? relation : 'all'} />}
        {reportKey === 'atmosphere' && <AtmosphereReport {...props} />}
      </div>
      {/* Keyed by the report, so it asks afresh which dashboard on the next one. */}
      {widget && adding && <AddToDashboard key={reportKey} widget={widget} onClose={() => setAdding(false)} />}
      <ShareDialog share={share} archive={archive} period={period} nowMs={nowMs} onClose={() => setShare(null)} />
    </>
  );
}

/**
 * The first row of a report that can be narrowed: its groups of small keys,
 * a hairline between groups, in one row that scrolls sideways rather than
 * wrap. Alone on its line it runs to the screen's edges; with `actions`
 * after it (People's), it stops short of them and they keep the line's end.
 *
 * The actions are words where the filters leave room for them, and `more`,
 * a ⋯ holding the same, where they don't (and always when `fold`, on a
 * phone). Either way the line stays one line: the words never push a group
 * of filters out of sight, and never drop to a line of their own between
 * the filters and the list they narrow.
 */
function ReportFilters({ actions = null, more = null, fold = false, children }) {
  const rowRef = useRef(null);
  const barRef = useRef(null);
  const wordsRef = useRef(null);
  // The words' width, kept from when they were last shown, so the ⋯ can
  // tell when there is room to give them back.
  const wordsWidth = useRef(0);
  const [cramped, setCramped] = useState(false);
  useOverflowEdge(rowRef);
  const hasActions = Boolean(actions);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const row = rowRef.current;
    if (!hasActions || !bar || !row) return undefined;
    const check = () => {
      if (wordsRef.current) wordsWidth.current = wordsRef.current.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
      setCramped(row.scrollWidth + gap + wordsWidth.current > bar.clientWidth + 0.5);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(check);
    observer.observe(bar);
    observer.observe(row);
    return () => observer.disconnect();
  }, [hasActions]);
  const row = (
    <div ref={rowRef} className={`report-filters scroll-row${hasActions ? '' : ' scroll-row--bleed'}`}>
      {children}
    </div>
  );
  if (!hasActions) return row;
  const folded = fold || cramped;
  return (
    <div ref={barRef} className="report-filter-bar">
      {row}
      <div ref={folded ? null : wordsRef} className="report-filter-actions">
        {folded ? more : actions}
      </div>
    </div>
  );
}

/**
 * Add to dashboard: which dashboard (or a new one), how wide, and the
 * button that does it. The first dashboard that doesn't have the chart yet
 * is the one picked to start with.
 */
function AddToDashboard({ widget, onClose }) {
  const { dashboards, addDashboard, addWidget } = useDashboards();
  const toast = useToast();
  const formId = useId();
  const has = (d) => d.widgets.some((w) => w.type === widget.type);
  const [target, setTarget] = useState(() => (dashboards.find((d) => !has(d)) || dashboards[0])?.id || 'new');
  const [size, setSize] = useState(widget.defaultSize);
  const chosen = dashboards.find((d) => d.id === target) || null;
  const targetName = chosen ? chosen.name : 'a new dashboard';
  const choices = [...dashboards.map((d) => ({ id: d.id, label: d.name, desc: has(d) ? 'Already on it' : null })), { id: 'new', label: 'A new dashboard', desc: null }];
  return (
    <Dialog
      open
      onClose={onClose}
      // The footer names the dashboard, which can be too long for half a
      // phone's width.
      className="dialog--stack-actions"
      title={`Add ${widget.name} to a dashboard`}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId}>
            Add to {targetName}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen) {
            addWidget(chosen.id, widget.type, null, size);
            toast?.(`${widget.name} added to ${chosen.name}.`);
          } else {
            // The new dashboard is named for the chart it starts with.
            const id = newId('d');
            addDashboard({ name: widget.name, id });
            addWidget(id, widget.type, null, size);
            toast?.(
              <>
                {widget.name} is on a new dashboard. <Link to={`/dashboard/${id}`}>Open it</Link>
              </>,
            );
          }
          onClose();
        }}
      >
        <fieldset className="field choice-list">
          <legend className="field-label">Dashboard</legend>
          {choices.map((c) => (
            <label key={c.id} className="choice" data-on={target === c.id || undefined}>
              <input type="radio" name="add-to" checked={target === c.id} onChange={() => setTarget(c.id)} data-autofocus={target === c.id || undefined} />
              <span>
                <span className="choice-label">{c.label}</span>
                {c.desc && <span className="choice-desc">{c.desc}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        {widget.sizes.length > 1 && (
          <div className="field">
            <span className="field-label">Size</span>
            <Segmented
              size="sm"
              label="Size"
              value={size}
              onChange={setSize}
              options={widget.sizes.map((k) => ({ value: k, label: SIZES[k].label, title: SIZES[k].name, ariaLabel: SIZES[k].name }))}
            />
          </div>
        )}
      </form>
    </Dialog>
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
      followers: [fmtFigure(f.profileCount ?? f.total), `+${f.gained.toLocaleString(activeLocale())} in ${periodPhrase(period)}`],
      blocks: b ? [fmtFigure(b.total), `blocked by, +${b.received.toLocaleString(activeLocale())} in ${periodPhrase(period)}`] : ['—', 'read at the next sync'],
      posts: [fmtFigure(p.count), `posts in ${periodPhrase(period)}`],
      content: contentReady(archive) ? contentHeadline(contentModel(archive, period, nowMs)) : ['—', 'read at the next sync'],
      engagement: [fmtFigure(e.total), `received in ${periodPhrase(period)}`],
      people: [fmtFigure(pe.inbound.length), `people engaged with you in ${periodPhrase(period)}`],
      atmosphere: a ? [fmtFigure(a.allTime), `records in ${a.collections ? `${a.collections} collections` : 'your repo'}`] : ['—', 'read at the next sync'],
    };
  }, [archive, period, nowMs, built]);
  return (
    <>
      <PageHeader title="Reports" sub="Every number Virga works out, one page each." actions={<PeriodPicker />} />
      <div className="page-body">
        {/* Each report as its leading figure, under a rule: the number is the way in. */}
        <ul className="report-index">
          {REPORTS.map((r) => {
            const Icon = r.icon;
            const h = headline[r.key];
            return (
              <li key={r.key}>
                <Link to={`/reports/${r.key}`} className="report-tile" title={r.desc}>
                  <span className="report-tile-name">
                    <Icon size={14} aria-hidden="true" />
                    {r.label}
                  </span>
                  {h && (
                    <span className="report-tile-figure">
                      <span className="report-tile-value num">{h[0]}</span>
                      <span className="report-tile-note num">{h[1]}</span>
                    </span>
                  )}
                  <span className="report-tile-desc">{r.desc}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/** The Reports index's line for Content: the format that stands out, or how many are described. */
function contentHeadline(m) {
  const withTypical = m.formats.filter((f) => f.typical != null);
  if (withTypical.length > 1) {
    const best = withTypical.reduce((a, b) => (b.typical > a.typical ? b : a));
    return [fmtRate(best.typical), `a typical ${best.label.toLowerCase().replace(/ post$/, '')} post earns`];
  }
  return [m.typical == null ? '—' : fmtRate(m.typical), 'a typical post earns'];
}

function exportReport(archive, key, period, nowMs) {
  if (key === 'posts' || key === 'engagement' || key === 'content') return exportPosts(archive);
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

function FollowersReport({ archive, period, nowMs, actions }) {
  const [mode, setMode] = useState('cumulative');
  const unitPick = mode !== 'cumulative' && mode !== 'together' ? mode : null;
  const m = followersModel(archive, period, nowMs, { unit: unitPick });
  const log = followerLogModel(archive);
  const follow = useFollow(archive);
  const newest = m.newest.slice(0, 8);
  useWantActors(archive, newest.map((f) => f.did));
  const together = mode === 'together';
  const cumulative = mode === 'cumulative' || together;
  const series = cumulative ? m.cumulative : m.counts;
  const marks = useChartMarks(archive, series, m.unit, { milestones: true });

  if (!archive.followers.length) {
    return <SyncEmpty archive={archive}>Your followers haven’t been read yet. Run a sync to gather the list.</SyncEmpty>;
  }

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
          fig('Followers', m.profileCount ?? m.total, {
            sub: m.counterGap ? (
              <span className="fig-note">
                {m.total.toLocaleString(activeLocale())} can be listed
                <FollowerCountTip profileCount={m.profileCount} listed={m.total} />
              </span>
            ) : null,
          }),
          fig(period.days ? `New in ${periodPhrase(period)}` : 'Gained, all time', m.gained, {
            delta: period.days ? m.compare.pct : undefined,
            deltaTitle: period.days ? `${periodBefore(period, true)}: ${m.compare.previous.toLocaleString(activeLocale())}` : null,
            sub: period.days ? `${m.compare.previous.toLocaleString(activeLocale())} ${periodBefore(period)}` : null,
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
          marks={marks}
          ghost={!together && cumulative && m.counterGap > 0 ? { v: m.profileCount } : null}
          ariaLabel={together ? `Followers and block reach over ${periodPhrase(period)}` : cumulative ? `Followers over ${periodPhrase(period)}` : `New followers per ${m.unit} over ${periodPhrase(period)}`}
        />
        <ChartTable
          series={series}
          secondary={together ? m.blockCumulative : null}
          unit={m.unit}
          valueHead={cumulative ? 'Followers' : 'New followers'}
          secondaryHead={together ? 'Blocks' : null}
          actions={actions}
        />
      </Card>
      <div className="report-split">
        <Card title="Newest followers" sub={`Who followed you in ${periodPhrase(period)}`} className="card--flush">
          {newest.length ? (
            <ul className="widget-rows report-rows">
              {newest.map((f) => (
                <PersonRow key={f.did} archive={archive} did={f.did} meta={`followed ${relativeTime(f.atMs)}`} follow={follow} followLabel="Follow back" rel={false} />
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
                    <span className="day-row-n num">+{d.n.toLocaleString(activeLocale())}</span>
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
      <ChartNotes did={archive.did} />
      <HowCounted>
        <p>
          Virga walks your follower list and dates each follower by their follow record, so the total is the followers whose accounts
          exist right now.
        </p>
        <p>
          The diamonds on the chart mark the round numbers your count has passed, each on the day the follower who made it arrived.
          They are counted from the followers you have today, so if people have left since, you reached that number on that day or
          a little before it. Notes you add below are marked the same way.
        </p>
        {m.counterGap > 0 && (
          <p>
            Bluesky’s profile counter says {m.profileCount.toLocaleString(activeLocale())}. It keeps counting deactivated, suspended and
            deleted accounts, so the {m.counterGap.toLocaleString(activeLocale())}-account gap is followers who can’t currently be listed.
            The dashed reach on the chart marks that counter; it is not measured growth.
          </p>
        )}
        <p>
          The curve dates each follower by their follow record, so accounts that unfollowed are invisible to it. The Unfollow tracker
          finds them by comparing two syncs.
          {m.undated > 0 && ` ${m.undated.toLocaleString(activeLocale())} followers carry no readable follow date and sit outside the chart.`}
        </p>
      </HowCounted>
    </>
  );
}

/* ================================================================== */
/* Blocks                                                               */
/* ================================================================== */

function BlocksReport({ archive, period, nowMs, actions }) {
  const [mode, setMode] = useState('cumulative');
  const unitPick = !['cumulative', 'stacked', 'together'].includes(mode) ? mode : null;
  const m = blocksModel(archive, period, nowMs, { unit: unitPick });
  if (!archive.meta.blocks) {
    return <SyncEmpty archive={archive}>Blocks haven’t been read yet. Run a sync to build this timeline.</SyncEmpty>;
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
            deltaTitle: period.days ? `${periodBefore(period, true)}: ${m.compare.previous.toLocaleString(activeLocale())}` : null,
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
          actions={actions}
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
          {m.overlap > 0 && `; ${m.overlap.toLocaleString(activeLocale())} also block you directly`}. Removed blocks, memberships and
          subscriptions disappear at the next sync, so this is a picture of blocks that still exist, not a permanent history.
          {m.undated > 0 && ` ${m.undated.toLocaleString(activeLocale())} people have no readable date and sit outside the chart.`}
        </p>
      </HowCounted>
    </>
  );
}

/* ================================================================== */
/* Posts                                                                */
/* ================================================================== */

function PostsReport({ archive, period, nowMs, actions }) {
  const [unitPick, setUnitPick] = useState(null);
  const m = postsModel(archive, period, nowMs, { unit: unitPick });
  const marks = useChartMarks(archive, m.counts, m.unit);
  if (!archive.posts.length) return <SyncEmpty archive={archive}>The post archive is empty. Run a sync to build it.</SyncEmpty>;
  const pct = (n) => (m.count ? Math.round((n / m.count) * 100) : 0);
  return (
    <>
      <Figures
        label="Posts in figures"
        items={[
          fig(period.days ? `Posts in ${periodPhrase(period)}` : 'Posts, all time', m.count, {
            delta: period.days ? m.compare.pct : undefined,
            deltaTitle: period.days ? `${periodBefore(period, true)}: ${m.compare.previous.toLocaleString(activeLocale())}` : null,
            sub: period.days ? `${m.compare.previous.toLocaleString(activeLocale())} ${periodBefore(period)}` : null,
          }),
          fig('Per day', m.perDay, { decimals: true }),
          fig('Replies', pct(m.replies), { unit: '%', sub: `${m.replies.toLocaleString(activeLocale())} posts` }),
          fig('With media', pct(m.withMedia), { unit: '%', sub: `${m.withMedia.toLocaleString(activeLocale())} posts` }),
        ]}
      />
      <div className="report-split report-split--wide">
        <Card
          title={`Posts per ${unitNoun(m.unit)}`}
          sub="With the moving average"
          tools={<ModeToggle value={m.unit} onChange={setUnitPick} options={unitOptions(m.units, 'Posts')} />}
        >
          <SeriesChart series={m.counts} trend={m.trend} mode="bars" unit={m.unit} height={260} marks={marks} ariaLabel={`Posts per ${m.unit} over ${periodPhrase(period)}`} />
          <ChartTable series={m.counts} trend={m.trend} unit={m.unit} valueHead="Posts" actions={actions} />
        </Card>
        <Card title="What kind of posts" sub={`Of the ${m.count.toLocaleString(activeLocale())} in the window`}>
          <BarList
            ariaLabel="Posts by kind"
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
      <ChartNotes did={archive.did} />
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

function EngagementReport({ archive, period, nowMs, kind, actions }) {
  const [unitPick, setUnitPick] = useState(null);
  const [rateUnitPick, setRateUnitPick] = useState(null);
  const m = engagementModel(archive, period, nowMs, { kind, unit: unitPick, rateUnit: rateUnitPick });
  const marks = useChartMarks(archive, m.series, m.unit);
  const rateMarks = useChartMarks(archive, m.rate, m.rateUnit);
  if (!archive.posts.length) return <SyncEmpty archive={archive}>The post archive is empty. Run a sync to build it.</SyncEmpty>;
  const head = kind === 'all' ? 'Engagement' : ENGAGEMENT_KINDS.find((k) => k.key === kind)?.label;
  const lower = (head || '').toLowerCase();
  return (
    <>
      <Figures
        label="Engagement in figures"
        items={[
          fig(kind === 'all' ? 'Received' : `${head} received`, m.total, {
            delta: period.days ? m.compare.pct : undefined,
            deltaTitle: period.days ? `On posts from ${periodBefore(period)}: ${m.compare.previous.toLocaleString(activeLocale())}` : null,
            sub: `On ${m.posts.toLocaleString(activeLocale())} posts`,
          }),
          fig('Per post', m.ownRate == null ? '—' : fmtRate(m.ownRate), {
            delta: m.rateCompare ? m.rateCompare.pct : undefined,
            deltaTitle: m.rateCompare ? `${periodBefore(period, true)}: ${fmtRate(m.rateCompare.previous)}` : null,
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
          <SeriesChart series={m.series} trend={m.trend} mode="bars" unit={m.unit} height={260} marks={marks} ariaLabel={`${head} on posts made each ${m.unit}, over ${periodPhrase(period)}`} />
          <ChartTable series={m.series} trend={m.trend} unit={m.unit} valueHead={head} actions={actions} />
        </Card>
        {kind === 'all' && (
          <Card title="By type" sub={`Of ${m.total.toLocaleString(activeLocale())} in the window`}>
            <BarList ariaLabel="Engagement by type" rows={m.byKind.map((k) => ({ key: k.kind, label: k.label, icon: KIND_ICON[k.kind], value: k.value }))} />
          </Card>
        )}
      </div>
      <Card
        title={kind === 'all' ? 'Engagement rate' : `${head} per post`}
        sub="Per post, over your posts and threads only, so replies to other people don’t pull it down"
        tools={<ModeToggle value={m.rateUnit} onChange={setRateUnitPick} options={unitOptions(m.units, 'Per post')} />}
      >
        <SeriesChart series={m.rate} trend={m.rateTrend} mode="bars" unit={m.rateUnit} format={fmtRate} height={240} marks={rateMarks} ariaLabel={`${head} per post, by the ${m.rateUnit} each post was made`} />
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
            {m.top.slice(0, 10).map((p, i) => (
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
          {m.ownPosts > 0 && ` ${m.ownPosts.toLocaleString(activeLocale())} ${m.ownPosts === 1 ? 'post' : 'posts'} in this window.`}
        </p>
      </HowCounted>
    </>
  );
}

function GivenReport({ archive, period, nowMs, kind, actions }) {
  const [unitPick, setUnitPick] = useState(null);
  const m = givenModel(archive, period, nowMs, { kind, unit: unitPick });
  if (!archive.posts.length && !archive.outbound.length) {
    return <SyncEmpty archive={archive}>Nothing given on record yet. Run a sync to build the archive.</SyncEmpty>;
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
            deltaTitle: period.days ? `${periodBefore(period, true)}: ${m.compare.previous.toLocaleString(activeLocale())}` : null,
          }),
          fig('Per day', m.perDay, { decimals: true }),
          fig('Accounts', m.accounts, { sub: 'Engaged with' }),
        ]}
      />
      <div className="report-split report-split--wide">
        <Card title={`${head} given per ${unitNoun(m.unit)}`} sub="Counted on the day you gave it" tools={<ModeToggle value={m.unit} onChange={setUnitPick} options={unitOptions(m.units, `${head} given`)} />}>
          <SeriesChart series={m.series} trend={m.trend} mode="bars" unit={m.unit} height={260} ariaLabel={`${head} given per ${m.unit} over ${periodPhrase(period)}`} />
          <ChartTable series={m.series} trend={m.trend} unit={m.unit} valueHead={`${head} given`} actions={actions} />
        </Card>
        {kind === 'all' && (
          <Card title="By type">
            <BarList
              ariaLabel="Engagement given by type"
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

  const detail = (r) => kindsLine(r.byKind, { byCount: true });

  // Under each list the same foot, Show 12 more and then "12 of 64". What
  // is worth saying about a whole list is a caption under it, so both
  // headings are one line and their rules line up side by side.
  const list = (rows, ranked, side, empty) => (
    <>
      {rows.length ? (
        <ul className="widget-rows report-rows">
          {rows.map((r) => (
            <PersonRow key={r.did} archive={archive} did={r.did} meta={detail(r)} value={r.total.toLocaleString(activeLocale())} valueTitle={detail(r)} follow={followAndKeep} />
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
            {rows.length.toLocaleString(activeLocale())} of {ranked.length.toLocaleString(activeLocale())}
          </span>
        </div>
      )}
    </>
  );

  const inCaption = [
    archive.meta.following && relation !== 'not' && notFollowing > 0 ? `${notFollowing.toLocaleString(activeLocale())} of them you don’t follow.` : null,
    m.inOldest != null && period.days && m.inOldest > m.inT0
      ? `Notifications reach back to ${formatDateShort(m.inOldest)} so far, so earlier events in this window are outside them.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className="report-split">
        <Card title="They engage with you" className="card--flush">
          {list(
            inTop,
            inRanked,
            'in',
            relation === 'not' && m.inbound.length ? 'You already follow everyone who engaged with you in this window.' : 'Nobody has engaged with you in this window yet.',
          )}
          {inCaption && <p className="card-caption">{inCaption}</p>}
        </Card>
        <Card title="You engage with them" className="card--flush">
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

function AtmosphereReport({ archive, period, nowMs, actions }) {
  const [unitPick, setUnitPick] = useState(null);
  const [more, setMore] = useState(false);
  const m = atmosphereModel(archive, period, nowMs, { unit: unitPick });
  if (!m) {
    return (
      <SyncEmpty archive={archive}>
        A sync downloads your repo’s own archive, every record in every collection back to the very first, and charts what got written
        when.
      </SyncEmpty>
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
        <ChartTable series={m.series} trend={m.trend} unit={m.unit} valueHead="Records" actions={actions} />
      </Card>
      <Card title="By collection" sub="Which apps write to your repo, and how much">
        {shown.length ? (
          <BarList ariaLabel="Records by collection" rows={shown.map((c) => ({ key: c.collection, label: <code>{c.collection}</code>, value: c.count, title: c.collection }))} />
        ) : (
          <p className="empty">No records written in this window.</p>
        )}
        {/* A bar list's line under it, as Content's have: every bar is one
            more thing to do with the chart, not a list's "Show N more". */}
        {m.ranked.length > 16 && (
          <div className="chart-foot">
            <button type="button" className="link-action" onClick={() => setMore((v) => !v)}>
              {more ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              {more ? 'Show fewer' : `Show all ${m.ranked.length} collections`}
            </button>
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
