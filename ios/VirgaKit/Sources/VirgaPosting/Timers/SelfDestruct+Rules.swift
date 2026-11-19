// Ports src/posting/timers/selfDestruct.js
//
// Changing a rule (gates from the reply settings, effects), fitting it to
// the post it is on, judging a pinned instant against the publish moment,
// what each publish path sends, reading a stored rule, and the timer of a
// draft. The sentences these refuse with are in SelfDestruct+Words.swift.

import Foundation
import VirgaCore

extension SelfDestruct {
  // MARK: - Gates from the reply settings

  /// Toggle a gate effect on the timer from the reply-settings (thread
  /// restrictions) side. Turning a gate on with no armed rule arms a
  /// gate-only rule (never a delete); turning the last effect off disarms
  /// the timer instead of falling back to deletion as the Lifespan editor
  /// would.
  ///
  /// Arming from disarmed starts clean: conditions cleared, spare action
  /// defaulted, pinned deleteAt dropped. A disarmed timer can still carry an
  /// old rule that this section never shows.
  public static func withScheduledGateChange(_ timer: some TimerRuleInput, _ action: String, _ on: Bool) -> TimerRule {
    var t = normalizeTimer(timer)
    guard let gate = TimerAction(rawValue: action), blueskyOnlyEffects.contains(gate) else { return t }
    if on {
      if t.enabled {
        t.effects = withEffect(t.effects, action, true)
        return normalizeTimer(t)
      }
      t.enabled = true
      t.deleteAt = nil
      t.conditions = normalizeConditions(JSONValue.object([:]))
      t.effects = [normalizeEffect(["action": .string(action)])!]
      return normalizeTimer(t)
    }
    let kept = normalizeEffects(t.effects).filter { $0.action != gate }
    if kept.isEmpty {
      t.enabled = false
      return normalizeTimer(t)
    }
    t.effects = kept
    return normalizeTimer(t)
  }

  /// Set the deadline from the reply-settings side; drops any pinned
  /// instant, which would otherwise win.
  public static func withScheduledGateLifespan(_ timer: some TimerRuleInput, _ seconds: JSONValue?) -> TimerRule {
    var t = normalizeTimer(timer)
    t.lifespanSeconds = normalizeLifespan(seconds)
    t.deleteAt = nil
    return normalizeTimer(t)
  }

  public static func withScheduledGateLifespan(_ timer: some TimerRuleInput, _ seconds: Int) -> TimerRule {
    withScheduledGateLifespan(timer, .number(Double(seconds)))
  }

  /// The timer's gate effects seen from the reply-settings side.
  public static func scheduledGateChange(_ timer: some TimerRuleInput) -> ScheduledGateChange {
    let t = normalizeTimer(timer)
    if !t.enabled { return ScheduledGateChange(limitReplies: nil, disableQuotes: false) }
    return ScheduledGateChange(
      limitReplies: effectFor(t.effects, "limitReplies"),
      disableQuotes: effectFor(t.effects, "disableQuotes") != nil)
  }

  /// The effects with `action` turned on or off; `extra` is spread over
  /// `{ action }` (an `allow` for limitReplies).
  public static func withEffect(
    _ effects: some TimerEffectsInput, _ action: String, _ on: Bool, _ extra: JSONValue = [:]
  ) -> [TimerEffect] {
    let rest = normalizeEffects(effects).filter { $0.action.rawValue != action }
    if !on { return rest }
    var raw: [String: JSONValue] = ["action": .string(action)]
    for (key, value) in extra.objectValue ?? [:] { raw[key] = value }
    guard let next = normalizeEffect(.object(raw)) else { return rest }
    return TimerJS.v8Sorted(rest + [next]) { Double(effectOrder($0.action) - effectOrder($1.action)) }
  }

  /// The timer without gate effects, for a record with no threadgate or
  /// postgate; the server refuses gate effects on those. A rule left with no
  /// effects disarms rather than falling back to delete.
  public static func withoutGateEffects(_ timer: some TimerRuleInput) -> TimerRule {
    withoutEffects(timer, blueskyOnlyEffects.map(\.rawValue))
  }

