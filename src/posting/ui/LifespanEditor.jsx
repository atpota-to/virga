import { useEffect, useId, useMemo, useState } from 'react';
import Segmented from '../../components/Segmented.jsx';
import {
  ACTOR_TESTS,
  ALLOW_OPTIONS,
  EFFECTS,
  LIFESPAN_PRESETS,
  LIFESPAN_UNITS,
  MAX_ALLOW_RULES,
  METRICS,
  OPERATORS,
  clauseFor,
  describeAllow,
  effectFor,
  extendWindowSeconds,
  formatLifespan,
  lifespanFromParts,
  maxAmountForUnit,
  normalizeTimer,
  splitLifespan,
  allowEntryKey,
} from '../timers/selfDestruct.js';
import { publicXrpc } from '../library/sources.js';
import {
  EXTENSION_CHOICES,
  FOLLOWER_THRESHOLDS,
  curateLists,
  editorNotes,
  lengthChoice,
  patchRule,
  pinBounds,
  toggleAllow,
  toggleEffect,
  withAllow,
  withConditions,
  withLength,
  withMetric,
  withPin,
  withQuoteFilter,
} from './lifespanModel.js';
import '../pages/schedule.css';

function toLocalInput(value) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A row of buttons that each stay pressed while they're on. */
function Toggles({ label, labelledBy, children }) {
  return (
    <div
      className="lse-chips"
      role="group"
      aria-label={label}
      aria-labelledby={labelledBy}
    >
      {children}
    </div>
  );
}

/**
 * The whole timer rule: whether there is one, how long (a preset, a typed
 * length or an exact time), what it does (delete, limit replies, turn off
 * quotes), the conditions it reads first and what happens to a post that
 * meets them, with the rule in a sentence underneath and anything that stops
 * it applying to this post.
 *
 * `value` is a TimerRule (timers/selfDestruct.js) and `onChange` hears the
 * whole next rule. `fit` says what the post is (`{ editingExisting?, reply?,
 * thread? }`), `publishAt` when it goes out (else now), `limits` the
 * account's (getLimits), for the free-timer check.
 *
 * Optional: `did` (the writer; offers its lists for "Limit replies"),
 * `allowExactTime` (default true), `showToggle` (default true) with
 * `toggleLabel`, `holds` (the timer the post already has, which frees its
 * slot), and `countFrom` ('wentUp' or 'now', for a post that's already out:
 * what the sentence says a length counts from).
 */
