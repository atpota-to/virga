// timerService.js without its HTTP call, held to the web's output
// (ios/parity/cases/timers.timerService.js): the helpers and the create
// body as cases, and the flows (createTimer and its confirmation,
// armAfterPublish, listTimers, loadTimerUsage, cancelTimer, the
// availability probe) played from the same scripts against the
// TimerRequester seam: the same requests in the same order, the same
// events, the same availability and the same outcome.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// A requester that answers each path from a queue, as the generator's fake
/// does, recording every request.
final class ScriptedRequester: TimerRequester {
  let did: String?
  let queues: Locked<[String: [JSONValue]]>
  let calls = Locked<[JSONValue]>([])

  init(did: String?, script: JSONValue?) {
    self.did = did
    queues = Locked((script?.objectValue ?? [:]).mapValues { $0.arrayValue ?? [] })
  }

  func request(_ request: TimerRequest) async throws -> JSONValue? {
    calls.withLock {
      $0.append([
        "path": .string(request.path),
        "method": request.method.map(JSONValue.string) ?? .null,
        "query": request.query.map { .object($0.mapValues(JSONValue.string)) } ?? .null,
        "body": request.body ?? .null,
      ])
    }
    let next: JSONValue? = queues.withLock { queues in
      guard var queue = queues[request.path], !queue.isEmpty else { return nil }
      let first = queue.removeFirst()
      queues[request.path] = queue
      return first
    }
    guard let next else {
      throw TimerServiceError(message: "no answer queued for \(request.path)", name: "Error")
    }
    if let error = next["error"], error.isTruthy { throw scriptedError(error) }
    return next["answer"]
  }
}

/// An error the generator describes as `{ name, message, code, status, payload }`.
func scriptedError(_ desc: JSONValue) -> TimerServiceError {
  TimerServiceError(
    code: desc["code"]?.stringValue, message: desc["message"]?.stringValue ?? "", status: desc["status"]?.intValue,
    name: desc["name"]?.stringValue ?? "Error", payload: TimerJS.present(desc["payload"]))
}

/// An error as the fixture holds it.
func errorJSON(_ error: TimerServiceError?) -> JSONValue {
  guard let error else { return .null }
  return [
    "name": .string(error.name ?? "Error"),
    "message": .string(error.message),
    "code": error.code.map(JSONValue.string) ?? .null,
    "status": error.status.map { .number(Double($0)) } ?? .null,
    "payload": error.payload ?? .null,
  ]
}

func outcomeJSON(
  status: String, row: JSONValue?, error: TimerServiceError?, adjusted: String? = nil, note: String? = nil
) -> JSONValue {
  [
    "status": .string(status),
    "row": row ?? .null,
    "error": errorJSON(error),
    "adjusted": adjusted.map(JSONValue.string) ?? .null,
    "note": note.map(JSONValue.string) ?? .null,
  ]
}

@Suite struct TimerServiceParity {
  static let f = "timers.timerService"
  static let writer = "did:plc:writer"
  static let now = VirgaCore.JSDate.parse("2026-09-01T12:00:00Z", timeZone: utcZone)

  // MARK: Helpers

  @Test func constants() throws {
    let c = try TimerFixtures.cases(Self.f, "constants")[0]
    let actual: JSONValue = [
      "TIMER_SNIPPET_MAX": json(TimerService.timerSnippetMax),
      "MAX_EXTRA_URIS": json(TimerService.maxExtraUris),
    ]
    check(actual, c, strictNulls: true)
  }

