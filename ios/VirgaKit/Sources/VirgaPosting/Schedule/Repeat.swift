// Ports src/posting/schedule/repeat.js
//
// A scheduled post that repeats: the rule the composer holds, what it sends
// to Virga's server, when the occurrences fall, and the words for all of
// it. Pure: every clock and zone is passed in.
//
// In the composer the rule rides on the schedule (`schedule.repeat`):
//
//   { every: 'day' | 'week' | '2weeks' | 'month', until?: 'YYYY-MM-DD', count?: N,
//     ends?: 'on' | 'after' }
//
// `ends` is only the picker's: it says which end is being filled in while
// the date or the number is still blank, so a half-typed end is asked for
// rather than read as "never".
//
// The server stores it with the zone it was picked in and an anchor ("the
// occurrence numbered n goes out at this wall-clock date and time"), and
// counts every later occurrence from that anchor, so 9:00 stays 9:00 across
// a clock change and the 31st falls on the last day of a shorter month.
//
// Rules are taken as the web takes them (JSONValue), the composer's shape
// and the server's stored one alike. Where the web reads the device's
// clock or calendar (a zone-less `at`, "this year" in a short date), the
// Swift takes `now` and `timeZone` (nil: AppLocale's active zone).

import Foundation
import VirgaCore

/// A rule as the composer holds it: `{ every, until?, count? }`.
public struct RepeatRule: Codable, Hashable, Sendable {
  /// 'day' | 'week' | '2weeks' | 'month'.
  public var every: String
  public var until: String?
  public var count: Double?

  public init(every: String, until: String? = nil, count: Double? = nil) {
    self.every = every
    self.until = until
    self.count = count
  }

  /// The rule as the web's object.
  public var json: JSONValue {
    var object: [String: JSONValue] = ["every": .string(every)]
    if let count { object["count"] = .number(count) }
    if let until { object["until"] = .string(until) }
    return .object(object)
  }

  public func encode(to encoder: Encoder) throws { try json.encode(to: encoder) }
}

/// An option of the Repeat picker: `{ value, label }`.
public struct RepeatOption: Codable, Hashable, Sendable {
  public var value: String
  public var label: String
}

/// When an occurrence goes out: `{ date, at }` (the wall date, epoch ms).
public struct RepeatOccurrenceTime: Codable, Hashable, Sendable {
  public var date: String
  public var at: Double
}

/// The next occurrence of a series: `{ occurrence, scheduledFor }` (ISO-Z).
public struct RepeatNextOccurrence: Codable, Hashable, Sendable {
  public var occurrence: Double
  public var scheduledFor: String
}

/// What a scheduled row's series amounts to, for the Scheduled page.
public struct RowRepeat: Codable, Hashable, Sendable {
  /// It carries the rule: more follow it.
  public var repeats: Bool
  /// 'Every week'.
  public var label: String
  /// '3 of 10' | 'until 5 Dec' | ''.
  public var progress: String
  /// This is the series' last occurrence.
  public var last: Bool
  /// It belonged to a repeating post that has moved on, or was stopped.
  public var former: Bool
}

public enum Repeat {
  public static let repeatEvery = ["day", "week", "2weeks", "month"]

  /// The most a post may repeat "after N times" (the server's ceiling).
  public static let maxRepeatCount: Double = 400

  // As the server: how many missed slots a series looks past for its next one.
  static let maxMissedSlots: Double = 3700

  public static let repeatOptions = [
    RepeatOption(value: "", label: "Doesn’t repeat"),
    RepeatOption(value: "day", label: "Every day"),
    RepeatOption(value: "week", label: "Every week"),
    RepeatOption(value: "2weeks", label: "Every two weeks"),
    RepeatOption(value: "month", label: "Every month"),
  ]

  /// Why a reply can't repeat, and why a queued post can't.
  public static let repeatReplyHint = "A reply can’t repeat: it would answer the same post again each time."
  public static let repeatQueueHint = "A post in the queue can’t repeat. Schedule it for a set time instead."

