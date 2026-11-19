// Ports src/lib/locale.js
//
// How numbers, dates and times are written, and which day a week starts on.
//
// Virga's words are English, so the formats are English too, but in the
// reader's own region: someone in Berlin reads "14 Nov 2026", "1.234,5" and
// "14:30", someone in Chicago "Nov 14, 2026", "1,234.5" and "2:30 PM". A
// German device therefore resolves to en-DE, not de-DE.
//
// As on the web, the active formats live at module level (a `Locked`
// static), because the code that formats is mostly plain functions with no
// view to hand them a context. PreferencesModel sets them before anything
// is drawn (Preferences.applyFormats), and its `formats` stamp changes when
// they do, so the UI can draw again in the new formats. Under test nothing
// sets them, and they stay at en-US, Monday and UTC.
//
// `AppLocale` rather than `Locale`, which is Foundation's. The browser's
// local time zone, which the web reads implicitly through `Date`, is held
// here too (`activeTimeZone`), so logic never reads the device's.
//
// The formatting itself (`n.toLocaleString(activeLocale())` and the date
// options) is AppLocale+Formatting.swift, over LocaleData.

import Foundation

public enum AppLocale {
  public static let defaultLocale = "en-US"

  /// 0 is Sunday, as `Date.prototype.getDay()` counts.
  public static let defaultWeekStart = 1

  /// The formats Settings offers by name, besides following the device.
  public static let localeChoices = ["en-US", "en-GB", "en-DE", "en-FR", "en-CH", "en-IN"]

  /// The week starts Settings offers, besides following the region, in the
  /// web's order (`Object.keys(WEEK_START_CHOICES)`).
  public static let weekStartChoices: [(name: String, day: Int)] = [("monday", 1), ("sunday", 0), ("saturday", 6)]

  /// The day a named week start means, or nil for a name that isn't one.
  public static func weekStartChoice(_ name: String?) -> Int? {
    weekStartChoices.first { $0.name == name }?.day
  }

  struct State {
    var locale = AppLocale.defaultLocale
    var weekStart = AppLocale.defaultWeekStart
    var twelveHour = true
    var timeZone = TimeZone(identifier: "UTC")!
  }

  static let state = Locked(State())

  /// The locale to format with: `AppLocale.formatNumber(n)` is the web's
  /// `n.toLocaleString(activeLocale())`.
  public static func activeLocale() -> String { state.wrappedValue.locale }

  /// The first day of the week, as a `getDay()` index: 0 Sunday, 1 Monday, 6 Saturday.
  public static func activeWeekStart() -> Int { state.wrappedValue.weekStart }

  /// Whether times read "2:30 PM" (true) or "14:30" (false) in the active locale.
  public static func uses12Hour() -> Bool { state.wrappedValue.twelveHour }

  /// The zone "local time" means: the browser's on the web, the device's on
  /// iOS once the app sets it (PreferencesModel does). UTC until then.
  public static func activeTimeZone() -> TimeZone { state.wrappedValue.timeZone }

  public static func setActiveTimeZone(_ zone: TimeZone) {
    state.withLock { $0.timeZone = zone }
  }

  /// Something that changes whenever the formats do, for a cache key: a
  /// number formatted for one locale must not be served to the next.
  public static func localeStamp() -> String {
    let s = state.wrappedValue
    return "\(s.locale)/\(s.weekStart)"
  }

  /// Whether Intl knows the tag (`Intl.NumberFormat.supportedLocalesOf`):
  /// well formed, in a language it has data for.
  static func supported(_ tag: String) -> Bool {
    LanguageTag(tag)?.isSupported ?? false
  }

  /// Whether `tag` reads the clock in 12 hours (h11 or h12).
  static func hourCycleOf(_ tag: String) -> Bool {
    let cycle = LocaleData.profile(for: tag).hourCycle
    return cycle == "h11" || cycle == "h12"
  }

  /// Set the locale. Anything Intl doesn't know falls back to the default.
  @discardableResult
  public static func setActiveLocale(_ tag: String?) -> String {
    let locale = tag.map { supported($0) ? $0 : defaultLocale } ?? defaultLocale
    let twelveHour = hourCycleOf(locale)
    state.withLock {
      $0.locale = locale
      $0.twelveHour = twelveHour
    }
    return locale
  }

  /// Set the first day of the week (0 to 6). Anything else falls back to Monday.
  @discardableResult
  public static func setActiveWeekStart(_ day: Int?) -> Int {
    let weekStart = day.flatMap { (0...6).contains($0) ? $0 : nil } ?? defaultWeekStart
    state.withLock { $0.weekStart = weekStart }
    return weekStart
  }

