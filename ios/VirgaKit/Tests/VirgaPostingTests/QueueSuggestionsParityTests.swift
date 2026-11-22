// schedule/queueSuggestions.js held to scheduling.queueSuggestions: best
// times as weekly slots, and placing them in a week.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct QueueSuggestionsParity {
  static let f = "scheduling.queueSuggestions"

  @Test func suggestionsFromBestTimes() throws {
    for c in try cases(Self.f, "suggestionsFromBestTimes") {
      let input = c.input.objectValue ?? [:]
      let block: JSONValue? = input.keys.contains("block") ? input["block"] : 1
      check(outcome { json(try QueueSuggestions.suggestionsFromBestTimes(input["best"] ?? [], block)) }, c)
    }
  }

  @Test func missingSuggestions() throws {
    for c in try cases(Self.f, "missingSuggestions") {
      check(
        outcome { .array(try QueueSuggestions.missingSuggestions(c.input["schedule"], c.input["suggestions"] ?? [])) },
        c, strictNulls: true)
    }
  }

  @Test func mergeSuggestionsIntoSchedule() throws {
    for c in try cases(Self.f, "mergeSuggestionsIntoSchedule") {
      check(
        outcome { try QueueSuggestions.mergeSuggestionsIntoSchedule(c.input["schedule"], c.input["suggestions"] ?? []) },
        c, strictNulls: true)
    }
  }

  @Test func scheduleFromSuggestions() throws {
    for c in try cases(Self.f, "scheduleFromSuggestions") {
      check(
        outcome {
          try QueueSuggestions.scheduleFromSuggestions(
            c.input["suggestions"] ?? [], c.input["timezone"], localZone: ComposerFixtures.zone(c))
        }, c, strictNulls: true)
    }
  }

  @Test func typedForms() {
    let picks = QueueSuggestions.suggestionsFromBestTimes([(day: 0, col: 9), (day: 6, col: 10)], 2)
    #expect(picks == [QueueSuggestion(dayKey: "mon", time: "18:00"), QueueSuggestion(dayKey: "sun", time: "20:00")])
    let week: JSONValue = ["timezone": "Europe/Paris", "slots": ["mon": ["18:00"]]]
    #expect(QueueSuggestions.missingSuggestions(week, picks) == [QueueSuggestion(dayKey: "sun", time: "20:00")])
    let merged = QueueSuggestions.mergeSuggestionsIntoSchedule(week, picks)
    #expect(merged["slots"]?["sun"] == ["20:00"])
    #expect(merged["timezone"] == "Europe/Paris")
    let fresh = QueueSuggestions.scheduleFromSuggestions(picks, localZone: TimeZone(identifier: "Asia/Kolkata")!)
    #expect(fresh["timezone"] == "Asia/Calcutta")
    #expect(fresh["slots"]?["tue"] == [])
  }
}
