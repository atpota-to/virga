// Ports src/posting/ui/lifespanModel.js
//
// The timer editor's decisions, apart from the view: which length is
// picked, what pressing an effect does, the reply rules of "Limit
// replies", and the notes under the rule. The rule model itself is
// SelfDestruct (Timers/); everything here goes through it and hands back a
// whole TimerRule. Pure functions (the editor's view holds the rule), so no
// observable model: the view binds a TimerRule and calls these.

import Foundation
import VirgaCore

/// editorNotes' `fit`: what the editor knows about the post.
public struct LifespanEditorFit: Codable, Hashable, Sendable {
  public var editingExisting: Bool
  public var reply: Bool
  public var thread: Bool

  public init(editingExisting: Bool = false, reply: Bool = false, thread: Bool = false) {
    self.editingExisting = editingExisting
    self.reply = reply
    self.thread = thread
  }

  /// A loose `fit` object, read by truthiness.
  public init(json: JSONValue?) {
    self.init(
      editingExisting: json?["editingExisting"]?.isTruthy ?? false,
      reply: json?["reply"]?.isTruthy ?? false,
      thread: json?["thread"]?.isTruthy ?? false)
  }
}

/// The notes the editor shows under the rule (editorNotes).
public struct LifespanEditorNotes: Codable, Hashable, Sendable {
  /// The rule as it would run on this post.
  public var fitted: TimerRule
  public var summary: String
  public var fitNote: String
  public var pin: String
  public var pinBlocks: Bool
  public var room: String
  public var thread: String
  public var unavailable: String
}

/// pinBounds' answer: the picker's earliest and latest instants (ISO).
public struct PinBounds: Codable, Hashable, Sendable {
  public var min: String
  public var max: String
}

/// timerStart's answer.
public struct TimerStartPoint: Codable, Hashable, Sendable {
  /// The start to send as `postedAt`, in epoch ms.
  public var startedAt: Double
  /// 'wentUp' or 'now': the start that will actually be used.
  public var from: String
  /// '', 'floor' or 'elapsed'.
  public var passed: String
}

public enum LifespanModel {
  /// The rule with `patch` merged in, normalised. A nil member is
  /// `undefined` (it reads as absent); `.null` is null.
  public static func patchRule(_ rule: some TimerRuleInput, _ patch: [String: JSONValue?]) -> TimerRule {
    var fields = SelfDestruct.normalizeTimer(rule).json.objectValue ?? [:]
    for (key, value) in patch { fields[key] = value }
    return SelfDestruct.normalizeTimer(JSONValue.object(fields))
  }

  /// Which length button is pressed: `'exact'` for a pinned time, the
  /// preset's seconds as a string, or `'custom'`.
  public static func lengthChoice(_ rule: some TimerRuleInput) -> String {
    let t = SelfDestruct.normalizeTimer(rule)
    if t.deleteAt != nil { return "exact" }
    return SelfDestruct.lifespanPresets.contains { $0.seconds == t.lifespanSeconds }
      ? String(t.lifespanSeconds) : "custom"
  }

  /// A preset or typed length: drops any pinned time, which would otherwise win.
  public static func withLength(_ rule: some TimerRuleInput, _ seconds: JSONValue?) -> TimerRule {
    patchRule(rule, ["lifespanSeconds": seconds, "deleteAt": .null])
  }

  public static func withLength(_ rule: some TimerRuleInput, _ seconds: Int) -> TimerRule {
    withLength(rule, .number(Double(seconds)))
  }

  /// A pinned time (ISO), keeping the length behind it for when the pin is
  /// taken off. A time without an offset is read in `timeZone` (the active
  /// zone, the web's local time, by default).
  public static func withPin(_ rule: some TimerRuleInput, _ iso: JSONValue?, timeZone: TimeZone? = nil) -> TimerRule {
    // `deleteAt: iso || null`, read here rather than by normalizeTimer so
    // the zone can be given; the ISO it gives reads the same in any zone.
    let pin = TimerJS.truthy(iso).flatMap { SelfDestruct.parseDeleteAt($0, timeZone: timeZone) }
    return patchRule(rule, ["deleteAt": pin.map(JSONValue.string) ?? .null])
  }

