// Ports src/lib/preferences.jsx
//
// How Virga looks and behaves for whoever is at this device: the sky, the
// accent, the density, the period every chart answers for, how numbers and
// dates are written, and whether the sidebar is folded. Kept in the
// key-value store under the web's key and in the web's JSON, for every
// account on the device alike (the archive and the dashboards are per
// account; these are per person).
//
// The sky is the theme (Sky.swift): dawn, day and dusk are light pages,
// night is the dark one, and the sky can follow the clock. What the web
// stamps on <html> as data-* attributes is `rootAttributes`, which the
// SwiftUI layer reads for its colour scheme, accent and density.
//
// This file is the pure part (the defaults, the choices, readPreferences'
// checks, the formats, the attributes). The web's PreferencesProvider is
// PreferencesModel.swift. Stamping the DOM and the <meta name=theme-color>
// is VirgaUI's (the scene's colour scheme and tint).

import Foundation

/// The stored preferences: `DEFAULT_PREFERENCES` and every value
/// readPreferences lets through. Encodes to the web's JSON.
public struct Preferences: Codable, Hashable, Sendable {
  /// The accents: the colour of the data and of whatever is pressed. Each
  /// has a full, checked set of steps in the stylesheets (and VirgaUI's
  /// palette). Blue is the one Virga starts with.
  public enum Accent: String, Codable, CaseIterable, Hashable, Sendable {
    case blue, violet, teal, amber, rose, graphite
  }

  /// 'system' (high when the device asks for more contrast), 'normal' or 'high'.
  public enum ContrastChoice: String, Codable, CaseIterable, Hashable, Sendable {
    case system, normal, high
  }

  public enum Density: String, Codable, CaseIterable, Hashable, Sendable {
    case comfortable, compact
  }

  /// A preset period, or 'custom' with `periodFrom` and `periodTo`.
  public enum Period: String, Codable, CaseIterable, Hashable, Sendable {
    case days7 = "7d"
    case days30 = "30d"
    case days90 = "90d"
    case year1 = "1y"
    case all
    case custom
  }

  public enum Sidebar: String, Codable, CaseIterable, Hashable, Sendable {
    case expanded, collapsed
  }

  /// 'system' (English, in the device's region), or one of AppLocale.localeChoices.
  public enum LocaleChoice: String, Codable, CaseIterable, Hashable, Sendable {
    case system
    case enUS = "en-US"
    case enGB = "en-GB"
    case enDE = "en-DE"
    case enFR = "en-FR"
    case enCH = "en-CH"
    case enIN = "en-IN"
  }

  /// 'system' (the locale's own), or a named first day.
  public enum WeekStart: String, Codable, CaseIterable, Hashable, Sendable {
    case system, monday, sunday, saturday
  }

  /// 'clock' (the time of day here; night on a device set to dark) or a sky.
  public var sky: SkyChoice = .clock
  /// The 3D hillside, drawn in the sky at the top of the page.
  public var liveSky = false
  public var accent: Accent = .blue
  public var contrast: ContrastChoice = .system
  public var density: Density = .comfortable
  public var period: Period = .days30
  /// 'YYYY-MM-DD', the first day of a custom range.
  public var periodFrom = ""
  /// 'YYYY-MM-DD', its last.
  public var periodTo = ""
  public var sidebar: Sidebar = .expanded
  public var locale: LocaleChoice = .system
  public var weekStart: WeekStart = .system

  public init() {}

  /// The keys in the web's order (`DEFAULT_PREFERENCES`), which is the
  /// order `JSON.stringify` writes them in.
  enum CodingKeys: String, CodingKey, CaseIterable {
    case sky, liveSky, accent, contrast, density, period, periodFrom, periodTo, sidebar, locale, weekStart
  }

  /// Decoding is lenient, as readPreferences is: anything missing or not a
  /// value this version knows is its default.
  public init(from decoder: Decoder) throws {
    let raw = try JSONValue(from: decoder)
    self = Preferences.normalize(raw)
  }

