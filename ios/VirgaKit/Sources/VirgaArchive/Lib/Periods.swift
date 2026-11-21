// Ports src/lib/periods.js
//
// The window a chart answers for: one of the presets (7 days to all time) or
// a range of dates picked by hand. What a stored choice means, the words for
// it, and where it ends. Local days are read in `timeZone`; the words are
// written in `locale` (both default to VirgaCore's active ones).

import Foundation
import VirgaCore

public enum Periods {
  static let dayMs: Double = 86_400_000

  public static let defaultPeriodKey = "30d"
  public static let customPeriod = "custom"

  /// The preset with this key, or nil.
  public static func presetPeriod(_ key: String?) -> AnalyticsPeriod? {
    guard let key else { return nil }
    return Analytics.analyticsPeriods.first { $0.key.jsEquals(key) }
  }

  /// `/^(\d{4})-(\d{2})-(\d{2})$/`: the three numbers of a 'YYYY-MM-DD'.
  static func dateParts(_ text: String) -> (Double, Double, Double)? {
    let units = Array(text.utf16)
    guard units.count == 10, units[4] == 0x2D, units[7] == 0x2D else { return nil }
    func digits(_ range: Range<Int>) -> Double? {
      var n: Double = 0
      for i in range {
        guard (0x30...0x39).contains(units[i]) else { return nil }
        n = n * 10 + Double(units[i] - 0x30)
      }
      return n
    }
    guard let y = digits(0..<4), let m = digits(5..<7), let d = digits(8..<10) else { return nil }
    return (y, m, d)
  }

