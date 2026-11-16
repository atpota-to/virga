// The tools: small utilities for looking after an account, each saying what
// it can touch. The Tools page lists them, a row each under the heading of
// its kind; each has a page of its own.

import { ChevronRight } from 'lucide-react';
import Button from '../components/Button.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { followBackModel, followerLogModel, listsModel } from '../reports/models.js';
import { PageHeader } from '../shell/bits.jsx';
import Badge from '../components/AccessBadge.jsx';
import { ACCESS, TOOLS, TOOL_BY_KEY, TOOL_SECTIONS } from './registry.js';
import FollowCleanup from './FollowCleanup.jsx';
import UnfollowTracker from './UnfollowTracker.jsx';
import FollowBack from './FollowBack.jsx';
import BestTime from './BestTime.jsx';
import ListsYoureOn from './ListsYoureOn.jsx';
import ArchiveSearch from './ArchiveSearch.jsx';
import Identity from './Identity.jsx';
import InteractionLookup from './InteractionLookup.jsx';
import { interactionIndex } from './interactionModel.js';
import './tools.css';
import { activeLocale } from '../lib/locale.js';

const PAGES = {
  'follow-cleanup': FollowCleanup,
  'unfollow-tracker': UnfollowTracker,
  'follow-back': FollowBack,
  'best-time': BestTime,
  lists: ListsYoureOn,
  'interaction-lookup': InteractionLookup,
  archive: ArchiveSearch,
  identity: Identity,
};

export function AccessBadge({ access }) {
  return <Badge kind={access} />;
}

/** The header every tool page shares: where it is, what it does, what it touches. */
export function ToolHeader({ tool, actions = null, sub = null, children = null }) {
  return (
    <PageHeader
      crumbs={[{ label: 'Tools', to: '/tools' }]}
      title={tool.name}
      sub={sub || tool.desc}
      badges={<AccessBadge access={tool.access} />}
      actions={actions}
    >
      {children}
    </PageHeader>
  );
}

export default function ToolPage({ toolKey }) {
  const tool = TOOL_BY_KEY[toolKey];
  const Page = PAGES[toolKey];
  if (!tool || !Page) {
    return (
      <div className="page-body">
        <div className="empty-page">
          <h1 className="page-title">{tool ? `${tool.name} isn’t built yet` : 'There’s no tool here'}</h1>
          {tool && <p className="page-sub">{tool.desc}</p>}
          <div>
            <Button onClick={() => navigate('/tools')}>See every tool</Button>
          </div>
        </div>
      </div>
    );
  }
  return <Page tool={tool} />;
}

/** A line of what each tool has to say right now, for its row. */
function useToolStats(archive) {
  const built = Boolean(archive.meta.posts);
  if (!built) return {};
  const log = followerLogModel(archive);
  const lists = archive.meta.lists ? listsModel(archive) : null;
  const queue = followBackModel(archive, { key: 'all', days: null, label: 'All time' }, archive.nowMs);
  const checked = archive.following.filter((f) => archive.actors.get(f.did)?.activityAt).length;
  const met = interactionIndex(archive).ranked.length;
  return {
    'follow-cleanup': `${archive.following.length.toLocaleString(activeLocale())} follows${checked ? `, ${checked.toLocaleString(activeLocale())} checked` : ''}`,
    'unfollow-tracker': log.tracking ? `${log.latestLost.length.toLocaleString(activeLocale())} at the last sync` : 'Starts at your next sync',
    'follow-back': `${queue.length.toLocaleString(activeLocale())} waiting`,
    lists: lists ? `${lists.length} lists, ${lists.filter((l) => l.purpose === 'moderation').length} moderation` : 'Read at the next sync',
    'interaction-lookup': `${met.toLocaleString(activeLocale())} ${met === 1 ? 'account' : 'accounts'} on record`,
    archive: `${archive.posts.length.toLocaleString(activeLocale())} posts`,
    identity: archive.atmosphere.length ? `${new Set(archive.atmosphere.map((r) => r.collection)).size} collections` : '',
  };
}

/**
 * What a tool can touch, as a quiet line under its description: the same
 * words as the badge in its own header, without the pill.
 */
function AccessLine({ tool }) {
  const access = ACCESS[tool.access];
  if (!access) return null;
  const Icon = access.icon;
  return (
    <span className="tool-row-access" data-access={tool.access}>
      <Icon size={13} aria-hidden="true" />
      {tool.planned ? `Not built yet. ${access.label}` : access.label}
    </span>
  );
}

export function ToolsIndex() {
  const archive = useArchive();
  const stats = useToolStats(archive);
  return (
    <>
      <PageHeader title="Tools" sub="Small tools for looking after your account. Each says what it can touch before it touches it." />
      <div className="page-body">
        <div className="tools-sections">
          {TOOL_SECTIONS.map((section) => (
            <section key={section.key} className="tools-section" aria-labelledby={`tools-${section.key}`}>
              <div className="tools-section-head">
                <h2 id={`tools-${section.key}`} className="card-title">
                  {section.title}
                </h2>
                <p className="card-sub">{section.desc}</p>
              </div>
              <ul className="tool-list">
                {TOOLS.filter((t) => t.section === section.key).map((t) => {
                  const Icon = t.icon;
                  const inner = (
                    <>
                      <span className="tool-row-icon" aria-hidden="true">
                        <Icon size={20} />
                      </span>
                      <span className="tool-row-text">
                        <span className="tool-row-name">{t.name}</span>
                        <span className="tool-row-desc">{t.desc}</span>
                        <span className="tool-row-meta">
                          <AccessLine tool={t} />
                          {!t.planned && stats[t.key] && <span className="tool-row-stat num">{stats[t.key]}</span>}
                        </span>
                      </span>
                      {!t.planned && (
                        <span className="tool-row-go" aria-hidden="true">
                          <ChevronRight size={16} />
                        </span>
                      )}
                    </>
                  );
                  return (
                    <li key={t.key}>
                      {t.planned ? (
                        <div className="tool-row is-planned">{inner}</div>
                      ) : (
                        <Link to={`/tools/${t.key}`} className="tool-row">
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
