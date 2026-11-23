// src/lib/{time,sky,router,preferences} against the web code
// (ios/parity/cases/core.{time,sky,router,preferences}.js).

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

@Suite struct TimeParity {
  /// The web's `toMs` input as the Swift overloads take it.
  func time(_ value: JSONValue, _ zone: TimeZone) -> Double {
    Time.toMs(value, timeZone: zone)
  }

  @Test func formatDateShort() throws {
    for c in try Parity.cases("core.time", fn: "formatDateShort") {
      let tz = zone(c)
      let locale = c["locale"].stringValue
      let actual: String
      switch c["date"] {
      case .string(let text): actual = Time.formatDateShort(text, locale: locale, timeZone: tz)
      case .number(let ms): actual = Time.formatDateShort(ms, locale: locale, timeZone: tz)
      default: actual = Time.formatDateShort(time(c["date"], tz), locale: locale, timeZone: tz)
      }
      let d = Parity.diff(.string(actual), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func relativeTime() throws {
    for c in try Parity.cases("core.time", fn: "relativeTime") {
      let tz = zone(c)
      let now = time(c["now"], tz)
      let actual: String
      if case .string(let text) = c["date"] {
        actual = Time.relativeTime(text, now: now, locale: "en-GB", timeZone: tz)
      } else {
        actual = Time.relativeTime(time(c["date"], tz), now: now, locale: "en-GB", timeZone: tz)
      }
      let d = Parity.diff(.string(actual), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func dateOverloadsAgree() {
    let tz = TimeZone(identifier: "America/New_York")!
    let now = Date(timeIntervalSince1970: 1_794_502_800)  // 2026-11-12T15:00:00-05:00
    let then = now.addingTimeInterval(-5 * 60)
    #expect(Time.relativeTime(then, now: now, locale: "en-US", timeZone: tz) == "5m ago")
    #expect(Time.formatDateShort(then, locale: "en-US", timeZone: tz) == "Nov 12, 2026")
  }
}

@Suite struct SkyParity {
  @Test func constants() throws {
    let c = try Parity.cases("core.sky", fn: "constants")[0]
    let actual: JSONValue = [
      "SKY_PHASES": .array(Sky.skyPhases.map { .string($0.rawValue) }),
      "SKY_CHOICES": .array(Sky.skyChoices.map { .string($0.rawValue) }),
    ]
    #expect(Parity.diff(actual, c.output) == nil)
  }

  @Test func phaseAtHour() throws {
    for c in try Parity.cases("core.sky", fn: "phaseAtHour") {
      let d = Parity.diff(.string(Sky.phaseAtHour(c.input["hour"]).rawValue), c.output)
      #expect(d == nil, "\(c) \(c["hour"]): \(d ?? "")")
    }
  }

  @Test func skyFor() throws {
    for c in try Parity.cases("core.sky", fn: "skyFor") {
      let choice = c["choice"].stringValue.flatMap(SkyChoice.init(rawValue:))
      let actual = Sky.skyFor(choice, dark: c["dark"].boolValue ?? false, hour: c["hour"].doubleValue ?? 12)
      let d = Parity.diff(.string(actual.rawValue), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
    for c in try Parity.cases("core.sky", fn: "skyForDefaults") {
      let choice = c["choice"].stringValue.flatMap(SkyChoice.init(rawValue:))
      let d = Parity.diff(.string(Sky.skyFor(choice).rawValue), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func themeOf() throws {
    for c in try Parity.cases("core.sky", fn: "themeOf") {
      let sky = c["sky"].stringValue.flatMap(SkyPhase.init(rawValue:))
      let d = Parity.diff(.string(Sky.themeOf(sky).rawValue), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func skyColor() throws {
    for c in try Parity.cases("core.sky", fn: "skyColor") {
      let sky = c["sky"].stringValue.flatMap(SkyPhase.init(rawValue:))
      // Only 'high' is high; 'system', a missing value and the rest are normal.
      let contrast = c["contrast"].stringValue.flatMap(Contrast.init(rawValue:)) ?? .normal
      let d = Parity.diff(.string(Sky.skyColor(sky, contrast: contrast)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func hourOf() throws {
    for c in try Parity.cases("core.sky", fn: "hourOf") {
      let d = Parity.diff(.number(Sky.hourOf(ms: c["time"].doubleValue ?? 0, timeZone: zone(c))), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }
}

@Suite struct RouterParity {
  @Test func pathParts() throws {
    for c in try Parity.cases("core.router", fn: "pathParts") {
      let actual: JSONValue
      do {
        actual = .array(try Router.pathParts(c["path"].stringValue).map(JSONValue.string))
      } catch {
        actual = ["$throws": .string("\(error)")]
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func hrefFor() throws {
    for c in try Parity.cases("core.router", fn: "hrefFor") {
      let actual = Router.hrefFor(
        c["to"].stringValue ?? "", currentSearch: c["currentSearch"].stringValue ?? "",
        keepQuery: c["keepQuery"].boolValue ?? true)
      let d = Parity.diff(.string(actual), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }
}

@Suite struct PreferencesParity {
  @Test func constants() throws {
    let c = try Parity.cases("core.preferences", fn: "constants")[0]
    let actual: JSONValue = [
      "PREFERENCES_KEY": .string(Preferences.preferencesKey),
      "ACCENT_CHOICES": .array(Preferences.accentChoices.map { .string($0.rawValue) }),
      "SKY_CHOICES": .array(Preferences.skyChoices.map { .string($0.rawValue) }),
      "DEFAULT_PREFERENCES": try JSONValue(encoding: Preferences.defaultPreferences),
    ]
    let d = Parity.diff(actual, c.output, strictNulls: true)
    #expect(d == nil, "\(d ?? "")")
  }

  @Test func readPreferences() throws {
    for c in try Parity.cases("core.preferences", fn: "readPreferences") {
      let store = InMemoryKeyValueStore()
      if let stored = c["stored"].stringValue { try store.setItem(Preferences.preferencesKey, stored) }
      let actual = Preferences.readPreferences(store: store)
      let d = Parity.diff(encoding: actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c["stored"]): \(d ?? "")")
    }
    let none = try Parity.cases("core.preferences", fn: "readPreferencesNoStore")[0]
    #expect(Parity.diff(encoding: Preferences.readPreferences(store: nil), none.output) == nil)
  }

  @Test func effectiveContrast() throws {
    for c in try Parity.cases("core.preferences", fn: "effectiveContrast") {
      let choice = c["contrast"].stringValue.flatMap(Preferences.ContrastChoice.init(rawValue:))
      let actual = Preferences.effectiveContrast(choice, systemMore: c["systemMore"].boolValue ?? false)
      let d = Parity.diff(.string(actual.rawValue), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  /// A partial preferences object as rootAttributes reads it: each field
  /// this version knows, the rest at their defaults (which rootAttributes
  /// treats exactly as it treats a missing or unknown value).
  func lenient(_ raw: JSONValue) -> Preferences? {
    guard case .object(let o) = raw else { return nil }
    var p = Preferences()
    if let v = o["sky"]?.stringValue.flatMap(SkyChoice.init(rawValue:)) { p.sky = v }
    if let v = o["accent"]?.stringValue.flatMap(Preferences.Accent.init(rawValue:)) { p.accent = v }
    if let v = o["contrast"]?.stringValue.flatMap(Preferences.ContrastChoice.init(rawValue:)) { p.contrast = v }
    if let v = o["density"]?.stringValue.flatMap(Preferences.Density.init(rawValue:)) { p.density = v }
    return p
  }

  @Test func rootAttributes() throws {
    for c in try Parity.cases("core.preferences", fn: "rootAttributes") {
      let actual = Preferences.rootAttributes(
        lenient(c["prefs"]), dark: c["dark"].boolValue ?? false,
        moreContrast: c["moreContrast"].boolValue ?? false, hour: c["hour"].doubleValue ?? 12)
      let d = Parity.diff(encoding: actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
    for c in try Parity.cases("core.preferences", fn: "rootAttributesDefaults") {
      let d = Parity.diff(encoding: Preferences.rootAttributes(lenient(c["prefs"])), c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }
}

extension ActiveFormats {
  @Suite struct PreferencesFormatsParity {
    @Test func applyFormats() throws {
      for c in try Parity.cases("core.preferences", fn: "applyFormats") {
        let prefs = Preferences.normalize(c["prefs"])
        let actual: JSONValue = withFormats {
          // Node's navigator.languages, which the web's applyFormats reads.
          let stamp = Preferences.applyFormats(prefs, languages: ["en-US"])
          return [
            "stamp": .string(stamp), "locale": .string(AppLocale.activeLocale()),
            "weekStart": .number(Double(AppLocale.activeWeekStart())),
          ]
        }
        let d = Parity.diff(actual, c.output)
        #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
      }
    }
  }
}
