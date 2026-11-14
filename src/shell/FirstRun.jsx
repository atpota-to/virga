import { Cloud, Database, Heart, ShieldCheck, UsersRound } from 'lucide-react';
import Button from '../components/Button.jsx';
import { SyncSteps } from './SyncStatus.jsx';

/**
 * Before there is anything to chart: what a build reads, where it goes, and
 * the one button. While the build runs, its steps.
 */
export default function FirstRun({ archive }) {
  const { sync } = archive;
  return (
    <div className="first-run">
      <section className="card first-run-card" aria-labelledby="first-run-title">
        <h1 id="first-run-title" className="first-run-title">
          Build your archive
        </h1>
        <p className="first-run-lede">
          Virga works your analytics out in this browser, from your own data. The first build takes a minute or two
          for most accounts; after that, a sync only fetches what’s new.
        </p>
        <ul className="first-run-list">
          <li>
            <Database size={16} aria-hidden="true" />
            <span>
              <strong>Your repo</strong>, every record in every collection, in one download
            </span>
          </li>
          <li>
            <UsersRound size={16} aria-hidden="true" />
            <span>
              <strong>Your followers</strong> and the day each one followed you, and who you follow
            </span>
          </li>
          <li>
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              <strong>Who blocks you</strong>, directly or through a moderation list
            </span>
          </li>
          <li>
            <Heart size={16} aria-hidden="true" />
            <span>
              <strong>Engagement</strong>: the likes, reposts, replies and quotes on every post, and your recent
              notifications
            </span>
          </li>
          <li>
            <Cloud size={16} aria-hidden="true" />
            <span>
              It’s kept <strong>in this browser</strong>. Virga’s server never keeps a copy.
            </span>
          </li>
        </ul>
        {!archive.persistent && (
          <p className="callout callout--warn">
            {archive.blocked
              ? 'Another Virga tab is holding the archive open, so a build here would only last the session. Close that tab, then reload this one to keep it.'
              : 'This browser is blocking IndexedDB, so the archive will only last the session.'}
          </p>
        )}
        {sync ? (
          <SyncSteps sync={sync} />
        ) : (
          <div>
            <Button variant="primary" size="lg" onClick={() => archive.runSync('full')}>
              Build your archive
            </Button>
          </div>
        )}
        {archive.syncError && !sync && (
          <p className="callout callout--danger" role="alert">
            {archive.syncError}
          </p>
        )}
      </section>
    </div>
  );
}