  /// `setActiveWeekStart` for a loosely typed value: only an integer counts
  /// (`Number.isInteger(day)`), so 'sunday' or 2.5 fall back to Monday.
  @discardableResult
  public static func setActiveWeekStart(_ value: JSONValue?) -> Int {
    setActiveWeekStart(value?.intValue)
  }

  /// The device's first language as an English locale in its region: 'de-DE'
  /// and 'de' both give 'en-DE', 'en-AU' stays 'en-AU', and no readable
  /// language at all gives the default. On iOS, `languages` is
  /// `Locale.preferredLanguages`, passed in.
  public static func systemLocale(_ languages: [String]?) -> String {
    for tag in languages ?? [] {
      guard let parsed = LanguageTag(tag) else { continue }  // Not a language tag; try the next.
      if parsed.language == "en", let region = parsed.region { return "en-\(region)" }
      // A bare 'de' has no region; maximize() adds the likeliest one (DE).
      if let region = parsed.maximizedRegion, region.utf8.count == 2,
        region.utf8.allSatisfy({ $0 >= 0x41 && $0 <= 0x5A }), supported("en-\(region)")
      {
        return "en-\(region)"
      }
    }
    return defaultLocale
  }

  /// The locale a stored preference means: 'system', or one of `localeChoices`.
  public static func resolveLocale(_ pref: String?, languages: [String]?) -> String {
    if let pref, localeChoices.contains(pref) { return pref }
    return systemLocale(languages)
  }

  /// The day a week starts on where `tag` is from, as a `getDay()` index:
  /// the region's (or its language's likeliest region's), from CLDR's week
  /// data as Intl.Locale's weekInfo gives it, and Monday where nothing is
  /// known. (A `-u-fw-` keyword in the tag is not read.)
  public static func regionWeekStart(_ tag: String) -> Int {
    guard let parsed = LanguageTag(tag) else { return defaultWeekStart }
    guard let region = parsed.maximizedRegion, let entry = LocaleData.table.regions[region] else {
      return defaultWeekStart
    }
    return entry.firstDay
  }

  /// The day a stored preference means: 'system' (the locale's own), or a named day.
  public static func resolveWeekStart(_ pref: String?, tag: String? = nil) -> Int {
    if let day = weekStartChoice(pref) { return day }
    return regionWeekStart(tag ?? activeLocale())
  }

  /// The seven `getDay()` indexes in the order a week is read, starting from
  /// the first day: [1, 2, 3, 4, 5, 6, 0] for a Monday start.
  public static func weekOrder(_ start: Int? = nil) -> [Int] {
    let first = start ?? activeWeekStart()
    return (0..<7).map { (first + $0) % 7 }
  }

  /// How far `day` (a `getDay()` index) is into the week: 0 for its first day.
  public static func weekdayOffset(_ day: Int, _ start: Int? = nil) -> Int {
    (day - (start ?? activeWeekStart()) + 7) % 7
  }

  /// A whole number with the locale's separators: "1,234". The web's
  /// `Math.round(Number(n) || 0).toLocaleString(locale)`.
  public static func fmtInt(_ n: Double) -> String {
    let number = n.isNaN ? 0 : n
    return formatNumber(number.jsRounded)
  }

  /// `fmtInt` for a loosely typed value, as `Number(n) || 0` reads it.
  public static func fmtInt(_ n: JSONValue?) -> String {
    fmtInt(n.jsNumber)
  }

  /// A sample of the formats for `tag`, for a settings row: "1,234.5 · Nov
  /// 14, 2026 · 2:30 PM". `at` defaults to 14 Nov 2026, 2:30 PM local time.
  public static func localeSample(_ tag: String, at: Double? = nil, timeZone: TimeZone? = nil) -> String {
    let zone = timeZone ?? activeTimeZone()
    let use = supported(tag) ? tag : defaultLocale
    let moment = at ?? JSDate.local(2026, 10, 14, 14, 30, timeZone: zone)
    let number = formatNumber(1234.5, locale: use)
    let date = toLocaleDateString(moment, DateFormatOptions(year: "numeric", month: "short", day: "numeric"), locale: use, timeZone: zone)
    let time = toLocaleTimeString(moment, DateFormatOptions(hour: "numeric", minute: "2-digit"), locale: use, timeZone: zone)
    return "\(number) · \(date) · \(time)"
  }
}
