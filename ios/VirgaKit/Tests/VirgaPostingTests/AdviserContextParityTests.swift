// adviser/context.js held to adviser.context: the pure parts, and
// gatherReplyContext replayed from its recorded AppView reads.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

/// setTimeout's stand-in for a recorded case: each wait is noted and never
/// ends on its own (the recorded runs had the answer first), only when the
/// race that started it is decided and cancels it.
final class HangingSleep: Sendable {
  let waits = Locked<[Double]>([])

  var sleep: @Sendable (Double) async -> Void {
    { [waits] ms in
      waits.withLock { $0.append(ms) }
      try? await Task.sleep(for: .seconds(3600))
    }
  }

  var recorded: [Double] { waits.withLock { $0 } }
}

@Suite struct AdviserContextParity {
  static let f = "adviser.context"

  static func table(_ fn: String) throws -> JSONValue {
    try cases(f, fn).first!.output
  }

  @Test func constants() throws {
    for c in try cases(Self.f, "contextConstants") {
      check(
        [
          "READ_MIN_MS": .number(AdviserContext.readMinMs),
          "SLOW_READ_AFTER_MS": .number(AdviserContext.slowReadAfterMs),
          "CONTEXT_PARENT_HEIGHT": .number(Double(AdviserContext.contextParentHeight)),
          "ADVISER_GATE_TIMEOUT_MS": .number(AdviserGate.adviserGateTimeoutMs),
          "ADVISER_CONTEXT_TIMEOUT_MS": .number(AdviserGate.adviserContextTimeoutMs),
        ], c)
    }
  }

  @Test func goals() throws {
    for c in try cases(Self.f, "adviserGoalItems") {
      check(
        [
          "items": .array(AdviserContext.adviserGoalItems(c.input["adviser"]).map(\.json)),
          "count": .number(Double(AdviserContext.adviserGoalCount(c.input["adviser"]))),
        ], c)
    }
    for c in try cases(Self.f, "readExpectation") {
      check(.string(AdviserContext.readExpectation(c.input["elapsedMs"])), c)
    }
  }

  @Test func drafts() throws {
    let states = try Self.table("contextStates")
    for c in try cases(Self.f, "adviserDraftFacts") {
      let state = states[c.string("state") ?? ""]
      check(AdviserContext.adviserDraftFacts(state, asDid: c.input["asDid"]).json, c)
    }
    for c in try cases(Self.f, "adviserSource") {
      check(json(AdviserContext.adviserSource(states[c.string("state") ?? ""])), c)
    }
  }

  @Test func plans() throws {
    let states = try Self.table("contextStates")
    let setups = try Self.table("contextSetups")
    for c in try cases(Self.f, "adviserReadPlan") {
      let plan = AdviserContext.adviserReadPlan(
        setups[c.string("setup") ?? ""], states[c.string("state") ?? ""],
        canUseAi: c.input["canUseAi"]?.boolValue ?? false, atLimit: c.input["atLimit"]?.boolValue ?? false,
        asDid: c.input["asDid"])
      let ctx = AdviserReplyContext(kind: "reply", thread: [AdviserContextLine(author: "a", text: "b")], target: nil)
      check(
        [
          "plan": plan.json, "payload": AdviserContext.analyzePayload(plan),
          "withContext": AdviserContext.analyzePayload(plan, ctx),
        ], c)
    }
    for c in try cases(Self.f, "adviserShouldInterrupt") {
      let result = c.input["result"]
      let shouldStop =
        c.input["reviewMode"] == nil
        ? AdviserContext.adviserShouldInterrupt(result)
        : AdviserContext.adviserShouldInterrupt(result, c.string("reviewMode"))
      check(.bool(shouldStop), c)
    }
  }

  @Test func conversations() async throws {
    for c in try cases(Self.f, "gatherReplyContext") {
      let recorded = RecordedFetch(c.output)
      let transport = recorded.transport()
      let clock = HangingSleep()
      let context = await AdviserContext.gatherReplyContext(
        c.input["state"], c.string("kind"), sleep: clock.sleep, transport: transport)
      let d = recorded.check(sent: transport.requests, result: context?.json ?? .null, waits: clock.recorded)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
