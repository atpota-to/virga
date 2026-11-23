// Settings: the account, the archive and its sync, the dashboards, posting,
// how Virga looks (the sky is picked here, and the live one turned on), what
// the sign-in lets Virga do, and where the data comes from.
//
// Each section is a page of its own. On a desk the sidebar lists them; on a
// phone, where there is no sidebar, /settings is that list.

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Clock, Download, Moon, Pencil, Plus, RefreshCw, RotateCcw, ShieldCheck, Sun, Sunrise, Sunset, Trash2 } from 'lucide-react';
import AccountsSettings from '../accounts/AccountsSettings.jsx';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { MoreMenu } from '../components/Menu.jsx';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { PERMISSION_GROUPS, backendHost } from '../config.js';
import { coversCurrent, readAcceptance } from '../legal/acceptance.js';
import { DOCUMENTS } from '../legal/documents.js';
import LegalDialog from '../legal/LegalDialog.jsx';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { exportArchive, exportPosts } from '../archive/exports.js';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import NewDashboardDialog from '../dashboards/NewDashboardDialog.jsx';
import PostingSettingsSection from '../posting/PostingSettingsSection.jsx';
import { ACCENT_CHOICES, SKY_CHOICES, usePreferences } from '../lib/preferences.jsx';
import { radioKeyTarget } from './radioKeys.js';
import { Link, navigate } from '../lib/router.jsx';
import { formatDateShort, relativeTime } from '../lib/time.js';
import { PageHeader, useIsNarrow, useToast } from '../shell/bits.jsx';
import { SyncSteps, syncWhen, useArchiveCounts } from '../shell/SyncStatus.jsx';
import './settings.css';
import { LOCALE_CHOICES, activeLocale, localeSample, regionWeekStart, systemLocale } from '../lib/locale.js';

import { SECTIONS } from './sections.js';

export { SECTIONS };

// `profile` and `onSignOut` are still passed by the shell; the account
// section reads every account from the session itself.
export default function SettingsPage({ section }) {
  const narrow = useIsNarrow();
  const named = SECTIONS.find((s) => s.key === section);
  // On a phone the bare address is the list of sections. On a desk the
  // sidebar is that list, so the bare address opens the first of them.
  if (narrow && !named) return <SettingsIndex />;
  const current = named || SECTIONS[0];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Settings', to: '/settings' }]} title={current.label} sub={current.desc} />
      <div className="page-body settings-body">
        {current.key === 'account' && <AccountsSettings />}
        {current.key === 'data' && <DataSection />}
        {current.key === 'dashboards' && <DashboardsSection />}
        {current.key === 'posting' && <PostingSettingsSection />}
        {current.key === 'appearance' && <AppearanceSection />}
        {current.key === 'permissions' && <PermissionsSection />}
        {current.key === 'about' && <AboutSection />}
      </div>
    </>
  );
}

