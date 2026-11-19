// Ports src/lib/locale.js
//
// The web app's `toLocaleString` calls, for every port that formats: a
// number (`n.toLocaleString(activeLocale())`, 128 places on the web) and a
// date (`d.toLocaleDateString(activeLocale(), { month: 'short', ... })`),
// written as the web runtime's Intl writes them (LocaleData). Each takes
// the locale and zone explicitly, defaulting to the active ones.

import Foundation

extension AppLocale {
  /// `n.toLocaleString(locale, { minimumFractionDigits, maximumFractionDigits })`:
  /// grouped, up to three decimals by default. NaN is "NaN", infinity "∞".
  public static func formatNumber(
    _ n: Double,
    locale: String? = nil,
    minimumFractionDigits: Int = 0,
    maximumFractionDigits: Int = 3
  ) -> String {
    let profile = LocaleData.profile(for: locale ?? activeLocale())
    return LocaleData.formatNumber(
      n,
      symbols: profile.number,
      minimumFractionDigits: minimumFractionDigits,
      maximumFractionDigits: max(minimumFractionDigits, maximumFractionDigits)
    )
  }

  /// `formatNumber` for an integer count.
  public static func formatNumber(_ n: Int, locale: String? = nil) -> String {
    formatNumber(Double(n), locale: locale)
  }

  /// `new Date(time).toLocaleDateString(locale, options)`: the date fields
  /// default to numeric year, month and day when none is named. "Invalid
  /// Date" for an invalid time, as JavaScript writes it.
  public static func toLocaleDateString(
    _ time: Double,
    _ options: DateFormatOptions = DateFormatOptions(),
    locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> String {
    LocaleData.formatDate(
      time, options: options.withDefaults(required: .date, defaults: .date),
      locale: locale ?? activeLocale(), timeZone: timeZone ?? activeTimeZone())
  }

  /// `new Date(time).toLocaleTimeString(locale, options)`: hour, minute and
  /// second by default.
  public static func toLocaleTimeString(
    _ time: Double,
    _ options: DateFormatOptions = DateFormatOptions(),
    locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> String {
    LocaleData.formatDate(
      time, options: options.withDefaults(required: .time, defaults: .time),
      locale: locale ?? activeLocale(), timeZone: timeZone ?? activeTimeZone())
  }

  /// `new Date(time).toLocaleString(locale, options)`: date and time by default.
  public static func toLocaleString(
    date time: Double,
    _ options: DateFormatOptions = DateFormatOptions(),
    locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> String {
    LocaleData.formatDate(
      time, options: options.withDefaults(required: .any, defaults: .all),
      locale: locale ?? activeLocale(), timeZone: timeZone ?? activeTimeZone())
  }

  /// `new Intl.DateTimeFormat(locale, options).format(time)`: the date by default.
  public static func formatDateTime(
    _ time: Double,
    _ options: DateFormatOptions = DateFormatOptions(),
    locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> String {
    LocaleData.formatDate(
      time, options: options.withDefaults(required: .any, defaults: .date),
      locale: locale ?? activeLocale(), timeZone: timeZone ?? activeTimeZone())
  }
}
