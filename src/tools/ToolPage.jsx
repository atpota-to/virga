// The tools: small utilities for looking after an account, each saying what
// it can touch. The hub lists them; each has a page of its own.

import Button from '../components/Button.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { followBackModel, followerLogModel, listsModel } from '../reports/models.js';
import { PageHeader } from '../shell/bits.jsx';
import Badge from '../components/AccessBadge.jsx';
import { TOOLS, TOOL_BY_KEY, TOOL_SECTIONS } from './registry.js';
import FollowCleanup from './FollowCleanup.jsx';
import UnfollowTracker from './UnfollowTracker.jsx';
import FollowBack from './FollowBack.jsx';
import BestTime from './BestTime.jsx';
import ListsYoureOn from './ListsYoureOn.jsx';
import ArchiveSearch from './ArchiveSearch.jsx';
import Identity from './Identity.jsx';
import './tools.css';

const PAGES = {
  'follow-cleanup': FollowCleanup,
  'unfollow-tracker': UnfollowTracker,
  'follow-back': FollowBack,
  'best-time': BestTime,
  lists: ListsYoureOn,
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
      actions={
        <>
          <AccessBadge access={tool.access} />
          {actions}
        </>
      }
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
        <div className="card empty-page">
          <h1 className="card-title">{tool ? `${tool.name} isn’t built yet` : 'There’s no tool here'}</h1>
          {tool && <p className="card-sub">{tool.desc}</p>}
          <div>
            <Button onClick={() => navigate('/tools')}>See every tool</Button>
          </div>
        </div>
      </div>
    );
  }
  return <Page tool={tool} />;
}

/** A line of what each tool has to say right now, for its tile. */
function useToolStats(archive) {
  const built = Boolean(archive.meta.posts);
  if (!built) return {};
  const log = followerLogModel(archive);
  const lists = archive.meta.lists ? listsModel(archive) : null;
  const queue = followBackModel(archive, { key: 'all', days: null, label: 'All time' }, archive.nowMs);
  const checked = archive.following.filter((f) => archive.actors.get(f.did)?.activityAt).length;
  return {
    'follow-cleanup': `${archive.following.length.toLocaleString('en-US')} follows${checked ? `, ${checked.toLocaleString('en-US')} checked` : ''}`,
    'unfollow-tracker': log.tracking ? `${log.latestLost.length.toLocaleString('en-US')} at the last sync` : 'Starts at your next sync',
    'follow-back': `${queue.length.toLocaleString('en-US')} waiting`,
    lists: lists ? `${lists.length} lists, ${lists.filter((l) => l.purpose === 'moderation').length} moderation` : 'Read at the next sync',
    archive: `${archive.posts.length.toLocaleString('en-US')} posts`,
    identity: archive.atmosphere.length ? `${new Set(archive.atmosphere.map((r) => r.collection)).size} collections` : '',
  };
}

export function ToolsIndex() {
  const archive = useArchive();
  const stats = useToolStats(archive);
  return (
    <>
      <PageHeader title="Tools" sub="Small utilities for looking after your account. Each says what it can touch." />
      <div className="page-body tools-index">
        {TOOL_SECTIONS.map((section) => (
          <section key={section.key} className="tools-section" aria-labelledby={`tools-${section.key}`}>
            <div className="tools-section-head">
              <h2 id={`tools-${section.key}`} className="card-title">
                {section.title}
              </h2>
              <p className="card-sub">{section.desc}</p>
            </div>
            <div className="tool-grid">
              {TOOLS.filter((t) => t.section === section.key).map((t) => {
                const Icon = t.icon;
                const inner = (
                  <>
                    <span className="tool-tile-top">
                      <span className="tool-tile-icon" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <span className="tool-tile-text">
                        <span className="tool-tile-name">{t.name}</span>
                        <span className="tool-tile-desc">{t.desc}</span>
                      </span>
                    </span>
                    <span className="tool-tile-foot">
                      <AccessBadge access={t.access} />
                      <span className="tool-tile-stat num">{t.planned ? 'Not built yet' : stats[t.key] || ''}</span>
                    </span>
                  </>
                );
                return t.planned ? (
                  <div key={t.key} className="card tool-tile is-planned">
                    {inner}
                  </div>
                ) : (
                  <Link key={t.key} to={`/tools/${t.key}`} className="card tool-tile">
                    {inner}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
