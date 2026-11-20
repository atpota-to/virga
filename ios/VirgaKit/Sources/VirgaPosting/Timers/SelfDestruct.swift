// Ports src/posting/timers/selfDestruct.js
//
// Timers on posts: the pure model (no side effects; `now` is passed in
// everywhere). A post published with a lifespan is acted on by Virga's
// server when it comes due: deleted, or its replies limited, or its quotes
// turned off, subject to optional conditions read from its public counts.
// Sense 'unless' spares the post when the clauses hold, 'onlyIf' acts only
// when they hold.
//
// Wire shape sent to the server (server/timers/selfDestruct.js is the
// authority; it re-normalizes everything it is sent and refuses what it
// can't read):
//
//   { lifespanSeconds, deleteAt?, conditions: {
//       logic:  'any' | 'all',
//       clauses: [{ metric, op, value }],   // likes replies reposts quotes selfReplies
//       sense:  'unless' | 'onlyIf',
//       onSpare: 'keep' | 'extend', maxExtensions },
//     effects: [{ action: 'limitReplies', allow } | { action: 'disableQuotes' } | { action: 'delete' }] }
//
// The duration and the optional pinned `deleteAt` instant are held side by
// side, never folded together: the duration survives pinning and unpinning,
// and deriving it from a pin would bake in publish latency (10 minutes
// stored as 8m35s). Only extendWindowSeconds reads a window out of a pin.
//
// This file: the constants and the normalizers. SelfDestruct+Rules.swift
// changes rules and fits them to posts and publish times;
// SelfDestruct+Words.swift says them; SelfDestruct+Slots.swift is the
// timer list, the account's slots and the preview evaluator. Types are in
// SelfDestruct+Types.swift.
//
// Where the web looks a key up in an object literal (`METRIC_BY_KEY[x]`),
// only the table's own string keys are recognised here; JavaScript also
// finds inherited names ('constructor') and the text of an array.

import Foundation
import VirgaCore

public enum SelfDestruct {
  // Must match MIN/MAX_LIFESPAN_SECONDS in server/timers/selfDestruct.js,
  // which refuses anything outside the range.
  public static let minLifespanSeconds = 5 * 60
  public static let maxLifespanSeconds = 30 * 24 * 60 * 60
  public static let maxExtensionsCap = 10

  static let minute = 60
  static let hour = 60 * minute
  static let day = 24 * hour

  public struct LifespanPreset: Codable, Hashable, Sendable {
    public var seconds: Int
    public var label: String
  }

  /// Deliberately short; longer durations go through the custom box or the
  /// exact-time picker.
  public static let lifespanPresets: [LifespanPreset] = [
    LifespanPreset(seconds: 5 * minute, label: "5 minutes"),
    LifespanPreset(seconds: 30 * minute, label: "30 minutes"),
    LifespanPreset(seconds: hour, label: "1 hour"),
    LifespanPreset(seconds: 6 * hour, label: "6 hours"),
    LifespanPreset(seconds: 12 * hour, label: "12 hours"),
    LifespanPreset(seconds: day, label: "24 hours"),
    LifespanPreset(seconds: 3 * day, label: "3 days"),
    LifespanPreset(seconds: 7 * day, label: "1 week"),
  ]

  public static let defaultLifespanSeconds = day

  public struct LifespanUnit: Codable, Hashable, Sendable {
    public var key: String
    public var seconds: Int
    public var label: String
  }

  /// Units for the custom box. No "weeks": within the 30-day ceiling it
  /// would only ever be 1-4.
  public static let lifespanUnits: [LifespanUnit] = [
    LifespanUnit(key: "minutes", seconds: minute, label: "minutes"),
    LifespanUnit(key: "hours", seconds: hour, label: "hours"),
    LifespanUnit(key: "days", seconds: day, label: "days"),
  ]

  static func unit(_ key: String?) -> LifespanUnit {
    lifespanUnits.first { $0.key == key } ?? lifespanUnits[0]
  }

  public static func isPresetLifespan(_ seconds: JSONValue?) -> Bool {
    let s = normalizeLifespan(seconds)
    return lifespanPresets.contains { $0.seconds == s }
  }

