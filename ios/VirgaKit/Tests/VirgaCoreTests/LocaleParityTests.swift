// src/lib/locale.js against the web code (ios/parity/cases/core.locale.js),
// and the locale table against the runtime it was read from
// (core.localeData.js).

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

/// Runs `body` with the active formats set, then puts the defaults back, as
/// the generator's `withFormats` does. Serialized: the formats are global.
func withFormats<T>(locale: String? = nil, weekStart: Int? = nil, _ body: () throws -> T) rethrows -> T {
  defer {
    AppLocale.setActiveLocale(AppLocale.defaultLocale)
    AppLocale.setActiveWeekStart(AppLocale.defaultWeekStart)
  }
  if let locale { AppLocale.setActiveLocale(locale) }
  if let weekStart { AppLocale.setActiveWeekStart(weekStart) }
  return try body()
}

/// Every test that changes AppLocale's module-level formats (the active
/// locale, week start and zone) runs inside this suite, one at a time, so
/// none sees another's formats. Tests elsewhere pass locales explicitly.
@Suite(.serialized) enum ActiveFormats {}

@Suite struct LocaleDataParity {
  @Test func tableIsTheRuntimes() throws {
    let table = LocaleData.table
    for (fn, value) in [
      ("formats", try JSONValue(encoding: table.formats)),
      ("names", try JSONValue(encoding: table.names)),
      ("regions", try JSONValue(encoding: table.regions)),
      ("languages", try JSONValue(encoding: table.languages)),
    ] {
      let expected = try Parity.cases("core.localeData", fn: fn)[0].output
      let d = Parity.diff(value, expected)
      #expect(
        d == nil,
        "LocaleData+Table.swift is not the runtime's \(fn): \(d ?? ""). Run `node ios/parity/locale-data.mjs`.")
    }
  }

  @Test func formatNumber() throws {
    for c in try Parity.cases("core.locale", fn: "formatNumber") {
      let numbers = (c["numbers"].arrayValue ?? []).compactMap(\.doubleValue)
      let options = c["options"]
      let min = options["minimumFractionDigits"]?.intValue ?? 0
      let max = options["maximumFractionDigits"]?.intValue ?? Swift.max(min, 3)
      let locale = c["locale"].stringValue ?? ""
      let actual = numbers.map {
        JSONValue.string(AppLocale.formatNumber($0, locale: locale, minimumFractionDigits: min, maximumFractionDigits: max))
      }
      let d = Parity.diff(.array(actual), c.output)
      #expect(d == nil, "\(c) \(locale) \(options): \(d ?? "")")
    }
  }

  @Test func formatDate() throws {
    // core.locale.js INSTANTS.
    let instants: [Double] = [
      JSDate.utc(2026, 2, 5, 9, 5, 7), JSDate.utc(2026, 10, 14, 14, 30, 45), JSDate.utc(2026, 8, 1, 0, 30, 0),
      JSDate.utc(2025, 11, 31, 23, 59, 59), JSDate.utc(1999, 0, 9, 12, 0, 0),
    ]
    let utc = TimeZone(identifier: "UTC")!
    for c in try Parity.cases("core.locale", fn: "formatDate") {
      let options = DateFormatOptions(json: c["options"])
      let locale = c["locale"].stringValue ?? ""
      let actual = instants.map {
        JSONValue.string(LocaleData.formatDate($0, options: options, locale: locale, timeZone: utc))
      }
      let d = Parity.diff(.array(actual), c.output)
      #expect(d == nil, "\(c) \(locale) \(options.key): \(d ?? "")")
    }
  }

  @Test func toLocaleStringDefaults() throws {
    let instants: [Double] = [
      JSDate.utc(2026, 2, 5, 9, 5, 7), JSDate.utc(2026, 10, 14, 14, 30, 45), JSDate.utc(2026, 8, 1, 0, 30, 0),
      JSDate.utc(2025, 11, 31, 23, 59, 59), JSDate.utc(1999, 0, 9, 12, 0, 0),
    ]
    for c in try Parity.cases("core.locale", fn: "toLocaleStrings") {
      let tz = zone(c)
      let locale = c["locale"].stringValue ?? ""
      let actual: [JSONValue] = instants.map { ms in
        [
          "date": .string(AppLocale.toLocaleDateString(ms, locale: locale, timeZone: tz)),
          "time": .string(AppLocale.toLocaleTimeString(ms, locale: locale, timeZone: tz)),
          "both": .string(AppLocale.toLocaleString(date: ms, locale: locale, timeZone: tz)),
          "weekday": .string(AppLocale.toLocaleDateString(ms, DateFormatOptions(weekday: "long"), locale: locale, timeZone: tz)),
          "hour": .string(AppLocale.toLocaleTimeString(ms, DateFormatOptions(hour: "numeric"), locale: locale, timeZone: tz)),
          "format": .string(AppLocale.formatDateTime(ms, locale: locale, timeZone: tz)),
          "short": .string(
            AppLocale.toLocaleDateString(
              ms, DateFormatOptions(year: "numeric", month: "short", day: "numeric"), locale: locale, timeZone: tz)),
        ]
      }
      let d = Parity.diff(.array(actual), c.output)
      #expect(d == nil, "\(c) \(locale) \(tz.identifier): \(d ?? "")")
    }
  }

  @Test func invalidDate() throws {
    let c = try Parity.cases("core.locale", fn: "invalidDate")[0]
    let actual: JSONValue = [
      "date": .string(AppLocale.toLocaleDateString(.nan, locale: "en-US")),
      "time": .string(AppLocale.toLocaleTimeString(.nan, locale: "en-US")),
      "both": .string(AppLocale.toLocaleString(date: .nan, locale: "en-US")),
    ]
    #expect(Parity.diff(actual, c.output) == nil)
  }
}

