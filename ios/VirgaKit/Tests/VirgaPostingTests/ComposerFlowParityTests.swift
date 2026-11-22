// composer/{actions,defaults,gatesModel,intent,submit}.js held to
// composer.flow: the split button, a fresh post's defaults, the reply
// rules editor, intents, and the words and steps around sending.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

/// An error as the generator made it: `Object.assign(new Error(message), fields)`.
private struct FixtureError: Error, JSErrorConvertible, CancelMarkedError {
  var jsFields: JSErrorFields
  var canceled: Bool

  init?(_ spec: JSONValue?) {
    guard let spec, case .object = spec else { return nil }
    jsFields = JSErrorFields(
      name: spec["name"]?.stringValue ?? "Error", message: spec["message"]?.stringValue ?? "", code: spec["code"],
      status: spec["status"]?.intValue, error: spec["error"]?.stringValue)
    canceled = spec["canceled"]?.isTruthy ?? false
  }
}

@Suite struct ComposerFlowParity {
  static let f = "composer.flow"

  static func caps(_ value: JSONValue?) -> ComposerCaps {
    ComposerCaps(canPost: value?["canPost"]?.boolValue, canSchedule: value?["canSchedule"]?.isTruthy ?? false)
  }

  @Test func actions() throws {
    for c in try cases(Self.f, "actionConstants") {
      check(
        [
          "DRAFT_MAX_GRAPHEMES": .number(Double(ComposerActions.draftMaxGraphemes)),
          "OVER_LIMIT_HINT": .string(ComposerActions.overLimitHint),
          "EMPTY_HINT": .string(ComposerActions.emptyHint),
          "VIDEO_PENDING_HINT": .string(ComposerActions.videoPendingHint),
          "MEDIA_MISSING_HINT": .string(ComposerActions.mediaMissingHint),
          "SIGNED_OUT_HINT": .string(ComposerActions.signedOutHint),
        ], c)
    }
    for c in try cases(Self.f, "postFacts") { check(json(ComposerActions.postFacts(c.input["state"])), c) }
    for c in try cases(Self.f, "composerActions") {
      let o = c.input["options"]
      check(
        json(
          ComposerActions.composerActions(
            c.input["state"], defaultAction: o?["defaultAction"], queue: o?["queue"], caps: Self.caps(o?["caps"]),
            signedOut: o?["signedOut"]?.isTruthy ?? false, missingMedia: o?["missingMedia"]?.isTruthy ?? false,
            postNow: o?["postNow"]?.isTruthy ?? false, authMode: o?["authMode"] ?? "backend")), c)
    }
    for c in try cases(Self.f, "actionLabel") {
      check(
        .string(
          ComposerActions.actionLabel(c.string("action"), c.input["state"], short: c.input["short"]?.boolValue ?? false)),
        c)
    }
  }

  @Test func defaults() throws {
    for c in try cases(Self.f, "defaultConstants") {
      check(
        [
          "TIMER_NEEDS_SERVER": .string(ComposerDefaults.timerNeedsServer),
          "TIMER_LIMITS_UNKNOWN": .string(ComposerDefaults.timerLimitsUnknown),
          "NO_FREE_TIMER": .string(ComposerDefaults.noFreeTimer),
        ], c)
    }
    for c in try cases(Self.f, "defaultTimerFor") {
      check(
        json(
          ComposerDefaults.defaultTimerFor(
            c.input["settings"], canSchedule: c.input["canSchedule"]?.isTruthy ?? false,
            limitsStatus: c.string("limitsStatus"), limits: c.input["limits"], fit: c.input["fit"])), c)
    }
    for c in try cases(Self.f, "gatesSourceLine") {
      check(.string(ComposerDefaults.gatesSourceLine(c.input["info"], reply: c.input["reply"]?.isTruthy ?? false)), c)
    }
    for c in try cases(Self.f, "gatesSummary") { check(.string(ComposerDefaults.gatesSummary(c.input["gates"])), c) }
    for c in try cases(Self.f, "gatesShortSummary") {
      check(.string(ComposerDefaults.gatesShortSummary(c.input["gates"])), c)
    }
  }

  @Test func gatesModel() throws {
    for c in try cases(Self.f, "gatesModelConstants") { check(["RULE_OPTIONS": json(GatesModel.ruleOptions)], c) }
    for c in try cases(Self.f, "replyMode") { check(.string(GatesModel.replyMode(c.input["reply"])), c) }
    for c in try cases(Self.f, "hasRule") { check(.bool(GatesModel.hasRule(c.input["reply"], c.input["rule"])), c) }
    for c in try cases(Self.f, "toggleRule") {
      check(.array(GatesModel.toggleRule(c.input["reply"], c.input["rule"] ?? .null)), c)
    }
    for c in try cases(Self.f, "rulesNote") { check(.string(GatesModel.rulesNote(c.input["reply"])), c) }
    for c in try cases(Self.f, "isForeignListRule") {
      check(.bool(GatesModel.isForeignListRule(c.input["rule"], c.input["did"])), c)
    }
    for c in try cases(Self.f, "gatesForAccount") {
      check(json(GatesModel.gatesForAccount(c.input["gates"], c.input["did"])), c)
    }
    for c in try cases(Self.f, "unlistedRules") {
      check(.array(GatesModel.unlistedRules(c.input["reply"], c.input["listUris"]?.arrayValue ?? [])), c)
    }
  }