  // MARK: - The module

  public static let preferencesKey = "virga:preferences"

  public static let accentChoices: [Accent] = Accent.allCases

  /// Re-exported from Sky, as the web re-exports them.
  public static let skyChoices = Sky.skyChoices

  public static let defaultPreferences = Preferences()

  /// `CHOICES`: the values each choice key may take, in the web's order.
  public static let choices: [(key: String, allowed: [String])] = [
    ("sky", SkyChoice.allCases.map(\.rawValue)),
    ("accent", Accent.allCases.map(\.rawValue)),
    ("contrast", ContrastChoice.allCases.map(\.rawValue)),
    ("density", Density.allCases.map(\.rawValue)),
    ("period", Period.allCases.map(\.rawValue)),
    ("sidebar", Sidebar.allCases.map(\.rawValue)),
    ("locale", LocaleChoice.allCases.map(\.rawValue)),
    ("weekStart", WeekStart.allCases.map(\.rawValue)),
  ]

  /// The stored preferences, every key checked: anything missing, or a value
  /// this version doesn't know, falls back to its default rather than
  /// reaching the UI as nonsense.
  public static func readPreferences(store: KeyValueStore?) -> Preferences {
    readPreferences(raw: store?.getItem(preferencesKey))
  }

  /// `readPreferences` for the stored text itself.
  public static func readPreferences(raw text: String?) -> Preferences {
    guard let text, !text.isEmpty, let raw = try? JSONValue.parse(text) else { return Preferences() }
    return normalize(raw)
  }

  /// readPreferences' checks, on a parsed value.
  public static func normalize(_ raw: JSONValue) -> Preferences {
    var out = Preferences()
    guard raw.isTruthy, case .object(let object) = raw else { return out }
    func string(_ key: String) -> String? { object[key]?.stringValue }
    if let v = string("sky").flatMap(SkyChoice.init(rawValue:)) { out.sky = v }
    if let v = string("accent").flatMap(Accent.init(rawValue:)) { out.accent = v }
    if let v = string("contrast").flatMap(ContrastChoice.init(rawValue:)) { out.contrast = v }
    if let v = string("density").flatMap(Density.init(rawValue:)) { out.density = v }
    if let v = string("period").flatMap(Period.init(rawValue:)) { out.period = v }
    if let v = string("sidebar").flatMap(Sidebar.init(rawValue:)) { out.sidebar = v }
    if let v = string("locale").flatMap(LocaleChoice.init(rawValue:)) { out.locale = v }
    if let v = string("weekStart").flatMap(WeekStart.init(rawValue:)) { out.weekStart = v }
    if let v = object["liveSky"]?.boolValue { out.liveSky = v }
    // What an earlier version stored: `theme` was light, dark or the
    // system's, and `sky` was the switch for the live hillside. A theme that
    // was picked becomes the sky that looks like it, and the switch keeps
    // its meaning.
    if string("sky").flatMap(SkyChoice.init(rawValue:)) == nil {
      if string("theme") == "dark" {
        out.sky = .night
      } else if string("theme") == "light" {
        out.sky = .day
      }
      if let old = object["sky"]?.boolValue, object["liveSky"]?.boolValue == nil { out.liveSky = old }
    }
    if let v = string("periodFrom"), isDay(v) { out.periodFrom = v }
    if let v = string("periodTo"), isDay(v) { out.periodTo = v }
    // A custom period with no readable range is no period at all.
    if out.period == .custom && (out.periodFrom.isEmpty || out.periodTo.isEmpty) {
      out.period = defaultPreferences.period
    }
    return out
  }

  /// `/^\d{4}-\d{2}-\d{2}$/`: four, two and two ASCII digits.
  static func isDay(_ text: String) -> Bool {
    let bytes = Array(text.utf8)
    guard bytes.count == 10 else { return false }
    for (i, b) in bytes.enumerated() {
      if i == 4 || i == 7 {
        guard b == 0x2D else { return false }
      } else {
        guard b >= 0x30 && b <= 0x39 else { return false }
      }
    }
    return true
  }

