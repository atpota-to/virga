// Ports src/posting/timers/selfDestruct.js
//
// The shapes of a post timer (a TimerRule) as selfDestruct.js's normalizers
// build them, field for field, so a rule encodes to the JSON the web holds
// and sends. The normalizers themselves are in SelfDestruct.swift; these
// types only ever hold what they produce (or what is decoded from it).
//
// The web's functions take anything (a stored settings record, a modal's
// state, a server row) and normalize it first. Here each takes `some
// TimerRuleInput` (or the conditions or effects form): a typed value, or
// the loose JSONValue the web would have been handed. A typed value is read
// as the JavaScript object it encodes to and normalized again, exactly as
// the web normalizes an object that was normalized before, so the two agree
// even where normalizing twice isn't the same as once (a list name cut at
// 64 code units can end in a space the second pass trims).

import Foundation
import VirgaCore

// MARK: - Keys

/// A count a clause tests (METRICS), in the editor's order.
public enum TimerMetric: String, Codable, CaseIterable, Hashable, Sendable {
  case likes, replies, reposts, quotes, selfReplies
}

/// How a clause compares its count (OPERATORS).
public enum TimerOperator: String, Codable, CaseIterable, Hashable, Sendable {
  case gte, gt
}

/// Whether one clause or every clause must hold (CONDITION_MODES); also an
/// actor filter's `match`.
public enum ConditionLogic: String, Codable, CaseIterable, Hashable, Sendable {
  case any, all
}

/// Which way the clauses point (CONDITION_SENSES): 'unless' spares the post
/// when they hold, 'onlyIf' acts only when they do.
public enum ConditionSense: String, Codable, CaseIterable, Hashable, Sendable {
  case unless, onlyIf
}

/// What a spared post gets (SPARE_ACTIONS).
public enum SpareAction: String, Codable, CaseIterable, Hashable, Sendable {
  case keep, extend
}

/// What a rule does when it fires (EFFECTS), in apply order.
public enum TimerAction: String, Codable, CaseIterable, Hashable, Sendable {
  case limitReplies, disableQuotes, delete
}

/// A threadgate allow rule by name (ALLOW_OPTIONS), in Bluesky's order.
public enum AllowKey: String, Codable, CaseIterable, Hashable, Sendable {
  case follower, following, mention
}

// MARK: - Shapes

/// Who a clause's count is about (normalizeActorFilter):
/// `{ match, notFollowed, followersOver }`, `followersOver` null when unset.
public struct ActorFilter: Codable, Hashable, Sendable {
  public var match: ConditionLogic
  public var notFollowed: Bool
  public var followersOver: Int?

  public init(match: ConditionLogic = .any, notFollowed: Bool = false, followersOver: Int? = nil) {
    self.match = match
    self.notFollowed = notFollowed
    self.followersOver = followersOver
  }

  enum CodingKeys: String, CodingKey { case match, notFollowed, followersOver }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(match, forKey: .match)
    try c.encode(notFollowed, forKey: .notFollowed)
    // The web's object holds `followersOver: null`, and sends it.
    try c.encode(followersOver, forKey: .followersOver)
  }

  /// The JavaScript object this is.
  public var json: JSONValue {
    [
      "match": .string(match.rawValue),
      "notFollowed": .bool(notFollowed),
      "followersOver": followersOver.map { .number(Double($0)) } ?? .null,
    ]
  }
}

/// One clause (normalizeClause): `{ metric, op, value, from? }`.
public struct TimerClause: Codable, Hashable, Sendable {
  public var metric: TimerMetric
  public var op: TimerOperator
  public var value: Int
  public var from: ActorFilter?

  public init(metric: TimerMetric, op: TimerOperator = .gte, value: Int, from: ActorFilter? = nil) {
    self.metric = metric
    self.op = op
    self.value = value
    self.from = from
  }

  public var json: JSONValue {
    var out: [String: JSONValue] = [
      "metric": .string(metric.rawValue), "op": .string(op.rawValue), "value": .number(Double(value)),
    ]
    if let from { out["from"] = from.json }
    return .object(out)
  }
}

/// A rule's conditions (normalizeConditions).
public struct TimerConditions: Codable, Hashable, Sendable {
  public var logic: ConditionLogic
  public var clauses: [TimerClause]
  public var sense: ConditionSense
  public var onSpare: SpareAction
  public var maxExtensions: Int

