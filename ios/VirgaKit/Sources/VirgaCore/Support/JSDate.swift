// JavaScript's Date, for ports that must compute what the web app computes:
// `Date.parse` (V8's parser: the ISO format, and the legacy forms Chrome and
// Node accept), `Date.UTC` and `new Date(y, m, d, ...)` with their overflow
// rules, a moment's local fields (`getFullYear()`, `getDay()`, ...) in an
// explicit zone, and `toISOString()`.
//
// Times are epoch milliseconds in a Double, as in JavaScript; an invalid
// date is NaN. Local time is always an explicit `TimeZone` (PORTING.md:
// logic never reads the device's zone); the web's "local" is the browser's
// zone, which on iOS is `AppLocale.activeTimeZone()`.
//
// ios/parity/cases/core.jsdate.js holds this file to Node's own Date in
// several zones, DST gaps and overlaps included.

import Foundation

public enum JSDate {
  public static let msPerDay: Double = 86_400_000
  /// The largest time a Date holds, either side of the epoch.
  public static let maxTime: Double = 8.64e15

  // MARK: - The spec's abstract operations

  /// TimeClip: NaN outside ±8.64e15, otherwise the time truncated (and never -0).
  public static func timeClip(_ time: Double) -> Double {
    guard time.isFinite, abs(time) <= maxTime else { return .nan }
    return time.rounded(.towardZero) + 0
  }

  /// MakeTime(hour, min, sec, ms), each truncated toward zero.
  public static func makeTime(_ hour: Double, _ minute: Double, _ second: Double, _ ms: Double) -> Double {
    guard hour.isFinite, minute.isFinite, second.isFinite, ms.isFinite else { return .nan }
    return trunc(hour) * 3_600_000 + trunc(minute) * 60_000 + trunc(second) * 1000 + trunc(ms)
  }

  /// MakeDay(year, month, date): the day number of that date, with the
  /// month and date allowed to overflow (month 12 is January next year,
  /// day 0 the last of the month before). `month` is 0-based.
  public static func makeDay(_ year: Double, _ month: Double, _ date: Double) -> Double {
    guard year.isFinite, month.isFinite, date.isFinite else { return .nan }
    let y = trunc(year)
    let m = trunc(month)
    let dt = trunc(date)
    let ym = y + (m / 12).rounded(.down)
    // Well past where TimeClip gives up either way; keeps Int64 safe.
    guard abs(ym) < 1_000_000 else { return .nan }
    let mn = m - (m / 12).rounded(.down) * 12
    let days = daysFromCivil(Int64(ym), Int64(mn) + 1, 1)
    return Double(days) + dt - 1
  }

  /// MakeDate(day, time).
  public static func makeDate(_ day: Double, _ time: Double) -> Double {
    guard day.isFinite, time.isFinite else { return .nan }
    return day * msPerDay + time
  }

