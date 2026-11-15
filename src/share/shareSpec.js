// What a card looks like as a picture to post, and the words that describe
// it. Pure: each shareable card type has a builder that reads the same
// model its card draws from and returns a spec the canvas (chartImage.js)
// draws and `shareAltText` puts into words.
//
//   series  { kind: 'series', title, subtitle, figure, series, mode, unit,
//             trend, zeroBase, format, marks, noun, ghost }
//   bars    { kind: 'bars', title, subtitle, figure, rows: [{ label, value,
//             display }], measure }
//
// `figure` is the headline over the chart: `{ value, label }`, both already
// written out. `noun` names what a series counts ("followers"), for the
// description.

import { bucketLabel } from '../lib/analytics.js';
import { fmtCount, fmtRate, unitNoun } from '../charts/format.js';
import { fmtInt } from '../lib/locale.js';
import { periodPhrase } from '../lib/periods.js';
import { followerMilestones, marksOnSeries, noteMark } from '../reports/annotations.js';
import { atmosphereModel, contentModel, engagementModel, followersModel, givenModel, postsModel } from '../reports/models.js';

/** Alt text on Bluesky holds 2,000 characters; this leaves room to add to it. */
export const ALT_TEXT_MAX = 1800;
/** A chart with more buckets than this is described, not listed value by value. */
const LIST_UP_TO = 40;

const KIND_WORDS = { like: 'likes', repost: 'reposts', reply: 'replies', quote: 'quotes' };
const kindWords = (kind) => KIND_WORDS[kind] || 'likes, reposts, replies and quotes';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "@mira.example.com, the last 30 days": whose numbers and over what. */
function subtitleOf(archive, period) {
  const who = archive.handle ? `@${archive.handle}` : null;
  return [who, periodPhrase(period)].filter(Boolean).join(', ');
}

function marksFor(archive, series, unit, notes, milestones) {
  const marks = (notes || []).map(noteMark);
  if (milestones) marks.push(...followerMilestones(archive.followers));
  return marksOnSeries(series, unit, marks);
}

function seriesSpec(base, { series, unit, mode = 'bars', trend = null, zeroBase = true, format = fmtCount, marks = [], noun, ghost = null }) {
  return { kind: 'series', ...base, series, unit, mode, trend, zeroBase, format, marks, noun, ghost };
}

