// Who the account is on the protocol: its DID, the server that holds its
// repo, every handle and server it has had, and what is in the repo.

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { didWebDocumentUrl, getPlcHistory, resolvePds } from '../lib/atproto.js';
import { PLC_DIRECTORY } from '../config.js';
import { Link } from '../lib/router.jsx';
import { formatDateShort } from '../lib/time.js';
import { ToolHeader } from './ToolPage.jsx';

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon
      aria-label={done ? 'Copied' : `Copy ${label}`}
      title={done ? 'Copied' : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // No clipboard (an insecure context): the text is there to select.
        }
      }}
    >
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </Button>
  );
}

/** The changes in a PLC log: what each operation changed from the one before. */
export function historyEvents(log) {
  const events = [];
  let prev = null;
  for (const op of log || []) {
    if (op.nullified) continue;
    const handle = op.handles[0] || null;
    if (!prev) {
      events.push({ at: op.at, kind: 'created', text: `Created${handle ? ` as @${handle}` : ''}${op.pds ? ` on ${hostOf(op.pds)}` : ''}` });
    } else {
      if (handle && handle !== prev.handles[0]) events.push({ at: op.at, kind: 'handle', text: `Handle changed to @${handle}` });
      if (op.pds && op.pds !== prev.pds) events.push({ at: op.at, kind: 'pds', text: `Moved to ${hostOf(op.pds)}` });
      if (op.type === 'plc_tombstone') events.push({ at: op.at, kind: 'tombstone', text: 'Deactivated at the directory' });
    }
    prev = op;
  }
  return events.reverse();
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function Identity({ tool }) {
  const archive = useArchive();
  const { did, profile } = archive;
  const [pds, setPds] = useState(null);
  const [history, setHistory] = useState(undefined);

  useEffect(() => {
    let gone = false;
    resolvePds(did)
      .then((url) => !gone && setPds(url))
      .catch(() => !gone && setPds(''));
    getPlcHistory(did).then((log) => !gone && setHistory(log));
    return () => {
      gone = true;
    };
  }, [did]);

  const repo = useMemo(() => {
    const byCollection = new Map();
    let oldest = Infinity;
    for (const r of archive.atmosphere) {
      byCollection.set(r.collection, (byCollection.get(r.collection) || 0) + 1);
      if (r.at < oldest) oldest = r.at;
    }
    const nsids = [...byCollection.keys()];
    const apps = new Set(nsids.map((n) => n.split('.').slice(0, 2).join('.')));
    return { records: archive.atmosphere.length, collections: byCollection.size, apps: apps.size, oldest: Number.isFinite(oldest) ? oldest : null };
  }, [archive.atmosphere]);

  const events = history ? historyEvents(history) : [];
  const created = history?.[0]?.at || profile?.createdAt || null;
  const docUrl = did.startsWith('did:plc:') ? `${PLC_DIRECTORY}/${did}` : didWebDocumentUrl(did);

  return (
    <>
      <ToolHeader tool={tool} />
      <div className="page-body">
        <section className="card identity-card" aria-label="The account">
          <Avatar src={profile?.avatar} name={profile?.displayName || profile?.handle} size="lg" />
          <div className="identity-main">
            <span className="identity-name">{profile?.displayName || (profile?.handle ? `@${profile.handle}` : did)}</span>
            {profile?.handle && <span className="muted">@{profile.handle}</span>}
          </div>
          <dl className="identity-facts">
            <div>
              <dt>Followers</dt>
              <dd className="num">{profile?.followersCount != null ? profile.followersCount.toLocaleString('en-US') : '—'}</dd>
            </div>
            <div>
              <dt>Following</dt>
              <dd className="num">{profile?.followsCount != null ? profile.followsCount.toLocaleString('en-US') : '—'}</dd>
            </div>
            <div>
              <dt>Posts</dt>
              <dd className="num">{profile?.postsCount != null ? profile.postsCount.toLocaleString('en-US') : '—'}</dd>
            </div>
            <div>
              <dt>Account created</dt>
              <dd className="num">{created ? formatDateShort(created) : '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="card" aria-labelledby="id-ids">
          <h2 id="id-ids" className="card-title">
            Identifiers
          </h2>
          <dl className="kv">
            <div className="kv-row">
              <dt>DID</dt>
              <dd>
                <code className="kv-code">{did}</code>
                <CopyButton text={did} label="the DID" />
              </dd>
            </div>
            <div className="kv-row">
              <dt>Handle</dt>
              <dd>
                {profile?.handle ? <code className="kv-code">@{profile.handle}</code> : <span className="muted">Not verified right now</span>}
                {profile?.handle && <CopyButton text={profile.handle} label="the handle" />}
              </dd>
            </div>
            <div className="kv-row">
              <dt>PDS</dt>
              <dd>
                {pds === null ? <span className="muted">Looking it up…</span> : pds ? <code className="kv-code">{pds}</code> : <span className="muted">Couldn’t be resolved</span>}
                {pds && <CopyButton text={pds} label="the PDS address" />}
              </dd>
            </div>
            <div className="kv-row">
              <dt>DID document</dt>
              <dd>
                {docUrl ? (
                  <a href={docUrl} target="_blank" rel="noopener noreferrer" className="table-link">
                    {hostOf(docUrl)}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        </section>

        <div className="report-split">
          <section className="card" aria-labelledby="id-history">
            <h2 id="id-history" className="card-title">
              Handle and server history
            </h2>
            <p className="card-sub">From the PLC directory’s log of this DID</p>
            {history === undefined ? (
              <p className="empty">Reading the log…</p>
            ) : history === null ? (
              <p className="empty">{did.startsWith('did:web:') ? 'A did:web keeps no history.' : 'The directory couldn’t be reached.'}</p>
            ) : (
              <ol className="timeline">
                {events.map((e, i) => (
                  <li key={i} className="timeline-item" data-kind={e.kind}>
                    <span className="timeline-date num">{e.at ? formatDateShort(e.at) : '—'}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="card" aria-labelledby="id-repo">
            <h2 id="id-repo" className="card-title">
              The repo
            </h2>
            <p className="card-sub">As of the last sync</p>
            <dl className="kv">
              <div className="kv-row">
                <dt>Records</dt>
                <dd className="num">{repo.records.toLocaleString('en-US')}</dd>
              </div>
              <div className="kv-row">
                <dt>Collections</dt>
                <dd className="num">{repo.collections.toLocaleString('en-US')}</dd>
              </div>
              <div className="kv-row">
                <dt>Apps writing to it</dt>
                <dd className="num">{repo.apps.toLocaleString('en-US')}</dd>
              </div>
              <div className="kv-row">
                <dt>Oldest record</dt>
                <dd className="num">{repo.oldest ? formatDateShort(repo.oldest) : '—'}</dd>
              </div>
            </dl>
            <p className="card-caption">
              <Link to="/reports/atmosphere">See every collection in the Atmosphere report</Link>
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