  public static func withPin(_ rule: some TimerRuleInput, _ iso: String?, timeZone: TimeZone? = nil) -> TimerRule {
    withPin(rule, iso.map(JSONValue.string), timeZone: timeZone)
  }

  /// The effects after pressing one. Picking a gate while the rule only
  /// deletes replaces the delete (it can be added back); turning the last
  /// effect off falls back to delete, since a rule has to do something.
  /// `allow` is for limitReplies (followers by default).
  public static func toggleEffect(_ rule: some TimerRuleInput, _ action: String, allow: JSONValue = ["follower"])
    -> TimerRule
  {
    let t = SelfDestruct.normalizeTimer(rule)
    let on = SelfDestruct.effectFor(t.effects, action) != nil
    let deleteOnly = t.effects.count == 1 && t.effects[0].action == .delete
    let effects: [TimerEffect]
    if !on && action != "delete" && deleteOnly {
      let raw: JSONValue =
        action == "limitReplies" ? ["action": .string(action), "allow": allow] : ["action": .string(action)]
      effects = SelfDestruct.normalizeEffects(JSONValue.array([raw]))
    } else {
      effects = SelfDestruct.withEffect(
        t.effects, action, !on, action == "limitReplies" ? ["allow": allow] : [:])
    }
    return patchRule(t, ["effects": SelfDestruct.normalizeEffects(effects).timerEffectsJSON!])
  }

  public static func toggleEffect(_ rule: some TimerRuleInput, _ action: TimerAction, allow: [AllowEntry]) -> TimerRule {
    toggleEffect(rule, action.rawValue, allow: .array(allow.map(\.json)))
  }

  /// Who may still reply once replies are limited: keys and lists, ≤5; `[]`
  /// is nobody.
  public static func withAllow(_ rule: some TimerRuleInput, _ allow: JSONValue?) -> TimerRule {
    let t = SelfDestruct.normalizeTimer(rule)
    if SelfDestruct.effectFor(t.effects, "limitReplies") == nil { return t }
    var extra: [String: JSONValue] = [:]
    if let allow { extra["allow"] = allow }
    return patchRule(t, ["effects": SelfDestruct.withEffect(t.effects, "limitReplies", true, .object(extra)).timerEffectsJSON!])
  }

  public static func withAllow(_ rule: some TimerRuleInput, _ allow: [AllowEntry]) -> TimerRule {
    withAllow(rule, .array(allow.map(\.json)))
  }

  /// The allow list with one key or list turned on or off (and "nobody"
  /// emptying it). An entry that isn't one leaves the list as it was.
  public static func toggleAllow(_ allow: [AllowEntry] = [], _ entry: JSONValue?) -> [AllowEntry] {
    guard let norm = SelfDestruct.normalizeAllowEntry(entry) else { return allow }
    let key = SelfDestruct.allowEntryKey(norm)
    let has = allow.contains { SelfDestruct.allowEntryKey($0).jsEquals(key) }
    if has { return allow.filter { !SelfDestruct.allowEntryKey($0).jsEquals(key) } }
    if allow.count >= SelfDestruct.maxAllowRules { return allow }
    return allow + [norm]
  }

  public static func toggleAllow(_ allow: [AllowEntry] = [], _ entry: AllowEntry) -> [AllowEntry] {
    toggleAllow(allow, entry.json)
  }

  /// One metric's clause set, changed or (empty value) removed. `patch` is
  /// `{ op?, value?, from? }`.
  public static func withMetric(_ rule: some TimerRuleInput, _ metric: String, _ patch: JSONValue) -> TimerRule {
    let t = SelfDestruct.normalizeTimer(rule)
    return patchRule(t, ["conditions": SelfDestruct.withClause(t.conditions, metric, patch).json])
  }

  /// The conditions with `patch` merged (sense, logic, onSpare,
  /// maxExtensions). Turning on 'extend' with no count yet gives it one.
  public static func withConditions(_ rule: some TimerRuleInput, _ patch: [String: JSONValue]) -> TimerRule {
    let t = SelfDestruct.normalizeTimer(rule)
    var next = t.conditions.json.objectValue ?? [:]
    for (key, value) in patch { next[key] = value }
    if patch["onSpare"] == .string("extend") && !(t.conditions.maxExtensions > 0) && patch["maxExtensions"] == nil {
      next["maxExtensions"] = 1
    }
    return patchRule(t, ["conditions": SelfDestruct.normalizeConditions(JSONValue.object(next)).json])
  }