const BUILDERS = {
  'follower-growth': (archive, period, nowMs, { notes }) => {
    const m = followersModel(archive, period, nowMs);
    if (!archive.followers.length) return null;
    return seriesSpec(
      { title: 'Follower growth', figure: { value: fmtInt(m.profileCount ?? m.total), label: `followers, +${fmtInt(m.gained)} in ${periodPhrase(period)}` } },
      {
        series: m.cumulative,
        unit: m.unit,
        mode: 'line',
        zeroBase: false,
        marks: marksFor(archive, m.cumulative, m.unit, notes, true),
        noun: 'followers',
        // As on the card: the dashed reach from the curve's end up to the
        // profile's own counter, which still counts accounts that can't be listed.
        ghost: m.counterGap > 0 ? { v: m.profileCount } : null,
      },
    );
  },
  'new-followers': (archive, period, nowMs, { notes }) => {
    const m = followersModel(archive, period, nowMs);
    if (!archive.followers.length) return null;
    return seriesSpec(
      { title: 'New followers', figure: { value: `+${fmtInt(m.gained)}`, label: `new followers in ${periodPhrase(period)}` } },
      { series: m.counts, unit: m.unit, marks: marksFor(archive, m.counts, m.unit, notes, true), noun: 'new followers' },
    );
  },
  'engagement-over-time': (archive, period, nowMs, { kind = 'all', notes }) => {
    const m = engagementModel(archive, period, nowMs, { kind });
    return seriesSpec(
      { title: kind === 'all' ? 'Engagement' : cap(kindWords(kind)), figure: { value: fmtInt(m.total), label: `${kindWords(kind)} on ${fmtInt(m.posts)} posts` } },
      { series: m.series, unit: m.unit, trend: m.trend, marks: marksFor(archive, m.series, m.unit, notes, false), noun: kind === 'all' ? 'interactions' : kindWords(kind) },
    );
  },
  'engagement-rate': (archive, period, nowMs, { kind = 'all', notes }) => {
    const m = engagementModel(archive, period, nowMs, { kind });
    return seriesSpec(
      { title: kind === 'all' ? 'Engagement per post' : `${cap(kindWords(kind))} per post`, figure: { value: m.ownRate == null ? '—' : fmtRate(m.ownRate), label: `per post, over ${fmtInt(m.ownPosts)} posts and threads` } },
      { series: m.rate, unit: m.rateUnit, trend: m.rateTrend, format: fmtRate, marks: marksFor(archive, m.rate, m.rateUnit, notes, false), noun: `${kind === 'all' ? 'interactions' : kindWords(kind)} per post` },
    );
  },
  'engagement-given': (archive, period, nowMs, { kind = 'all' }) => {
    const m = givenModel(archive, period, nowMs, { kind });
    return seriesSpec(
      { title: kind === 'all' ? 'Engagement given' : `${cap(kindWords(kind))} given`, figure: { value: fmtInt(m.total), label: `${kindWords(kind)} given to ${fmtInt(m.accounts)} accounts` } },
      { series: m.series, unit: m.unit, trend: m.trend, noun: `${kind === 'all' ? 'interactions' : kindWords(kind)} given` },
    );
  },
  'posting-cadence': (archive, period, nowMs, { notes }) => {
    const m = postsModel(archive, period, nowMs);
    return seriesSpec(
      { title: 'Posts', figure: { value: fmtInt(m.count), label: `posts and replies in ${periodPhrase(period)}` } },
      { series: m.counts, unit: m.unit, trend: m.trend, marks: marksFor(archive, m.counts, m.unit, notes, false), noun: 'posts' },
    );
  },
  'repo-activity': (archive, period, nowMs) => {
    const m = atmosphereModel(archive, period, nowMs);
    if (!m) return null;
    return seriesSpec(
      { title: 'Repo activity', figure: { value: fmtInt(m.total), label: `records written across ${fmtInt(m.collections)} collections` } },
      { series: m.series, unit: m.unit, trend: m.trend, noun: 'records' },
    );
  },
  'engagement-by-type': (archive, period, nowMs) => {
    const m = engagementModel(archive, period, nowMs);
    return {
      kind: 'bars',
      title: 'Engagement by type',
      figure: { value: fmtInt(m.total), label: 'likes, reposts, replies and quotes' },
      measure: 'received',
      rows: m.byKind.map((k) => ({ label: k.label, value: k.value, display: fmtInt(k.value) })),
    };
  },
  'content-formats': (archive, period, nowMs) => groupSpec(contentModel(archive, period, nowMs), 'formats', 'What a typical post earns, by format'),
  'content-length': (archive, period, nowMs) => groupSpec(contentModel(archive, period, nowMs), 'lengths', 'What a typical post earns, by length'),
  'top-tags': (archive, period, nowMs, { rows = 8 }) => usedSpec(contentModel(archive, period, nowMs), 'tags', 'tag', 'Tags', (t) => `#${t}`, rows),
  'top-links': (archive, period, nowMs, { rows = 8 }) => usedSpec(contentModel(archive, period, nowMs), 'links', 'host', 'Sites linked to', (h) => h, rows),
};

function groupSpec(m, key, title) {
  if (!m.ready) return null;
  const rows = m[key].filter((g) => g.posts > 0 && g.typical != null);
  if (!rows.length) return null;
  return {
    kind: 'bars',
    title,
    figure: { value: m.typical == null ? '—' : fmtRate(m.typical), label: `for a typical post, across ${fmtInt(m.posts)} posts and threads` },
    measure: 'for a typical post',
    rows: rows.map((g) => ({ label: g.label, value: g.typical, display: fmtRate(g.typical) })),
  };
}

function usedSpec(m, key, name, title, render, limit) {
  if (!m.ready || !m[key].length) return null;
  return {
    kind: 'bars',
    title,
    figure: { value: fmtInt(m[key].length), label: `${title.toLowerCase()} across ${fmtInt(m.posts)} posts and threads` },
    measure: 'posts',
    rows: m[key].slice(0, Math.min(limit || 8, 8)).map((r) => ({ label: render(r[name]), value: r.posts, display: fmtInt(r.posts) })),
  };
}

