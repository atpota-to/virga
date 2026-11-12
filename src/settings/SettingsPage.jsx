// Settings: the account, the archive and its sync, the dashboards, how Virga
// looks (the live sky lives here, off until it's asked for), what the
// sign-in lets Virga do, and where the data comes from.

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, ExternalLink, HardDrive, LogOut, Pencil, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportArchive, exportPosts } from '../archive/exports.js';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import NewDashboardDialog from '../dashboards/NewDashboardDialog.jsx';
import { usePreferences } from '../lib/preferences.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { formatDateShort, relativeTime } from '../lib/time.js';
import { PageHeader, useToast } from '../shell/bits.jsx';
import { SyncSteps, syncWhen, useArchiveCounts } from '../shell/SyncStatus.jsx';
import './settings.css';

const SECTIONS = [
  { key: 'account', label: 'Account' },
  { key: 'data', label: 'Data and sync' },
  { key: 'dashboards', label: 'Dashboards' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'permissions', label: 'Permissions' },
  { key: 'about', label: 'About' },
];

export default function SettingsPage({ section, profile, onSignOut }) {
  const current = SECTIONS.find((s) => s.key === section) ? section : 'account';
  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings">
          {SECTIONS.map((s) => (
            <Link key={s.key} to={`/settings/${s.key}`} className="settings-nav-item" aria-current={current === s.key ? 'page' : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="settings-body">
          {current === 'account' && <AccountSection profile={profile} onSignOut={onSignOut} />}
          {current === 'data' && <DataSection />}
          {current === 'dashboards' && <DashboardsSection />}
          {current === 'appearance' && <AppearanceSection />}
          {current === 'permissions' && <PermissionsSection />}
          {current === 'about' && <AboutSection />}
        </div>
      </div>
    </>
  );
}

function Section({ title, sub = null, children, tone = null }) {
  return (
    <section className="card settings-section" data-tone={tone || undefined}>
      <div className="settings-section-head">
        <h2 className="card-title">{title}</h2>
        {sub && <p className="card-sub">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint = null, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

/* ---- account ------------------------------------------------------- */

function AccountSection({ profile, onSignOut }) {
  const archive = useArchive();
  const handle = profile?.handle;
  return (
    <>
      <Section title="Signed in as">
        <div className="account-card">
          <Avatar src={profile?.avatar} name={profile?.displayName || handle} size="lg" />
          <div className="account-card-text">
            <span className="account-card-name">{profile?.displayName || (handle ? `@${handle}` : archive.did)}</span>
            {handle && <span className="muted">@{handle}</span>}
            <code className="muted account-card-did">{archive.did}</code>
          </div>
          <div className="account-card-actions">
            <Button as="a" href={`https://bsky.app/profile/${encodeURIComponent(handle || archive.did)}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden="true" />
              Open on Bluesky
            </Button>
            <Button onClick={onSignOut}>
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </Section>
      <Section title="Other accounts">
        <p className="settings-text">
          To look at another account, sign out and sign in with it. Each account keeps its own archive and its own dashboards in this
          browser, and signing out leaves them there for next time.
        </p>
      </Section>
      <Section title="Identity">
        <p className="settings-text">
          Your DID, your PDS and every handle you’ve had are in the <Link to="/tools/identity">Identity inspector</Link>.
        </p>
      </Section>
    </>
  );
}

/* ---- data and sync ------------------------------------------------- */

function useStorageEstimate() {
  const [estimate, setEstimate] = useState(null);
  const [persisted, setPersisted] = useState(null);
  useEffect(() => {
    let gone = false;
    navigator.storage?.estimate?.().then((e) => !gone && setEstimate(e)).catch(() => {});
    navigator.storage?.persisted?.().then((p) => !gone && setPersisted(p)).catch(() => {});
    return () => {
      gone = true;
    };
  }, []);
  return { estimate, persisted, setPersisted };
}

function megabytes(bytes) {
  return bytes == null ? '—' : `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;
}

function DataSection() {
  const archive = useArchive();
  const toast = useToast();
  const counts = useArchiveCounts(archive);
  const { estimate, persisted, setPersisted } = useStorageEstimate();
  const [confirm, setConfirm] = useState(null); // 'rebuild' | 'delete'
  const pm = archive.meta.posts;
  const built = Boolean(pm);

  return (
    <>
      <Section title="Your archive" sub={syncWhen(archive)}>
        {archive.sync ? (
          <div className="settings-sync">
            <SyncSteps sync={archive.sync} />
            <div>
              <Button onClick={archive.cancelSync}>Cancel the sync</Button>
            </div>
          </div>
        ) : (
          <>
            <dl className="data-facts">
              <div>
                <dt>Posts</dt>
                <dd className="num">{counts.posts.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>Followers</dt>
                <dd className="num">{counts.followers.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>Repo records</dt>
                <dd className="num">{counts.records.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>Blocked by</dt>
                <dd className="num">{counts.blockedBy.toLocaleString('en-US')}</dd>
              </div>
            </dl>
            {archive.syncError && (
              <div className="callout callout--danger" role="alert">
                <span>
                  <strong>The last sync had problems.</strong> {archive.syncError}
                </span>
              </div>
            )}
            <div className="settings-actions">
              <Button variant="primary" onClick={() => archive.runSync(!pm ? 'full' : pm.complete ? 'incremental' : 'resume')}>
                <RefreshCw size={15} aria-hidden="true" />
                {!pm ? 'Build your archive' : pm.complete ? 'Sync now' : 'Resume the build'}
              </Button>
              {built && (
                <Button onClick={() => setConfirm('rebuild')}>
                  <RotateCcw size={15} aria-hidden="true" />
                  Rebuild posts
                </Button>
              )}
            </div>
            <p className="settings-text muted">
              A sync runs by itself when you open Virga and the archive is more than an hour old. It only fetches what’s new.
            </p>
          </>
        )}
      </Section>

      <Section title="Take it with you">
        <Row label="Everything, as JSON" hint="Posts, followers, blocks, engagement and repo records, as this browser holds them.">
          <Button onClick={() => exportArchive(archive)} disabled={!built}>
            <Download size={15} aria-hidden="true" />
            Export JSON
          </Button>
        </Row>
        <Row label="Your posts, as CSV" hint="Every post with its counts, newest first, for a spreadsheet.">
          <Button onClick={() => exportPosts(archive)} disabled={!built}>
            <Download size={15} aria-hidden="true" />
            Export CSV
          </Button>
        </Row>
      </Section>

      <Section title="Storage in this browser">
        <Row
          label="Kept on this device"
          hint={
            !archive.persistent
              ? archive.blocked
                ? 'Another Virga tab is holding the archive open, so this one lasts the session only. Close that tab and reload to keep it.'
                : 'This browser holds the archive for this session only.'
              : estimate
                ? `Virga is using about ${megabytes(estimate.usage)} here.`
                : 'In IndexedDB, in a database of its own for this account.'
          }
        >
          <span className="badge">
            <HardDrive aria-hidden="true" />
            {archive.persistent ? 'IndexedDB' : 'This session only'}
          </span>
        </Row>
        {navigator.storage?.persist && (
          <Row label="Keep it when space runs low" hint="Asks the browser not to clear the archive to make room. It may say no.">
            {persisted ? (
              <span className="badge badge--accent">Kept</span>
            ) : (
              <Button
                onClick={async () => {
                  const ok = await navigator.storage.persist().catch(() => false);
                  setPersisted(ok);
                  toast?.(ok ? 'The browser will keep the archive.' : 'The browser said no. It may ask again later, or decide by itself.');
                }}
              >
                Ask the browser
              </Button>
            )}
          </Row>
        )}
      </Section>

      <Section title="Delete this archive" tone="danger">
        <Row
          label="Remove everything Virga keeps for this account in this browser"
          hint="Your account, your repo and your followers aren’t touched. The next build reads it all again."
        >
          <Button variant="danger" onClick={() => setConfirm('delete')} disabled={!archive.loaded || Boolean(archive.sync)}>
            <Trash2 size={15} aria-hidden="true" />
            Delete the archive
          </Button>
        </Row>
      </Section>

      <Dialog
        open={confirm === 'rebuild'}
        onClose={() => setConfirm(null)}
        title="Rebuild the post archive?"
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirm(null);
                archive.runSync('full');
              }}
            >
              Rebuild
            </Button>
          </>
        }
      >
        <p>
          Clears the post archive and reads every post again. It’s the only way deleted posts leave, and old posts’ counts fully refresh. It
          takes as long as the first build.
        </p>
      </Dialog>
      <Dialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Delete this browser’s archive?"
        tone="danger"
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirm(null);
                await archive.deleteArchive();
                toast?.('The archive is deleted from this browser.');
                navigate('/');
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p>
          Every post, follower, block, engagement event and repo record Virga holds for this account in this browser goes, along with the
          unfollow log. Your dashboards and settings stay.
        </p>
      </Dialog>
    </>
  );
}

/* ---- dashboards ---------------------------------------------------- */

function DashboardsSection() {
  const actions = useDashboards();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = actions.dashboards;
  return (
    <>
      <Section title="Your dashboards" sub="Each is a set of reports, arranged your way. Open one and press Customize to change it.">
        <ul className="dash-list">
          {list.map((d, i) => (
            <li key={d.id} className="dash-list-item">
              {editing === d.id ? (
                <form
                  className="dash-list-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    actions.renameDashboard(d.id, name);
                    setEditing(null);
                  }}
                >
                  <label className="visually-hidden" htmlFor={`rename-${d.id}`}>
                    Name
                  </label>
                  <input id={`rename-${d.id}`} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
                  <Button type="submit" size="sm" variant="primary">
                    Save
                  </Button>
                  <Button size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <Link to={`/dashboard/${d.id}`} className="dash-list-name">
                    {d.name}
                  </Link>
                  <span className="muted num">
                    {d.widgets.length} {d.widgets.length === 1 ? 'report' : 'reports'}
                  </span>
                  <span className="dash-list-tools">
                    <Button size="sm" variant="ghost" icon aria-label={`Move ${d.name} up`} disabled={i === 0} onClick={() => actions.moveDashboard(d.id, i - 1)}>
                      <ArrowUp size={14} aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" icon aria-label={`Move ${d.name} down`} disabled={i === list.length - 1} onClick={() => actions.moveDashboard(d.id, i + 1)}>
                      <ArrowDown size={14} aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon
                      aria-label={`Rename ${d.name}`}
                      onClick={() => {
                        setEditing(d.id);
                        setName(d.name);
                      }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" icon aria-label={`Delete ${d.name}`} disabled={list.length <= 1} onClick={() => setConfirm(d)}>
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="settings-actions">
          <Button onClick={() => setCreating(true)}>New dashboard</Button>
          <Button variant="ghost" onClick={() => setConfirm('reset')}>
            Reset to the three starting dashboards
          </Button>
        </div>
      </Section>
      <Section title="Where they’re kept">
        <div className="choice-list">
          <label className="choice" data-on>
            <input type="radio" name="layout-store" checked readOnly />
            <span>
              <span className="choice-label">In this browser</span>
              <span className="choice-desc">Like your archive. Another browser starts with the three starting dashboards.</span>
            </span>
          </label>
          <label className="choice is-disabled">
            <input type="radio" name="layout-store" disabled />
            <span>
              <span className="choice-label">
                In your own repo <span className="badge badge--warn">Not yet</span>
              </span>
              <span className="choice-desc">
                As a small record on your PDS, so your dashboards follow you to any browser. It would need permission to write that one
                kind of record, which Virga doesn’t ask for today.
              </span>
            </span>
          </label>
        </div>
      </Section>
      <Dialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm === 'reset' ? 'Reset every dashboard?' : `Delete ${confirm?.name}?`}
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm === 'reset') {
                  actions.resetAll();
                  toast?.('Your dashboards are back to the three starting ones.');
                } else {
                  actions.deleteDashboard(confirm.id);
                }
                setConfirm(null);
              }}
            >
              {confirm === 'reset' ? 'Reset' : 'Delete'}
            </Button>
          </>
        }
      >
        <p>
          {confirm === 'reset'
            ? 'Every dashboard you made goes, and Overview, Growth and Content come back as they started.'
            : 'The dashboard and its arrangement go. The reports and your archive stay.'}
        </p>
      </Dialog>
      <NewDashboardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(n, template) => {
          const id = actions.addDashboard({ name: n, template });
          setCreating(false);
          if (id) navigate(`/dashboard/${id}${template ? '' : '?edit=1'}`);
        }}
      />
    </>
  );
}

/* ---- appearance ---------------------------------------------------- */

function AppearanceSection() {
  const prefs = usePreferences();
  const { setPref } = prefs;
  const themes = [
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
    { key: 'system', label: 'Match system' },
  ];
  return (
    <>
      <Section title="Theme" sub="Charts get their own colours in each, not an inverted copy.">
        <div className="theme-choices" role="radiogroup" aria-label="Theme">
          {themes.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={prefs.theme === t.key}
              className="theme-choice"
              data-theme-preview={t.key}
              onClick={() => setPref('theme', t.key)}
            >
              <span className="theme-preview" aria-hidden="true">
                <span className="theme-preview-side" />
                <span className="theme-preview-main">
                  <span />
                  <span />
                </span>
              </span>
              <span className="theme-choice-label">{t.label}</span>
            </button>
          ))}
        </div>
        <Row label="Density" hint="Compact fits more reports on a screen.">
          <Segmented
            label="Density"
            value={prefs.density}
            onChange={(v) => setPref('density', v)}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Row>
        <Row label="Sidebar" hint="Folded, it’s a rail of icons. The button at its top does the same.">
          <Segmented
            label="Sidebar"
            value={prefs.sidebar}
            onChange={(v) => setPref('sidebar', v)}
            options={[
              { value: 'expanded', label: 'Open' },
              { value: 'collapsed', label: 'Folded' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Live sky">
        <div className="sky-setting">
          <div className="sky-preview" data-on={prefs.sky || undefined} data-time={prefs.skyTime} aria-hidden="true">
            <svg viewBox="0 0 168 104" preserveAspectRatio="none">
              <path d="M18 36a8 8 0 0 1 4-15 11 11 0 0 1 20-3 9 9 0 0 1 16 5 7 7 0 0 1 4 13Z" fill="#fff" fillOpacity="0.85" />
              <path d="M96 30a6 6 0 0 1 3-11 8 8 0 0 1 15-2 7 7 0 0 1 12 4 5 5 0 0 1 3 9Z" fill="#fff" fillOpacity="0.7" />
              <path className="sky-hill-1" d="M0 70C40 52 80 56 110 66S150 76 168 62V104H0Z" />
              <path className="sky-hill-2" d="M0 86C50 74 100 82 130 88S160 90 168 84V104H0Z" />
            </svg>
          </div>
          <div className="sky-setting-text">
            <div className="settings-row-label">Show the live sky behind Virga</div>
            <p className="settings-row-hint">
              The 3D hillside from Virga’s first version: clouds drift, their shadows cross the hill, and the sun comes up once your archive
              is built. It uses WebGL and some battery, and holds still if you’ve asked your device for reduced motion. Cards stay solid in
              front of it so the numbers stay readable.
            </p>
            <p className="settings-row-hint">Off by default. Five taps on the Virga logo turn it on or off from anywhere.</p>
          </div>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={prefs.sky}
            aria-label="Show the live sky"
            onClick={() => setPref('sky', !prefs.sky)}
          />
        </div>
        {prefs.sky && (
          <>
            <Row label="Time of day" hint="Following your archive: dawn until the first build, day after.">
              <Segmented
                label="Time of day"
                value={prefs.skyTime}
                onChange={(v) => setPref('skyTime', v)}
                options={[
                  { value: 'archive', label: 'Follow the archive' },
                  { value: 'day', label: 'Day' },
                  { value: 'dawn', label: 'Dawn' },
                ]}
              />
            </Row>
            <Row label="Where" hint="Reports, tools and settings can keep a plain background.">
              <Segmented
                label="Where the sky shows"
                value={prefs.skyScope}
                onChange={(v) => setPref('skyScope', v)}
                options={[
                  { value: 'dashboard', label: 'Dashboards only' },
                  { value: 'everywhere', label: 'Everywhere' },
                ]}
              />
            </Row>
          </>
        )}
      </Section>
    </>
  );
}

/* ---- permissions --------------------------------------------------- */

function PermissionsSection() {
  return (
    <>
      <Section title="What signing in lets Virga do" sub="It asks for these and nothing else.">
        <ul className="perm-list">
          <li>
            <strong>Know who you are.</strong> <code>atproto</code>
          </li>
          <li>
            <strong>Read your follower list, as you.</strong> Only a signed-in read carries each follower’s follow record, which is what
            dates the growth curve. <code>rpc:app.bsky.graph.getFollowers</code>
          </li>
          <li>
            <strong>Read your notifications.</strong> Who liked, reposted, replied to, quoted and mentioned you.{' '}
            <code>rpc:app.bsky.notification.listNotifications</code>
          </li>
          <li>
            <strong>Follow and unfollow, when you press the button.</strong> Create and delete follow records in your repo, for the Follow
            buttons, Follow cleanup and the Follow-back queue. <code>repo:app.bsky.graph.follow</code>
          </li>
        </ul>
      </Section>
      <Section title="What it can’t do">
        <p className="settings-text">
          It can’t post, like, repost, block, mute, change your profile or read your messages. Everything else it reads is public and fetched
          without your session. Two of the tools listed under Later would need more, and would ask first.
        </p>
      </Section>
    </>
  );
}

/* ---- about --------------------------------------------------------- */

function AboutSection() {
  const archive = useArchive();
  return (
    <>
      <Section title="About Virga">
        <p className="settings-text">
          Analytics for your Bluesky account and the rest of your atproto repo, worked out in your browser from your own data. There is no
          Virga server and no database: everything is read from your PDS, Bluesky’s public API, the PLC directory and Constellation, and
          kept in this browser.
        </p>
      </Section>
      <Section title="Where the data comes from">
        <ul className="perm-list">
          <li>
            <strong>Your PDS</strong>: your whole repo in one download, and your follow records.
          </li>
          <li>
            <strong>Bluesky’s public API</strong>: your posts and their counts, profiles, lists, and when accounts were last active.
          </li>
          <li>
            <strong>Bluesky, signed in as you</strong>: your follower list and your notifications.
          </li>
          <li>
            <strong>Constellation</strong>: who blocks you, and which lists you’re on.
          </li>
          <li>
            <strong>The PLC directory</strong>: your DID document and its history.
          </li>
        </ul>
        {archive.meta.repo?.syncedAt && (
          <p className="settings-text muted">
            Your repo was last read {relativeTime(archive.meta.repo.syncedAt)}, on {formatDateShort(archive.meta.repo.syncedAt)}.
          </p>
        )}
      </Section>
    </>
  );
}