  static let daySteps: [String: Double] = ["day": 1, "week": 7, "2weeks": 14]

  /// `String(n).padStart(2, '0')`.
  static func pad(_ n: Double) -> String {
    let text = JSNumber.format(n)
    return text.utf16.count >= 2 ? text : String(repeating: "0", count: 2 - text.utf16.count) + text
  }

  /// A calendar date 'YYYY-MM-DD' that is on the calendar, as numbers.
  static func parseDate(_ date: JSONValue?) -> (y: Double, m: Double, d: Double)? {
    guard let f = PostingQueue.fields(PostingQueue.text(date), [4, 2, 2], "-") else { return nil }
    let (y, mo, d) = (f[0], f[1], f[2])
    guard let check = JSDate.utcFields(JSDate.utc(y, mo - 1, d)),
      Double(check.month) == mo - 1, Double(check.date) == d
    else { return nil }
    return (y, mo, d)
  }

  /// `a === b` for a loose member and a string literal.
  static func isString(_ value: JSONValue?, _ literal: String) -> Bool {
    value?.stringValue?.jsEquals(literal) ?? false
  }

  /// `REPEAT_EVERY.includes(v)`.
  static func isEvery(_ value: JSONValue?) -> Bool { ComposerJS.includes(repeatEvery, value) }

  /// `v === undefined || v === null || v === ''`.
  static func blank(_ value: JSONValue?) -> Bool {
    guard let value else { return true }
    return value.isNull || value == .string("")
  }

  /// A rule as the composer holds it, or nil for a post that doesn't repeat
  /// (or a rule that can't be read). Takes the composer's own shape and the
  /// server's stored one.
  public static func normalizeRepeat(_ raw: JSONValue?) -> RepeatRule? {
    guard let raw, ComposerJS.truthy(raw), TimerJS.isObject(raw), isEvery(raw["every"]),
      let every = raw["every"]?.stringValue
    else { return nil }
    var out = RepeatRule(every: every)
    let count = raw["count"].jsNumber
    let hasCount = !blank(raw["count"]) && count.isFinite && count.rounded(.towardZero) == count && count >= 1
    let hasUntil = raw["until"]?.stringValue != nil && parseDate(raw["until"]) != nil
    // The picker says which end it means; a stored rule has only one.
    if hasCount && !isString(raw["ends"], "on") {
      out.count = count
    } else if hasUntil && !isString(raw["ends"], "after") {
      out.until = raw["until"]?.stringValue
    }
    return out
  }

  /// How a rule ends, for the picker: 'never' | 'on' | 'after'.
  public static func repeatEnds(_ raw: JSONValue?) -> String {
    if isString(raw?["ends"], "on") || isString(raw?["ends"], "after") { return raw!["ends"]!.stringValue! }
    guard let r = normalizeRepeat(raw) else { return "never" }
    if let count = r.count, count != 0 { return "after" }
    return r.until.map { $0.isEmpty ? "never" : "on" } ?? "never"
  }

  /// Why a rule can't be used for a post going out at `at` (an ISO string)
  /// on the clock of `tz`, or ''. `occurrence` is the number of the
  /// occurrence being edited, 1 for a new post. A zone-less `at` is read in
  /// `timeZone` (the device's).
  public static func repeatProblem(
    _ raw: JSONValue?, _ at: JSONValue?, _ tz: JSONValue?, occurrence: Double = 1, timeZone: TimeZone? = nil
  ) -> String {
    guard let raw, raw.isTruthy else { return "" }
    if normalizeRepeat(raw) == nil { return "Choose how often it repeats." }
    if isString(raw["ends"], "on") && blank(raw["until"]) { return "Choose the date it ends on." }
    if isString(raw["ends"], "after") && blank(raw["count"]) { return "Say how many times it goes out." }
    if !blank(raw["count"]) && !isString(raw["ends"], "on") {
      let n = raw["count"].jsNumber
      if !(n.isFinite && n.rounded(.towardZero) == n) || n < 2 {
        return "A post that repeats a number of times goes out at least twice."
      }
      if n > maxRepeatCount {
        return
          "A post can repeat up to \(JSNumber.format(maxRepeatCount)) times. Choose an end date, or no end, for more."
      }
      if n < occurrence {
        let gone = occurrence - 1
        return
          "This post has already gone out \(JSNumber.format(gone)) \(gone == 1 ? "time" : "times"), so it can’t end after \(JSNumber.format(n))."
      }
    }
    if !blank(raw["until"]) && !isString(raw["ends"], "after") {
      if parseDate(raw["until"]) == nil { return "Choose the date it ends on." }
      if let first = PostingQueue.zonedWallTime(at, tz, timeZone: timeZone),
        lessThan(raw["until"]!, .string(first.date))
      {
        return "The date it ends on is before it first goes out."
      }
    }
    return ""
  }

