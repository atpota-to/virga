// What the archive holds and how fresh it is, and the sync while it runs.
//
//   SyncCard    the sidebar's, pinned to its foot: when it was synced,
//               Sync now, and the progress (one bar, the step named) while
//               a sync runs. `brief` keeps it to its first line, beside
//               the first build's page, which shows the steps itself.
//   SyncBanner  the same as one 36px strip at the top of the page, for a
//               phone (where there is no sidebar) and a folded sidebar:
//               the words, Cancel, and the progress as a line along its
//               foot.
//   SyncSteps   every step, named, each with its own segment: the first
//               build's page and Settings › Data show it in full.

import { useMemo } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';
import Button from '../components/Button.jsx';
import { blockReach } from '../lib/analytics.js';
import { SYNC_STEPS } from '../lib/syncProgress.js';
import { relativeTime } from '../lib/time.js';
import { Link } from '../lib/router.jsx';
import { activeLocale } from '../lib/locale.js';

/** Overall progress across a sync's steps, 0–1, or null when unmeasured. */
export function overallFraction(sync) {
  if (!sync) return null;
  const total = sync.plan.length || 1;
  const finished = sync.done.length + sync.failed.length;
  const current = sync.step && sync.fraction != null ? sync.fraction : 0;
  return Math.min(1, (finished + current) / total);
}

export function syncHeadline(sync) {
  if (!sync) return '';
  if (sync.step == null) return 'Loading the archive into the charts';
  return sync.doing || SYNC_STEPS[sync.step]?.doing || 'Syncing';
}

export function syncStepText(sync) {
  if (!sync) return '';
  if (sync.step == null) return 'Finishing';
  return `Step ${sync.plan.indexOf(sync.step) + 1} of ${sync.plan.length}`;
}

/** "Synced 12 minutes ago", "Archive incomplete", "Not built yet". */
export function syncWhen(archive) {
  const pm = archive.meta.posts;
  if (!pm) return 'Not built yet';
  if (!pm.complete) return 'Archive incomplete';
  return pm.syncedAt ? `Synced ${relativeTime(pm.syncedAt)}` : 'Not synced yet';
}

export function useArchiveCounts(archive) {
  const reach = useMemo(() => blockReach(archive.blocks).people.length, [archive.blocks]);
  return { posts: archive.posts.length, followers: archive.followers.length, records: archive.atmosphere.length, blockedBy: reach };
}

function runFor(archive) {
  const pm = archive.meta.posts;
  return () => archive.runSync(!pm ? 'full' : pm.complete ? 'incremental' : 'resume');
}

export function SyncCard({ archive, brief = false }) {
  const { sync, syncError, meta } = archive;
  const counts = useArchiveCounts(archive);
  const frac = overallFraction(sync);
  if (sync) {
    return (
      <section className="sync-card" aria-label="Sync">
        <div className="sync-card-row">
          {/* While brief, the first build's page announces the progress: once is enough. */}
          <span className="sync-card-title" role={brief ? undefined : 'status'}>
            {syncHeadline(sync)}
          </span>
          <Button variant="ghost" size="sm" icon aria-label="Cancel the sync" title="Cancel" onClick={archive.cancelSync}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
        {!brief && (
          <div className="progress" aria-hidden="true">
            <div
              className="progress-fill"
              style={frac == null ? undefined : { width: `${Math.round(frac * 100)}%` }}
              data-indeterminate={frac == null ? '' : undefined}
            />
          </div>
        )}
        {!brief && (
          <span className="sync-card-sub num">
            {syncStepText(sync)}
            {sync.detail ? ` · ${sync.detail}` : ''}
          </span>
        )}
      </section>
    );
  }
  const pm = meta.posts;
  return (
    <section className="sync-card" aria-label="Your archive">
      <div className="sync-card-row">
        <span className="sync-card-title">
          <span className={`dot${syncError ? ' dot--warn' : !pm ? ' dot--idle' : ''}`} aria-hidden="true" />
          {syncError ? 'Last sync had problems' : syncWhen(archive)}
        </span>
      </div>
      {!brief && pm && (
        <span className="sync-card-sub sync-card-counts num">
          {counts.records.toLocaleString(activeLocale())} repo records and {counts.followers.toLocaleString(activeLocale())} followers, kept on this device
        </span>
      )}
      {!brief && syncError && (
        <Link to="/settings/data" className="sync-card-link">
          See what failed
        </Link>
      )}
      {!brief && (
        <Button size="sm" onClick={runFor(archive)}>
          <RefreshCw size={14} aria-hidden="true" />
          {!pm ? 'Build your archive' : pm.complete ? 'Sync now' : 'Resume the build'}
        </Button>
      )}
    </section>
  );
}

export function SyncBanner({ archive }) {
  const { sync, syncError } = archive;
  const frac = overallFraction(sync);
  if (!sync && !syncError) return null;
  if (!sync) {
    return (
      <div className="sync-banner" data-tone="warn" role="alert">
        <span className="sync-banner-text">The last sync had problems.</span>
        <Link to="/settings/data">See what failed</Link>
      </div>
    );
  }
  return (
    <div className="sync-banner">
      <span role="status" className="sync-banner-text">
        {syncHeadline(sync)}
        <span className="sync-banner-step num">{syncStepText(sync)}</span>
      </span>
      <button type="button" className="link-action" aria-label="Cancel the sync" onClick={archive.cancelSync}>
        Cancel
      </button>
      <div className="progress" aria-hidden="true">
        <div
          className="progress-fill"
          style={frac == null ? undefined : { width: `${Math.round(frac * 100)}%` }}
          data-indeterminate={frac == null ? '' : undefined}
        />
      </div>
    </div>
  );
}

/**
 * Every step of a sync, named: finished ones ticked, failed ones marked, the
 * one under way filled by its own measured share (or moving, when there is
 * nothing honest to measure it by), the rest waiting.
 */
export function SyncSteps({ sync }) {
  const { plan, done, failed, step, fraction, detail } = sync;
  const pct = fraction == null || step == null ? null : Math.round(fraction * 100);
  const stateOf = (key) => (failed.includes(key) ? 'failed' : done.includes(key) ? 'done' : key === step ? 'active' : 'pending');
  return (
    <div className="sync-steps-wrap">
      <p className="sync-steps-head" role="status">
        <strong>{syncHeadline(sync)}</strong>
        <span className="num">
          {' · '}
          {syncStepText(sync)}
          {detail ? ` · ${detail}` : ''}
          {pct != null ? ` · ${pct}%` : ''}
        </span>
      </p>
      <ol className="sync-steps" aria-label="Sync steps">
        {plan.map((key) => {
          const state = stateOf(key);
          const width = state === 'done' || state === 'failed' ? 100 : state === 'active' ? (pct ?? 0) : 0;
          return (
            <li key={key} className="sync-step" data-state={state}>
              <span className="progress" aria-hidden="true">
                <span
                  className="progress-fill"
                  style={state === 'active' && pct == null ? undefined : { width: `${width}%`, display: 'block' }}
                  data-indeterminate={state === 'active' && pct == null ? '' : undefined}
                />
              </span>
              <span className="sync-step-name">
                {SYNC_STEPS[key]?.label || key}
                <span className="sync-step-state" aria-hidden="true">
                  {state === 'done' ? <Check size={13} /> : state === 'failed' ? 'failed' : state === 'active' ? (pct != null ? `${pct}%` : '…') : null}
                </span>
                <span className="visually-hidden">
                  {state === 'done' ? ', done' : state === 'failed' ? ', failed' : state === 'active' ? (pct != null ? `, ${pct}% done` : ', under way') : ', waiting'}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
