// Helpers for the publish domain's parity tests (the publish.*.js fixtures,
// written with ios/parity/cases/_publish.js).

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

enum PublishFixture {
  static let server = "https://server.example"
  static let token = "vg_" + String(repeating: "0f", count: 32)
  static let me = "did:plc:writer"
  static let other = "did:plc:other"
  /// 2026-11-12T15:00:00.000Z, the generators' clock.
  static let now: Double = 1_794_495_600_000
  /// _publish.js's TID_CLOCK_ID.
  static let tidClockId: UInt64 = 7

  /// The write account's agent, through Virga's server.
  static func agent(_ transport: any HTTPTransport, did: String = me) -> XRPCAgent {
    XRPCAgent(did: did, fetchHandler: BackendFetchHandler(backendUrl: server, token: token, did: did, transport: transport))
  }
}

/// _publish.js's tidClock: createTidClock with a fixed clock id and whole
/// milliseconds, so the keys a run mints are the web run's.
final class FixedTIDs: Sendable {
  private let last = Locked<UInt64>(0)
  let clockId: UInt64

  init(clockId: UInt64 = PublishFixture.tidClockId) { self.clockId = clockId }

  func next(_ ms: Double) throws -> String {
    guard ms.isFinite else { throw TIDTimeError(ms: ms) }
    let micros = UInt64(ms.rounded(.down)) * 1000
    let value = last.withLock { last -> UInt64 in
      last = micros <= last ? last + 1 : micros
      return last
    }
    return TID.encode(micros: value, clockId: clockId)
  }

  var mint: @Sendable (Double) throws -> String { { [self] ms in try next(ms) } }
}

/// The clock of a recorded case: every wait is recorded; the waits the case
/// names (`fire: [[ms, n]]`, the n-th wait of `ms`) end at once, the others
/// only when called off (a timer cleared because its race was decided).
final class ScriptedTimers: Sendable {
  private let state = Locked<(waits: [Double], seen: [Double: Int])>(([], [:]))
  let fire: [(Double, Int)]
  let now: Double

  init(_ fire: JSONValue?, now: Double = PublishFixture.now) {
    self.fire = (fire?.arrayValue ?? []).compactMap { pair in
      guard let ms = pair[0]?.doubleValue, let n = pair[1]?.intValue else { return nil }
      return (ms, n)
    }
    self.now = now
  }

  var waits: [Double] { state.withLock { $0.waits } }

  func sleep(_ ms: Double) async {
    let fires = state.withLock { state -> Bool in
      state.waits.append(ms)
      let n = state.seen[ms] ?? 0
      state.seen[ms] = n + 1
      return fire.contains { $0.0 == ms && $0.1 == n }
    }
    if fires { return }
    while !Task.isCancelled { try? await Task.sleep(nanoseconds: 3_600_000_000_000) }
  }

  var clock: NetworkClock {
    NetworkClock(now: { [now] in now }, sleep: { [self] ms in await sleep(ms) })
  }
}

/// A transport answering each recorded request once (in any order); a
/// `{ $hang: true }` answer never comes.
func replayTransport(_ output: JSONValue) -> MockTransport {
  let transport = MockTransport()
  for (index, exchange) in (output["exchanges"]?.arrayValue ?? []).enumerated() {
    let recorded = exchange["request"] ?? .null
    let response = exchange["response"] ?? .null
    transport.on(
      .predicate("recorded request #\(index): \(recorded["url"]?.stringValue ?? "")") { request in
        RecordedFetch.difference(request, recorded) == nil
      }, times: 1
    ) { _ in try replayAnswer(response) }
  }
  return transport
}

func replayAnswer(_ response: JSONValue) throws -> MockTransport.Response {
  if response["$hang"] == .bool(true) { return .hang }
  if let message = response["$error"]?.stringValue { return .networkError(message) }
  var headers = HTTPHeaders()
  for (name, value) in (response["headers"]?.objectValue ?? [:]).sorted(by: { $0.key < $1.key }) {
    headers.append(name, value.stringValue ?? value.jsString)
  }
  var body = Data()
  if let text = response["body"]?["$text"]?.stringValue { body = Data(text.utf8) }
  if let base64 = response["body"]?["$bytes"]?.stringValue { body = Data(base64Encoded: base64) ?? Data() }
  return .response(HTTPResponse(status: response["status"]?.intValue ?? 200, headers: headers, body: body))
}

/// Checks a recorded case: the requests (in order), the waits and the result.
func checkReplay(
  _ c: ParityCase, sent: [HTTPRequest], result: JSONValue, waits: [Double]?, ordered: Bool = true,
  sourceLocation: SourceLocation = #_sourceLocation
) {
  let recorded = RecordedFetch(c.output)
  let d = recorded.check(sent: sent, result: result, waits: waits, ordered: ordered)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
}

/// What a call returned, or `{ $throws }` as the generators record a throw.
func publishOutcome(_ body: () async throws -> JSONValue) async -> JSONValue {
  do { return try await body() } catch { return ["$throws": .string(jsMessage(error))] }
}
