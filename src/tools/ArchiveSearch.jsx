// Search every post in the archive, by its words, its kind and its window,
// sorted by date or by what it earned, and take the results (or the whole
// archive) with you.

import { useDeferredValue, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import Button from '../components/Button.jsx';
import Menu from '../components/Menu.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportArchive, exportPosts } from '../archive/exports.js';
import { engagementOf } from '../lib/analytics.js';
import PostRow from '../reports/PostRow.jsx';
import { PeriodPicker, periodPhrase, usePeriod } from '../shell/bits.jsx';
import { ToolHeader } from './ToolPage.jsx';

const DAY_MS = 86_400_000;
const PAGE = 30;

export default function ArchiveSearch({ tool }) {
  const archive = useArchive();
  const [period] = usePeriod();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('newest');
  const [limit, setLimit] = useState(PAGE);
  const q = useDeferredValue(query.trim().toLowerCase());
  const nowMs = archive.nowMs;

  const results = useMemo(() => {
    const t0 = period.days ? nowMs - period.days * DAY_MS : -Infinity;
    const words = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (const p of archive.posts) {
      const t = Date.parse(p.at);
      if (!(t >= t0)) continue;
      if (kind === 'posts' && p.replyTo) continue;
      if (kind === 'replies' && !p.replyTo) continue;
      if (kind === 'quotes' && !p.quoteOf) continue;
      if (kind === 'media' && !p.hasMedia) continue;
      if (words.length) {
        const text = (p.text || '').toLowerCase();
        if (!words.every((w) => text.includes(w))) continue;
      }
      out.push({ p, t, e: engagementOf(p, 'all') });
    }
    out.sort((a, b) => (sort === 'oldest' ? a.t - b.t : sort === 'engagement' ? b.e - a.e || b.t - a.t : b.t - a.t));
    return out.map((r) => r.p);
  }, [archive.posts, q, kind, sort, period, nowMs]);

  const shown = results.slice(0, limit);

  return (
    <>
      <ToolHeader
        tool={tool}
        actions={
          <>
            <PeriodPicker />
            <Menu
              label="Export"
              size="md"
              items={[
                { icon: Download, label: `These ${results.length.toLocaleString('en-US')} posts (CSV)`, hint: 'What the search shows, newest first.', onSelect: () => exportPosts(archive, results) },
                { icon: Download, label: 'Every post (CSV)', hint: 'The whole post archive with its counts.', onSelect: () => exportPosts(archive) },
                { icon: Download, label: 'Everything (JSON)', hint: 'Posts, followers, blocks, engagement and repo records.', onSelect: () => exportArchive(archive) },
              ]}
            >
              <Download size={15} aria-hidden="true" />
              Export
            </Menu>
          </>
        }
      />
      <div className="page-body">
        <section className="card search-card" aria-label="Search">
          <label className="search search--lg">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3" />
            </svg>
            <span className="visually-hidden">Search your posts</span>
            <input
              className="input input--lg"
              type="search"
              placeholder="Search your posts"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
            />
          </label>
          <div className="search-filters">
            <div className="library-cats" role="group" aria-label="Kind of post">
              {[
                ['all', 'All'],
                ['posts', 'Posts'],
                ['replies', 'Replies'],
                ['quotes', 'Quotes'],
                ['media', 'With media'],
              ].map(([k, label]) => (
                <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="field-inline">
              <span>Sort</span>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="engagement">Most engagement</option>
              </select>
            </label>
          </div>
        </section>
        <section className="card card--flush" aria-label="Results">
          <div className="card-head">
            <p className="card-sub num" role="status">
              {results.length.toLocaleString('en-US')} {results.length === 1 ? 'post' : 'posts'} in {periodPhrase(period)}
              {q ? ` matching “${query.trim()}”` : ''}
            </p>
          </div>
          {shown.length ? (
            <ol className="widget-rows report-rows">
              {shown.map((p) => (
                <PostRow key={p.uri} post={p} did={archive.did} />
              ))}
            </ol>
          ) : (
            <p className="empty">Nothing matches.</p>
          )}
          {results.length > shown.length && (
            <div className="card-foot">
              <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
                Show {Math.min(PAGE, results.length - shown.length)} more
              </Button>
            </div>
          )}
        </section>
        <p className="note">
          The archive keeps the first 200 characters of each post, so a search finds words in that part. Counts are as of the last sync.
        </p>
      </div>
    </>
  );
}