/** The sections as a list, for a phone: each a row to press, with its line under it. */
function SettingsIndex() {
  return (
    <>
      <PageHeader title="Settings" sub="For whoever is using this device, and for the account that’s open." />
      <div className="page-body settings-body">
        <ul className="settings-index">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <Link to={`/settings/${s.key}`} className="settings-index-item">
                <span className="settings-index-text">
                  <span className="settings-index-label">{s.label}</span>
                  <span className="settings-index-desc">{s.desc}</span>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * A band of a settings page: a heading with a rule in ink under it, then
 * its rows. Without a title it is the rows alone, under the rule. `action`
 * is what adds to the band's list (New dashboard), at the heading's right.
 */
function Section({ title = null, sub = null, action = null, children, tone = null }) {
  return (
    <section className="settings-section" data-tone={tone || undefined}>
      {title && (
        <div className="settings-section-head card-head">
          <div>
            <h2 className="card-title">{title}</h2>
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

/**
 * One setting: what it is and a line about it at the left, its control at
 * the right, on the label's first line. A `block` row puts its control on a
 * line of its own under them (tiles, two selects). A row with nothing to
 * press is the words alone.
 */
function Row({ label, hint = null, labelId = undefined, block = false, children = null }) {
  return (
    <div className={block ? 'settings-row settings-row--block' : 'settings-row'}>
      <div className="settings-row-text">
        <div className="settings-row-label" id={labelId}>
          {label}
        </div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
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

/** "1,031 posts" or "1 post", in the reader's way of writing numbers. */
function counted(n, one, many) {
  return `${n.toLocaleString(activeLocale())} ${n === 1 ? one : many}`;
}

/**
 * What the archive holds and how fresh it is, in a line: "1,031 posts,
 * 9,732 repo records and 4,810 followers that can be listed · synced 4m
 * ago". The followers are the ones a signed-in read can list, which can be
 * fewer than the count on the profile. Before the first build, only when.
 */
function archiveLine(archive, counts) {
  const when = syncWhen(archive);
  if (!archive.meta.posts) return when;
  const held = `${counted(counts.posts, 'post', 'posts')}, ${counted(counts.records, 'repo record', 'repo records')} and ${counted(counts.followers, 'follower', 'followers')} that can be listed`;
  // The dot is spaced as a meta line's, and goes with the words before it
  // when the line breaks there.
  return (
    <>
      {held}
      <span className="settings-dot">·</span>
      <wbr />
      <span className="settings-when">{when.charAt(0).toLowerCase() + when.slice(1)}</span>
    </>
  );
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
      <Section title="Your archive" sub={archiveLine(archive, counts)}>
        {archive.sync ? (
          <div className="settings-sync">
            <SyncSteps sync={archive.sync} />
            <div>
              <Button onClick={archive.cancelSync}>Cancel the sync</Button>
            </div>
          </div>
        ) : (
          <>
            {archive.syncError && (
              <div className="callout callout--danger" role="alert">
                <span>
                  <strong>The last sync had problems.</strong> {archive.syncError}
                </span>
              </div>
            )}
            <Row
              label={!pm ? 'Build' : pm.complete ? 'Sync' : 'Finish the build'}
              hint="A sync runs by itself when you open Virga and the archive is more than an hour old. It only fetches what’s new."
            >
              <Button onClick={() => archive.runSync(!pm ? 'full' : pm.complete ? 'incremental' : 'resume')}>
                <RefreshCw size={15} aria-hidden="true" />
                {!pm ? 'Build your archive' : pm.complete ? 'Sync now' : 'Resume the build'}
              </Button>
            </Row>
            {built && (
              <Row label="Rebuild" hint="Clears the post archive and reads every post again. It’s the only way deleted posts leave, and old posts’ counts fully refresh.">
                <Button onClick={() => setConfirm('rebuild')}>
                  <RotateCcw size={15} aria-hidden="true" />
                  Rebuild posts
                </Button>
              </Row>
            )}
          </>
        )}
      </Section>

      <Section title="Take it with you">
        <Row label="Everything, as JSON" hint="Posts, followers, blocks, engagement and repo records, as this device holds them.">
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

      <Section title="Storage on this device">
        <Row
          label="Kept on this device"
          hint={
            !archive.persistent
              ? archive.blocked
                ? 'Another Virga tab is holding the archive open, so this one lasts the session only. Close that tab and reload to keep it.'
                : 'The archive is held for this session only.'
              : estimate
                ? `Virga is using about ${megabytes(estimate.usage)} here, for every account signed in on this device.`
                : 'In a database of its own for this account, on this device.'
          }
        >
          {/* Only the case to find is marked; kept, the line says where. */}
          {!archive.persistent && <span className="badge badge--warn">This session only</span>}
        </Row>
        {navigator.storage?.persist && (
          <Row label="Keep it when space runs low" hint="Asks the browser not to clear the archive to make room. It may say no.">
            {persisted ? (
              <span className="settings-row-state">Kept</span>
            ) : (
              <Button
                onClick={async () => {
                  const ok = await navigator.storage.persist().catch(() => false);
                  setPersisted(ok);
                  toast?.(ok ? 'The browser will keep the archive.' : 'The browser said no. It may ask again later, or decide by itself.');
                }}
              >
                <ShieldCheck size={15} aria-hidden="true" />
                Ask the browser
              </Button>
            )}
          </Row>
        )}
      </Section>

      <Section title="Delete this archive" tone="danger">
        <Row
          label="Everything Virga keeps for this account here"
          hint="Your account, your repo and your followers aren’t touched. The next build reads it all again."
        >
          <Button className="is-danger" onClick={() => setConfirm('delete')} disabled={!archive.loaded || Boolean(archive.sync)}>
            <Trash2 size={15} aria-hidden="true" />
            Delete the archive…
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
        title="Delete the archive on this device?"
        tone="danger"
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirm(null);
                await archive.deleteArchive();
                toast?.('The archive is deleted from this device.');
                navigate('/');
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p>
          Every post, follower, block, engagement event and repo record Virga holds for this account on this device goes, along with the
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
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = actions.dashboards;
  // A row that moves, or goes, takes the focus on its ⋯ with it: the
  // moved row's own, or the row that takes a deleted one's place.
  const listRef = useRef(null);
  const [refocus, setRefocus] = useState(null);
  useEffect(() => {
    if (refocus == null) return;
    const rows = [...(listRef.current?.children || [])];
    const row = typeof refocus === 'number' ? rows[Math.min(refocus, rows.length - 1)] : rows.find((r) => r.dataset.id === refocus);
    row?.querySelector('.menu-button')?.focus();
    setRefocus(null);
  }, [list, refocus]);
  const move = (d, to) => {
    actions.moveDashboard(d.id, to);
    setRefocus(d.id);
  };
  const rename = (e) => {
    e.preventDefault();
    actions.renameDashboard(renaming.id, name);
    setRenaming(null);
  };
  return (
    <>
      <Section
        title="Your dashboards"
        sub="Each is a set of reports, arranged your way. Open one and press Customize to change it."
        action={
          <button type="button" className="link-action" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            New dashboard
          </button>
        }
      >
        <ul className="dash-list" ref={listRef}>
          {list.map((d, i) => (
            <li key={d.id} className="dash-list-item" data-id={d.id}>
              <span className="dash-list-text">
                <Link to={`/dashboard/${d.id}`} className="dash-list-name">
                  {d.name}
                </Link>
                <span className="dash-list-count num">
                  {d.widgets.length} {d.widgets.length === 1 ? 'report' : 'reports'}
                </span>
              </span>
              <div className="row-actions">
                <MoreMenu
                  className="row-menu"
                  label={`More for ${d.name}`}
                  items={[
                    {
                      label: 'Rename…',
                      icon: Pencil,
                      onSelect: () => {
                        setName(d.name);
                        setRenaming(d);
                      },
                    },
                    i > 0 && { label: 'Move up', icon: ArrowUp, onSelect: () => move(d, i - 1) },
                    i < list.length - 1 && { label: 'Move down', icon: ArrowDown, onSelect: () => move(d, i + 1) },
                    // The last dashboard can't go: the app always opens on one.
                    list.length > 1 && { separator: true },
                    list.length > 1 && { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => setConfirm(d) },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
        <div className="card-foot">
          <button type="button" className="link-action" onClick={() => setConfirm('reset')}>
            <RotateCcw size={14} aria-hidden="true" />
            Reset to the three starting dashboards
          </button>
        </div>
      </Section>
      <Section title="Where they’re kept">
        <p className="settings-text">Kept on this device, like your archive. Another device or browser starts with the three starting dashboards.</p>
      </Section>
      <Dialog
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Rename dashboard"
        actions={
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" type="submit" form="rename-dashboard-form">
              Save
            </Button>
          </>
        }
      >
        <form id="rename-dashboard-form" className="dialog-form" onSubmit={rename}>
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} data-autofocus />
          </label>
        </form>
      </Dialog>
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
                  setRefocus(list.findIndex((d) => d.id === confirm.id));
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

const WEEK_START_NAMES = { 0: 'Sunday', 1: 'Monday', 6: 'Saturday' };

/** "Germany" for 'en-DE'; the tag itself where the browser can't name it. */
function regionName(tag) {
  try {
    const region = new Intl.Locale(tag).region;
    return (region && new Intl.DisplayNames(['en'], { type: 'region' }).of(region)) || tag;
  } catch {
    return tag;
  }
}

const SKY_NAMES = { clock: 'Follows the clock', dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };
const SKY_ICONS = { clock: Clock, dawn: Sunrise, day: Sun, dusk: Sunset, night: Moon };
const SKIES = SKY_CHOICES.map((key) => ({ key, label: SKY_NAMES[key] }));

const ACCENT_NAMES = { blue: 'Blue', violet: 'Violet', teal: 'Teal', amber: 'Amber', rose: 'Rose', graphite: 'Graphite' };
const ACCENTS = ACCENT_CHOICES.map((key) => ({ key, label: ACCENT_NAMES[key] }));

/**
 * A radio group drawn as buttons. One tab stop, on the chosen one; the
 * arrows move between the choices and choose as they go (radioKeys.js), as
 * in a native group. `children(choice, radio)` draws one button and spreads
 * `radio` onto it.
 */
function RadioButtons({ className, label = undefined, labelledBy = undefined, choices, value, onChange, children }) {
  const chosen = choices.findIndex((c) => c.key === value);
  const onKeyDown = (event) => {
    const target = radioKeyTarget(event.key, chosen, choices.length);
    if (target === null) return;
    event.preventDefault();
    onChange(choices[target].key);
    event.currentTarget.querySelectorAll('[role="radio"]')[target]?.focus();
  };
  return (
    <div className={className} role="radiogroup" aria-label={label} aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {choices.map((choice, i) =>
        children(choice, {
          type: 'button',
          role: 'radio',
          'aria-checked': i === chosen,
          tabIndex: i === Math.max(chosen, 0) ? 0 : -1,
          onClick: () => onChange(choice.key),
        }),
      )}
    </div>
  );
}

function AppearanceSection() {
  const prefs = usePreferences();
  // A phone or a tablet has no sidebar to fold.
  const narrow = useIsNarrow();
  const { setPref } = prefs;
  // What the clock comes to at the moment, said under its tile.
  const now = SKY_NAMES[prefs.effectiveSky];
  return (
    <Section>
      <Row
        block
        labelId="sky-label"
        label="Sky"
        hint="The sky behind every page. Let it follow the clock, or keep it where you leave it. Night is also the dark theme, and a device set to dark stays on it."
      >
        <RadioButtons className="sky-choices" labelledBy="sky-label" choices={SKIES} value={prefs.sky} onChange={(v) => setPref('sky', v)}>
          {(sky, radio) => {
            const Icon = SKY_ICONS[sky.key];
            return (
              <button key={sky.key} {...radio} className="sky-choice" data-sky-choice={sky.key}>
                <span className="sky-choice-swatch" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="sky-choice-text">
                  <span className="sky-choice-label">{sky.label}</span>
                  {sky.key === 'clock' && prefs.sky === 'clock' && (
                    <span className="sky-choice-now">{prefs.systemDark ? 'Night, as your device asks' : `${now} now`}</span>
                  )}
                </span>
              </button>
            );
          }}
        </RadioButtons>
      </Row>
      <Row
        block
        labelId="accent-label"
        label="Accent"
        hint="The colour of your data, and of whatever is selected. Each pair is checked for contrast and for colour-blind eyes, under every sky."
      >
        <RadioButtons className="accent-choices" labelledBy="accent-label" choices={ACCENTS} value={prefs.accent} onChange={(v) => setPref('accent', v)}>
          {(a, radio) => (
            // data-accent makes this button a swatch (theme.css): inside it, the accent tokens are this accent's.
            <button key={a.key} {...radio} className="accent-choice" data-accent={a.key}>
              <span className="accent-swatch" aria-hidden="true" />
              <span className="accent-choice-label">{a.label}</span>
            </button>
          )}
        </RadioButtons>
      </Row>
      <Row
        label="Contrast"
        hint="High darkens the words and the rules, takes the sky away and thickens the focus ring. Match system follows your device’s own setting."
      >
        <Segmented
          label="Contrast"
          value={prefs.contrast}
          onChange={(v) => setPref('contrast', v)}
          options={[
            { value: 'system', label: 'Match system' },
            { value: 'normal', label: 'Standard' },
            { value: 'high', label: 'High' },
          ]}
        />
      </Row>
      <Row label="Density" hint="Compact fits more on a screen.">
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
      {!narrow && (
        <Row label="Sidebar" hint="Folded, it’s a rail of icons, which gives the page more room. The button at its top does the same.">
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
      )}
      <Row
        block
        label="Numbers and dates"
        hint={
          <>
            Virga’s words are English. These choose how its figures, dates and times are written, and the day a week starts on.
            <span className="settings-row-sample">{localeSample(activeLocale())}</span>
          </>
        }
      >
        <select className="input" aria-label="Number and date format" value={prefs.locale} onChange={(e) => setPref('locale', e.target.value)}>
          <option value="system">This device’s region ({regionName(systemLocale())})</option>
          {LOCALE_CHOICES.map((tag) => (
            <option key={tag} value={tag}>
              {regionName(tag)}: {localeSample(tag)}
            </option>
          ))}
        </select>
        {/* A select, not a row of keys: four keys with a day's name in each don't fit a phone. */}
        <select className="input" aria-label="Week starts on" value={prefs.weekStart} onChange={(e) => setPref('weekStart', e.target.value)}>
          <option value="system">Week starts as in this region ({WEEK_START_NAMES[regionWeekStart(activeLocale())]})</option>
          <option value="monday">Week starts Monday</option>
          <option value="sunday">Week starts Sunday</option>
          <option value="saturday">Week starts Saturday</option>
        </select>
      </Row>
      <Row
        label="Live sky"
        hint="Clouds that drift across the sky at the top of the page: the 3D scene from Virga’s first version. It uses WebGL and some battery, holds still if you’ve asked your device for reduced motion, and is left out in high contrast. Five taps on the Virga mark turn it on or off from anywhere."
      >
        <button type="button" role="switch" className="switch" aria-checked={prefs.liveSky} aria-label="Show the live sky" onClick={() => setPref('liveSky', !prefs.liveSky)} />
      </Row>
    </Section>
  );
}

/* ---- permissions --------------------------------------------------- */

function PermissionsSection() {
  return (
    <>
      <Section title="What signing in lets Virga do" sub="It asks for these and nothing else.">
        <ul className="perm-list">
          {PERMISSION_GROUPS.map((group) => (
            <li key={group.key}>
              <strong>{group.title}</strong> {group.text}
              {/* The resource and its name, on a line of their own; the full
                  strings, audiences and all, are in src/config.js and the README. */}
              <span className="perm-codes">
                {group.tokens.map((token, i) => (
                  <span key={token}>
                    {i > 0 && ' '}
                    <code>{token.split('?')[0]}</code>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="What it can’t do">
        <p className="settings-text">
          It can’t like, repost, block or mute anyone, change your profile, or read your messages. It posts, replies and deletes posts only
          when you ask it to, and never edits a post once it’s published. With Defense’s lists on, it adds people to a list you made only
          when you approve them, and never anyone you follow. Everything else it reads is public and fetched without your session.
        </p>
      </Section>
      <Section title="Where the sign-in is kept">
        <p className="settings-text">
          A browser session stays in the browser and goes straight to your account’s server. A long session is held by Virga’s server at{' '}
          {backendHost()}, which makes the same requests on your behalf, and is what lets a scheduled post go out while Virga is closed.
          Virga’s server is used only for long sessions and the features that need one, and for the record that an account agreed to the
          terms, which either kind of session sends it; your archive never goes there. Settings ›{' '}
          <Link to="/settings/account">Account</Link> says which kind each account has.
        </p>
      </Section>
    </>
  );
}

/* ---- about --------------------------------------------------------- */

/** When this browser noted that the account agreed to the current documents, or null. */
function agreementNote(did) {
  try {
    const entry = readAcceptance(typeof localStorage === 'undefined' ? null : localStorage, did);
    return coversCurrent(entry) ? entry : null;
  } catch {
    return null;
  }
}

function AboutSection() {
  const archive = useArchive();
  const { did } = useAtprotoSession();
  const agreed = agreementNote(did);
  // Read in place: going to the document's own page would take the app, and
  // a sync that is running, down with it.
  const [reading, setReading] = useState(null);
  return (
    <>
      <Section title="About Virga">
        <p className="settings-text">
          Analytics for your Bluesky account and the rest of your atproto repo, worked out on your device from your own data, and a place to
          write and schedule posts. The archive is read from your PDS, Bluesky’s public API, the PLC directory and Constellation, and kept on
          this device; it is never sent to Virga’s server. That server and its database are used only for long sessions, for the features
          that run while Virga is closed, and for the record that an account agreed to the terms.
        </p>
      </Section>
      <Section title="Terms and privacy" sub="What you agreed to when this account signed in, and what Virga does with information about you.">
        {/* Each opens in place, like a row of the settings list leads to its page. */}
        {Object.values(DOCUMENTS).map((doc) => (
          <button key={doc.key} type="button" className="settings-index-item" onClick={() => setReading(doc.key)} aria-haspopup="dialog">
            <span className="settings-index-text">
              <span className="settings-index-label">{doc.title}</span>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ))}
        {agreed && (
          <p className="card-caption">
            This account agreed to version {agreed.version} of both{agreed.at ? ` on ${formatDateShort(agreed.at)}` : ''}.
          </p>
        )}
      </Section>
      {/* Outside the section: everything inside one is set as a row of it. */}
      <LegalDialog docKey={reading} onClose={() => setReading(null)} />
      <Section title="Where the data comes from">
        <ul className="perm-list">
          <li>
            <strong>Your PDS</strong>: your whole repo in one download, and your follow records.
          </li>
          <li>
            <strong>Bluesky’s public API</strong>: your posts and their counts, profiles, lists, and when accounts were last active.
          </li>
          <li>
            <strong>Bluesky, signed in as you</strong>: your follower list and your notifications, and what you post.
          </li>
          <li>
            <strong>Virga’s server ({backendHost()})</strong>, for an account with a long session: the sign-in, and the signed-in requests,
            which it passes on to your account. Scheduled posts and post timers are kept there, and stay on record after they run; a
            scheduled post’s pictures are deleted once it goes out.
          </li>
          <li>
            <strong>Bluesky’s link card service (cardyb.bsky.app)</strong>, while you write a post with a link: the page’s title,
            description and picture, for the card under the post.
          </li>
          <li>
            <strong>Bluesky’s video service (video.bsky.app)</strong>, when you post a video: the video, which it processes before the
            post goes out.
          </li>
          <li>
            <strong>The post adviser and alt text</strong>, only when you turn them on or ask: the post (or the image) goes to Virga’s
            server, which passes it to an AI model and sends back what it made of it.
          </li>
          <li>
            <strong>Constellation</strong>: who blocks you, and which lists you’re on.
          </li>
          <li>
            <strong>Signing in</strong>: the handle you type goes to Bluesky’s public API, to suggest accounts and to find yours. Where the
            account signs in is read from the PLC directory and its own server. The Privacy Policy lists every lookup a sign-in makes.
          </li>
          <li>
            <strong>The PLC directory</strong>: your DID document and its history.
          </li>
        </ul>
        {archive.meta.repo?.syncedAt && (
          <p className="card-caption">
            Your repo was last read {relativeTime(archive.meta.repo.syncedAt)}, on {formatDateShort(archive.meta.repo.syncedAt)}.
          </p>
        )}
      </Section>
    </>
  );
}
