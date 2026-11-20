// The timer model, the lifespan editor's model and the timer service's
// pure helpers over seeded random inputs (ios/parity/cases/timers.fuzz.js):
// rules, conditions, effects, fits, rows, limits and failures in every
// loose shape, held to what the web computed for each.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct TimerFuzzParity {
  static let f = "timers.fuzz"

  func each(_ fn: String, _ body: (ParityCase) throws -> Void) throws {
    for c in try TimerFixtures.cases(Self.f, fn) { try body(c) }
  }

  @Test func normalizing() throws {
    try each("normalizeTimer") { c in
      check(json(SelfDestruct.normalizeTimer(c.loose("timer"))), c, strictNulls: true)
    }
    try each("normalizeTimer (twice)") { c in
      check(json(SelfDestruct.normalizeTimer(SelfDestruct.normalizeTimer(c.loose("timer")))), c, strictNulls: true)
    }
    try each("normalizeConditions") { c in
      check(json(SelfDestruct.normalizeConditions(c.loose("conditions"))), c, strictNulls: true)
    }
    try each("normalizeEffects") { c in
      check(json(SelfDestruct.normalizeEffects(c.loose("effects"))), c, strictNulls: true)
    }
    try each("clauseCountKey") { c in
      check(SelfDestruct.clauseCountKey(c.loose("clause")) ?? .null, c, strictNulls: true)
    }
    try each("unreadableRuleParts") { c in
      check(json(SelfDestruct.unreadableRuleParts(c.loose("timer"))), c)
    }
    try each("readStoredTimer") { c in
      check(json(SelfDestruct.readStoredTimer(c.loose("timer"))), c, strictNulls: true)
    }
    try each("defaultRuleFromSettings") { c in
      check(json(SelfDestruct.defaultRuleFromSettings(c.loose("lifespan"))), c, strictNulls: true)
    }
  }

  @Test func changingAndFitting() throws {
    try each("fitTimerToPost") { c in
      check(json(SelfDestruct.fitTimerToPost(c.loose("timer"), c.fit)), c, strictNulls: true)
    }
    try each("describeFitChange") { c in
      check(json(SelfDestruct.describeFitChange(c.loose("timer"), c.fit)), c)
    }
    try each("keepHiddenRuleParts") { c in
      check(json(SelfDestruct.keepHiddenRuleParts(c.loose("edited"), c.loose("stored"), c.fit)), c, strictNulls: true)
    }
    try each("sameTimer") { c in
      check(json(SelfDestruct.sameTimer(c.loose("a"), c.loose("b"))), c)
    }
    try each("withScheduledGateChange") { c in
      let t = SelfDestruct.withScheduledGateChange(c.loose("timer"), c.string("action") ?? "", c["on"].isTruthy)
      check(json(t), c, strictNulls: true)
    }
    try each("withScheduledGateLifespan") { c in
      check(json(SelfDestruct.withScheduledGateLifespan(c.loose("timer"), c.loose("seconds"))), c, strictNulls: true)
    }
    try each("scheduledGateChange") { c in
      check(json(SelfDestruct.scheduledGateChange(c.loose("timer"))), c, strictNulls: true)
    }
    try each("withEffect") { c in
      let effects = SelfDestruct.withEffect(
        c.loose("effects"), c.string("action") ?? "", c["on"].isTruthy, c.loose("extra") ?? [:])
      check(json(effects), c, strictNulls: true)
    }
    try each("withoutEffects") { c in
      check(json(SelfDestruct.withoutEffects(c.loose("timer"), c.strings("actions"))), c, strictNulls: true)
    }
    try each("withoutConditions") { c in
      check(json(SelfDestruct.withoutConditions(c.loose("timer"))), c, strictNulls: true)
    }
  }

  @Test func pinsAndPublishing() throws {
    try each("normalizeDeleteAt") { c in
      check(json(SelfDestruct.normalizeDeleteAt(c.loose("value"), now: c.ms("now"), timeZone: utcZone)), c, strictNulls: true)
    }
    try each("pinnedDeadlineStatus") { c in
      check(json(SelfDestruct.pinnedDeadlineStatus(c.loose("timer"), c.ms("now"))), c)
    }
    try each("toWireSpec") { c in
      check(json(SelfDestruct.toWireSpec(c.loose("timer"), c.ms("now"))), c, strictNulls: true)
    }
    try each("immediateTimerToSend") { c in
      check(json(SelfDestruct.immediateTimerToSend(c.loose("timer"), c.fit, now: c.ms("now"))), c, strictNulls: true)
    }
    try each("scheduledTimerToSend") { c in
      let sent = SelfDestruct.scheduledTimerToSend(
        c.loose("timer"), fit: c.fit, publishAt: c.ms("publishAt"), now: c.ms("clock"), locale: "en-US",
        timeZone: utcZone)
      check(json(sent), c, strictNulls: true)
    }
    try each("scheduledRowTimerProblem") { c in
      let problem = SelfDestruct.scheduledRowTimerProblem(
        c.loose("row"), c.loose("whenISO"), now: c.ms("clock"), locale: "en-US", timeZone: utcZone)
      check(json(problem), c)
    }
    try each("timerAdjustmentNote") { c in
      check(json(SelfDestruct.timerAdjustmentNote(c.string("adjusted"), c.loose("effects"))), c)
    }
    try each("restoreSessionDraftTimer") { c in
      check(json(SelfDestruct.restoreSessionDraftTimer(c.loose("saved"), now: c.ms("now"))), c, strictNulls: true)
    }
    try each("draftTimerNote") { c in
      check(json(SelfDestruct.draftTimerNote(c.loose("rule"), c["touched"].isTruthy, c.loose("defaults"))), c)
    }
  }

  @Test func words() throws {
    try each("describeTimer") { c in
      let said = SelfDestruct.describeTimer(
        c.loose("timer"), now: c.ms("now"), from: c.string("from") ?? "goesUp", locale: c.string("locale"),
        timeZone: c.zone)
      check(json(said), c)
    }
    try each("timerChipLabel") { c in
      let said = SelfDestruct.timerChipLabel(
        c.loose("timer"), now: c.ms("now"), locale: c.string("locale"), timeZone: c.zone)
      check(json(said), c)
    }
    try each("describeFrom") { c in
      check(json(SelfDestruct.describeFrom(c.loose("clause"), locale: c.string("locale"))), c)
    }
    try each("describeAllow") { c in
      check(json(SelfDestruct.describeAllow(c.loose("entries"))), c)
    }
    try each("scheduledTimerProblem") { c in
      let said = SelfDestruct.scheduledTimerProblem(
        c.loose("timer"), c.ms("publishAt"), now: c.ms("clock"), locale: c.string("locale"), timeZone: c.zone)
      check(json(said), c)
    }
  }

  @Test func theListAndTheSlots() throws {
    try each("evaluateConditions") { c in
      check(json(SelfDestruct.evaluateConditions(c.loose("conditions"), c.loose("counts"))), c, strictNulls: true)
    }
    try each("readCounts") { c in
      check(SelfDestruct.readCounts(c.loose("counts")).json, c, strictNulls: true)
    }
    try each("groupTimers") { c in
      let groups = SelfDestruct.groupTimers(c["rows"].arrayValue, history: c["history"].isTruthy, timeZone: utcZone)
      check(json(groups), c, strictNulls: true)
    }
    try each("waitingTimerRows") { c in
      check(json(SelfDestruct.waitingTimerRows(c["rows"].arrayValue, timeZone: utcZone)), c, strictNulls: true)
    }
    try each("timerBucket") { c in
      check(json(SelfDestruct.timerBucket(c.loose("timer"))), c)
    }
    try each("timerUsage") { c in
      let usage = SelfDestruct.timerUsage(
        liveRows: c["liveRows"].arrayValue ?? [], scheduledRows: c["scheduledRows"].arrayValue ?? [],
        exceptScheduledId: c.loose("exceptScheduledId"))
      check(json(usage), c, strictNulls: true)
    }
    try each("timerRoomProblem") { c in
      check(json(SelfDestruct.timerRoomProblem(c.loose("rule"), c.loose("limits"), holds: c.loose("holds"))), c)
    }
    try each("timerSlotRefusal") { c in
      check(json(SelfDestruct.timerSlotRefusal(c.loose("payload"))), c)
    }
  }

  @Test func theLifespanEditor() throws {
    try each("lengthChoice") { c in
      check(json(LifespanModel.lengthChoice(c.loose("rule"))), c)
    }
    try each("patchRule") { c in
      let patch = (c["patch"].objectValue ?? [:]).mapValues { Optional($0) }
      check(json(LifespanModel.patchRule(c.loose("rule"), patch)), c, strictNulls: true)
    }
    try each("withPin") { c in
      check(json(LifespanModel.withPin(c.loose("rule"), c.loose("iso"), timeZone: utcZone)), c, strictNulls: true)
    }
    try each("toggleEffect") { c in
      let rule = LifespanModel.toggleEffect(
        c.loose("rule"), c.string("action") ?? "", allow: c.loose("allow") ?? ["follower"])
      check(json(rule), c, strictNulls: true)
    }
    try each("withAllow") { c in
      check(json(LifespanModel.withAllow(c.loose("rule"), c.loose("allow"))), c, strictNulls: true)
    }
    try each("toggleAllow") { c in
      let allow = try c.loose("allow").map { try $0.decode([AllowEntry].self) } ?? []
      check(json(LifespanModel.toggleAllow(allow, c.loose("entry"))), c, strictNulls: true)
    }
    try each("withMetric") { c in
      check(json(LifespanModel.withMetric(c.loose("rule"), c.string("metric") ?? "", c["patch"])), c, strictNulls: true)
    }
    try each("withConditions") { c in
      check(json(LifespanModel.withConditions(c.loose("rule"), c["patch"].objectValue ?? [:])), c, strictNulls: true)
    }
    try each("withQuoteFilter") { c in
      check(json(LifespanModel.withQuoteFilter(c.loose("rule"), c.loose("patch") ?? [:])), c, strictNulls: true)
    }
    try each("editorNotes") { c in
      let notes = LifespanModel.editorNotes(
        c.loose("rule"), fit: LifespanEditorFit(json: c.loose("fit")), publishAt: c.string("publishAt"),
        limits: c.loose("limits"), holds: c.loose("holds"), countFrom: c.string("countFrom") ?? "goesUp",
        now: c.ms("now"), locale: "en-US", timeZone: utcZone)
      check(json(notes), c, strictNulls: true)
    }
    try each("curateLists") { c in
      check(json(LifespanModel.curateLists(c.loose("lists"))), c, strictNulls: true)
    }
    try each("firstActAt") { c in
      let at = LifespanModel.firstActAt(c.loose("rule"), startedAt: c.ms("startedAt"), now: c.ms("now"))
      let said: JSONValue = at.flatMap { VirgaCore.JSDate.toISOString($0) }.map(JSONValue.string) ?? .null
      check(said, c)
    }
    try each("timerStart") { c in
      let start = LifespanModel.timerStart(
        c.loose("rule"), start: c.string("start") ?? "now", postedAt: c.string("postedAt"), now: c.ms("now"),
        timeZone: utcZone)
      check(json(start), c, strictNulls: true)
    }
  }

  @Test func theServiceHelpers() throws {
    try each("timerSnippet") { c in
      check(json(TimerService.timerSnippet(c.loose("text"))), c)
    }
    try each("error classes") { c in
      let error = scriptedError(c["error"])
      let actual: JSONValue = [
        "unavailable": .bool(TimerService.isTimersUnavailableError(error)),
        "unsupported": .bool(TimerService.isTimersUnsupported(error)),
        "unknown": .bool(TimerService.isArmOutcomeUnknown(error)),
        "refusal": .bool(TimerService.isDefiniteArmRefusal(error)),
      ]
      check(actual, c, strictNulls: true)
    }
    try each("timerDidForUri") { c in
      check(json(TimerService.timerDidForUri(c.loose("uri"))), c)
    }
    try each("timerPostUrl") { c in
      check(json(TimerService.timerPostUrl(c.loose("row"))), c)
    }
  }
}
