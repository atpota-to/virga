// Every list that includes you: moderation lists (whose subscribers block or
// mute everyone on them) flagged, with how many subscribe, and the curation
// lists that are simply someone's reading list.

import { useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import Button from '../components/Button.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportRows } from '../archive/exports.js';
import { formatDateShort } from '../lib/time.js';
import { cardFor, useWantActors } from '../people/people.jsx';
import { listsModel } from '../reports/models.js';
import { ToolHeader } from './ToolPage.jsx';
import { activeLocale } from '../lib/locale.js';

/** A list's kind, as a word: "moderation" is said a step louder (tools.css). */
const KIND_WORD = { moderation: 'Moderation', curation: 'Curation', reference: 'Reference' };

function listUrl(list, ownerHandle) {
  const rkey = String(list.uri).split('/').pop();
  return `https://bsky.app/profile/${encodeURIComponent(ownerHandle || list.owner)}/lists/${encodeURIComponent(rkey)}`;
}

export default function ListsYoureOn({ tool }) {
  const archive = useArchive();
  const [filter, setFilter] = useState('all');
  const lists = archive.meta.lists ? listsModel(archive) : [];
  useWantActors(archive, lists.map((l) => l.owner));
  const mod = lists.filter((l) => l.purpose === 'moderation');
  const shown = filter === 'all' ? lists : lists.filter((l) => (filter === 'moderation' ? l.purpose === 'moderation' : l.purpose !== 'moderation'));
  const subs = mod.reduce((s, l) => s + (l.subscribers || 0), 0);
  const fmt = (n) => n.toLocaleString(activeLocale());
  const syncing = Boolean(archive.sync);

  // Three counts that are also the filter, as on Follow cleanup.
  const FILTERS = [
    { key: 'all', label: 'Every list', count: lists.length },
    {
      key: 'moderation',
      label: 'Moderation lists',
      count: mod.length,
      hint: mod.length ? `Their ${fmt(subs)} ${subs === 1 ? 'subscriber blocks or mutes' : 'subscribers block or mute'} you` : 'Their subscribers block or mute you',
    },
    { key: 'curation', label: 'Curation lists', count: lists.length - mod.length, hint: 'Reading lists, feeds and starter packs' },
  ];

  const exportLists = () =>
    exportRows(archive, 'lists', [
      ['uri', 'name', 'purpose', 'owner', 'owner_handle', 'subscribers', 'added_at'],
      ...lists.map((l) => [l.uri, l.name, l.purpose, l.owner, cardFor(archive, l.owner)?.handle || '', l.subscribers ?? '', l.memberAt || '']),
    ]);

  return (
    <>
      <ToolHeader tool={tool} />
      <div className="page-body">
        {!archive.meta.lists ? (
          <div className="empty-block">
            <p className="empty">Lists are read at the next sync, along with blocks.</p>
            <Button disabled={syncing} onClick={() => archive.runSync(archive.meta.posts?.complete ? 'incremental' : 'resume')}>
              <RefreshCw size={15} aria-hidden="true" />
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
        ) : !lists.length ? (
          <div className="empty-block">
            <p className="empty">No lists here.</p>
          </div>
        ) : (
          <>
            <div className="filter-cards" role="group" aria-label="Which lists">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" className="filter-card" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                  <span className="filter-card-label">{f.label}</span>
                  <span className="filter-card-count num">{fmt(f.count)}</span>
                  {f.hint && <span className="filter-card-hint">{f.hint}</span>}
                </button>
              ))}
            </div>
            <section className="card" aria-labelledby="lists-title">
              <div className="card-head">
                <div>
                  <h2 id="lists-title" className="card-title num">
                    {fmt(shown.length)} {shown.length === 1 ? 'list' : 'lists'}
                  </h2>
                </div>
                <button type="button" className="link-action" onClick={exportLists}>
                  <Download size={14} aria-hidden="true" />
                  Export
                </button>
              </div>
              {/* Set as blocks on a phone (tools.css); the roles keep it a table for a screen reader. */}
              <div className="table-scroll">
                <table className="table table--stack lists-table" role="table">
                  <thead role="rowgroup">
                    <tr role="row">
                      <th scope="col" role="columnheader">
                        List
                      </th>
                      <th scope="col" role="columnheader">
                        Made by
                      </th>
                      <th scope="col" role="columnheader">
                        Kind
                      </th>
                      <th scope="col" role="columnheader" className="is-num">
                        Subscribers
                      </th>
                      <th scope="col" role="columnheader">
                        You were added
                      </th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {shown.map((l) => {
                      const owner = cardFor(archive, l.owner);
                      const counted = l.purpose === 'moderation' && l.subscribers != null;
                      return (
                        <tr key={l.uri} role="row">
                          <td role="cell" className="col-main">
                            <a href={listUrl(l, owner?.handle)} target="_blank" rel="noopener noreferrer" className="table-link">
                              {l.name || 'Untitled list'}
                              <ExternalLink size={12} aria-hidden="true" />
                            </a>
                          </td>
                          {/* On a phone these run on under the name as one meta line
                              (tools.css), with the words their column heads would
                              have said. An owner whose name hasn't been read says
                              so, with the DID to hand; a phone leaves it out. */}
                          <td role="cell" className="lists-owner" data-empty={owner?.handle ? undefined : ''}>
                            <span className="stack-word">by </span>
                            {owner?.handle ? (
                              `@${owner.handle}`
                            ) : (
                              <span className="muted" title={l.owner}>
                                Unknown account
                              </span>
                            )}
                          </td>
                          <td role="cell" className="col-kind">
                            <span className="lists-kind" data-purpose={l.purpose}>
                              {KIND_WORD[l.purpose] || l.purpose}
                            </span>
                          </td>
                          <td role="cell" className="is-num lists-subs" data-empty={counted ? undefined : ''}>
                            {counted ? fmt(l.subscribers) : '—'}
                            <span className="stack-word"> {l.subscribers === 1 ? 'subscriber' : 'subscribers'}</span>
                          </td>
                          <td role="cell" className="num lists-added" data-empty={l.memberAt ? undefined : ''}>
                            <span className="stack-word">added </span>
                            {l.memberAt ? formatDateShort(l.memberAt) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!shown.length && <p className="empty">No lists here.</p>}
              </div>
              <p className="card-caption">
                Found through Constellation, then read from Bluesky’s public API. Subscribers are counted for moderation lists only.
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
