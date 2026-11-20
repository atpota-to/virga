// The Views cards: how often the account's posts were seen, from the same
// model the Views report reads (reports/models.js viewsModel). Each says why
// there's nothing to show where view counts are off, out of reach or not read
// yet, in a line, and links to the report for the whole of it.

import BarList from '../../charts/BarList.jsx';
import SeriesChart from '../../charts/SeriesChart.jsx';
import { fmtFigure, fmtPercent } from '../../charts/format.js';
import Delta from '../../components/Delta.jsx';
import { fmtInt } from '../../lib/locale.js';
import { periodBefore, periodWindowWord } from '../../lib/periods.js';
import { VIEWS_FLOOR } from '../../lib/views.js';
import { viewsModel } from '../../reports/models.js';
import PostRow, { viewsWords } from '../../reports/PostRow.jsx';
import { useChartMarks } from '../../reports/useAnnotations.js';
import { useViewsStatus } from '../../reports/useViews.js';
import { typicalText } from '../../reports/ViewsReport.jsx';
import { periodPhrase } from '../../shell/bits.jsx';
import { HEIGHT, Stat, rowsFor } from './parts.jsx';

/** A card's line for when there are no view counts to show, by viewsStatus. */
export function shortViewsNotice(status) {
  switch (status) {
    case 'off':
      return 'View counts are off on this browser.';
    case 'minor':
    case 'undeclared':
      return 'Bluesky shows view counts to people who’ve said they’re 18 or over.';
    case 'scope':
      return 'Sign in again to read view counts.';
    case 'none':
      return `No post has a count yet: Bluesky leaves out any under ${VIEWS_FLOOR}.`;
    default:
      return 'View counts are read at the next sync.';
  }
}

function StatViews({ archive, period, nowMs, def, title }) {
  const status = useViewsStatus(archive);
  const label = title || 'Views';
  if (status !== 'ready') return <Stat icon={def.icon} label={label} to={def.href} value="—" sub={shortViewsNotice(status)} />;
  const m = viewsModel(archive, period, nowMs);
  return (
    <Stat
      icon={def.icon}
      label={label}
      to={def.href}
      window={periodWindowWord(period)}
      value={fmtFigure(m.total)}
      delta={m.compare && m.compare.previous ? <Delta pct={m.compare.pct} title={`On posts from ${periodBefore(period)}: ${fmtInt(m.compare.previous)}`} /> : null}
      sub={`A typical post: ${typicalText(m.typical).toLowerCase()}`}
      spark={m.series.map((p) => p.v)}
    />
  );
}

function StatViewRate({ archive, period, nowMs, def, title }) {
  const status = useViewsStatus(archive);
  const label = title || 'Engagement per view';
  if (status !== 'ready') return <Stat icon={def.icon} label={label} to={def.href} value="—" sub={shortViewsNotice(status)} />;
  const m = viewsModel(archive, period, nowMs);
  return (
    <Stat
      icon={def.icon}
      label={label}
      to={def.href}
      window={periodWindowWord(period)}
      value={fmtPercent(m.rate)}
      sub="Per 100 views, posts and threads"
      spark={m.rateSeries.map((p) => p.v ?? 0)}
    />
  );
}

function Gate({ archive, children }) {
  const status = useViewsStatus(archive);
  if (status !== 'ready') return <p className="empty">{shortViewsNotice(status)}</p>;
  return children();
}

function ViewsByDate({ archive, period, nowMs, size }) {
  return (
    <Gate archive={archive}>
      {() => <ViewsByDateChart archive={archive} period={period} nowMs={nowMs} size={size} />}
    </Gate>
  );
}

function ViewsByDateChart({ archive, period, nowMs, size }) {
  const m = viewsModel(archive, period, nowMs);
  const marks = useChartMarks(archive, m.series, m.unit);
  return (
    <SeriesChart
      series={m.series}
      trend={m.trend}
      mode="bars"
      unit={m.unit}
      height={HEIGHT[size]}
      marks={marks}
      ariaLabel={`Views on posts made each ${m.unit}, over ${periodPhrase(period)}`}
    />
  );
}

function ViewsGained({ archive, period, nowMs, size }) {
  return (
    <Gate archive={archive}>
      {() => {
        const m = viewsModel(archive, period, nowMs);
        if (!m.gainedReady) return <p className="empty">Worked out from Virga’s readings, from the next one on.</p>;
        return (
          <SeriesChart
            series={m.gained}
            trend={m.gainedTrend}
            mode="bars"
            unit={m.unit}
            height={HEIGHT[size]}
            ariaLabel={`Views gained per ${m.unit} between Virga’s readings, over ${periodPhrase(period)}`}
          />
        );
      }}
    </Gate>
  );
}

function ViewRate({ archive, period, nowMs, size }) {
  return (
    <Gate archive={archive}>
      {() => {
        const m = viewsModel(archive, period, nowMs);
        return (
          <SeriesChart
            series={m.rateSeries}
            trend={m.rateTrend}
            mode="bars"
            unit={m.rateUnit}
            format={fmtPercent}
            height={HEIGHT[size]}
            ariaLabel={`Engagement per 100 views, by the ${m.rateUnit} each post was made, over ${periodPhrase(period)}`}
          />
        );
      }}
    </Gate>
  );
}

function ViewsFormats({ archive, period, nowMs }) {
  return (
    <Gate archive={archive}>
      {() => {
        const m = viewsModel(archive, period, nowMs);
        const shown = m.formats.filter((f) => f.posts > 0);
        if (!shown.length) return <p className="empty">No posts older than two days in this window.</p>;
        return (
          <div className="widget-stack">
            <BarList
              ariaLabel="A typical post’s views, by format"
              rows={shown.map((f) => ({
                key: f.key,
                label: f.label,
                value: f.typical || 0,
                display: typicalText(f),
                title: f.typical == null && !f.under ? `${fmtInt(f.posts)} posts: too few to say what’s typical` : `${fmtInt(f.posts)} posts; a typical one has ${typicalText(f).toLowerCase()} views`,
              }))}
            />
            <p className="widget-foot">How many views a typical post of each kind has.</p>
          </div>
        );
      }}
    </Gate>
  );
}

function MostSeen({ archive, period, nowMs, size, rows: want = null }) {
  return (
    <Gate archive={archive}>
      {() => {
        const m = viewsModel(archive, period, nowMs);
        const rows = m.top.slice(0, rowsFor(size, want));
        if (!rows.length) return <p className="empty">No post in this window has a count.</p>;
        return (
          <ol className="widget-rows">
            {rows.map((p, i) => (
              <PostRow key={p.uri} post={p} did={archive.did} rank={i + 1} breakdown={false} value={{ text: fmtInt(p.views), title: viewsWords(p.views) }} />
            ))}
          </ol>
        );
      }}
    </Gate>
  );
}

export const VIEWS_WIDGETS = {
  'stat-views': StatViews,
  'stat-view-rate': StatViewRate,
  'views-by-date': ViewsByDate,
  'views-gained': ViewsGained,
  'view-rate': ViewRate,
  'views-formats': ViewsFormats,
  'most-seen': MostSeen,
};
