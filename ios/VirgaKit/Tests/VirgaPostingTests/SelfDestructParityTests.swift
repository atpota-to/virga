// selfDestruct.js's rule model, held to the web's output
// (ios/parity/cases/timers.selfDestruct.js and timers.selfDestructRules.js).
// Every case passes its zone and locale explicitly: the active ones are
// global, and other suites change them.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

let utcZone = TimeZone(identifier: "UTC")!

extension ParityCase {
  /// A time in epoch ms; null (the fixture's NaN) or absent is NaN.
  func ms(_ key: String) -> Double { self[key].doubleValue ?? .nan }

  /// The case's zone, UTC when it names none.
  var zone: TimeZone { string("zone").flatMap(TimeZone.init(identifier:)) ?? utcZone }

  /// A loose argument as the web was handed it (nil for `undefined`).
  func loose(_ key: String) -> JSONValue? { input[key] }

  /// `fit` read as the web's destructuring reads it.
  var fit: TimerFit { TimerFit(json: input["fit"]) }
}

@Suite struct SelfDestructNormalizersParity {
  static let f = "timers.selfDestruct"

  @Test func constants() throws {
    let c = try TimerFixtures.cases(Self.f, "constants")[0]
    let actual: JSONValue = [
      "MIN_LIFESPAN_SECONDS": json(SelfDestruct.minLifespanSeconds),
      "MAX_LIFESPAN_SECONDS": json(SelfDestruct.maxLifespanSeconds),
      "MAX_EXTENSIONS_CAP": json(SelfDestruct.maxExtensionsCap),
      "LIFESPAN_PRESETS": json(SelfDestruct.lifespanPresets),
      "DEFAULT_LIFESPAN_SECONDS": json(SelfDestruct.defaultLifespanSeconds),
      "LIFESPAN_UNITS": json(SelfDestruct.lifespanUnits),
      "CONDITION_MODES": json(SelfDestruct.conditionModes),
      "SPARE_ACTIONS": json(SelfDestruct.spareActions),
      "CONDITION_SENSES": json(SelfDestruct.conditionSenses),
      "METRICS": json(SelfDestruct.metrics),
      "METRIC_KEYS": json(SelfDestruct.metricKeys),
      "OPERATORS": json(SelfDestruct.operators),
      "OPERATOR_KEYS": json(SelfDestruct.operatorKeys),
      "MAX_CLAUSES": json(SelfDestruct.maxClauses),
      "FILTERABLE_METRICS": json(SelfDestruct.filterableMetrics),
      "ACTOR_TESTS": json(SelfDestruct.actorTests),
      "DEFAULT_FOLLOWERS_OVER": json(SelfDestruct.defaultFollowersOver),
      "EFFECTS": json(SelfDestruct.effects),
      "EFFECT_KEYS": json(SelfDestruct.effectKeys),
      "ALLOW_OPTIONS": json(SelfDestruct.allowOptions),
      "ALLOW_KEYS": json(SelfDestruct.allowKeys),
      "MAX_ALLOW_RULES": json(SelfDestruct.maxAllowRules),
      "BLUESKY_ONLY_EFFECTS": json(SelfDestruct.blueskyOnlyEffects),
      "PAST_DEADLINE_GRACE_SECONDS": json(SelfDestruct.pastDeadlineGraceSeconds),
      "TIMERS_UNAVAILABLE_NOTE": json(SelfDestruct.timersUnavailableNote),
      "EXPIRED_DRAFT_TIMER_NOTE": json(SelfDestruct.expiredDraftTimerNote),
      "TIMER_BUCKET_FEATURE": json(SelfDestruct.timerBucketFeature),
      "TIMER_SLOT_FEATURE_BUCKET": json(SelfDestruct.timerSlotFeatureBucket),
    ]
    check(actual, c, strictNulls: true)
  }

  // MARK: Lengths

