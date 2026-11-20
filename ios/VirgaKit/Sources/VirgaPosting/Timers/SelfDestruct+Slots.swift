// Ports src/posting/timers/selfDestruct.js
//
// The preview evaluator ("2 of 5 likes"), the timer list's groups and
// order, and the account's timer slots: which bucket a timer takes, what
// the slots hold, and the sentences for a full one. Rows are the server's
// timer rows (or listScheduled's rows) as JSON, read as loosely as the web
// reads them.

import Foundation
import VirgaCore

extension SelfDestruct {
  // MARK: - Evaluation

  // Preview only (e.g. "2 of 5 likes" in the timer list). The server makes
  // the real decision against counts it reads itself.

  public static func evaluateConditions(_ conditions: some TimerConditionsInput, _ counts: JSONValue?)
    -> ConditionsEvaluation
  {
    let c = normalizeConditions(conditions)
    let got = readCounts(counts)
    if c.clauses.isEmpty { return ConditionsEvaluation(matched: false, spare: false, met: [], set: []) }
    let met = c.clauses.filter { clause in
      clause.op == .gt ? got[clause.metric] > Double(clause.value) : got[clause.metric] >= Double(clause.value)
    }
    let matched = c.logic == .all ? met.count == c.clauses.count : !met.isEmpty
    return ConditionsEvaluation(
      matched: matched,
      spare: c.sense == .onlyIf ? !matched : matched,
      met: met.map(\.metric),
      set: c.clauses.map(\.metric))
  }

  /// Counts in the evaluator's shape; absent (or unreadable) reads as zero.
  public static func readCounts(_ counts: JSONValue?) -> TimerCounts {
    let src = TimerJS.truthy(counts)
    func read(_ key: String) -> Double {
      let n = src?[key].jsNumber ?? .nan
      return n.isNaN || n == 0 ? 0 : n
    }
    return TimerCounts(
      likes: read("likes"), replies: read("replies"), reposts: read("reposts"), quotes: read("quotes"),
      selfReplies: read("selfReplies"))
  }

  // MARK: - The timer list

  static func isLive(_ row: JSONValue?) -> Bool {
    let status = row?["status"]
    return status == .string("armed") || status == .string("checking")
  }

  /// The timer list grouped, each group sorted by compareTimers and dropped
  /// when empty:
  ///
  ///   live     still counting down (or mid-check)
  ///   failed   gave up; the post is still up
  ///   settled  default view: rules that fired without deleting in the last
  ///            week (the server sends those after the live rows); with
  ///            history, everything that has settled
  public static func groupTimers(_ rows: [JSONValue]?, history: Bool = false, timeZone: TimeZone? = nil)
    -> [TimerGroup]
  {
    let sorted = TimerJS.v8Sorted(rows ?? []) { compareTimers($0, $1, timeZone: timeZone) }
    var live: [JSONValue] = []
    var failed: [JSONValue] = []
    var settled: [JSONValue] = []
    for row in sorted {
      if isLive(row) {
        live.append(row)
      } else if row["status"] == .string("failed") {
        failed.append(row)
      } else {
        settled.append(row)
      }
    }
    return [
      TimerGroup(key: "live", title: "Counting down", rows: live),
      TimerGroup(key: "failed", title: "Gave up, post still up", rows: failed),
      TimerGroup(key: "settled", title: history ? "Settled" : "Changed this week", rows: settled),
    ].filter { !$0.rows.isEmpty }
  }

  /// Live timers first (soonest first), then settled (most recent first).
  /// A row whose time can't be read sorts beside everything (0).
  public static func compareTimers(_ a: JSONValue?, _ b: JSONValue?, timeZone: TimeZone? = nil) -> Double {
    let liveA = isLive(a)
    let liveB = isLive(b)
    if liveA != liveB { return liveA ? -1 : 1 }
    func when(_ row: JSONValue?, _ live: Bool) -> Double {
      // `(live ? row?.checkAt : row?.resolvedAt) || row?.checkAt || 0`
      let first = live ? row?["checkAt"] : row?["resolvedAt"]
      let picked: JSONValue = TimerJS.truthy(first) ?? TimerJS.truthy(row?["checkAt"]) ?? 0
      return TimerJS.dateMs(picked, timeZone: timeZone)
    }
    let at = when(a, liveA)
    let bt = when(b, liveB)
    if !at.isFinite || !bt.isFinite { return 0 }
    return liveA ? at - bt : bt - at
  }

  /// Scheduled and queued posts that carry a lifespan and haven't gone out
  /// yet, soonest first. Their timer is armed when they publish, so the
  /// server's timer list doesn't hold them until then. Takes listScheduled's
  /// `rows`.
  public static func waitingTimerRows(_ rows: [JSONValue]?, timeZone: TimeZone? = nil) -> [JSONValue] {
    func at(_ row: JSONValue) -> Double {
      let ms = TimerJS.dateMs(row["scheduledFor"], timeZone: timeZone)
      return ms.isNaN || ms == 0 ? 0 : ms
    }
    let waiting = (rows ?? []).filter { row in
      let status = row["status"]
      return row["payload"]?["selfDestruct"]?.isTruthy == true
        && (status == .string("pending") || status == .string("publishing"))
    }
    return TimerJS.v8Sorted(waiting) { at($0) - at($1) }
  }

  // MARK: - Slots

