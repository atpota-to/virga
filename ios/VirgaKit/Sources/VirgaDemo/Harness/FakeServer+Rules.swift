// Ports harness/fakeServer.js (the timer rules, the limits and the seeded ids)
//
// The pure parts of the fake server: the server's own readings of a timer's
// rule (parseEffects, parseConditions, narrowAllow, describeAllow, which
// harness/fakeServer.js ports from server/timers/selfDestruct.js), which
// limit a timer counts against, whether a rule spares a post, and the
// UUIDs of the seeded rows. Inputs are JSON as a request body carries it,
// read with JavaScript's semantics (truthiness, `Number()`, `String()`).
//
// One quirk of the web's is kept: ALLOW_WORDS and describeAllow's words are
// plain objects, so a word named after a key of Object.prototype
// ('toString', 'constructor', '__proto__', …) counts as a word there, and
// the rule written for it names the inherited function's source text.

import Foundation
import VirgaCore

extension FakeServer {
  static let day: Double = 86_400_000
  static let minute: Double = 60_000

  // The server's defaults (SCHEDULE_MAX_PENDING, TIMER_MAX_ACTIVE_PER_USER).
  public static let maxPendingScheduled = 50
  public static let maxLiveTimers = 200
  public static let maxHorizonDays = 90
  public static let minLifespanSeconds = 5 * 60
  public static let maxLifespanSeconds = 30 * 24 * 60 * 60

  /// The per-feature limits the server reads from its env (`FEATURES`).
  public static let features = ["scheduledPosts", "postTimers", "conditionalTimers"]

  /// The longest text /api/ai/analyze-post reads (`MAX_ANALYZE_TEXT`).
  public static let maxAnalyzeText = 8000

  static let metrics = ["likes", "replies", "reposts", "quotes", "selfReplies"]
  static let effectOrder = ["limitReplies", "disableQuotes", "delete"]
  /// `ALLOW_WORDS`, in its key order.
  static let allowWords: [(word: String, rule: String)] = [
    ("follower", "followerRule"), ("following", "followingRule"), ("mention", "mentionRule"),
  ]
  static let sessionUnavailable =
    "couldn't reach your account session. reconnect your account if this keeps happening."
  static let gate = "app.bsky.feed.threadgate"

  // MARK: Plain objects' inherited keys

  /// What `${object[key]}` writes for a key a plain object inherits from
  /// Object.prototype (V8's source text of the builtin), or nil for a key
  /// it doesn't have at all.
  static func inheritedText(_ key: String) -> String? {
    if key == "__proto__" { return "[object Object]" }
    if key == "constructor" { return "function Object() { [native code] }" }
    guard FakeXrpc.objectPrototypeKeys.contains(key) else { return nil }
    return "function \(key)() { [native code] }"
  }

  /// `ALLOW_WORDS[word]` as text: the rule's own name, or an inherited
  /// key's source text, or nil.
  static func allowWord(_ word: String) -> String? {
    allowWords.first { $0.word == word }?.rule ?? inheritedText(word)
  }

  // MARK: Seeded rows

  /// `seededUuid(name)`: a UUID that stays the same between page loads, for
  /// the seeded rows.
  public static func seededUuid(_ name: String) -> String {
    func h(_ k: Int) -> String {
      let text = String(World.hashOf("\(name):\(k)"), radix: 16)
      return String(repeating: "0", count: max(0, 8 - text.count)) + text
    }
    let a = h(1) + h(2) + h(3) + h(4)
    return "\(a.jsSlice(0, 8))-\(a.jsSlice(8, 12))-4\(a.jsSlice(13, 16))-8\(a.jsSlice(17, 20))-\(a.jsSlice(20, 32))"
  }

  // MARK: Timer rules

  /// `normalizeAllowEntry(a)`: one allow entry, a word or `{ list }`, or nil
  /// when it isn't one.
  static func normalizeAllowEntry(_ a: JSONValue?) -> JSONValue? {
    if case .string(let word)? = a { return allowWord(word) != nil ? a : nil }
    if let a, a.isTruthy, case .object = a, case .string(let list)? = a["list"], list.jsHasPrefix("at://") {
      return ["list": .string(list)]
    }
    return nil
  }