  public init(
    logic: ConditionLogic = .any, clauses: [TimerClause] = [], sense: ConditionSense = .unless,
    onSpare: SpareAction = .keep, maxExtensions: Int = 0
  ) {
    self.logic = logic
    self.clauses = clauses
    self.sense = sense
    self.onSpare = onSpare
    self.maxExtensions = maxExtensions
  }

  public var json: JSONValue {
    [
      "logic": .string(logic.rawValue),
      "clauses": .array(clauses.map(\.json)),
      "sense": .string(sense.rawValue),
      "onSpare": .string(onSpare.rawValue),
      "maxExtensions": .number(Double(maxExtensions)),
    ]
  }
}

/// Who may still reply once replies are limited: a rule by name, or one of
/// the writer's lists (`{ list, name? }`; the name is for sentences only and
/// is stripped before sending).
public enum AllowEntry: Codable, Hashable, Sendable {
  case rule(AllowKey)
  case list(String, name: String? = nil)

  public init(from decoder: Decoder) throws {
    if let single = try? decoder.singleValueContainer(), let key = try? single.decode(AllowKey.self) {
      self = .rule(key)
      return
    }
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self = .list(try c.decode(String.self, forKey: .list), name: try c.decodeIfPresent(String.self, forKey: .name))
  }

  enum CodingKeys: String, CodingKey { case list, name }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .rule(let key):
      var c = encoder.singleValueContainer()
      try c.encode(key)
    case .list(let uri, let name):
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(uri, forKey: .list)
      try c.encodeIfPresent(name, forKey: .name)
    }
  }

  public var json: JSONValue {
    switch self {
    case .rule(let key): return .string(key.rawValue)
    case .list(let uri, let name):
      var out: [String: JSONValue] = ["list": .string(uri)]
      if let name { out["name"] = .string(name) }
      return .object(out)
    }
  }
}

/// One thing a rule does (normalizeEffect): `{ action }`, or for
/// limitReplies `{ action, allow }` (`[]` is nobody).
public struct TimerEffect: Codable, Hashable, Sendable {
  public var action: TimerAction
  public var allow: [AllowEntry]?

  public init(action: TimerAction, allow: [AllowEntry]? = nil) {
    self.action = action
    self.allow = allow
  }

  public var json: JSONValue {
    var out: [String: JSONValue] = ["action": .string(action.rawValue)]
    if let allow { out["allow"] = .array(allow.map(\.json)) }
    return .object(out)
  }
}

/// The whole timer (normalizeTimer). `enabled` is the composer's switch and
/// is never sent; `deleteAt` (a pinned instant, ISO) and `lifespanSeconds`
/// are held side by side, never folded together.
public struct TimerRule: Codable, Hashable, Sendable {
  public var enabled: Bool
  public var deleteAt: String?
  public var lifespanSeconds: Int
  public var conditions: TimerConditions
  public var effects: [TimerEffect]

  public init(
    enabled: Bool = false, deleteAt: String? = nil, lifespanSeconds: Int = SelfDestruct.defaultLifespanSeconds,
    conditions: TimerConditions = TimerConditions(), effects: [TimerEffect] = [TimerEffect(action: .delete)]
  ) {
    self.enabled = enabled
    self.deleteAt = deleteAt
    self.lifespanSeconds = lifespanSeconds
    self.conditions = conditions
    self.effects = effects
  }

  enum CodingKeys: String, CodingKey { case enabled, deleteAt, lifespanSeconds, conditions, effects }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(enabled, forKey: .enabled)
    // `deleteAt: null` on the web, kept as a key.
    try c.encode(deleteAt, forKey: .deleteAt)
    try c.encode(lifespanSeconds, forKey: .lifespanSeconds)
    try c.encode(conditions, forKey: .conditions)
    try c.encode(effects, forKey: .effects)
  }

  public var json: JSONValue {
    [
      "enabled": .bool(enabled),
      "deleteAt": deleteAt.map(JSONValue.string) ?? .null,
      "lifespanSeconds": .number(Double(lifespanSeconds)),
      "conditions": conditions.json,
      "effects": .array(effects.map(\.json)),
    ]
  }
}

