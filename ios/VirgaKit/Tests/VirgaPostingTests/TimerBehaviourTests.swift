// What the timer fixtures can't reach: a cancelled task (the web's aborted
// signal), errors from elsewhere, many composers probing at once, the
// typed values' JSON, and sorting more rows than V8 sorts by insertion.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// A requester whose every call waits for `gate`, then fails as `failure`.
final class StallingRequester: TimerRequester {
  let did: String? = "did:plc:writer"
  let count = Locked(0)
  let failure: TimerServiceError?
  let answer: JSONValue?

  init(failure: TimerServiceError? = nil, answer: JSONValue? = nil) {
    self.failure = failure
    self.answer = answer
  }

  func request(_ request: TimerRequest) async throws -> JSONValue? {
    count.withLock { $0 += 1 }
    try? await Task.sleep(nanoseconds: 20_000_000)
    if let failure { throw failure }
    return answer
  }
}

struct OtherError: Error, LocalizedError {
  var errorDescription: String? { "The network connection was lost." }
}

struct ConvertibleError: TimerErrorConvertible {
  var timerServiceError: TimerServiceError {
    TimerServiceError(code: "QUOTA_EXCEEDED", message: "full", status: 402, payload: ["feature": "postTimers"])
  }
}

@Suite struct TimerServiceBehaviour {
  static let post = "at://did:plc:writer/app.bsky.feed.post/3kpost"
  static let rule: JSONValue = ["enabled": true, "lifespanSeconds": 3600]
  static let now = 1_788_264_000_000.0

  func freshContext() -> (TimerServiceContext, PostingEventBus) {
    let bus = PostingEventBus()
    return (TimerServiceContext(availability: TimerAvailabilityState(), events: bus), bus)
  }

  @Test func aCancelledArmFailsRatherThanConfirming() async throws {
    let (context, _) = freshContext()
    let req = StallingRequester(failure: TimerServiceError(code: "TIMEOUT", message: "late", status: 0))
    let task = Task {
      await TimerService.createTimer(req, uri: Self.post, rule: Self.rule, now: Self.now, context: context)
    }
    task.cancel()
    let outcome = await task.value
    #expect(outcome.status == "failed")
    #expect(outcome.confirmation == nil)
    #expect(outcome.error?.code == "TIMEOUT")
  }

  @Test func aLostAnswerConfirmsWithoutHoldingTheCaller() async throws {
    let (context, bus) = freshContext()
    let heard = Locked<[JSONValue]>([])
    _ = try PostingEvents.onPostingEvent(PostingEvents.timersChangedEvent, target: bus) { detail in
      heard.withLock { $0.append(detail) }
    }
    let req = StallingRequester(failure: TimerServiceError(message: "Failed to fetch", name: "TypeError"))
    let outcome = await TimerService.createTimer(req, uri: Self.post, rule: Self.rule, now: Self.now, context: context)
    #expect(outcome.status == "confirming")
    let confirmed = await outcome.confirmation?.value
    // Retry, then the list: both fail, so nothing is known.
    #expect(confirmed?.status == "unconfirmed")
    #expect(confirmed?.error?.name == "TypeError")
    #expect(req.count.withLock { $0 } == 3)
    #expect(heard.withLock { $0 }.isEmpty)
    #expect(TimerService.timerAvailability(context) == "unknown")
  }

  @Test func errorsFromElsewhere() {
    let cancelled = TimerServiceError(CancellationError())
    #expect(cancelled.name == "AbortError")
    #expect(TimerService.isArmOutcomeUnknown(CancellationError()))

    let other = TimerServiceError(OtherError())
    #expect(other.message == "The network connection was lost.")
    #expect(TimerService.isArmOutcomeUnknown(OtherError()))

    let quota = TimerServiceError(ConvertibleError())
    #expect(quota.status == 402)
    #expect(TimerService.isDefiniteArmRefusal(ConvertibleError()))
    #expect(SelfDestruct.timerSlotRefusal(quota.payload) == SelfDestruct.timerSlotSentence("plain"))

    #expect(TimerService.codedError("BAD_POST", "x").errorDescription == "x")
  }

  @Test func manyComposersShareOneProbe() async {
    let (context, _) = freshContext()
    let req = StallingRequester(answer: ["success": true, "data": [], "unavailable": true])
    let answers = await withTaskGroup(of: String.self) { group in
      for _ in 0..<12 { group.addTask { await TimerService.probeTimerAvailability(req, context: context) } }
      var all: [String] = []
      for await answer in group { all.append(answer) }
      return all
    }
    #expect(answers == Array(repeating: "unavailable", count: 12))
    #expect(req.count.withLock { $0 } == 1)
    #expect(await TimerService.probeTimerAvailability(req, context: context) == "unavailable")
    #expect(req.count.withLock { $0 } == 1)

    TimerService.resetTimerAvailability(context)
    #expect(TimerService.timerAvailability(context) == "unknown")
    #expect(await TimerService.probeTimerAvailability(req, context: context) == "unavailable")
    #expect(req.count.withLock { $0 } == 2)
  }

  @Test func eachContextKeepsItsOwnAvailability() {
    let (a, _) = freshContext()
    let (b, _) = freshContext()
    #expect(TimerService.markTimersUnavailable(TimerServiceError(code: "UNAVAILABLE", message: "off"), context: a))
    #expect(TimerService.timerAvailability(a) == "unavailable")
    #expect(TimerService.timerAvailability(b) == "unknown")
  }

