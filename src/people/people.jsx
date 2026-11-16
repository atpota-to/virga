// People, wherever they are listed: a row with their face, name, handle,
// what they did, a way in to your history with them, and a Follow button
// that writes (or deletes) a follow record in the owner's own repo.

import { useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Button, { buttonClass } from '../components/Button.jsx';
import { Link } from '../lib/router.jsx';
import { relationSets } from '../reports/models.js';
import { lookupHref } from '../tools/interactionModel.js';

/** The best card for a DID: the resolved profile, else the follower row. */
export function cardFor(archive, did) {
  return archive.actors.get(did) || relationSets(archive).followerCards.get(did) || null;
}

export function displayName(card, did) {
  return card?.displayName || (card?.handle ? `@${card.handle}` : did);
}

export function profileUrl(card, did) {
  return `https://bsky.app/profile/${encodeURIComponent(card?.handle || did)}`;
}

/** Ask for the profile cards of `dids` the archive doesn't hold yet. */
export function useWantActors(archive, dids) {
  const wanted = useMemo(() => (dids || []).filter((d) => d && !archive.actors.get(d)?.handle), [dids, archive.actors]);
  const key = wanted.join('|');
  useEffect(() => {
    if (wanted.length) archive.wantActors(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Following and unfollowing, with each button's own state: busy while the
 * write is out, and the error under the row if it failed. Held while a sync
 * is re-reading the follows, which would overwrite a press made now.
 */
export function useFollow(archive) {
  const [pending, setPending] = useState(() => new Map());
  const sets = relationSets(archive);
  const known = Boolean(archive.meta.following);
  const locked = archive.sync?.step === 'following';

  async function toggle(did, wantOn = null) {
    const on = wantOn ?? !sets.following.has(did);
    setPending((m) => new Map(m).set(did, { busy: true, error: null }));
    try {
      await archive.setFollow(did, on);
      setPending((m) => {
        const next = new Map(m);
        next.delete(did);
        return next;
      });
      return true;
    } catch (err) {
      setPending((m) => new Map(m).set(did, { busy: false, error: `Couldn’t ${on ? 'follow' : 'unfollow'}: ${err?.message || String(err)}` }));
      return false;
    }
  }

  return {
    known,
    locked,
    isFollowing: (did) => sets.following.has(did),
    followsYou: (did) => sets.followers.has(did),
    busy: (did) => locked || Boolean(pending.get(did)?.busy),
    error: (did) => pending.get(did)?.error || null,
    toggle,
  };
}

/** The Follow / Following button for one person. */
export function FollowButton({ follow, did, name, size = 'sm', followLabel = 'Follow' }) {
  if (!follow.known) return null;
  const on = follow.isFollowing(did);
  const busy = follow.busy(did);
  return (
    <Button
      size={size}
      // Follow is an outline in ink; once done it is the word alone
      // (dashboards.css .follow-button, and the kit's .is-on).
      on={on}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-pressed={on}
      title={on ? `Unfollow ${name}` : `Follow ${name}`}
      className="follow-button"
      onClick={() => follow.toggle(did)}
    >
      {on ? 'Following' : followLabel}
      <span className="visually-hidden"> {name}</span>
    </Button>
  );
}

/**
 * One person in a list. `meta` is the line under the name (after the
 * handle); `value` sits at the right before the button (a count). After it
 * comes a small link to the Interaction lookup for this person, unless
 * `history` is false. The handle is left out when it is already the name
 * (someone with no display name), and "follows you" when `rel` is false: a
 * list where everyone follows you (your newest followers, the follow-back
 * queue) would say it on every row.
 */
export function PersonRow({
  archive,
  did,
  card: given = null,
  meta = null,
  value = null,
  valueTitle = null,
  follow = null,
  followLabel,
  extra = null,
  history = true,
  rel = true,
}) {
  // A card passed in (someone who has since left the follower list, as the
  // log remembers them) stands in until a fresher one is resolved.
  const resolved = cardFor(archive, did);
  const card = resolved?.handle ? resolved : given?.handle ? given : resolved || given;
  const name = displayName(card, did);
  const handle = card?.handle && name.replace(/^@/, '') !== card.handle ? card.handle : null;
  const followsYou = rel && relationSets(archive).followers.has(did);
  return (
    <li className="person-row">
      <Avatar src={card?.avatar} name={card?.displayName || card?.handle || '?'} />
      <span className="person-main">
        <a className="person-name" href={profileUrl(card, did)} target="_blank" rel="noopener noreferrer">
          {name}
        </a>
        {(handle || followsYou || meta) && (
          <span className="person-meta">
            {handle && <span className="person-handle">@{handle}</span>}
            {followsYou && <span className="person-rel">{handle ? ' · ' : ''}follows you</span>}
            {meta && <span>{handle || followsYou ? ' · ' : ''}{meta}</span>}
          </span>
        )}
        {follow?.error(did) && (
          <span className="person-error" role="alert">
            {follow.error(did)}
          </span>
        )}
      </span>
      {value != null && (
        <span className="person-value num" title={valueTitle || undefined}>
          {value}
        </span>
      )}
      {history && did !== archive.did && (
        <Link
          to={lookupHref(did)}
          // A row that already carries a button of its own gives the link up
          // on a phone, where there isn't room for both and a name.
          className={buttonClass({ variant: 'ghost', size: 'sm', icon: true, className: `person-history${extra ? ' person-history--spare' : ''}` })}
          title={`See your history with ${name}`}
          aria-label={`See your history with ${name}`}
        >
          <History size={15} aria-hidden="true" />
        </Link>
      )}
      {extra}
      {follow && <FollowButton follow={follow} did={did} name={name} followLabel={followLabel} />}
    </li>
  );
}
