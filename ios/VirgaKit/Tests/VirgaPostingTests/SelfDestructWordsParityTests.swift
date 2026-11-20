// selfDestruct.js's sentences, word for word, in the locales and zones the
// generator recorded them in (ios/parity/cases/timers.selfDestructWords.js).
// Each case passes its locale and zone: the active ones are global.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct SelfDestructWordsParity {
  static let f = "timers.selfDestructWords"

  func locale(_ c: ParityCase) -> String { c.string("locale") ?? "en-US" }

  @Test func phrases() throws {
    for c in try TimerFixtures.cases(Self.f, "plural") {
      check(json(SelfDestruct.plural(c.ms("n"), c.string("noun") ?? "")), c)
    }
    for c in try TimerFixtures.cases(Self.f, "formatLifespan") {
      check(json(SelfDestruct.formatLifespan(c.loose("seconds"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "describeFrom") {
      check(json(SelfDestruct.describeFrom(c.loose("clause"), locale: locale(c))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "describeAllow") {
      check(json(SelfDestruct.describeAllow(c.loose("entries"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "describeEffects") {
      check(json(SelfDestruct.describeEffects(c.loose("effects"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "describeClauses") {
      check(json(SelfDestruct.describeClauses(c.loose("conditions"), locale: locale(c))), c)
    }
  }

  @Test func typedPhrasesAreTheLooseOnes() throws {
    for c in try TimerFixtures.cases(Self.f, "describeFrom") {
      guard let clause = SelfDestruct.normalizeClause(c.loose("clause")) else { continue }
      #expect(
        SelfDestruct.describeFrom(clause, locale: locale(c)) == SelfDestruct.describeFrom(clause.json, locale: locale(c)))
    }
    for c in try TimerFixtures.cases(Self.f, "describeEffects") {
      let effect = SelfDestruct.normalizeEffects(c.loose("effects")).first { $0.action == .limitReplies }
      guard let allow = effect?.allow else { continue }
      #expect(SelfDestruct.describeAllow(allow) == SelfDestruct.describeAllow(.array(allow.map(\.json))))
    }
  }

  @Test func aPinnedTime() throws {
    for c in try TimerFixtures.cases(Self.f, "describeDeleteAt") {
      let said = SelfDestruct.describeDeleteAt(c.loose("iso"), now: c.ms("now"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
  }

  @Test func sentences() throws {
    for c in try TimerFixtures.cases(Self.f, "describeWhen") {
      let said = SelfDestruct.describeWhen(c.loose("timer"), now: c.ms("now"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
    for c in try TimerFixtures.cases(Self.f, "describeTimer") {
      let said = SelfDestruct.describeTimer(
        c.loose("timer"), now: c.ms("now"), from: c.string("from") ?? "goesUp", locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
    for c in try TimerFixtures.cases(Self.f, "describeTimer (no options)") {
      let said = SelfDestruct.describeTimer(c.loose("timer"), now: c.ms("now"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerChipLabel") {
      let said = SelfDestruct.timerChipLabel(c.loose("timer"), now: c.ms("now"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
    for c in try TimerFixtures.cases(Self.f, "describeTimer (gate changes)") {
      var t = SelfDestruct.normalizeTimer(c.loose("start") ?? ["enabled": false])
      for step in c["steps"].arrayValue ?? [] {
        t = SelfDestruct.withScheduledGateChange(t, step[0]?.stringValue ?? "", step[1]?.isTruthy ?? false)
      }
      check(json(SelfDestruct.describeTimer(t, now: c.ms("now"), locale: locale(c), timeZone: c.zone)), c)
    }
  }

  @Test func countdown() throws {
    for c in try TimerFixtures.cases(Self.f, "timeUntil") {
      check(json(SelfDestruct.timeUntil(c.loose("iso"), now: c.ms("now"), timeZone: c.zone)), c)
    }
  }

  @Test func theScheduledRefusal() throws {
    for c in try TimerFixtures.cases(Self.f, "scheduledTimerProblem") {
      let said = SelfDestruct.scheduledTimerProblem(
        c.loose("timer"), c.ms("publishAt"), now: c.ms("clock"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
  }

  /// A pin without an offset is read in the zone the sentence is said in,
  /// as the web reads it in the browser's one zone, whatever the active
  /// zone is.
  @Test func aPinWithoutAnOffsetIsReadInTheZoneItIsSaidIn() throws {
    for c in try TimerFixtures.cases(Self.f, "describeWhen (local pins)") {
      let said = SelfDestruct.describeWhen(c.loose("timer"), now: c.ms("now"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
    for c in try TimerFixtures.cases(Self.f, "describeTimer (local pins)") {
      let said = SelfDestruct.describeTimer(c.loose("timer"), now: c.ms("now"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerChipLabel (local pins)") {
      let said = SelfDestruct.timerChipLabel(c.loose("timer"), now: c.ms("now"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
    for c in try TimerFixtures.cases(Self.f, "scheduledTimerProblem (local pins)") {
      let said = SelfDestruct.scheduledTimerProblem(
        c.loose("timer"), c.ms("publishAt"), now: c.ms("clock"), locale: locale(c), timeZone: c.zone)
      check(json(said), c)
    }
  }
}
