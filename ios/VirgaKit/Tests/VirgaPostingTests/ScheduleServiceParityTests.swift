// schedule/scheduleService.js held to scheduling.scheduleService: every call
// to /api/schedule/* (and /api/limits/status) replayed through VirgaBackend
// over MockTransport, with the requests it makes, the events it announces
// and what it answers or throws; and the pure readers of rows and limits.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

enum ScheduleServiceFixture {
  static let server = "https://server.example"
  static let token = "vg_" + String(repeating: "0f", count: 32)
  static let did = "did:plc:writer"

  /// The case's requester: Virga's server as the writer, as an account with
  /// no DID, or none.
  static func requester(_ c: ParityCase, _ transport: any HTTPTransport) -> (any ScheduleRequester)? {
    switch c["requester"].stringValue {
    case "none": return nil
    case "no-did": return VirgaBackend(backendUrl: server, token: { token }, did: nil, transport: transport)
    default: return VirgaBackend(backendUrl: server, token: { token }, did: did, transport: transport)
    }
  }
}

/// What a callback heard on a bus, in order.
final class HeardEvents: Sendable {
  let bus = PostingEventBus()
  private let items = Locked<[JSONValue]>([])

  init(_ name: String) {
    _ = try? PostingEvents.onPostingEvent(name, target: bus) { [items] detail in
      items.withLock { $0.append(detail) }
    }
  }

  var all: [JSONValue] { items.withLock { $0 } }
}

@Suite struct ScheduleServiceParity {
  static let f = "scheduling.scheduleService"
  static let flows = [
    "listScheduled", "getScheduled", "getScheduledMedia", "createScheduled", "updateScheduled", "skipScheduled",
    "stopRepeating", "retryScheduled", "acknowledgeTimerNote", "reorderScheduled", "cancelScheduled", "getLimits",
  ]

  static func call(_ c: ParityCase, _ req: (any ScheduleRequester)?, _ bus: PostingEventBus) async throws -> JSONValue {
    let zone = ComposerFixtures.zone(c)
    let id = c.input["id"]
    switch c.fn {
    case "listScheduled": return try await ScheduleService.listScheduled(req, timeZone: zone).json
    case "getScheduled": return try await ScheduleService.getScheduled(req, id, timeZone: zone)
    case "getScheduledMedia": return try await ScheduleService.getScheduledMedia(req, id)
    case "createScheduled":
      return try await ScheduleService.createScheduled(req, c.input["body"] ?? .null, target: bus, timeZone: zone)
    case "updateScheduled":
      return try await ScheduleService.updateScheduled(req, id, c.input["patch"] ?? [:], target: bus, timeZone: zone)
    case "skipScheduled": return try await ScheduleService.skipScheduled(req, id, target: bus, timeZone: zone).json
    case "stopRepeating": return try await ScheduleService.stopRepeating(req, id, target: bus, timeZone: zone)
    case "retryScheduled": return try await ScheduleService.retryScheduled(req, id, target: bus, timeZone: zone)
    case "acknowledgeTimerNote":
      return try await ScheduleService.acknowledgeTimerNote(req, id, target: bus, timeZone: zone)
    case "reorderScheduled":
      return try await ScheduleService.reorderScheduled(
        req, c.input["moves"]?.arrayValue, target: bus, timeZone: zone
      ).json
    case "cancelScheduled": return try await ScheduleService.cancelScheduled(req, id, target: bus)
    case "getLimits": return try await ScheduleService.getLimits(req)
    default: Issue.record("no call for \(c.fn)"); return .null
    }
  }

  @Test(arguments: flows) func flow(_ fn: String) async throws {
    for c in try cases(Self.f, fn) {
      let transport = replayTransport(c.output)
      let heard = HeardEvents(PostingEvents.scheduledChangedEvent)
      let req = ScheduleServiceFixture.requester(c, transport)
      var result: JSONValue
      do {
        result = ["value": try await Self.call(c, req, heard.bus)]
      } catch {
        result = ["$error": ScheduledPostError.errorObject(error)]
      }
      result["heard"] = .array(heard.all)
      checkReplay(c, sent: transport.requests, result: result, waits: nil)
    }
  }

  @Test func constants() throws {
    for c in try cases(Self.f, "constants") {
      check(
        [
          "MAX_PENDING_SCHEDULED": .number(Double(ScheduleService.maxPendingScheduled)),
          "MAX_REORDER_MOVES": .number(Double(ScheduleService.maxReorderMoves)),
          "LIMIT_FEATURES": .array(ScheduleService.limitFeatures.map(JSONValue.string)),
        ], c)
    }
  }

