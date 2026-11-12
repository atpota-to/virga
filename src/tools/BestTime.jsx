// When your posts earn the most: engagement per post by the weekday and hour
// each was made, in this browser's time zone, from your own history. Your
// posts and threads only; replies to other people earn differently.

import { useState } from 'react';
import BarList from '../charts/BarList.jsx';
import Heatmap from '../charts/Heatmap.jsx';
import { fmtRate } from '../charts/format.js';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { bestTimeRows, bestTimeSentence, bestTimeWindow } from '../dashboards/widgets/index.jsx';
import { BEST_TIME_MIN_POSTS, WEEKDAYS, bestTimeModel, hourColumns, hourRange } from '../reports/models.js';
import { PeriodPicker, periodPhrase, usePeriod } from '../shell/bits.jsx';
import { ToolHeader } from './ToolPage.jsx';

const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function BestTime({ tool }) {
  const archive = useArchive();
  const [period] = usePeriod();
  const [block, setBlock] = useState(2);
  // A short period holds too few posts to say anything; it reads the year.
  const win = bestTimeWindow(period);
  const m = bestTimeModel(archive, win, archive.nowMs, { block });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <ToolHeader tool={tool} actions={<PeriodPicker />} />
      <div className="page-body">
        <section className="card" aria-labelledby="bt-title">
          <div className="card-head">
            <div>
              <h2 id="bt-title" className="card-title">
                What a typical post earns, by when it was posted
              </h2>
              <p className="card-sub">
                {m.posts.toLocaleString('en-US')} posts and threads over {periodPhrase(win)}
                {win !== period ? ' (a shorter window holds too few posts to say)' : ''}, in {zone.replace(/_/g, ' ')} time
              </p>
            </div>
            <Segmented
              size="sm"
              label="Hours per column"
              value={block}
              onChange={setBlock}
              options={[
                { value: 1, label: 'Hourly' },
                { value: 2, label: '2 hours' },
                { value: 4, label: '4 hours' },
              ]}
            />
          </div>
          <p className="widget-insight">{bestTimeSentence(m)}</p>
          <div className="best-heat">
            <Heatmap rows={bestTimeRows(m)} columns={hourColumns(block)} summary={bestTimeSentence(m)} cellHeight={block === 1 ? 20 : 26} />
          </div>
          <p className="card-caption">
            Each slot shows its typical post (the median), so one post that went round doesn’t make its hour look like the best
            time forever. The ringed slot is the best. A slot with fewer than {BEST_TIME_MIN_POSTS} posts is left as an outline: too
            few to say anything. Posts from the last two days are still collecting engagement and are left out.
          </p>
        </section>
        <div className="report-split">
          <section className="card" aria-labelledby="bt-top">
            <h2 id="bt-top" className="card-title">
              The best slots
            </h2>
            {m.best.length ? (
              <ol className="best-list">
                {m.best.map((b, i) => (
                  <li key={`${b.day}-${b.col}`}>
                    <span className="best-rank num">{i + 1}</span>
                    <span className="best-when">
                      {LONG[b.day]}, {hourRange(b.col, block)}
                    </span>
                    <span className="best-avg num">{fmtRate(b.avg)} typical</span>
                    <span className="muted num">{b.posts} posts</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty">Not enough posts in this window yet.</p>
            )}
          </section>
          <section className="card" aria-labelledby="bt-days">
            <h2 id="bt-days" className="card-title">
              By weekday
            </h2>
            <BarList
              ariaLabel="What a typical post earns, by weekday"
              labelWidth="48px"
              format={(v) => fmtRate(v)}
              rows={m.byDay.map((d) => ({ key: d.day, label: WEEKDAYS[d.day], value: d.avg || 0, display: d.avg == null ? '—' : fmtRate(d.avg), title: `${d.posts} posts` }))}
            />
          </section>
        </div>
        <details className="card disclosure how-counted">
          <summary>Every slot as a table</summary>
          <div className="table-scroll best-table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col" className="is-num">
                    Posts
                  </th>
                  <th scope="col" className="is-num">
                    Typical post
                  </th>
                </tr>
              </thead>
              <tbody>
                {m.rows.flatMap((r, day) =>
                  r.cells
                    .map((c, col) => ({ c, col }))
                    .filter(({ c }) => c.posts > 0)
                    .map(({ c, col }) => (
                      <tr key={`${day}-${col}`}>
                        <th scope="row">
                          {LONG[day]}, {hourRange(col, block)}
                        </th>
                        <td className="is-num">{c.posts}</td>
                        <td className="is-num">{c.avg == null ? '—' : fmtRate(c.avg)}</td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </>
  );
}
