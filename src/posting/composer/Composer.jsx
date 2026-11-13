// The composer: one dialog (a full-height sheet on a phone) for writing a
// post or a thread, as any of the accounts in this browser, and sending it
// now, at a time, into the weekly queue, or to Bluesky's drafts. It lives
// above the per-account key in App.jsx, so switching accounts leaves it, and
// what's written in it, alone (D17).
//
// State is one ComposerState (lib/composerModel.js) moved by its reducer.
// What isn't the post's own (who it goes out as, defaults, uploads in
// flight, what the intent asked to load) is held beside it here.

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Clock, Hash, Languages, ListTree, MessageSquareReply, MoreHorizontal, Plus, Sparkles, X } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import Menu from '../../components/Menu.jsx';
import { useToast, useIsNarrow } from '../../shell/bits.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { isMissingScopeError } from '../../session/scopes.js';
import PostingPermissionNotice from '../../accounts/PostingPermissionNotice.jsx';
import { requestReauth } from '../../accounts/accountCopy.js';

import {
  composerReducer,
  emptyComposerState,
  emptyPost,
  isEmptyComposer,
  normalizeComposerState,
  validateComposer,
  MAX_POSTS,
} from '../lib/composerModel.js';
import { publish, publishSignature, defaultDuplicateGuard, PublishError } from '../lib/publish.js';
import { resolveMention } from '../lib/mentions.js';
import { readDefaultGates } from '../lib/gates.js';
import { prepareImage } from '../lib/images.js';
import { fetchLinkCard } from '../lib/linkCard.js';
import { uploadVideo, validateVideoFile, VIDEO_ALT_MAX_GRAPHEMES, VIDEO_FILE_INPUT_ACCEPT, VIDEO_MAX_DURATION_SECONDS } from '../lib/video.js';
import { emitPostsChanged } from '../events.js';
import { readPostingSettings, resolveDefaultGates, usePostingSettings } from '../settings.js';
import {
  createAutosaver,
  saveSessionDraft,
  forgetSessionDrafts,
  takeSetAside,
  collectPreviewUrls,
  previewUrlIsHeld,
  hasAutosaveContent,
} from '../autosave.js';
import { createDraft, updateDraft, deleteDraft, listAllDrafts, openDraft, postingDeviceId, DRAFT_DEVICE_NAME } from '../drafts/drafts.js';
import { openDraftMedia, missingDraftMedia, loadDraftMedia } from '../drafts/draftMedia.js';
import { templateService } from '../templates/templateService.js';
import { useTemplates } from '../templates/useTemplates.js';
import { readTemplateUsage, recordTemplateUse } from '../templates/templateUsage.js';
import { draftFromReply } from '../templates/editorDrafts.js';
import { applyPlanFor, insertText, itemFromTemplate, libraryContext } from '../library/model.js';
import { hydrateAttachment, readArchivePosts, fetchOwnPosts } from '../library/sources.js';
import { templateQuestions } from '../templates/postTemplates.js';
import {
  listScheduled,
  getScheduled,
  getScheduledMedia,
  createScheduled,
  updateScheduled,
  cancelScheduled,
  getLimits,
  scheduledRoomProblem,
  scheduledUsageLine,
} from '../schedule/scheduleService.js';
import { serializeForSchedule, reconstructFromScheduled } from '../schedule/scheduleSerialize.js';
import { scheduleErrorMessage } from '../schedule/scheduledPostError.js';
import { nextOpenSlot, queueSlotMoveNote } from '../schedule/postingQueue.js';
import { needsBackendHint } from '../schedule/publishActions.js';
import {
  composerTimerFit,
  immediateTimerProblem,
  scheduledTimerProblem,
  timerRoomProblem,
  sameTimer,
  timerChipLabel,
  draftTimerNote,
} from '../timers/selfDestruct.js';
import { armAfterPublish, timerDidForUri, timerSnippet } from '../timers/timerService.js';
import { useAdviserGate } from '../adviser/useAdviserGate.js';

import AltTextDialog from '../ui/AltTextDialog.jsx';
import AdviserSheet from '../ui/AdviserSheet.jsx';
import AdviserBusy from '../ui/AdviserBusy.jsx';
import WhenPicker from '../ui/WhenPicker.jsx';
import LibraryDialog from '../library/LibraryDialog.jsx';
import TemplateEditor from '../library/TemplateEditor.jsx';

import PostBlock from './PostBlock.jsx';
import PostAsPicker from './PostAsPicker.jsx';
import ReplyContext from './ReplyContext.jsx';
import PublishButton from './PublishButton.jsx';
import TagsField from './TagsField.jsx';
import { LinkCardDialog } from './EmbedCards.jsx';
import { ConfirmDialog, ContinueThreadDialog, GatesDialog, LifespanDialog, MetaDialog, VideoAltDialog } from './ComposerDialogs.jsx';
import { normalizeIntent, intentLoads, seedFromIntent, readTargetRef } from './intent.js';
import { composerActions } from './actions.js';
import { defaultTimerFor, gatesSourceLine, gatesSummary, NO_FREE_TIMER, TIMER_NEEDS_SERVER } from './defaults.js';
import { pastedImageFiles, sortIncomingFiles, IMAGE_INPUT_ACCEPT } from './media.js';
import { removeLinkFromText, splitForThread } from './editing.js';
import { langsSummary, labelsSummary } from './languages.js';
import {
  createPublishWatch,
  progressLine,
  publishErrorView,
  postedToast,
  scheduledMessage,
  queueSlotRows,
  finishSource,
  accountLabel,
  HARD_PUBLISH_ERROR,
  SLOW_PUBLISH_NOTE,
} from './submit.js';
import { loadReplyTarget, loadRecordTarget, loadDraftTarget, loadScheduledTarget, continueCandidates } from './loaders.js';
import { gatesForAccount } from './gatesModel.js';
import {
  clearKept,
  keptPostFor,
  mediaPatches,
  otherKeptAccount,
  restoredTouched,
  setAsideKept,
  setAsideState,
  worthSettingAside,
} from './restore.js';
import './composer.css';

const DISMISS_SPLIT_KEY = 'virga:composer-split-dismissed';
const GATES_CACHE_MS = 5 * 60 * 1000;
const GATES_FAILURE_CACHE_MS = 30 * 1000;
// The widest a Menu's list grows (22rem in controls.css) and the page's gutter.
const MENU_ROOM_PX = 22 * 16 + 16;

function nextHour(now = Date.now()) {
  const d = new Date(now + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function videoSize(file) {
  // Duration and shape from the browser's own reading of the file.
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    const done = (value) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 8000);
    el.preload = 'metadata';
    el.onloadedmetadata = () =>
      done({
        duration: Number.isFinite(el.duration) ? el.duration : null,
        aspectRatio: el.videoWidth > 0 && el.videoHeight > 0 ? { width: el.videoWidth, height: el.videoHeight } : null,
      });
    el.onerror = () => done(null);
    el.src = url;
  });
}

