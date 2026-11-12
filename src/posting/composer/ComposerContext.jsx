// The composer's host, mounted once above the per-account key in App.jsx, so
// an open composer (and what's typed in it) survives switching accounts.
// Anything that wants to start a post calls useComposer().open(intent); the
// intent's shape is DESIGN.md §6.3.
//
// This is the plain version the shell is built against: one text field that
// posts as the account it was opened for. The full composer replaces it
// behind the same three names.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import { useToast } from '../../shell/bits.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { accountName } from '../../session/accounts.js';
import { countGraphemes } from '../lib/graphemes.js';
import { emitPostsChanged } from '../events.js';
import '../posting.css';

const Ctx = createContext(null);

export function ComposerProvider({ children }) {
  const [intent, setIntent] = useState(null);
  const open = useCallback((next = {}) => setIntent({ ...(next || {}) }), []);
  const close = useCallback(() => setIntent(null), []);
  const value = useMemo(() => ({ open, close, isOpen: intent != null, intent }), [open, close, intent]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <PlainComposer intent={intent} onClose={close} />
    </Ctx.Provider>
  );
}

/** `{ open(intent), close(), isOpen }`. */
export function useComposer() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useComposer must be used inside <ComposerProvider>');
  return value;
}

function initialText(intent) {
  if (!intent) return '';
  if (typeof intent.text === 'string') return intent.text;
  return intent.posts?.[0]?.text || '';
}

function PlainComposer({ intent, onClose }) {
  const { did: activeDid, accounts, targetFor } = useAtprotoSession();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [openedFor, setOpenedFor] = useState(null);

  // Each open starts from its own intent; a reopen with the same one keeps
  // what was typed.
  if (intent !== openedFor) {
    setOpenedFor(intent);
    if (intent) {
      setText(initialText(intent));
      setError(null);
    }
  }

  const asDid = intent?.asDid || activeDid;
  const account = accounts.find((a) => a.did === asDid) || null;
  const name = account ? accountName(account) : asDid;
  const length = countGraphemes(text);
  const tooLong = length > 300;

  async function submit(event) {
    event.preventDefault();
    if (busy || !text.trim() || tooLong || !asDid) return;
    setBusy(true);
    setError(null);
    try {
      // The publishing code loads on the first post, not with the app.
      const [{ emptyComposerState }, { publish }, { resolveMention }] = await Promise.all([
        import('../lib/composerModel.js'),
        import('../lib/publish.js'),
        import('../lib/mentions.js'),
      ]);
      const state = emptyComposerState({ asDid });
      state.posts[0].text = text;
      if (Array.isArray(intent?.tags)) state.tags = intent.tags.slice(0, 8);
      const target = await targetFor(asDid);
      const result = await publish(state, target, { resolveMention });
      emitPostsChanged(asDid, { added: result.written || [] });
      toast?.(`Posted as ${account?.handle ? `@${account.handle}` : name}.`);
      onClose();
    } catch (err) {
      setError(err?.message || 'The post didn’t go out. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(intent)}
      onClose={busy ? undefined : onClose}
      title="New post"
      className="composer-dialog"
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="plain-composer" disabled={busy || !text.trim() || tooLong} aria-busy={busy || undefined}>
            {busy ? 'Posting…' : 'Post'}
          </Button>
        </>
      }
    >
      <form id="plain-composer" className="plain-composer" onSubmit={submit}>
        <label className="field-label" htmlFor="plain-composer-text">
          Posting as {name}
        </label>
        <textarea
          id="plain-composer-text"
          className="input textarea"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          data-autofocus
        />
        <p className={`field-hint num${tooLong ? ' is-over' : ''}`} aria-live="polite">
          {length.toLocaleString('en-US')} of 300
        </p>
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
