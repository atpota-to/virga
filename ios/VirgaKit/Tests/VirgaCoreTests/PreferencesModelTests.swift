// PreferencesModel (the web's PreferencesProvider) and writePreferences.
// The model applies the formats, which are global, so these run inside
// ActiveFormats, one at a time.

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

/// A clock the test moves.
final class TestClock: Sendable {
  let current: Locked<Date>
  init(_ date: Date) { current = Locked(date) }
  func set(_ date: Date) { current.set(date) }
  var now: @Sendable () -> Date { { [current] in current.wrappedValue } }
}

extension ActiveFormats {
  @Suite struct PreferencesModelTests {
    let utc = TimeZone(identifier: "UTC")!
    /// 2026-11-14T12:00:00Z: midday, a day sky.
    let noon = Date(timeIntervalSince1970: 1_794_657_600)

    @MainActor
    func model(_ stored: String? = nil, languages: [String] = ["en-US"], clock: TestClock? = nil) throws
      -> (PreferencesModel, InMemoryKeyValueStore)
    {
      let store = InMemoryKeyValueStore()
      if let stored { try store.setItem(Preferences.preferencesKey, stored) }
      let clock = clock ?? TestClock(noon)
      let model = PreferencesModel(store: store, languages: languages, timeZone: utc, now: clock.now)
      return (model, store)
    }

