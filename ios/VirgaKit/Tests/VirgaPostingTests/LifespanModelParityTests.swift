// lifespanModel.js, the lifespan editor's decisions, held to the web's
// output (ios/parity/cases/timers.lifespanModel.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct LifespanModelParity {
  static let f = "timers.lifespanModel"

  /// A Date's JSON: its ISO string, or null for an invalid one.
  func dateJSON(_ ms: Double?) -> JSONValue {
    guard let ms, let iso = VirgaCore.JSDate.toISOString(VirgaCore.JSDate.timeClip(ms)) else { return .null }
    return .string(iso)
  }

  @Test func constants() throws {
    let c = try TimerFixtures.cases(Self.f, "constants")[0]
    let actual: JSONValue = [
      "FOLLOWER_THRESHOLDS": json(LifespanModel.followerThresholds),
      "EXTENSION_CHOICES": json(LifespanModel.extensionChoices),
    ]
    check(actual, c, strictNulls: true)
  }

  @Test func lengths() throws {
    for c in try TimerFixtures.cases(Self.f, "patchRule") {
      let patch = (c["patch"].objectValue ?? [:]).mapValues { Optional($0) }
      check(json(LifespanModel.patchRule(c.loose("rule"), patch)), c, strictNulls: true)
    }
    for fn in ["lengthChoice", "lengthChoice (corpus)"] {
      for c in try TimerFixtures.cases(Self.f, fn) {
        check(json(LifespanModel.lengthChoice(c.loose("rule"))), c)
      }
    }
    for c in try TimerFixtures.cases(Self.f, "withLength") {
      check(json(LifespanModel.withLength(c.loose("rule"), c.loose("seconds"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withPin") {
      check(json(LifespanModel.withPin(c.loose("rule"), c.loose("iso"), timeZone: utcZone)), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "pinBounds") {
      check(outcome { json(try LifespanModel.pinBounds(from: c.ms("from"))) }, c, strictNulls: true)
    }
  }

  @Test func aPinWithoutAnOffset() throws {
    for c in try TimerFixtures.cases(Self.f, "withPin (zones)") {
      check(json(LifespanModel.withPin(c.loose("rule"), c.loose("iso"), timeZone: c.zone)), c, strictNulls: true)
    }
  }

  @Test func whatHappens() throws {
    for c in try TimerFixtures.cases(Self.f, "toggleEffect") {
      let rule = LifespanModel.toggleEffect(c.loose("rule"), c.string("action") ?? "", allow: c.loose("allow") ?? ["follower"])
      check(json(rule), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "toggleEffect (chained)") {
      var rule = SelfDestruct.normalizeTimer(JSONValue.object(["enabled": true, "lifespanSeconds": 3600]))
      for action in c.strings("steps") { rule = LifespanModel.toggleEffect(rule, action) }
      check(json(rule), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withAllow") {
      check(json(LifespanModel.withAllow(c.loose("rule"), c.loose("allow"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "toggleAllow") {
      let allow = try c.loose("allow").map { try $0.decode([AllowEntry].self) } ?? []
      check(json(LifespanModel.toggleAllow(allow, c.loose("entry"))), c, strictNulls: true)
    }
  }

  @Test func conditions() throws {
    for c in try TimerFixtures.cases(Self.f, "withMetric") {
      let rule = LifespanModel.withMetric(c.loose("rule"), c.string("metric") ?? "", c["patch"])
      check(json(rule), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withConditions") {
      check(json(LifespanModel.withConditions(c.loose("rule"), c["patch"].objectValue ?? [:])), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withQuoteFilter") {
      check(json(LifespanModel.withQuoteFilter(c.loose("rule"), c.loose("patch") ?? [:])), c, strictNulls: true)
    }
  }

  @Test func theNotesUnderTheRule() throws {
    for c in try TimerFixtures.cases(Self.f, "editorNotes") {
      let notes = LifespanModel.editorNotes(
        c.loose("rule"), fit: LifespanEditorFit(json: c.loose("fit")), publishAt: c.string("publishAt"),
        limits: c.loose("limits"), holds: c.loose("holds"), countFrom: c.string("countFrom") ?? "goesUp",
        now: c.ms("now"), locale: "en-US", timeZone: utcZone)
      check(json(notes), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "editorNotes (zones)") {
      let notes = LifespanModel.editorNotes(
        c.loose("rule"), publishAt: c.string("publishAt"), now: c.ms("now"), locale: c.string("locale"),
        timeZone: c.zone)
      check(json(notes), c, strictNulls: true)
    }
  }

  /// A rule whose pin has no offset is read in the zone the notes are said
  /// in, whatever the active zone is.
  @Test func aRulesPinWithoutAnOffsetIsReadInTheGivenZone() throws {
    for c in try TimerFixtures.cases(Self.f, "editorNotes (local pins)") {
      let notes = LifespanModel.editorNotes(
        c.loose("rule"), publishAt: c.string("publishAt"), now: c.ms("now"), locale: c.string("locale"),
        timeZone: c.zone)
      check(json(notes), c, strictNulls: true)
    }
  }

  @Test func listsAndAPostThatIsOut() throws {
    for c in try TimerFixtures.cases(Self.f, "curateLists") {
      check(json(LifespanModel.curateLists(c.loose("lists"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "firstActAt") {
      check(dateJSON(LifespanModel.firstActAt(c.loose("rule"), startedAt: c.ms("startedAt"), now: c.ms("now"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerStart") {
      let start = LifespanModel.timerStart(
        c.loose("rule"), start: c.string("start") ?? "now", postedAt: c.string("postedAt"), now: c.ms("now"),
        timeZone: utcZone)
      check(json(start), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "timerStart (zones)") {
      let start = LifespanModel.timerStart(
        c.loose("rule"), start: c.string("start") ?? "now", postedAt: c.string("postedAt"), now: c.ms("now"),
        timeZone: c.zone)
      check(json(start), c, strictNulls: true)
    }
  }
}