// A figure tile shares the chart it is the headline of.
const SAME_AS = {
  'stat-followers': 'follower-growth',
  'stat-new-followers': 'new-followers',
  'stat-engagement': 'engagement-over-time',
  'stat-per-post': 'engagement-rate',
  'stat-given': 'engagement-given',
  'stat-posts': 'posting-cadence',
};

/** Whether a card type can be made into a picture. */
export function canShare(type) {
  return Boolean(BUILDERS[type] || SAME_AS[type]);
}

/**
 * The spec for a card: `type` is its widget type, `options` its own settings
 * (kind, rows) plus `notes`, the account's chart notes. Null when the card
 * has nothing to draw yet.
 */
export function shareSpec(type, archive, period, nowMs, options = {}) {
  const build = BUILDERS[type] || BUILDERS[SAME_AS[type]];
  if (!build) return null;
  const spec = build(archive, period, nowMs, options);
  if (!spec) return null;
  if (spec.kind === 'series' && !spec.series?.length) return null;
  return { ...spec, title: options.title || spec.title, subtitle: subtitleOf(archive, period) };
}

/* ------------------------------------------------------------------ */
/* In words                                                             */
/* ------------------------------------------------------------------ */

function extremes(series) {
  let hi = null;
  let lo = null;
  for (const p of series) {
    if (p.v == null) continue;
    if (!hi || p.v > hi.v) hi = p;
    if (!lo || p.v < lo.v) lo = p;
  }
  return { hi, lo };
}

/**
 * The description to post beside the picture, written from the same numbers
 * the chart's table holds: what it is, whose, over what window, where it
 * starts and ends, its highest and lowest point, anything marked on it, and
 * (when the chart is short enough to list) every value.
 */
export function shareAltText(spec) {
  if (!spec) return '';
  const head = `${spec.title}${spec.subtitle ? `, ${spec.subtitle}` : ''}.`;
  const headline = spec.figure ? ` ${spec.figure.value} ${spec.figure.label}.` : '';

  if (spec.kind === 'bars') {
    const rows = spec.rows.map((r) => `${r.label}: ${r.display}`).join('; ');
    return clip(`${head}${headline} Bar chart, ${spec.measure}. ${rows}.`);
  }

  const { series, unit, format, mode } = spec;
  const live = series.filter((p) => p.v != null);
  if (!live.length) return clip(`${head}${headline} Nothing in this window.`);
  const first = live[0];
  const last = live[live.length - 1];
  const { hi, lo } = extremes(series);
  // A week reads "the week of Oct 18" in a sentence and "week of Oct 18" in
  // the list of values; a day or a month is its own name in both.
  const label = (p) => bucketLabel(p.t, unit).replace(/^wk of /, 'week of ');
  const named = (p) => (unit === 'week' ? `the ${label(p)}` : label(p));
  const shape = mode === 'line' ? 'Line chart' : 'Bar chart';
  let text = `${head}${headline} ${shape} of ${spec.noun} per ${unitNoun(unit)}, from ${named(series[0])} to ${named(series[series.length - 1])}.`;
  text +=
    mode === 'line'
      ? ` It starts at ${format(first.v)} and ends at ${format(last.v)}.`
      : ` The highest is ${named(hi)} with ${format(hi.v)}${lo.v !== hi.v ? `, the lowest ${named(lo)} with ${format(lo.v)}` : ''}.`;
  if (spec.ghost) text += ` Bluesky’s profile counter says ${fmtInt(spec.ghost.v)}, which still counts accounts that can’t be listed.`;
  if (spec.marks?.length) {
    text += ` Marked: ${spec.marks.map((m) => `${named(m)}, ${m.items.map((i) => i.label).join(' and ')}`).join('; ')}.`;
  }
  if (series.length <= LIST_UP_TO) {
    const values = ` Values: ${series.map((p) => `${label(p)}: ${p.v == null ? 'none' : format(p.v)}`).join('; ')}.`;
    if ((text + values).length <= ALT_TEXT_MAX) text += values;
  }
  return clip(text);
}

function clip(text) {
  return text.length <= ALT_TEXT_MAX ? text : `${text.slice(0, ALT_TEXT_MAX - 1).trimEnd()}…`;
}

/** A first line for the post itself, for the writer to change: "Follower growth, the last 30 days." */
export function sharePostText(spec, period) {
  if (!spec) return '';
  return `${spec.title}, ${periodPhrase(period)}.`;
}
