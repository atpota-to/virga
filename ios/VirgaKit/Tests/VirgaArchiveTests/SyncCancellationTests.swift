// The web reads followers, follows, notifications and likes through the
// account's Agent without the sweep's AbortSignal (analyticsSync.js passes
// `signal` to fetch and Constellation only), so calling a sync off while
// one of those requests is out lets it finish: its page is kept and the
// sweep stops before the next one, with no error. The fixture's fake fetch
// hands every answer back after the abort; the real transport fails a
// request whose task is cancelled. These replay the same recorded cases
// through a transport that does what the real one does, and must reach the
// same result.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaArchive

/// At request `abortAt`, calls the sweep off while the request is out, then
/// behaves as URLSessionTransport does: a request whose task is cancelled
/// fails with CancellationError, before or after it is answered.
final class InFlightAbortTransport: HTTPTransport, @unchecked Sendable {
  let base: any HTTPTransport
  let abortAt: Int?
  /// Calls the sweep off (cancels the task running it).
  let callOff = Locked<(@Sendable () -> Void)?>(nil)
  private let count = Locked(0)

  init(_ base: any HTTPTransport, abortAt: Int?) {
    self.base = base
    self.abortAt = abortAt
  }

  func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    let index = count.withLock { n -> Int in
      defer { n += 1 }
      return n
    }
    try Task.checkCancellation()
    let response = try await base.send(request)
    if index == abortAt {
      while callOff.wrappedValue == nil { await Task.yield() }
      callOff.wrappedValue?()
    }
    try Task.checkCancellation()
    return response
  }
}

private let utc = TimeZone(identifier: "UTC")!

private func progressJSON(_ p: SweepProgress) -> JSONValue {
  var members: [String: JSONValue] = ["fetched": .number(Double(p.fetched)), "reachedMs": js(p.reachedMs)]
  if let part = p.part { members["part"] = .number(Double(part)) }
  if let parts = p.parts { members["parts"] = .number(Double(parts)) }
  return .object(members)
}

/// Replays a recorded case whose sweep was called off, aborting in flight.
private func replayCalledOff(
  _ c: ParityCase, sourceLocation: SourceLocation = #_sourceLocation,
  _ run: @escaping @Sendable (_ agent: XRPCAgent, _ clock: NetworkClock, _ log: SweepLog) async -> JSONValue
) async {
  let recording = RecordedFetch(c.output)
  let mock = recording.transport()
  let transport = InFlightAbortTransport(mock, abortAt: c["abortAt"].intValue)
  let clock = RecordingClock(now: syncNow)
  let agent = XRPCAgent(service: "https://pds.example", transport: transport)
  let log = SweepLog()
  let networkClock = clock.clock
  let task = Task { await run(agent, networkClock, log) }
  transport.callOff.set({ task.cancel() })
  let result = await task.value
  let d = recording.check(sent: mock.requests, result: recorded(result), waits: clock.waits, ordered: true)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
  let pages = Parity.diff(log.pagesJSON, c.output["pages"] ?? .array([]))
  #expect(pages == nil, "\(c) pages: \(pages ?? "")", sourceLocation: sourceLocation)
  let progress = Parity.diff(log.progressJSON, c.output["progress"] ?? .array([]))
  #expect(progress == nil, "\(c) progress: \(progress ?? "")", sourceLocation: sourceLocation)
}

private func calledOff(_ fn: String) throws -> [ParityCase] {
  let cases = try Parity.cases("archive.sync", fn: fn).filter { $0["abortAt"].intValue != nil }
  #expect(!cases.isEmpty, "no called-off case for \(fn)")
  return cases
}

@Suite struct SyncCalledOffInFlight {
  @Test func followers() async throws {
    for c in try calledOff("sweepFollowers") {
      await replayCalledOff(c) { agent, clock, log in
        encoded(await AnalyticsSync.sweepFollowers(agent: agent, did: syncOwner, clock: clock) { log.report(progressJSON($0)) })
      }
    }
  }

  @Test func follows() async throws {
    for c in try calledOff("sweepFollowing") {
      await replayCalledOff(c) { agent, clock, log in
        encoded(await AnalyticsSync.sweepFollowing(agent: agent, did: syncOwner, clock: clock) { log.report(progressJSON($0)) })
      }
    }
  }

  @Test func notifications() async throws {
    for c in try calledOff("sweepInbound") {
      let cutoff = num(c["opts"]["cutoffMs"])
      await replayCalledOff(c) { agent, clock, log in
        encoded(
          await AnalyticsSync.sweepInbound(
            agent: agent, cutoffMs: cutoff, clock: clock, timeZone: utc, onPage: { log.page(json($0)) },
            onProgress: { log.report(progressJSON($0)) }))
      }
    }
  }

  @Test func likesAndReposts() async throws {
    for c in try calledOff("sweepOutbound") {
      let cutoff = num(c["opts"]["cutoffMs"])
      await replayCalledOff(c) { agent, clock, log in
        encoded(
          await AnalyticsSync.sweepOutbound(
            agent: agent, did: syncOwner, cutoffMs: cutoff, clock: clock, timeZone: utc, onPage: { log.page(json($0)) },
            onProgress: { log.report(progressJSON($0)) }))
      }
    }
  }
}
