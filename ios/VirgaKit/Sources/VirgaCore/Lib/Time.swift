// Ports src/lib/time.js
//
// The two date strings the dashboard prints, in the reader's own time zone.
// The charts bucket by local time, so their captions do too: someone
// reading their own numbers reads them on their own clock.
//
// The web takes a Date, a number of milliseconds or a string for each date;
// here a time is epoch milliseconds (`Double`), with `Date` and string
// overloads. "Local" is `timeZone`, the active zone by default
// (AppLocale.activeTimeZone()); the locale is the active one by default.

import Foundation

public enum Time {
  static let minute: Double = 60_000
  static let hour: Double = 60 * minute
  static let day: Double = 24 * hour

  /// Past this many days, a relative time gives way to the date.
  public static let relativeDays: Double = 30

  /// The web's `toMs`: a Date's time, a number as it is, a string parsed
  /// (`Date.parse`), anything else NaN.
  public static func toMs(_ value: JSONValue?, timeZone: TimeZone? = nil) -> Double {
    JSDate.toMs(value, timeZone: timeZone ?? AppLocale.activeTimeZone())
  }

  /// Whole calendar days between two moments, on the local calendar.
  static func calendarDaysAgo(_ t: Double, _ now: Double, timeZone: TimeZone) -> Double {
    guard let a = JSDate.fields(t, timeZone: timeZone), let b = JSDate.fields(now, timeZone: timeZone) else {
      return .nan
    }
    let startA = JSDate.local(Double(a.year), Double(a.month), Double(a.date), timeZone: timeZone)
    let startB = JSDate.local(Double(b.year), Double(b.month), Double(b.date), timeZone: timeZone)
    // Rounded, because a day that held a clock change is 23 or 25 hours long.
    return ((startB - startA) / day).jsRounded
  }

  /// "Jan 29, 2025": the short date. Empty for anything that isn't a date.
  public static func formatDateShort(_ time: Double, locale: String? = nil, timeZone: TimeZone? = nil) -> String {
    guard time.isFinite else { return "" }
    return AppLocale.toLocaleDateString(
      time, DateFormatOptions(year: "numeric", month: "short", day: "numeric"),
      locale: locale, timeZone: timeZone)
  }

  public static func formatDateShort(_ date: Date, locale: String? = nil, timeZone: TimeZone? = nil) -> String {
    formatDateShort(date.timeIntervalSince1970 * 1000, locale: locale, timeZone: timeZone)
  }

  /// A date string, read as `Date.parse` reads it.
  public static func formatDateShort(_ text: String, locale: String? = nil, timeZone: TimeZone? = nil) -> String {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    return formatDateShort(JSDate.parse(text, timeZone: zone), locale: locale, timeZone: zone)
  }

  /// "just now", "5m ago", "19h ago", "3d ago", "2w ago", and past
  /// `relativeDays` the short date.
  ///
  /// Minutes and hours are elapsed time. From a day on, the count is
  /// calendar days, so something from 11pm two nights ago is "2d ago", not
  /// "1d ago". `now` is passed in (the web's `now = new Date()`).
  public static func relativeTime(_ time: Double, now: Double, locale: String? = nil, timeZone: TimeZone? = nil) -> String {
    guard time.isFinite, now.isFinite else { return "" }
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let delta = now - time
    if delta < minute { return "just now" }
    if delta < hour { return "\(JSNumber.format((delta / minute).rounded(.down)))m ago" }
    let days = calendarDaysAgo(time, now, timeZone: zone)
    // Hours while it's still the same day, too: "1d ago" for something from
    // this morning would be wrong on the calendar the reader is looking at.
    if delta < day || days < 1 { return "\(JSNumber.format((delta / hour).rounded(.down)))h ago" }
    if days < 7 { return "\(JSNumber.format(days))d ago" }
    if days < relativeDays { return "\(JSNumber.format((days / 7).rounded(.down)))w ago" }
    return formatDateShort(time, locale: locale, timeZone: zone)
  }

  public static func relativeTime(_ date: Date, now: Date, locale: String? = nil, timeZone: TimeZone? = nil) -> String {
    relativeTime(date.timeIntervalSince1970 * 1000, now: now.timeIntervalSince1970 * 1000, locale: locale, timeZone: timeZone)
  }

  /// A date string, read as `Date.parse` reads it.
  public static func relativeTime(_ text: String, now: Double, locale: String? = nil, timeZone: TimeZone? = nil) -> String {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    return relativeTime(JSDate.parse(text, timeZone: zone), now: now, locale: locale, timeZone: zone)
  }
}
