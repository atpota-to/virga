// adviser/gate.js, gateController.js and useAdviserRead.js held to
// adviser.gate: the constants and rules, and whole checks played against
// AdviserGateController with the web generator's stand-ins.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

/// A requester that is there but never asked (the checks' server is stood in).
struct IdleRequester: AIRequester {
  var did: String?
  func postAI(_ path: String, body: JSONValue, timeoutMs: Double) async throws -> JSONValue {
    throw AIServiceError(message: "not used")
  }
}

@MainActor @Suite struct AdviserGateParity {
  static let f = "adviser.gate"

  @Test func constants() throws {
    for c in try cases(Self.f, "gateConstants") {
      check(
        [
          "ADVISER_GATE_TIMEOUT_MS": .number(AdviserGate.adviserGateTimeoutMs),
          "ADVISER_CONTEXT_TIMEOUT_MS": .number(AdviserGate.adviserContextTimeoutMs),
          "ADVISER_CHOICES": .object(AdviserGate.adviserChoices.mapValues { .string($0.rawValue) }),
          "ADVISER_CHOICE_LABELS": .object(
            Dictionary(uniqueKeysWithValues: AdviserGate.adviserChoiceLabels.map { ($0.key.rawValue, .string($0.value)) })),
          "ADVISER_TIMEOUT_MESSAGE": .string(AdviserGate.adviserTimeoutMessage),
          "gateChoices": .array(AdviserGate.adviserReadChoices(true).map { .string($0.rawValue) }),
          "buttonChoices": .array(AdviserGate.adviserReadChoices(false).map { .string($0.rawValue) }),
          "ADVISER_DECISIONS": .object(
            Dictionary(uniqueKeysWithValues: AdviserDecision.allCases.map { ($0.rawValue.uppercased(), .string($0.rawValue)) })),
          "SHEET_STATUSES": json(AdviserGateRules.sheetStatuses),
          "INITIAL_ADVISER_VIEW": [
            "busy": .null, "sheet": .null, "usageVersion": .number(Double(AdviserGateRules.initialAdviserView.usageVersion)),
          ],
        ], c)
    }
  }

  @Test func deadlines() async throws {
    for c in try cases(Self.f, "withinMs") {
      let ms = c["ms"].doubleValue!
      let message: String
      do {
        _ = try await AdviserGate.withinMs(ms, sleep: { _ in }) { () async throws -> Int in
          try await Task.sleep(for: .seconds(3600))
          return 0
        }
        message = "answered"
      } catch {
        message = jsMessage(error)
      }
      check(["name": "Error", "message": .string(message)], c)
    }
  }

  @Test func rules() throws {
    for c in try cases(Self.f, "adviserGateEnabled") {
      check(
        .bool(
          AdviserGateRules.adviserGateEnabled(
            settings: c.input["settings"], hasRequester: c["requester"].boolValue == true,
            canUseAi: c["canUseAi"].boolValue == true)), c)
    }
    for c in try cases(Self.f, "adviserUsageLineFor") {
      let usage = c.input["usage"].flatMap { u -> AdviserUsage? in
        guard let month = u["month"]?.stringValue else { return nil }
        return AdviserUsage(month: month, used: u["used"]?.doubleValue ?? 0, limit: u["limit"]?.doubleValue ?? 0)
      }
      check(
        .string(
          AdviserGateRules.adviserUsageLineFor(
            c.string("did"), readUsage: { _, _ in usage }, now: 1_794_484_800_000)), c)
    }
  }

  enum First: Sendable {
    case decision(AdviserDecision)
    case sheet(AdviserSheetRead)
  }

  /// One check as the generator plays it.
  func play(_ c: ParityCase) async -> JSONValue {
    let answer = c["answer"]
    let payloads = Locked<[JSONValue]>([])
    let gathers = Locked<[String]>([])
    let context = c.input["context"].flatMap { ctx -> AdviserReplyContext? in
      guard ctx.isTruthy else { return nil }
      return try? ctx.decode(AdviserReplyContext.self)
    }
    var views: [AdviserView] = []
    let sheetSeen = AdviserGateLatch<AdviserSheetRead?>()
    let atLimit = c["atLimit"].boolValue == true
    let usage = c.input["usage"].flatMap { u -> AdviserUsage? in
      guard let month = u["month"]?.stringValue else { return nil }
      return AdviserUsage(month: month, used: u["used"]?.doubleValue ?? 0, limit: u["limit"]?.doubleValue ?? 0)
    }
    // The generator's answers come at once, well inside the 10 s deadline;
    // here the deadline is on timers nothing runs, so a loaded machine can't
    // let it win.
    let timers = ManualTimers()
    let ctl = AdviserGateController(
      analyzePost: { _, payload, _ in
        payloads.withLock { $0.append(payload) }
        if let error = answer["error"] {
          throw AIServiceError(
            message: error["message"]?.stringValue ?? "", status: error["status"]?.intValue,
            code: error["code"].nonNull)
        }
        return answer["result"] ?? .null
      },
      gatherReplyContext: { _, kind, _ in
        gathers.withLock { $0.append(kind) }
        return context.map { AdviserReplyContext(kind: kind, thread: $0.thread, target: $0.target) }
      },
      atLimit: { _ in atLimit }, readUsage: { _, _ in usage }, now: { 0 }, sleep: { _ in },
      onChange: { view in
        views.append(view)
        if let sheet = view.sheet { sheetSeen.open(sheet) }
      }, setTimer: timers.set, clearTimer: timers.clear)
    let did = c.string("did")
    ctl.configure(
      did: did, settings: c.input["settings"], requester: c["requester"].boolValue == true ? IdleRequester(did: did) : nil,
      canUseAi: c["canUseAi"].boolValue == true)
    let check = ctl.check(c.input["check"], mode: c.string("mode") ?? "gate")
    let first = AdviserGateLatch<First>()
    Task { first.open(.decision(await check.decision)) }
    Task { if let sheet = await sheetSeen.wait() { first.open(.sheet(sheet)) } }
    var decision: AdviserDecision
    var sheet: AdviserSheetRead?
    switch await first.wait() {
    case .decision(let d):
      decision = d
    case .sheet(let s):
      sheet = s
      ctl.decide(c.string("decide") ?? "undefined")
      decision = await check.decision
    }
    sheetSeen.open(nil)
    return [
      "decision": .string(decision.rawValue),
      "sheet": sheet?.json ?? .null,
      "busy": views.first { $0.busy != nil }?.busy?.json ?? .null,
      "payloads": .array(payloads.withLock { $0 }),
      "gathers": .array(gathers.withLock { $0 }.map(JSONValue.string)),
      "usageVersion": .number(Double(ctl.view.usageVersion)),
      "after": ["busy": ctl.view.busy?.json ?? .null, "sheet": ctl.view.sheet?.json ?? .null],
      "enabled": .bool(ctl.isEnabled),
    ]
  }

  @Test func checks() async throws {
    for c in try cases(Self.f, "check") {
      check(await play(c), c)
    }
  }
}
