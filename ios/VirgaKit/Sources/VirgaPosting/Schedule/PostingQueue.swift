// Ports src/posting/schedule/postingQueue.js
//
// Posting queue slot math (pure). A weekly template gives local wall-clock
// posting times per weekday; a queued post takes the next open future slot,
// and reordering re-packs upcoming slot times onto rows in their new order.
// Instants are computed and compared in UTC, as the backend does.
//
//   schedule = { timezone: 'America/New_York' | '', slots: { mon: ['09:00','17:00'], … } }
//
// Schedules and rows are taken as the web takes them (JSONValue), so a
// loose shape reads as it does in JavaScript. Instants are epoch
// milliseconds (the web's Dates); NaN is an invalid date. Where the web
// reads the device's own calendar (dayDiff, a zone-less time, a schedule
// with no zone), the Swift takes `timeZone` (nil: AppLocale's active zone,
// the app's stand-in for the device's). A zone named in a schedule is read
// as Intl reads it (PostingQueue.timeZone(named:)); one it can't read
// throws Intl's RangeError where the web's would.

import Foundation
import VirgaCore

/// A weekday of the schedule editor: `{ key, label }`.
public struct QueueWeekday: Codable, Hashable, Sendable {
  public var key: String
  public var label: String
}

/// A run of rows on the same day: `{ label, rows }`.
public struct DateBucket: Codable, Hashable, Sendable {
  public var label: String
  public var rows: [JSONValue]
}

/// A wall-clock reading of an instant in a zone: `{ date, time, weekday }`.
public struct ZonedWallTime: Codable, Hashable, Sendable {
  /// 'YYYY-MM-DD'.
  public var date: String
  /// 'HH:MM'.
  public var time: String
  /// 'mon' … 'sun'.
  public var weekday: String
}

/// A queued row paired with its new slot: both times ISO-Z, or null.
public struct QueueAssignment: Codable, Hashable, Sendable {
  /// The row's id as the row holds it (absent when it has none).
  public var id: JSONValue?
  public var oldScheduledFor: String?
  public var newScheduledFor: String?

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(id, forKey: .id)
    try container.encode(oldScheduledFor, forKey: .oldScheduledFor)
    try container.encode(newScheduledFor, forKey: .newScheduledFor)
  }
}

/// summarizeQueue's counts: the queue soonest-first, and how many rows wait.
public struct QueueSummary: Codable, Hashable, Sendable {
  public var queued: [JSONValue]
  public var queuedCount: Int
  public var scheduledCount: Int
  public var failedCount: Int
}

/// What the web's slot walk throws: Intl's RangeError for a zone it can't
/// read ("Invalid time zone specified: …") or an invalid date ("Invalid
/// time value"), and the TypeError of a day that isn't a list of times.
public struct PostingQueueError: Error, LocalizedError, Hashable, Sendable {
  public var name: String
  public var message: String
  public init(_ message: String, name: String = "RangeError") {
    self.name = name
    self.message = message
  }
  public var errorDescription: String? { message }
}

public enum PostingQueue {
  public static let queueHorizonDays = 90  // matches backend MAX_HORIZON_DAYS
  public static let minLeadMs: Double = 60 * 1000  // never place a slot < 1 min out

  /// The week a schedule starts with until the account changes it: weekdays
  /// at 09:00 and 17:00. Must match settings.js's default queue.
  public static let defaultPostingQueue: JSONValue = [
    "timezone": "",
    "slots": [
      "mon": ["09:00", "17:00"],
      "tue": ["09:00", "17:00"],
      "wed": ["09:00", "17:00"],
      "thu": ["09:00", "17:00"],
      "fri": ["09:00", "17:00"],
      "sat": [],
      "sun": [],
    ],
  ]