  /// `store.setItem(PREFERENCES_KEY, JSON.stringify(prefs))`. A full or
  /// refused store costs the preference, nothing else.
  public static func writePreferences(_ prefs: Preferences, store: KeyValueStore?) {
    guard let store else { return }
    try? store.setItem(preferencesKey, prefs.jsonString())
  }

  /// The preferences as `JSON.stringify` writes them: the web's key order.
  public func jsonString() -> String {
    func quoted(_ s: String) -> String { s.jsJSONQuoted }
    let fields: [(String, String)] = [
      ("sky", quoted(sky.rawValue)), ("liveSky", liveSky ? "true" : "false"), ("accent", quoted(accent.rawValue)),
      ("contrast", quoted(contrast.rawValue)), ("density", quoted(density.rawValue)),
      ("period", quoted(period.rawValue)), ("periodFrom", quoted(periodFrom)), ("periodTo", quoted(periodTo)),
      ("sidebar", quoted(sidebar.rawValue)), ("locale", quoted(locale.rawValue)),
      ("weekStart", quoted(weekStart.rawValue)),
    ]
    return "{" + fields.map { "\(quoted($0.0)):\($0.1)" }.joined(separator: ",") + "}"
  }

  /// Hand the formats a set of preferences means to AppLocale, and return
  /// the stamp that names them. Safe to call again with the same
  /// preferences. `languages` is the device's (`Locale.preferredLanguages`),
  /// which the web reads from the browser.
  @discardableResult
  public static func applyFormats(_ prefs: Preferences?, languages: [String]?) -> String {
    let tag = AppLocale.setActiveLocale(AppLocale.resolveLocale(prefs?.locale.rawValue, languages: languages))
    AppLocale.setActiveWeekStart(AppLocale.resolveWeekStart(prefs?.weekStart.rawValue, tag: tag))
    return AppLocale.localeStamp()
  }

  /// 'normal' or 'high', from the preference and whether the system asks
  /// for more contrast.
  public static func effectiveContrast(_ contrast: ContrastChoice?, systemMore: Bool) -> Contrast {
    switch contrast {
    case .normal: return .normal
    case .high: return .high
    case .system, nil: return systemMore ? .high : .normal
    }
  }

  /// What the web stamps on <html> for the stylesheets: the sky in force
  /// (the one picked, or the clock's) and the theme it brings, the contrast
  /// in force (the preference, or the system's), the accent and the density.
  /// The rest is what the device says: whether it asks for a dark page or
  /// for more contrast, and its local hour.
  public static func rootAttributes(_ prefs: Preferences?, dark: Bool = false, moreContrast: Bool = false, hour: Double = 12)
    -> RootAttributes
  {
    let sky = Sky.skyFor(prefs?.sky, dark: dark, hour: hour)
    return RootAttributes(
      sky: sky,
      theme: Sky.themeOf(sky),
      accent: prefs?.accent ?? defaultPreferences.accent,
      contrast: effectiveContrast(prefs?.contrast, systemMore: moreContrast),
      density: prefs?.density == .compact ? .compact : .comfortable
    )
  }
}

/// The five attributes the web stamps on <html> (data-sky, data-theme,
/// data-accent, data-contrast, data-density).
public struct RootAttributes: Codable, Hashable, Sendable {
  public var sky: SkyPhase
  public var theme: Theme
  public var accent: Preferences.Accent
  public var contrast: Contrast
  public var density: Preferences.Density

  public init(sky: SkyPhase, theme: Theme, accent: Preferences.Accent, contrast: Contrast, density: Preferences.Density) {
    self.sky = sky
    self.theme = theme
    self.accent = accent
    self.contrast = contrast
    self.density = density
  }
}
