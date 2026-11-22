// Ports harness/fakeServer.js (what it imports from src/posting/schedule/repeat.js)
//
// A stand-in, named as the web names it: harness/fakeServer.js anchors a
// repeating post's rule and finds its next occurrence with the client's own
// arithmetic (src/posting/schedule/repeat.js: REPEAT_EVERY,
// MAX_REPEAT_COUNT, anchoredRepeat, nextOccurrence, over postingQueue.js's
// zonedWallTime and zonedWallTimeToUtc). Those are VirgaPosting's `Repeat`
// and `PostingQueue`, which another chain is porting in this wave; until
// the merge this file holds the few functions the fake server calls, with
// the same signatures (`ServerRepeat.anchoredRepeat(_:_:_:occurrence:)`,
// `ServerRepeat.nextOccurrence(_:_:nowMs:)`), so the merge can point the
// server at `Repeat` and delete this file.
//
// Rules are JSON as the server stores them: `{ every, tz, until, count,
// anchor: { date, time, occurrence } }`. The zone is read as Intl reads
// `timeZone` (`String(tz)`: an IANA name in any case, or an offset).

import Foundation
import VirgaCore

enum ServerRepeat {
  /// `REPEAT_EVERY`.
  static let repeatEvery = ["day", "week", "2weeks", "month"]
  /// `MAX_REPEAT_COUNT`: the most a post may repeat "after N times".
  static let maxRepeatCount = 400
  /// How many missed slots a series looks past for its next one.
  static let maxMissedSlots = 3700
  static let daySteps: [String: Double] = ["day": 1, "week": 7, "2weeks": 14]

  // MARK: Zones (postingQueue.js)

  /// A zone as Intl reads `timeZone`: a fixed offset (ECMA-402's offset
  /// time zones, which may be up to 23:59 either side, past what a
  /// Foundation TimeZone can hold) or a named zone.
  enum IntlZone {
    case offset(seconds: Int)
    case named(TimeZone)

    /// What the zone's clock is ahead of UTC at `ms`, in ms.
    func offsetMs(at ms: Double) -> Double {
      switch self {
      case .offset(let seconds): return Double(seconds) * 1000
      case .named(let zone): return JSDate.offsetMs(at: ms, timeZone: zone)
      }
    }
  }

  /// `new Intl.DateTimeFormat('en-US', { timeZone: name })`'s zone, or nil
  /// where Intl throws (a RangeError). Intl reads an IANA name, a link or
  /// ICU's own legacy ids in any case; it doesn't take Foundation's own
  /// "GMT+5" or "UTC-03:00" forms, nor tzdata's "Factory".
  static func intlZone(named name: String) -> IntlZone? {
    if let seconds = offsetSeconds(name) { return .offset(seconds: seconds) }
    let upper = String(name.unicodeScalars.map { s -> Character in
      (0x61...0x7A).contains(s.value) ? Character(Unicode.Scalar(s.value - 0x20)!) : Character(s)
    })
    if ["UTC", "GMT", "ETC/UTC", "ETC/GMT"].contains(upper) { return TimeZone(identifier: "UTC").map(IntlZone.named) }
    if upper == "FACTORY" { return nil }
    let units = Array(upper.utf16)
    if units.count > 3, upper.hasPrefix("GMT") || upper.hasPrefix("UTC"), units[3] == 0x2B || units[3] == 0x2D {
      // Only IANA's GMT+0 and GMT-0 links; Foundation would read any offset.
      return upper == "GMT+0" || upper == "GMT-0" ? TimeZone(identifier: "UTC").map(IntlZone.named) : nil
    }
    for candidate in caseForms(name, upper) {
      guard !candidate.isEmpty, let zone = TimeZone(identifier: candidate) else { continue }
      // A custom zone Foundation made up from an offset in the name isn't one Intl knows.
      if zone.identifier.hasPrefix("GMT+") || zone.identifier.hasPrefix("GMT-") { return nil }
      return .named(zone)
    }
    return nil
  }