  /// `normalizeAllow(allow)`: the entries, five at most; `['follower']`
  /// for no list, nil when one can't be read.
  static func normalizeAllow(_ allow: JSONValue?) -> [JSONValue]? {
    guard case .array(let items)? = allow else { return ["follower"] }
    var out: [JSONValue] = []
    for a in items {
      guard let entry = normalizeAllowEntry(a) else { return nil }
      out.append(entry)
    }
    return Array(out.prefix(5))
  }

  /// `allowRuleRecord(entry)`: the threadgate rule record one allow entry
  /// stands for.
  static func allowRuleRecord(_ entry: JSONValue) -> JSONValue {
    if case .string(let word) = entry {
      return ["$type": .string("\(gate)#\(allowWord(word) ?? "undefined")")]
    }
    return ["$type": .string("\(gate)#listRule"), "list": entry["list"] ?? .null]
  }

  /// `allowRecordKey(record)`: a rule's identity on a gate (two listRules
  /// match only on the same list), or nil.
  static func allowRecordKey(_ record: JSONValue?) -> String? {
    guard let record, record.isTruthy, case .string(let type)? = record["$type"] else { return nil }
    if type == "\(gate)#listRule" { return "list:\(record["list"].map(\.jsString) ?? "undefined")" }
    return type
  }

  /// `allowEntryFromRecord(record)`: allowRuleRecord read backwards, or nil
  /// for a rule with no word here.
  static func allowEntryFromRecord(_ record: JSONValue?) -> JSONValue? {
    guard let record, record.isTruthy, case .string(let type)? = record["$type"] else { return nil }
    if type == "\(gate)#listRule" {
      if case .string(let list)? = record["list"] { return ["list": .string(list)] }
      return nil
    }
    return allowWords.first { type == "\(gate)#\($0.rule)" }.map { .string($0.word) }
  }

  /// What narrowAllow decides: a gate to write, or a reason to leave it be.
  public struct Narrowed: Hashable, Sendable {
    /// The rules to write, when there is a gate to write.
    public var allow: [JSONValue]?
    public var skip = false
    public var ok = false
    public var detail: String?

    /// The web's object: `{ allow }` or `{ skip, ok, detail }`.
    public var json: JSONValue {
      if let allow { return ["allow": .array(allow)] }
      return ["skip": .bool(skip), "ok": .bool(ok), "detail": detail.map(JSONValue.string) ?? .null]
    }
  }

  /// `narrowAllow(wantedEntries, existingAllow)`: the server's narrowAllow.
  /// Writing a threadgate replaces it, so a rule may only intersect with
  /// the gate already there; when they share nothing the gate is left as
  /// the author set it.
  public static func narrowAllow(_ wantedEntries: JSONValue?, _ existingAllow: JSONValue?) throws -> Narrowed {
    let entries: [JSONValue]
    switch wantedEntries {
    case .none, .some(.null): entries = []
    case .some(let value) where !value.isTruthy: entries = []
    case .some(.array(let items)): entries = items
    default: throw HarnessJSError.typeError("(wantedEntries || []).map is not a function")
    }
    let wanted = entries.compactMap(normalizeAllowEntry).map(allowRuleRecord)
    guard case .array(let existing)? = existingAllow else { return Narrowed(allow: wanted) }
    if existing.isEmpty { return Narrowed(skip: true, ok: true, detail: "replies were already closed to everyone") }
    if wanted.isEmpty { return Narrowed(allow: []) }
    let had = Set(existing.compactMap(allowRecordKey).filter { !$0.isEmpty }.map(JSKey.init))
    let allow = wanted.filter { allowRecordKey($0).map { had.contains(JSKey($0)) } ?? false }
    if allow.isEmpty {
      return Narrowed(skip: true, ok: false, detail: "left the reply settings alone; the rule would have opened them up")
    }
    if allow.count == existing.count { return Narrowed(skip: true, ok: true, detail: "replies were already limited this way") }
    return Narrowed(allow: allow)
  }

