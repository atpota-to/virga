// The Views report: how often the account's posts were seen, from the view
// counts Bluesky gives a post's author and nobody else (lib/views.js says what
// they are and aren't). Views by the day each post was made, views gained
// between Virga's readings, the typical post, engagement per view, by format,
// and the posts at the top of each.
//
// A count Bluesky left out (under 100, or a post from before it counted) is
// never drawn as zero: totals add up the counts there are and say how many
// posts had one, and the typical post is "under 100" when the middle post
// has none.

import { useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import BarList from '../charts/BarList.jsx';
import ChartTable from '../charts/ChartTable.jsx';
import SeriesChart from '../charts/SeriesChart.jsx';
import { fmtFigure, fmtPercent, unitNoun } from '../charts/format.js';
import Button from '../components/Button.jsx';
import Figures from '../components/Figures.jsx';
import { requestReauth } from '../accounts/accountCopy.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { VIEWS_TOKENS } from '../config.js';
import { usePreferences } from '../lib/preferences.jsx';
import { fmtInt } from '../lib/locale.js';
import { periodBefore } from '../lib/periods.js';
import { formatDateShort, relativeTime } from '../lib/time.js';
import { VIEWS_FLOOR } from '../lib/views.js';
import { Link } from '../lib/router.jsx';
import { periodPhrase } from '../shell/bits.jsx';
import ChartNotes from './ChartNotes.jsx';
import { RATE_MIN_VIEWS, viewsModel } from './models.js';
import PostRow, { viewsWords } from './PostRow.jsx';
import { Card, GroupTable, HowCounted, ModeToggle, SyncEmpty, fig, unitOptions } from './parts.jsx';
import { useChartMarks } from './useAnnotations.js';
import { useViewsStatus } from './useViews.js';

/** Whether a session's grant lacks the read that carries view counts. */
export function lacksViewsPermission(caps) {
  return VIEWS_TOKENS.some((token) => caps?.missing?.includes(token));
}

/**
 * "Under 100", or the typical post's views. Takes viewsModel's `typical`
 * (`{ value, under }`) or one of its formats (`{ typical, under }`).
 */
export function typicalText(t) {
  if (t?.under) return `Under ${VIEWS_FLOOR}`;
  const value = 'value' in (t || {}) ? t.value : t?.typical;
  return value == null ? '—' : fmtFigure(value);
}

const FORMAT_MEASURES = [
  { key: 'typical', label: 'Typical post', title: 'How many times the middle post of each format was seen' },
  { key: 'rate', label: 'Per view', title: 'Likes, reposts, replies and quotes per 100 views' },
];

/**
 * What a report, a card or a tool says instead of view counts when there are
 * none to show, by lib/views.js viewsStatus. Null for 'ready'.
 */
export function viewsNotice(status) {
  switch (status) {
    case 'off':
      return 'View counts are turned off on this browser.';
    case 'minor':
      return 'Bluesky shows view counts only to people who have told it they’re 18 or over, and has this account down as younger. Virga follows the same rule, so it doesn’t read them.';
    case 'undeclared':
      return 'Bluesky shows view counts only to people who have told it they’re 18 or over, and this account hasn’t given Bluesky a birthday. Virga follows the same rule. Once there is one in Bluesky’s settings, the next sync reads them.';
    case 'scope':
      return 'Reading view counts needs one more permission: a signed-in read of your own posts, which is the only way Bluesky gives their counts out. Sign in again to grant it.';
    case 'unread':
      return 'View counts haven’t been read yet. The next sync reads them.';
    case 'none':
      return `Bluesky hasn’t given a count for any of your posts yet. It leaves out counts under ${VIEWS_FLOOR}, and has none for posts from before it started counting.`;
    default:
      return null;
  }
}

/** The way on from a notice: turn them on, sign in again, or sync. */
function NoticeAction({ status, archive }) {
  const { setPref } = usePreferences();
  if (status === 'off') {
    return (
      <Button
        onClick={() => {
          setPref('viewCounts', 'on');
          archive.runSync('incremental');
        }}
      >
        <Eye size={15} aria-hidden="true" />
        Turn view counts on
      </Button>
    );
  }
  if (status === 'scope') {
    return <Button onClick={() => requestReauth(archive.did, { immediate: true })}>Sign in again</Button>;
  }
  if (status === 'minor') return null;
  const syncing = Boolean(archive.sync);
  return (
    <Button disabled={syncing} onClick={() => archive.runSync('incremental')}>
      <RefreshCw size={15} aria-hidden="true" />
      {syncing ? 'Syncing…' : 'Sync now'}
    </Button>
  );
}

export default function ViewsReport({ archive, period, nowMs, actions = null }) {
  const status = useViewsStatus(archive);
  const { capabilitiesFor } = useAtprotoSession();
  const lacks = lacksViewsPermission(capabilitiesFor(archive.did));
  const shown = lacks && status !== 'ready' && status !== 'off' && status !== 'minor' && status !== 'undeclared' ? 'scope' : status;
  if (!archive.posts.length) return <SyncEmpty archive={archive}>The post archive is empty. Run a sync to build it.</SyncEmpty>;
  if (shown !== 'ready') {
    return (
      <div className="empty-block">
        <p className="empty">
          {shown === 'unread' && archive.meta.views?.status === 'error'
            ? `The last read of view counts didn’t finish (${archive.meta.views.error}). The next sync tries again.`
            : viewsNotice(shown)}
        </p>
        <NoticeAction status={shown} archive={archive} />
        {shown === 'off' && (
          <p className="empty">
            Settings › <Link to="/settings/data">Data and sync</Link> has the switch.
          </p>
        )}
      </div>
    );
  }
  return <ViewsBody archive={archive} period={period} nowMs={nowMs} actions={actions} lacks={lacks} />;
}

function ViewsBody({ archive, period, nowMs, actions, lacks }) {
  const [unitPick, setUnitPick] = useState(null);
  const [rateUnitPick, setRateUnitPick] = useState(null);
  const [formatMeasure, setFormatMeasure] = useState('typical');
  const m = viewsModel(archive, period, nowMs, { unit: unitPick, rateUnit: rateUnitPick });
  const marks = useChartMarks(archive, m.series, m.unit);
  const gainedMarks = useChartMarks(archive, m.gained, m.unit);
  const rateMarks = useChartMarks(archive, m.rateSeries, m.rateUnit);
  const meta = archive.meta.views || {};
  const window = period.days ? `in ${periodPhrase(period)}` : 'since Bluesky started counting';
  const formats = m.formats.filter((f) => f.posts > 0);

  return (
    <>
      {lacks && (
        <div className="callout callout--warn" role="status">
          <span>
            These are the counts read {meta.syncedAt ? relativeTime(meta.syncedAt) : 'before'}. This sign-in can’t read them any more; sign in
            again to keep them up to date.
          </span>
          <Button size="sm" onClick={() => requestReauth(archive.did, { immediate: true })}>
            Sign in again
          </Button>
        </div>
      )}
      {!lacks && meta.status === 'error' && (
        <div className="callout callout--warn" role="status">
          <span>The last read of view counts didn’t finish ({meta.error}). These are the counts it had.</span>
        </div>
      )}
      <Figures
        label="Views in figures"
        items={[
          fig(period.days ? `Views on posts ${window}` : 'Views, all counted', m.total, {
            delta: m.compare ? m.compare.pct : undefined,
            deltaTitle: m.compare ? `On posts from ${periodBefore(period)}: ${fmtInt(m.compare.previous)}` : null,
            sub: `${fmtInt(m.withCount)} of ${fmtInt(m.countable)} posts had a count`,
          }),
          fig('Gained', m.gainedReady ? m.gainedTotal : '—', {
            sub: m.gainedReady ? `between readings, since ${formatDateShort(m.since)}` : 'from the next reading on',
          }),
          fig('A typical post', typicalText(m.typical), { sub: 'seen, over your posts and threads' }),
          fig('Engagement per view', fmtPercent(m.rate), { sub: 'likes, reposts, replies and quotes per 100 views' }),
        ]}
      />

      <Card
        title="Views by post date"
        sub={`What each ${unitNoun(m.unit)}’s posts have been seen, as of the last read`}
        tools={<ModeToggle value={m.unit} onChange={setUnitPick} options={unitOptions(m.units, 'Views')} />}
      >
        <SeriesChart series={m.series} trend={m.trend} mode="bars" unit={m.unit} height={260} marks={marks} ariaLabel={`Views on posts made each ${m.unit}, over ${periodPhrase(period)}`} />
        <ChartTable series={m.series} trend={m.trend} unit={m.unit} valueHead="Views" actions={actions} />
      </Card>

      <div className="report-split report-split--wide">
        <Card title="Views gained" sub={m.gainedReady ? 'Between Virga’s readings, spread over the time between them' : 'Worked out from Virga’s readings, from the next one on'}>
          {m.gainedReady ? (
            <>
              <SeriesChart series={m.gained} trend={m.gainedTrend} mode="bars" unit={m.unit} height={240} marks={gainedMarks} ariaLabel={`Views gained per ${m.unit}, over ${periodPhrase(period)}`} />
              <ChartTable series={m.gained} trend={m.gainedTrend} unit={m.unit} valueHead="Gained" />
            </>
          ) : (
            <p className="empty">Nothing to compare yet. The next sync reads the counts again, and the rise between the two readings is drawn here.</p>
          )}
        </Card>
        <Card
          title="Engagement per view"
          sub="Per 100 views, over your posts and threads with a count"
          tools={<ModeToggle value={m.rateUnit} onChange={setRateUnitPick} options={unitOptions(m.units, 'Per 100 views')} />}
        >
          <SeriesChart series={m.rateSeries} trend={m.rateTrend} mode="bars" unit={m.rateUnit} format={fmtPercent} height={240} marks={rateMarks} ariaLabel={`Engagement per 100 views, by the ${m.rateUnit} each post was made`} />
          <ChartTable
            series={m.rateSeries}
            secondary={m.rateSeries.map((b) => ({ t: b.t, v: b.views }))}
            trend={m.rateTrend}
            unit={m.rateUnit}
            valueHead="Per 100 views"
            secondaryHead="Views"
            format={fmtPercent}
          />
        </Card>
      </div>

      <Card
        title="By format"
        sub="What a typical post of each kind is seen, and what its views turn into"
        tools={formats.length ? <ModeToggle value={formatMeasure} onChange={setFormatMeasure} options={FORMAT_MEASURES} label="By format: measure" /> : null}
      >
        {formats.length ? (
          <>
            <BarList
              ariaLabel="Views by format"
              rows={formats.map((f) =>
                formatMeasure === 'typical'
                  ? {
                      key: f.key,
                      label: f.label,
                      value: f.typical || 0,
                      display: typicalText(f),
                      title: f.typical == null && !f.under ? `${fmtInt(f.posts)} posts: too few to say what’s typical` : `${fmtInt(f.posts)} posts; a typical one has ${typicalText(f).toLowerCase()} views`,
                    }
                  : { key: f.key, label: f.label, value: f.rate || 0, display: fmtPercent(f.rate), title: `${fmtInt(f.posts)} posts` },
              )}
            />
            <GroupTable
              rows={formats}
              columns={[
                { head: 'Format', cell: (f) => f.label },
                { head: 'Posts', num: true, cell: (f) => fmtInt(f.posts) },
                { head: 'Typical post', num: true, cell: (f) => typicalText(f) },
                { head: 'Per 100 views', num: true, cell: (f) => fmtPercent(f.rate) },
              ]}
            />
          </>
        ) : (
          <p className="empty">No posts older than two days in this window.</p>
        )}
      </Card>

      <div className="report-split">
        <Card title="Most seen" sub="Your posts with the most views" className="card--flush">
          {m.top.length ? (
            <ol className="widget-rows report-rows">
              {m.top.slice(0, 10).map((p, i) => (
                <PostRow key={p.uri} post={p} did={archive.did} rank={i + 1} breakdown={false} value={{ text: fmtInt(p.views), title: viewsWords(p.views) }} />
              ))}
            </ol>
          ) : (
            <p className="empty">No post in this window has a count.</p>
          )}
        </Card>
        <Card title="Most engaging per view" sub={`Posts and threads with ${fmtInt(RATE_MIN_VIEWS)} views or more`} className="card--flush">
          {m.engaging.length ? (
            <ol className="widget-rows report-rows">
              {m.engaging.slice(0, 10).map((p, i) => (
                <PostRow
                  key={p.uri}
                  post={p}
                  did={archive.did}
                  rank={i + 1}
                  views={p.views}
                  value={{ text: fmtPercent(p.rate), title: `${fmtPercent(p.rate)}: likes, reposts, replies and quotes per 100 views` }}
                />
              ))}
            </ol>
          ) : (
            <p className="empty">No post in this window has {fmtInt(RATE_MIN_VIEWS)} views yet.</p>
          )}
        </Card>
      </div>

      <ChartNotes did={archive.did} />
      <HowCounted>
        <p>
          Bluesky gives a post’s view count only to its author. Virga reads them signed in as you and keeps them in this browser. Bluesky
          calls the number an estimate of how often a post was seen in Bluesky’s apps, so views in other apps may not be in it.
          {meta.syncedAt ? ` They were last read ${relativeTime(meta.syncedAt)}.` : ''}
        </p>
        <p>
          Bluesky leaves out any count under {VIEWS_FLOOR}. A post without one is under {VIEWS_FLOOR} or hasn’t been read yet; it is never
          counted as no views. Totals add up the counts there are, and a typical post “under {VIEWS_FLOOR}” means the middle post had none.
        </p>
        <p>
          Bluesky has no count for posts from before it started counting, and doesn’t say when that was. Your oldest post with a count is
          from {m.epoch ? formatDateShort(m.epoch) : 'the last read'}, so this report starts there
          {m.before > 0 ? `, and leaves out the ${fmtInt(m.before)} ${m.before === 1 ? 'post' : 'posts'} in this window from before then` : ''}.
        </p>
        <p>
          Views by post date puts each post’s views on the {unitNoun(m.unit)} it was made, as of the last read, so the newest posts, still
          collecting, run low. Views gained comes from Virga’s own readings: the rise between two readings is spread evenly over the time
          between them. Posts are seen most in their first hours, so a long gap between syncs flattens it. A post made before Virga first read
          counts{m.since ? ` (${formatDateShort(m.since)})` : ''} adds only what it gained after its first reading.
        </p>
        <p>
          Posts under two days old are read at every sync, then every six hours for a week, daily for a month, weekly for six months, and
          monthly after that. A sync runs when Virga is open, so nothing is read while it’s closed.
        </p>
        <p>
          Engagement per view is likes, reposts, replies and quotes for every 100 views, over your posts and threads (not replies to other
          people) that have a count. Bluesky hasn’t said whether a view is a person or a time the post was shown, so read it as a rate rather
          than a share of people.
        </p>
      </HowCounted>
    </>
  );
}