  /// Which of an account's two timer slots a timer takes: 'conditional'
  /// when it reads counts before acting or does anything other than delete,
  /// else 'plain'. Mirrors server/timers/timerUsage.js timerBucket, which
  /// decides.
  public static func timerBucket(_ timer: JSONValue?) -> String {
    let hasClauses = !normalizeConditions(timer?["conditions"]).clauses.isEmpty
    let onlyDeletes = normalizeEffects(timer?["effects"]).allSatisfy { $0.action == .delete }
    return hasClauses || !onlyDeletes ? "conditional" : "plain"
  }

  public static func timerBucket(_ timer: TimerRule) -> String {
    timerBucket(timer.json)
  }

  /// The server's limit feature behind each bucket (`/api/limits/status`, a
  /// 402's `feature`).
  public static let timerBucketFeature: [String: String] = [
    "plain": "postTimers",
    "conditional": "conditionalTimers",
  ]

  /// The bucket behind each of the server's refusal features (a 402's
  /// `feature`).
  public static let timerSlotFeatureBucket: [String: String] = [
    "postTimers": "plain",
    "conditionalTimers": "conditional",
  ]

  /// What an account's timer slots hold, per bucket: live timers (the
  /// server's list) plus scheduled and queued posts waiting with one, which
  /// hold theirs from the moment they are scheduled. `exceptScheduledId`
  /// leaves out the row an edit is rewriting.
  public static func timerUsage(
    liveRows: [JSONValue]? = [], scheduledRows: [JSONValue]? = [], exceptScheduledId: JSONValue? = nil
  ) -> TimerUsage {
    var usage = TimerUsage()
    func add(_ bucket: String) {
      if bucket == "plain" { usage.plain += 1 } else { usage.conditional += 1 }
    }
    for row in liveRows ?? [] where isLive(row) { add(timerBucket(row)) }
    for row in scheduledRows ?? [] {
      if let except = exceptScheduledId, except.isTruthy, strictEquals(row["id"], except) { continue }
      let status = row["status"]
      if status == .string("pending") || status == .string("publishing"),
        let spec = row["payload"]?["selfDestruct"], spec.isTruthy
      {
        add(timerBucket(spec))
      }
    }
    return usage
  }

  /// `a === b` for JSON values: strings by code unit, numbers by value,
  /// objects and arrays never (they would be different objects).
  static func strictEquals(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    switch (a, b) {
    case (.string(let x)?, .string(let y)?): return x.jsEquals(y)
    case (.number(let x)?, .number(let y)?): return x == y
    case (.bool(let x)?, .bool(let y)?): return x == y
    case (.null?, .null?), (nil, nil): return true
    default: return false
    }
  }

  /// The sentence an account with a timer limit sees when the slot a timer
  /// needs is taken, or '' when it is free. `limit` nil means unlimited.
  public static func timerSlotProblem(bucket: String, limit: Double?, usage: TimerUsage?) -> String {
    guard let limit, let usage else { return "" }
    let used = Double(usage[bucket] ?? 0)
    if used < limit { return "" }
    return timerSlotSentence(bucket, limit)
  }

  /// "This account can keep one … at a time …": the slot sentence on its
  /// own. Plain, with no offer attached: the limit is set by Virga's server.
  public static func timerSlotSentence(_ bucket: String?, _ limit: Double = 1) -> String {
    timerSlotSentence(bucket, JSONValue.number(limit))
  }

  /// timerSlotSentence for a loose limit (a refusal's `payload.limit`):
  /// only the number 1 is "one", anything else is written as it is.
  public static func timerSlotSentence(_ bucket: String?, _ limit: JSONValue) -> String {
    let kind = bucket == "conditional" ? "conditional timer" : "plain timer"
    let one = limit == .number(1)
    let count = one ? "one \(kind)" : "\(limit.jsString) \(kind)s"
    let taken = one ? "it’s in use" : "all of them are in use"
    return "This account can keep \(count) at a time, counting scheduled posts, and \(taken)."
  }

  /// The slot sentence for a refusal from the server (`err.payload` of a
  /// 402/409 naming `postTimers` or `conditionalTimers`), or '' for any
  /// other refusal.
  public static func timerSlotRefusal(_ payload: JSONValue?) -> String {
    guard let feature = payload?["feature"]?.stringValue, let bucket = timerSlotFeatureBucket[feature] else {
      return ""
    }
    let limit = TimerJS.present(payload?["limit"]) ?? 1
    return timerSlotSentence(bucket, limit)
  }

  /// Why `rule` can't be armed right now under the account's limits, or ''
  /// when it can (or when nothing is known: the server decides). `limits` is
  /// getLimits' answer (`features[feature].limit`, `usage[feature]`).
  /// `holds` is the timer a write already holds a slot for (the scheduled
  /// row being edited: its `payload.selfDestruct`), which frees that slot
  /// for this one.
  public static func timerRoomProblem(_ rule: some TimerRuleInput, _ limits: JSONValue?, holds: JSONValue? = nil)
    -> String
  {
    let t = normalizeTimer(rule)
    guard t.enabled, let limits, limits.isTruthy else { return "" }
    let bucket = timerBucket(t)
    let feature = timerBucketFeature[bucket]!
    guard case .number(let limit)? = limits["features"]?[feature]?["limit"], limit.isFinite,
      case .number(var used)? = limits["usage"]?[feature], used.isFinite
    else { return "" }
    if let holds, holds.isTruthy, TimerJS.isObject(holds), timerBucket(holds) == bucket { used -= 1 }
    return used >= limit ? timerSlotSentence(bucket, limit) : ""
  }
}