  @Test func lengths() throws {
    for c in try TimerFixtures.cases(Self.f, "normalizeLifespan") {
      check(json(SelfDestruct.normalizeLifespan(c.loose("seconds"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "isPresetLifespan") {
      check(json(SelfDestruct.isPresetLifespan(c.loose("seconds"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "splitLifespan") {
      check(json(SelfDestruct.splitLifespan(c.loose("seconds"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "lifespanFromParts") {
      check(json(SelfDestruct.lifespanFromParts(c.loose("amount"), c.string("unitKey"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "maxAmountForUnit") {
      check(json(SelfDestruct.maxAmountForUnit(c.string("unitKey"))), c)
    }
  }

  // MARK: Thresholds, filters, clauses

  @Test func thresholdsFiltersAndClauses() throws {
    for c in try TimerFixtures.cases(Self.f, "normalizeThreshold") {
      check(json(SelfDestruct.normalizeThreshold(c.loose("value"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "normalizeActorFilter") {
      check(json(SelfDestruct.normalizeActorFilter(c.loose("raw"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "normalizeClause") {
      check(json(SelfDestruct.normalizeClause(c.loose("raw"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "clauseCountKey") {
      check(SelfDestruct.clauseCountKey(c.loose("clause")) ?? .null, c, strictNulls: true)
    }
  }

  @Test func typedClauseCountKeyIsTheLooseOne() throws {
    for c in try TimerFixtures.cases(Self.f, "clauseCountKey") {
      guard let clause = SelfDestruct.normalizeClause(c.loose("clause")) else { continue }
      #expect(.string(SelfDestruct.clauseCountKey(clause)) == SelfDestruct.clauseCountKey(clause.json))
    }
  }

  // MARK: Conditions

  @Test func conditions() throws {
    for c in try TimerFixtures.cases(Self.f, "normalizeConditions") {
      check(json(SelfDestruct.normalizeConditions(c.loose("conditions"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "hasClauses") {
      check(json(SelfDestruct.hasClauses(c.loose("conditions"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "clauseFor") {
      check(json(SelfDestruct.clauseFor(c.loose("conditions"), c.string("metric") ?? "")), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withClause") {
      let actual = SelfDestruct.withClause(c.loose("conditions"), c.string("metric") ?? "", c.loose("patch") ?? [:])
      check(json(actual), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withClause (chained)") {
      var conditions = TimerConditions()
      for step in c["steps"].arrayValue ?? [] {
        conditions = SelfDestruct.withClause(conditions, step[0]?.stringValue ?? "", step[1] ?? [:])
      }
      check(json(conditions), c, strictNulls: true)
    }
  }

  // MARK: Effects and allow entries

  @Test func effects() throws {
    for c in try TimerFixtures.cases(Self.f, "normalizeAllowEntry") {
      check(json(SelfDestruct.normalizeAllowEntry(c.loose("entry"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "allowEntryKey") {
      let entry = try c["entry"].decode(AllowEntry.self)
      check(json(SelfDestruct.allowEntryKey(entry)), c)
    }
    for c in try TimerFixtures.cases(Self.f, "normalizeEffect") {
      check(json(SelfDestruct.normalizeEffect(c.loose("raw"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "normalizeEffects") {
      check(json(SelfDestruct.normalizeEffects(c.loose("effects"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "effectsDelete") {
      check(json(SelfDestruct.effectsDelete(c.loose("effects"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "effectFor") {
      check(json(SelfDestruct.effectFor(c.loose("effects"), c.string("action") ?? "")), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withEffect") {
      let actual = SelfDestruct.withEffect(
        c.loose("effects"), c.string("action") ?? "", c["on"].isTruthy, c.loose("extra") ?? [:])
      check(json(actual), c, strictNulls: true)
    }
  }

  // MARK: Whole timers

  @Test func wholeTimers() throws {
    for c in try TimerFixtures.cases(Self.f, "normalizeTimer") {
      check(json(SelfDestruct.normalizeTimer(c.loose("timer"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "normalizeTimer (twice)") {
      check(json(SelfDestruct.normalizeTimer(SelfDestruct.normalizeTimer(c.loose("timer")))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withoutGateEffects") {
      check(json(SelfDestruct.withoutGateEffects(c.loose("timer"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withoutEffects") {
      check(json(SelfDestruct.withoutEffects(c.loose("timer"), c.strings("actions"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withoutConditions") {
      check(json(SelfDestruct.withoutConditions(c.loose("timer"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "composerTimerFit") {
      check(json(SelfDestruct.composerTimerFit(c.loose("options"))), c, strictNulls: true)
    }
  }

  @Test func aTimerRoundTripsThroughItsJSON() throws {
    for c in try TimerFixtures.cases(Self.f, "normalizeTimer") {
      let rule = SelfDestruct.normalizeTimer(c.loose("timer"))
      let decoded = try JSONDecoder().decode(TimerRule.self, from: JSONEncoder().encode(rule))
      #expect(decoded == rule, "\(c)")
      #expect(json(rule) == rule.json, "\(c)")
    }
  }

  // MARK: Evaluation

  @Test func evaluation() throws {
    for c in try TimerFixtures.cases(Self.f, "evaluateConditions") {
      check(json(SelfDestruct.evaluateConditions(c.loose("conditions"), c.loose("counts"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "readCounts") {
      check(SelfDestruct.readCounts(c.loose("counts")).json, c, strictNulls: true)
    }
  }

  // MARK: The timer list

  @Test func timerList() throws {
    for c in try TimerFixtures.cases(Self.f, "groupTimers") {
      let groups = SelfDestruct.groupTimers(c["rows"].arrayValue, history: c["history"].isTruthy, timeZone: utcZone)
      check(json(groups), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "groupTimers (zones)") {
      check(json(SelfDestruct.groupTimers(c["rows"].arrayValue, timeZone: c.zone)), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "compareTimers (sort)") {
      let sorted = TimerJS.v8Sorted(c["rows"].arrayValue ?? []) {
        SelfDestruct.compareTimers($0, $1, timeZone: utcZone)
      }
      check(.array(sorted.map { $0["id"] ?? .null }), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "compareTimers") {
      check(json(SelfDestruct.compareTimers(c.loose("a"), c.loose("b"), timeZone: utcZone)), c)
    }
    for c in try TimerFixtures.cases(Self.f, "waitingTimerRows") {
      check(json(SelfDestruct.waitingTimerRows(c["rows"].arrayValue, timeZone: utcZone)), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "waitingTimerRows (zones)") {
      check(json(SelfDestruct.waitingTimerRows(c["rows"].arrayValue, timeZone: c.zone)), c, strictNulls: true)
    }
  }

  // MARK: Slots

  @Test func slots() throws {
    for c in try TimerFixtures.cases(Self.f, "timerBucket") {
      check(json(SelfDestruct.timerBucket(c.loose("timer"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerUsage") {
      let options = c.loose("options")
      let usage = SelfDestruct.timerUsage(
        liveRows: options?["liveRows"].map { $0.arrayValue ?? [] } ?? [],
        scheduledRows: options?["scheduledRows"].map { $0.arrayValue ?? [] } ?? [],
        exceptScheduledId: options?["exceptScheduledId"])
      check(json(usage), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "timerSlotProblem") {
      let usage = c.loose("usage").flatMap { u -> TimerUsage? in
        guard u.isTruthy else { return nil }
        return TimerUsage(plain: u["plain"]?.intValue ?? 0, conditional: u["conditional"]?.intValue ?? 0)
      }
      let actual = SelfDestruct.timerSlotProblem(
        bucket: c.string("bucket") ?? "", limit: c["limit"].doubleValue, usage: usage)
      check(json(actual), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerSlotSentence") {
      check(json(SelfDestruct.timerSlotSentence(c.string("bucket"), c.loose("limit") ?? 1)), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerSlotRefusal") {
      check(json(SelfDestruct.timerSlotRefusal(c.loose("payload"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerRoomProblem") {
      check(json(SelfDestruct.timerRoomProblem(c.loose("rule"), c.loose("limits"), holds: c.loose("holds"))), c)
    }
  }
}

@Suite struct SelfDestructRulesParity {
  static let f = "timers.selfDestructRules"

  // MARK: Fitting and changing

  @Test func fitting() throws {
    for c in try TimerFixtures.cases(Self.f, "fitTimerToPost") {
      check(json(SelfDestruct.fitTimerToPost(c.loose("timer"), c.fit)), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "describeFitChange") {
      check(json(SelfDestruct.describeFitChange(c.loose("timer"), c.fit)), c)
    }
    for c in try TimerFixtures.cases(Self.f, "sameTimer") {
      check(json(SelfDestruct.sameTimer(c.loose("a"), c.loose("b"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "keepHiddenRuleParts") {
      let kept = SelfDestruct.keepHiddenRuleParts(c.loose("edited"), c.loose("stored"), c.fit)
      check(json(kept), c, strictNulls: true)
    }
  }

  @Test func gatesFromTheReplySettings() throws {
    for c in try TimerFixtures.cases(Self.f, "withScheduledGateChange") {
      let t = SelfDestruct.withScheduledGateChange(c.loose("timer"), c.string("action") ?? "", c["on"].isTruthy)
      check(json(t), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withScheduledGateLifespan") {
      check(json(SelfDestruct.withScheduledGateLifespan(c.loose("timer"), c.loose("seconds"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "scheduledGateChange") {
      check(json(SelfDestruct.scheduledGateChange(c.loose("timer"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "withScheduledGateChange (chained)") {
      var t = SelfDestruct.normalizeTimer(c.loose("start") ?? ["enabled": false])
      for step in c["steps"].arrayValue ?? [] {
        t = SelfDestruct.withScheduledGateChange(t, step[0]?.stringValue ?? "", step[1]?.isTruthy ?? false)
      }
      check(json(t), c, strictNulls: true)
    }
  }

  // MARK: Pinned instants and publishing

  @Test func pinnedInstants() throws {
    for c in try TimerFixtures.cases(Self.f, "parseDeleteAt") {
      check(json(SelfDestruct.parseDeleteAt(c.loose("value"), timeZone: utcZone)), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "parseDeleteAt (zones)") {
      check(json(SelfDestruct.parseDeleteAt(c.loose("value"), timeZone: c.zone)), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "normalizeDeleteAt") {
      let actual = SelfDestruct.normalizeDeleteAt(c.loose("value"), now: c.ms("now"), timeZone: utcZone)
      check(json(actual), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "pinnedDeadlineStatus") {
      check(json(SelfDestruct.pinnedDeadlineStatus(c.loose("timer"), c.ms("now"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "immediateTimerProblem") {
      check(json(SelfDestruct.immediateTimerProblem(c.loose("timer"), c.ms("now"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "settleForPublish") {
      check(json(SelfDestruct.settleForPublish(c.loose("timer"), c.ms("now"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "extendWindowSeconds") {
      check(json(SelfDestruct.extendWindowSeconds(c.loose("timer"), c.ms("now"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "toWireSpec") {
      check(json(SelfDestruct.toWireSpec(c.loose("timer"), c.ms("now"))), c, strictNulls: true)
    }
  }

  @Test func publishing() throws {
    for c in try TimerFixtures.cases(Self.f, "timerAdjustmentNote") {
      check(json(SelfDestruct.timerAdjustmentNote(c.string("adjusted"), c.loose("effects"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "immediateTimerToSend") {
      check(json(SelfDestruct.immediateTimerToSend(c.loose("timer"), c.fit, now: c.ms("now"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "scheduledTimerToSend") {
      let sent = SelfDestruct.scheduledTimerToSend(
        c.loose("timer"), fit: c.fit, publishAt: c.ms("publishAt"), now: c.ms("now"), locale: "en-US",
        timeZone: utcZone)
      check(json(sent), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "scheduledTimerProblem") {
      let problem = SelfDestruct.scheduledTimerProblem(
        c.loose("timer"), c.ms("publishAt"), now: c.ms("clock"), locale: "en-US", timeZone: utcZone)
      check(json(problem), c)
    }
    for c in try TimerFixtures.cases(Self.f, "scheduledRowTimerProblem") {
      let problem = SelfDestruct.scheduledRowTimerProblem(
        c.loose("row"), c.loose("whenISO"), now: c.ms("clock"), locale: "en-US", timeZone: utcZone)
      check(json(problem), c)
    }
    for c in try TimerFixtures.cases(Self.f, "scheduledRowDeadlineStatus") {
      check(json(SelfDestruct.scheduledRowDeadlineStatus(c.loose("row"), c.loose("whenISO"), timeZone: utcZone)), c)
    }
  }

  /// A pin without an offset is read in the zone the function is given,
  /// as the web reads it in the browser's one zone, whatever the active
  /// zone is.
  @Test func aPinWithoutAnOffsetIsReadInTheGivenZone() throws {
    for c in try TimerFixtures.cases(Self.f, "scheduledRowTimerProblem (local pins)") {
      let problem = SelfDestruct.scheduledRowTimerProblem(
        c.loose("row"), c.loose("whenISO"), now: c.ms("clock"), locale: "en-US", timeZone: c.zone)
      check(json(problem), c)
    }
    for c in try TimerFixtures.cases(Self.f, "scheduledRowDeadlineStatus (local pins)") {
      check(json(SelfDestruct.scheduledRowDeadlineStatus(c.loose("row"), c.loose("whenISO"), timeZone: c.zone)), c)
    }
    for c in try TimerFixtures.cases(Self.f, "scheduledTimerToSend (local pins)") {
      let sent = SelfDestruct.scheduledTimerToSend(
        c.loose("timer"), publishAt: c.ms("publishAt"), now: c.ms("now"), locale: "en-US", timeZone: c.zone)
      check(json(sent), c, strictNulls: true)
    }
  }

  // MARK: Stored rules and drafts

  @Test func storedRulesAndDrafts() throws {
    for c in try TimerFixtures.cases(Self.f, "unreadableRuleParts") {
      check(json(SelfDestruct.unreadableRuleParts(c.loose("timer"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "unreadableRuleParts (more)") {
      check(json(SelfDestruct.unreadableRuleParts(c.loose("raw"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "readStoredTimer") {
      check(json(SelfDestruct.readStoredTimer(c.loose("timer"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "defaultRuleFromSettings") {
      check(json(SelfDestruct.defaultRuleFromSettings(c.loose("lifespan"))), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "draftTimerNote") {
      let note = SelfDestruct.draftTimerNote(c.loose("rule"), c["touched"].isTruthy, c.loose("defaults"))
      check(json(note), c)
    }
    for c in try TimerFixtures.cases(Self.f, "sessionDraftTimer") {
      check(json(SelfDestruct.sessionDraftTimer(c.loose("timer"), c["touched"].isTruthy)), c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "restoreSessionDraftTimer") {
      check(json(SelfDestruct.restoreSessionDraftTimer(c.loose("saved"), now: c.ms("now"))), c, strictNulls: true)
    }
  }
}