  /// `a < b` for two loose values, as JavaScript compares them: two strings
  /// (or values that become strings) by code unit, anything else as numbers.
  static func lessThan(_ a: JSONValue, _ b: JSONValue) -> Bool { ComposerJS.less(a, b) }

  /// The rule as the server takes it in `payload.repeat`, or nil.
  public static func repeatForServer(_ raw: JSONValue?, _ tz: JSONValue?) -> JSONValue? {
    guard let r = normalizeRepeat(raw) else { return nil }
    var out: [String: JSONValue] = ["every": .string(r.every)]
    if let tz { out["tz"] = tz }
    if let count = r.count, count != 0 {
      out["count"] = .number(count)
    } else if let until = r.until, !until.isEmpty {
      out["until"] = .string(until)
    }
    return .object(out)
  }

  public static func repeatForServer(_ raw: JSONValue?, _ tz: String) -> JSONValue? {
    repeatForServer(raw, .string(tz))
  }

  // MARK: When the occurrences fall

  static func daysInMonth(_ y: Double, _ m: Double) -> Double {
    JSDate.utcFields(JSDate.utc(y, m, 0)).map { Double($0.date) } ?? .nan
  }

  /// The UTC fields of a time as numbers (NaN for an invalid one).
  static func utcParts(_ time: Double) -> (y: Double, m: Double, d: Double) {
    guard let f = JSDate.utcFields(time) else { return (.nan, .nan, .nan) }
    return (Double(f.year), Double(f.month + 1), Double(f.date))
  }

  static func dateAfter(_ anchorDate: JSONValue?, _ every: String, _ steps: Double) -> String? {
    guard let a = parseDate(anchorDate) else { return nil }
    if every == "month" {
      let index = a.y * 12 + (a.m - 1) + steps
      let y = (index / 12).rounded(.down)
      let m = index.truncatingRemainder(dividingBy: 12) + 1
      return "\(JSNumber.format(y))-\(pad(m))-\(pad(jsMin(a.d, daysInMonth(y, m))))"
    }
    guard let days = daySteps[every] else { return nil }
    let at = utcParts(JSDate.timeClip(JSDate.utc(a.y, a.m - 1, a.d) + steps * days * 86_400_000))
    return "\(JSNumber.format(at.y))-\(pad(at.m))-\(pad(at.d))"
  }

  /// `Math.min(a, b)`: NaN when either is.
  static func jsMin(_ a: Double, _ b: Double) -> Double {
    a.isNaN || b.isNaN ? .nan : Swift.min(a, b)
  }

  /// A stored rule (`{ every, tz, until, count, anchor }`) for a post first
  /// going out at `at` on the clock of `tz`: what the server makes of the
  /// composer's rule when it saves it. `occurrence` numbers the anchor.
  public static func anchoredRepeat(
    _ raw: JSONValue?, _ at: JSONValue?, _ tz: JSONValue?, occurrence: JSONValue = 1, timeZone: TimeZone? = nil
  ) -> JSONValue? {
    let r = normalizeRepeat(raw)
    let wall = PostingQueue.zonedWallTime(at, tz, timeZone: timeZone)
    guard let r, let wall else { return nil }
    let anchor: [String: JSONValue] = ["date": .string(wall.date), "time": .string(wall.time), "occurrence": occurrence]
    var out: [String: JSONValue] = [
      "every": .string(r.every),
      "until": r.until.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null,
      "count": r.count.flatMap { $0 == 0 ? nil : JSONValue.number($0) } ?? .null,
      "anchor": .object(anchor),
    ]
    if let tz { out["tz"] = tz }
    return .object(out)
  }