  /// `describeAllow(entries)`: the server's describeAllow, what a written
  /// gate lets reply, in words. `entries` is iterated as the web's
  /// `for…of` iterates it: a list by its items, text by its code points
  /// (none of which is a word), and anything else is refused with V8's
  /// TypeError.
  public static func describeAllow(_ entries: JSONValue?) throws -> String {
    let items: [JSONValue]
    switch entries {
    case .some(.array(let list)): items = list
    case .some(.string(let text)): items = text.unicodeScalars.map { .string(String($0)) }
    case .some(let value) where value.isTruthy: throw HarnessJSError.typeError("(entries || []) is not iterable")
    default: items = []
    }
    let words = [("follower", "your followers"), ("following", "people you follow"), ("mention", "people you mentioned")]
    var parts: [String] = []
    var lists = 0
    for entry in items {
      if case .string(let word) = entry {
        if let text = words.first(where: { $0.0 == word })?.1 ?? inheritedText(word) { parts.append(text) }
      } else if entry.isTruthy, entry["list"]?.isTruthy == true {
        lists += 1
      }
    }
    if lists == 1 {
      parts.append("people in a list you chose")
    } else if lists > 1 {
      parts.append("people in \(lists) lists you chose")
    }
    if parts.isEmpty { return "replies limited to nobody" }
    if parts.count == 1 { return "replies limited to \(parts[0])" }
    return "replies limited to \(parts.dropLast().joined(separator: ", ")) and \(parts[parts.count - 1])"
  }

  /// A reading that is a value or a sentence of refusal: `{ value }` or `{ error }`.
  public struct Reading: Hashable, Sendable {
    public var value: JSONValue?
    public var error: String?

    public static func value(_ value: JSONValue) -> Reading { Reading(value: value) }
    public static func error(_ error: String) -> Reading { Reading(error: error) }

    public var json: JSONValue {
      if let error { return ["error": .string(error)] }
      return ["value": value ?? .null]
    }
  }

  /// `parseEffects(raw)`: the server's parseEffects. Absent means delete;
  /// anything unreadable is refused, never read as delete.
  public static func parseEffects(_ raw: JSONValue?) -> Reading {
    switch raw {
    case .none, .some(.null): return .value([["action": "delete"]])
    case .some(.array(let items)) where items.isEmpty: return .value([["action": "delete"]])
    default: break
    }
    guard case .array(let items)? = raw else { return .error("selfDestruct.effects must be a list") }
    var byAction: [(action: String, effect: JSONValue)] = []
    for item in items {
      guard item.isTruthy, case .string(let action)? = item["action"], effectOrder.contains(action) else {
        return .error(
          "that rule asks for something this server does not know how to do. update, or set a plain delete timer.")
      }
      let effect: JSONValue
      if action == "limitReplies" {
        guard let allow = normalizeAllow(item["allow"]) else {
          return .error("that reply rule names someone this server cannot read.")
        }
        effect = ["action": .string(action), "allow": .array(allow)]
      } else {
        effect = ["action": .string(action)]
      }
      // Map.set keeps a key's first place.
      if let i = byAction.firstIndex(where: { $0.action == action }) {
        byAction[i].effect = effect
      } else {
        byAction.append((action, effect))
      }
    }
    let sorted = byAction.sorted { effectOrder.firstIndex(of: $0.action)! < effectOrder.firstIndex(of: $1.action)! }
    return .value(.array(sorted.map(\.effect)))
  }

