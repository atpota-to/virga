// Ports src/lib/preferences.jsx
//
// The web's PreferencesProvider and usePreferences(), as a model the SwiftUI
// layer binds to: the stored preferences, what the device says (dark,
// more contrast, the hour), what is in force because of both (the sky,
// theme and contrast), and the formats stamp, which changes whenever the
// active formats do so the UI can draw again in the new ones.
//
// The web reads the device through media queries and a minute timer; here
// the view sets `systemDark` and `systemMoreContrast` from its environment,
// and calls `lookAtClock()` each minute while `watchesClock` is true (the
// web's useSkyHour). Nothing here reads the clock but the `now` it is given.
//
// The device's time zone is the active one (AppLocale's), as the browser's
// is on the web, where Date and Intl follow a change of the system's zone
// at once. The app tells the model of a change (`deviceZoneChanged`: a
// flight, or a new zone in Settings, while the app stays in memory), and
// the shell is drawn again in the new zone.

import Foundation
import Observation

@MainActor
@Observable
public final class PreferencesModel {
  /// The stored preferences.
  public private(set) var prefs: Preferences
  /// Whether the device asks for a dark page.
  public var systemDark: Bool
  /// Whether the device asks for more contrast.
  public var systemMoreContrast: Bool
  /// The local hour the sky follows: moved only when it moves the sky from
  /// one phase to the next, so a minute that changes nothing redraws nothing.
  public private(set) var hour: Double
  /// The formats stamp (`AppLocale.localeStamp()` after applying them).
  public private(set) var formats: String
  /// The device's languages, for the 'system' locale.
  public var languages: [String] {
    didSet { if languages != oldValue { applyFormats() } }
  }

  /// The device's zone, which is also the active one (`deviceZoneChanged`).
  public private(set) var timeZone: TimeZone

  @ObservationIgnored private let store: KeyValueStore?
  @ObservationIgnored private let now: @Sendable () -> Date
  @ObservationIgnored private let activateZone: @Sendable (TimeZone) -> Void

  /// - Parameters:
  ///   - store: where the preferences are kept (the app's key-value store).
  ///   - languages: the device's languages (`Locale.preferredLanguages`).
  ///   - timeZone: the device's zone (`TimeZone.current`); also made the
  ///     active one, as the browser's local zone is on the web.
  ///   - now: the clock.
  ///   - activateZone: makes a zone the active one (AppLocale's, which
  ///     tests leave alone).
  public init(
    store: KeyValueStore?,
    languages: [String],
    timeZone: TimeZone,
    systemDark: Bool = false,
    systemMoreContrast: Bool = false,
    now: @escaping @Sendable () -> Date = { Date() },
    activateZone: @escaping @Sendable (TimeZone) -> Void = { AppLocale.setActiveTimeZone($0) }
  ) {
    self.store = store
    self.languages = languages
    self.timeZone = timeZone
    self.now = now
    self.activateZone = activateZone
    self.systemDark = systemDark
    self.systemMoreContrast = systemMoreContrast
    let prefs = Preferences.readPreferences(store: store)
    self.prefs = prefs
    self.hour = Sky.hourOf(now(), timeZone: timeZone)
    activateZone(timeZone)
    // Before anything is drawn, as the web applies them in render.
    self.formats = Preferences.applyFormats(prefs, languages: languages)
  }

  // MARK: - In force

  public var rootAttributes: RootAttributes {
    Preferences.rootAttributes(prefs, dark: systemDark, moreContrast: systemMoreContrast, hour: hour)
  }

  /// The sky in force: the one picked, or the clock's.
  public var effectiveSky: SkyPhase { rootAttributes.sky }
  public var effectiveTheme: Theme { rootAttributes.theme }
  public var effectiveContrast: Contrast { rootAttributes.contrast }

  /// The colour at the top of the sky in force, for the system's chrome.
  public var skyColor: String { Sky.skyColor(effectiveSky, contrast: effectiveContrast) }

  /// Whether the sky follows the clock, so the view should call
  /// `lookAtClock()` each minute.
  public var watchesClock: Bool { prefs.sky == .clock }

  // MARK: - Changes

  /// One preference, written straight away.
  public func setPref<Value>(_ key: WritableKeyPath<Preferences, Value>, _ value: Value) {
    setPrefs { $0[keyPath: key] = value }
  }

  /// Several preferences in one write: a custom period is three values that
  /// only mean something together.
  public func setPrefs(_ patch: (inout Preferences) -> Void) {
    let before = prefs
    var next = prefs
    patch(&next)
    prefs = next
    Preferences.writePreferences(next, store: store)
    if next.locale != before.locale || next.weekStart != before.weekStart { applyFormats() }
    if next.sky == .clock && before.sky != .clock { lookAtClock() }
  }

  /// The web's useSkyHour `look`: the hour now, kept only when it moves the
  /// sky to another phase.
  public func lookAtClock() {
    guard watchesClock else { return }
    let current = Sky.hourOf(now(), timeZone: timeZone)
    if Sky.phaseAtHour(hour) != Sky.phaseAtHour(current) { hour = current }
  }

  /// The device has moved to another zone: it becomes the active one, and
  /// the sky looks at the clock there. Nothing changes for the zone already
  /// in force.
  public func deviceZoneChanged(_ zone: TimeZone) {
    guard zone.identifier != timeZone.identifier else { return }
    timeZone = zone
    activateZone(zone)
    lookAtClock()
  }

  /// Reads the store again (another scene or an import changed it).
  public func reload() {
    let before = prefs
    prefs = Preferences.readPreferences(store: store)
    if prefs.locale != before.locale || prefs.weekStart != before.weekStart { applyFormats() }
    // As setPrefs does: the web's useSkyHour looks at the clock as soon as
    // the sky starts following it.
    if prefs.sky == .clock && before.sky != .clock { lookAtClock() }
  }

  private func applyFormats() {
    formats = Preferences.applyFormats(prefs, languages: languages)
  }
}