  /// A stored rule with its anchor's occurrence read (1 unless a positive
  /// integer), or nil when it can't be read.
  static func readStored(_ raw: JSONValue?) -> JSONValue? {
    guard let raw, raw.isTruthy, isEvery(raw["every"]), ComposerJS.truthy(raw["tz"]) else { return nil }
    guard let a = raw["anchor"], a.isTruthy, parseDate(a["date"]) != nil,
      let time = PostingQueue.fields(PostingQueue.text(a["time"]), [2, 2], ":"), time.count == 2
    else { return nil }
    let occurrence = a["occurrence"]
    let n: JSONValue = ComposerJS.isInteger(occurrence) && (occurrence?.doubleValue ?? 0) >= 1 ? occurrence! : 1
    var anchor = ComposerJS.spread(a)
    anchor["occurrence"] = n
    var out = ComposerJS.spread(raw)
    out["anchor"] = .object(anchor)
    return .object(out)
  }

  /// When occurrence `k` of a stored rule goes out, or nil.
  public static func occurrenceTime(_ raw: JSONValue?, _ k: JSONValue?) -> RepeatOccurrenceTime? {
    guard let rule = readStored(raw), let anchor = rule["anchor"],
      let start = anchor["occurrence"]?.doubleValue,
      ComposerJS.isInteger(k), let k = k?.doubleValue, k >= start,
      let every = rule["every"]?.stringValue
    else { return nil }
    let date = dateAfter(anchor["date"], every, k - start)
    let at = date.flatMap { PostingQueue.zonedWallTimeToUtc(.string($0), anchor["time"], rule["tz"]) }
    guard let date, let at else { return nil }
    return RepeatOccurrenceTime(date: date, at: at)
  }

  /// The occurrence after number `occurrence` of a stored rule: the first
  /// slot still ahead of `nowMs` (missed slots are counted, not sent). Nil
  /// when the series is over.
  public static func nextOccurrence(_ raw: JSONValue?, _ occurrence: JSONValue?, nowMs: Double) -> RepeatNextOccurrence? {
    guard let rule = readStored(raw), let start = rule["anchor"]?["occurrence"]?.doubleValue else { return nil }
    let from: Double
    if ComposerJS.isInteger(occurrence), let n = occurrence?.doubleValue, n >= start {
      from = n
    } else {
      from = start
    }
    var k = from + 1
    while k <= from + maxMissedSlots {
      if ComposerJS.truthy(rule["count"]) && k > rule["count"].jsNumber { return nil }
      guard let slot = occurrenceTime(rule, .number(k)) else { return nil }
      if let until = rule["until"], until.isTruthy, lessThan(until, .string(slot.date)) { return nil }
      if slot.at > nowMs {
        return RepeatNextOccurrence(occurrence: k, scheduledFor: JSDate.toISOString(slot.at) ?? "")
      }
      k += 1
    }
    return nil
  }

  // MARK: Words

  /// 'Every week', or '' for no rule.
  public static func repeatLabel(_ raw: JSONValue?) -> String {
    let every = TimerJS.isObject(raw) ? raw?["every"] : raw
    return repeatOptions.first { !$0.value.isEmpty && ComposerJS.strictEquals(.string($0.value), every) }?.label ?? ""
  }

  public static func repeatLabel(_ every: String?) -> String { repeatLabel(every.map(JSONValue.string)) }

