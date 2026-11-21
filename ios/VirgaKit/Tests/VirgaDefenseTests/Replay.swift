// Replaying a recorded case (ios/parity/cases/_fetch.js) against a Defense
// port: VirgaNetworkTests' expectReplay, for this target. The port must send
// the requests the web sent (in order, or in any order for reads made side
// by side), wait the waits, and reach the same result.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport

enum Fixed {
  /// FIXED_NOW in ios/parity/cases/_helpers.js.
  static let now: Double = 1_773_576_000_000
}

extension JSONValue {
  /// Any Encodable, for comparing with a fixture.
  static func of<T: Encodable>(_ value: T) -> JSONValue {
    (try? JSONValue(encoding: value)) ?? .null
  }
}

/// A Date at epoch milliseconds.
func date(ms: Double) -> Date {
  Date(timeIntervalSince1970: ms / 1000)
}

/// A recorded case run against the port. `ordered: false` for reads made
/// side by side; `sortedWaits` compares the waits as a multiset, for the
/// same reason.
func expectReplay(
  _ c: ParityCase,
  ordered: Bool = true,
  sortedWaits: Bool = false,
  sourceLocation: SourceLocation = #_sourceLocation,
  _ run: (MockTransport, RecordingClock) async throws -> JSONValue
) async {
  let recording = RecordedFetch(c.output)
  let transport = recording.transport()
  let clock = RecordingClock(now: Fixed.now)
  let result = await RecordedFetch.outcome { try await run(transport, clock) }
  let d = recording.check(sent: transport.requests, result: result, waits: nil, ordered: ordered)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
  let waits = sortedWaits ? clock.waits.sorted() : clock.waits
  let expected = sortedWaits ? recording.waits.sorted() : recording.waits
  #expect(waits == expected, "\(c): waited \(waits), the web waited \(expected)", sourceLocation: sourceLocation)
}

/// Collects what a callback heard, across tasks, in the order it heard it.
final class Heard<T: Sendable>: Sendable {
  private let items = Locked<[T]>([])

  var all: [T] { items.wrappedValue }

  func add(_ item: T) {
    items.withLock { $0.append(item) }
  }
}