  /// Local midnight at the start of a 'YYYY-MM-DD' day, or NaN (a day that
  /// would roll over, like 2026-02-31, isn't one).
  public static func dayStartMs(_ day: String?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> Double {
    guard let (y, m, d) = dateParts(day ?? "") else { return .nan }
    let ms = JSDate.local(y, m - 1, d, timeZone: timeZone)
    guard let f = JSDate.fields(ms, timeZone: timeZone), Double(f.year) == y, Double(f.month) == m - 1, Double(f.date) == d
    else { return .nan }
    return ms
  }

  /// `dayStartMs(String(day || ''))` for any value.
  public static func dayStartMs(_ day: JSONValue?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> Double {
    guard let day = day.truthy else { return .nan }
    return dayStartMs(day.stringValue ?? day.jsString, timeZone: timeZone)
  }

  /// 'YYYY-MM-DD' for the local day holding `ms` ("NaN-NaN-NaN" for none).
  public static func dayKey(_ ms: Double, timeZone: TimeZone = AppLocale.activeTimeZone()) -> String {
    guard let d = JSDate.fields(JSDate.timeClip(ms), timeZone: timeZone) else { return "NaN-NaN-NaN" }
    return [String(d.year), pad2(d.month + 1), pad2(d.date)].joined(separator: "-")
  }

  /// `String(n).padStart(2, '0')`.
  static func pad2(_ n: Int) -> String {
    let s = String(n)
    return s.utf16.count >= 2 ? s : String(repeating: "0", count: 2 - s.utf16.count) + s
  }

  static func dayWords(_ ms: Double, _ withYear: Bool, locale: String?, timeZone: TimeZone) -> String {
    AppLocale.toLocaleDateString(
      ms, DateFormatOptions(year: withYear ? "numeric" : nil, month: "short", day: "numeric"), locale: locale,
      timeZone: timeZone)
  }

  /// "Oct 1 – Oct 31, 2026", with both years when the range crosses one.
  public static func rangeLabel(
    _ fromMs: Double, _ toMs: Double, _ joiner: String = " – ", locale: String? = nil,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> String {
    let fromYear = JSDate.fields(JSDate.timeClip(fromMs), timeZone: timeZone)?.year
    let toYear = JSDate.fields(JSDate.timeClip(toMs), timeZone: timeZone)?.year
    // NaN !== NaN: two invalid years aren't the same year.
    let sameYear = fromYear != nil && fromYear == toYear
    if dayKey(fromMs, timeZone: timeZone) == dayKey(toMs, timeZone: timeZone) {
      return dayWords(fromMs, true, locale: locale, timeZone: timeZone)
    }
    return "\(dayWords(fromMs, !sameYear, locale: locale, timeZone: timeZone))\(joiner)\(dayWords(toMs, true, locale: locale, timeZone: timeZone))"
  }

  /// A range of whole days, from the start of `from` to the end of `to`
  /// (both 'YYYY-MM-DD', local). Nil when either isn't a date, the range
  /// runs backwards or starts in the future. A range past today ends now.
  public static func customPeriod(
    _ from: String?, _ to: String?, _ nowMs: Double, locale: String? = nil,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> AnalyticsPeriod? {
    let start = dayStartMs(from, timeZone: timeZone)
    let last = dayStartMs(to, timeZone: timeZone)
    guard start.isFinite, last.isFinite, !(last < start), !(start > nowMs), let from, let to,
      let lastDay = JSDate.fields(last, timeZone: timeZone)
    else { return nil }
    let close =
      JSDate.local(Double(lastDay.year), Double(lastDay.month), Double(lastDay.date) + 1, timeZone: timeZone) - 1
    let end = jsMin(close, nowMs)
    let days = Swift.max(1, ((close + 1 - start) / dayMs).jsRounded)
    return AnalyticsPeriod(
      key: "\(customPeriod):\(from):\(to)", days: Int(days), label: rangeLabel(start, last, locale: locale, timeZone: timeZone),
      start: start, end: end, from: from, to: to, custom: true)
  }

  /// `Math.min(a, b)`: NaN if either is.
  static func jsMin(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == b { return a.sign == .minus ? a : b }
    return a < b ? a : b
  }

  /// The period a stored choice means: a preset key, or 'custom' with its
  /// two days. Anything unreadable is the default (30 days).
  public static func resolvePeriod(
    period: String?, periodFrom: String?, periodTo: String?, nowMs: Double, locale: String? = nil,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> AnalyticsPeriod {
    if let period, period.jsEquals(customPeriod),
      let custom = customPeriod(periodFrom, periodTo, nowMs, locale: locale, timeZone: timeZone)
    {
      return custom
    }
    return presetPeriod(period) ?? presetPeriod(defaultPeriodKey)!
  }

  /// `resolvePeriod(preferences, now)`.
  public static func resolvePeriod(
    _ preferences: Preferences?, nowMs: Double, locale: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> AnalyticsPeriod {
    resolvePeriod(
      period: preferences?.period.rawValue, periodFrom: preferences?.periodFrom, periodTo: preferences?.periodTo,
      nowMs: nowMs, locale: locale, timeZone: timeZone)
  }

  /// Where a window ends: now for a preset, the range's own end for a custom one.
  public static func periodEnd(_ period: AnalyticsPeriod?, _ nowMs: Double) -> Double {
    if let end = period?.end, end.isFinite { return jsMin(end, nowMs) }
    return nowMs
  }

  /// Where a window starts: `days` back from now for a preset, the first
  /// midnight of a custom range, nil for all time.
  public static func periodStart(_ period: AnalyticsPeriod?, _ nowMs: Double) -> Double? {
    if period?.isCustom == true { return period?.start }
    if let days = period?.days, days != 0 { return nowMs - Double(days) * dayMs }
    return nil
  }

  /// "the last 30 days", "the last year", "all time", "Oct 1 to Oct 31, 2026".
  public static func periodPhrase(_ period: AnalyticsPeriod?, locale: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()) -> String {
    if let period, period.isCustom {
      return rangeLabel(
        dayStartMs(period.from, timeZone: timeZone), dayStartMs(period.to, timeZone: timeZone), " to ", locale: locale,
        timeZone: timeZone)
    }
    guard let period, let days = period.days, days != 0 else { return "all time" }
    return period.key == "1y" ? "the last year" : "the last \(period.label.jsLowercased())"
  }

  /// The line under a page's title: "The last 30 days, Oct 17 to Nov 15".
  public static func periodLine(
    _ period: AnalyticsPeriod?, _ nowMs: Double, locale: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> String {
    if let period, period.isCustom {
      return rangeLabel(
        dayStartMs(period.from, timeZone: timeZone), dayStartMs(period.to, timeZone: timeZone), " to ", locale: locale,
        timeZone: timeZone)
    }
    guard let period, let days = period.days, days != 0 else { return "All time" }
    let phrase = periodPhrase(period, locale: locale, timeZone: timeZone)
    let head = "\(phrase.jsCharAt(0).jsUppercased())\(phrase.jsSlice(1))"
    let range = rangeLabel(
      periodStart(period, nowMs) ?? .nan, periodEnd(period, nowMs), " to ", locale: locale, timeZone: timeZone)
    return "\(head), \(range)"
  }

  /// A card's caption: "Last 30 days", "All time", or a custom range's label.
  public static func periodWindowWord(_ period: AnalyticsPeriod?) -> String {
    if let period, period.isCustom { return period.label }
    guard let period, let days = period.days, days != 0 else { return "All time" }
    return "Last \(period.label.jsLowercased())"
  }

  /// "the 30 days before", "The year before", "the 1 day before".
  public static func periodBefore(_ period: AnalyticsPeriod?, _ capital: Bool = false) -> String {
    let span: String
    if let period, period.isCustom {
      let days = period.days.map(String.init) ?? "undefined"
      span = "\(days) \(period.days == 1 ? "day" : "days")"
    } else {
      span = (period?.label ?? "").jsLowercased()
    }
    return "\(capital ? "The" : "the") \(span) before"
  }
}
