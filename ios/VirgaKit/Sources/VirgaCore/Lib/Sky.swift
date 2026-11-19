// Ports src/lib/sky.js
//
// The sky behind every page. There are four: dawn, day, dusk and night. Each
// is a wash of colour at the top of the page that fades into the page's own
// ground, and night is also the dark theme: its ground is dark and its ink
// is light. Settings › Appearance keeps one, or lets the sky follow the
// clock; this is the one place that decides.

import Foundation

/// One of the four skies.
public enum SkyPhase: String, Codable, CaseIterable, Hashable, Sendable {
  case dawn, day, dusk, night
}

/// What Settings offers: the clock, or one sky kept.
public enum SkyChoice: String, Codable, CaseIterable, Hashable, Sendable {
  case clock, dawn, day, dusk, night
}

/// The theme a sky brings: night is dark, the other three are light.
public enum Theme: String, Codable, CaseIterable, Hashable, Sendable {
  case light, dark
}

/// The contrast in force: the preference, or the system's.
public enum Contrast: String, Codable, CaseIterable, Hashable, Sendable {
  case normal, high
}

public enum Sky {
  public static let skyPhases: [SkyPhase] = SkyPhase.allCases

  /// What Settings offers, the clock first.
  public static let skyChoices: [SkyChoice] = SkyChoice.allCases

  // The clock's day, in hours: dawn from five, day from eight, dusk from five
  // in the evening, night from eight. Fixed, not worked out from where the
  // sun really is: that would need the reader's location.
  static let dawnFrom: Double = 5
  static let dayFrom: Double = 8
  static let duskFrom: Double = 17
  static let nightFrom: Double = 20

  /// The sky at an hour of the local day (0 to 24, fractions welcome). An
  /// hour past midnight wraps; NaN is day.
  public static func phaseAtHour(_ hour: Double) -> SkyPhase {
    let h = (hour.truncatingRemainder(dividingBy: 24) + 24).truncatingRemainder(dividingBy: 24)
    if !h.isFinite { return .day }
    if h < dawnFrom { return .night }
    if h < dayFrom { return .dawn }
    if h < duskFrom { return .day }
    if h < nightFrom { return .dusk }
    return .night
  }

  /// `phaseAtHour` for a loosely typed hour, as `Number(hour)` reads it.
  public static func phaseAtHour(_ hour: JSONValue?) -> SkyPhase {
    phaseAtHour(hour.jsNumber)
  }

  /// The hour of the local day at a moment, with its minutes as a fraction.
  public static func hourOf(_ date: Date, timeZone: TimeZone? = nil) -> Double {
    hourOf(ms: date.timeIntervalSince1970 * 1000, timeZone: timeZone)
  }

  /// `hourOf` for a time in epoch milliseconds.
  public static func hourOf(ms: Double, timeZone: TimeZone? = nil) -> Double {
    guard let f = JSDate.fields(ms, timeZone: timeZone ?? AppLocale.activeTimeZone()) else { return .nan }
    return Double(f.hours) + Double(f.minutes) / 60
  }

  /// The sky for a setting: a sky that was picked, whatever else is so;
  /// otherwise (the clock, or nil for a setting this version doesn't know)
  /// the local time of day, except that a device set to dark stays on
  /// night: it has asked for a dark page, and night is the only sky with one.
  public static func skyFor(_ choice: SkyChoice?, dark: Bool = false, hour: Double = 12) -> SkyPhase {
    if let choice, let phase = SkyPhase(rawValue: choice.rawValue) { return phase }
    return dark ? .night : phaseAtHour(hour)
  }

  /// The theme a sky brings with it: night is dark, the other three are light.
  public static func themeOf(_ sky: SkyPhase?) -> Theme {
    sky == .night ? .dark : .light
  }

  /// The colour at the very top of a sky, for the system's own chrome, so it
  /// runs into the page. High contrast has no sky, only its flat ground.
  public static func skyColor(_ sky: SkyPhase?, contrast: Contrast = .normal) -> String {
    if contrast == .high { return sky == .night ? "#000000" : "#ffffff" }
    switch sky {
    case .dawn: return "#ffd8c4"
    case .day: return "#b9d5ff"
    case .dusk: return "#cbc5f4"
    case .night: return "#0e1a3a"
    case nil: return "#b9d5ff"
    }
  }
}