  @Test func helpers() throws {
    for c in try TimerFixtures.cases(Self.f, "timerDidForUri") {
      check(json(TimerService.timerDidForUri(c.loose("uri"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerSnippet") {
      check(json(TimerService.timerSnippet(c.loose("text"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "isLiveTimer") {
      check(json(TimerService.isLiveTimer(c.loose("row"))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "countLiveTimers") {
      check(json(TimerService.countLiveTimers(c["rows"].arrayValue)), c)
    }
    for c in try TimerFixtures.cases(Self.f, "timerPostUrl") {
      check(json(TimerService.timerPostUrl(c.loose("row"))), c)
    }
  }

  @Test func errorClasses() throws {
    func error(_ c: ParityCase) -> TimerServiceError? { c.loose("error").flatMap { $0.isNull ? nil : scriptedError($0) } }
    for c in try TimerFixtures.cases(Self.f, "isTimersUnavailableError") {
      check(json(TimerService.isTimersUnavailableError(error(c))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "isTimersUnsupported") {
      check(json(TimerService.isTimersUnsupported(error(c))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "isArmOutcomeUnknown") {
      check(json(TimerService.isArmOutcomeUnknown(error(c))), c)
    }
    for c in try TimerFixtures.cases(Self.f, "isDefiniteArmRefusal") {
      check(json(TimerService.isDefiniteArmRefusal(error(c))), c)
    }
  }

  func body(_ args: JSONValue?, timeZone: TimeZone = utcZone) -> TimerCreateBody? {
    TimerService.timerBody(
      uri: args?["uri"]?.stringValue ?? "", cid: args?["cid"]?.stringValue,
      extraUris: args?["extraUris"]?.arrayValue?.compactMap(\.stringValue), snippet: args?["snippet"],
      postedAt: args?["postedAt"]?.stringValue, rule: args?["rule"], fit: TimerFit(json: args?["fit"]),
      now: args?["now"].map { $0.doubleValue ?? .nan } ?? Self.now, timeZone: timeZone)
  }

  @Test func theCreateBody() throws {
    for c in try TimerFixtures.cases(Self.f, "timerBody") {
      check(body(c.input)?.json ?? .null, c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "timerBody (zones)") {
      check(body(c.input, timeZone: c.zone)?.json ?? .null, c, strictNulls: true)
    }
    // The rule's own pin is read in the zone `postedAt` is.
    for c in try TimerFixtures.cases(Self.f, "timerBody (local pins)") {
      check(body(c.input, timeZone: c.zone)?.json ?? .null, c, strictNulls: true)
    }
  }

  // MARK: The flows

  /// Plays one script: a fresh page (availability and event bus), the
  /// requester it names, then `run`.
  func play(
    _ c: ParityCase, _ run: (_ req: ScriptedRequester?, _ context: TimerServiceContext) async throws -> JSONValue
  ) async throws -> JSONValue {
    let bus = PostingEventBus()
    let context = TimerServiceContext(availability: TimerAvailabilityState(), events: bus)
    let heard = Locked<[JSONValue]>([])
    let stop = try PostingEvents.onPostingEvent(PostingEvents.timersChangedEvent, target: bus) { detail in
      heard.withLock { $0.append(detail) }
    }
    defer { stop() }
    let did: String? = c.input["did"].map { $0.stringValue } ?? Self.writer
    let kind = c.string("requester") ?? "yes"
    // A requester without a request function is no requester to the port.
    let req = kind == "yes" ? ScriptedRequester(did: did, script: c.loose("script")) : nil
    let result: JSONValue
    do {
      result = try await run(req, context)
    } catch {
      result = ["$threw": errorJSON(TimerServiceError(error))]
    }
    return [
      "calls": .array(req?.calls.withLock { $0 } ?? []),
      "heard": .array(heard.withLock { $0 }),
      "availability": .string(TimerService.timerAvailability(context)),
      "result": result,
    ]
  }

  @Test func createTimer() async throws {
    for c in try TimerFixtures.cases(Self.f, "createTimer") {
      let args = c["args"]
      let actual = try await play(c) { req, context in
        let r = await TimerService.createTimer(
          req, uri: args["uri"]?.stringValue, cid: args["cid"]?.stringValue,
          extraUris: args["extraUris"]?.arrayValue?.compactMap(\.stringValue), snippet: args["snippet"],
          postedAt: args["postedAt"]?.stringValue, rule: args["rule"], fit: TimerFit(json: args["fit"]),
          now: args["now"].map { $0.doubleValue ?? .nan } ?? Self.now,
          preflight: args["preflight"].map(\.isTruthy) ?? true, timeZone: utcZone, context: context)
        var out = outcomeJSON(status: r.status, row: r.row, error: r.error, adjusted: r.adjusted)
        if let confirmation = r.confirmation {
          let done = await confirmation.value
          out["confirmation"] = outcomeJSON(status: done.status, row: done.row, error: done.error)
        } else {
          out["confirmation"] = .null
        }
        return out
      }
      check(actual, c, strictNulls: true)
    }
  }

  @Test func armAfterPublish() async throws {
    for c in try TimerFixtures.cases(Self.f, "armAfterPublish") {
      let args = c["args"]
      let actual = try await play(c) { req, context in
        let confirming = Locked(0)
        let r = await TimerService.armAfterPublish(
          req, args["publishResult"], args["rule"], snippet: args["snippet"], postedAt: args["postedAt"]?.stringValue,
          fit: TimerFit(json: args["fit"]), onConfirming: { confirming.withLock { $0 += 1 } },
          now: args["now"].map { $0.doubleValue ?? .nan } ?? Self.now, timeZone: utcZone, context: context)
        var out = outcomeJSON(status: r.status, row: r.row, error: r.error, adjusted: r.adjusted, note: r.note)
        out["confirming"] = .number(Double(confirming.withLock { $0 }))
        return out
      }
      check(actual, c, strictNulls: true)
    }
  }

  @Test func listsUsageAndCancelling() async throws {
    for c in try TimerFixtures.cases(Self.f, "listTimers") {
      let actual = try await play(c) { req, context in
        json(try await TimerService.listTimers(req, history: c["args"]["history"]?.isTruthy ?? false, context: context))
      }
      check(actual, c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "loadTimerUsage") {
      let args = c["args"]
      let actual = try await play(c) { req, context in
        json(
          await TimerService.loadTimerUsage(
            req, scheduledRows: args["scheduledRows"]?.arrayValue ?? [], exceptScheduledId: args["exceptScheduledId"],
            context: context))
      }
      check(actual, c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "cancelTimer") {
      let actual = try await play(c) { req, context in
        try await TimerService.cancelTimer(req, c["args"]["id"] ?? .null, context: context) ?? .null
      }
      check(actual, c, strictNulls: true)
    }
  }

  @Test func confirmingALostAnswer() async throws {
    for c in try TimerFixtures.cases(Self.f, "confirmArmAfterUnknown") {
      let args = c["args"]
      let actual = try await play(c) { req, context in
        guard let req, let created = body(args["body"]) else { return .null }
        let first = args["firstError"].flatMap { $0.isNull ? nil : scriptedError($0) }
        let r = await TimerService.confirmArmAfterUnknown(req, created, firstError: first, context: context)
        return outcomeJSON(status: r.status, row: r.row, error: r.error)
      }
      check(actual, c, strictNulls: true)
    }
  }

  @Test func availability() async throws {
    for c in try TimerFixtures.cases(Self.f, "probeTimerAvailability") {
      let actual = try await play(c) { req, context in
        var answers: [JSONValue] = []
        for step in c.strings("pattern") {
          if step == "together" {
            async let a = TimerService.probeTimerAvailability(req, context: context)
            async let b = TimerService.probeTimerAvailability(req, context: context)
            answers += [.string(await a), .string(await b)]
          } else {
            answers.append(.string(await TimerService.probeTimerAvailability(req, context: context)))
          }
        }
        return .array(answers)
      }
      check(actual, c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "probeTimerAvailability (then a requester)") {
      let actual = try await play(c) { req, context in
        let first = await TimerService.probeTimerAvailability(nil, context: context)
        let second = await TimerService.probeTimerAvailability(req, context: context)
        return [.string(first), .string(second)]
      }
      check(actual, c, strictNulls: true)
    }
    for c in try TimerFixtures.cases(Self.f, "markTimersUnavailable") {
      // Played without a requester, as the generator plays it.
      let errors = c["errors"].arrayValue ?? []
      let bus = PostingEventBus()
      let context = TimerServiceContext(availability: TimerAvailabilityState(), events: bus)
      let results: [JSONValue] = errors.map { desc in
        let error = desc.isNull ? nil : scriptedError(desc)
        let marked = TimerService.markTimersUnavailable(error, context: context)
        return [.bool(marked), .string(TimerService.timerAvailability(context))]
      }
      let actual: JSONValue = [
        "calls": [], "heard": [], "availability": .string(TimerService.timerAvailability(context)),
        "result": .array(results),
      ]
      check(actual, c, strictNulls: true)
    }
  }
}