  /// The quote clause's "count quotes from" filter with `patch` merged
  /// (`{ match?, notFollowed?, followersOver? }`); `.null` clears it.
  public static func withQuoteFilter(_ rule: some TimerRuleInput, _ patch: JSONValue) -> TimerRule {
    let t = SelfDestruct.normalizeTimer(rule)
    guard let clause = t.conditions.clauses.first(where: { $0.metric == .quotes }) else { return t }
    let from: JSONValue
    if patch == .null {
      from = .null
    } else {
      var fields: [String: JSONValue] = ["match": "any", "notFollowed": false, "followersOver": .null]
      for (key, value) in clause.from?.json.objectValue ?? [:] { fields[key] = value }
      for (key, value) in patch.objectValue ?? [:] { fields[key] = value }
      from = .object(fields)
    }
    return withMetric(
      t, "quotes", ["op": .string(clause.op.rawValue), "value": .number(Double(clause.value)), "from": from])
  }

  /// The bounds of an exact time, for the picker: from 5 minutes (and a
  /// minute's slack) after `from` to 30 days after. Throws "Invalid time
  /// value" for a time that can't be one, as `toISOString` does.
  public static func pinBounds(from: Double) throws -> PinBounds {
    let lo = from + Double(SelfDestruct.minLifespanSeconds) * 1000 + 60_000
    let hi = from + Double(SelfDestruct.maxLifespanSeconds) * 1000
    guard let min = VirgaCore.JSDate.toISOString(VirgaCore.JSDate.timeClip(lo)),
      let max = VirgaCore.JSDate.toISOString(VirgaCore.JSDate.timeClip(hi))
    else { throw InvalidTimeValueError() }
    return PinBounds(min: min, max: max)
  }