  @Test func rowReaders() throws {
    for c in try cases(Self.f, "countActiveScheduled") {
      check(.number(Double(ScheduleService.countActiveScheduled(c.input["rows"]?.arrayValue))), c)
    }
    let readers: [(String, (JSONValue?) -> JSONValue)] = [
      ("isActiveScheduledRow", { .bool(ScheduleService.isActiveScheduledRow($0)) }),
      ("isTimerNoteRow", { .bool(ScheduleService.isTimerNoteRow($0)) }),
      ("rowClientKey", { .string(ScheduleService.rowClientKey($0)) }),
      ("canEditScheduledRow", { .bool(ScheduleService.canEditScheduledRow($0)) }),
      ("canCancelScheduledRow", { .bool(ScheduleService.canCancelScheduledRow($0)) }),
      ("isRepeatingRow", { .bool(ScheduleService.isRepeatingRow($0)) }),
    ]
    for (fn, read) in readers {
      for c in try cases(Self.f, fn) { check(read(c.input["row"]), c) }
    }
    for c in try cases(Self.f, "isReorderUnsupported") {
      check(.bool(ScheduleService.isReorderUnsupported(c.input["err"])), c)
    }
  }

  @Test func limits() throws {
    for c in try cases(Self.f, "normalizeLimits") {
      check(ScheduleService.normalizeLimits(c.input["body"]), c, strictNulls: true)
    }
    for c in try cases(Self.f, "scheduledRoomProblem") {
      let editing = c.input["editing"]?.isTruthy ?? false
      check(.string(ScheduleService.scheduledRoomProblem(c.input["limits"], editing: editing)), c)
    }
    for c in try cases(Self.f, "scheduledUsageLine") {
      check(.string(ScheduleService.scheduledUsageLine(c.input["limits"])), c)
    }
  }
}

@Suite struct ScheduleServiceBehaviour {
  /// A requester answering each path from a script, recording each call.
  final class ScriptedSchedule: ScheduleRequester, Sendable {
    let did: String?
    private let state = Locked<(calls: [JSONValue], answers: [String: [Result<JSONValue, BackendError>]])>(([], [:]))

    init(did: String? = ScheduleServiceFixture.did) { self.did = did }

    func answer(_ path: String, _ outcomes: Result<JSONValue, BackendError>...) {
      state.withLock { $0.answers[path, default: []].append(contentsOf: outcomes) }
    }

    var calls: [JSONValue] { state.withLock { $0.calls } }

    func request(_ path: String, method: String, query: QueryParams?, body: JSONValue?, timeoutMs: Double)
      async throws -> JSONValue
    {
      let next = state.withLock { state -> Result<JSONValue, BackendError>? in
        state.calls.append(["path": .string(path), "method": .string(method), "body": body ?? .null])
        guard var list = state.answers[path], !list.isEmpty else { return nil }
        let first = list.removeFirst()
        state.answers[path] = list
        return first
      }
      guard let next else { throw BackendError(message: "no answer queued for \(path)") }
      return try next.get()
    }
  }

  @Test func aCancelledReorderFailsTheRestOfTheMovesOneByOne() async throws {
    let req = ScriptedSchedule()
    req.answer("/api/schedule/reorder", .failure(BackendError(message: "missing", status: 404)))
    let gate = AsyncStream<Void>.makeStream()
    let started = AsyncStream<Void>.makeStream()
    let task = Task {
      started.continuation.yield()
      for await _ in gate.stream { break }
      return try await ScheduleService.reorderScheduled(
        req, [["id": "a", "scheduledFor": "2026-11-14T09:00:00Z"]], target: nil)
    }
    for await _ in started.stream { break }
    task.cancel()
    gate.continuation.yield()
    let out = try await task.value
    #expect(out.fallback)
    #expect(out.moved == 0)
    #expect(out.failed.count == 1)
    #expect(out.failed.first?.error is CancellationError)
    #expect(out.refusal == nil)
    // The reorder itself went out before the task noticed; no update did.
    #expect(req.calls.map { $0["path"] } == ["/api/schedule/reorder"])
  }

  @Test func typedMovesGoOutAsTheirJSON() async throws {
    let req = ScriptedSchedule()
    req.answer("/api/schedule/reorder", .success(["success": true, "moved": 1]))
    let heard = HeardEvents(PostingEvents.scheduledChangedEvent)
    let out = try await ScheduleService.reorderScheduled(
      req, [QueueMove(id: "a", scheduledFor: "2026-11-14T09:00:00+00:00")], target: heard.bus)
    #expect(out.moved == 1)
    #expect(req.calls.first?["body"] == ["moves": [["id": "a", "scheduledFor": "2026-11-14T09:00:00.000Z"]]])
    #expect(heard.all == [["did": .string(ScheduleServiceFixture.did), "change": "reordered", "ids": ["a"]]])
  }

  @Test func needsBackendReadsAsTheWebsError() async {
    do {
      _ = try await ScheduleService.listScheduled(nil)
      Issue.record("listed without a requester")
    } catch {
      #expect(ScheduledPostError.errorObject(error)["code"] == "NEEDS_BACKEND")
      #expect(
        ScheduledPostError.scheduleErrorMessage(error)
          == "Scheduling needs this account signed in through Virga’s server. Reconnect it for a longer session.")
    }
  }
}