extension ActiveFormats {
@Suite struct AppLocaleParity {
  @Test func constants() throws {
    let c = try Parity.cases("core.locale", fn: "constants")[0]
    let actual: JSONValue = [
      "DEFAULT_LOCALE": .string(AppLocale.defaultLocale),
      "DEFAULT_WEEK_START": .number(Double(AppLocale.defaultWeekStart)),
      "LOCALE_CHOICES": .array(AppLocale.localeChoices.map(JSONValue.string)),
      "WEEK_START_CHOICES": .array(AppLocale.weekStartChoices.map { [.string($0.name), .number(Double($0.day))] }),
    ]
    #expect(Parity.diff(actual, c.output) == nil)
  }

  @Test func initial() throws {
    let c = try Parity.cases("core.locale", fn: "initial")[0]
    let actual: JSONValue = withFormats {
      [
        "activeLocale": .string(AppLocale.activeLocale()),
        "activeWeekStart": .number(Double(AppLocale.activeWeekStart())),
        "uses12Hour": .bool(AppLocale.uses12Hour()),
        "localeStamp": .string(AppLocale.localeStamp()),
      ]
    }
    #expect(Parity.diff(actual, c.output) == nil)
  }

  @Test func setActiveLocale() throws {
    for c in try Parity.cases("core.locale", fn: "setActiveLocale") {
      let tag = c["tag"].stringValue
      let actual: JSONValue = withFormats {
        let result = AppLocale.setActiveLocale(tag)
        var out: JSONValue = [
          "result": .string(result),
          "activeLocale": .string(AppLocale.activeLocale()),
          "localeStamp": .string(AppLocale.localeStamp()),
        ]
        // Formats are compared for English tags only (core.locale.js, englishOrInvalid).
        if tag.flatMap(LanguageTag.init).map({ $0.language == "en" }) ?? true {
          out["uses12Hour"] = .bool(AppLocale.uses12Hour())
        }
        return out
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["tag"]): \(d ?? "")")
    }
  }

  @Test func setActiveWeekStart() throws {
    for c in try Parity.cases("core.locale", fn: "setActiveWeekStart") {
      let actual: JSONValue = withFormats {
        let result = AppLocale.setActiveWeekStart(c.input["day"])
        return [
          "result": .number(Double(result)),
          "activeWeekStart": .number(Double(AppLocale.activeWeekStart())),
          "localeStamp": .string(AppLocale.localeStamp()),
        ]
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c["day"]): \(d ?? "")")
    }
  }

  @Test func systemLocale() throws {
    for c in try Parity.cases("core.locale", fn: "systemLocale") {
      let languages = c["languages"].arrayValue?.compactMap(\.stringValue)
      let d = Parity.diff(.string(AppLocale.systemLocale(languages)), c.output)
      #expect(d == nil, "\(c) \(c["languages"]): \(d ?? "")")
    }
  }

  @Test func resolveLocale() throws {
    for c in try Parity.cases("core.locale", fn: "resolveLocale") {
      let languages = c["languages"].arrayValue?.compactMap(\.stringValue)
      let d = Parity.diff(.string(AppLocale.resolveLocale(c["pref"].stringValue, languages: languages)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func regionWeekStart() throws {
    for c in try Parity.cases("core.locale", fn: "regionWeekStart") {
      let d = Parity.diff(.number(Double(AppLocale.regionWeekStart(c["tag"].stringValue ?? ""))), c.output)
      #expect(d == nil, "\(c) \(c["tag"]): \(d ?? "")")
    }
  }

  @Test func resolveWeekStart() throws {
    for c in try Parity.cases("core.locale", fn: "resolveWeekStart") {
      let actual = withFormats(locale: "en-IN") {
        AppLocale.resolveWeekStart(c["pref"].stringValue, tag: c["tag"].stringValue)
      }
      let d = Parity.diff(.number(Double(actual)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func weekOrder() throws {
    for c in try Parity.cases("core.locale", fn: "weekOrder") {
      let actual = withFormats(weekStart: 6) { AppLocale.weekOrder(c["start"].intValue) }
      let d = Parity.diff(.array(actual.map { .number(Double($0)) }), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func weekdayOffset() throws {
    for c in try Parity.cases("core.locale", fn: "weekdayOffset") {
      let actual = withFormats(weekStart: 0) { AppLocale.weekdayOffset(c["day"].intValue ?? 0, c["start"].intValue) }
      let d = Parity.diff(.number(Double(actual)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func fmtInt() throws {
    for c in try Parity.cases("core.locale", fn: "fmtInt") {
      let actual = withFormats(locale: c["locale"].stringValue) { AppLocale.fmtInt(c.input["n"]) }
      let d = Parity.diff(.string(actual), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func localeSample() throws {
    for c in try Parity.cases("core.locale", fn: "localeSample") {
      let actual = AppLocale.localeSample(c["tag"].stringValue ?? "", timeZone: zone(c))
      let d = Parity.diff(.string(actual), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }
}
}