  /// The notes the editor shows under the rule, for the post it's on:
  ///
  ///   summary   the rule as it would run here, in a sentence ('' when off)
  ///   fitNote   what fitting changed (a reply can't limit replies…)
  ///   pin       why a pinned time can't be kept against when the post goes
  ///             out (`pinBlocks` when it can't go out with it at all)
  ///   room      why the account has no free timer for it
  ///   thread    that a thread goes with its first post
  ///
  /// `publishAt` is the scheduled time (an ISO string), else the post goes
  /// out now. `countFrom` is for a post already out: 'now' or 'wentUp',
  /// where its length is counted from (timerStart's `from`); 'goesUp' for a
  /// post still to go up.
  public static func editorNotes(
    _ rule: some TimerRuleInput,
    fit: LifespanEditorFit = LifespanEditorFit(),
    publishAt: String? = nil,
    limits: JSONValue? = nil,
    holds: JSONValue? = nil,
    countFrom: String = "goesUp",
    now: Double,
    locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> LifespanEditorNotes {
    let t = SelfDestruct.normalizeTimer(rule)
    let timerFit = SelfDestruct.composerTimerFit(editingExisting: fit.editingExisting, reply: fit.reply)
    let fitted = SelfDestruct.fitTimerToPost(t, timerFit)
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let at: Double = publishAt.flatMap { $0.isEmpty ? nil : VirgaCore.JSDate.parse($0, timeZone: zone) } ?? .nan
    var pin = ""
    var pinBlocks = false
    if fitted.enabled && fitted.deleteAt != nil {
      pin =
        at.isFinite
        ? SelfDestruct.scheduledTimerProblem(fitted, at, now: now, locale: locale, timeZone: zone)
        : SelfDestruct.immediateTimerProblem(fitted, now)
      pinBlocks = !pin.isEmpty
      if pin.isEmpty && SelfDestruct.pinnedDeadlineStatus(fitted, at.isFinite ? at : now) == "tooSoon" {
        let minutes = JSNumber.format(Double(SelfDestruct.minLifespanSeconds) / 60)
        pin =
          "That time is less than \(minutes) minutes after it goes out, so it acts \(minutes) minutes after instead."
      }
    }
    let deletes = fitted.effects.contains { $0.action == .delete }
    return LifespanEditorNotes(
      fitted: fitted,
      summary: fitted.enabled
        ? SelfDestruct.describeTimer(fitted, now: now, from: countFrom, locale: locale, timeZone: zone) : "",
      fitNote: t.enabled ? SelfDestruct.describeFitChange(t, timerFit) : "",
      pin: pin,
      pinBlocks: pinBlocks,
      room: t.enabled ? SelfDestruct.timerRoomProblem(fitted, limits, holds: holds) : "",
      thread: fitted.enabled && fit.thread && deletes ? "The whole thread goes with its first post." : "",
      unavailable: t.enabled && fit.editingExisting ? "A post that’s already out can’t take a timer from here." : "")
  }

  /// The followersOver choices the quote filter offers.
  public static let followerThresholds = [1000, 10000, 100000]

  /// The maxExtensions choices "give it another…" offers.
  public static let extensionChoices = [1, 2, 3, 5, 10]

  /// Curate lists from app.bsky.graph.getLists, as `{ list, name }` entries.
  public static func curateLists(_ lists: JSONValue?) -> [AllowEntry] {
    (lists?.arrayValue ?? []).compactMap { l in
      guard l.isTruthy, l["purpose"] == .string("app.bsky.graph.defs#curatelist"),
        let uri = l["uri"]?.stringValue
      else { return nil }
      let name = l["name"].flatMap { $0.isTruthy ? $0.jsString : nil } ?? "A list"
      return .list(uri, name: name.jsSlice(0, 64))
    }
  }

  /// When a timer started at `startedAt` would first act: its pinned time,
  /// else the start plus its length, and never sooner than five minutes from
  /// now (the server's floor). Nil when the rule is off; NaN (an invalid
  /// date) when a time can't be read.
  public static func firstActAt(_ rule: some TimerRuleInput, startedAt: Double, now: Double) -> Double? {
    let t = SelfDestruct.normalizeTimer(rule)
    if !t.enabled { return nil }
    let due =
      t.deleteAt.map { VirgaCore.JSDate.parse($0, timeZone: TimeZone(identifier: "UTC")!) }
      ?? startedAt + Double(t.lifespanSeconds) * 1000
    let floor = now + Double(SelfDestruct.minLifespanSeconds) * 1000
    // Math.max: NaN wins.
    if due.isNaN || floor.isNaN { return .nan }
    return VirgaCore.JSDate.timeClip(Swift.max(due, floor))
  }

  /// Where a timer on a post that's already out starts counting, as the
  /// server will count it (validateArm): from when the post went up only
  /// while that's inside the rule's length, otherwise from now. A start in
  /// the future (a clock off) or one that can't be read also counts from
  /// now.
  ///
  ///   startedAt  the start to send as `postedAt`, in ms
  ///   from       'wentUp' or 'now', the start that will actually be used
  ///   passed     '' or, when 'posted' was asked for:
  ///              'floor'    its time comes within five minutes, so it acts
  ///                         at the server's five-minute floor
  ///              'elapsed'  the whole length has already gone by, so the
  ///                         server counts it again from now
  ///
  /// A pinned time doesn't depend on the start; it counts from now.
  public static func timerStart(
    _ rule: some TimerRuleInput, start: String = "now", postedAt: String? = nil, now: Double,
    timeZone: TimeZone? = nil
  ) -> TimerStartPoint {
    let fromNow = TimerStartPoint(startedAt: now, from: "now", passed: "")
    let t = SelfDestruct.normalizeTimer(rule)
    if start != "posted" || !t.enabled || t.deleteAt != nil { return fromNow }
    let at = VirgaCore.JSDate.parse(postedAt ?? "", timeZone: timeZone ?? AppLocale.activeTimeZone())
    if !at.isFinite || at > now { return fromNow }
    let length = Double(t.lifespanSeconds) * 1000
    if now - at >= length { return TimerStartPoint(startedAt: now, from: "now", passed: "elapsed") }
    return TimerStartPoint(
      startedAt: at, from: "wentUp",
      passed: at + length <= now + Double(SelfDestruct.minLifespanSeconds) * 1000 ? "floor" : "")
  }
}
