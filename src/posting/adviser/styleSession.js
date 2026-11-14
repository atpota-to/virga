// One sitting of the style dialog (ui/StyleDialog.jsx), without React: gather
// the account's recent posts once, read a style from them, and refine it from
// the writer's notes as often as they like against the same posts. Nothing is
// kept until the dialog saves; closing it drops the posts.
//
// Stages while working: 'gather' (reading posts from the AppView, with a
// running count), 'read' (the server has them), 'write' (shown a few seconds in,
// since the reading is one request and its second half is the writing).

import { fetchStylePostTexts, synthesizeStyleFromTexts } from './style.js';

export const STYLE_STAGES = Object.freeze([
  { id: 'gather', label: 'Gathering your recent posts' },
  { id: 'read', label: 'Reading for patterns' },
  { id: 'write', label: 'Writing the description' },
]);

/** When the label moves from reading to writing. */
export const WRITE_STAGE_FLIP_MS = 3500;

export const INITIAL_STYLE_VIEW = Object.freeze({
  phase: 'idle', // 'idle' | 'working' | 'result' | 'error'
  stage: 'gather',
  postCount: 0,
  summary: '',
  analyzedCount: 0,
  updatedAt: '',
  error: null, // { code, message }
  usage: null,
  fresh: false, // the summary came from this sitting, not the saved one
});

/** What to tell the writer about a failed reading. */
export function styleErrorMessage(err) {
  if (err?.code === 'not_enough_posts')
    return 'There aren’t enough posts to learn from yet. It needs at least 5 of your own posts.';
  if (err?.code === 'monthly_limit')
    return 'This month’s free style readings are used up. They start again on the first of the month.';
  if (err?.code === 'STYLE_FETCH_FAILED' || err?.code === 'EMPTY_STYLE')
    return err.message;
  if (err?.status >= 500 && !err?.detail)
    return 'The style reading didn’t finish. Try again.';
  return err?.message || 'The style reading didn’t finish. Try again.';
}

/** "Written from 212 of your posts · 12 Nov 2026", or ''. */
export function styleProfileLine(
  { analyzedCount, updatedAt } = {},
  { locale } = {},
) {
  const parts = [];
  if (analyzedCount > 0)
    parts.push(
      `Written from ${analyzedCount.toLocaleString('en-US')} of your posts`,
    );
  const at = updatedAt ? new Date(updatedAt) : null;
  if (at && !Number.isNaN(at.getTime()))
    parts.push(
      at.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    );
  return parts.join(' · ');
}

/**
 * @param {object} options
 * @param {string} options.did - the account the style is read from (the posting account)
 * @param {object|null} options.requester - its backendFor(did)
 * @param {object} [options.profile] - the saved styleProfile, shown first
 * @param {(view: object) => void} [options.onChange]
 * @param {Function} [options.fetchTexts] - style.fetchStylePostTexts
 * @param {Function} [options.synthesize] - style.synthesizeStyleFromTexts
 * @param {(fn: Function, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 */
export function createStyleSession({
  did,
  requester,
  profile = null,
  onChange = () => {},
  fetchTexts = fetchStylePostTexts,
  synthesize = synthesizeStyleFromTexts,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
} = {}) {
  let view = profile?.summary
    ? {
        ...INITIAL_STYLE_VIEW,
        phase: 'result',
        summary: profile.summary,
        analyzedCount: profile.analyzedCount || 0,
        updatedAt: profile.updatedAt || '',
      }
    : INITIAL_STYLE_VIEW;
  let texts = null;
  let run = 0;
  let flip = null;
  let controller = null;

  const set = (patch) => {
    view = { ...view, ...patch };
    onChange(view);
  };

  function stopTimers() {
    if (flip != null) clearTimer(flip);
    flip = null;
  }

  /**
   * Read the style. `guidance` is the writer's note, `previousSummary` the
   * description to start from (a refine), `again` reads the posts again.
   */
  async function start({
    sampleSize,
    guidance = '',
    previousSummary = '',
    again = false,
  } = {}) {
    const id = ++run;
    const alive = () => id === run;
    stopTimers();
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    if (again) texts = null;
    const had = view.phase === 'result' && !!view.summary;
    const haveTexts = Array.isArray(texts) && texts.length > 0;
    set({
      phase: 'working',
      stage: haveTexts ? 'read' : 'gather',
      postCount: haveTexts ? texts.length : 0,
      error: null,
    });
    try {
      if (!haveTexts) {
        const got = await fetchTexts(did, {
          sampleSize,
          signal,
          onPage: ({ posts }) => {
            if (alive()) set({ postCount: posts });
          },
        });
        if (!alive()) return;
        texts = got;
        set({ stage: 'read', postCount: got.length });
      }
      flip = setTimer(() => {
        if (alive()) set({ stage: 'write' });
      }, WRITE_STAGE_FLIP_MS);
      const result = await synthesize(requester, {
        texts,
        guidance,
        previousSummary,
        signal,
      });
      if (!alive()) return;
      stopTimers();
      set({
        phase: 'result',
        stage: 'write',
        summary: result.summary,
        analyzedCount: result.analyzedCount,
        updatedAt: result.updatedAt,
        usage: result.usage || view.usage,
        fresh: true,
      });
    } catch (err) {
      if (!alive() || err?.name === 'AbortError') return;
      stopTimers();
      const error = {
        code: err?.code || null,
        message: styleErrorMessage(err),
      };
      if (err?.code === 'monthly_limit') {
        const limit = err?.payload?.limit || 3;
        set({ usage: { used: err?.payload?.used ?? limit, limit } });
      }
      // A refine that fails keeps the description it started from.
      set({ phase: had ? 'result' : 'error', error });
    }
  }

  return {
    start,
    /** The writer edited the description by hand. */
    edit(summary) {
      set({ summary, fresh: true });
    },
    getView: () => view,
    hasPosts: () => Array.isArray(texts) && texts.length > 0,
    /** The dialog closed: drop what's in flight and the posts. */
    dispose() {
      run++;
      stopTimers();
      controller?.abort();
      texts = null;
    },
  };
}
