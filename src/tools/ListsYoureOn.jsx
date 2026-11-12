// Every list that includes you: moderation lists (whose subscribers block or
// mute everyone on them) flagged, with how many subscribe, and the curation
// lists that are simply someone's reading list.

import { useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import Button from '../components/Button.jsx';
import Figures from '../components/Figures.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportRows } from '../archive/exports.js';
import { formatDateShort } from '../lib/time.js';
import { cardFor, useWantActors } from '../people/people.jsx';
import { listsModel } from '../reports/models.js';
import { ToolHeader } from './ToolPage.jsx';

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

  return (
    <>
      <ToolHeader
        tool={tool}
        actions={
          lists.length > 0 && (
            <Button
              onClick={() =>
                exportRows(archive, 'lists', [
                  ['uri', 'name', 'purpose', 'owner', 'owner_handle', 'subscribers', 'added_at'],
                  ...lists.map((l) => [l.uri, l.name, l.purpose, l.owner, cardFor(archive, l.owner)?.handle || '', l.subscribers ?? '', l.memberAt || '']),
                ])
              }
            >
              <Download size={15} aria-hidden="true" />
              Export
            </Button>
          )
        }
      />
      <div className="page-body">
        {!archive.meta.lists ? (
          <p className="card empty">Lists are read at the next sync, along with blocks.</p>
        ) : (
          <>
            <Figures
              label="Lists in figures"
              items={[
                { key: 'all', label: 'Lists you’re on', value: lists.length },
                { key: 'mod', label: 'Moderation lists', value: mod.length, note: 'Their subscribers block or mute you' },
                { key: 'subs', label: 'Subscribers to them', value: subs, note: 'Counted once per list' },
                { key: 'cur', label: 'Curation lists', value: lists.length - mod.length, note: 'Reading lists, feeds and starter packs' },
              ]}
            />
            <section className="card card--flush table-card" aria-label="The lists">
              <div className="table-bar">
                <div className="library-cats" role="group" aria-label="Show">
                  {[
                    ['all', 'All'],
                    ['moderation', 'Moderation'],
                    ['curation', 'Curation'],
                  ].map(([k, label]) => (
                    <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">List</th>
                      <th scope="col">Made by</th>
                      <th scope="col">Kind</th>
                      <th scope="col" className="is-num">
                        Subscribers
                      </th>
                      <th scope="col">You were added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((l) => {
                      const owner = cardFor(archive, l.owner);
                      return (
                        <tr key={l.uri}>
                          <td>
                            <a href={listUrl(l, owner?.handle)} target="_blank" rel="noopener noreferrer" className="table-link">
                              {l.name || 'Untitled list'}
                              <ExternalLink size={12} aria-hidden="true" />
                            </a>
                          </td>
                          <td>{owner?.handle ? `@${owner.handle}` : <span className="muted mono">{l.owner}</span>}</td>
                          <td>
                            <span className={`badge${l.purpose === 'moderation' ? ' badge--danger' : ''}`}>{l.purpose}</span>
                          </td>
                          <td className="is-num">{l.purpose === 'moderation' && l.subscribers != null ? l.subscribers.toLocaleString('en-US') : '—'}</td>
                          <td className="num">{l.memberAt ? formatDateShort(l.memberAt) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!shown.length && <p className="empty">No lists here.</p>}
              </div>
            </section>
            <p className="note">
              Found through Constellation, which indexes who links to whom across the network, then each list read from Bluesky’s
              public API. Subscribers are counted for moderation lists only, where they decide who blocks you. A list removed since the
              last sync is gone from here at the next one.
            </p>
          </>
        )}
      </div>
    </>
  );
}
