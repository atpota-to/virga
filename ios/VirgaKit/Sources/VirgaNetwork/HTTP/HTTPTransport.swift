// How a request is sent, and the time it is allowed: the web's `fetch` and
// its `AbortSignal.timeout`, `setTimeout` and `Date.now()`, injected.
//
// Every network function in VirgaNetwork takes `transport:` (defaulting to
// `HTTP.transport`, the app's one, as the web's functions default to the
// global `fetch`) and, where it waits or reads the clock, a `NetworkClock`.
// Cancelling the Swift task is the web's AbortSignal being aborted by its
// caller.

import Foundation
import VirgaCore

/// Sends one request: `fetch(url, init)`.
public protocol HTTPTransport: Sendable {
  /// The response, whatever its status. Throws `HTTPTransportError` when
  /// there is none (the network failed, the request's `timeoutMs` passed),
  /// and `CancellationError` when the task is cancelled.
  func send(_ request: HTTPRequest) async throws -> HTTPResponse
}

/// The clock network code waits on and reads: `setTimeout` and `Date.now()`.
public struct NetworkClock: Sendable {
  /// Epoch milliseconds, as `Date.now()`.
  public var now: @Sendable () -> Double
  /// Waits `ms` milliseconds. Returns early, without throwing, when the task
  /// is cancelled (the web's waits resolve on an abort, and the caller then
  /// looks at its signal).
  public var sleep: @Sendable (_ ms: Double) async -> Void

  public init(now: @escaping @Sendable () -> Double, sleep: @escaping @Sendable (_ ms: Double) async -> Void) {
    self.now = now
    self.sleep = sleep
  }

  /// The system clock and real waits.
  public static let live = NetworkClock(
    now: { Date().timeIntervalSince1970 * 1000 },
    sleep: { ms in
      guard ms > 0 else { await Task.yield(); return }
      try? await Task.sleep(nanoseconds: UInt64(min(ms, 9.0e12) * 1_000_000))
    }
  )

  /// A clock that never waits and always reads `now`: for tests and the
  /// demo. (Tests that check the waits use VirgaTestSupport's RecordingClock.)
  public static func instant(now: Double) -> NetworkClock {
    NetworkClock(now: { now }, sleep: { _ in await Task.yield() })
  }
}

/// The app's transport and clock, as the web's global `fetch`, `setTimeout`
/// and `Date.now`: what a network function uses when it isn't given one.
/// The app leaves the live ones; the demo and UI tests set a MockTransport.
public enum HTTP {
  private static let state = Locked<(any HTTPTransport, NetworkClock)>((URLSessionTransport(), .live))

  public static var transport: any HTTPTransport {
    get { state.withLock { $0.0 } }
    set { state.withLock { $0.0 = newValue } }
  }

  public static var clock: NetworkClock {
    get { state.withLock { $0.1 } }
    set { state.withLock { $0.1 = newValue } }
  }
}

/// Runs `operation` with a deadline of `ms` milliseconds (none when nil),
/// throwing `HTTPTransportError.timedOut` when it passes, as a fetch given
/// `AbortSignal.timeout(ms)` rejects. The operation is cancelled then.
public func withDeadline<T: Sendable>(
  ms: Double?,
  _ operation: @escaping @Sendable () async throws -> T
) async throws -> T {
  guard let ms, ms.isFinite else { return try await operation() }
  return try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask { try await operation() }
    group.addTask {
      try await Task.sleep(nanoseconds: UInt64(max(0, min(ms, 9.0e12)) * 1_000_000))
      throw HTTPTransportError.timedOut
    }
    defer { group.cancelAll() }
    guard let first = try await group.next() else { throw CancellationError() }
    return first
  }
}