  /// The spellings of a zone name to look up, since Intl matches them in
  /// any case and Foundation only as written: as given, as one of the
  /// canonical names, then each part between the slashes title-cased (as
  /// V8 writes a location: `America/Port-au-Prince`) or in capitals (`US`,
  /// `GB`, `EST5EDT`).
  static func caseForms(_ name: String, _ upper: String) -> [String] {
    var out = [name]
    if let known = TimeZone.knownTimeZoneIdentifiers.first(where: { $0.uppercased() == upper }) { out.append(known) }
    func title(_ part: Substring, small: Bool) -> String {
      var word = ""
      var out = ""
      func flush() {
        let lower = word.lowercased()
        // V8's own: of, es and au stay in lower case inside a name.
        if small, !out.isEmpty, ["of", "es", "au"].contains(lower) {
          out += lower
        } else {
          out += lower.prefix(1).uppercased() + lower.dropFirst()
        }
        word = ""
      }
      for c in part {
        if c == "_" || c == "-" {
          flush()
          out.append(c)
        } else {
          word.append(c)
        }
      }
      flush()
      return out
    }
    let parts = name.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count <= 4 else { return out }
    for small in [true, false] {
      for mask in 0..<(1 << parts.count) {
        let form = parts.enumerated().map { i, part in mask & (1 << i) != 0 ? part.uppercased() : title(part, small: small) }
        out.append(form.joined(separator: "/"))
      }
    }
    out.append(upper)
    if upper.hasPrefix("SYSTEMV/") { out.append("SystemV/" + upper.dropFirst(8)) }
    return out
  }