  /// `parseConditions(raw)`: the server's parseConditions, with the legacy
  /// `mode` / `minLikes` keys read the same way.
  public static func parseConditions(_ raw: JSONValue?) -> Reading {
    let src: JSONValue
    switch raw {
    case .some(.object), .some(.array): src = raw!
    default: src = [:]
    }
    var items: [JSONValue] = src["clauses"]?.arrayValue ?? []
    for (legacy, metric) in [("minLikes", "likes"), ("minReplies", "replies"), ("minReposts", "reposts")] {
      // `legacy in src`: an own key (an array has none of these).
      if let value = src.objectValue?[legacy] {
        items.append(["metric": .string(metric), "op": "gte", "value": value])
      }
    }
    var clauses: [(index: Int, clause: JSONValue, metric: String, from: Bool)] = []
    for c in items {
      guard c.isTruthy, case .string(let metric)? = c["metric"], metrics.contains(metric) else {
        return .error("that rule counts something this server does not know.")
      }
      let number = c["value"].jsNumber.rounded(.down)
      let value = number.isNaN ? Double.nan : Swift.min(1_000_000, number)
      if !value.isFinite || value < 1 { return .error("a rule needs a number of at least one.") }
      let from = c["from"]?.isTruthy == true
      if from && metric != "quotes" { return .error("only quotes can be counted from some people.") }
      if clauses.contains(where: { $0.metric == metric && !$0.from && !from }) { continue }
      var clause: [String: JSONValue] = [
        "metric": .string(metric), "op": c["op"] == .string("gt") ? "gt" : "gte", "value": .number(value),
      ]
      if from { clause["from"] = c["from"] }
      clauses.append((clauses.count, .object(clause), metric, from))
    }
    if clauses.count > 5 { return .error("a rule can have at most five parts.") }
    clauses.sort {
      let (a, b) = (metrics.firstIndex(of: $0.metric)!, metrics.firstIndex(of: $1.metric)!)
      return a != b ? a < b : $0.index < $1.index
    }
    func oneOf(_ key: String) -> String? {
      guard case .string(let text)? = src[key], text == "any" || text == "all" else { return nil }
      return text
    }
    let logic = oneOf("logic") ?? oneOf("mode") ?? "any"
    let onSpare = src["onSpare"] == .string("extend") ? "extend" : "keep"
    let wanted = src["maxExtensions"].jsNumber
    let maxExtensions: Double =
      onSpare == "extend" ? (wanted.isFinite ? Swift.min(Swift.max(wanted.rounded(.down), 1), 10) : 1) : 0
    return .value([
      "logic": .string(logic),
      "clauses": .array(clauses.map(\.clause)),
      "sense": src["sense"] == .string("onlyIf") ? "onlyIf" : "unless",
      "onSpare": .string(onSpare),
      "maxExtensions": .number(maxExtensions),
    ])
  }

  /// `x.length` for a value JSON can hold, as a number (NaN for undefined).
  static func jsLengthOf(_ value: JSONValue?) -> Double {
    switch value {
    case .some(.array(let items)): return Double(items.count)
    case .some(.string(let text)): return Double(text.jsLength)
    case .some(.object(let members)): return members["length"].jsNumber
    default: return .nan
    }
  }

  /// `timerBucket({ conditions, effects })`: which limit a timer counts
  /// against. Anything but a plain delete is conditional. Effects that
  /// aren't a list (or hold a null) are refused with V8's TypeError, as
  /// `(effects || []).some(e => e.action …)` refuses them.
  public static func timerBucket(conditions: JSONValue?, effects: JSONValue?) throws -> String {
    let clauses = conditions?["clauses"].jsTruthy
    var gentle = false
    if let effects, effects.isTruthy {
      guard case .array(let items) = effects else { throw HarnessJSError.typeError("(effects || []).some is not a function") }
      for e in items {
        if e.isNull { throw HarnessJSError.typeError("Cannot read properties of null (reading 'action')") }
        if e["action"] != .string("delete") {
          gentle = true
          break
        }
      }
    }
    return jsLengthOf(clauses ?? .array([])) > 0 || gentle ? "conditional" : "plain"
  }

  /// The feature a bucket's limit is (`BUCKET_FEATURE`).
  static func bucketFeature(_ bucket: String) -> String {
    bucket == "plain" ? "postTimers" : "conditionalTimers"
  }

  /// `Number.isSafeInteger(value)`.
  static func isSafeInteger(_ value: JSONValue?) -> Bool {
    guard case .number(let n)? = value else { return false }
    return n.isFinite && n.rounded(.towardZero) == n && abs(n) <= 9_007_199_254_740_991
  }

  /// `limitValue(value)`: a positive whole number, or nil (unlimited), as
  /// the server reads its env.
  public static func limitValue(_ value: JSONValue?) -> Int? {
    guard isSafeInteger(value), let n = value?.doubleValue, n > 0 else { return nil }
    return Int(n)
  }

  /// `aiLimitValue(value, fallback)`: nil (null) is unlimited, 0 refuses
  /// everything, absent (or unreadable) is the fallback.
  public static func aiLimitValue(_ value: JSONValue?, _ fallback: Int) -> Int? {
    if value == .null { return nil }
    guard isSafeInteger(value), let n = value?.doubleValue, n >= 0 else { return fallback }
    return Int(n)
  }