/// What the server is sent (toWireSpec): the rule without `enabled`, list
/// names stripped, `deleteAt` only when pinned.
public struct TimerWireSpec: Codable, Hashable, Sendable {
  public var lifespanSeconds: Int
  public var conditions: TimerConditions
  public var effects: [TimerEffect]
  public var deleteAt: String?

  public init(lifespanSeconds: Int, conditions: TimerConditions, effects: [TimerEffect], deleteAt: String? = nil) {
    self.lifespanSeconds = lifespanSeconds
    self.conditions = conditions
    self.effects = effects
    self.deleteAt = deleteAt
  }

  public var json: JSONValue {
    var out: [String: JSONValue] = [
      "lifespanSeconds": .number(Double(lifespanSeconds)),
      "conditions": conditions.json,
      "effects": .array(effects.map(\.json)),
    ]
    if let deleteAt { out["deleteAt"] = .string(deleteAt) }
    return .object(out)
  }
}

/// What a post can carry (the `fit` of fitTimerToPost): each true unless
/// said otherwise, as the web's destructuring defaults are.
public struct TimerFit: Codable, Hashable, Sendable {
  public var gatesSupported: Bool
  public var conditionsSupported: Bool
  public var replyLimitSupported: Bool
  public var available: Bool

  public init(
    gatesSupported: Bool = true, conditionsSupported: Bool = true, replyLimitSupported: Bool = true,
    available: Bool = true
  ) {
    self.gatesSupported = gatesSupported
    self.conditionsSupported = conditionsSupported
    self.replyLimitSupported = replyLimitSupported
    self.available = available
  }

  /// A loose `fit` object: an absent member defaults to true (the
  /// destructuring default); a present one counts by its truthiness.
  public init(json: JSONValue?) {
    func flag(_ key: String) -> Bool {
      guard let value = json?[key] else { return true }
      return value.isTruthy
    }
    self.init(
      gatesSupported: flag("gatesSupported"), conditionsSupported: flag("conditionsSupported"),
      replyLimitSupported: flag("replyLimitSupported"), available: flag("available"))
  }
}

/// settleForPublish's answer: the timer a just-published post gets, and
/// 'floor' when a stale pin became the five-minute floor (null otherwise,
/// a key the web's object holds).
public struct SettledTimer: Codable, Hashable, Sendable {
  public var timer: TimerRule
  public var adjusted: String?

  public init(timer: TimerRule, adjusted: String?) {
    self.timer = timer
    self.adjusted = adjusted
  }

  enum CodingKeys: String, CodingKey { case timer, adjusted }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(timer, forKey: .timer)
    try c.encode(adjusted, forKey: .adjusted)
  }
}

/// immediateTimerToSend's answer (`adjusted` and `spec` null when there is
/// none, as the web's object holds them).
public struct ImmediateTimerSend: Codable, Hashable, Sendable {
  public var timer: TimerRule
  public var adjusted: String?
  public var spec: TimerWireSpec?

  public init(timer: TimerRule, adjusted: String?, spec: TimerWireSpec?) {
    self.timer = timer
    self.adjusted = adjusted
    self.spec = spec
  }

  enum CodingKeys: String, CodingKey { case timer, adjusted, spec }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(timer, forKey: .timer)
    try c.encode(adjusted, forKey: .adjusted)
    try c.encode(spec, forKey: .spec)
  }
}

/// scheduledTimerToSend's answer: a refusal ('' for none) or the spec
/// (null with a refusal).
public struct ScheduledTimerSend: Codable, Hashable, Sendable {
  public var problem: String
  public var spec: TimerWireSpec?

  public init(problem: String, spec: TimerWireSpec?) {
    self.problem = problem
    self.spec = spec
  }

  enum CodingKeys: String, CodingKey { case problem, spec }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(problem, forKey: .problem)
    try c.encode(spec, forKey: .spec)
  }
}

/// scheduledGateChange's answer: the timer's gates seen from the reply
/// settings (`limitReplies` null when replies aren't limited).
public struct ScheduledGateChange: Codable, Hashable, Sendable {
  public var limitReplies: TimerEffect?
  public var disableQuotes: Bool

  public init(limitReplies: TimerEffect?, disableQuotes: Bool) {
    self.limitReplies = limitReplies
    self.disableQuotes = disableQuotes
  }

  enum CodingKeys: String, CodingKey { case limitReplies, disableQuotes }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(limitReplies, forKey: .limitReplies)
    try c.encode(disableQuotes, forKey: .disableQuotes)
  }
}

