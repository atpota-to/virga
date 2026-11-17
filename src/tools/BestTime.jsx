// When your posts earn the most: engagement per post by the weekday and hour
// each was made, in this browser's time zone, from your own history. Your
// posts and threads only; replies to other people earn differently.

import { useState } from 'react';
import BarList from '../charts/BarList.jsx';
import { ShowAsTable } from '../charts/ChartTable.jsx';
import Heatmap from '../charts/Heatmap.jsx';
import { fmtRate } from '../charts/format.js';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { bestTimeRows, bestTimeSentence, bestTimeWindow } from '../dashboards/widgets/index.jsx';
import { BEST_TIME_MIN_POSTS, WEEKDAYS, WEEKDAYS_LONG as LONG, bestTimeModel, hourColumns, hourRange, weekdayOrder } from '../reports/models.js';
import { Link } from '../lib/router.jsx';
import { PeriodPicker, periodPhrase, usePeriod } from '../shell/bits.jsx';
import { ToolHeader } from './ToolPage.jsx';
import { activeLocale } from '../lib/locale.js';

export default function BestTime({ tool }) {
  const archive = useArchive();
  const [period] = usePeriod();
  const [block, setBlock] = useState(2);
  // A short period holds too few posts to say anything; it reads the year,
  // and the picker offers only the windows it can read, with the one in use
  // pressed.
  const win = bestTimeWindow(period);
  const m = bestTimeModel(archive, win, archive.nowMs, { block });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <ToolHeader tool={tool} actions={<PeriodPicker options={['90d', '1y', 'all', 'custom']} effective={win.custom ? 'custom' : win.key} />} />
      <div className="page-body">
        {/* What the page found, in a sentence, before any of the charts it found it in. */}
        <p className="tool-statement">{bestTimeSentence(m)}</p>

        <section className="card" aria-labelledby="bt-title">
          <div className="card-head">
            <div>
              <h2 id="bt-title" className="card-title">
                What a typical post earns, by when it was posted
              </h2>
              <p className="card-sub">
                {m.posts.toLocaleString(activeLocale())} posts and threads over {periodPhrase(win)}, in {zone.replace(/_/g, ' ')} time
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
          <Heatmap rows={bestTimeRows(m)} columns={hourColumns(block)} summary={bestTimeSentence(m)} cellHeight={block === 1 ? 22 : 30} />
          <p className="card-caption">
            Each slot shows its typical post (the median), so one post that went round doesn’t make its hour look like the best
            time forever. The ringed slot is the best. A slot with fewer than {BEST_TIME_MIN_POSTS} posts is left as an outline: too
            few to say anything. Posts from the last two days are still collecting engagement and are left out.
          </p>
          <ShowAsTable>
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
                  {weekdayOrder().flatMap((day) =>
                    m.rows[day].cells
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
          </ShowAsTable>
        </section>

        <div className="report-split">
          <section className="card card--flush" aria-labelledby="bt-top">
            <div className="card-head">
              <div>
                <h2 id="bt-top" className="card-title">
                  The best slots
                </h2>
              </div>
              <Link to="/posting/schedule" className="more-link">
                Use them in the weekly schedule
              </Link>
            </div>
            {m.best.length ? (
              <ol className="best-list">
                {m.best.map((b, i) => (
                  <li key={`${b.day}-${b.col}`}>
                    <span className="best-rank num">{i + 1}</span>
                    <span className="best-when">
                      {LONG[b.day]}, {hourRange(b.col, block)}
                    </span>
                    <span className="best-avg num">{fmtRate(b.avg)} typical</span>
                    <span className="best-posts num">
                      {b.posts} {b.posts === 1 ? 'post' : 'posts'}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty">Not enough posts in this window yet.</p>
            )}
          </section>
          <section className="card card--flush" aria-labelledby="bt-days">
            {/* What the bars measure goes in a caption under them: a line
                under the title would drop this rule below the best slots'
                beside it, and words at the heading's right read as a link. */}
            <div className="card-head">
              <div>
                <h2 id="bt-days" className="card-title">
                  By weekday
                </h2>
              </div>
            </div>
            <div className="best-days">
              <BarList
                ariaLabel="What a typical post earns, by weekday"
                format={(v) => fmtRate(v)}
                rows={weekdayOrder().map((day) => m.byDay[day]).map((d) => ({ key: d.day, label: WEEKDAYS[d.day], value: d.avg || 0, display: d.avg == null ? '—' : fmtRate(d.avg), title: `${d.posts} posts` }))}
              />
            </div>
            <p className="card-caption">What a typical post earns.</p>
          </section>
        </div>
      </div>
    </>
  );
}
