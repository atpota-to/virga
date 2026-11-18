// Defense: scan a post (docs/DEFENSE.md, phase 2).
//
// Paste a link to a post, or pick one of yours that people have been
// answering, and see everyone who engaged with it on the radar, sorted by
// how close each of them is to you. It answers "what would I be about to do,
// and who would notice?" before there is anything to do: nothing here writes,
// blocks, mutes or keeps anything. The scan stays in this tab's memory until
// another replaces it (scanStore.js).
//
// A scan needs one permission the ordinary sign-in doesn't ask for: the
// signed-in getProfiles, which carries how many of the people you follow
// follow each account. Until the session has it, the page says what it is
// for and offers to sign in again asking for it (Turn on Defense). A session
// whose grant nobody has read yet is let try; a scan refused for want of the
// permission comes back to the same offer.

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Download, ExternalLink, RotateCcw, ShieldHalf, Square } from 'lucide-react';
import Button from '../components/Button.jsx';
import Figures from '../components/Figures.jsx';
import Segmented from '../components/Segmented.jsx';
import { ShowAsTable } from '../charts/ChartTable.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportRows } from '../archive/exports.js';
import { reauthModeFor } from '../accounts/accountCopy.js';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { fmtInt } from '../lib/locale.js';
import { PersonRow } from '../people/people.jsx';
import { postText, postWhen } from '../reports/PostRow.jsx';
import { bskyUrlFor } from '../posting/lib/postLink.js';
import { accountSignInId } from '../session/accounts.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { PageHeader } from '../shell/bits.jsx';
import { BAND_MEANS, BAND_WORD } from './bandWords.js';
import { describeRow, postsToScan, rowFacts, scanCsvRows, stageCount, stageFraction, stageLabel } from './pageModel.js';
import Radar, { BandMark } from './Radar.jsx';
import { radarTable, scanRadar } from './radar.js';
import { canaryCandidates, runScan, signedInProfiles } from './scan.js';
import { scanFor, startScan, stopScan, subscribeScans } from './scanStore.js';
import './defense.css';

const NEAR_BANDS = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE'];
const LIST_PAGE = 40;

function useScan(did) {
  return useSyncExternalStore(
    subscribeScans,
    () => scanFor(did),
    () => scanFor(did),
  );
}

export default function DefensePage() {
  const session = useAtprotoSession();
  const archive = useArchive();
  const { did, agent } = session;
  const account = session.accounts.find((a) => a.did === did) || null;
  const caps = session.capabilitiesFor(did);
  const scan = useScan(did);
  const [asking, setAsking] = useState(null); // { busy } | { error }

  const candidates = useMemo(
    () => canaryCandidates(archive, { ownerDid: did }),
    // The follows and followers change at a sync; inbound with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [archive.following, archive.followers, archive.inbound, did],
  );

  const begin = (input) => {
    if (!agent || !did) return;
    const getProfiles = signedInProfiles(agent);
    startScan(did, { input, run: (signal, onStage) => runScan({ input, ownerDid: did, getProfiles, candidates, signal, onStage }) });
  };

  /** Sign in again, asking for Defense's permission (`on`) or leaving it out. */
  const askFor = async (on) => {
    if (!account) return;
    setAsking({ busy: true });
    try {
      await session.signIn(accountSignInId(account), { mode: account.mode || reauthModeFor(account, session.authMode), intent: 'reauth', defense: on, did: account.did });
      setAsking(null);
    } catch (error) {
      console.warn('[defense] the sign-in didn’t start:', error);
      setAsking({ error: signInErrorMessage(error) });
    }
  };

  const refused = scan.status === 'failed' && scan.error?.code === 'permission';
  const needsPermission = caps.defense === 'missing' || refused;

  return (
    <>
      <PageHeader
        title="Defense"
        sub="Everyone who engaged with a post, sorted by how close each of them is to you, before anything is done about any of them."
        access={['read']}
      />
      <div className="page-body defense">
        {needsPermission ? (
          <TurnOn account={account} asking={asking} onTurnOn={() => askFor(true)} refused={refused} />
        ) : (
          <ScanForm archive={archive} scan={scan} onScan={begin} />
        )}

        {scan.status === 'running' && <ScanProgress scan={scan} onStop={() => stopScan(did)} />}
        {scan.status === 'failed' && !refused && <ScanFailure scan={scan} onRetry={() => begin(scan.input)} />}
        {scan.status === 'done' && <ScanResult archive={archive} result={scan.result} onRescan={() => begin(scan.input)} />}
        {scan.status === 'idle' && <Bands />}

        {caps.defense === 'granted' && !needsPermission && <DefenseOn account={account} asking={asking} onTurnOff={() => askFor(false)} />}
      </div>
    </>
  );
}

