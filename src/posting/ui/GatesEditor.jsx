import { useId } from 'react';

/**
 * Who can reply and whether the post can be quoted. `value` is
 * `{ reply, quotes }`: reply null is everyone, [] is nobody, else rules.
 * A placeholder with the two simplest choices until the full editor is built.
 */
// eslint-disable-next-line no-unused-vars
export default function GatesEditor({ did, value, onChange, disabled = false, compact = false }) {
  const id = useId();
  const reply = value?.reply ?? null;
  const replyKey = reply == null ? 'everyone' : reply.length === 0 ? 'nobody' : 'some';
  return (
    <div className="gates-editor" data-compact={compact || undefined}>
      <label className="field">
        <span className="field-label">Who can reply</span>
        <select
          id={`${id}-reply`}
          className="input"
          value={replyKey}
          disabled={disabled}
          onChange={(e) => onChange?.({ ...value, reply: e.target.value === 'everyone' ? null : e.target.value === 'nobody' ? [] : reply })}
        >
          <option value="everyone">Everyone</option>
          <option value="nobody">Nobody</option>
          {replyKey === 'some' && <option value="some">Some people</option>}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={value?.quotes !== false} disabled={disabled} onChange={(e) => onChange?.({ ...value, quotes: e.target.checked })} />
        <span>Allow quote posts</span>
      </label>
    </div>
  );
}