  public static func isPresetLifespan(_ seconds: Int) -> Bool {
    isPresetLifespan(.number(Double(seconds)))
  }

  /// A lifespan as { amount, unit } for the custom box, in the largest unit
  /// that divides evenly (7200 → 2 hours, 5400 → 90 minutes) so "2 hours"
  /// doesn't come back as "120 minutes". Falls back to minutes.
  public static func splitLifespan(_ seconds: JSONValue?) -> LifespanParts {
    let s = normalizeLifespan(seconds)
    for unit in lifespanUnits.dropFirst().reversed() where s % unit.seconds == 0 {
      return LifespanParts(amount: s / unit.seconds, unit: unit.key)
    }
    return LifespanParts(amount: Int((Double(s) / Double(minute)).jsRounded), unit: "minutes")
  }

  public static func splitLifespan(_ seconds: Int) -> LifespanParts {
    splitLifespan(.number(Double(seconds)))
  }

  /// Seconds from the custom box, or nil when empty or out of range. Not
  /// clamped: this runs on every keystroke, and clamping a half-typed "1" up
  /// to the minimum would fight someone typing "15".
  public static func lifespanFromParts(_ amount: JSONValue?, _ unitKey: String?) -> Int? {
    let unit = unit(unitKey)
    let n = amount.jsNumber
    guard n.isFinite, n > 0 else { return nil }
    let seconds = n.rounded(.down) * Double(unit.seconds)
    if seconds < Double(minLifespanSeconds) || seconds > Double(maxLifespanSeconds) { return nil }
    return Int(seconds)
  }

  /// Largest whole amount of `unitKey` a timer may run for (bounds the
  /// custom box input).
  public static func maxAmountForUnit(_ unitKey: String?) -> Int {
    maxLifespanSeconds / unit(unitKey).seconds
  }

  public static let conditionModes = ["any", "all"]
  public static let spareActions = ["keep", "extend"]

  //   'unless'  the clauses SPARE the post ("delete in an hour unless it has 5 likes").
  //   'onlyIf'  the clauses DOOM it ("delete in an hour only if >5 replies").
  // Not an operator flip of each other: with no clauses, 'unless' deletes
  // and 'onlyIf' keeps.
  public static let conditionSenses = ["unless", "onlyIf"]

  public struct Metric: Codable, Hashable, Sendable {
    public var key: String
    public var label: String
    public var noun: String
  }

  /// The counts a clause can test, in editor order. selfReplies counts the
  /// author's own replies in the thread; the server reads it from the
  /// thread, not the post's counters.
  public static let metrics: [Metric] = [
    Metric(key: "likes", label: "Likes", noun: "like"),
    Metric(key: "replies", label: "Replies", noun: "reply"),
    Metric(key: "reposts", label: "Reposts", noun: "repost"),
    Metric(key: "quotes", label: "Quotes", noun: "quote"),
    Metric(key: "selfReplies", label: "Your replies", noun: "reply of your own"),
  ]
  public static let metricKeys = metrics.map(\.key)

  static func metric(_ key: TimerMetric) -> Metric {
    metrics.first { $0.key == key.rawValue }!
  }

  public struct Operator: Codable, Hashable, Sendable {
    public var key: String
    public var symbol: String
    public var label: String
    public var phrase: String
  }

  /// Two operators suffice for non-negative counts given the sense switch:
  /// "keep it if under 5" is "unless it reaches 5".
  public static let operators: [Operator] = [
    Operator(key: "gte", symbol: "≥", label: "at least", phrase: ""),
    Operator(key: "gt", symbol: ">", label: "more than", phrase: "more than "),
  ]
  public static let operatorKeys = operators.map(\.key)

  static func op(_ key: TimerOperator) -> Operator {
    operators.first { $0.key == key.rawValue }!
  }

  /// Legacy threshold fields, still present on posting records written
  /// before clauses existed. Migrated on read; not a supported shape.
  static let legacyThresholds: [(String, TimerMetric)] = [
    ("minLikes", .likes), ("minReplies", .replies), ("minReposts", .reposts),
  ]

