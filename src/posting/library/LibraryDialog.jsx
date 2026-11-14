import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import Dialog from '../../components/Dialog.jsx';
import { LIBRARY_NAME } from './model.js';
import { useLibrary } from './useLibrary.js';
import { initialShelf } from './libraryUi.js';
import LibraryPanel from './LibraryPanel.jsx';
import './library.css';

/**
 * Pick something to quote, attach or start from, for the post being written
 * as `did`. `onPick(plan, item)` gets a LibraryPlan (library/model.js) with
 * any template's questions already answered and its attachment read again
 * (cid and view). The dialog closes first and the plan follows on the next
 * tick, so focus is back in the composer before the composer places the
 * caret.
 *
 * `context` is `{ state, reply? }` plus, optionally, `postIndex` (the post
 * of a thread being written), `insertion` (`{ start, end }`, where the text
 * goes: a "/shortcut" range, or the selection), `shelf` (the shelf to open
 * on), `templateRkey` (a template to open on, from the slash menu) and
 * `quoteSlotLocked` (the post must keep what it already quotes).
 */
export default function LibraryDialog({ open, onClose, did, context = {}, onPick }) {
  const { accounts } = useAtprotoSession();
  const reply = context?.reply ?? context?.state?.reply ?? null;
  const handle = accounts.find((a) => a.did === did)?.handle || null;
  const lib = useLibrary({
    did,
    isOpen: Boolean(open && did),
    reply,
    selfHandle: handle,
    quoteSlotLocked: Boolean(context?.quoteSlotLocked),
  });

  const onUse = async (item, answers) => {
    // Not counted here: the composer counts a template's use when it applies
    // the plan, whichever way the plan reached it.
    const plan = await lib.planFor(item, answers);
    onClose?.();
    setTimeout(() => onPick?.(plan, item), 0);
  };

  return (
    <Dialog open={open} onClose={onClose} title={LIBRARY_NAME} className="lib-dialog">
      {open && did && (
        <LibraryPanel
          lib={lib}
          mode="dialog"
          state={context?.state || null}
          postIndex={context?.postIndex || 0}
          insertion={context?.insertion || null}
          initialShelf={initialShelf(context, { replying: Boolean(reply?.uri) })}
          focusTemplate={context?.templateRkey || null}
          onUse={onUse}
        />
      )}
    </Dialog>
  );
}
