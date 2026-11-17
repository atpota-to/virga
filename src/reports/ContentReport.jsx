// The Content report: what the account's posts are made of, and what each
// kind typically earns. By format, by length, by place in a thread, by tag
// and by linked site, plus how much of its media is described.
//
// Everything here reads the median post of a group, not its average, the
// way Best time to post does: one post that went round shouldn't make
// "video" look like the answer forever.

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import BarList from '../charts/BarList.jsx';
import { fmtRate } from '../charts/format.js';
import Figures from '../components/Figures.jsx';
import { fmtInt } from '../lib/locale.js';
import { periodPhrase } from '../shell/bits.jsx';
import { CONTENT_MIN_POSTS, contentModel, contentStandout } from './models.js';
import { Card, GroupTable, HowCounted, ModeToggle, SyncEmpty, fig } from './parts.jsx';

const MEASURES = [
  { key: 'typical', label: 'Typical post', title: 'What the middle post of each group earns' },
  { key: 'posts', label: 'Posts', title: 'How many posts are in each group' },
];

const pct = (share) => Math.round(share * 100);
const typicalText = (g) => (g.typical == null ? '—' : fmtRate(g.typical));
const postsWord = (n) => `${fmtInt(n)} ${n === 1 ? 'post' : 'posts'}`;

/** A group's row for a bar list, by what the bars measure. */
function barRow(g, measure, label = g.label) {
  const typical = measure === 'typical';
  return {
    key: g.key ?? label,
    label,
    value: typical ? g.typical || 0 : g.posts,
    display: typical ? typicalText(g) : fmtInt(g.posts),
    title: typical
      ? g.typical == null
        ? `${postsWord(g.posts)}: too few to say what’s typical`
        : `${postsWord(g.posts)}, typically earning ${fmtRate(g.typical)}`
      : `${postsWord(g.posts)}, ${pct(g.share)}% of them`,
  };
}

const GROUP_COLUMNS = (head) => [
  { head, cell: (g) => g.label },
  { head: 'Posts', num: true, cell: (g) => fmtInt(g.posts) },
  { head: 'Share', num: true, cell: (g) => `${pct(g.share)}%` },
  { head: 'Typical post', num: true, cell: typicalText },
  { head: 'All engagement', num: true, cell: (g) => fmtInt(g.total) },
];

/** "Images typically earn 60, against 4 for text only." or null. */
export function standoutSentence(groups, overall, against, noun = (g) => g.label) {
  const s = contentStandout(groups, overall, against);
  if (!s) return null;
  const versus = s.base ? `${fmtRate(s.baseline)} for ${noun(s.base).toLowerCase()}` : `${fmtRate(s.baseline)} for your posts overall`;
  return `${noun(s.best)} typically earn${noun(s.best).endsWith('s') ? '' : 's'} ${fmtRate(s.best.typical)}, against ${versus}.`;
}

/** A group chart. `actions` go on the line under it, after Show as table (the report's lead chart has them). */
function Grouped({ title, sub, groups, head, ariaLabel, insight = null, labelWidth = '120px', actions = null }) {
  const [measure, setMeasure] = useState('typical');
  const shown = groups.filter((g) => g.posts > 0);
  return (
    <Card title={title} sub={sub} tools={<ModeToggle value={measure} onChange={setMeasure} options={MEASURES} label={`${title}: measure`} />}>
      {insight && <p className="report-insight">{insight}</p>}
      {shown.length ? (
        <>
          <BarList ariaLabel={ariaLabel} labelWidth={labelWidth} rows={shown.map((g) => barRow(g, measure))} />
          <GroupTable rows={shown} columns={GROUP_COLUMNS(head)} actions={actions} />
        </>
      ) : (
        <p className="empty">No posts in this window.</p>
      )}
    </Card>
  );
}