  /// The timer without the named effects; disarms rather than deleting when
  /// nothing is left.
  public static func withoutEffects(_ timer: some TimerRuleInput, _ actions: [String]) -> TimerRule {
    var t = normalizeTimer(timer)
    if !t.enabled { return t }
    let all = normalizeEffects(t.effects)
    let kept = all.filter { !actions.contains($0.action.rawValue) }
    if kept.count == all.count { return t }
    if kept.isEmpty {
      t.enabled = false
      return normalizeTimer(t)
    }
    t.effects = kept
    return normalizeTimer(t)
  }

  /// The timer without conditions, for a record with no public counts (the
  /// server only evaluates app.bsky.feed.post).
  ///   'unless'  clauses dropped; the rule runs on time unconditionally.
  ///   'onlyIf'  the rule disarms, since dropping the clauses would turn
  ///             "delete only if" into "delete".
  public static func withoutConditions(_ timer: some TimerRuleInput) -> TimerRule {
    var t = normalizeTimer(timer)
    if !t.enabled || t.conditions.clauses.isEmpty { return t }
    if t.conditions.sense == .onlyIf {
      t.enabled = false
      return normalizeTimer(t)
    }
    t.conditions = normalizeConditions(JSONValue.object([:]))
    return normalizeTimer(t)
  }

  // MARK: - Fitting

  /// The timer a particular post can actually carry, derived from the
  /// writer's rule. Fitting is lossy, so callers keep the rule as set and
  /// derive this for display and sending; never store the result back over
  /// the rule.
  ///
  ///   gatesSupported        only an app.bsky.feed.post has a threadgate/postgate
  ///   conditionsSupported   only an app.bsky.feed.post has counts to read
  ///                         (both always true for what Virga posts; kept so
  ///                         the rule model matches the server's)
  ///   replyLimitSupported   Bluesky honours a threadgate only on a thread's
  ///                         root, so replies drop limitReplies
  ///                         (disableQuotes is a postgate and stays)
  ///   available             whether the server can hold a timer at all
  public static func fitTimerToPost(_ timer: some TimerRuleInput, _ fit: TimerFit = TimerFit()) -> TimerRule {
    var t = normalizeTimer(timer)
    if !fit.available {
      if t.enabled {
        t.enabled = false
        return normalizeTimer(t)
      }
      return t
    }
    if !fit.gatesSupported {
      t = withoutEffects(t, blueskyOnlyEffects.map(\.rawValue))
    } else if !fit.replyLimitSupported {
      t = withoutEffects(t, ["limitReplies"])
    }
    if !fit.conditionsSupported { t = withoutConditions(t) }
    return t
  }

  /// Whether two timers would do the same thing (any two disarmed ones do).
  public static func sameTimer(_ a: some TimerRuleInput, _ b: some TimerRuleInput) -> Bool {
    let x = normalizeTimer(a)
    let y = normalizeTimer(b)
    if !x.enabled && !y.enabled { return true }
    return TimerJS.sameJSON(x, y)
  }

  /// The rule to keep after an edit in an editor that showed the fitted
  /// timer. Parts the fit hid (conditions, gate effects) are carried over
  /// from the stored rule, but only if doing so doesn't change the timer for
  /// this post (e.g. a hidden 'onlyIf' clause would disarm it, so it gives
  /// way to the edit).
  public static func keepHiddenRuleParts(
    _ edited: some TimerRuleInput, _ stored: some TimerRuleInput, _ fit: TimerFit = TimerFit()
  ) -> TimerRule {
    let e = normalizeTimer(edited)
    let s = normalizeTimer(stored)
    if !s.enabled { return e }
    var merged = e
    if !fit.conditionsSupported && !s.conditions.clauses.isEmpty { merged.conditions = s.conditions }
    let hiddenActions: [TimerAction] =
      !fit.gatesSupported ? blueskyOnlyEffects : !fit.replyLimitSupported ? [.limitReplies] : []
    let hidden = s.effects.filter { hiddenActions.contains($0.action) }
    if !hidden.isEmpty {
      merged.effects = e.effects.filter { !hiddenActions.contains($0.action) } + hidden
    }
    merged = normalizeTimer(merged)
    return sameTimer(fitTimerToPost(merged, fit), fitTimerToPost(e, fit)) ? merged : e
  }

  // MARK: - Pinned instants and publishing