    @Test @MainActor func startsFromTheStoreAndAppliesTheFormats() throws {
      defer { withFormats {} }
      let (model, _) = try model(#"{"sky":"dusk","locale":"en-GB","weekStart":"sunday","accent":"teal"}"#)
      #expect(model.prefs.sky == .dusk)
      #expect(model.prefs.accent == .teal)
      #expect(model.formats == "en-GB/0")
      #expect(AppLocale.activeLocale() == "en-GB")
      #expect(AppLocale.activeWeekStart() == 0)
      #expect(AppLocale.activeTimeZone() == utc)
      #expect(model.rootAttributes == RootAttributes(sky: .dusk, theme: .light, accent: .teal, contrast: .normal, density: .comfortable))
    }

    @Test @MainActor func emptyStoreIsTheDefaults() throws {
      defer { withFormats {} }
      let (model, store) = try model()
      #expect(model.prefs == Preferences.defaultPreferences)
      #expect(model.formats == "en-US/0", "en-US follows the region, whose week starts on Sunday")
      #expect(store.snapshot.isEmpty, "reading writes nothing")
    }

    @Test @MainActor func aPreferenceIsWrittenInTheWebsJSON() throws {
      defer { withFormats {} }
      let (model, store) = try model()
      model.setPref(\.accent, .rose)
      let written = try #require(store.getItem(Preferences.preferencesKey))
      #expect(written.hasPrefix(#"{"sky":"clock","liveSky":false,"accent":"rose","#))
      #expect(Preferences.readPreferences(raw: written) == model.prefs)
    }

    @Test @MainActor func aCustomPeriodIsOneWrite() throws {
      defer { withFormats {} }
      let (model, store) = try model()
      model.setPrefs {
        $0.period = .custom
        $0.periodFrom = "2026-10-01"
        $0.periodTo = "2026-10-31"
      }
      let read = Preferences.readPreferences(store: store)
      #expect(read.period == .custom && read.periodFrom == "2026-10-01" && read.periodTo == "2026-10-31")
    }

    @Test @MainActor func changingTheFormatsChangesTheStamp() throws {
      defer { withFormats {} }
      let (model, _) = try model()
      let before = model.formats
      model.setPref(\.locale, .enDE)
      #expect(model.formats == "en-DE/1")
      #expect(model.formats != before)
      #expect(AppLocale.formatNumber(1234.5) == "1.234,5")
      model.setPref(\.weekStart, .saturday)
      #expect(model.formats == "en-DE/6")
      model.setPref(\.density, .compact)
      #expect(model.formats == "en-DE/6", "a change that isn't a format leaves the stamp alone")
    }

    @Test @MainActor func theSystemLocaleFollowsTheDevicesLanguages() throws {
      defer { withFormats {} }
      let (model, _) = try model(languages: ["de-DE"])
      #expect(model.formats == "en-DE/1")
      model.languages = ["en-AU"]
      #expect(model.formats == "en-AU/1")
      #expect(AppLocale.activeLocale() == "en-AU")
    }

    @Test @MainActor func theSkyFollowsTheClockOnlyWhenThePhaseChanges() throws {
      defer { withFormats {} }
      let clock = TestClock(noon)
      let (model, _) = try model(clock: clock)
      #expect(model.watchesClock)
      #expect(model.effectiveSky == .day)
      #expect(model.hour == 12)
      clock.set(noon.addingTimeInterval(30 * 60))  // 12:30, still day
      model.lookAtClock()
      #expect(model.hour == 12, "a minute that changes nothing moves nothing")
      clock.set(noon.addingTimeInterval(5.5 * 3600))  // 17:30, dusk
      model.lookAtClock()
      #expect(model.hour == 17.5)
      #expect(model.effectiveSky == .dusk)
      #expect(model.skyColor == "#cbc5f4")
    }

    @Test @MainActor func aPickedSkyStopsWatchingAndTheClockPicksUpWhereItIs() throws {
      defer { withFormats {} }
      let clock = TestClock(noon)
      let (model, _) = try model(clock: clock)
      model.setPref(\.sky, .night)
      #expect(!model.watchesClock)
      #expect(model.effectiveTheme == .dark)
      clock.set(noon.addingTimeInterval(9 * 3600))  // 21:00
      model.lookAtClock()
      #expect(model.hour == 12, "not watching")
      model.setPref(\.sky, .clock)
      #expect(model.hour == 21, "switching to the clock looks at once")
      #expect(model.effectiveSky == .night)
    }

    @Test @MainActor func theDeviceDecidesWhatTheSystemChoicesMean() throws {
      defer { withFormats {} }
      let (model, _) = try model()
      model.systemDark = true
      #expect(model.effectiveSky == .night, "the clock on a dark device stays on night")
      model.systemMoreContrast = true
      #expect(model.effectiveContrast == .high)
      #expect(model.skyColor == "#000000")
      model.setPref(\.contrast, .normal)
      #expect(model.effectiveContrast == .normal)
      model.setPref(\.sky, .dawn)
      #expect(model.effectiveSky == .dawn, "a picked sky wins over a dark device")
    }

    @Test @MainActor func aRefusedStoreCostsOnlyThePreference() throws {
      defer { withFormats {} }
      let (model, store) = try model()
      store.refusesWrites = true
      model.setPref(\.sidebar, .collapsed)
      #expect(model.prefs.sidebar == .collapsed)
      #expect(store.getItem(Preferences.preferencesKey) == nil)
    }

    @Test @MainActor func reloadReadsTheStoreAgain() throws {
      defer { withFormats {} }
      let (model, store) = try model()
      try store.setItem(Preferences.preferencesKey, #"{"locale":"en-IN","sky":"dawn"}"#)
      model.reload()
      #expect(model.prefs.sky == .dawn)
      #expect(model.formats == "en-IN/0")
    }

    @Test @MainActor func reloadingOntoTheClockLooksAtItAtOnce() throws {
      defer { withFormats {} }
      let clock = TestClock(noon)
      let (model, store) = try model(#"{"sky":"night"}"#, clock: clock)
      #expect(!model.watchesClock)
      clock.set(noon.addingTimeInterval(9 * 3600))  // 21:00
      try store.setItem(Preferences.preferencesKey, #"{"sky":"clock"}"#)
      model.reload()
      #expect(model.hour == 21, "the sky follows the clock from where it is, not from when the model was made")
      #expect(model.effectiveSky == .night)
    }

    @Test @MainActor func aModelWithNoStoreStillWorks() {
      defer { withFormats {} }
      let model = PreferencesModel(store: nil, languages: [], timeZone: utc, now: { Date(timeIntervalSince1970: 0) })
      model.setPref(\.accent, .amber)
      #expect(model.prefs.accent == .amber)
      #expect(model.hour == 0)
    }
  }
}

@Suite struct WritePreferencesParity {
  @Test func writesWhatTheWebWrites() throws {
    for c in try Parity.cases("core.preferences", fn: "writePreferences") {
      var prefs = Preferences.normalize(c["prefs"])
      // writePreferences writes what it's handed, checked or not.
      if let from = c["prefs"]["periodFrom"]?.stringValue { prefs.periodFrom = from }
      if let to = c["prefs"]["periodTo"]?.stringValue { prefs.periodTo = to }
      let store = InMemoryKeyValueStore()
      Preferences.writePreferences(prefs, store: store)
      let refusing = InMemoryKeyValueStore()
      refusing.refusesWrites = true
      Preferences.writePreferences(prefs, store: refusing)
      let d = Parity.diff(.object(store.snapshot.mapValues(JSONValue.string)), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func quotesAsJSONStringifyDoes() {
    #expect("plain".jsJSONQuoted == #""plain""#)
    #expect("a\"b\\c".jsJSONQuoted == #""a\"b\\c""#)
    #expect("\u{8}\t\n\u{C}\r".jsJSONQuoted == #""\b\t\n\f\r""#)
    #expect("\u{1}\u{1F}".jsJSONQuoted == #""\u0001\u001f""#)
    #expect("\u{2028}/👍".jsJSONQuoted == "\"\u{2028}/👍\"")
  }

  @Test func decodingIsAsLenientAsReading() throws {
    let prefs = try JSONDecoder().decode(Preferences.self, from: Data(#"{"sky":"noon","accent":"teal","theme":"dark"}"#.utf8))
    #expect(prefs.sky == .night)
    #expect(prefs.accent == .teal)
    let encoded = try JSONValue(encoding: prefs)
    #expect(encoded["sky"] == "night")
    #expect(encoded["liveSky"] == false)
  }
}