  /// ECMA-402's offset time zones, '±HH', '±HHMM' or '±HH:MM' (the minus
  /// sign also as U+2212), as seconds east of UTC.
  static func offsetSeconds(_ text: String) -> Int? {
    var scalars = Array(text.unicodeScalars)
    guard let sign = scalars.first, ["+", "-", "\u{2212}"].contains(sign) else { return nil }
    scalars.removeFirst()
    let rest = scalars.map { $0.value }
    func digits(_ slice: ArraySlice<UInt32>) -> Int? {
      guard !slice.isEmpty, slice.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return nil }
      return slice.reduce(0) { $0 * 10 + Int($1 - 0x30) }
    }
    var hours: Int?
    var minutes = 0
    switch rest.count {
    case 2: hours = digits(rest[0..<2])
    case 4:
      hours = digits(rest[0..<2])
      minutes = digits(rest[2..<4]) ?? 99
    case 5:
      guard rest[2] == 0x3A else { return nil }
      hours = digits(rest[0..<2])
      minutes = digits(rest[3..<5]) ?? 99
    default: return nil
    }
    guard let hours, hours <= 23, minutes <= 59 else { return nil }
    return (sign == "+" ? 1 : -1) * (hours * 3600 + minutes * 60)
  }

  /// Whether `new Intl.DateTimeFormat('en-US', { timeZone: z })` takes `z`
  /// (fakeServer.js's own check of a repeating post's zone).
  static func isZone(_ z: JSONValue?) -> Bool {
    guard let z, z.isTruthy else { return false }
    return intlZone(named: z.jsString) != nil
  }

  /// `tzOffsetMs(instantMs, tz)`: what the wall clock reads (to the second)
  /// minus the instant; nil where Intl throws.
  static func tzOffsetMs(_ instantMs: Double, _ tz: JSONValue?) -> Double? {
    guard let zone = intlZone(named: tz.map(\.jsString) ?? "undefined") else { return nil }
    let t = JSDate.timeClip(instantMs)
    guard t.isFinite else { return nil }
    let wall = t + zone.offsetMs(at: t)
    return (wall / 1000).rounded(.down) * 1000 - t
  }

  static func pad(_ n: Int) -> String { n >= 0 && n < 10 ? "0\(n)" : String(n) }

  /// `zonedWallTime(value, tz)` for an ISO time: its wall-clock date and time in `tz`.
  static func zonedWallTime(_ at: JSONValue?, _ tz: JSONValue?) -> (date: String, time: String)? {
    let ms = at?.isTruthy == true ? JSDate.parse(at!.jsString, timeZone: .gmt) : .nan
    guard ms.isFinite, let off = tzOffsetMs(ms, tz), let f = JSDate.utcFields(ms + off) else { return nil }
    return ("\(f.year)-\(pad(f.month + 1))-\(pad(f.date))", "\(pad(f.hours)):\(pad(f.minutes))")
  }

  /// The numbers of `/^(\d{n})sep(\d{m})…$/` over `String(v || '')`, or nil.
  static func fields(_ value: JSONValue?, _ widths: [Int], _ separator: UInt16) -> [Double]? {
    let text = value?.isTruthy == true ? value!.jsString : ""
    let units = Array(text.utf16)
    var values: [Double] = []
    var at = 0
    for (i, width) in widths.enumerated() {
      if i > 0 {
        guard at < units.count, units[at] == separator else { return nil }
        at += 1
      }
      guard at + width <= units.count else { return nil }
      var value = 0.0
      for unit in units[at..<(at + width)] {
        guard (0x30...0x39).contains(unit) else { return nil }
        value = value * 10 + Double(unit - 0x30)
      }
      values.append(value)
      at += width
    }
    return at == units.count ? values : nil
  }

  /// `zonedSlotToUTC(y, m, d, hh, mm, tz)`: DST-correct, a wall time in a
  /// spring-forward gap resolving forward.
  static func zonedSlotToUTC(_ y: Double, _ m: Double, _ d: Double, _ hh: Double, _ mm: Double, _ tz: JSONValue?)
    -> Double?
  {
    let naive = JSDate.utc(y, m - 1, d, hh, mm)
    guard let first = tzOffsetMs(naive, tz) else { return nil }
    let a = naive - first
    guard let second = tzOffsetMs(a, tz) else { return nil }
    let b = naive - second
    guard let check = tzOffsetMs(b, tz) else { return nil }
    if check == naive - b { return JSDate.timeClip(b) }
    return JSDate.timeClip(Swift.max(a, b))
  }

  /// `zonedWallTimeToUtc(date, time, tz)`: epoch ms, or nil for anything unreadable.
  static func zonedWallTimeToUtc(_ date: JSONValue?, _ time: JSONValue?, _ tz: JSONValue?) -> Double? {
    guard let d = fields(date, [4, 2, 2], 0x2D), let t = fields(time, [2, 2], 0x3A) else { return nil }
    let (y, m, day, hh, mm) = (d[0], d[1], d[2], t[0], t[1])
    if m < 1 || m > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 { return nil }
    guard let check = JSDate.utcFields(JSDate.utc(y, m - 1, day)), Double(check.month) == m - 1 else { return nil }
    return zonedSlotToUTC(y, m, day, hh, mm, tz)
  }

  // MARK: Rules (repeat.js)

  /// `parseDate(date)`: a 'YYYY-MM-DD' that is on the calendar.
  static func parseDate(_ date: JSONValue?) -> (y: Double, m: Double, d: Double)? {
    guard let f = fields(date, [4, 2, 2], 0x2D) else { return nil }
    guard let check = JSDate.utcFields(JSDate.utc(f[0], f[1] - 1, f[2])), Double(check.month) == f[1] - 1,
      Double(check.date) == f[2]
    else { return nil }
    return (f[0], f[1], f[2])
  }

  /// `Number.isInteger(v)`.
  static func isInteger(_ v: JSONValue?) -> Bool {
    guard case .number(let n)? = v else { return false }
    return n.isFinite && n.rounded(.towardZero) == n
  }

  /// `normalizeRepeat(raw)`: `{ every, until?, count? }`, or nil.
  static func normalizeRepeat(_ raw: JSONValue?) -> (every: String, until: String?, count: Double?)? {
    guard let raw, raw.isTruthy, case .object = raw, case .string(let every)? = raw["every"], repeatEvery.contains(every)
    else { return nil }
    let count = raw["count"].jsNumber
    let blank = raw["count"] == nil || raw["count"] == .null || raw["count"] == .string("")
    let hasCount = !blank && count.isFinite && count.rounded(.towardZero) == count && count >= 1
    let hasUntil = raw["until"]?.stringValue != nil && parseDate(raw["until"]) != nil
    if hasCount && raw["ends"] != .string("on") { return (every, nil, count) }
    if hasUntil && raw["ends"] != .string("after") { return (every, raw["until"]?.stringValue, nil) }
    return (every, nil, nil)
  }

  /// `anchoredRepeat(repeat, at, tz, occurrence)`: the stored rule for a post
  /// first going out at `at` on the clock of `tz`, its anchor numbered
  /// `occurrence`.
  static func anchoredRepeat(_ raw: JSONValue?, _ at: JSONValue?, _ tz: JSONValue?, occurrence: JSONValue = 1)
    -> JSONValue?
  {
    guard let r = normalizeRepeat(raw), let wall = zonedWallTime(at, tz) else { return nil }
    var out: [String: JSONValue] = [:]
    out["every"] = .string(r.every)
    if let tz { out["tz"] = tz }
    out["until"] = r.until.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
    out["count"] = r.count.flatMap { $0 == 0 ? nil : JSONValue.number($0) } ?? .null
    out["anchor"] = ["date": .string(wall.date), "time": .string(wall.time), "occurrence": occurrence]
    return .object(out)
  }

  /// `readStored(repeat)`: a stored rule with its anchor's number read (1
  /// unless a positive whole number), or nil.
  static func readStored(_ raw: JSONValue?) -> JSONValue? {
    guard let raw, raw.isTruthy, case .string(let every)? = raw["every"], repeatEvery.contains(every),
      raw["tz"]?.isTruthy == true
    else { return nil }
    guard let a = raw["anchor"], a.isTruthy, parseDate(a["date"]) != nil, fields(a["time"], [2, 2], 0x3A) != nil
    else { return nil }
    let occurrence = a["occurrence"]
    let n: JSONValue = isInteger(occurrence) && (occurrence?.doubleValue ?? 0) >= 1 ? occurrence! : 1
    var anchor = a.objectValue ?? [:]
    anchor["occurrence"] = n
    var out = raw.objectValue ?? [:]
    out["anchor"] = .object(anchor)
    return .object(out)
  }

  /// `dateAfter(anchorDate, every, steps)`.
  static func dateAfter(_ anchorDate: JSONValue?, _ every: String, _ steps: Double) -> String? {
    guard let a = parseDate(anchorDate) else { return nil }
    if every == "month" {
      let index = a.y * 12 + (a.m - 1) + steps
      let y = (index / 12).rounded(.down)
      let m = index.truncatingRemainder(dividingBy: 12) + 1
      let days = JSDate.utcFields(JSDate.utc(y, m, 0)).map { Double($0.date) } ?? .nan
      let d = days.isNaN ? Double.nan : Swift.min(a.d, days)
      return "\(JSNumber.format(y))-\(pad(Int(m)))-\(d.isNaN ? "NaN" : pad(Int(d)))"
    }
    guard let days = daySteps[every] else { return nil }
    let at = JSDate.timeClip(JSDate.utc(a.y, a.m - 1, a.d) + steps * days * 86_400_000)
    guard let f = JSDate.utcFields(at) else { return "NaN-NaN-NaN" }
    return "\(f.year)-\(pad(f.month + 1))-\(pad(f.date))"
  }

  /// `occurrenceTime(repeat, k)`: when occurrence `k` goes out, `{ date, at }`.
  static func occurrenceTime(_ raw: JSONValue?, _ k: Double) -> (date: String, at: Double)? {
    guard let rule = readStored(raw), let start = rule["anchor"]?["occurrence"]?.doubleValue,
      k.isFinite, k.rounded(.towardZero) == k, k >= start, let every = rule["every"]?.stringValue
    else { return nil }
    guard let date = dateAfter(rule["anchor"]?["date"], every, k - start),
      let at = zonedWallTimeToUtc(.string(date), rule["anchor"]?["time"], rule["tz"])
    else { return nil }
    return (date, at)
  }

  /// `a > b` for a slot's date and a stored `until`.
  static func after(_ date: String, _ until: JSONValue) -> Bool {
    if case .string(let text) = until { return Array(text.utf16).lexicographicallyPrecedes(Array(date.utf16)) }
    return JSNumber.toNumber(date) > until.jsNumber
  }

  /// `nextOccurrence(repeat, occurrence, nowMs)`: the first slot after
  /// number `occurrence` still ahead of `nowMs` (missed slots are counted,
  /// not sent), as `{ occurrence, scheduledFor }`. Nil when the series is over.
  static func nextOccurrence(_ raw: JSONValue?, _ occurrence: JSONValue?, nowMs: Double)
    -> (occurrence: Double, scheduledFor: String)?
  {
    guard let rule = readStored(raw), let start = rule["anchor"]?["occurrence"]?.doubleValue else { return nil }
    let from = isInteger(occurrence) && (occurrence?.doubleValue ?? 0) >= start ? occurrence!.doubleValue! : start
    let count = rule["count"]
    let until = rule["until"]
    var k = from + 1
    while k <= from + Double(maxMissedSlots) {
      if count?.isTruthy == true && k > count.jsNumber { return nil }
      guard let slot = occurrenceTime(rule, k) else { return nil }
      if let until, until.isTruthy, after(slot.date, until) { return nil }
      if slot.at > nowMs, let iso = JSDate.toISOString(slot.at) { return (k, iso) }
      k += 1
    }
    return nil
  }
}