  /// How long a picked time may have passed and still mean "as soon as
  /// allowed" rather than be refused. Must match PAST_DEADLINE_GRACE_MS in
  /// the server.
  public static let pastDeadlineGraceSeconds = 60

  /// Where a timer's pinned instant stands against the publish moment
  /// (epoch ms; NaN compares false everywhere, so reads 'ok').
  ///
  ///   'none'     no pin (or no timer): the duration decides
  ///   'ok'       between minLifespan and maxLifespan after publish
  ///   'tooSoon'  under minLifespan after publish, or passed within
  ///              pastDeadlineGraceSeconds (means "as soon as allowed")
  ///   'passed'   passed longer ago than the grace; refused
  ///   'tooLate'  more than maxLifespan after publish
  public static func pinnedDeadlineStatus(_ timer: some TimerRuleInput, _ publishAt: Double) -> String {
    let t = normalizeTimer(timer)
    guard t.enabled, let deleteAt = t.deleteAt else { return "none" }
    let at = isoMs(deleteAt)
    let from = VirgaCore.JSDate.timeClip(publishAt)
    if at < from - Double(pastDeadlineGraceSeconds) * 1000 { return "passed" }
    if at < from + Double(minLifespanSeconds) * 1000 { return "tooSoon" }
    if at > from + Double(maxLifespanSeconds) * 1000 { return "tooLate" }
    return "ok"
  }

  /// The timer a just-published post actually gets. Runs after
  /// immediateTimerProblem cleared the pin, so any staleness is publish
  /// latency: a 'tooSoon'/'passed' pin becomes the minLifespan floor (never
  /// the duration behind it). A pin past the ceiling is left for the server
  /// to refuse.
  public static func settleForPublish(_ timer: some TimerRuleInput, _ now: Double) -> SettledTimer {
    var t = normalizeTimer(timer)
    let status = pinnedDeadlineStatus(t, now)
    if status == "tooSoon" || status == "passed" {
      t.deleteAt = nil
      t.lifespanSeconds = minLifespanSeconds
      return SettledTimer(timer: t, adjusted: "floor")
    }
    return SettledTimer(timer: t, adjusted: nil)
  }

  /// The timer an immediate publish arms: fitTimerToPost, then
  /// settleForPublish. The composer's arm step is exactly this.
  public static func immediateTimerToSend(
    _ rule: some TimerRuleInput, _ fit: TimerFit = TimerFit(), now: Double
  ) -> ImmediateTimerSend {
    let settled = settleForPublish(fitTimerToPost(rule, fit), now)
    return ImmediateTimerSend(timer: settled.timer, adjusted: settled.adjusted, spec: toWireSpec(settled.timer, now))
  }

  /// What a scheduled post carries: the rule fitted as the composer shows it
  /// (`fit`), checked and measured against publishAt (the scheduled time,
  /// since a scheduled post's window runs from when it goes out). `now`,
  /// `locale` and `timeZone` are only for the words of a refusal (its "today
  /// at" is said from the clock, as on the web).
  public static func scheduledTimerToSend(
    _ rule: some TimerRuleInput, fit: TimerFit = TimerFit(), publishAt: Double, now: Double,
    locale: String? = nil, timeZone: TimeZone? = nil
  ) -> ScheduledTimerSend {
    let timer = fitTimerToPost(rule, fit)
    let problem = scheduledTimerProblem(timer, publishAt, now: now, locale: locale, timeZone: timeZone)
    return ScheduledTimerSend(problem: problem, spec: problem.isEmpty ? toWireSpec(timer, publishAt) : nil)
  }

  /// A scheduled row's `payload.selfDestruct` as an armed timer, or nil
  /// when it has none or no pin.
  static func pinnedRowSpec(_ row: JSONValue?) -> JSONValue? {
    guard let spec = row?["payload"]?["selfDestruct"], spec.isTruthy, spec["deleteAt"]?.isTruthy == true
    else { return nil }
    var fields = spec.objectValue ?? [:]
    fields["enabled"] = true
    return .object(fields)
  }

  /// Why moving a scheduled row to `whenISO` would break its pinned delete
  /// time, or ''. Catches reorders the server would refuse.
  public static func scheduledRowTimerProblem(
    _ row: JSONValue?, _ whenISO: String?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    guard let spec = pinnedRowSpec(row) else { return "" }
    return scheduledTimerProblem(
      spec, TimerJS.dateMs(whenISO.map(JSONValue.string), timeZone: timeZone), now: now, locale: locale,
      timeZone: timeZone)
  }

