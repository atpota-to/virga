// Ports src/posting/schedule/queueReorder.js
// Ports src/posting/schedule/queueCalendar.js
// Ports src/posting/pages/scheduleModel.js
// Ports src/posting/pages/hubModel.js
//
// The bits of JavaScript the scheduling ports share for loose values:
// `value ? new Date(value).getTime() : NaN`, a Date's local calendar
// (`setHours(0, 0, 0, 0)`, `setDate(n)`, `getFullYear()`… in one zone),
// `text.replace(/\s+/g, ' ')` and `list?.[0]`. Internal.

import Foundation
import VirgaCore

enum ScheduleJS {
  /// `value ? new Date(value).getTime() : NaN`, a date-time without an
  /// offset read in `zone` (nil: the active one).
  static func instant(_ value: JSONValue?, _ zone: TimeZone?) -> Double {
    guard let value, value.isTruthy else { return .nan }
    return TimerJS.dateMs(value, timeZone: zone ?? AppLocale.activeTimeZone())
  }

  /// `a - b` for a sort comparator, as V8 reads a NaN (equal).
  static func compare(_ a: Double, _ b: Double) -> Double { a - b }

  /// `text.replace(/\s+/g, ' ')`: every run of JavaScript whitespace one space.
  static func collapseSpace(_ text: String) -> String {
    var out: [UInt16] = []
    var inSpace = false
    for unit in text.utf16 {
      if PostingJS.isSpace(unit) {
        if !inSpace { out.append(0x20) }
        inSpace = true
      } else {
        out.append(unit)
        inSpace = false
      }
    }
    return String(decoding: out, as: UTF16.self)
  }

  /// `value?.[0]`: an array's first element, an object's member '0', a
  /// string's first code unit.
  static func first(_ value: JSONValue?) -> JSONValue? {
    switch value {
    case .array(let items)?: return items.first
    case .object(let members)?: return members["0"]
    case .string(let text)?:
      guard let unit = text.utf16.first else { return nil }
      return .string(String(decoding: [unit], as: UTF16.self))
    default: return nil
    }
  }

  /// `value?.length` read as `x?.length || 0` reads it: an array's count, a
  /// string's length, an object's numeric `length` member.
  static func count(_ value: JSONValue?) -> Double {
    switch value {
    case .array(let items)?: return Double(items.count)
    case .string(let text)?: return Double(text.utf16.count)
    case .object(let members)?:
      if case .number(let n)? = members["length"] { return n }
      return 0
    default: return 0
    }
  }

  // MARK: A Date's local calendar

  /// `x.setHours(0, 0, 0, 0)` on a copy of the instant `ms`: the start of its
  /// local day (a midnight a clock change skips resolves as V8's UTC() does).
  static func startOfDay(_ ms: Double, _ zone: TimeZone) -> Double {
    guard let f = JSDate.fields(ms, timeZone: zone) else { return .nan }
    let day = JSDate.makeDay(Double(f.year), Double(f.month), Double(f.date))
    return JSDate.timeClip(JSDate.localToUTC(JSDate.makeDate(day, 0), timeZone: zone))
  }

  /// `x.setDate(dt)` on a copy of the instant `ms`: the same local time of
  /// day, on day `dt` of its month (rolling over as MakeDay does).
  static func setDate(_ ms: Double, _ dt: Double, _ zone: TimeZone) -> Double {
    guard let f = JSDate.fields(ms, timeZone: zone) else { return .nan }
    let day = JSDate.makeDay(Double(f.year), Double(f.month), dt)
    let time = JSDate.makeTime(Double(f.hours), Double(f.minutes), Double(f.seconds), Double(f.milliseconds))
    return JSDate.timeClip(JSDate.localToUTC(JSDate.makeDate(day, time), timeZone: zone))
  }

  /// `x.getDate()` in `zone` (NaN for an invalid date).
  static func localDate(_ ms: Double, _ zone: TimeZone) -> Double {
    JSDate.fields(ms, timeZone: zone).map { Double($0.date) } ?? .nan
  }

  /// `${getFullYear()}-${getMonth()}-${getDate()}`: the local day as a key.
  static func dayKey(_ ms: Double, _ zone: TimeZone) -> String {
    guard let f = JSDate.fields(ms, timeZone: zone) else { return "NaN-NaN-NaN" }
    return "\(f.year)-\(f.month)-\(f.date)"
  }

  /// An instant as `toJSON` writes a Date: ISO-Z, or null when invalid.
  static func isoJSON(_ ms: Double) -> JSONValue {
    JSDate.toISOString(ms).map(JSONValue.string) ?? .null
  }
}