  public static let maxClauses = metrics.count

  /// Who the count is about. Quotes only: the server reads quoting posts
  /// with their authors, whereas a like count has no actors attached.
  public static let filterableMetrics: [TimerMetric] = [.quotes]

  public struct ActorTest: Codable, Hashable, Sendable {
    public var key: String
    public var label: String
    public var phrase: String
  }

  public static let actorTests: [ActorTest] = [
    ActorTest(key: "notFollowed", label: "People you don't follow", phrase: "you don't follow"),
    ActorTest(key: "followersOver", label: "People with over…", phrase: "with over"),
  ]

  public static let defaultFollowersOver = 10000

  // MARK: - Normalizing

  /// A string member that is one of `keys`, by code unit (the keys are ASCII).
  static func oneOf<T: RawRepresentable>(_ value: JSONValue?, _: T.Type) -> T? where T.RawValue == String {
    guard let text = value?.stringValue else { return nil }
    return T(rawValue: text)
  }

  /// Who a clause's count is about, or nil for anyone (a filter that tests
  /// nothing is nil).
  public static func normalizeActorFilter(_ raw: JSONValue?) -> ActorFilter? {
    let src = TimerJS.members(raw)
    let out = ActorFilter(
      match: oneOf(src["match"], ConditionLogic.self) ?? .any,
      notFollowed: src["notFollowed"]?.isTruthy ?? false,
      followersOver: normalizeThreshold(src["followersOver"]))
    if !out.notFollowed && out.followersOver == nil { return nil }
    return out
  }

  public static func normalizeActorFilter(_ filter: ActorFilter?) -> ActorFilter? {
    normalizeActorFilter(filter?.json)
  }

  /// Key for a clause's count. Must match the server's clauseCountKey
  /// exactly, since the server writes the counts this reads.
  public static func clauseCountKey(_ clause: TimerClause) -> String {
    guard let f = clause.from else { return clause.metric.rawValue }
    var bits = [clause.metric.rawValue, f.match.rawValue]
    if f.notFollowed { bits.append("notFollowed") }
    if let over = f.followersOver { bits.append("followersOver:\(over)") }
    return bits.joined(separator: "|")
  }

  /// clauseCountKey for a loose clause: `''` for none, the bare metric
  /// (whatever it is) without a `from`.
  public static func clauseCountKey(_ clause: JSONValue?) -> JSONValue? {
    guard let clause, clause.isTruthy else { return .string("") }
    guard let f = clause["from"], f.isTruthy else { return clause["metric"] }
    var bits = [TimerJS.joinPiece(clause["metric"]), TimerJS.joinPiece(f["match"])]
    if f["notFollowed"]?.isTruthy == true { bits.append("notFollowed") }
    if let over = f["followersOver"], !over.isNull { bits.append("followersOver:\(over.jsString)") }
    return .string(bits.joined(separator: "|"))
  }

  /// A positive whole threshold, or nil for "not part of the test".
  public static func normalizeThreshold(_ value: JSONValue?) -> Int? {
    guard let value, !value.isNull, value != .string("") else { return nil }
    let n = value.jsNumber
    guard n.isFinite else { return nil }
    let rounded = n.rounded(.down)
    if rounded <= 0 { return nil }
    return Int(min(rounded, 1_000_000))
  }

  /// A lifespan clamped into the range the server will accept.
  public static func normalizeLifespan(_ value: JSONValue?) -> Int {
    let n = value.jsNumber.rounded(.down)
    guard n.isFinite else { return defaultLifespanSeconds }
    return Int(min(max(n, Double(minLifespanSeconds)), Double(maxLifespanSeconds)))
  }

  public static func normalizeLifespan(_ value: Double) -> Int {
    normalizeLifespan(.number(value))
  }

  public static func normalizeLifespan(_ value: Int) -> Int {
    normalizeLifespan(.number(Double(value)))
  }

