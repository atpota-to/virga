// Helpers for the publish domain's parity tests (the publish.*.js fixtures,
// written with ios/parity/cases/_publish.js).

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
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
/// fired (`fired: [[ms, n, requests]]`, the n-th wait of `ms`) end once the
/// transport has had `requests` requests, as they went off on the web; the
/// others end only when called off (a timer cleared because its race was
/// decided).
final class ScriptedTimers: Sendable {
  private let state = Locked<(waits: [Double], seen: [Double: Int])>(([], [:]))
  let fire: [(ms: Double, n: Int, requests: Int)]
  let now: Double
  let transport: CountingTransport?

  init(_ fired: JSONValue?, transport: CountingTransport? = nil, now: Double = PublishFixture.now) {
    self.fire = (fired?.arrayValue ?? []).compactMap { entry in
      guard let ms = entry[0]?.doubleValue, let n = entry[1]?.intValue else { return nil }
      return (ms, n, entry[2]?.intValue ?? 0)
    }
    self.transport = transport
    self.now = now
  }

  var waits: [Double] { state.withLock { $0.waits } }

  func sleep(_ ms: Double) async {
    let fires = state.withLock { state -> (ms: Double, n: Int, requests: Int)? in
      state.waits.append(ms)
      let n = state.seen[ms] ?? 0
      state.seen[ms] = n + 1
      return fire.first { $0.ms == ms && $0.n == n }
    }
    if let fires {
      await transport?.waitFor(fires.requests)
      return
    }
    while !Task.isCancelled { try? await Task.sleep(nanoseconds: 3_600_000_000_000) }
  }

  var clock: NetworkClock {
    NetworkClock(now: { [now] in now }, sleep: { [self] ms in await sleep(ms) })
  }
}

/// A transport that counts what it is sent, so a wait can be held until a
/// request has gone out.
final class CountingTransport: HTTPTransport, Sendable {
  let base: MockTransport
  private let state = Locked<(count: Int, waiters: [(Int, CheckedContinuation<Void, Never>)])>((0, []))

  init(_ base: MockTransport) { self.base = base }

  var requests: [HTTPRequest] { base.requests }

  func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    let ready = state.withLock { state -> [CheckedContinuation<Void, Never>] in
      state.count += 1
      let count = state.count
      let ready = state.waiters.filter { $0.0 <= count }.map(\.1)
      state.waiters.removeAll { $0.0 <= count }
      return ready
    }
    for waiter in ready { waiter.resume() }
    return try await base.send(request)
  }

  /// Returns once `count` requests have been sent.
  func waitFor(_ count: Int) async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let now = state.withLock { state -> Bool in
        if state.count >= count { return true }
        state.waiters.append((count, continuation))
        return false
      }
      if now { continuation.resume() }
    }
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

/// _publish.js's scriptedImages: the re-encode and decode, scripted
/// (`compress`: `{ size }`, null or 'throw', default `{ size: 5 }`;
/// `decode`: `{ width, height }`, null or 'throw', default null), each call
/// recorded with its file as a fixture's marker (no lastModified, no ref).
actor PublishEncoder: ImageEncoder {
  let script: JSONValue
  var calls: [JSONValue] = []

  init(_ script: JSONValue?) { self.script = script ?? [:] }

  static func marker(_ file: ComposerFile) -> JSONValue {
    var json = file.json
    json["lastModified"] = nil
    json["ref"] = nil
    return json
  }

  func compress(_ file: ComposerFile, _ options: ImageCompressOptions) async throws -> ComposerFile? {
    calls.append(["compress", Self.marker(file), (try? JSONValue(encoding: options)) ?? .null])
    let spec = script.objectValue?.keys.contains("compress") == true ? script["compress"] ?? .null : ["size": 5]
    switch spec {
    case "throw": throw JSError(message: "decoder blew up")
    case .null: return nil
    default: return ComposerFile(type: "", size: spec["size"]?.doubleValue ?? 0)
    }
  }

  func decodeSize(_ file: ComposerFile) async throws -> ImageSize? {
    calls.append(["decode", Self.marker(file)])
    switch script["decode"] {
    case "throw"?: throw JSError(message: "cannot decode")
    case let spec? where spec.isTruthy:
      return ImageSize(width: spec["width"]?.doubleValue ?? 0, height: spec["height"]?.doubleValue ?? 0)
    default: return nil
    }
  }
}

/// The media a recorded case publishes with.
func publishMedia(_ transport: any HTTPTransport, _ timers: ScriptedTimers, encoder: PublishEncoder) -> PublishMedia {
  PublishMedia(
    files: InMemoryComposerFiles(now: { PublishFixture.now }), encoder: encoder, transport: transport,
    clock: timers.clock)
}