  @Test func aCancelHeardWithoutAnAccountIsStillACancel() async throws {
    let (context, bus) = freshContext()
    let heard = Locked(0)
    _ = try PostingEvents.onPostingEvent(PostingEvents.timersChangedEvent, target: bus) { _ in
      heard.withLock { $0 += 1 }
    }
    struct NoAccount: TimerRequester {
      var did: String? { nil }
      func request(_ request: TimerRequest) async throws -> JSONValue? {
        ["success": true, "data": ["id": "t1", "status": "cancelled"]]
      }
    }
    let row = try await TimerService.cancelTimer(NoAccount(), "t1", context: context)
    #expect(row?["status"] == "cancelled")
    #expect(heard.withLock { $0 } == 0)
  }
}

@Suite struct TimerModelBehaviour {
  @Test func theWireSpecNamesAPinOnlyWhenThereIsOne() throws {
    let now = 1_788_264_000_000.0
    let plain = try #require(SelfDestruct.toWireSpec(TimerRule(enabled: true, lifespanSeconds: 600), now))
    #expect(json(plain)["deleteAt"] == nil)
    #expect(plain.json["deleteAt"] == nil)
    let pinned = try #require(
      SelfDestruct.toWireSpec(TimerRule(enabled: true, deleteAt: "2026-09-01T17:00:00.000Z"), now))
    #expect(json(pinned)["deleteAt"] == "2026-09-01T17:00:00.000Z")
    #expect(pinned.lifespanSeconds == 5 * 3600)
  }

  @Test func listNamesAreForSentencesOnly() throws {
    let rule = SelfDestruct.normalizeTimer(
      JSONValue.object([
        "enabled": true,
        "effects": [["action": "limitReplies", "allow": [["list": "at://did:plc:a/app.bsky.graph.list/l", "name": "Pals"]]]],
      ]))
    #expect(SelfDestruct.describeEffects(rule.effects) == "Limits replies to people in Pals")
    let spec = try #require(SelfDestruct.toWireSpec(rule, 0))
    #expect(spec.effects[0].allow == [.list("at://did:plc:a/app.bsky.graph.list/l")])
  }

  @Test func allowEntriesDecodeAsTheyEncode() throws {
    let entries: [AllowEntry] = [.rule(.mention), .list("at://x/app.bsky.graph.list/y", name: "Y"), .list("at://z")]
    let data = try JSONEncoder().encode(entries)
    #expect(try JSONDecoder().decode([AllowEntry].self, from: data) == entries)
    #expect(throws: (any Error).self) { try JSONDecoder().decode(AllowEntry.self, from: Data("5".utf8)) }
  }

  @Test func typedAndLooseInputsAgree() {
    let rule = TimerRule(
      enabled: true, deleteAt: nil, lifespanSeconds: 7200,
      conditions: TimerConditions(clauses: [TimerClause(metric: .quotes, op: .gt, value: 3, from: ActorFilter(notFollowed: true))]),
      effects: [TimerEffect(action: .disableQuotes)])
    #expect(SelfDestruct.normalizeTimer(rule) == SelfDestruct.normalizeTimer(rule.json))
    #expect(SelfDestruct.timerBucket(rule) == "conditional")
    #expect(SelfDestruct.isPresetLifespan(3600) && !SelfDestruct.isPresetLifespan(3601))
    #expect(SelfDestruct.splitLifespan(5400) == LifespanParts(amount: 90, unit: "minutes"))
    #expect(SelfDestruct.formatLifespan(7200) == "2 hours")
  }

  @Test func manyRowsSortStablyAsV8Does() {
    // Over 63 rows V8 merges runs; for a consistent order that is a stable sort.
    let rows: [JSONValue] = (0..<150).map { i in
      [
        "id": .number(Double(i)),
        "status": i % 3 == 0 ? "armed" : "deleted",
        "checkAt": .string("2026-08-\(10 + i % 7)T00:00:00Z"),
      ]
    }
    let groups = SelfDestruct.groupTimers(rows, timeZone: TimeZone(identifier: "UTC")!)
    let live = groups.first { $0.key == "live" }?.rows ?? []
    let ids = live.compactMap { $0["id"]?.doubleValue }
    let expected = rows.enumerated()
      .filter { $0.element["status"] == "armed" }
      .sorted { a, b in
        let x = a.element["checkAt"]?.stringValue ?? ""
        let y = b.element["checkAt"]?.stringValue ?? ""
        return x == y ? a.offset < b.offset : x < y
      }
      .compactMap { $0.element["id"]?.doubleValue }
    #expect(ids == expected)
  }

  @Test func v8InsertionSortTakesAnInconsistentComparatorAsV8Does() {
    // NaN is equal to everything. Node: [3,NaN,1,2] stays as it is (one
    // run); [3,1,NaN,2] → [1,2,3,NaN]; [5,4,NaN,1,3,2] → [1,2,3,4,5,NaN].
    func sorted(_ values: [Double]) -> [Double] {
      TimerJS.v8Sorted(values) { a, b in a.isNaN || b.isNaN ? 0 : a - b }.map { $0.isNaN ? -1 : $0 }
    }
    #expect(sorted([3, .nan, 1, 2]) == [3, -1, 1, 2])
    #expect(sorted([3, 1, .nan, 2]) == [1, 2, 3, -1])
    #expect(sorted([5, 4, .nan, 1, 3, 2]) == [1, 2, 3, 4, 5, -1])
  }
}
