// Helpers shared by VirgaSession's tests.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaSession

enum Fixed {
  /// FIXED_NOW in ios/parity/cases/_helpers.js.
  static let now: Double = 1_773_576_000_000
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

/// An error as the generators record it: `{ name, message, status, code }`.
func errorShape(_ error: any Error) -> JSONValue {
  let fields = JSErrorFields(error) ?? JSErrorFields(message: jsMessage(error))
  return [
    "name": .string(fields.name), "message": .string(fields.message),
    "status": fields.status.map { .number(Double($0)) } ?? .null, "code": fields.code ?? .null,
  ]
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

/// The value as the fixture compares it, or a description of the failure.
func expectParity(_ actual: JSONValue, _ c: ParityCase, sourceLocation: SourceLocation = #_sourceLocation) {
  let d = Parity.diff(actual, c.output)
  #expect(d == nil, "\(c) \(c.input): \(d ?? "")", sourceLocation: sourceLocation)
}

/// The repository's root, found from this file's path.
enum Repo {
  static var root: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // VirgaSessionTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // VirgaKit
      .deletingLastPathComponent()  // ios
      .deletingLastPathComponent()  // repo
  }

  static func text(_ name: String) throws -> String {
    try String(contentsOf: root.appendingPathComponent(name), encoding: .utf8)
  }
}