/// readStoredTimer's answer: the rule, disarmed when any part couldn't be
/// read, and the parts that couldn't.
public struct StoredTimer: Codable, Hashable, Sendable {
  public var timer: TimerRule
  public var unreadable: [String]
}

/// sessionDraftTimer's shape.
public struct SessionDraftTimer: Codable, Hashable, Sendable {
  public var timer: TimerRule
  public var touched: Bool
}

/// restoreSessionDraftTimer's answer.
public struct RestoredDraftTimer: Codable, Hashable, Sendable {
  public var timer: TimerRule
  public var expired: Bool
}

/// splitLifespan's answer: an amount of a unit key.
public struct LifespanParts: Codable, Hashable, Sendable {
  public var amount: Int
  public var unit: String
}

/// evaluateConditions' answer (a preview; the server decides).
public struct ConditionsEvaluation: Codable, Hashable, Sendable {
  public var matched: Bool
  public var spare: Bool
  public var met: [TimerMetric]
  public var set: [TimerMetric]
}

/// readCounts' answer: each count, absent or unreadable as zero. Doubles,
/// as `Number(x)` reads them (Infinity included).
public struct TimerCounts: Hashable, Sendable {
  public var likes: Double
  public var replies: Double
  public var reposts: Double
  public var quotes: Double
  public var selfReplies: Double

  public subscript(metric: TimerMetric) -> Double {
    switch metric {
    case .likes: return likes
    case .replies: return replies
    case .reposts: return reposts
    case .quotes: return quotes
    case .selfReplies: return selfReplies
    }
  }

  /// As JSON carries it (a non-finite count as null).
  public var json: JSONValue {
    func n(_ value: Double) -> JSONValue { value.isFinite ? .number(value) : .null }
    return [
      "likes": n(likes), "replies": n(replies), "reposts": n(reposts), "quotes": n(quotes),
      "selfReplies": n(selfReplies),
    ]
  }
}

/// One group of groupTimers: rows are the server's (or listScheduled's)
/// rows, as they came.
public struct TimerGroup: Codable, Hashable, Sendable {
  public var key: String
  public var title: String
  public var rows: [JSONValue]
}

/// What an account's timer slots hold (timerUsage), per bucket.
public struct TimerUsage: Codable, Hashable, Sendable {
  public var plain: Int
  public var conditional: Int

  public init(plain: Int = 0, conditional: Int = 0) {
    self.plain = plain
    self.conditional = conditional
  }

  /// `usage[bucket]`: nil for a name that isn't a bucket.
  public subscript(bucket: String) -> Int? {
    switch bucket {
    case "plain": return plain
    case "conditional": return conditional
    default: return nil
    }
  }
}

// MARK: - Inputs

/// A timer as a web function takes it: a TimerRule, or anything loose
/// (JSONValue; nil or null for none), read as normalizeTimer reads it.
public protocol TimerRuleInput: Sendable {
  /// The JavaScript value this is (nil for `undefined`).
  var timerRuleJSON: JSONValue? { get }
}

/// Conditions as a web function takes them.
public protocol TimerConditionsInput: Sendable {
  var timerConditionsJSON: JSONValue? { get }
}

/// A list of effects as a web function takes it.
public protocol TimerEffectsInput: Sendable {
  var timerEffectsJSON: JSONValue? { get }
}

extension TimerRule: TimerRuleInput {
  public var timerRuleJSON: JSONValue? { json }
}

extension TimerConditions: TimerConditionsInput {
  public var timerConditionsJSON: JSONValue? { json }
}

extension Array: TimerEffectsInput where Element == TimerEffect {
  public var timerEffectsJSON: JSONValue? { .array(map(\.json)) }
}

extension JSONValue: TimerRuleInput, TimerConditionsInput, TimerEffectsInput {
  public var timerRuleJSON: JSONValue? { self }
  public var timerConditionsJSON: JSONValue? { self }
  public var timerEffectsJSON: JSONValue? { self }
}

extension Optional: TimerRuleInput, TimerConditionsInput, TimerEffectsInput where Wrapped == JSONValue {
  public var timerRuleJSON: JSONValue? { self }
  public var timerConditionsJSON: JSONValue? { self }
  public var timerEffectsJSON: JSONValue? { self }
}
