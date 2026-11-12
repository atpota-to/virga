import { useEffect, useId, useRef, useState } from 'react';
import Segmented from '../../components/Segmented.jsx';
import { publicXrpc } from '../library/sources.js';
import { MAX_REPLY_RULES } from '../lib/gates.js';
import { replyMode, toggleRule, hasRule, RULE_OPTIONS, rulesNote, isForeignListRule, unlistedRules } from '../composer/gatesModel.js';
import '../composer/composer.css';

/**
 * Who can reply and whether the post can be quoted. `value` is
 * `{ reply, quotes }`: reply null is everyone, [] is nobody, else up to five
 * rules (people mentioned, people followed, followers, members of a list).
 * `did` is the account the post goes out as: its own curation lists are the
 * ones offered. `compact` is the shorter version for a narrow space.
 */
export default function GatesEditor({ did, value, onChange, disabled = false, compact = false }) {
  const id = useId();
  const reply = Array.isArray(value?.reply) ? value.reply : null;
  const quotes = value?.quotes !== false;
  const mode = replyMode(reply);
  const lists = useCurationLists(did, mode === 'some');
  const change = (patch) => onChange?.({ reply, quotes, ...patch });
  const full = reply ? reply.length >= MAX_REPLY_RULES : false;
  const note = rulesNote(reply);
  // A list rule the account's own lists don't account for (another account's
  // list, or one since deleted) is still shown, so it can be taken out.
  const unlisted =
    mode === 'some' && lists.status !== 'loading'
      ? unlistedRules(
          reply,
          lists.items.map((l) => l.uri),
        )
      : [];

  return (
    <div className="gates-editor gates-editor--full" data-compact={compact || undefined}>
      <div className="gates-group" role="group" aria-labelledby={`${id}-reply`}>
        <span id={`${id}-reply`} className="field-label">
          Who can reply
        </span>
        <Segmented
          label="Who can reply"
          size={compact ? 'sm' : 'md'}
          value={mode}
          onChange={(next) => {
            if (disabled || next === mode) return;
            // Some people starts with the two groups most people mean, so it
            // never reads as an empty list (which would be nobody).
            change({ reply: next === 'everyone' ? null : next === 'nobody' ? [] : [{ type: 'following' }, { type: 'mention' }] });
          }}
          options={[
            { value: 'everyone', label: 'Anyone' },
            { value: 'some', label: 'Some people' },
            { value: 'nobody', label: 'Nobody' },
          ]}
        />
        {mode === 'some' && (
          <fieldset className="gates-rules" disabled={disabled}>
            <legend className="visually-hidden">Who may reply</legend>
            {RULE_OPTIONS.map((opt) => {
              const on = hasRule(reply, { type: opt.type });
              const last = on && reply.length === 1;
              return (
                <label key={opt.type} className="check gates-rule">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled || last || (!on && full)}
                    onChange={() => change({ reply: toggleRule(reply, { type: opt.type }) })}
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
            {lists.status === 'loading' && <span className="field-hint">Looking for your lists…</span>}
            {lists.status === 'error' && <span className="field-hint">Couldn’t read your lists, so only the groups above can be chosen.</span>}
            {lists.items.map((list) => {
              const rule = { type: 'list', list: list.uri };
              const on = hasRule(reply, rule);
              const last = on && reply.length === 1;
              return (
                <label key={list.uri} className="check gates-rule">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled || last || (!on && full)}
                    onChange={() => change({ reply: toggleRule(reply, rule) })}
                  />
                  <span>
                    Members of <strong>{list.name || 'a list'}</strong>
                  </span>
                </label>
              );
            })}
            {unlisted.map((rule) => {
              const last = reply.length === 1;
              return (
                <label key={rule.list} className="check gates-rule">
                  <input type="checkbox" checked disabled={disabled || last} onChange={() => change({ reply: toggleRule(reply, rule) })} />
                  <span>
                    {isForeignListRule(rule, did) ? 'Members of a list from another account' : 'Members of a list that couldn’t be found'}
                  </span>
                </label>
              );
            })}
            {note && <span className="field-hint">{note}</span>}
          </fieldset>
        )}
      </div>
      <label className="check gates-quotes">
        <input type="checkbox" checked={quotes} disabled={disabled} onChange={(e) => change({ quotes: e.target.checked })} />
        <span>Allow quote posts</span>
      </label>
    </div>
  );
}

// The account's own curation lists, read publicly when "Some people" is open.
function useCurationLists(did, wanted) {
  const [state, setState] = useState({ did: null, status: 'idle', items: [] });
  const asked = useRef(null);
  useEffect(() => {
    if (!wanted || !did || asked.current === did) return;
    asked.current = did;
    setState({ did, status: 'loading', items: [] });
    publicXrpc('app.bsky.graph.getLists', { actor: did, limit: 50 })
      .then((body) => {
        if (asked.current !== did) return;
        const items = (body?.lists || []).filter((l) => l?.purpose === 'app.bsky.graph.defs#curatelist' && l.uri);
        setState({ did, status: 'ready', items });
      })
      .catch(() => {
        if (asked.current === did) setState({ did, status: 'error', items: [] });
      });
  }, [did, wanted]);
  return state.did === did ? state : { status: wanted ? 'loading' : 'idle', items: [] };
}