/* ---- turning it on --------------------------------------------------- */

function TurnOn({ account, asking, onTurnOn, refused }) {
  const who = account?.handle ? `@${account.handle}` : 'this account';
  return (
    <section className="card defense-turn-on" aria-labelledby="defense-on-title">
      <div className="card-head">
        <div>
          <h2 id="defense-on-title" className="card-title">
            Turn on Defense for {who}
          </h2>
          <p className="card-sub">
            {refused
              ? 'The scan was refused: this sign-in doesn’t include the one read a scan needs.'
              : 'A scan needs one more permission than signing in asked for.'}
          </p>
        </div>
      </div>
      <div className="defense-prose">
        <p>
          To sort the people who engaged with a post, Virga asks Bluesky, as you, how many of the people you follow also follow each of
          them. Only a signed-in read of their profiles says that (<code>app.bsky.actor.getProfiles</code>), so turning Defense on signs
          you in again, asking for that one read as well. It reads; it can’t block, mute or post.
        </p>
        <p>
          Who engaged comes from Constellation, the public index of the network, from this browser.{' '}
          {account?.mode === 'backend'
            ? 'This account’s session is held by Virga’s server, so the read of their profiles goes through it, which passes it on to Bluesky and keeps none of it.'
            : 'The read of their profiles goes from this browser straight to Bluesky.'}{' '}
          Nothing a scan finds is kept after this tab closes.
        </p>
      </div>
      <div className="defense-actions">
        <Button onClick={onTurnOn} disabled={asking?.busy} aria-busy={asking?.busy || undefined}>
          <ShieldHalf size={15} aria-hidden="true" />
          {asking?.busy ? 'Opening the sign-in…' : 'Turn on Defense'}
        </Button>
      </div>
      {asking?.error && (
        <p className="callout callout--danger" role="alert">
          {asking.error}
        </p>
      )}
    </section>
  );
}

function DefenseOn({ account, asking, onTurnOff }) {
  return (
    <section className="card defense-on" aria-labelledby="defense-on-state">
      <div className="card-head">
        <div>
          <h2 id="defense-on-state" className="card-title">
            Defense is on{account?.handle ? ` for @${account.handle}` : ''}
          </h2>
          <p className="card-sub">
            Its sign-in includes reading who you know in common with an account. Turning it off signs you in again without that.
          </p>
        </div>
        <button type="button" className="link-action" onClick={onTurnOff} disabled={asking?.busy}>
          Turn off
        </button>
      </div>
      {asking?.error && (
        <p className="callout callout--danger" role="alert">
          {asking.error}
        </p>
      )}
    </section>
  );
}

/* ---- choosing a post ------------------------------------------------- */