  @Test func intents() throws {
    for c in try cases(Self.f, "readTargetRef") {
      check(ComposerIntent.readTargetRef(c.input["input"])?.json ?? .null, c)
    }
    for c in try cases(Self.f, "normalizeIntent") {
      check(ComposerIntent.normalizeIntent(c.input["intent"], activeDid: c.string("activeDid") ?? "").json, c)
    }
    for c in try cases(Self.f, "intentLoads") {
      let plan =
        c.id == "null" ? nil : ComposerIntent.normalizeIntent(c.input["intent"], activeDid: c.string("activeDid") ?? "")
      check(.array(ComposerIntent.intentLoads(plan).map(JSONValue.string)), c)
    }
    for c in try cases(Self.f, "intentLoadsPlan") {
      let plan = ComposerIntentPlan(json: c.input["plan"] ?? [:])
      check(.array(ComposerIntent.intentLoads(plan).map(JSONValue.string)), c)
    }
    for c in try cases(Self.f, "seedFromIntent") {
      let plan = ComposerIntent.normalizeIntent(c.input["intent"], activeDid: "did:plc:mira")
      checkCanon(ComposerIntent.seedFromIntent(ComposerState(json: c.input["base"] ?? [:]), plan).json, c)
    }
  }

  static func zone(_ name: String?) -> TimeZone? { name.flatMap(PostingQueue.timeZone(named:)) }

  @Test func submitWords() throws {
    for c in try cases(Self.f, "submitConstants") {
      check(
        [
          "SLOW_PUBLISH_MS": .number(ComposerSubmit.slowPublishMs),
          "HARD_PUBLISH_MS": .number(ComposerSubmit.hardPublishMs),
          "SLOW_PUBLISH_NOTE": .string(ComposerSubmit.slowPublishNote),
          "HARD_PUBLISH_ERROR": .string(ComposerSubmit.hardPublishError),
          "SCHEDULED_COPY_REMAINS": .string(ComposerSubmit.scheduledCopyRemains),
          "DRAFT_NOT_DELETED": .string(ComposerSubmit.draftNotDeleted),
        ], c)
    }
    for c in try cases(Self.f, "progressLine") {
      check(
        ComposerSubmit.progressLine(c.input["event"], posts: c.input["posts"]?.doubleValue ?? 1).map(JSONValue.string)
          ?? .null, c)
    }
    for c in try cases(Self.f, "publishErrorView") {
      check(json(ComposerSubmit.publishErrorView(FixtureError(c.input["error"]))), c)
    }
    for c in try cases(Self.f, "accountLabel") {
      check(.string(ComposerSubmit.accountLabel(c.input["account"], c.string("did"))), c)
    }
    for c in try cases(Self.f, "postedToast") {
      check(json(ComposerSubmit.postedToast(account: c.input["account"], did: c.string("did"), root: c.input["root"])), c)
    }
    for c in try cases(Self.f, "whenWords") {
      check(
        .string(
          ComposerSubmit.whenWords(
            c.input["at"], now: c.input["now"]?.doubleValue ?? .nan, locale: c.string("locale"),
            timeZone: Self.zone(c.string("timeZone")), localZone: ComposerFixtures.zone(c))), c)
    }
    for c in try cases(Self.f, "scheduledMessage") {
      check(
        .string(
          ComposerSubmit.scheduledMessage(
            at: c.input["at"], queued: c.input["queued"]?.isTruthy ?? false,
            editing: c.input["editing"]?.isTruthy ?? false, account: c.input["account"], did: c.string("did"),
            now: c.input["now"]?.doubleValue ?? .nan, locale: c.string("locale"),
            timeZone: Self.zone(c.string("timeZone")), localZone: ComposerFixtures.zone(c),
            repeat: c.input["repeat"])), c)
    }
    for c in try cases(Self.f, "queueSlotRows") {
      check(
        .array(ComposerSubmit.queueSlotRows(c.input["rows"]?.arrayValue, excludeId: c.input["excludeId"] ?? .null)), c)
    }
  }

  @Test func finishSource() async throws {
    for c in try cases(Self.f, "finishSource") {
      let calls = Locked<[JSONValue]>([])
      let cancels = Locked(c.input["cancel"]?.arrayValue?.compactMap(\.stringValue) ?? [])
      func record(_ entry: [JSONValue]) { calls.withLock { $0.append(.array(entry)) } }
      let result = await ComposerSubmit.finishSource(
        c.input["source"], asDid: "did:plc:mira",
        agentFor: { (did: String) -> String in
          record(["agentFor", .string(did)])
          if c.input["agent"] == "fail" { throw JSError(message: "signed out") }
          return "agent"
        },
        backendFor: { (did: String) -> String? in
          record(["backendFor", .string(did)])
          return c.input["req"]?.isTruthy == true ? "req" : nil
        },
        deleteDraft: { agent, id in
          record(["deleteDraft", .string(agent), id])
          if c.input["del"] == "fail" { throw JSError(message: "nope") }
        },
        cancelScheduled: { req, id in
          record(["cancelScheduled", .string(req), id])
          let step = cancels.withLock { $0.isEmpty ? nil : $0.removeFirst() }
          if step == "fail" { throw JSError(message: "down") }
          if step == "404" { throw JSError(message: "gone", status: 404) }
        },
        wait: { ms in record(["wait", .number(ms)]) })
      check(["result": json(result), "calls": .array(calls.withLock { $0 })], c)
    }
  }
}