export default function LifespanEditor({
  value,
  onChange,
  fit = {},
  publishAt,
  limits,
  did = null,
  allowExactTime = true,
  showToggle = true,
  toggleLabel = 'Put a timer on this post',
  holds = null,
  countFrom = 'goesUp',
}) {
  const id = useId();
  const rule = useMemo(() => normalizeTimer(value), [value]);
  const emit = (next) => onChange?.(normalizeTimer(next));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const choice = lengthChoice(rule);
  const [custom, setCustom] = useState(() => {
    const s = splitLifespan(rule.lifespanSeconds);
    return { amount: String(s.amount), unit: s.unit };
  });
  const [openLength, setOpenLength] = useState(
    choice === 'custom' ? 'custom' : choice === 'exact' ? 'exact' : null,
  );
  useEffect(() => {
    if (choice === 'exact') setOpenLength('exact');
    else if (choice === 'custom')
      setOpenLength((o) => (o === 'exact' ? 'custom' : o || 'custom'));
  }, [choice]);
  const customSeconds = lifespanFromParts(custom.amount, custom.unit);

  // The writer's lists, for "Limit replies".
  const [lists, setLists] = useState([]);
  useEffect(() => {
    if (!did) return undefined;
    let live = true;
    publicXrpc('app.bsky.graph.getLists', { actor: did, limit: 50 }).then(
      (body) => live && setLists(curateLists(body?.lists)),
      () => live && setLists([]),
    );
    return () => {
      live = false;
    };
  }, [did]);

  const notes = editorNotes(rule, {
    fit,
    publishAt,
    limits,
    holds,
    countFrom,
    now,
  });
  const deletes = rule.effects.some((e) => e.action === 'delete');
  const gate = effectFor(rule.effects, 'limitReplies');
  const allow = gate?.allow || [];
  const allowChoices = [...lists];
  for (const entry of allow)
    if (
      typeof entry === 'object' &&
      !allowChoices.some((l) => l.list === entry.list)
    )
      allowChoices.push(entry);
  const quoteClause = clauseFor(rule.conditions, 'quotes');
  const quoteFilter = quoteClause?.from || null;
  const clauses = rule.conditions.clauses;
  const bounds = pinBounds(
    Number.isFinite(Date.parse(publishAt || '')) ? Date.parse(publishAt) : now,
  );
  const windowPhrase = formatLifespan(
    extendWindowSeconds(
      rule,
      Number.isFinite(Date.parse(publishAt || ''))
        ? Date.parse(publishAt)
        : now,
    ),
  );

  return (
    <div className="lifespan-editor">
      {showToggle && (
        <div className="lse-switch-row">
          <button
            type="button"
            role="switch"
            className="switch"
            id={`${id}-on`}
            aria-checked={rule.enabled}
            aria-labelledby={`${id}-on-label`}
            aria-describedby={`${id}-on-hint`}
            onClick={() => emit(patchRule(rule, { enabled: !rule.enabled }))}
          />
          <label
            htmlFor={`${id}-on`}
            id={`${id}-on-label`}
            className="lse-switch-label"
          >
            {toggleLabel}
          </label>
          <p className="field-hint lse-switch-hint" id={`${id}-on-hint`}>
            {rule.enabled
              ? 'Virga’s server acts on the post at its time, even with this browser closed.'
              : 'No timer: the post stays up until you delete it.'}
          </p>
        </div>
      )}

      {(rule.enabled || !showToggle) && (
        <>
          <fieldset className="lse-block">
            <legend className="lse-legend" id={`${id}-len`}>
              {deletes ? 'Delete it after' : 'Act on it after'}
            </legend>
            <Toggles labelledBy={`${id}-len`}>
              {LIFESPAN_PRESETS.map((p) => (
                <button
                  key={p.seconds}
                  type="button"
                  className="chip"
                  aria-pressed={choice === String(p.seconds)}
                  onClick={() => {
                    setOpenLength(null);
                    const s = splitLifespan(p.seconds);
                    setCustom({ amount: String(s.amount), unit: s.unit });
                    emit(withLength(rule, p.seconds));
                  }}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className="chip"
                aria-pressed={choice === 'custom'}
                aria-expanded={openLength === 'custom'}
                aria-controls={`${id}-custom`}
                onClick={() => {
                  setOpenLength('custom');
                  if (choice === 'exact' && customSeconds)
                    emit(withLength(rule, customSeconds));
                }}
              >
                Another length
              </button>
              {allowExactTime && (
                <button
                  type="button"
                  className="chip"
                  aria-pressed={choice === 'exact'}
                  aria-expanded={openLength === 'exact'}
                  aria-controls={`${id}-exact`}
                  onClick={() => setOpenLength('exact')}
                >
                  A set time
                </button>
              )}
            </Toggles>

            {openLength === 'custom' && (
              <div className="lse-inline" id={`${id}-custom`}>
                <label className="field lse-amount" htmlFor={`${id}-amount`}>
                  <span className="field-label">Length</span>
                  <input
                    id={`${id}-amount`}
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxAmountForUnit(custom.unit)}
                    step={1}
                    value={custom.amount}
                    aria-describedby={`${id}-custom-hint`}
                    aria-invalid={customSeconds === null ? true : undefined}
                    onChange={(e) => {
                      const next = { ...custom, amount: e.target.value };
                      setCustom(next);
                      const s = lifespanFromParts(next.amount, next.unit);
                      if (s) emit(withLength(rule, s));
                    }}
                  />
                </label>
                <label className="field lse-unit" htmlFor={`${id}-unit`}>
                  <span className="field-label">Unit</span>
                  <select
                    id={`${id}-unit`}
                    className="input"
                    value={custom.unit}
                    onChange={(e) => {
                      const next = { ...custom, unit: e.target.value };
                      setCustom(next);
                      const s = lifespanFromParts(next.amount, next.unit);
                      if (s) emit(withLength(rule, s));
                    }}
                  >
                    {LIFESPAN_UNITS.map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p
                  className="field-hint lse-hint-wide"
                  id={`${id}-custom-hint`}
                >
                  {customSeconds === null
                    ? `Between 5 minutes and 30 days: at most ${maxAmountForUnit(custom.unit)} ${custom.unit}.`
                    : `${formatLifespan(customSeconds)} after it goes up.`}
                </p>
              </div>
            )}

            {allowExactTime && openLength === 'exact' && (
              <div className="lse-inline" id={`${id}-exact`}>
                <label className="field" htmlFor={`${id}-at`}>
                  <span className="field-label">Date and time</span>
                  <input
                    id={`${id}-at`}
                    className="input"
                    type="datetime-local"
                    value={toLocalInput(rule.deleteAt)}
                    min={toLocalInput(bounds.min)}
                    max={toLocalInput(bounds.max)}
                    aria-describedby={`${id}-exact-hint`}
                    onChange={(e) => {
                      const t = Date.parse(e.target.value);
                      emit(
                        withPin(
                          rule,
                          Number.isFinite(t) ? new Date(t).toISOString() : null,
                        ),
                      );
                    }}
                  />
                </label>
                <p className="field-hint lse-hint-wide" id={`${id}-exact-hint`}>
                  In this device’s time. At least 5 minutes and at most 30 days
                  after it goes up.
                  {rule.deleteAt &&
                    ` Without a set time it would use ${formatLifespan(rule.lifespanSeconds)}.`}
                </p>
              </div>
            )}
          </fieldset>

          <fieldset className="lse-block">
            <legend className="lse-legend" id={`${id}-does`}>
              What happens then
            </legend>
            <Toggles labelledBy={`${id}-does`}>
              {EFFECTS.map((effect) => {
                const blocked = effect.key === 'limitReplies' && fit.reply;
                return (
                  <button
                    key={effect.key}
                    type="button"
                    className="chip"
                    aria-pressed={!!effectFor(rule.effects, effect.key)}
                    disabled={blocked && !effectFor(rule.effects, effect.key)}
                    title={
                      blocked
                        ? 'A reply can’t limit who replies to it.'
                        : undefined
                    }
                    onClick={() => emit(toggleEffect(rule, effect.key))}
                  >
                    {effect.label}
                  </button>
                );
              })}
            </Toggles>

            {gate && (
              <div className="lse-sub">
                <span className="field-label" id={`${id}-allow`}>
                  Who can still reply
                </span>
                <Toggles labelledBy={`${id}-allow`}>
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={allow.length === 0}
                    onClick={() => emit(withAllow(rule, []))}
                  >
                    Nobody
                  </button>
                  {ALLOW_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      className="chip"
                      aria-pressed={allow.includes(o.key)}
                      onClick={() =>
                        emit(withAllow(rule, toggleAllow(allow, o.key)))
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                  {allowChoices.map((l) => (
                    <button
                      key={l.list}
                      type="button"
                      className="chip"
                      aria-pressed={allow.some(
                        (a) => allowEntryKey(a) === allowEntryKey(l),
                      )}
                      onClick={() =>
                        emit(withAllow(rule, toggleAllow(allow, l)))
                      }
                    >
                      {l.name ? `People in ${l.name}` : 'People in a list'}
                    </button>
                  ))}
                </Toggles>
                <p className="field-hint">
                  {allow.length === 0
                    ? 'Nobody can reply once it acts.'
                    : `Only ${describeAllow(allow)} can reply once it acts.`}
                  {allow.length >= MAX_ALLOW_RULES &&
                    ` That’s the most Bluesky takes (${MAX_ALLOW_RULES}).`}
                </p>
              </div>
            )}
          </fieldset>

          <fieldset className="lse-block">
            <legend className="lse-legend">Conditions (optional)</legend>
            <p className="field-hint">
              Leave these empty to act on time, whatever happens. Counts are
              read from Bluesky when it’s due.
            </p>
            <Segmented
              size="sm"
              label="How the conditions work"
              value={rule.conditions.sense}
              onChange={(sense) => emit(withConditions(rule, { sense }))}
              options={[
                { value: 'unless', label: 'Unless it reaches' },
                { value: 'onlyIf', label: 'Only if it reaches' },
              ]}
            />
            <div className="lse-metrics">
              {METRICS.map((m) => {
                const clause = clauseFor(rule.conditions, m.key);
                return (
                  <div key={m.key} className="lse-metric">
                    <label
                      className="lse-metric-name"
                      htmlFor={`${id}-m-${m.key}`}
                    >
                      {m.label}
                    </label>
                    <select
                      className="input lse-op"
                      aria-label={`${m.label}: how to compare`}
                      value={clause?.op || 'gte'}
                      disabled={!clause}
                      onChange={(e) =>
                        emit(
                          withMetric(rule, m.key, {
                            op: e.target.value,
                            value: clause?.value,
                          }),
                        )
                      }
                    >
                      {OPERATORS.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.symbol} {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      id={`${id}-m-${m.key}`}
                      className="input lse-value"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={1_000_000}
                      placeholder="off"
                      value={clause?.value ?? ''}
                      onChange={(e) =>
                        emit(
                          withMetric(rule, m.key, {
                            op: clause?.op || 'gte',
                            value: e.target.value,
                          }),
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>

            {quoteClause && (
              <div className="lse-sub">
                <span className="field-label" id={`${id}-from`}>
                  Count quotes from
                </span>
                <div
                  className="lse-checks"
                  role="group"
                  aria-labelledby={`${id}-from`}
                >
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!quoteFilter?.notFollowed}
                      onChange={(e) =>
                        emit(
                          withQuoteFilter(rule, {
                            notFollowed: e.target.checked,
                          }),
                        )
                      }
                    />
                    {ACTOR_TESTS[0].label}
                  </label>
                  <span className="lse-check-with">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={quoteFilter?.followersOver != null}
                        onChange={(e) =>
                          emit(
                            withQuoteFilter(rule, {
                              followersOver: e.target.checked ? 10000 : null,
                            }),
                          )
                        }
                      />
                      People with over
                    </label>
                    <select
                      className="input lse-op"
                      aria-label="Followers, at least"
                      value={quoteFilter?.followersOver ?? 10000}
                      disabled={quoteFilter?.followersOver == null}
                      onChange={(e) =>
                        emit(
                          withQuoteFilter(rule, {
                            followersOver: Number(e.target.value),
                          }),
                        )
                      }
                    >
                      {FOLLOWER_THRESHOLDS.map((n) => (
                        <option key={n} value={n}>
                          {n.toLocaleString()} followers
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
                {quoteFilter?.notFollowed &&
                  quoteFilter?.followersOver != null && (
                    <Segmented
                      size="sm"
                      label="Which quoters count"
                      value={quoteFilter.match}
                      onChange={(match) =>
                        emit(withQuoteFilter(rule, { match }))
                      }
                      options={[
                        { value: 'any', label: 'Either one' },
                        { value: 'all', label: 'Both' },
                      ]}
                    />
                  )}
                {!quoteFilter && (
                  <p className="field-hint">
                    Leave both off to count every quote.
                  </p>
                )}
              </div>
            )}

            {clauses.length > 1 && (
              <div className="lse-sub">
                <span className="field-label">When there’s more than one</span>
                <Segmented
                  size="sm"
                  label="When there’s more than one condition"
                  value={rule.conditions.logic}
                  onChange={(logic) => emit(withConditions(rule, { logic }))}
                  options={[
                    { value: 'any', label: 'Any one of them' },
                    { value: 'all', label: 'All of them' },
                  ]}
                />
              </div>
            )}

            {clauses.length > 0 && (
              <div className="lse-sub">
                <span className="field-label">
                  {rule.conditions.sense === 'onlyIf'
                    ? 'If it doesn’t'
                    : 'If it does'}
                </span>
                <div className="lse-spare">
                  <Segmented
                    size="sm"
                    label="What happens to a post that's spared"
                    value={rule.conditions.onSpare}
                    onChange={(onSpare) =>
                      emit(withConditions(rule, { onSpare }))
                    }
                    options={[
                      {
                        value: 'keep',
                        label: deletes ? 'Keep it for good' : 'Leave it alone',
                      },
                      {
                        value: 'extend',
                        label: deletes
                          ? `Give it another ${windowPhrase}`
                          : `Check again in ${windowPhrase}`,
                      },
                    ]}
                  />
                  {rule.conditions.onSpare === 'extend' && (
                    <label className="lse-inline-field">
                      <span>At most</span>
                      <select
                        className="input lse-op"
                        value={rule.conditions.maxExtensions}
                        onChange={(e) =>
                          emit(
                            withConditions(rule, {
                              maxExtensions: Number(e.target.value),
                            }),
                          )
                        }
                      >
                        {EXTENSION_CHOICES.map((n) => (
                          <option key={n} value={n}>
                            {n === 1 ? 'once' : `${n} times`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            )}
          </fieldset>

          <div className="lse-summary" aria-live="polite">
            {notes.summary ? (
              <p className="lse-sentence">{notes.summary}</p>
            ) : (
              <p className="lse-sentence lse-sentence--off">
                {showToggle ? 'This post gets no timer.' : 'No timer.'}
              </p>
            )}
            {notes.thread && <p className="field-hint">{notes.thread}</p>}
          </div>
          {notes.fitNote && (
            <p className="callout callout--warn">{notes.fitNote}</p>
          )}
          {notes.unavailable && (
            <p className="callout callout--warn">{notes.unavailable}</p>
          )}
          {notes.pin && (
            <p className="callout callout--warn" role="status">
              {notes.pin}
            </p>
          )}
          {notes.room && (
            <p className="callout callout--warn" role="status">
              {notes.room}
            </p>
          )}
        </>
      )}
    </div>
  );
}