  /// Canonical weekday order (Mon-first) and labels, for the schedule editor.
  public static let weekdays: [QueueWeekday] = [
    QueueWeekday(key: "mon", label: "Monday"),
    QueueWeekday(key: "tue", label: "Tuesday"),
    QueueWeekday(key: "wed", label: "Wednesday"),
    QueueWeekday(key: "thu", label: "Thursday"),
    QueueWeekday(key: "fri", label: "Friday"),
    QueueWeekday(key: "sat", label: "Saturday"),
    QueueWeekday(key: "sun", label: "Sunday"),
  ]

  /// getUTCDay() (0 = Sunday … 6 = Saturday) → the slot keys.
  static let dowKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

  static let msPerDay: Double = 86_400_000

  // MARK: Date buckets for grouped scheduled lists

  /// Whole-calendar-day difference (local) between an instant and `now`
  /// (epoch ms). NaN when `iso` can't be read.
  public static func dayDiff(_ iso: JSONValue?, now: Double, timeZone: TimeZone? = nil) -> Double {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let a = localMidnight(TimerJS.dateMs(iso, timeZone: zone), zone)
    let b = localMidnight(now, zone)
    return ((a - b) / msPerDay).jsRounded
  }

  /// `new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()`.
  static func localMidnight(_ time: Double, _ zone: TimeZone) -> Double {
    guard let f = JSDate.fields(time, timeZone: zone) else { return .nan }
    return JSDate.local(Double(f.year), Double(f.month), Double(f.date), timeZone: zone)
  }

  /// A human bucket label: Overdue / Today / Tomorrow / In N days / weekday + date.
  public static func dateBucketLabel(
    _ iso: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    let diff = dayDiff(iso, now: now, timeZone: timeZone)
    if diff < 0 { return "Overdue" }
    if diff == 0 { return "Today" }
    if diff == 1 { return "Tomorrow" }
    if diff <= 6 { return "In \(JSNumber.format(diff)) days" }
    let zone = timeZone ?? AppLocale.activeTimeZone()
    return AppLocale.toLocaleDateString(
      TimerJS.dateMs(iso, timeZone: zone), DateFormatOptions(weekday: "short", month: "short", day: "numeric"),
      locale: locale, timeZone: zone)
  }