  /// `describeCounts(c)`.
  static func describeCounts(_ c: JSONValue) -> String {
    func n(_ key: String, _ one: String, _ many: String) -> String {
      let v = c[key]
      let text = v.map(\.jsString) ?? "undefined"
      return "\(text) \(v == .number(1) ? one : many)"
    }
    return "\(n("likes", "like", "likes")), \(n("replies", "reply", "replies")), \(n("reposts", "repost", "reposts"))"
  }

  /// What evaluateConditions answers: whether the rule spares the post, and why.
  public struct Verdict: Hashable, Sendable {
    public var spare: Bool
    public var matched: Bool
    public var reason: String

    public var json: JSONValue { ["spare": .bool(spare), "matched": .bool(matched), "reason": .string(reason)] }
  }

  /// `a > b` and `a >= b` as JavaScript compares two values JSON can hold:
  /// each made a primitive first (a list is its items joined, an object
  /// "[object Object]"), then two strings compare by code unit and
  /// anything else as numbers.
  static func jsCompare(_ a: JSONValue?, _ b: JSONValue?, orEqual: Bool) -> Bool {
    func primitive(_ v: JSONValue?) -> JSONValue? {
      switch v {
      case .some(.array), .some(.object): return .string(v!.jsString)
      default: return v
      }
    }
    let (p, q) = (primitive(a), primitive(b))
    if case .string(let x)? = p, case .string(let y)? = q {
      let (u, v) = (Array(x.utf16), Array(y.utf16))
      return v.lexicographicallyPrecedes(u) || (orEqual && u == v)
    }
    let (x, y) = (p.map(\.jsNumber) ?? .nan, q.map(\.jsNumber) ?? .nan)
    return orEqual ? x >= y : x > y
  }

  /// `counts[c.metric]`: the count a clause reads (the metric as a key,
  /// as JavaScript writes it), and what `${…}` writes for it. A key the
  /// counts don't have but a plain object inherits reads as the builtin
  /// (compared as its source text, as JavaScript turns it into one).
  static func countOf(_ counts: JSONValue, _ c: JSONValue) throws -> (value: JSONValue?, text: String) {
    let key = c["metric"].map(\.jsString) ?? "undefined"
    switch counts {
    case .null: throw HarnessJSError.typeError("Cannot read properties of null (reading '\(key)')")
    case .object(let members):
      if let value = members.jsValue(key) { return (value, value.jsString) }
      if let inherited = inheritedText(key) { return (.string(inherited), inherited) }
      return (nil, "undefined")
    default:
      guard let value = counts[key] else { return (nil, "undefined") }
      return (value, value.jsString)
    }
  }

  /// `evaluateConditions(conditions, counts)`: whether the rule spares the
  /// post on these counts, and why. Clauses that aren't a list, a clause
  /// that is null, and conditions that are missing are refused with V8's
  /// TypeErrors. `counts` is the server's own `{ likes, replies, … }`
  /// (a JSON object; other values read only their own members).
  public static func evaluateConditions(_ conditions: JSONValue?, _ counts: JSONValue) throws -> Verdict {
    var clauses: [JSONValue] = []
    if let given = conditions?["clauses"], given.isTruthy {
      guard case .array(let list) = given else {
        throw HarnessJSError.typeError("clauses.filter is not a function")
      }
      clauses = list
    }
    var met = 0
    for c in clauses {
      if c.isNull { throw HarnessJSError.typeError("Cannot read properties of null (reading 'op')") }
      let have = try countOf(counts, c).value
      if jsCompare(have, c["value"], orEqual: c["op"] != .string("gt")) { met += 1 }
    }
    guard let conditions, !conditions.isNull else {
      throw HarnessJSError.typeError("Cannot read properties of \(conditions == nil ? "undefined" : "null") (reading 'logic')")
    }
    let matched = conditions["logic"] == .string("all") ? met == clauses.count : met > 0
    let spare = conditions["sense"] == .string("onlyIf") ? !matched : matched
    let reason = try clauses.map { c -> String in
      "\(try countOf(counts, c).text) of \(c["value"].map(\.jsString) ?? "undefined") \(c["metric"].map(\.jsString) ?? "undefined")"
    }.joined(separator: ", ")
    return Verdict(spare: spare, matched: matched, reason: matched ? "matched with \(reason)" : "short of \(reason)")
  }
}