function Ranked({ title, sub, rows, name, head, empty, render = (v) => v, limit = 12 }) {
  const [measure, setMeasure] = useState('posts');
  const [all, setAll] = useState(false);
  const labelled = rows.map((r) => ({ ...r, key: r[name], label: render(r[name]) }));
  // By typical post: only groups with one, so a single lucky post can't lead.
  const ordered = measure === 'typical' ? labelled.filter((r) => r.typical != null).sort((a, b) => b.typical - a.typical || b.posts - a.posts) : labelled;
  const shown = all ? ordered : ordered.slice(0, limit);
  // Showing every bar is one more thing to do with the chart, so it joins
  // Show as table on the line under it rather than taking a line of its own.
  const more =
    ordered.length > limit ? (
      <button type="button" className="link-action" onClick={() => setAll((v) => !v)}>
        {all ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        {all ? 'Show fewer' : `Show all ${fmtInt(ordered.length)}`}
      </button>
    ) : null;
  return (
    <Card title={title} sub={sub} tools={rows.length ? <ModeToggle value={measure} onChange={setMeasure} options={MEASURES} label={`${title}: measure`} /> : null}>
      {shown.length ? (
        <>
          <BarList ariaLabel={title} labelWidth="1fr" rows={shown.map((r) => barRow(r, measure, r.label))} />
          <GroupTable rows={ordered} columns={GROUP_COLUMNS(head)} actions={more} />
        </>
      ) : (
        <p className="empty">{rows.length ? `None used in ${CONTENT_MIN_POSTS} posts or more yet.` : empty}</p>
      )}
    </Card>
  );
}

export default function ContentReport({ archive, period, nowMs, actions = null }) {
  const m = contentModel(archive, period, nowMs);
  if (!archive.posts.length) return <SyncEmpty archive={archive}>The post archive is empty. Run a sync to build it.</SyncEmpty>;
  if (!m.ready) {
    return (
      <SyncEmpty archive={archive}>
        One more sync, and this report can be drawn. Your archive was built before Virga kept what each post is made of: its length,
        tags, links, media and alt text. A sync reads them from your repo in one download and keeps every count you already have.
      </SyncEmpty>
    );
  }

  const share = (n) => (m.posts ? Math.round((n / m.posts) * 100) : 0);
  const media = m.formats.filter((f) => f.key === 'image' || f.key === 'video').reduce((n, f) => n + f.posts, 0);
  const window = period.days ? `in ${periodPhrase(period)}` : 'all time';
  return (
    <>
      <Figures
        label="Content in figures"
        items={[
          fig(`Posts and threads, ${window}`, m.posts),
          fig('A typical post earns', m.typical == null ? '—' : fmtRate(m.typical), { sub: 'likes, reposts, replies and quotes' }),
          fig('With pictures or video', share(media), { unit: '%', sub: postsWord(media) }),
          fig('Media described', m.alt.pct == null ? '—' : Math.round(m.alt.pct), {
            unit: m.alt.pct == null ? null : '%',
            sub: m.alt.items ? `${fmtInt(m.alt.itemsDescribed)} of ${fmtInt(m.alt.items)} pictures and videos have alt text` : 'no pictures or video in this window',
          }),
          fig('With a tag', share(m.withTags), { unit: '%', sub: postsWord(m.withTags) }),
        ]}
      />
      <div className="report-split">
        <Grouped
          title="By format"
          sub="What each post carries besides its words"
          head="Format"
          ariaLabel="Posts by format"
          groups={m.formats}
          actions={actions}
          insight={standoutSentence(m.formats, m.typical, 'text', (g) => (g.key === 'text' ? 'Text-only posts' : g.key === 'image' ? 'Posts with images' : g.key === 'video' ? 'Posts with video' : g.key === 'link' ? 'Posts with a link card' : g.key === 'gif' ? 'Posts with a GIF' : 'Quote posts'))}
        />
        <Grouped
          title="By length"
          sub="In characters, of the 300 a post holds"
          head="Length"
          ariaLabel="Posts by length"
          groups={m.lengths}
          insight={standoutSentence(m.lengths, m.typical, null, (g) => `Posts of ${g.label.toLowerCase()} characters`)}
        />
      </div>
      <div className="report-split">
        <Ranked
          title="Tags"
          sub="Counted whatever their capitals"
          head="Tag"
          name="tag"
          rows={m.tags}
          render={(tag) => `#${tag}`}
          empty="No tags on your posts in this window."
        />
        <Ranked title="Sites you link to" sub="From links in the text and link cards" head="Site" name="host" rows={m.links} empty="No links in your posts in this window." />
      </div>
      <div className="report-split">
        <Grouped
          title="Threads"
          sub="Where a post sits in a thread of your own"
          head="Place"
          ariaLabel="Posts by place in a thread"
          groups={m.places}
          labelWidth="140px"
        />
        {m.langs.length > 1 && (
          <Card title="Languages" sub="As each post is marked. A post can carry more than one.">
            <BarList ariaLabel="Posts by language" labelWidth="120px" rows={m.langs.map((l) => ({ key: l.lang, label: languageName(l.lang), value: l.posts }))} />
          </Card>
        )}
      </div>
      {m.unread > 0 && (
        <p className="card-sub report-aside">
          {postsWord(m.unread)} in this window {m.unread === 1 ? 'isn’t' : 'aren’t'} included: {m.unread === 1 ? 'it was' : 'they were'} archived
          before Virga kept what a post is made of, and {m.unread === 1 ? 'is' : 'are'} no longer in your repo to read it from.
        </p>
      )}
      <HowCounted>
        <p>
          Your posts and your own threads in the window. Replies to other people are left out, as they are from the engagement rate: an
          answer inside someone else’s conversation earns on a different scale.
        </p>
        <p>
          What a group typically earns is its median post, the one in the middle, so a single post that went round doesn’t speak for the
          rest. Posts from the last two days are still collecting and are counted but not weighed, and a group needs {CONTENT_MIN_POSTS}{' '}
          weighed posts before it gets a typical value. Counts are as of the last sync.
        </p>
        <p>
          A post’s format is what it carries: pictures, a video, a link card, a GIF, or a quote. A quote post that also has pictures
          counts as its pictures. Length is in the characters Bluesky counts. Tags come from the text and from tags added beside it;
          sites from links in the text and from link cards. Media counts as described when its alt text isn’t empty.
        </p>
        <p>None of this says one thing causes another. Posts with pictures may do well because of what you choose to photograph.</p>
      </HowCounted>
    </>
  );
}

/** "French" for 'fr', in English; the code itself where the browser can't name it. */
function languageName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}