  /// Where a scheduled row's pinned delete time stands against `whenISO`
  /// (pinnedDeadlineStatus).
  public static func scheduledRowDeadlineStatus(_ row: JSONValue?, _ whenISO: String?, timeZone: TimeZone? = nil)
    -> String
  {
    guard let spec = pinnedRowSpec(row) else { return "none" }
    return pinnedDeadlineStatus(spec, TimerJS.dateMs(whenISO.map(JSONValue.string), timeZone: timeZone))
  }

  /// The `fit` (see fitTimerToPost) for the post in the composer; every
  /// surface and both sends use it.
  ///
  ///   reply            the post is a reply (Bluesky honours a threadgate
  ///                    only on a thread's root)
  ///   unavailable      the server said it cannot hold a timer, or the
  ///                    account isn't signed in through it
  ///   editingExisting  no timer: changing an existing post isn't
  ///                    publishing one
  ///
  /// `available` means "can this post carry a timer", not just "is the
  /// server up"; otherwise a hidden, stale pin would still block a publish.
  public static func composerTimerFit(
    editingExisting: Bool = false, unavailable: Bool = false, reply: Bool = false
  ) -> TimerFit {
    TimerFit(
      gatesSupported: true, conditionsSupported: true, replyLimitSupported: !reply,
      available: !unavailable && !editingExisting)
  }

  /// composerTimerFit from a loose options object (truthiness, as the web
  /// reads it).
  public static func composerTimerFit(_ options: JSONValue?) -> TimerFit {
    composerTimerFit(
      editingExisting: options?["editingExisting"]?.isTruthy ?? false,
      unavailable: options?["unavailable"]?.isTruthy ?? false,
      reply: options?["reply"]?.isTruthy ?? false)
  }

  /// The window a spared post gets again under `onSpare: 'extend'`: the
  /// duration, or for a pinned instant, now → the pin. Mirrors what the
  /// server stores in lifespan_seconds (server/timers/selfDestruct.js,
  /// validateArm).
  public static func extendWindowSeconds(_ timer: some TimerRuleInput, _ now: Double) -> Int {
    let t = normalizeTimer(timer)
    guard let deleteAt = t.deleteAt else { return t.lifespanSeconds }
    return normalizeLifespan(((isoMs(deleteAt) - now) / 1000).jsRounded)
  }

  /// The wire shape the server expects, or nil when disarmed.
  /// `lifespanSeconds` is the extend window measured client-side
  /// (server-side derivation would include publish latency); the server
  /// uses it as given and `deleteAt` only as the deadline. `now` is the
  /// publish moment (the scheduled time for a scheduled post).
  public static func toWireSpec(_ timer: some TimerRuleInput, _ now: Double) -> TimerWireSpec? {
    let t = settleForPublish(timer, now).timer
    if !t.enabled { return nil }
    return TimerWireSpec(
      lifespanSeconds: extendWindowSeconds(t, now),
      conditions: t.conditions,
      // List display names are client-only; send just the URIs.
      effects: t.effects.map { effect in
        guard effect.action == .limitReplies else { return effect }
        return TimerEffect(
          action: .limitReplies,
          allow: (effect.allow ?? []).map { entry in
            if case .list(let uri, _) = entry { return .list(uri, name: nil) }
            return entry
          })
      },
      deleteAt: t.deleteAt)
  }

  // MARK: - Stored rules

