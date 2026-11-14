// The Content cards: what the account's posts are made of, from the same
// model the Content report reads (reports/models.js contentModel).

import BarList from '../../charts/BarList.jsx';
import { fmtRate } from '../../charts/format.js';
import { fmtInt } from '../../lib/locale.js';
import { periodWindowWord } from '../../lib/periods.js';
import { contentModel } from '../../reports/models.js';
import { standoutSentence } from '../../reports/ContentReport.jsx';
import { Stat, rowsFor } from './parts.jsx';

const NEEDS_SYNC = 'Read from your repo at the next sync.';

function typicalRow(g, label = g.label) {
  return {
    key: g.key ?? label,
    label,
    value: g.typical || 0,
    display: g.typical == null ? '—' : fmtRate(g.typical),
    title: g.typical == null ? `${fmtInt(g.posts)} posts: too few to say what’s typical` : `${fmtInt(g.posts)} posts, typically earning ${fmtRate(g.typical)}`,
  };
}

function StatTypicalPost({ archive, period, nowMs, def, title }) {
  const m = contentModel(archive, period, nowMs);
  return (
    <Stat
      icon={def.icon}
      label={title || 'A typical post earns'}
      to={def.href}
      window={periodWindowWord(period)}
      value={m.typical == null ? '—' : fmtRate(m.typical)}
      sub={`The middle of ${fmtInt(m.posts)} posts and threads`}
    />
  );
}

function StatAltText({ archive, period, nowMs, def, title }) {
  const m = contentModel(archive, period, nowMs);
  if (!m.ready) return <Stat icon={def.icon} label={title || 'Media described'} value="—" sub={NEEDS_SYNC} />;
  return (
    <Stat
      icon={def.icon}
      label={title || 'Media described'}
      to={def.href}
      window={periodWindowWord(period)}
      value={m.alt.pct == null ? '—' : `${Math.round(m.alt.pct)}%`}
      sub={m.alt.items ? `${fmtInt(m.alt.itemsDescribed)} of ${fmtInt(m.alt.items)} pictures and videos have alt text` : 'No pictures or video in this window'}
    />
  );
}

function Groups({ groups, insight, ariaLabel, labelWidth }) {
  const shown = groups.filter((g) => g.posts > 0);
  if (!shown.length) return <p className="empty">No posts in this window.</p>;
  return (
    <div className="widget-stack">
      {insight && <p className="widget-insight">{insight}</p>}
      <BarList ariaLabel={ariaLabel} labelWidth={labelWidth} rows={shown.map((g) => typicalRow(g))} />
      <p className="widget-foot">What a typical post in each group earns.</p>
    </div>
  );
}

const FORMAT_NOUN = { text: 'Text-only posts', image: 'Posts with images', video: 'Posts with video', link: 'Posts with a link card', gif: 'Posts with a GIF', quote: 'Quote posts' };

function ContentFormats({ archive, period, nowMs }) {
  const m = contentModel(archive, period, nowMs);
  if (!m.ready) return <p className="empty">{NEEDS_SYNC}</p>;
  return (
    <Groups
      groups={m.formats}
      ariaLabel="What a typical post earns, by format"
      labelWidth="96px"
      insight={standoutSentence(m.formats, m.typical, 'text', (g) => FORMAT_NOUN[g.key])}
    />
  );
}

function ContentLength({ archive, period, nowMs }) {
  const m = contentModel(archive, period, nowMs);
  if (!m.ready) return <p className="empty">{NEEDS_SYNC}</p>;
  return <Groups groups={m.lengths} ariaLabel="What a typical post earns, by length" labelWidth="96px" />;
}

/** A ranked list of tags or sites: how many posts use each, and what those typically earn. */
function Used({ rows, name, render = (v) => v, size, want, empty }) {
  const shown = rows.slice(0, rowsFor(size, want));
  if (!shown.length) return <p className="empty">{empty}</p>;
  return (
    <div className="widget-stack">
      <BarList
        ariaLabel="Posts using each"
        labelWidth="1fr"
        rows={shown.map((r) => ({
          key: r[name],
          label: render(r[name]),
          value: r.posts,

          title: r.typical == null ? `${fmtInt(r.posts)} posts` : `${fmtInt(r.posts)} posts, typically earning ${fmtRate(r.typical)}`,
        }))}
      />
      <p className="widget-foot">
        Posts using each.{rows.length > shown.length ? ` ${fmtInt(rows.length - shown.length)} more in the report, with what they earn.` : ' The report has what they earn.'}
      </p>
    </div>
  );
}

function TopTags({ archive, period, nowMs, size, rows = null }) {
  const m = contentModel(archive, period, nowMs);
  if (!m.ready) return <p className="empty">{NEEDS_SYNC}</p>;
  return <Used rows={m.tags} name="tag" render={(t) => `#${t}`} size={size} want={rows} empty="No tags on your posts in this window." />;
}

function TopLinks({ archive, period, nowMs, size, rows = null }) {
  const m = contentModel(archive, period, nowMs);
  if (!m.ready) return <p className="empty">{NEEDS_SYNC}</p>;
  return <Used rows={m.links} name="host" size={size} want={rows} empty="No links in your posts in this window." />;
}

export const CONTENT_WIDGETS = {
  'stat-typical-post': StatTypicalPost,
  'stat-alt-text': StatAltText,
  'content-formats': ContentFormats,
  'content-length': ContentLength,
  'top-tags': TopTags,
  'top-links': TopLinks,
};