  /// One clause, or nil when it has no metric or threshold (an empty box is
  /// no clause, not ">= 0").
  public static func normalizeClause(_ raw: JSONValue?) -> TimerClause? {
    let src = TimerJS.members(raw)
    guard let metric = oneOf(src["metric"], TimerMetric.self), let value = normalizeThreshold(src["value"])
    else { return nil }
    var clause = TimerClause(metric: metric, op: oneOf(src["op"], TimerOperator.self) ?? .gte, value: value)
    if let from = normalizeActorFilter(src["from"]), filterableMetrics.contains(metric) {
      clause.from = from
    }
    return clause
  }

  public static func normalizeClause(_ clause: TimerClause) -> TimerClause? {
    normalizeClause(clause.json)
  }

  /// Canonical condition shape from a settings record or modal state. Also
  /// migrates the legacy `{ minLikes, minReplies, minReposts }` shape ("at
  /// least", sparing), which still exists in synced posting settings on
  /// users' PDSes. No usable clauses normalizes to an unconditional timer.
  public static func normalizeConditions(_ raw: some TimerConditionsInput) -> TimerConditions {
    let src = TimerJS.members(raw.timerConditionsJSON)

    // Deduped by clauseCountKey (same metric and same actor filter); first
    // wins, capped at maxClauses.
    var seen = Set<String>()
    var clauses: [TimerClause] = []
    func take(_ clause: TimerClause?) {
      guard let clause, clauses.count < maxClauses else { return }
      let key = clauseCountKey(clause)
      if seen.contains(key) { return }
      seen.insert(key)
      clauses.append(clause)
    }
    for item in src["clauses"]?.arrayValue ?? [] { take(normalizeClause(item)) }
    for (legacy, metric) in legacyThresholds {
      if let value = src[legacy] {
        take(normalizeClause(["metric": .string(metric.rawValue), "op": "gte", "value": value]))
      }
    }

    var out = TimerConditions(
      // `mode` was the legacy name for the same idea.
      logic: oneOf(src["logic"], ConditionLogic.self) ?? oneOf(src["mode"], ConditionLogic.self) ?? .any,
      clauses: clauses,
      sense: oneOf(src["sense"], ConditionSense.self) ?? .unless,
      onSpare: oneOf(src["onSpare"], SpareAction.self) ?? .keep,
      maxExtensions: 0)
    if out.onSpare == .extend {
      let wanted = src["maxExtensions"].jsNumber
      out.maxExtensions = wanted.isFinite ? Int(min(max(wanted.rounded(.down), 1), Double(maxExtensionsCap))) : 1
    }
    return out
  }

  public static func hasClauses(_ conditions: some TimerConditionsInput) -> Bool {
    !normalizeConditions(conditions).clauses.isEmpty
  }

  public static func clauseFor(_ conditions: some TimerConditionsInput, _ metric: String) -> TimerClause? {
    normalizeConditions(conditions).clauses.first { $0.metric.rawValue == metric }
  }

  /// Set, change or remove (null/zero value) one metric's clause, returning
  /// whole conditions. The existing `from` actor filter is carried over
  /// unless the patch has a `from` key (null included); the number box and
  /// op toggle don't know about it and would otherwise widen the clause to
  /// everyone. `patch` is `{ op?, value?, from? }`.
  public static func withClause(
    _ conditions: some TimerConditionsInput, _ metric: String, _ patch: JSONValue = [:]
  ) -> TimerConditions {
    var c = normalizeConditions(conditions)
    let existing = c.clauses.first { $0.metric.rawValue == metric }
    let fields = patch.objectValue ?? [:]
    let from: JSONValue? = fields.keys.contains("from") ? fields["from"] : existing?.from?.json
    let rest = c.clauses.filter { $0.metric.rawValue != metric }
    var raw: [String: JSONValue] = ["metric": .string(metric)]
    raw["op"] = fields["op"]
    raw["value"] = fields["value"]
    raw["from"] = from
    let next = normalizeClause(.object(raw))
    // Kept in metric order so a cleared-and-retyped row doesn't move.
    let clauses = next.map { rest + [$0] } ?? rest
    c.clauses = TimerJS.v8Sorted(clauses) { a, b in
      Double(metricKeys.firstIndex(of: a.metric.rawValue)! - metricKeys.firstIndex(of: b.metric.rawValue)!)
    }
    return c
  }

