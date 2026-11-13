// The post adviser in the composer: a thin hook over gateController.js.
//
//   const adviser = useAdviserGate({ did, settings, requester, canUseAi, onApplyFixes })
//
//   did           the posting account (ComposerState.asDid)
//   settings      usePostingSettings(did).settings.adviser
//   requester     backendFor(did), null for a browser session
//   canUseAi      capabilitiesFor(did).canUseAi
//   onApplyFixes  (texts: string[]) => void; each post's text by index
//
// → { enabled, check(state, { mode }), busyProps, sheetProps, usageLine }
//
// `check` resolves 'publish' | 'edit' | 'draft' (gateController.js says when).
// Render <AdviserBusy {...busyProps}/> inline while it's set, and mount
// <AdviserSheet {...sheetProps}/> once. Switching the posting account, or
// unmounting, ends a read or a sheet with 'edit'.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ADVISER_CHOICES } from './gate.js';
import {
  ADVISER_DECISIONS,
  INITIAL_ADVISER_VIEW,
  adviserGateEnabled,
  createAdviserGateController,
} from './gateController.js';

export function useAdviserGate({
  did = null,
  settings = null,
  requester = null,
  canUseAi = false,
  onApplyFixes = null,
} = {}) {
  const [view, setView] = useState(INITIAL_ADVISER_VIEW);
  const ref = useRef(null);
  if (!ref.current)
    ref.current = createAdviserGateController({ onChange: setView });
  const ctl = ref.current;
  ctl.configure({ did, settings, requester, canUseAi, onApplyFixes });

  useEffect(() => () => ctl.cancel(), [ctl, did]);

  const check = useCallback(
    (state, options) => ctl.check(state, options),
    [ctl],
  );
  const enabled = adviserGateEnabled({ settings, requester, canUseAi });

  const busy = view.busy;
  const busyProps = useMemo(
    () =>
      busy
        ? {
            goals: busy.goals,
            startedAt: busy.startedAt,
            mode: busy.mode,
            onPublishAnyway: busy.choices.includes(ADVISER_CHOICES.PUBLISH)
              ? () => ctl.choose(ADVISER_CHOICES.PUBLISH)
              : null,
            onKeepEditing: () => ctl.choose(ADVISER_CHOICES.EDIT),
          }
        : null,
    [busy, ctl],
  );

  const sheet = view.sheet;
  const sheetProps = useMemo(
    () => ({
      open: !!sheet,
      onClose: () => ctl.decide(ADVISER_DECISIONS.EDIT),
      read: sheet,
      state: sheet?.state || null,
      onApplyFix: (fix) => ctl.applyFix(fix),
      onPublishAnyway: sheet?.canPublish
        ? () => ctl.decide(ADVISER_DECISIONS.PUBLISH)
        : undefined,
      onKeepEditing: () => ctl.decide(ADVISER_DECISIONS.EDIT),
      onSaveDraft: sheet?.canSaveDraft
        ? () => ctl.decide(ADVISER_DECISIONS.DRAFT)
        : undefined,
      busy: false,
    }),
    [sheet, ctl],
  );

  // Re-read after each request: aiService keeps the count the server answers with.
  const usageVersion = view.usageVersion;
  const usageLine = useMemo(
    () => ctl.usageLine(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctl, did, usageVersion],
  );

  return { enabled, check, busyProps, sheetProps, usageLine };
}

export default useAdviserGate;
