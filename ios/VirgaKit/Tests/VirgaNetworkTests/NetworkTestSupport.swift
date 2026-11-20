// Helpers shared by VirgaNetwork's tests.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaNetwork

enum Fixed {
  /// FIXED_NOW in ios/parity/cases/_helpers.js.
  static let now: Double = 1_773_576_000_000
  static let did = "did:plc:virgaharnessmira2zq4x"
  static let token = "vg_" + String(repeating: "0f", count: 32)
  static let server = "https://server.example"
}

/// Records what a callback heard, across tasks.
final class Heard: @unchecked Sendable {
  private let lock = NSLock()
  private var unauthorizedCalls: [JSONValue] = []
  private var authorizedCalls: [JSONValue] = []

  var unauthorized: [JSONValue] {
    lock.lock()
    defer { lock.unlock() }
    return unauthorizedCalls
  }

  var authorized: [JSONValue] {
    lock.lock()
    defer { lock.unlock() }
    return authorizedCalls
  }

  var onUnauthorized: @Sendable (String?, JSONValue?) -> Void {
    { [self] did, code in
      lock.lock()
      unauthorizedCalls.append(["did": did.map(JSONValue.string) ?? .null, "code": code ?? .null])
      lock.unlock()
    }
  }

  var onAuthorized: @Sendable (String?) -> Void {
    { [self] did in
      lock.lock()
      authorizedCalls.append(did.map(JSONValue.string) ?? .null)
      lock.unlock()
    }
  }
}

extension JSONValue {
  /// Any Encodable, for comparing with a fixture.
  static func of<T: Encodable>(_ value: T) -> JSONValue {
    (try? JSONValue(encoding: value)) ?? .null
  }

  /// The ordered keys a generator recorded beside an object (`keys`), with
  /// the object's values: the web's insertion order, which JSONValue loses.
  func ordered(by keys: JSONValue?) -> [(String, JSONValue?)] {
    let names = keys?.arrayValue?.compactMap(\.stringValue) ?? objectValue?.keys.sorted() ?? []
    return names.map { ($0, self[$0]) }
  }
}

/// A recorded case run against the port: the requests, waits and result
/// must all match. `ordered: false` for code that sends side by side.
func expectReplay(
  _ c: ParityCase,
  ordered: Bool = true,
  checkWaits: Bool = true,
  sourceLocation: SourceLocation = #_sourceLocation,
  _ run: (MockTransport, RecordingClock) async throws -> JSONValue
) async {
  let recording = RecordedFetch(c.output)
  let transport = recording.transport()
  let clock = RecordingClock(now: Fixed.now)
  let result = await RecordedFetch.outcome { try await run(transport, clock) }
  let d = recording.check(sent: transport.requests, result: result, waits: checkWaits ? clock.waits : nil, ordered: ordered)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
}