  public struct Effect: Codable, Hashable, Sendable {
    public var key: String
    public var label: String
    public var verb: String
  }

  /// What a rule does when it fires, in apply order: reversible gate changes
  /// first, deletion always last.
  public static let effects: [Effect] = [
    Effect(key: "limitReplies", label: "Limit replies", verb: "Limits replies"),
    Effect(key: "disableQuotes", label: "Turn off quotes", verb: "Turns off quotes"),
    Effect(key: "delete", label: "Delete the post", verb: "Deletes itself"),
  ]
  public static let effectKeys = effects.map(\.key)

  static func effectOrder(_ action: TimerAction) -> Int {
    effectKeys.firstIndex(of: action.rawValue)!
  }

  public struct AllowOption: Codable, Hashable, Sendable {
    public var key: String
    public var label: String
    public var phrase: String
  }

  /// Threadgate allow rules, in Bluesky's order.
  public static let allowOptions: [AllowOption] = [
    AllowOption(key: "follower", label: "Your followers", phrase: "your followers"),
    AllowOption(key: "following", label: "People you follow", phrase: "people you follow"),
    AllowOption(key: "mention", label: "People you mentioned", phrase: "people you mentioned"),
  ]
  public static let allowKeys = allowOptions.map(\.key)

  /// The threadgate lexicon caps `allow` at five rules.
  public static let maxAllowRules = 5

  /// One allow entry: a known key, or `{ list, name? }` for one of the
  /// writer's lists. The name is client-side only, for sentences;
  /// toWireSpec strips it.
  public static func normalizeAllowEntry(_ entry: JSONValue?) -> AllowEntry? {
    if let key = oneOf(entry, AllowKey.self) { return .rule(key) }
    guard case .object(let src) = entry, let list = src["list"]?.stringValue else { return nil }
    let trimmed = list.jsTrimmed()
    guard PostingJS.hasPrefix(trimmed, "at://"), list.jsIndexOf("/app.bsky.graph.list/") >= 0 else { return nil }
    var name: String?
    if let raw = src["name"]?.stringValue, !raw.jsTrimmed().isEmpty {
      name = raw.jsTrimmed().jsSlice(0, 64)
    }
    return .list(trimmed, name: name)
  }

  public static func normalizeAllowEntry(_ entry: AllowEntry) -> AllowEntry? {
    normalizeAllowEntry(entry.json)
  }

  /// Dedup/toggle key; list entries match by URI.
  public static func allowEntryKey(_ entry: AllowEntry) -> String {
    switch entry {
    case .rule(let key): return key.rawValue
    case .list(let uri, _): return "list:\(uri)"
    }
  }

  /// Effects that write a threadgate or postgate. The fitting functions take
  /// a `gatesSupported` flag for records that have neither; every post
  /// Virga writes is an app.bsky.feed.post, so composerTimerFit always says
  /// yes.
  public static let blueskyOnlyEffects: [TimerAction] = [.limitReplies, .disableQuotes]

  public static func normalizeEffect(_ raw: JSONValue?) -> TimerEffect? {
    let src = TimerJS.members(raw)
    guard let action = oneOf(src["action"], TimerAction.self) else { return nil }
    if action != .limitReplies { return TimerEffect(action: action) }
    // Absent allow = followers; empty allow = nobody (a real choice, not defaulted).
    guard let entries = src["allow"]?.arrayValue else {
      return TimerEffect(action: .limitReplies, allow: [.rule(.follower)])
    }
    var seen = Set<JSKey>()
    var allow: [AllowEntry] = []
    for entry in entries {
      guard let norm = normalizeAllowEntry(entry) else { continue }
      let key = JSKey(allowEntryKey(norm))
      if seen.contains(key) || allow.count >= maxAllowRules { continue }
      seen.insert(key)
      allow.append(norm)
    }
    return TimerEffect(action: .limitReplies, allow: allow)
  }

  public static func normalizeEffect(_ effect: TimerEffect) -> TimerEffect? {
    normalizeEffect(effect.json)
  }