function ScanForm({ archive, scan, onScan }) {
  const [text, setText] = useState('');
  const running = scan.status === 'running';
  const recent = useMemo(() => postsToScan(archive.posts, { now: archive.nowMs || Date.now() }), [archive.posts, archive.nowMs]);

  return (
    <section className="card defense-form" aria-labelledby="defense-form-title">
      <div className="card-head">
        <div>
          <h2 id="defense-form-title" className="card-title">
            Scan a post
          </h2>
          <p className="card-sub">Yours or anyone’s. Paste its bsky.app link.</p>
        </div>
      </div>
      <form
        className="defense-field"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() && !running) onScan(text.trim());
        }}
      >
        <label className="visually-hidden" htmlFor="defense-link">
          Link to a post
        </label>
        <input
          id="defense-link"
          className="input input--lg"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://bsky.app/profile/…/post/…"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" disabled={!text.trim() || running}>
          Scan
        </Button>
      </form>

      {recent.length > 0 && (
        <div className="defense-recent">
          <p className="defense-recent-head">Or one of yours that people have been answering</p>
          <ul className="defense-posts">
            {recent.map((post) => (
              <li key={post.uri} className="defense-post">
                <span className="defense-post-main">
                  <span className="defense-post-text">{postText(post)}</span>
                  <span className="meta">
                    <span>{postWhen(post.at)}</span>
                    <span className="num">
                      {fmtInt(post.replies || 0)} {post.replies === 1 ? 'reply' : 'replies'}
                    </span>
                    {post.quotes > 0 && (
                      <span className="num">
                        {fmtInt(post.quotes)} {post.quotes === 1 ? 'quote' : 'quotes'}
                      </span>
                    )}
                  </span>
                </span>
                <Button size="sm" disabled={running} onClick={() => onScan(post.uri)} aria-label={`Scan the post “${postText(post).slice(0, 60)}”`}>
                  Scan
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ---- a scan under way, and one that failed --------------------------- */

function ScanProgress({ scan, onStop }) {
  const frac = stageFraction(scan);
  return (
    <section className="card defense-progress" aria-labelledby="defense-progress-title">
      <div className="card-head">
        <div>
          <h2 id="defense-progress-title" className="card-title">
            Scanning
          </h2>
          {/* The stage is announced as it changes; the running count isn't, or every batch would be. */}
          <p className="card-sub">
            <span role="status">{stageLabel(scan)}</span>
            <span className="num">{stageCount(scan)}</span>
          </p>
        </div>
        <button type="button" className="link-action" onClick={onStop}>
          <Square size={13} aria-hidden="true" />
          Stop
        </button>
      </div>
      <div className="progress" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${Math.max(4, Math.round(frac * 100))}%` }} />
      </div>
    </section>
  );
}

function ScanFailure({ scan, onRetry }) {
  const linkProblem = scan.error?.code === 'link' || scan.error?.code === 'author';
  return (
    <div className="defense-failure">
      <p className="callout callout--danger" role="alert">
        {scan.error?.message || 'The scan stopped.'}
      </p>
      {!linkProblem && (
        <button type="button" className="link-action" onClick={onRetry}>
          <RotateCcw size={14} aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

/* ---- what a scan found ----------------------------------------------- */

function ScanResult({ archive, result, onRescan }) {
  const model = useMemo(() => scanRadar(result), [result]);
  const table = useMemo(() => radarTable(result), [result]);
  const [band, setBand] = useState('all');
  const [shown, setShown] = useState(LIST_PAGE);
  const [picked, setPicked] = useState(null);
  const listRef = useRef(null);
  const { totals, vouchCheck } = result;
  const near = result.requiresReview;
  const own = archive.posts.find((p) => p.uri === result.post.uri) || null;
  const postLink = bskyUrlFor(result.post.uri);
  const rows = band === 'all' ? near : near.filter((r) => r.band === band);

  const pick = (row) => {
    setPicked(row.did);
    if (row.band === 'UNKNOWN') return;
    setBand('all');
    const at = near.findIndex((r) => r.did === row.did);
    if (at >= shown) setShown(at + 1);
    // After the list has drawn the row.
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-did="${CSS.escape(row.did)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.querySelector('a')?.focus({ preventScroll: true });
    });
  };

  const label = `Everyone who engaged with the post, placed by how close they are to you. ${fmtInt(totals.participants)} ${
    totals.participants === 1 ? 'account' : 'accounts'
  }: ${model.byBand.PROTECTED} protected, ${model.byBand.CONNECTED} connected, ${model.byBand.PERIPHERAL} peripheral, ${model.byBand.NOTABLE} notable and ${fmtInt(
    model.byBand.UNKNOWN,
  )} with no connection. The list below names everyone but those with no connection.`;

  return (
    <>
      <section className="card defense-result" aria-labelledby="defense-result-title">
        <div className="card-head">
          <div>
            <h2 id="defense-result-title" className="card-title">
              Who engaged
            </h2>
            <p className="card-sub defense-post-quote">{own ? postText(own) : result.post.uri}</p>
          </div>
          <div className="head-actions">
            {postLink && (
              <a className="link-action" href={postLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} aria-hidden="true" />
                Open the post
              </a>
            )}
            <button type="button" className="link-action" onClick={onRescan}>
              <RotateCcw size={14} aria-hidden="true" />
              Scan again
            </button>
          </div>
        </div>

        <Figures
          label="The scan in numbers"
          items={[
            { key: 'all', label: 'Engaged', value: totals.participants },
            { key: 'near', label: 'Near you', value: near.length, note: 'Every band but no connection' },
            { key: 'far', label: 'No connection', value: totals.byBand.UNKNOWN },
            { key: 'protected', label: 'Protected', value: totals.byBand.PROTECTED, note: 'Never added to a list' },
          ]}
        />

        <ScanNotes result={result} />

        <div className="defense-radar">
          <Radar model={model} label={label} describe={(row) => describeRow(row, vouchCheck)} onPick={pick} picked={picked} />
        </div>
        <ShowAsTable
          actions={
            <button type="button" className="link-action" onClick={() => exportRows(archive, 'defense-scan', scanCsvRows(result))}>
              <Download size={14} aria-hidden="true" />
              Export
            </button>
          }
        >
          <div className="an-tableview-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Band</th>
                  {model.sectors.map((s) => (
                    <th key={s.key} scope="col" className="is-num">
                      {s.name}
                    </th>
                  ))}
                  <th scope="col" className="is-num">
                    All
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.band}>
                    <th scope="row">{BAND_WORD[r.band]}</th>
                    {r.cells.map((n, i) => (
                      <td key={model.sectors[i].key} className="is-num">
                        {fmtInt(n)}
                      </td>
                    ))}
                    <td className="is-num">{fmtInt(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ShowAsTable>
      </section>

      <section className="card defense-near" aria-labelledby="defense-near-title" ref={listRef}>
        <div className="card-head">
          <div>
            <h2 id="defense-near-title" className="card-title num">
              {fmtInt(near.length)} near you
            </h2>
            <p className="card-sub">
              The people a block list built from this post would have to leave alone or look at by name. Closest first.
            </p>
          </div>
        </div>
        {near.length > 0 && (
          <Segmented
            label="Which band"
            size="sm"
            value={band}
            onChange={(v) => {
              setBand(v);
              setShown(LIST_PAGE);
            }}
            options={[
              { value: 'all', label: `All ${fmtInt(near.length)}` },
              ...NEAR_BANDS.filter((b) => totals.byBand[b] > 0).map((b) => ({ value: b, label: `${BAND_WORD[b]} ${fmtInt(totals.byBand[b])}` })),
            ]}
          />
        )}
        {rows.length ? (
          <ul className="widget-rows report-rows defense-rows">
            {rows.slice(0, shown).map((row) => (
              <BandRow key={row.did} archive={archive} row={row} vouchCheck={vouchCheck} picked={picked === row.did} />
            ))}
          </ul>
        ) : (
          <p className="empty">Nobody near you engaged with this post: everyone here has no connection to you.</p>
        )}
        {rows.length > shown && (
          <div className="card-foot">
            <button type="button" className="link-action" onClick={() => setShown((n) => n + LIST_PAGE)}>
              Show {fmtInt(Math.min(LIST_PAGE, rows.length - shown))} more
            </button>
          </div>
        )}
      </section>

      <section className="card defense-far" aria-labelledby="defense-far-title">
        <div className="card-head">
          <div>
            <h2 id="defense-far-title" className="card-title num">
              {fmtInt(totals.byBand.UNKNOWN)} with no connection
            </h2>
            <p className="card-sub">
              Nobody you follow follows them, they don’t follow you, and they aren’t widely followed. They are what a block list built
              from this post would hold.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

/** What to know about how a scan was counted: shown only when it applies. */
function ScanNotes({ result }) {
  const notes = [];
  if (result.vouchCheck !== 'canary') {
    notes.push(
      <p key="vouch" className="callout callout--warn">
        Bluesky didn’t say who you know in common with these accounts, so nobody was sorted by it. Anyone who follows you counts as
        connected instead, and everyone else as having no connection. This happens when you follow few people or none of them follow
        each other, and when Bluesky’s count is running slow, in which case scanning again in a minute may sort them.
      </p>,
    );
  }
  if (result.unread?.length) {
    const lost = result.unread.reduce((n, u) => n + (u.count || 0), 0);
    notes.push(
      <p key="unread" className="callout callout--warn">
        Constellation didn’t answer for some of the engagement ({fmtInt(lost)} {lost === 1 ? 'record' : 'records'}), so those accounts
        aren’t here. Scan again in a minute to try them.
      </p>,
    );
  } else if (result.truncated) {
    notes.push(
      <p key="cut" className="callout">
        This post has more engagement than a scan reads, so the longest lists (usually likes) were cut short. Replies and quotes are all
        here.
      </p>,
    );
  }
  return notes.length ? <div className="defense-notes">{notes}</div> : null;
}

function BandRow({ archive, row, vouchCheck, picked }) {
  const facts = rowFacts(row, vouchCheck);
  return (
    <PersonRow
      archive={archive}
      did={row.did}
      card={{ did: row.did, handle: row.handle, displayName: row.displayName, avatar: row.avatar }}
      meta={facts.join(' · ')}
      rowProps={{ 'data-did': row.did, 'data-picked': picked || undefined, 'data-band': row.band }}
      lead={
        <span className="defense-row-band" title={BAND_WORD[row.band]}>
          <BandMark band={row.band} />
          <span className="visually-hidden">{BAND_WORD[row.band]}:</span>
        </span>
      }
    />
  );
}

/* ---- before any scan ------------------------------------------------- */

function Bands() {
  return (
    <section className="card defense-bands" aria-labelledby="defense-bands-title">
      <div className="card-head">
        <div>
          <h2 id="defense-bands-title" className="card-title">
            How a scan sorts people
          </h2>
          <p className="card-sub">
            By one thing: how many of the people you follow also follow them. It doesn’t judge anyone. It tells you who would notice.
          </p>
        </div>
      </div>
      <dl className="defense-band-list">
        {['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'].map((b) => (
          <div key={b} className="defense-band">
            <dt>
              <BandMark band={b} />
              {BAND_WORD[b]}
            </dt>
            <dd>{BAND_MEANS[b]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