export default function Composer({ open, intent, onClose }) {
  const session = useAtprotoSession();
  const { did: activeDid, accounts, agentFor, targetFor, backendFor, capabilitiesFor, checkAccount } = session;
  const toast = useToast();
  const narrow = useIsNarrow('(max-width: 640px)');

  const [state, dispatch] = useReducer(composerReducer, null, () =>
    emptyComposerState({ asDid: activeDid || '', defaults: readPostingSettings(activeDid) }),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const openRef = useRef(open);
  openRef.current = open;
  const [generation, setGeneration] = useState(0);
  const lifespanTouched = useRef(false);
  // What an intent seeded the post with (`{ texts }`), while it's still that:
  // a post nobody has written in yet isn't worth setting aside.
  const seedRef = useRef(null);
  const reseedRef = useRef(null);
  // The writer picked "Post now instead": the main button posts now until
  // another time is chosen, whatever the account's usual action is.
  const [postNow, setPostNow] = useState(false);

  const asDid = state.asDid || activeDid || '';
  const { settings } = usePostingSettings(asDid);
  const caps = asDid ? capabilitiesFor(asDid) : { canPost: false, canSchedule: false, canUseAi: false };
  const account = accounts.find((a) => a.did === asDid) || null;
  const signedOut = account?.status === 'needsSignIn';
  const requester = caps.canSchedule ? backendFor(asDid) : null;

  // What isn't the post itself.
  const [notices, setNotices] = useState([]);
  const [error, setError] = useState(null); // { text, permission?, reauth? }
  const [permissionForced, setPermissionForced] = useState(false);
  const [busy, setBusy] = useState(null); // { action, line, slow, cancel }
  const [loads, setLoads] = useState({}); // { reply|quote|draft|scheduled|template: 'loading' | { error } }
  const [processing, setProcessing] = useState({}); // postId → images being prepared
  const [cardLoading, setCardLoading] = useState({}); // postId → true
  const [recordLoading, setRecordLoading] = useState({}); // postId → true
  const [mediaNote, setMediaNote] = useState('');
  const [whenOpen, setWhenOpen] = useState(false);
  const [queuePreview, setQueuePreview] = useState({ status: 'idle', at: null });
  const [showTags, setShowTags] = useState(false);
  const [dialogs, setDialogs] = useState({}); // which of the small dialogs is up
  const [ask, setAsk] = useState(null);
  const [sourceWarning, setSourceWarning] = useState('');
  const [continueState, setContinueState] = useState({ status: 'idle', items: [], error: '' });
  const [splitDismissed, setSplitDismissed] = useState(() => {
    try {
      return Date.now() - Number(sessionStorage.getItem(DISMISS_SPLIT_KEY) || 0) < 30 * 60 * 1000;
    } catch {
      return false;
    }
  });
  const [dragOver, setDragOver] = useState(false);
  const [moreAlign, setMoreAlign] = useState('end');
  const composerRef = useRef(null);
  const dropFiles = useRef(() => {});
  const moreRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const loadToken = useRef(0);
  const replyRefPending = useRef(null);
  const scheduledRowRef = useRef(null);
  const editors = useRef(new Map());
  const dismissedLinks = useRef(new Map());
  const videoJobs = useRef(new Map());
  const busyRef = useRef(false);
  const adviserReadingRef = useRef(false);
  const attemptRef = useRef(0);
  const abortRef = useRef(null);
  const pickFor = useRef(null);
  const imageInput = useRef(null);
  const videoInput = useRef(null);
  const askResolve = useRef(null);
  const dragDepth = useRef(0);
  const errorRef = useRef(null);

  const askUser = useCallback(
    (question) =>
      new Promise((resolve) => {
        askResolve.current = resolve;
        setAsk(question);
      }),
    [],
  );
  const answer = (value) => {
    const resolve = askResolve.current;
    askResolve.current = null;
    setAsk(null);
    resolve?.(value);
  };

  /* ---- autosave ------------------------------------------------------- */

  const autosaver = useMemo(() => createAutosaver({ currentDid: () => stateRef.current.asDid }), []);
  useEffect(() => () => autosaver.dispose(), [autosaver]);
  // The accounts this composer has written something for since the last
  // load. An empty state only clears an entry the composer wrote itself, so
  // opening, or switching to, an account with nothing on screen never wipes
  // what was kept for it.
  const wroteFor = useRef(new Set());
  useEffect(() => {
    const did = state.asDid;
    if (!did) return;
    if (reseedRef.current != null && reseedRef.current === loadToken.current) {
      reseedRef.current = null;
      seedRef.current = { texts: state.posts.map((p) => p.text) };
    }
    if (hasAutosaveContent(state)) wroteFor.current.add(did);
    else if (!wroteFor.current.delete(did)) return;
    const meta = { lifespanTouched: lifespanTouched.current };
    autosaver.save(did, state, meta);
    saveSessionDraft(did, state, meta);
  }, [state, autosaver]);

  const loadState = useCallback((next, { touched = false } = {}) => {
    // Whatever was waiting to be written belonged to the state this replaces,
    // which has been kept, set aside or cleared on purpose by now.
    autosaver.cancel();
    wroteFor.current = new Set();
    seedRef.current = null;
    setPostNow(false);
    dispatch({ type: 'load', state: next });
    lifespanTouched.current = touched;
    setGeneration((g) => g + 1);
    setProcessing({});
    setCardLoading({});
    setRecordLoading({});
    setMediaNote('');
    dismissedLinks.current = new Map();
  }, [autosaver]);

  const indexOfPost = (postId) => stateRef.current.posts.findIndex((p) => p.id === postId);

  /* ---- default reply settings (§6.6) ------------------------------------ */

  const blueskyGates = useRef(new Map()); // did → { value, at, ok }
  const readBlueskyGates = useCallback(
    async (did) => {
      const hit = blueskyGates.current.get(did);
      if (hit && Date.now() - hit.at < (hit.ok ? GATES_CACHE_MS : GATES_FAILURE_CACHE_MS)) return hit.value;
      let value = null;
      try {
        value = await readDefaultGates(await agentFor(did));
      } catch {
        value = null;
      }
      blueskyGates.current.set(did, { value, at: Date.now(), ok: value != null });
      return value;
    },
    [agentFor],
  );
  const resolveGatesFor = useCallback(
    (did) => resolveDefaultGates(readPostingSettings(did), { agent: did, readDefaultGates: readBlueskyGates }),
    [readBlueskyGates],
  );
  const [gatesInfo, setGatesInfo] = useState({ did: null, status: 'idle' });
  useEffect(() => {
    if (!open || !asDid || state.gates.custom || state.reply) return undefined;
    let live = true;
    setGatesInfo({ did: asDid, status: 'loading' });
    resolveGatesFor(asDid).then((r) => {
      if (!live) return;
      const cur = stateRef.current;
      if (cur.asDid === asDid && !cur.gates.custom) dispatch({ type: 'setDefaultGates', gates: r.gates });
      setGatesInfo({ did: asDid, status: 'ready', source: r.source, notice: r.notice });
    });
    return () => {
      live = false;
    };
  }, [open, asDid, state.gates.custom, state.reply, generation, settings.gates, resolveGatesFor]);

  async function ensureGates(s) {
    if (s.reply || s.gates.custom) return s;
    const r = await resolveGatesFor(s.asDid);
    if (stateRef.current.asDid === s.asDid && !stateRef.current.gates.custom) dispatch({ type: 'setDefaultGates', gates: r.gates });
    return { ...s, gates: r.gates };
  }

  /* ---- limits and the default timer (§6.6) ----------------------------- */

  const [limitsInfo, setLimitsInfo] = useState({ did: null, status: 'idle', value: null });
  const refreshLimits = useCallback(
    async (did) => {
      const req = did && capabilitiesFor(did).canSchedule ? backendFor(did) : null;
      if (!req) {
        setLimitsInfo({ did, status: 'none', value: null });
        return null;
      }
      setLimitsInfo((l) => (l.did === did && l.status === 'ready' ? l : { did, status: 'loading', value: null }));
      try {
        const value = await getLimits(req);
        setLimitsInfo({ did, status: 'ready', value });
        return value;
      } catch {
        setLimitsInfo({ did, status: 'error', value: null });
        return null;
      }
    },
    [backendFor, capabilitiesFor],
  );
  useEffect(() => {
    if (open && asDid) refreshLimits(asDid);
  }, [open, asDid, caps.canSchedule, refreshLimits]);
  const limits = limitsInfo.did === asDid ? limitsInfo : { status: 'loading', value: null };

  const fit = useMemo(() => composerTimerFit({ reply: !!state.reply, unavailable: !caps.canSchedule }), [state.reply, caps.canSchedule]);
  const defaultTimer = useMemo(
    () => defaultTimerFor(settings, { canSchedule: caps.canSchedule, limitsStatus: limits.status, limits: limits.value, fit }),
    [settings, caps.canSchedule, limits.status, limits.value, fit],
  );
  useEffect(() => {
    if (lifespanTouched.current) return;
    if (!sameTimer(stateRef.current.lifespan, defaultTimer.rule)) dispatch({ type: 'setLifespan', lifespan: defaultTimer.rule });
  }, [defaultTimer, generation]);
  const timerNote = !lifespanTouched.current
    ? defaultTimer.note
    : state.lifespan?.enabled && !fit.available
      ? TIMER_NEEDS_SERVER
      : state.lifespan?.enabled && limits.status === 'ready'
        ? timerRoomProblem(state.lifespan, limits.value, { holds: scheduledRowRef.current?.payload?.selfDestruct })
        : '';

  /* ---- templates and the adviser --------------------------------------- */

  const templatesApi = useTemplates(asDid, { enabled: open && !!asDid });
  const templateUsage = useMemo(() => (open ? readTemplateUsage(asDid) : {}), [open, asDid, generation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closed, the composer has no account to read for: that ends a read or a
  // sheet in progress, so neither turns up over the page later.
  const adviser = useAdviserGate({
    did: open ? asDid : null,
    settings: settings.adviser,
    requester: caps.canUseAi ? requester : null,
    canUseAi: caps.canUseAi,
    onApplyFixes: (texts) => {
      (texts || []).forEach((text, index) => {
        if (typeof text === 'string') dispatch({ type: 'setText', index, text });
      });
    },
  });

  /* ---- opening: what the intent asks for (§6.3) ------------------------ */

  const lastIntent = useRef(null);
  useEffect(() => {
    if (!open || !intent || intent === lastIntent.current) return;
    lastIntent.current = intent;
    startFromIntent(intent);
    // startFromIntent reads everything it needs through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, intent]);

  function startFromIntent(raw) {
    const plan = normalizeIntent(raw, { activeDid });
    const cur = stateRef.current;

    // Reopened with nothing new: what was being written is still here, as
    // whichever account it was going out as. Anything still loading for it
    // goes on loading.
    if (!plan.hasContent && !isEmptyComposer(cur)) {
      setError(null);
      if (plan.mode === 'queue') dispatch({ type: 'setSchedule', schedule: { mode: 'queue' } });
      if (plan.mode === 'schedule') openWhen();
      return;
    }

    const token = ++loadToken.current;
    setError(null);
    setPermissionForced(false);
    setSourceWarning('');
    setBusy((b) => (busyRef.current ? b : null));
    scheduledRowRef.current = null;
    const s = readPostingSettings(plan.asDid);
    const base = emptyComposerState({ asDid: plan.asDid, defaults: s });

    if (!plan.hasContent) {
      setLoads({});
      if (restoreFor(plan.asDid, base, token)) return;
      loadState(seedFromIntent(base, plan, { emptyPost }));
      setNotices(elsewhereNotices(plan.asDid));
      if (plan.mode === 'schedule') openWhen(base);
      return;
    }

    // An intent with words of its own: the post in progress is set aside,
    // never written over. So is one kept for this account from before a
    // reload, which the empty composer on screen doesn't show.
    const notes = [];
    let aside = null;
    if (worthSettingAside(cur, seedRef.current)) {
      const id = setAsideState(cur.asDid, cur, { touched: lifespanTouched.current });
      if (id) aside = { did: cur.asDid, id };
    } else if (!isEmptyComposer(cur)) {
      clearKept(cur.asDid);
    }
    const keptId = setAsideKept(plan.asDid, { base });
    if (!aside && keptId) aside = { did: plan.asDid, id: keptId };
    if (aside) notes.push(asideNotice(aside, 'The post you were writing is set aside.'));
    loadState(seedFromIntent(base, plan, { emptyPost }));
    seedRef.current = { texts: plan.texts };
    for (const n of plan.notes) notes.push({ key: `mode-${n}`, tone: 'info', text: n });
    if (plan.fromLink) notes.push({ key: 'link', tone: 'info', text: 'From a link. Nothing is posted until you send it.' });
    setNotices(notes);
    setWhenOpen(plan.mode === 'schedule' && !plan.reply);
    if (plan.mode === 'schedule' && !plan.reply) dispatch({ type: 'setSchedule', schedule: { mode: 'at', at: nextHour() } });
    runLoads(plan, token);
  }

  /* ---- what's kept, and what's set aside ---------------------------------- */

  function restoredNotice(left, { key = 'restored', lead = 'Picked up where you left off' } = {}) {
    return {
      key,
      tone: left ? 'warn' : 'info',
      text: `${lead}${left ? `. ${left === 1 ? 'One image or video' : `${left} images or videos`} couldn’t be kept after the page closed; add ${left === 1 ? 'it' : 'them'} again` : ''}.`,
      action: { label: 'Start over', run: () => startOver(false) },
    };
  }

  function asideNotice({ did, id }, text) {
    return {
      key: `aside-${id}`,
      tone: 'info',
      text: `${text} It’s offered again the next time the composer opens with nothing in it.`,
      action: { label: 'Open it instead', run: () => openAside(did, id) },
    };
  }

  // Where an unsent post went, when the composer opens empty for one account
  // and another has one kept.
  function elsewhereNotices(did) {
    const other = otherKeptAccount(accounts, did);
    if (!other) return [];
    return [
      {
        key: `elsewhere-${other.did}`,
        tone: 'info',
        text: `You have an unsent post as ${accountLabel(other.account, other.did)}.`,
        action: { label: 'Open it', run: () => changeAsDid(other.did) },
      },
    ];
  }

  function loadKept(kept, token, notes = []) {
    setLoads({});
    setWhenOpen(false);
    loadState(kept.state, { touched: kept.touched });
    setNotices(notes);
    fillMedia(kept.state, token);
  }

  /**
   * Put on screen what was kept for `did`: the post being written (this
   * tab's copy, else the saved one), else the newest post set aside. False
   * when there's nothing.
   */
  function restoreFor(did, base, token) {
    const kept = keptPostFor(did, { base });
    if (kept) {
      loadKept(kept, token, kept.from === 'session' ? [] : [restoredNotice(kept.mediaLeftOut)]);
      return true;
    }
    const aside = takeSetAside(did, { base });
    if (aside) {
      loadKept(
        { state: aside.inMemory ? aside.state : normalizeComposerState(aside.state), touched: restoredTouched(aside) },
        token,
        [restoredNotice(aside.mediaLeftOut, { key: 'restored-aside', lead: 'Here’s the post you set aside' })],
      );
      return true;
    }
    return false;
  }

  // A set-aside post back on screen; the one it replaces is set aside in turn.
  function openAside(did, id) {
    const cur = stateRef.current;
    const base = emptyComposerState({ asDid: did, defaults: readPostingSettings(did) });
    autosaver.cancel();
    const item = takeSetAside(did, { id, base });
    if (!item) {
      setNotices((list) => list.filter((n) => n.key !== `aside-${id}`));
      toast?.('That post isn’t kept in this browser any more.', { tone: 'danger' });
      return;
    }
    const token = ++loadToken.current;
    let swapped = null;
    if (worthSettingAside(cur, seedRef.current)) swapped = setAsideState(cur.asDid, cur, { touched: lifespanTouched.current });
    else if (!isEmptyComposer(cur)) clearKept(cur.asDid);
    scheduledRowRef.current = null;
    setError(null);
    setPermissionForced(false);
    setSourceWarning('');
    loadKept(
      { state: item.inMemory ? item.state : normalizeComposerState(item.state), touched: restoredTouched(item) },
      token,
      swapped ? [asideNotice({ did: cur.asDid, id: swapped }, 'The post you were writing is set aside.')] : [],
    );
  }

  // A restored post's images and video that live in this browser's draft
  // store (by localRef) are read back in, so they aren't asked for again.
  async function fillMedia(kept, token) {
    if (!missingDraftMedia(kept).length) return;
    const fresh = () => loadToken.current === token;
    setLoads((l) => ({ ...l, media: 'loading' }));
    let missing = [];
    try {
      const filled = await loadDraftMedia(kept.asDid, kept);
      if (!fresh()) return;
      for (const action of mediaPatches(stateRef.current, filled.state)) dispatch(action);
      missing = filled.missing || [];
    } catch {
      missing = missingDraftMedia(kept);
    } finally {
      if (fresh()) setLoads((l) => ({ ...l, media: undefined }));
    }
    if (!fresh() || !missing.length) return;
    const n = missing.length;
    setNotices((list) => [
      ...list.filter((x) => x.key !== 'missing-media'),
      {
        key: 'missing-media',
        tone: 'warn',
        text: `${n === 1 ? 'One image or video in this post isn’t' : `${n} images or videos in this post aren’t`} in this browser any more. Add ${n === 1 ? 'it' : 'them'} again before posting.`,
      },
    ]);
  }

  async function runLoads(plan, token) {
    const fresh = () => loadToken.current === token;
    const kinds = intentLoads(plan);
    if (!kinds.length) {
      setLoads({});
      return;
    }
    setLoads(Object.fromEntries(kinds.map((k) => [k, 'loading'])));
    const settle = (kind, value) => fresh() && setLoads((l) => ({ ...l, [kind]: value }));

    if (plan.scheduledId) {
      try {
        const { state: loaded, row } = await loadScheduledTarget({
          id: plan.scheduledId,
          asDid: plan.asDid,
          req: capabilitiesFor(plan.asDid).canSchedule ? backendFor(plan.asDid) : null,
          getScheduled,
          getScheduledMedia,
          reconstructFromScheduled,
        });
        if (!fresh()) return;
        scheduledRowRef.current = row;
        loadState(loaded, { touched: true });
        setLoads({});
        setWhenOpen(loaded.schedule?.mode === 'at');
      } catch (err) {
        settle('scheduled', { error: err.message });
      }
      return;
    }

    if (plan.draftId) {
      try {
        const { state: loaded, missing } = await loadDraftTarget({
          draftId: plan.draftId,
          ownerDid: plan.draftOwnerDid,
          agentFor,
          listAllDrafts,
          openDraft,
          defaults: readPostingSettings(plan.draftOwnerDid),
        });
        if (!fresh()) return;
        loadState(loaded);
        setLoads({});
        // A draft keeps only the reply's uri, cid and root; the post itself
        // is read again so the writer can see what they're answering. If it
        // can't be, the draft still goes out as a reply to it.
        if (loaded.reply?.uri && !loaded.reply.author) {
          replyRefPending.current = { kind: 'post', uri: loaded.reply.uri, soft: true };
          loadReply(replyRefPending.current, token);
        }
        if (missing?.length) {
          setNotices((n) => [
            ...n,
            {
              key: 'missing-media',
              tone: 'warn',
              text: `${missing.length === 1 ? 'One image or video in this draft was' : `${missing.length} images or videos in this draft were`} saved on another device. Add ${missing.length === 1 ? 'it' : 'them'} again here before posting.`,
            },
          ]);
        }
      } catch (err) {
        settle('draft', { error: err.message });
      }
      return;
    }

    const jobs = [];
    if (plan.reply) {
      replyRefPending.current = plan.reply;
      jobs.push(loadReply(plan.reply, token));
    }
    if (plan.quote) {
      jobs.push(
        loadRecordTarget(plan.quote)
          .then((record) => {
            if (!fresh()) return;
            dispatch({ type: 'setRecord', index: 0, record });
            settle('quote', undefined);
          })
          .catch((err) => settle('quote', { error: err.message })),
      );
    }
    if (plan.templateId) {
      jobs.push(
        (async () => {
          try {
            await templateService.load({ did: plan.asDid, agent: (d) => agentFor(d) });
            const template = templateService.list(plan.asDid).find((t) => t.rkey === plan.templateId);
            if (!fresh()) return;
            if (!template) throw new Error('That template is gone, or couldn’t be read.');
            dispatch({ type: 'setSource', source: { kind: 'template', id: plan.templateId } });
            pendingPlan.current = { template, token };
            settle('template', undefined);
          } catch (err) {
            settle('template', { error: err.message || 'Couldn’t read your templates.' });
          }
        })(),
      );
    }
    if (plan.attach) {
      settle('attach', undefined);
      // Applied once the intent's state is on screen (the effect below), so
      // the plan lands in the new post, not the one it replaced.
      pendingPlan.current = { plan: plan.attach, token };
    }
    await Promise.all(jobs);
  }

  const pendingPlan = useRef(null);
  useEffect(() => {
    const pending = pendingPlan.current;
    if (!pending || pending.token !== loadToken.current) return;
    pendingPlan.current = null;
    // What the template or attachment puts in is still the intent's, not the
    // writer's: the seed is taken again once it's on screen.
    reseedRef.current = pending.token;
    const postId = stateRef.current.posts[0]?.id;
    if (pending.template) applyTemplate(postId, pending.template, null);
    else applyPlan(pending.plan, postId, null);
    // applyPlan reads the state through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, loads]);

  // `ref.soft`: the state already holds the reply's uri, cid and root (a
  // draft), so a failed read only means there's nothing to show, not that
  // posting must wait.
  async function loadReply(ref, token = loadToken.current) {
    const soft = !!ref?.soft;
    const fresh = () => loadToken.current === token;
    setLoads((l) => ({ ...l, reply: soft ? { soft: true, loading: true } : 'loading' }));
    try {
      const reply = await loadReplyTarget(ref);
      // Taken off ("Don't reply"), or another post chosen, while it was read.
      if (!fresh() || replyRefPending.current !== ref) return;
      dispatch({ type: 'setReply', reply });
      replyRefPending.current = null;
      setLoads((l) => ({ ...l, reply: undefined }));
    } catch (err) {
      if (!fresh() || replyRefPending.current !== ref) return;
      const error = soft
        ? `${err.message} It still goes out as a reply to that post.`
        : `${err.message} Until it can, this would go out as a new post.`;
      setLoads((l) => ({ ...l, reply: { error, soft } }));
    }
  }

  /* ---- post as -------------------------------------------------------- */

  function changeAsDid(did) {
    const cur = stateRef.current;
    const old = cur.asDid;
    if (!did || did === old) return;
    autosaver.cancel();
    setError(null);
    setPermissionForced(false);
    setQueuePreview({ status: 'idle', at: null });
    const base = emptyComposerState({ asDid: did, defaults: readPostingSettings(did) });
    const label = accountLabel(accounts.find((a) => a.did === did), did);

    // Nothing written: what was kept for that account comes back instead.
    if (isEmptyComposer(cur)) {
      const token = ++loadToken.current;
      if (restoreFor(did, base, token)) return;
      dispatch({ type: 'setAsDid', did });
      setNotices((list) => list.filter((n) => !n.key.startsWith('elsewhere-')));
      return;
    }

    // The post goes with the writer to the new account. One already kept
    // there is set aside rather than written over.
    const asideId = setAsideKept(did, { base });
    clearKept(old);
    let next = composerReducer(cur, { type: 'setAsDid', did });
    // Default gates are read again for the new account; chosen ones keep
    // only what it can use.
    const fitted = next.gates.custom ? gatesForAccount(next.gates, did) : { dropped: 0 };
    if (fitted.dropped) next = { ...next, gates: fitted.gates };
    dispatch({ type: 'load', state: next });
    const notes = [];
    if (asideId) notes.push(asideNotice({ did, id: asideId }, `You already had a post in progress as ${label}. It’s set aside.`));
    if (fitted.dropped) {
      notes.push({
        key: 'gates-lists',
        tone: 'warn',
        text: fitted.reset
          ? `Replies were limited to members of another account’s list, which ${label} can’t use, so this post now has ${label}’s usual reply settings.`
          : `${fitted.dropped === 1 ? 'A list' : 'Lists'} from another account can’t limit replies to ${label}’s post, so ${fitted.dropped === 1 ? 'it was' : 'they were'} taken out of who can reply.`,
      });
    }
    setNotices((list) => [...list.filter((n) => !n.key.startsWith('elsewhere-') && n.key !== 'gates-lists'), ...notes]);
  }

  // An account removed from this browser takes its unsent post with it: the
  // composer outlives the switch that follows (D17), so without this it
  // would show that post to whoever is signed in next and write it back to
  // storage. What's on disk is left as the removal left it.
  const seenAccounts = useRef(new Set());
  useEffect(() => {
    const present = new Set(accounts.map((a) => a.did));
    const asDidNow = stateRef.current.asDid;
    const gone = !!asDidNow && seenAccounts.current.has(asDidNow) && !present.has(asDidNow);
    for (const did of seenAccounts.current) if (!present.has(did)) forgetSessionDrafts(did);
    seenAccounts.current = present;
    if (!gone) return;
    const home = present.has(activeDid) ? activeDid : accounts[0]?.did || '';
    const old = stateRef.current;
    const token = ++loadToken.current;
    setError(null);
    setPermissionForced(false);
    setSourceWarning('');
    scheduledRowRef.current = null;
    replyRefPending.current = null;
    const base = emptyComposerState({ asDid: home, defaults: readPostingSettings(home) });
    if (!home || !restoreFor(home, base, token)) {
      setLoads({});
      setWhenOpen(false);
      loadState(base);
      setNotices([]);
    }
    // Held only if another account's kept post still shows it.
    for (const url of collectPreviewUrls(old)) if (!previewUrlIsHeld(url, null)) URL.revokeObjectURL(url);
    // restoreFor and loadState read through refs; only the list matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, activeDid]);

  /* ---- media ---------------------------------------------------------- */

  const bump = (postId, by) => setProcessing((p) => ({ ...p, [postId]: Math.max(0, (p[postId] || 0) + by) }));

  async function addFiles(postId, files, { allowVideo = true } = {}) {
    const index = indexOfPost(postId);
    if (index < 0) return;
    const post = stateRef.current.posts[index];
    const sorted = sortIncomingFiles(files, { imageCount: post.images.length + (processing[postId] || 0), hasVideo: !!post.video, allowVideo });
    const notes = [...sorted.notes];
    if (sorted.video) await addVideo(postId, sorted.video, notes);
    if (sorted.images.length) {
      bump(postId, sorted.images.length);
      await Promise.all(
        sorted.images.map(async (file) => {
          try {
            const prepared = await prepareImage(file);
            const at = indexOfPost(postId);
            if (at < 0) return;
            const previewUrl = URL.createObjectURL(prepared.file);
            dispatch({ type: 'addImages', index: at, images: [{ ...prepared, previewUrl, alt: '' }] });
          } catch (err) {
            notes.push(err?.message || 'An image couldn’t be added.');
          } finally {
            bump(postId, -1);
          }
        }),
      );
    }
    setMediaNote(notes.join(' '));
  }

  async function addVideo(postId, file, notes) {
    const check = validateVideoFile(file);
    if (!check.ok) {
      notes.push(check.message);
      return;
    }
    const size = await videoSize(file);
    if (size?.duration && size.duration > VIDEO_MAX_DURATION_SECONDS) {
      notes.push(`Videos can be up to ${Math.round(VIDEO_MAX_DURATION_SECONDS / 60)} minutes long.`);
      return;
    }
    const index = indexOfPost(postId);
    if (index < 0) return;
    dispatch({
      type: 'setVideo',
      index,
      video: {
        file,
        mime: file.type,
        size: file.size,
        alt: '',
        status: 'idle',
        previewUrl: URL.createObjectURL(file),
        duration: size?.duration || null,
        ...(size?.aspectRatio ? { aspectRatio: size.aspectRatio } : {}),
      },
    });
  }

  function patchVideo(postId, file, patch, did = null) {
    const index = indexOfPost(postId);
    if (index < 0) return;
    const post = stateRef.current.posts[index];
    if (!post.video || post.video.file !== file) return;
    if (did && stateRef.current.asDid !== did) return;
    dispatch({ type: 'setVideo', index, video: { ...post.video, ...patch } });
  }

  // A video uploads as soon as it's added, as the account the post goes out
  // as; changing that account starts it again (blobs belong to one repo).
  useEffect(() => {
    if (!open || !state.asDid) return;
    for (const post of state.posts) {
      const v = post.video;
      if (!v?.file || v.status !== 'idle') continue;
      const job = videoJobs.current.get(post.id);
      if (job && job.file === v.file && job.did === state.asDid) continue;
      job?.controller.abort();
      startVideoUpload(post.id, v.file, state.asDid);
    }
    // startVideoUpload reads the rest through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state.posts, state.asDid]);

  async function startVideoUpload(postId, file, did) {
    const controller = new AbortController();
    videoJobs.current.set(postId, { controller, file, did });
    patchVideo(postId, file, { status: 'uploading', progress: 0, error: undefined });
    try {
      const target = await targetFor(did);
      const result = await uploadVideo(target, file, {
        signal: controller.signal,
        onProgress: (p) =>
          patchVideo(postId, file, p.phase === 'processing' ? { status: 'processing', progress: p.progress || 0 } : { status: 'uploading' }, did),
      });
      if (controller.signal.aborted) return;
      patchVideo(postId, file, { status: 'ready', blob: result.blob, blobDid: did, jobId: result.jobId || undefined, progress: 100 }, did);
    } catch (err) {
      if (controller.signal.aborted) return;
      patchVideo(postId, file, { status: 'error', error: err?.message || 'The video couldn’t be uploaded.' });
    } finally {
      if (videoJobs.current.get(postId)?.controller === controller) videoJobs.current.delete(postId);
    }
  }

  function removeVideo(index) {
    const post = stateRef.current.posts[index];
    if (!post) return;
    videoJobs.current.get(post.id)?.controller.abort();
    videoJobs.current.delete(post.id);
    revokeLater(post.video?.previewUrl);
    dispatch({ type: 'setVideo', index, video: null });
  }

  function revokeLater(url) {
    if (!url?.startsWith?.('blob:')) return;
    setTimeout(() => {
      if (!previewUrlIsHeld(url, stateRef.current)) URL.revokeObjectURL(url);
    }, 0);
  }

  function onPickedFiles(e, kind) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const posts = stateRef.current.posts;
    const postId = pickFor.current || posts[activeIndex]?.id || posts[0]?.id;
    pickFor.current = null;
    if (!postId || !files.length) return;
    addFiles(postId, files, { allowVideo: kind === 'video' });
  }

  /* ---- links found in the text: quotes and cards ------------------------ */

  function dismissLink(postId, url) {
    if (!url) return;
    const set = dismissedLinks.current.get(postId) || new Set();
    set.add(url);
    dismissedLinks.current.set(postId, set);
  }

  function onDetected(index, postId, { text, postEmbeds, externalLinks }) {
    const post = stateRef.current.posts.find((p) => p.id === postId);
    if (!post || post.text !== text) return;
    const dismissed = dismissedLinks.current.get(postId) || new Set();

    if (!post.record && !recordLoading[postId]) {
      const embed = postEmbeds.find((e) => {
        const span = text.slice(e.charStart, e.charEnd);
        return !dismissed.has(span);
      });
      if (embed) {
        const span = text.slice(embed.charStart, embed.charEnd);
        const ref = readTargetRef(/^https?:\/\//i.test(span) ? span : `https://${span}`);
        dismissLink(postId, span);
        if (ref) {
          setRecordLoading((r) => ({ ...r, [postId]: true }));
          loadRecordTarget(ref)
            .then((record) => {
              const at = indexOfPost(postId);
              const now = stateRef.current.posts[at];
              if (at < 0 || now.record) return;
              dispatch({ type: 'setRecord', index: at, record: { ...record, sourceUrl: span } });
              const stripped = removeLinkFromText(now.text, { charStart: embed.charStart, charEnd: embed.charEnd, expect: span });
              if (stripped !== now.text) dispatch({ type: 'setText', index: at, text: stripped });
            })
            .catch(() => {})
            .finally(() => setRecordLoading((r) => ({ ...r, [postId]: false })));
        }
      }
    }

    const hasMedia = post.images.length > 0 || !!post.video;
    if (!post.card && !hasMedia && !cardLoading[postId]) {
      const link = externalLinks.find((l) => !dismissed.has(l.url));
      if (link) {
        dismissLink(postId, link.url);
        setCardLoading((c) => ({ ...c, [postId]: true }));
        fetchLinkCard(link.url)
          .then((card) => {
            const at = indexOfPost(postId);
            const now = stateRef.current.posts[at];
            if (!card || at < 0 || now.card || now.images.length || now.video) return;
            dispatch({ type: 'setCard', index: at, card });
          })
          .catch(() => {})
          .finally(() => setCardLoading((c) => ({ ...c, [postId]: false })));
      }
    }
  }

  /* ---- the library, templates and plans (§6.5) -------------------------- */

  const [libraryFor, setLibraryFor] = useState(null); // { postId, range, templateRkey }
  const [templateSeed, setTemplateSeed] = useState(null);

  function templateContext() {
    return libraryContext({ state: stateRef.current, selfHandle: accounts.find((a) => a.did === stateRef.current.asDid)?.handle });
  }

  function selectionOf(postId) {
    const post = stateRef.current.posts.find((p) => p.id === postId);
    return editors.current.get(postId)?.selection() || { start: post?.text.length || 0, end: post?.text.length || 0 };
  }

  async function applyPlan(plan, postId, range) {
    if (!plan) return;
    let index = indexOfPost(postId);
    if (index < 0) index = 0;
    const post = stateRef.current.posts[index];
    const id = post.id;
    if (plan.insertText != null || range) {
      const sel = range || selectionOf(id);
      const r = insertText(post.text, plan.insertText ?? null, sel);
      dispatch({ type: 'setText', index, text: r.text });
      editors.current.get(id)?.setCaret(r.caret);
    }
    if (plan.templateRkey) recordTemplateUse(plan.templateRkey, stateRef.current.asDid);
    const attach = plan.attach;
    if (!attach) return;
    const now = () => stateRef.current.posts[indexOfPost(id)];
    if (attach.kind === 'link') {
      const p = now();
      if (p.images.length || p.video) {
        setMediaNote('This post’s images take the attachment space, so a link card won’t show.');
        return;
      }
      if (p.card && p.card.url !== attach.url) {
        const ok = await askUser({
          title: 'Replace the link card?',
          body: 'A post holds one link card, so this replaces the one already there.',
          choices: [
            { value: false, label: 'Keep it' },
            { value: true, label: 'Replace it', primary: true },
          ],
        });
        if (!ok) return;
      }
      setCardLoading((c) => ({ ...c, [id]: true }));
      try {
        const card = (await fetchLinkCard(attach.url).catch(() => null)) || {
          url: attach.url,
          title: attach.title || '',
          description: attach.description || '',
          thumb: null,
        };
        const at = indexOfPost(id);
        if (at >= 0) dispatch({ type: 'setCard', index: at, card });
      } finally {
        setCardLoading((c) => ({ ...c, [id]: false }));
      }
      return;
    }
    const p = now();
    if (p.record && p.record.uri !== attach.uri) {
      const ok = await askUser({
        title: 'Replace what this post quotes?',
        body: 'A post holds one quote or attachment, so this replaces the one already there.',
        choices: [
          { value: false, label: 'Keep it' },
          { value: true, label: 'Replace it', primary: true },
        ],
      });
      if (!ok) return;
    }
    setRecordLoading((r) => ({ ...r, [id]: true }));
    try {
      const full = await hydrateAttachment(attach);
      const at = indexOfPost(id);
      if (at >= 0) dispatch({ type: 'setRecord', index: at, record: { kind: full.kind, uri: full.uri, cid: full.cid, view: full.view } });
    } catch (err) {
      setMediaNote(err?.code === 'GONE' ? err.message : 'Couldn’t attach that from your library. Try again.');
    } finally {
      setRecordLoading((r) => ({ ...r, [id]: false }));
    }
  }

  function applyTemplate(postId, template, range) {
    const context = templateContext();
    if (templateQuestions(template, context).length === 0) {
      const plan = applyPlanFor(itemFromTemplate(template, context), { state: stateRef.current, context });
      applyPlan(plan, postId, range);
      return;
    }
    // A template with questions opens the library on it, where they're asked.
    setLibraryFor({ postId, range, templateRkey: template.rkey || null });
  }

  function saveAsTemplate() {
    const s = stateRef.current;
    const post = s.posts[activeIndex] || s.posts[0];
    if (s.reply) {
      // As draftFromReply made it: offered on replies only, with the note
      // that says which name became a blank.
      setTemplateSeed(draftFromReply({ text: post.text, reply: s.reply, record: post.record, card: post.card }));
    } else {
      setTemplateSeed({ text: post.text, embed: seedEmbed(post) });
    }
  }

  function seedEmbed(post) {
    if (post.record?.uri && post.record?.cid) return { $type: 'app.bsky.embed.record', record: { uri: post.record.uri, cid: post.record.cid } };
    if (post.card?.url) return { $type: 'app.bsky.embed.external', external: { uri: post.card.url, title: post.card.title || '', description: post.card.description || '' } };
    return null;
  }

  /* ---- continue a thread ------------------------------------------------ */

  async function openContinue() {
    setDialogs((d) => ({ ...d, continue: true }));
    const did = stateRef.current.asDid;
    setContinueState({ status: 'loading', items: [], error: '' });
    try {
      const rows = continueCandidates(await readArchivePosts(did), did, 6);
      let items = rows.map((r) => ({ uri: r.uri, at: r.at, text: r.text }));
      if (!items.length) {
        const { items: views } = await fetchOwnPosts(did);
        items = (views || []).slice(0, 6).map((v) => ({ uri: v.uri, at: v.record?.createdAt, text: v.record?.text || '', view: v }));
      }
      setContinueState({ status: 'ready', items, error: '' });
    } catch {
      setContinueState({ status: 'error', items: [], error: 'Couldn’t read your recent posts. Check your connection and try again.' });
    }
  }

  async function pickContinue(item) {
    setDialogs((d) => ({ ...d, continue: false }));
    replyRefPending.current = { kind: 'post', uri: item.uri };
    await loadReply(replyRefPending.current);
  }

  /* ---- sending -------------------------------------------------------- */

  const model = composerActions(state, {
    defaultAction: settings.defaultAction,
    queue: settings.queue,
    caps,
    signedOut,
    missingMedia: missingDraftMedia(state).length > 0,
    postNow: postNow && !state.schedule,
    authMode: session.authMode,
  });
  // With the limits read, a full allowance is said before anyone tries.
  const scheduleRoom = limits.status === 'ready' ? scheduledRoomProblem(limits.value, { editing: state.source?.kind === 'scheduled' }) : '';
  if (scheduleRoom) {
    for (const key of ['schedule', 'queue']) {
      if (!model.actions[key].disabled) model.actions[key] = { disabled: true, reason: scheduleRoom };
    }
  }
  const usageLine = limits.status === 'ready' && caps.canSchedule ? scheduledUsageLine(limits.value) : '';
  const replyLoad = loads.reply;
  // A draft's reply already holds what posting needs (`soft`), so reading
  // the post it answers never holds it up.
  const replyBlocks = replyLoad === 'loading' || (!!replyLoad?.error && !replyLoad.soft);
  const blockedByLoad = loads.scheduled === 'loading' || loads.draft === 'loading' || loads.media === 'loading' || replyBlocks;
  if (blockedByLoad) {
    const reason = replyBlocks && replyLoad?.error ? 'The post you’re replying to couldn’t be read.' : 'Still reading what this post needs.';
    for (const key of Object.keys(model.actions)) model.actions[key] = { disabled: true, reason };
  }

  function showError(next) {
    setError(next);
    if (next) requestAnimationFrame(() => errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  }

  function focusPost(index) {
    const id = stateRef.current.posts[index]?.id;
    if (id) editors.current.get(id)?.focus();
  }

  // Back from the adviser to keep editing: the button that started the check
  // was disabled while it ran, so focus has nowhere to return to by itself.
  function refocusAfterAdviser() {
    const index = Math.min(activeIndex, stateRef.current.posts.length - 1);
    requestAnimationFrame(() => {
      if (openRef.current) focusPost(Math.max(0, index));
    });
  }

  function runAction(action) {
    if (busyRef.current || adviserReadingRef.current) return;
    if (action === 'post') submitPost();
    else if (action === 'schedule') {
      if (stateRef.current.schedule?.mode !== 'at' || !whenOpen) openWhen();
      else submitSchedule(false);
    } else if (action === 'queue') submitSchedule(true);
    else if (action === 'draft') saveDraft();
  }

  function openWhen(base = stateRef.current) {
    setWhenOpen(true);
    if (base.schedule?.mode !== 'at') dispatch({ type: 'setSchedule', schedule: { mode: 'at', at: nextHour() } });
  }

  function startBusy(action, line) {
    busyRef.current = true;
    const attempt = ++attemptRef.current;
    setBusy({ action, line, slow: false });
    return attempt;
  }
  function endBusy(attempt) {
    if (attemptRef.current !== attempt) return;
    busyRef.current = false;
    setBusy(null);
  }

  async function submitPost({ skipAdviser = false } = {}) {
    let s = stateRef.current;
    const did = s.asDid;
    showError(null);
    const a = model.actions.post;
    if (a.disabled) {
      showError({ text: a.reason, permission: a.reason && !caps.canPost });
      return;
    }
    const problems = validateComposer(s, {
      requireAltText: settings.requireAltText,
      lifespanProblem: (rule) => (fit.available ? immediateTimerProblem(rule) : ''),
    });
    if (problems.length) {
      showError({ text: problems[0].message });
      if (problems[0].postIndex != null) focusPost(problems[0].postIndex);
      return;
    }
    const attempt = startBusy('post', 'Getting it ready');
    let late = false;
    try {
      if (defaultDuplicateGuard.isDuplicate(publishSignature(s, did))) {
        throw new PublishError('DUPLICATE', 'This was just posted. Change something to post it again.');
      }
      if (s.lifespan?.enabled && fit.available) {
        const fresh = await refreshLimits(did);
        const problem = fresh ? timerRoomProblem(s.lifespan, fresh) : '';
        if (problem) {
          const choice = await askUser({
            title: 'No free timer',
            body: `${problem} ${NO_FREE_TIMER}`,
            choices: [
              { value: 'edit', label: 'Keep editing' },
              { value: 'without', label: 'Post without it', primary: true },
            ],
          });
          if (choice !== 'without') return;
          s = { ...s, lifespan: { ...s.lifespan, enabled: false } };
          lifespanTouched.current = true;
          dispatch({ type: 'setLifespan', lifespan: s.lifespan });
        }
      }
      if (!skipAdviser && adviser.enabled) {
        setBusy((b) => ({ ...b, line: null, adviser: true }));
        const decision = await adviser.check(s, { mode: 'gate' });
        setBusy((b) => (b ? { ...b, adviser: false, line: 'Getting it ready' } : b));
        if (decision === 'edit') {
          refocusAfterAdviser();
          return;
        }
        if (decision === 'draft') {
          endBusy(attempt);
          await saveDraft();
          return;
        }
        // A fix taken from the sheet changed the text, so it is checked again:
        // a fix can make a post too long.
        s = { ...stateRef.current, lifespan: s.lifespan };
        const after = validateComposer(s, { requireAltText: settings.requireAltText });
        if (after.length) {
          showError({ text: after[0].message });
          if (after[0].postIndex != null) focusPost(after[0].postIndex);
          return;
        }
      }
      if (s.lifespan?.enabled && fit.available) {
        const p = immediateTimerProblem(s.lifespan);
        if (p) throw new Error(p);
      } else if (s.lifespan?.enabled) {
        s = { ...s, lifespan: { ...s.lifespan, enabled: false } };
      }
      s = await ensureGates(s);
      const target = await targetFor(did);
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy((b) => ({ ...b, cancel: () => controller.abort() }));
      const watch = createPublishWatch({
        onSlow: () => setBusy((b) => (b && attemptRef.current === attempt ? { ...b, slow: true } : b)),
        onHard: () => {
          late = true;
          endBusy(attempt);
          showError({ text: HARD_PUBLISH_ERROR });
        },
      });
      let result;
      try {
        result = await publish(s, target, {
          signal: controller.signal,
          resolveMention,
          requireAltText: settings.requireAltText,
          onProgress: (event) => onPublishProgress(event, s, attempt),
        });
      } finally {
        watch.stop();
        abortRef.current = null;
      }
      await afterPublished(s, result, { late });
    } catch (err) {
      if (late) return;
      const v = publishErrorView(err);
      if (v.permission) setPermissionForced(true);
      if (!v.silent) showError({ text: v.message, permission: v.permission, reauth: v.reauth });
    } finally {
      endBusy(attempt);
    }
  }

  function onPublishProgress(event, snapshot, attempt) {
    if (event?.phase === 'uploaded') {
      const postId = snapshot.posts[event.postIndex]?.id;
      const index = indexOfPost(postId);
      if (index < 0) return;
      const post = stateRef.current.posts[index];
      if (event.kind === 'image') dispatch({ type: 'updateImage', index, id: event.id, patch: { blob: event.blob, blobDid: event.blobDid } });
      else if (event.kind === 'video' && post.video)
        dispatch({ type: 'setVideo', index, video: { ...post.video, blob: event.blob, blobDid: event.blobDid, jobId: event.jobId, status: 'ready' } });
      else if (event.kind === 'cardThumb' && post.card)
        dispatch({ type: 'setCard', index, card: { ...post.card, thumbBlob: event.blob, thumbBlobDid: event.blobDid } });
      return;
    }
    const line = progressLine(event, { posts: snapshot.posts.length });
    if (event?.phase === 'writing') setBusy((b) => (b && attemptRef.current === attempt ? { ...b, line, cancel: null } : b));
    else if (line) setBusy((b) => (b && attemptRef.current === attempt ? { ...b, line } : b));
  }

  async function afterPublished(s, result, { late }) {
    const did = s.asDid;
    emitPostsChanged(did, { added: result.written || [] });
    const acct = accounts.find((a) => a.did === did);
    const posted = postedToast({ account: acct, did, root: result.root });
    toast?.(
      <span className="composer-toast">
        {posted.text}{' '}
        {posted.href && (
          <a href={posted.href} target="_blank" rel="noreferrer">
            View it on Bluesky
          </a>
        )}
      </span>,
      { ms: 9000 },
    );
    for (const w of result.warnings || []) toast?.(w.message, { ms: 7000 });

    if (s.lifespan?.enabled) {
      const fitNow = composerTimerFit({ reply: !!s.reply, unavailable: !capabilitiesFor(did).canSchedule });
      const req = backendFor(timerDidForUri(result.root.uri));
      armAfterPublish(req, result, s.lifespan, {
        snippet: timerSnippet(s.posts[0]?.text),
        postedAt: result.written?.[0]?.record?.createdAt,
        fit: fitNow,
      }).then((r) => {
        if (r.status === 'armed') {
          if (r.note) toast?.(r.note);
        } else {
          const why = r.error?.message ? ` ${r.error.message}` : '';
          toast?.(`Your post went out, but without its timer.${why}`, { tone: 'danger', ms: 10000 });
        }
        refreshLimits(did);
      });
    }

    const src = await finishSource(s.source, { asDid: did, agentFor, backendFor, deleteDraft, cancelScheduled });
    if (src.keepSource) {
      setSourceWarning(src.warning);
      return;
    }
    if (src.warning) toast?.(src.warning, { tone: 'danger', ms: 10000 });
    // A post that landed after the composer gave up waiting: only clear what
    // the writer hasn't changed since.
    if (late && stateRef.current.posts.some((p, i) => p.text !== s.posts[i]?.text)) return;
    resetAfterSend(did);
  }

  function resetAfterSend(did) {
    const old = stateRef.current;
    autosaver.cancel();
    clearKept(did);
    if (old.asDid !== did) clearKept(old.asDid);
    const home = activeDid || did;
    const fresh = emptyComposerState({ asDid: home, defaults: readPostingSettings(home) });
    loadState(fresh);
    for (const url of collectPreviewUrls(old)) {
      if (!previewUrlIsHeld(url, fresh)) URL.revokeObjectURL(url);
    }
    scheduledRowRef.current = null;
    setNotices([]);
    setWhenOpen(false);
    setShowTags(false);
    setSourceWarning('');
    setError(null);
    onClose?.();
  }

  async function retryCancelSource() {
    const s = stateRef.current;
    const src = await finishSource(s.source, { asDid: s.asDid, agentFor, backendFor, deleteDraft, cancelScheduled });
    if (src.keepSource) {
      setSourceWarning(src.warning);
      return;
    }
    toast?.('The scheduled copy is cancelled.');
    resetAfterSend(s.asDid);
  }

  async function loadImageBytes(image) {
    if (!image?.localRef) return null;
    const store = await openDraftMedia(stateRef.current.asDid);
    return (await store.get(image.localRef))?.file || null;
  }

  async function submitSchedule(queued) {
    let s = stateRef.current;
    const did = s.asDid;
    showError(null);
    const a = model.actions[queued ? 'queue' : 'schedule'];
    if (a.disabled) {
      showError({ text: a.reason });
      return;
    }
    const req = backendFor(did);
    if (!req) {
      showError({ text: needsBackendHint(session.authMode) });
      return;
    }
    const editing = s.source?.kind === 'scheduled' ? s.source : null;
    const editingRow = editing ? scheduledRowRef.current : null;
    const attempt = startBusy(queued ? 'queue' : 'schedule', queued ? 'Finding the next open time' : 'Scheduling');
    try {
      const limitsNow = await refreshLimits(did);
      const room = scheduledRoomProblem(limitsNow, { editing: !!editing });
      if (room) throw Object.assign(new Error(room), { code: 'ROOM' });
      if (s.lifespan?.enabled) {
        const problem = timerRoomProblem(s.lifespan, limitsNow, { holds: editingRow?.payload?.selfDestruct });
        if (problem) {
          const choice = await askUser({
            title: 'No free timer',
            body: `${problem} Schedule it without the timer, or keep editing.`,
            choices: [
              { value: 'edit', label: 'Keep editing' },
              { value: 'without', label: 'Schedule without it', primary: true },
            ],
          });
          if (choice !== 'without') return;
          s = { ...s, lifespan: { ...s.lifespan, enabled: false } };
          lifespanTouched.current = true;
          dispatch({ type: 'setLifespan', lifespan: s.lifespan });
        }
      }
      let scheduledFor;
      let moveNote = '';
      if (queued) {
        const { rows } = await listScheduled(req);
        const slot = nextOpenSlot(settings.queue, queueSlotRows(rows, { excludeId: editing?.id }), new Date());
        if (!slot) throw new Error('Your weekly schedule has no open times in the next 90 days. Add some in Posting › Weekly schedule.');
        scheduledFor = slot.toISOString();
        moveNote = editingRow ? queueSlotMoveNote(editingRow, slot, new Date()) : '';
      } else {
        scheduledFor = s.schedule?.at;
      }
      const problems = validateComposer(
        { ...s, schedule: queued ? { mode: 'queue' } : s.schedule },
        {
          forSchedule: true,
          requireAltText: settings.requireAltText,
          lifespanProblem: (rule) => scheduledTimerProblem(rule, scheduledFor),
        },
      );
      if (problems.length) {
        if (problems[0].postIndex != null) focusPost(problems[0].postIndex);
        throw new Error(problems[0].message);
      }
      s = await ensureGates(s);
      setBusy((b) => (b ? { ...b, line: editing ? 'Saving the changes' : queued ? 'Adding it to the queue' : 'Scheduling' } : b));
      const body = await serializeForSchedule(s, {
        now: new Date(),
        scheduledFor,
        queued,
        resolveMention,
        fit: composerTimerFit({ reply: false }),
        loadImage: loadImageBytes,
      });
      const row = editing ? await updateScheduled(req, editing.id, body) : await createScheduled(req, body);
      if (s.source?.kind === 'draft') {
        const src = await finishSource(s.source, { asDid: did, agentFor, backendFor, deleteDraft, cancelScheduled });
        if (src.warning) toast?.('Scheduled, but its draft couldn’t be deleted. Delete it in Drafts.', { tone: 'danger', ms: 9000 });
      }
      const acct = accounts.find((x) => x.did === did);
      toast?.(`${scheduledMessage({ at: row?.scheduledFor || scheduledFor, queued, editing: !!editing, account: acct, did })}${moveNote ? ` ${moveNote}` : ''}`, {
        ms: 8000,
      });
      for (const w of body.warnings || []) toast?.(w.message, { ms: 7000 });
      refreshLimits(did);
      resetAfterSend(did);
    } catch (err) {
      showError({ text: err?.code === 'ROOM' ? err.message : scheduleErrorMessage(err) || err?.message || 'That didn’t work. Try again.' });
    } finally {
      endBusy(attempt);
    }
  }

  async function saveDraft() {
    const s = stateRef.current;
    const did = s.asDid;
    showError(null);
    const a = model.actions.draft;
    if (a.disabled) {
      showError({ text: a.reason });
      return;
    }
    const attempt = startBusy('draft', 'Saving the draft');
    try {
      const agent = await agentFor(did);
      const opts = { deviceId: postingDeviceId(), deviceName: DRAFT_DEVICE_NAME, resolveMention };
      const same = s.source?.kind === 'draft' && (s.source.ownerDid || did) === did;
      const res = same ? await updateDraft(agent, s.source.id, s, opts) : await createDraft(agent, s, opts);
      if (stateRef.current === s) loadState(res.state, { touched: lifespanTouched.current });
      else dispatch({ type: 'setSource', source: res.state.source });
      const notes = [draftTimerNote(s.lifespan, lifespanTouched.current, defaultTimer.rule)];
      if (s.source?.kind === 'scheduled') notes.push('The scheduled copy is still in your queue.');
      const acct = accounts.find((x) => x.did === did);
      toast?.(`Draft saved to ${accountLabel(acct, did)}’s Bluesky drafts.${notes.filter(Boolean).map((n) => ` ${n}`).join('')}`, { ms: 7000 });
    } catch (err) {
      const permission = isMissingScopeError(err);
      if (permission) setPermissionForced(true);
      showError({
        text: permission ? 'Virga needs permission to save drafts. Sign in again to grant it.' : err?.message || 'The draft couldn’t be saved. Try again.',
        permission,
      });
    } finally {
      endBusy(attempt);
    }
  }

  async function startOver(confirm = true) {
    if (confirm && !isEmptyComposer(stateRef.current)) {
      const ok = await askUser({
        title: 'Start over?',
        body: 'What’s written here is cleared. Saved drafts and scheduled posts aren’t touched.',
        choices: [
          { value: false, label: 'Keep it' },
          { value: true, label: 'Clear it', danger: true },
        ],
      });
      if (!ok) return;
    }
    const did = stateRef.current.asDid || activeDid;
    const old = stateRef.current;
    loadToken.current += 1;
    autosaver.cancel();
    clearKept(did);
    const fresh = emptyComposerState({ asDid: did, defaults: readPostingSettings(did) });
    loadState(fresh);
    for (const url of collectPreviewUrls(old)) if (!previewUrlIsHeld(url, fresh)) URL.revokeObjectURL(url);
    scheduledRowRef.current = null;
    setLoads({});
    setNotices([]);
    setWhenOpen(false);
    setError(null);
    setSourceWarning('');
  }

  // A post just added takes the caret as soon as it's on screen, so what's
  // typed next lands in it.
  const focusNewPost = useRef(false);
  useLayoutEffect(() => {
    if (!focusNewPost.current) return;
    focusNewPost.current = false;
    focusPost(stateRef.current.posts.length - 1);
  }, [state.posts.length]);

  // Opening (or loading a new post into it) puts the caret in the first post,
  // on a wide screen: a phone's keyboard would cover what was just opened.
  useEffect(() => {
    if (!open || narrow) return undefined;
    const timer = setTimeout(() => {
      const el = document.activeElement;
      const idle = !el || el === document.body || el.closest?.('.dialog-head') || el.tagName === 'DIALOG';
      if (idle) focusPost(0);
    }, 40);
    return () => clearTimeout(timer);
  }, [open, generation, narrow]);

  // A file dropped anywhere outside the post area while the composer is open
  // (its title bar, the send bar, the backdrop) would otherwise open in the
  // tab and unload the page with everything picked. Dropped on the dialog,
  // it's added like a drop on the post area.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const onOver = (e) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      const dialog = composerRef.current?.closest('dialog');
      if (dialog?.contains(e.target)) dropFiles.current(Array.from(e.dataTransfer.files || []));
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [open]);

  /* ---- the queue's next slot, shown before it's used ---------------------- */

  useEffect(() => {
    if (!open || state.schedule?.mode !== 'queue' || !requester) return undefined;
    let live = true;
    setQueuePreview({ status: 'loading', at: null });
    listScheduled(requester)
      .then(({ rows }) => {
        if (!live) return;
        const slot = nextOpenSlot(settings.queue, queueSlotRows(rows, { excludeId: stateRef.current.source?.kind === 'scheduled' ? stateRef.current.source.id : null }), new Date());
        setQueuePreview({ status: 'ready', at: slot ? slot.toISOString() : null });
      })
      .catch(() => live && setQueuePreview({ status: 'error', at: null }));
    return () => {
      live = false;
    };
  }, [open, state.schedule?.mode, requester, settings.queue]);

  /* ---- the post block's handlers ---------------------------------------- */

  const api = {
    setText: (index, text) => dispatch({ type: 'setText', index, text }),
    detected: onDetected,
    focus: (index) => setActiveIndex(index),
    movePost: (from, to) => dispatch({ type: 'movePost', from, to }),
    removePost: async (index) => {
      const post = stateRef.current.posts[index];
      if (post && (post.text.trim() || post.images.length || post.video || post.record || post.card)) {
        const ok = await askUser({
          title: `Remove post ${index + 1}?`,
          body: 'What’s written in it, and what it holds, goes too.',
          choices: [
            { value: false, label: 'Keep it' },
            { value: true, label: 'Remove it', danger: true },
          ],
        });
        if (!ok) return;
      }
      if (post?.video) videoJobs.current.get(post.id)?.controller.abort();
      dispatch({ type: 'removePost', index });
    },
    pickImages: (index) => {
      pickFor.current = stateRef.current.posts[index]?.id;
      imageInput.current?.click();
    },
    pickVideo: (index) => {
      pickFor.current = stateRef.current.posts[index]?.id;
      videoInput.current?.click();
    },
    pasteFiles: (index, clipboard) => {
      const files = pastedImageFiles(clipboard);
      if (!files.length) return false;
      addFiles(stateRef.current.posts[index]?.id, files, { allowVideo: false });
      return true;
    },
    altImage: (index, imageId) => setDialogs((d) => ({ ...d, alt: { postId: stateRef.current.posts[index]?.id, imageId } })),
    moveImage: (index, from, to) => dispatch({ type: 'moveImage', index, from, to }),
    removeImage: (index, imageId) => {
      const img = stateRef.current.posts[index]?.images.find((i) => i.id === imageId);
      dispatch({ type: 'removeImage', index, id: imageId });
      revokeLater(img?.previewUrl);
    },
    altVideo: (index) => setDialogs((d) => ({ ...d, videoAlt: stateRef.current.posts[index]?.id })),
    removeVideo,
    retryVideo: (index) => {
      const post = stateRef.current.posts[index];
      if (post?.video) dispatch({ type: 'setVideo', index, video: { ...post.video, status: 'idle', error: undefined } });
    },
    cancelVideo: removeVideo,
    editCard: (index) => setDialogs((d) => ({ ...d, card: stateRef.current.posts[index]?.id })),
    removeCard: (index) => {
      const post = stateRef.current.posts[index];
      dismissLink(post?.id, post?.card?.url);
      dispatch({ type: 'setCard', index, card: null });
    },
    removeRecord: (index) => {
      const post = stateRef.current.posts[index];
      dismissLink(post?.id, post?.record?.sourceUrl);
      dispatch({ type: 'setRecord', index, record: null });
    },
    openLibrary: (index, range) => setLibraryFor({ postId: stateRef.current.posts[index]?.id, range }),
    applyTemplate: (index, template, range) => applyTemplate(stateRef.current.posts[index]?.id, template, range),
    split: (index) => {
      const post = stateRef.current.posts[index];
      const room = MAX_POSTS - stateRef.current.posts.length;
      // What doesn't fit in the posts there's room for stays in the last one.
      const parts = splitForThread(post.text, undefined, { maxParts: room + 1 });
      if (parts.length < 2) return;
      dispatch({ type: 'setText', index, text: parts[0] });
      parts.slice(1).forEach((text, i) => dispatch({ type: 'addPost', after: index + i, post: { ...emptyPost(), text } }));
    },
    dismissSplit: () => {
      setSplitDismissed(true);
      try {
        sessionStorage.setItem(DISMISS_SPLIT_KEY, String(Date.now()));
      } catch {
        // Only for this time, then.
      }
    },
  };

  /* ---- rendering -------------------------------------------------------- */

  // A read by the adviser holds the post still too: a fix it offers is made
  // against the words it read.
  const adviserReading = !!adviser.busyProps;
  const disabled = !!busy || adviserReading || loads.scheduled === 'loading' || loads.draft === 'loading';
  adviserReadingRef.current = adviserReading;
  const replying = !!state.reply;
  const title = replying
    ? 'Reply'
    : state.source?.kind === 'scheduled'
      ? 'Scheduled post'
      : state.source?.kind === 'draft'
        ? 'Draft'
        : state.posts.length > 1
          ? 'New thread'
          : 'New post';
  const locked = state.source?.kind === 'scheduled';
  const altPost = dialogs.alt ? state.posts.find((p) => p.id === dialogs.alt.postId) : null;
  const altTarget = altPost ? altPost.images.find((i) => i.id === dialogs.alt.imageId) : null;
  const videoAltPost = dialogs.videoAlt ? state.posts.find((p) => p.id === dialogs.videoAlt) : null;
  const cardPost = dialogs.card ? state.posts.find((p) => p.id === dialogs.card) : null;
  const libraryPost = libraryFor ? state.posts.find((p) => p.id === libraryFor.postId) : null;
  const primaryReason = model.actions[model.primary]?.disabled ? model.actions[model.primary].reason : '';
  const gatesLine = gatesSourceLine(state.gates.custom ? { custom: true } : gatesInfo.did === asDid ? gatesInfo : { status: 'loading' }, { reply: replying });
  const loadError = loads.scheduled?.error || loads.draft?.error;
  const problemsByPost = useMemo(() => {
    const out = {};
    const list = validateComposer(state, { requireAltText: false });
    for (const p of list) {
      if (p.postIndex == null || !['TOO_MANY_BYTES', 'IMAGE_MISSING', 'VIDEO_MISSING', 'RECORD_UNRESOLVED', 'ALT_TOO_LONG'].includes(p.code)) continue;
      (out[p.postIndex] ||= []).push(p);
    }
    return out;
  }, [state]);

  function onKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      if (disabled) return;
      if (!model.actions[model.primary]?.disabled) runAction(model.primary);
      else showError({ text: model.actions[model.primary].reason });
    }
  }

  const dropProps = {
    onDragEnter: (e) => {
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      dragDepth.current += 1;
      setDragOver(true);
    },
    onDragOver: (e) => {
      if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragOver(false);
    },
    onDrop: (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      dragDepth.current = 0;
      setDragOver(false);
      if (!files.length) return;
      e.preventDefault();
      dropFiles.current(files);
    },
  };
  dropFiles.current = (files) => {
    if (disabled || !files.length) return;
    addFiles(stateRef.current.posts[activeIndex]?.id || stateRef.current.posts[0].id, files, { allowVideo: false });
  };

  function placeMore() {
    const rect = moreRef.current?.getBoundingClientRect?.();
    if (!rect || typeof window === 'undefined') return;
    const roomLeft = rect.right;
    const roomRight = window.innerWidth - rect.left;
    setMoreAlign(roomLeft >= MENU_ROOM_PX || roomLeft >= roomRight ? 'end' : 'start');
  }

  const moreItems = [
    !replying && { key: 'continue', label: 'Continue a thread', hint: 'Reply to one of your own posts', onSelect: openContinue },
    { key: 'template', label: 'Save as a template', hint: 'Keep this text to use again', onSelect: saveAsTemplate },
    { separator: true },
    { key: 'over', label: 'Start over', tone: 'danger', onSelect: () => startOver(true) },
  ];

  const actions = (
    <div className="composer-actions">
      <p className="composer-why" aria-live="polite">
        {busy ? '' : primaryReason || (model.draftFallback ? 'Over 300 characters: it can be saved as a draft.' : '')}
      </p>
      <PublishButton
        state={state}
        model={model}
        busy={!!busy || adviserReading}
        onAction={runAction}
        footnote={usageLine ? `${usageLine}.` : ''}
      />
    </div>
  );

  return (
    <>
      <Dialog open={open} onClose={() => {
        autosaver.flush();
        onClose?.();
      }} title={title} className="composer-dialog" actions={actions}>
        <div ref={composerRef} className="composer" onKeyDown={onKeyDown} data-drag={dragOver || undefined} {...dropProps}>
          <PostAsPicker
            asDid={asDid}
            activeDid={activeDid}
            accounts={accounts}
            onChange={changeAsDid}
            checkAccount={checkAccount}
            locked={locked}
            lockedReason="A scheduled post stays with the account that scheduled it."
            disabled={disabled}
          />
          {signedOut && (
            <div className="callout callout--warn" role="status">
              <span>This account is signed out. Sign back in to post as it, or choose another account.</span>
              <Button size="sm" onClick={() => requestReauth(asDid, { immediate: true })}>
                Sign back in
              </Button>
            </div>
          )}
          {!signedOut && <PostingPermissionNotice did={asDid} force={permissionForced} />}

          {notices.map((n) => (
            <div key={n.key} className={`callout${n.tone === 'warn' ? ' callout--warn' : ''} composer-notice`} role="status">
              <span>{n.text}</span>
              <span className="callout-actions">
                {n.action && (
                  <Button size="sm" onClick={n.action.run}>
                    {n.action.label}
                  </Button>
                )}
                <Button variant="ghost" size="sm" icon aria-label="Dismiss" onClick={() => setNotices((list) => list.filter((x) => x.key !== n.key))}>
                  <X size={14} aria-hidden="true" />
                </Button>
              </span>
            </div>
          ))}

          {sourceWarning && (
            <div className="callout callout--danger" role="alert">
              <span>{sourceWarning}</span>
              <span className="callout-actions">
                <Button size="sm" onClick={retryCancelSource}>
                  Cancel the scheduled copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => resetAfterSend(state.asDid)}>
                  Close
                </Button>
              </span>
            </div>
          )}

          {loadError ? (
            <div className="callout callout--danger" role="alert">
              <span>{loadError}</span>
              <span className="callout-actions">
                <Button size="sm" onClick={() => startOver(false)}>
                  Write a new post instead
                </Button>
              </span>
            </div>
          ) : loads.scheduled === 'loading' || loads.draft === 'loading' ? (
            <ComposerSkeleton label={loads.scheduled ? 'Opening the scheduled post' : 'Opening the draft'} />
          ) : (
            <>
              <ReplyContext
                reply={state.reply}
                selfDid={asDid}
                loading={replyLoad === 'loading' || !!replyLoad?.loading}
                error={replyLoad?.error || ''}
                disabled={disabled}
                onRetry={() => replyRefPending.current && loadReply(replyRefPending.current)}
                onRemove={() => {
                  replyRefPending.current = null;
                  setLoads((l) => ({ ...l, reply: undefined }));
                  dispatch({ type: 'setReply', reply: null });
                }}
              />
              {loads.quote?.error && (
                <p className="callout callout--warn" role="status">
                  {loads.quote.error}
                </p>
              )}
              {loads.template?.error && (
                <p className="callout callout--warn" role="status">
                  {loads.template.error}
                </p>
              )}

              <div className="post-blocks" data-thread={state.posts.length > 1 || undefined}>
                {state.posts.map((post, index) => (
                  <PostBlock
                    key={post.id}
                    post={post}
                    index={index}
                    total={state.posts.length}
                    editorRef={(el) => {
                      if (el) editors.current.set(post.id, el);
                      else editors.current.delete(post.id);
                    }}
                    api={api}
                    disabled={disabled}
                    autoFocus={index === 0 && !narrow}
                    placeholder={index > 0 ? 'Keep going…' : replying ? 'Write your reply' : 'What’s on your mind?'}
                    templates={templatesApi.templates}
                    templatesStatus={templatesApi.loading ? 'loading' : templatesApi.error ? 'error' : 'ready'}
                    templateUsage={templateUsage}
                    replying={replying}
                    parentText={state.reply?.text || ''}
                    processing={processing[post.id] || 0}
                    cardLoading={!!cardLoading[post.id]}
                    recordLoading={!!recordLoading[post.id] || (index === 0 && loads.quote === 'loading')}
                    problems={problemsByPost[index] || []}
                    requireAltText={settings.requireAltText}
                    offerSplit={settings.showThreadSuggestion !== false && !splitDismissed && state.posts.length < MAX_POSTS}
                  />
                ))}
              </div>
              {state.posts.length < MAX_POSTS && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="add-post"
                  disabled={disabled}
                  onClick={() => {
                    focusNewPost.current = true;
                    dispatch({ type: 'addPost', after: state.posts.length - 1 });
                  }}
                >
                  <Plus size={15} aria-hidden="true" />
                  Add a post to the thread
                </Button>
              )}
              {mediaNote && (
                <p className="callout callout--warn" role="status">
                  {mediaNote}
                </p>
              )}

              {(showTags || state.tags.length > 0) && <TagsField tags={state.tags} disabled={disabled} onChange={(tags) => dispatch({ type: 'setTags', tags })} />}

              <div className="composer-options" role="group" aria-label="Post settings">
                <Button size="sm" variant="ghost" aria-pressed={showTags || state.tags.length > 0} onClick={() => setShowTags((v) => !v)} disabled={disabled}>
                  <Hash size={15} aria-hidden="true" />
                  {state.tags.length ? `${state.tags.length} ${state.tags.length === 1 ? 'tag' : 'tags'}` : 'Tags'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDialogs((d) => ({ ...d, meta: true }))} disabled={disabled}>
                  <Languages size={15} aria-hidden="true" />
                  {langsSummary(state.langs)}
                  {state.labels.length ? ` · ${labelsSummary(state.labels)}` : ''}
                </Button>
                {!replying && (
                  <Button size="sm" variant="ghost" onClick={() => setDialogs((d) => ({ ...d, gates: true }))} disabled={disabled} title={gatesLine}>
                    <MessageSquareReply size={15} aria-hidden="true" />
                    {gatesSummary(state.gates)}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDialogs((d) => ({ ...d, timer: true }))}
                  disabled={disabled}
                  title={timerNote || undefined}
                  aria-label={state.lifespan?.enabled ? `Timer: ${timerChipLabel(state.lifespan)}` : 'Timer: none'}
                >
                  <Clock size={15} aria-hidden="true" />
                  {state.lifespan?.enabled ? timerChipLabel(state.lifespan) : 'No timer'}
                </Button>
                {adviser.enabled && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    title={adviser.usageLine || 'Ask the post adviser what it thinks'}
                    onClick={async () => {
                      const decision = await adviser.check(stateRef.current, { mode: 'manual' });
                      if (decision === 'publish') submitPost({ skipAdviser: true });
                      else if (decision === 'draft') saveDraft();
                      else refocusAfterAdviser();
                    }}
                  >
                    <Sparkles size={15} aria-hidden="true" />
                    Check this post
                  </Button>
                )}
                {/* The list hangs toward whichever side has room: on a phone the
                    row wraps and this button can sit at the left edge. */}
                <span className="composer-more" ref={moreRef} onPointerDownCapture={placeMore} onFocusCapture={placeMore}>
                  <Menu label="More for this post" icon variant="ghost" placement="up" align={moreAlign} items={moreItems.filter(Boolean)}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </Menu>
                </span>
              </div>
              {timerNote && !state.lifespan?.enabled && (
                <p className="field-hint composer-timer-note">{timerNote}</p>
              )}
              {gatesInfo.did === asDid && gatesInfo.source === 'everyone' && !state.gates.custom && !replying && (
                <p className="field-hint composer-timer-note">{gatesInfo.notice}</p>
              )}

              {whenOpen && (state.schedule?.mode === 'at' || state.schedule?.mode === 'queue') && (
                <section className="when-panel" aria-label="When it goes out">
                  <div className="when-panel-head">
                    <span className="field-label">{state.schedule.mode === 'queue' ? 'Into your weekly queue' : 'Schedule for later'}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        dispatch({ type: 'setSchedule', schedule: null });
                        setWhenOpen(false);
                        setPostNow(true);
                      }}
                    >
                      Post now instead
                    </Button>
                  </div>
                  {state.schedule.mode === 'at' ? (
                    <WhenPicker
                      did={asDid}
                      value={state.schedule.at}
                      onChange={(iso) => dispatch({ type: 'setSchedule', schedule: iso ? { mode: 'at', at: iso } : { mode: 'at', at: '' } })}
                      queue
                      onQueue={() => dispatch({ type: 'setSchedule', schedule: { mode: 'queue' } })}
                      min={new Date(Date.now() + 60_000).toISOString()}
                      max={new Date(Date.now() + 90 * 86_400_000).toISOString()}
                    />
                  ) : (
                    <p className="field-hint">
                      {queuePreview.status === 'loading'
                        ? 'Finding the next open time…'
                        : queuePreview.status === 'error'
                          ? 'Couldn’t read your queue just now; the time is found when you add it.'
                          : queuePreview.at
                            ? `Goes out at the next open time: ${new Date(queuePreview.at).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`
                            : 'Your weekly schedule has no open times in the next 90 days.'}{' '}
                      <button type="button" className="link-button" onClick={() => dispatch({ type: 'setSchedule', schedule: { mode: 'at', at: nextHour() } })}>
                        Pick a time instead
                      </button>
                    </p>
                  )}
                </section>
              )}
              {!whenOpen && state.schedule?.mode === 'queue' && (
                <p className="field-hint composer-timer-note">
                  <ListTree size={14} aria-hidden="true" /> Goes into your weekly queue.{' '}
                  <button type="button" className="link-button" onClick={() => setWhenOpen(true)}>
                    Change
                  </button>
                </p>
              )}
            </>
          )}

          {adviser.busyProps && <AdviserBusy {...adviser.busyProps} />}

          {busy && !busy.adviser && (
            <div className="composer-busy" role="status" aria-live="polite">
              <span className="progress composer-busy-bar" aria-hidden="true">
                <span className="progress-fill" data-indeterminate />
              </span>
              <span className="composer-busy-line">{busy.slow ? SLOW_PUBLISH_NOTE : busy.line || 'Working…'}</span>
              {busy.cancel && (
                <Button size="sm" variant="ghost" onClick={busy.cancel}>
                  Cancel
                </Button>
              )}
            </div>
          )}

          {error && (
            <div ref={errorRef} className="callout callout--danger composer-error" role="alert">
              <span>{error.text}</span>
              {error.reauth && (
                <Button size="sm" onClick={() => requestReauth(asDid, { immediate: true })}>
                  Sign back in
                </Button>
              )}
            </div>
          )}

          {dragOver && (
            <div className="composer-drop" aria-hidden="true">
              Drop images to add them to the post
            </div>
          )}
          <input ref={imageInput} type="file" accept={IMAGE_INPUT_ACCEPT} multiple hidden tabIndex={-1} onChange={(e) => onPickedFiles(e, 'image')} />
          <input ref={videoInput} type="file" accept={VIDEO_FILE_INPUT_ACCEPT} hidden tabIndex={-1} onChange={(e) => onPickedFiles(e, 'video')} />
        </div>
      </Dialog>

      {/* The dialogs the composer opens sit beside it, not inside it, so their
          Escape and backdrop presses are theirs alone. */}
      <AltTextDialog
        open={!!altTarget}
        onClose={() => setDialogs((d) => ({ ...d, alt: null }))}
        image={altTarget ? { file: altTarget.file, previewUrl: altTarget.previewUrl, alt: altTarget.alt } : null}
        onSave={(alt) => {
          const index = indexOfPost(dialogs.alt?.postId);
          if (index >= 0) dispatch({ type: 'updateImage', index, id: dialogs.alt.imageId, patch: { alt: String(alt || '').trim() } });
        }}
        did={asDid}
        requester={caps.canUseAi ? requester : null}
        context={altPost?.text || ''}
      />
      <VideoAltDialog
        open={!!videoAltPost}
        alt={videoAltPost?.video?.alt || ''}
        max={VIDEO_ALT_MAX_GRAPHEMES}
        onClose={() => setDialogs((d) => ({ ...d, videoAlt: null }))}
        onSave={(alt) => {
          const index = indexOfPost(videoAltPost?.id);
          const post = stateRef.current.posts[index];
          if (post?.video) dispatch({ type: 'setVideo', index, video: { ...post.video, alt } });
        }}
      />
      <LinkCardDialog
        open={!!cardPost?.card}
        card={cardPost?.card || null}
        onClose={() => setDialogs((d) => ({ ...d, card: null }))}
        onSave={(card) => {
          const index = indexOfPost(cardPost?.id);
          if (index >= 0) dispatch({ type: 'setCard', index, card });
        }}
      />
      <MetaDialog
        open={!!dialogs.meta}
        langs={state.langs}
        labels={state.labels}
        onClose={() => setDialogs((d) => ({ ...d, meta: false }))}
        onSave={({ langs, labels }) => {
          dispatch({ type: 'setLangs', langs });
          dispatch({ type: 'setLabels', labels });
        }}
      />
      <GatesDialog
        open={!!dialogs.gates}
        did={asDid}
        value={{ reply: state.gates.reply, quotes: state.gates.quotes }}
        sourceLine={gatesLine}
        onClose={() => setDialogs((d) => ({ ...d, gates: false }))}
        onSave={(gates) => dispatch({ type: 'setGates', gates })}
        onUseDefault={
          state.gates.custom
            ? () => {
                setDialogs((d) => ({ ...d, gates: false }));
                dispatch({ type: 'load', state: { ...stateRef.current, gates: { ...stateRef.current.gates, custom: false } } });
                setGeneration((g) => g + 1);
              }
            : null
        }
      />
      <LifespanDialog
        open={!!dialogs.timer}
        value={state.lifespan}
        fit={{ editingExisting: false, reply: replying, thread: state.posts.length > 1 }}
        publishAt={state.schedule?.mode === 'at' ? state.schedule.at : undefined}
        limits={limits.value}
        did={asDid}
        holds={state.source?.kind === 'scheduled' ? scheduledRowRef.current?.payload?.selfDestruct : null}
        note={timerNote}
        onClose={() => setDialogs((d) => ({ ...d, timer: false }))}
        onSave={(rule) => {
          lifespanTouched.current = true;
          dispatch({ type: 'setLifespan', lifespan: rule });
        }}
      />
      <ContinueThreadDialog
        open={!!dialogs.continue}
        status={continueState.status}
        items={continueState.items}
        error={continueState.error}
        onClose={() => setDialogs((d) => ({ ...d, continue: false }))}
        onPick={pickContinue}
        onRetry={openContinue}
      />
      <LibraryDialog
        open={!!libraryFor}
        onClose={() => setLibraryFor(null)}
        did={asDid}
        context={{
          state,
          reply: state.reply,
          postIndex: Math.max(0, libraryPost ? state.posts.indexOf(libraryPost) : 0),
          insertion: libraryFor?.range || null,
          templateRkey: libraryFor?.templateRkey || null,
        }}
        onPick={(plan) => {
          const target = libraryFor;
          setLibraryFor(null);
          applyPlan(plan, target?.postId || libraryPost?.id, target?.range || null);
        }}
      />
      <TemplateEditor open={!!templateSeed} onClose={() => setTemplateSeed(null)} did={asDid} seed={templateSeed || undefined} />
      <AdviserSheet {...adviser.sheetProps} />
      <ConfirmDialog ask={ask} onAnswer={answer} />
    </>
  );
}

/** The composer's shape while a draft or a scheduled post is read. */
function ComposerSkeleton({ label }) {
  return (
    <div className="composer-skeleton" role="status" aria-label={label}>
      <span className="visually-hidden">{label}…</span>
      <div className="post-block" aria-hidden="true">
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line skeleton-line--short" />
      </div>
      <div className="composer-options" aria-hidden="true">
        <span className="skeleton skeleton-chip" />
        <span className="skeleton skeleton-chip" />
        <span className="skeleton skeleton-chip" />
      </div>
    </div>
  );
}