  /// Effects in apply order. Empty or unreadable means delete, matching the
  /// server's fallback.
  public static func normalizeEffects(_ raw: some TimerEffectsInput) -> [TimerEffect] {
    var seen = Set<TimerAction>()
    var out: [TimerEffect] = []
    for item in raw.timerEffectsJSON?.arrayValue ?? [] {
      guard let effect = normalizeEffect(item), !seen.contains(effect.action) else { continue }
      seen.insert(effect.action)
      out.append(effect)
    }
    if out.isEmpty { return [TimerEffect(action: .delete)] }
    return TimerJS.v8Sorted(out) { Double(effectOrder($0.action) - effectOrder($1.action)) }
  }

  public static func effectsDelete(_ effects: some TimerEffectsInput) -> Bool {
    normalizeEffects(effects).contains { $0.action == .delete }
  }

  public static func effectFor(_ effects: some TimerEffectsInput, _ action: String) -> TimerEffect? {
    normalizeEffects(effects).first { $0.action.rawValue == action }
  }

  /// A pinned instant as the timer holds it: any readable moment, or nil.
  /// Deliberately not bounded by the clock: dropping a near pin would
  /// silently fall back to the duration (often 24h), and scheduled posts
  /// measure from publish time. settleForPublish and scheduledTimerProblem
  /// judge it at publish. A date-time without an offset is read in
  /// `timeZone` (the local zone, the web's local time, by default).
  public static func parseDeleteAt(_ value: JSONValue?, timeZone: TimeZone? = nil) -> String? {
    guard let value, value.isTruthy else { return nil }
    let at = TimerJS.dateMs(value, timeZone: timeZone)
    guard at.isFinite else { return nil }
    return VirgaCore.JSDate.toISOString(at)
  }

  public static func parseDeleteAt(_ value: String?, timeZone: TimeZone? = nil) -> String? {
    parseDeleteAt(value.map(JSONValue.string), timeZone: timeZone)
  }

  /// An instant that may be picked right now (at least minLifespan ahead,
  /// within maxLifespan), or nil. For the picker; a pin chosen earlier is
  /// judged at publish time by pinnedDeadlineStatus.
  public static func normalizeDeleteAt(_ value: JSONValue?, now: Double, timeZone: TimeZone? = nil) -> String? {
    guard let iso = parseDeleteAt(value, timeZone: timeZone) else { return nil }
    let at = isoMs(iso)
    if at <= now + Double(minLifespanSeconds) * 1000 { return nil }
    if at > now + Double(maxLifespanSeconds) * 1000 { return nil }
    return iso
  }

  /// `new Date(iso).getTime()` for an ISO string parseDeleteAt wrote.
  static func isoMs(_ iso: String) -> Double {
    TimerJS.dateMs(.string(iso), timeZone: TimeZone(identifier: "UTC"))
  }

  /// The whole timer, normalized. `enabled` is client-only and never sent;
  /// a disabled timer is simply not sent. A pin without an offset is read
  /// in `timeZone`: by default the zone of the function this runs under
  /// (one given a `timeZone` reads every rule in it), else the active one.
  public static func normalizeTimer(_ raw: some TimerRuleInput, timeZone: TimeZone? = nil) -> TimerRule {
    let src = TimerJS.members(raw.timerRuleJSON)
    return TimerRule(
      enabled: src["enabled"]?.isTruthy ?? false,
      // Kept as picked, stale or not (see parseDeleteAt).
      deleteAt: parseDeleteAt(src["deleteAt"], timeZone: timeZone),
      // Independent of deleteAt; a pin never overwrites it.
      lifespanSeconds: normalizeLifespan(src["lifespanSeconds"]),
      conditions: normalizeConditions(src["conditions"]),
      effects: normalizeEffects(src["effects"]))
  }

  /// `{ ...normalizeTimer(rule), ...patch }`, as the JavaScript object.
  static func merged(_ rule: TimerRule, _ patch: [String: JSONValue?]) -> JSONValue {
    var fields = rule.json.objectValue ?? [:]
    for (key, value) in patch {
      if let value { fields[key] = value } else { fields[key] = nil }
    }
    return .object(fields)
  }
}