  /// '5 Dec', with the year when it isn't this year (`now`'s, on the
  /// device's calendar).
  static func shortDate(_ date: JSONValue?, now: Double, locale: String?, timeZone: TimeZone?) -> String {
    guard let d = parseDate(date) else { return "" }
    let thisYear = JSDate.fields(now, timeZone: timeZone ?? AppLocale.activeTimeZone()).map { Double($0.year) }
    let sameYear = d.y == thisYear
    return AppLocale.toLocaleDateString(
      JSDate.utc(d.y, d.m - 1, d.d),
      DateFormatOptions(year: sameYear ? nil : "numeric", month: "short", day: "numeric"),
      locale: locale, timeZone: TimeZone(identifier: "UTC")!)
  }

  /// Where a row stands in its series, for a line of facts: '3 of 10' for a
  /// post that ends after a count, 'until 5 Dec' for one that ends on a
  /// date, else ''. `now` and `timeZone` say what this year is.
  public static func repeatProgress(
    _ raw: JSONValue?, _ occurrence: JSONValue? = nil, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    guard let raw, raw.isTruthy else { return "" }
    if let count = raw["count"], count.isTruthy {
      let n = ComposerJS.isInteger(occurrence) ? occurrence : raw["anchor"]?["occurrence"]
      if let n, n.isTruthy { return "\(n.jsString) of \(count.jsString)" }
      return "\(count.jsString) times"
    }
    if let until = raw["until"], until.isTruthy {
      return "until \(shortDate(until, now: now, locale: locale, timeZone: timeZone))"
    }
    return ""
  }

  /// The picker's line under the Repeat control, for a post first going out
  /// at `at` on the clock of `tz`: what repeats, when it ends, and what a
  /// month end means.
  public static func repeatSummary(
    _ raw: JSONValue?, _ at: JSONValue?, _ tz: JSONValue?, now: Double, locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> String {
    guard let r = normalizeRepeat(raw) else { return "" }
    let wall = PostingQueue.zonedWallTime(at, tz, timeZone: timeZone)
    let day = wall.flatMap { parseDate(.string($0.date))?.d }
    var line = "\(repeatLabel(r.json)) at this time"
    if let count = r.count, count != 0 {
      line += ", \(JSNumber.format(count)) times in all"
    } else if let until = r.until, !until.isEmpty {
      line += ", until \(shortDate(.string(until), now: now, locale: locale, timeZone: timeZone))"
    }
    line += "."
    if r.every == "month", let day, day >= 29 {
      line += " In a month with no \(JSNumber.format(day))\(day == 31 ? "st" : "th"), it goes out on the last day."
    }
    return line
  }

  /// How a toast says a post repeats: ', repeating every week'.
  public static func repeatClause(_ raw: JSONValue?) -> String {
    let label = repeatLabel(raw)
    return label.isEmpty ? "" : ", repeating \(label.jsLowercased())"
  }

  /// What a scheduled row's series amounts to, for the Scheduled page. A
  /// zone-less `scheduledFor` is read in `timeZone` (the device's), which
  /// with `now` also says what this year is.
  public static func rowRepeat(_ row: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil)
    -> RowRepeat
  {
    let rule = row?["payload"]?["repeat"]
    let inSeries = ComposerJS.truthy(ComposerJS.coalesce(row?["seriesId"], row?["series_id"]))
    guard let rule, rule.isTruthy, isEvery(rule["every"]) else {
      return RowRepeat(repeats: false, label: "", progress: "", last: false, former: inSeries)
    }
    let occurrence = ComposerJS.coalesce(row?["occurrence"], ComposerJS.coalesce(rule["anchor"]?["occurrence"], 1))
    // "After" the later of now and the row's own time: the server plans from
    // the moment the row is settled, which is no earlier than either.
    let scheduled = row?["scheduledFor"]
    let own = TimerJS.dateMs(
      ComposerJS.truthy(scheduled) ? scheduled : .number(0), timeZone: timeZone ?? AppLocale.activeTimeZone())
    let from = now.isNaN ? .nan : Swift.max(now, own.isNaN || own == 0 ? 0 : own)
    return RowRepeat(
      repeats: true,
      label: repeatLabel(rule),
      progress: repeatProgress(rule, occurrence, now: now, locale: locale, timeZone: timeZone),
      last: nextOccurrence(rule, occurrence, nowMs: from) == nil,
      former: false)
  }
}