  /// Days since the epoch of a proleptic Gregorian date (month 1...12).
  static func daysFromCivil(_ year: Int64, _ month: Int64, _ day: Int64) -> Int64 {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = (month + 9) % 12
    let doy = (153 * mp + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
  }

  /// The proleptic Gregorian date of a day number: (year, month 1...12, day).
  static func civilFromDays(_ days: Int64) -> (year: Int64, month: Int64, day: Int64) {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let d = doy - (153 * mp + 2) / 5 + 1
    let m = mp < 10 ? mp + 3 : mp - 9
    return (m <= 2 ? y + 1 : y, m, d)
  }

  /// A year as `Date.UTC` and `new Date(y, ...)` read it: 0 to 99 is 1900 to 1999.
  static func fullYear(_ year: Double) -> Double {
    guard year.isFinite else { return year }
    let y = trunc(year)
    return (0...99).contains(y) ? 1900 + y : year
  }

  // MARK: - Constructors

  /// `Date.UTC(year, month, day, hours, minutes, seconds, ms)`: month is
  /// 0-based and every field may overflow.
  public static func utc(
    _ year: Double, _ month: Double = 0, _ day: Double = 1,
    _ hour: Double = 0, _ minute: Double = 0, _ second: Double = 0, _ ms: Double = 0
  ) -> Double {
    timeClip(makeDate(makeDay(fullYear(year), month, day), makeTime(hour, minute, second, ms)))
  }

  /// `new Date(year, month, day, hours, minutes, seconds, ms).getTime()` with
  /// local time in `timeZone`. A wall time that a clock change skips or
  /// repeats is read with the offset from before the change, as the spec
  /// says (2:30 on a spring-forward night is 3:30 after it).
  public static func local(
    _ year: Double, _ month: Double = 0, _ day: Double = 1,
    _ hour: Double = 0, _ minute: Double = 0, _ second: Double = 0, _ ms: Double = 0,
    timeZone: TimeZone
  ) -> Double {
    let wall = makeDate(makeDay(fullYear(year), month, day), makeTime(hour, minute, second, ms))
    guard wall.isFinite, abs(wall) <= maxTime + msPerDay else { return .nan }
    return timeClip(localToUTC(wall, timeZone: timeZone))
  }

  // MARK: - Local time

  /// The zone's offset from UTC at instant `time`, in milliseconds (east positive).
  public static func offsetMs(at time: Double, timeZone: TimeZone) -> Double {
    Double(timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: time / 1000))) * 1000
  }

  /// `date.getTimezoneOffset()`: whole minutes west of UTC (V8 truncates
  /// an offset with seconds in it, such as a zone's local mean time before
  /// standard time: New York's -4:56:02 is 296).
  public static func timezoneOffset(_ time: Double, timeZone: TimeZone) -> Double {
    guard time.isFinite else { return .nan }
    return -(offsetMs(at: time, timeZone: timeZone) / 60_000).rounded(.towardZero) + 0
  }

  /// UTC(t) for a wall-clock time `wall` in `timeZone`: the offset in force
  /// before a transition wins where the wall time is skipped or repeated.
  public static func localToUTC(_ wall: Double, timeZone: TimeZone) -> Double {
    guard wall.isFinite else { return .nan }
    let before = offsetMs(at: wall - msPerDay, timeZone: timeZone)
    let after = offsetMs(at: wall + msPerDay, timeZone: timeZone)
    let early = wall - before
    if offsetMs(at: early, timeZone: timeZone) == before { return early }
    let late = wall - after
    if offsetMs(at: late, timeZone: timeZone) == after { return late }
    // Neither reading is a real moment: a skipped wall time, or two
    // transitions inside a day. Settle on the offset at a first guess.
    if before == after {
      let guess = wall - offsetMs(at: wall, timeZone: timeZone)
      return wall - offsetMs(at: guess, timeZone: timeZone)
    }
    return early
  }

  /// A moment's fields in a zone, as `getFullYear()`, `getMonth()` (0-based),
  /// `getDate()`, `getDay()` (0 is Sunday), `getHours()` and the rest read them.
  public struct Fields: Hashable, Sendable {
    public var year: Int
    public var month: Int
    public var date: Int
    public var day: Int
    public var hours: Int
    public var minutes: Int
    public var seconds: Int
    public var milliseconds: Int
  }

  /// The local fields of `new Date(time)` in `timeZone` (the time clipped
  /// as the constructor clips it), or nil for an invalid date.
  public static func fields(_ time: Double, timeZone: TimeZone) -> Fields? {
    let t = timeClip(time)
    guard t.isFinite else { return nil }
    return wallFields(t + offsetMs(at: t, timeZone: timeZone))
  }

  /// The UTC fields of `new Date(time)` (`getUTCFullYear()` and the rest).
  public static func utcFields(_ time: Double) -> Fields? {
    let t = timeClip(time)
    guard t.isFinite else { return nil }
    return wallFields(t)
  }

  /// The calendar fields of a wall-clock time in milliseconds.
  static func wallFields(_ time: Double) -> Fields? {
    guard time.isFinite else { return nil }
    let days = (time / msPerDay).rounded(.down)
    let inDay = Int64(time - days * msPerDay)
    let (y, m, d) = civilFromDays(Int64(days))
    let weekday = Int(((Int64(days) + 4) % 7 + 7) % 7)
    return Fields(
      year: Int(y), month: Int(m) - 1, date: Int(d), day: weekday,
      hours: Int(inDay / 3_600_000), minutes: Int(inDay / 60_000 % 60),
      seconds: Int(inDay / 1000 % 60), milliseconds: Int(inDay % 1000)
    )
  }

  /// `date.toISOString()`, or nil where JavaScript throws (an invalid date).
  public static func toISOString(_ time: Double) -> String? {
    guard time.isFinite, abs(time) <= maxTime, let f = utcFields(time) else { return nil }
    let year: String
    if f.year >= 0 && f.year <= 9999 {
      year = pad(f.year, 4)
    } else {
      year = (f.year < 0 ? "-" : "+") + pad(abs(f.year), 6)
    }
    return "\(year)-\(pad(f.month + 1, 2))-\(pad(f.date, 2))T\(pad(f.hours, 2)):\(pad(f.minutes, 2)):\(pad(f.seconds, 2)).\(pad(f.milliseconds, 3))Z"
  }

  static func pad(_ n: Int, _ width: Int) -> String {
    let s = String(n)
    return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
  }

  // MARK: - Date.parse

  /// `Date.parse(text)`: epoch milliseconds, or NaN. A port of V8's
  /// DateParser: the ES date-time format first (date-only forms are UTC,
  /// date-times without an offset local), then the legacy forms browsers
  /// accept ("Mar 15 2026", "3/15/2026 2:30 PM", "Sun, 15 Mar 2026 12:00:00
  /// GMT", what `toString()` writes), local unless they name a zone.
  public static func parse(_ text: String, timeZone: TimeZone) -> Double {
    // A port of V8's ES-format and legacy parsers, quirks included.
    V8Date.parse(text, timeZone: timeZone)
  }

  /// The web's `toMs` helpers (`typeof date === 'number' ? date :
  /// Date.parse(date)`): a number is already a time; anything else is
  /// `Date.parse(String(value))`, so a string is parsed, an array is parsed
  /// as its joined text (`['2026-03-15']` is that day), and null, a
  /// boolean, an object or nothing at all is NaN.
  public static func toMs(_ value: JSONValue?, timeZone: TimeZone) -> Double {
    switch value {
    case .number(let n): return n
    case .string(let s): return parse(s, timeZone: timeZone)
    case .array: return parse(value!.jsString, timeZone: timeZone)
    default: return .nan
    }
  }
}