  /// Group already-time-sorted rows into consecutive date buckets, in order.
  public static func groupByDateBucket(
    _ rows: [JSONValue],
    getIso: (JSONValue) -> JSONValue? = { $0["scheduledFor"] },
    now: Double,
    locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> [DateBucket] {
    var groups: [DateBucket] = []
    for row in rows {
      let label = dateBucketLabel(getIso(row), now: now, locale: locale, timeZone: timeZone)
      if let last = groups.last, last.label.jsEquals(label) {
        groups[groups.count - 1].rows.append(row)
      } else {
        groups.append(DateBucket(label: label, rows: [row]))
      }
    }
    return groups
  }

  // MARK: Reading a schedule

  /// The schedule's own zone, else this device's (`localZone`, nil for the
  /// active one).
  public static func resolveTimezone(_ schedule: JSONValue?, localZone: TimeZone? = nil) -> String {
    if let tz = schedule?["timezone"], tz.isTruthy { return tz.jsString }
    return intlName(localZone ?? AppLocale.activeTimeZone())
  }

  /// A zone's name as Intl's `resolvedOptions().timeZone` gives it: the
  /// names of UTC (Foundation's "GMT") are "UTC", and where ICU keeps an
  /// older canonical name than the IANA database, ICU's (Node 22's Intl).
  public static func intlName(_ zone: TimeZone) -> String {
    let id = zone.identifier
    if utcNames.contains(id) { return "UTC" }
    return icuNames[id] ?? id
  }

  static let utcNames: Set<String> = [
    "GMT", "UTC", "Etc/UTC", "Etc/GMT", "GMT0", "Etc/GMT0", "Etc/GMT+0", "Etc/GMT-0", "UCT", "Etc/UCT",
    "Zulu", "Etc/Zulu", "Universal", "Etc/Universal", "Greenwich", "Etc/Greenwich",
  ]

  static let icuNames: [String: String] = [
    "Africa/Asmara": "Africa/Asmera",
    "America/Argentina/Buenos_Aires": "America/Buenos_Aires",
    "America/Argentina/Catamarca": "America/Catamarca",
    "America/Argentina/Cordoba": "America/Cordoba",
    "America/Argentina/Jujuy": "America/Jujuy",
    "America/Argentina/Mendoza": "America/Mendoza",
    "America/Atikokan": "America/Coral_Harbour",
    "America/Indiana/Indianapolis": "America/Indianapolis",
    "America/Kentucky/Louisville": "America/Louisville",
    "America/Nuuk": "America/Godthab",
    "Asia/Ho_Chi_Minh": "Asia/Saigon",
    "Asia/Kathmandu": "Asia/Katmandu",
    "Asia/Kolkata": "Asia/Calcutta",
    "Asia/Yangon": "Asia/Rangoon",
    "Atlantic/Faroe": "Atlantic/Faeroe",
    "CET": "Europe/Brussels",
    "EET": "Europe/Athens",
    "EST": "America/Panama",
    "Europe/Kyiv": "Europe/Kiev",
    "HST": "Pacific/Honolulu",
    "MET": "Europe/Brussels",
    "MST": "America/Phoenix",
    "Pacific/Chuuk": "Pacific/Truk",
    "Pacific/Kanton": "Pacific/Enderbury",
    "Pacific/Pohnpei": "Pacific/Ponape",
    "WET": "Europe/Lisbon",
  ]

  public static func isScheduleEmpty(_ schedule: JSONValue?) -> Bool {
    let slots = ComposerJS.truthy(schedule) ? ComposerJS.or(schedule?["slots"], nil) : nil
    return !objectValues(slots).contains { ($0.arrayValue?.count ?? 0) > 0 }
  }

  /// `Object.values(v)` for a loose value: an object's members (in no
  /// particular order; callers only test them), an array's elements, a
  /// string's characters.
  static func objectValues(_ value: JSONValue?) -> [JSONValue] {
    switch value {
    case .object(let members)?: return Array(members.values)
    case .array(let items)?: return items
    case .string(let text)?: return text.utf16.map { _ in .string("") }
    default: return []
    }
  }

  /// Whether a slot map is still the shipped Mon–Fri 9-and-5 default, a week
  /// nobody chose, which suggested times may replace rather than add to. An
  /// empty week is not the shipped one; pair with isScheduleEmpty. A day
  /// that isn't a list reads as none (the web throws calling `sort` on a
  /// string).
  public static func isShippedDefaultSchedule(_ slots: JSONValue?) -> Bool {
    let defaults = defaultPostingQueue["slots"]
    return weekdays.allSatisfy { day in
      let mine = defaultSorted(ComposerJS.truthy(slots?[day.key]) ? slots?[day.key]?.arrayValue ?? [] : [])
      let theirs = defaultSorted(defaults?[day.key]?.arrayValue ?? [])
      guard mine.count == theirs.count else { return false }
      return zip(mine, theirs).allSatisfy { ComposerJS.strictEquals($0, $1) }
    }
  }

  /// `array.slice().sort()`: by String(value), code unit by code unit,
  /// stable.
  static func defaultSorted(_ items: [JSONValue]) -> [JSONValue] {
    TimerJS.v8Sorted(items) { a, b in
      let x = Array(a.jsString.utf16)
      let y = Array(b.jsString.utf16)
      if x.lexicographicallyPrecedes(y) { return -1 }
      return y.lexicographicallyPrecedes(x) ? 1 : 0
    }
  }

  // MARK: Zones

  /// A zone named as Intl reads `timeZone`: an IANA name in any case, or an
  /// offset ('+05:30'). Nil where Intl throws.
  public static func timeZone(named name: String) -> TimeZone? {
    if let zone = TimeZone(identifier: name), !name.isEmpty { return zone }
    if let offset = offsetSeconds(name) { return TimeZone(secondsFromGMT: offset) }
    let folded = name.uppercased()
    if folded == "UTC" || folded == "GMT" || folded == "ETC/UTC" || folded == "ETC/GMT" {
      return TimeZone(identifier: "UTC")
    }
    guard let known = TimeZone.knownTimeZoneIdentifiers.first(where: { $0.uppercased() == folded }) else {
      return nil
    }
    return TimeZone(identifier: known)
  }

  /// '+HH:MM', '-HHMM' or '+HH' as seconds east of UTC.
  static func offsetSeconds(_ text: String) -> Int? {
    let units = Array(text.utf8)
    guard let sign = units.first, sign == 0x2B || sign == 0x2D else { return nil }
    let rest = Array(units.dropFirst())
    func digits(_ slice: ArraySlice<UInt8>) -> Int? {
      guard !slice.isEmpty, slice.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return nil }
      return Int(String(decoding: slice, as: UTF8.self))
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
    let seconds = hours * 3600 + minutes * 60
    return sign == 0x2D ? -seconds : seconds
  }

  /// The zone, or Intl's RangeError for a name it can't read.
  static func zone(_ name: String) throws -> TimeZone {
    guard let zone = timeZone(named: name) else {
      throw PostingQueueError("Invalid time zone specified: \(name)")
    }
    return zone
  }

  /// Offset (ms) such that localWallClockUTCms = instantMs + offset, for `tz`
  /// at `instantMs`, as formatToParts gives it: the wall clock to the
  /// second, so an instant with milliseconds comes out that much short.
  static func tzOffsetMs(_ instantMs: Double, _ tz: String) throws -> Double {
    let zone = try zone(tz)
    let t = JSDate.timeClip(instantMs)
    guard t.isFinite else { throw PostingQueueError("Invalid time value") }
    let wall = t + JSDate.offsetMs(at: t, timeZone: zone)
    return (wall / 1000).rounded(.down) * 1000 - t
  }

  /// The calendar date that `instantMs` falls on in `tz`.
  static func zonedYMD(_ instantMs: Double, _ tz: String) throws -> (y: Double, m: Double, d: Double) {
    let off = try tzOffsetMs(instantMs, tz)
    return ymd(instantMs + off)
  }

  /// The UTC calendar date of a time (NaN fields for an invalid one).
  static func ymd(_ time: Double) -> (y: Double, m: Double, d: Double) {
    guard let f = JSDate.utcFields(time) else { return (.nan, .nan, .nan) }
    return (Double(f.year), Double(f.month + 1), Double(f.date))
  }

  /// Add `days` to a calendar date (month and year roll over).
  static func addDays(_ date: (y: Double, m: Double, d: Double), _ days: Double) -> (y: Double, m: Double, d: Double) {
    ymd(JSDate.utc(date.y, date.m - 1, date.d) + days * msPerDay)
  }

  /// The slot key ('mon'…'sun') of a calendar date.
  static func weekdayKeyOf(_ date: (y: Double, m: Double, d: Double)) -> String? {
    JSDate.utcFields(JSDate.utc(date.y, date.m - 1, date.d)).map { dowKeys[$0.day] }
  }

  /// The UTC instant of a wall-clock `HH:MM` on a calendar date in `tz`.
  /// DST-correct: the offset is recomputed for that date, in two passes. A
  /// wall time that doesn't exist on a spring-forward day resolves forward
  /// to the next valid instant.
  static func zonedSlotToUTC(_ y: Double, _ m: Double, _ d: Double, _ hh: Double, _ mm: Double, _ tz: String) throws -> Double {
    let naiveUTC = JSDate.utc(y, m - 1, d, hh, mm)
    let a = naiveUTC - (try tzOffsetMs(naiveUTC, tz))
    let b = naiveUTC - (try tzOffsetMs(a, tz))
    // `b` is real only if the offset in force at `b` is the one it was
    // built from. Otherwise the wall time falls in the spring-forward gap,
    // and the later candidate is the instant just past it.
    if try tzOffsetMs(b, tz) == naiveUTC - b { return JSDate.timeClip(b) }
    return JSDate.timeClip(Swift.max(a, b))
  }

  /// The UTC instant (ms) of a wall-clock date ('YYYY-MM-DD') and time
  /// ('HH:MM') in `tz`. A time inside a spring-forward gap resolves forward.
  /// Nil for anything unreadable, a zone included.
  public static func zonedWallTimeToUtc(_ date: JSONValue?, _ time: JSONValue?, _ tz: JSONValue?) -> Double? {
    guard let d = fields(text(date), [4, 2, 2], "-"), let t = fields(text(time), [2, 2], ":") else { return nil }
    let (y, m, day) = (d[0], d[1], d[2])
    let (hh, mm) = (t[0], t[1])
    if m < 1 || m > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 { return nil }
    // Date.UTC rolls 31 Feb into March; a date that isn't on the calendar isn't one.
    guard let check = JSDate.utcFields(JSDate.utc(y, m - 1, day)), Double(check.month) == m - 1 else { return nil }
    return try? zonedSlotToUTC(y, m, day, hh, mm, tz.map(\.jsString) ?? "undefined")
  }

  public static func zonedWallTimeToUtc(_ date: String?, _ time: String?, _ tz: String) -> Double? {
    zonedWallTimeToUtc(date.map(JSONValue.string), time.map(JSONValue.string), .string(tz))
  }

  /// `String(v || '')`.
  static func text(_ value: JSONValue?) -> String {
    guard let value, value.isTruthy else { return "" }
    return value.jsString
  }

  /// The numbers of a text made of ASCII digit runs of the given widths
  /// with `separator` between them (`/^(\d{4})-(\d{2})-(\d{2})$/`), or nil.
  static func fields(_ text: String, _ widths: [Int], _ separator: Character) -> [Double]? {
    let units = Array(text.utf16)
    let sep = UInt16(separator.asciiValue!)
    var values: [Double] = []
    var at = 0
    for (i, width) in widths.enumerated() {
      if i > 0 {
        guard at < units.count, units[at] == sep else { return nil }
        at += 1
      }
      guard at + width <= units.count else { return nil }
      var value = 0.0
      for unit in units[at..<(at + width)] {
        guard unit >= 0x30, unit <= 0x39 else { return nil }
        value = value * 10 + Double(unit - 0x30)
      }
      values.append(value)
      at += width
    }
    return at == units.count ? values : nil
  }

  /// The wall-clock date, time and weekday of an instant in `tz`, for showing
  /// it in a picker. Nil for anything unreadable. `value` is read as
  /// `new Date(value || NaN)` (a date-time without an offset in
  /// `timeZone`, the device's zone).
  public static func zonedWallTime(_ value: JSONValue?, _ tz: JSONValue?, timeZone: TimeZone? = nil) -> ZonedWallTime? {
    let ms = ComposerJS.truthy(value) ? TimerJS.dateMs(value, timeZone: timeZone ?? AppLocale.activeTimeZone()) : .nan
    return zonedWallTime(ms: ms, tz)
  }

  /// zonedWallTime for a Date (epoch ms).
  public static func zonedWallTime(ms: Double, _ tz: JSONValue?) -> ZonedWallTime? {
    guard ms.isFinite, let off = try? tzOffsetMs(ms, tz.map(\.jsString) ?? "undefined"),
      let f = JSDate.utcFields(ms + off)
    else { return nil }
    return ZonedWallTime(
      date: "\(f.year)-\(pad(f.month + 1))-\(pad(f.date))",
      time: "\(pad(f.hours)):\(pad(f.minutes))",
      weekday: dowKeys[f.day])
  }

  public static func zonedWallTime(_ value: String?, _ tz: String, timeZone: TimeZone? = nil) -> ZonedWallTime? {
    zonedWallTime(value.map(JSONValue.string), .string(tz), timeZone: timeZone)
  }

  static func pad(_ n: Int) -> String { n < 10 && n >= 0 ? "0\(n)" : String(n) }

  // MARK: Slots

  // The backend's horizon is rolling (validateCreate refuses anything past
  // its own now + MAX_HORIZON_DAYS at request time), but the loop walks
  // calendar days, so a day-90 slot can sit past it. The margin also
  // absorbs clock skew and latency.
  static let horizonMarginMs: Double = 60 * 60 * 1000

  /// The slots in ascending order across the horizon, a day at a time (the
  /// web's generator): a day's slots are worked out when the walk reaches
  /// it, so a slot the web can't read throws only once it's reached.
  public struct SlotWalk: Sendable {
    let slots: JSONValue?
    let tz: String
    let fromMs: Double
    var start: (y: Double, m: Double, d: Double)?
    var day = 0
    var pending: [Double] = []

    init(_ schedule: JSONValue?, _ fromMs: Double, _ tz: String) {
      slots = ComposerJS.truthy(schedule) ? ComposerJS.or(schedule?["slots"], nil) : nil
      self.tz = tz
      self.fromMs = fromMs
    }

    /// The next slot (epoch ms), or nil past the horizon.
    public mutating func next() throws -> Double? {
      if start == nil { start = try zonedYMD(fromMs, tz) }
      let horizonMs = fromMs + Double(queueHorizonDays) * msPerDay - horizonMarginMs
      while pending.isEmpty {
        guard day <= queueHorizonDays, let start else { return nil }
        let date = addDays(start, Double(day))
        day += 1
        // Sorting HH:MM strings orders the wall clock only; a slot pushed past
        // the spring-forward gap can land after a later one, so sort the instants.
        let listed = weekdayKeyOf(date).flatMap { slots?[$0] }
        var times: [JSONValue] = []
        switch listed {
        case .array(let items)?: times = defaultSorted(items)
        case .string(let text)? where !text.isEmpty:
          throw PostingQueueError("(slots[weekdayKeyOf(...)] || []).slice(...).sort is not a function", name: "TypeError")
        case let value? where value.isTruthy:
          throw PostingQueueError("(slots[weekdayKeyOf(...)] || []).slice is not a function", name: "TypeError")
        default: break
        }
        var dayInstants: [Double] = []
        for t in times {
          let parts = PostingQueue.split(t.jsString, 0x3A).map(PostingQueue.parseInt)
          let hh = parts[0]
          let mm = parts.count > 1 ? parts[1] : .nan
          if hh.isNaN || (parts.count > 1 && mm.isNaN) { continue }
          // A time with no minutes is `undefined` there: Date.UTC gives NaN,
          // and formatting it throws.
          let instant = try zonedSlotToUTC(date.y, date.m, date.d, hh, mm, tz)
          if instant > horizonMs { continue }
          dayInstants.append(instant)
        }
        pending = TimerJS.v8Sorted(dayInstants) { $0 - $1 }
      }
      return pending.removeFirst()
    }
  }

  /// `text.split(separator)` for a one-unit separator, by code unit.
  static func split(_ text: String, _ separator: UInt16) -> [String] {
    var out: [String] = []
    var current: [UInt16] = []
    for unit in text.utf16 {
      if unit == separator {
        out.append(String(decoding: current, as: UTF16.self))
        current = []
      } else {
        current.append(unit)
      }
    }
    out.append(String(decoding: current, as: UTF16.self))
    return out
  }

  /// A walk over the slots from `fromMs` (the web's enumerateSlots generator).
  public static func slotWalk(_ schedule: JSONValue?, _ fromMs: Double, _ tz: String? = nil, localZone: TimeZone? = nil)
    -> SlotWalk
  {
    SlotWalk(schedule, fromMs, tz ?? resolveTimezone(schedule, localZone: localZone))
  }

  /// Every slot from `fromMs` to the horizon, ascending (epoch ms).
  public static func enumerateSlots(
    _ schedule: JSONValue?, _ fromMs: Double, _ tz: String? = nil, localZone: TimeZone? = nil
  ) throws -> [Double] {
    var walk = slotWalk(schedule, fromMs, tz, localZone: localZone)
    var out: [Double] = []
    while let slot = try walk.next() { out.append(slot) }
    return out
  }

  /// `parseInt(text, 10)`: leading space, a sign, then decimal digits; NaN
  /// when there are none.
  static func parseInt(_ text: String) -> Double {
    var units = Substring(text).utf16.drop { PostingJS.isSpace($0) }[...]
    var negative = false
    if let first = units.first, first == 0x2B || first == 0x2D {
      negative = first == 0x2D
      units = units.dropFirst()
    }
    var value = 0.0
    var any = false
    for unit in units {
      guard unit >= 0x30, unit <= 0x39 else { break }
      value = value * 10 + Double(unit - 0x30)
      any = true
    }
    guard any else { return .nan }
    return negative ? -value : value
  }

  /// `Math.floor(new Date(value).getTime() / 60000)`.
  static func minuteKey(_ value: JSONValue?, _ zone: TimeZone?) -> Double {
    (TimerJS.dateMs(value, timeZone: zone ?? AppLocale.activeTimeZone()) / 60_000).rounded(.down)
  }

  static func minuteKey(ms: Double) -> Double { (ms / 60_000).rounded(.down) }

  /// Next open future slot (epoch ms) for a new queued post, or nil if the
  /// schedule is empty or the queue is full to the horizon. `queuedRows`:
  /// the queued rows (`{ scheduledFor }`) whose slots are taken, every
  /// client's, leaving out the row being edited. A row that isn't an object
  /// takes no slot (the web throws reading it). `localZone` is the device's
  /// zone: a schedule without one uses it, and a time without an offset is
  /// read in it.
  public static func nextOpenSlot(
    _ schedule: JSONValue?, _ queuedRows: [JSONValue] = [], now: Double, localZone: TimeZone? = nil
  ) throws -> Double? {
    if isScheduleEmpty(schedule) { return nil }
    let tz = resolveTimezone(schedule, localZone: localZone)
    let taken = Set(queuedRows.map { minuteKey($0["scheduledFor"], localZone) }.filter { !$0.isNaN })
    var walk = SlotWalk(schedule, now, tz)
    while let ms = try walk.next() {
      if ms <= now + minLeadMs { continue }
      if taken.contains(minuteKey(ms: ms)) { continue }
      return ms
    }
    return nil
  }

  /// An instant as one ISO-Z string, or nil when there isn't a usable one.
  static func toIsoOrNull(_ value: JSONValue?, _ zone: TimeZone?) -> String? {
    let ms = ComposerJS.truthy(value) ? TimerJS.dateMs(value, timeZone: zone ?? AppLocale.activeTimeZone()) : .nan
    return ms.isNaN ? nil : JSDate.toISOString(ms)
  }

  /// Pair ordered queued rows with upcoming slots, in order: `{ id,
  /// oldScheduledFor, newScheduledFor }`, both ISO-Z, `newScheduledFor` nil
  /// past the horizon. `occupied` are queued rows that may not move (failed,
  /// due, or a thread part-way out): their minutes are skipped.
  public static func recomputeQueueAssignment(
    _ schedule: JSONValue?,
    _ orderedRows: [JSONValue] = [],
    now: Double,
    occupied: [JSONValue]? = [],
    localZone: TimeZone? = nil
  ) throws -> [QueueAssignment] {
    let tz = resolveTimezone(schedule, localZone: localZone)
    let held = Set((occupied ?? []).map { minuteKey($0["scheduledFor"], localZone) }.filter(\.isFinite))
    var slots: [Double] = []
    if !isScheduleEmpty(schedule) && !orderedRows.isEmpty {
      var walk = SlotWalk(schedule, now, tz)
      while let slot = try walk.next() {
        if slot <= now + minLeadMs { continue }
        if held.contains(minuteKey(ms: slot)) { continue }
        slots.append(slot)
        if slots.count == orderedRows.count { break }
      }
    }
    return orderedRows.enumerated().map { i, row in
      QueueAssignment(
        id: row["id"],
        oldScheduledFor: toIsoOrNull(row["scheduledFor"], localZone),
        newScheduledFor: i < slots.count ? JSDate.toISOString(slots[i]) : nil)
    }
  }

  // MARK: Reading a set of scheduled rows

  /// Counts for the posting surfaces: queued (weekly queue, soonest-first),
  /// scheduled (a one-off time) and failed. A queued row caught mid-publish
  /// is in neither count.
  public static func summarizeQueue(_ rows: [JSONValue] = [], timeZone: TimeZone? = nil) -> QueueSummary {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let queued = TimerJS.v8Sorted(
      rows.filter { ComposerJS.truthy($0["queued"]) && $0["status"] == "pending" }
    ) { a, b in TimerJS.dateMs(a["scheduledFor"], timeZone: zone) - TimerJS.dateMs(b["scheduledFor"], timeZone: zone) }
    let scheduledCount = rows.filter { row in
      guard ComposerJS.truthy(row) else { return false }
      return !ComposerJS.truthy(row["queued"]) && (row["status"] == "pending" || row["status"] == "publishing")
    }.count
    let failedCount = rows.filter { $0["status"] == "failed" }.count
    return QueueSummary(queued: queued, queuedCount: queued.count, scheduledCount: scheduledCount, failedCount: failedCount)
  }

  /// How far off an instant is, in the roundest unit that still says something.
  public static func relativeWhen(_ iso: JSONValue?, now: Double, timeZone: TimeZone? = nil) -> String {
    let ms = TimerJS.dateMs(iso, timeZone: timeZone ?? AppLocale.activeTimeZone()) - now
    if ms.isNaN { return "" }
    if ms <= 0 { return "due now" }
    let mins = (ms / 60_000).jsRounded
    if mins < 60 { return "in \(JSNumber.format(mins)) min" }
    let hrs = (mins / 60).jsRounded
    if hrs < 24 { return "in \(JSNumber.format(hrs)) hr" }
    let days = (hrs / 24).jsRounded
    return "in \(JSNumber.format(days)) day\(days == 1 ? "" : "s")"
  }

  public static func relativeWhen(_ iso: String?, now: Double, timeZone: TimeZone? = nil) -> String {
    relativeWhen(iso.map(JSONValue.string), now: now, timeZone: timeZone)
  }

  /// The first line of a scheduled row, for a list; media-only posts get a
  /// label. A text that isn't a string reads as none.
  public static func postSnippet(_ row: JSONValue?, max: Int = 60) -> String {
    let first = row?["payload"]?["posts"].flatMap { $0[0] ?? $0["0"] }
    let text = (first?["record"]?["text"]?.stringValue ?? "").jsTrimmed()
    if text.isEmpty { return "a post with media" }
    return text.jsLength > max ? "\(text.jsSlice(0, max - 1))…" : text
  }

  /// What to say when "Add to queue" on an edited queued post moved it off
  /// its own slot because that slot had come too close, or '' when it kept
  /// its place or never had one. `when` is the slot it was given (nil for
  /// none; NaN for an invalid date).
  public static func queueSlotMoveNote(
    _ editingRow: JSONValue?, when: Double?, now: Double, minLeadMs: Double = PostingQueue.minLeadMs,
    timeZone: TimeZone? = nil
  ) -> String {
    guard ComposerJS.truthy(editingRow?["queued"]), let when else { return "" }
    let scheduled = editingRow?["scheduledFor"]
    let ownSlotMs = TimerJS.dateMs(
      ComposerJS.truthy(scheduled) ? scheduled : .number(.nan), timeZone: timeZone ?? AppLocale.activeTimeZone())
    if ownSlotMs.isNaN { return "" }
    if ownSlotMs > now + minLeadMs { return "" }
    if when == ownSlotMs { return "" }
    // An unreadable slot must not throw: this runs before the queue write.
    let away = when.isNaN ? "" : relativeWhen(JSDate.toISOString(when), now: now)
    return away.isEmpty
      ? "Added to your queue. Its time had come too close to keep, so it moved to the next open slot."
      : "Added to your queue. Its time had come too close to keep, so it moved to the next open slot, \(away)."
  }
}