  /// The parts of a stored rule this build cannot read, as phrases.
  ///
  /// The normalizers are lenient in a harsh direction: an unrecognised
  /// clause is dropped (turning a conditional timer into an unconditional
  /// delete) and an unrecognised effect falls back to delete. The server's
  /// validateArm refuses unknown parts, but it only ever sees the normalized
  /// rule, so the check has to happen here. Happens when an older build
  /// reads posting defaults written by a newer one.
  ///
  /// Not flagged: a threshold of 0, the stored encoding for "not part of the
  /// test"; toWireSpec drops those clauses before the server sees them.
  /// Empty when the whole rule was understood.
  public static func unreadableRuleParts(_ raw: JSONValue?) -> [String] {
    let src = TimerJS.members(raw)
    var out: [String] = []
    let conditions = TimerJS.members(src["conditions"])

    // A silent fallback on sense would invert the rule.
    if let sense = conditions["sense"], oneOf(sense, ConditionSense.self) == nil {
      out.append("which way its conditions point")
    }
    if let logic = conditions["logic"], oneOf(logic, ConditionLogic.self) == nil {
      out.append("whether its conditions need one match or all of them")
    }

    for item in conditions["clauses"]?.arrayValue ?? [] {
      guard item.isTruthy, TimerJS.isObject(item) else {
        out.append("a condition that could not be read")
        continue
      }
      if let metric = item["metric"], oneOf(metric, TimerMetric.self) == nil {
        out.append("a condition about “\(metric.jsString)”")
        continue
      }
      // An unknown op falls back to "at least", which can invert the clause.
      if let op = item["op"], oneOf(op, TimerOperator.self) == nil {
        out.append("how one of its conditions compares its number")
        continue
      }
      // A who-filter that normalizes away would widen the clause to everyone.
      if let from = item["from"], !from.isNull, normalizeActorFilter(from) == nil {
        out.append("who one of its conditions is about")
      }
    }

    for item in src["effects"]?.arrayValue ?? [] {
      guard item.isTruthy, TimerJS.isObject(item) else {
        out.append("something it was set to do")
        continue
      }
      if let action = item["action"], oneOf(action, TimerAction.self) == nil {
        out.append("what “\(action.jsString)” was meant to do")
      }
    }
    return out
  }

  /// Read a stored rule; anything unreadable disarms it (a kept post can be
  /// deleted by hand, a wrongly deleted one can't be restored).
  public static func readStoredTimer(_ raw: JSONValue?) -> StoredTimer {
    let unreadable = unreadableRuleParts(raw)
    var timer = normalizeTimer(raw)
    if !unreadable.isEmpty { timer.enabled = false }
    return StoredTimer(timer: timer, unreadable: unreadable)
  }

  // Drafts. A saved draft (a Bluesky private draft) has no field for a
  // timer, so saving drops it and the composer resets to the default. The
  // composer's local autosave does carry it.

  /// The posting default as a rule, from the account's posting settings
  /// (`settings.lifespan`, whose `enabled` means "new posts get this
  /// timer"): always a length, never a pinned instant. Read via
  /// readStoredTimer, so unreadable parts disarm it. `defaultOn` is the same
  /// switch under the name Anisota's settings record uses.
  public static func defaultRuleFromSettings(_ lifespan: JSONValue?) -> TimerRule {
    var src = TimerJS.members(lifespan)
    let enabled = src["enabled"].map(\.isTruthy) ?? (src["defaultOn"]?.isTruthy ?? false)
    src["deleteAt"] = .null
    src["enabled"] = .bool(enabled)
    return readStoredTimer(.object(src)).timer
  }

  /// The timer as the session draft keeps it. Only a `touched` timer is
  /// restored; an untouched one follows the default.
  public static func sessionDraftTimer(_ timer: some TimerRuleInput, _ touched: Bool) -> SessionDraftTimer {
    SessionDraftTimer(timer: normalizeTimer(timer), touched: touched)
  }

  /// The timer to put back from a session draft, or nil to leave the
  /// default. A pin that has 'passed' comes back disarmed and unpinned with
  /// `expired: true` (still the writer's; the default doesn't take its
  /// place).
  public static func restoreSessionDraftTimer(_ saved: JSONValue?, now: Double) -> RestoredDraftTimer? {
    guard let saved, TimerJS.isObject(saved), saved["touched"]?.isTruthy == true else { return nil }
    var timer = normalizeTimer(saved["timer"])
    if pinnedDeadlineStatus(timer, now) == "passed" {
      timer.enabled = false
      timer.deleteAt = nil
      return RestoredDraftTimer(timer: normalizeTimer(timer), expired: true)
    }
    return RestoredDraftTimer(timer: timer, expired: false)
  }

  public static func restoreSessionDraftTimer(_ saved: SessionDraftTimer?, now: Double) -> RestoredDraftTimer? {
    restoreSessionDraftTimer(saved.map { ["timer": $0.timer.json, "touched": .bool($0.touched)] }, now: now)
  }
}
