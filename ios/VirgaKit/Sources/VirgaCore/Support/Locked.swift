// A value behind a lock, for the few places the web app keeps module-level
// mutable state (the active locale, caches) and Swift 6 needs it to be safe
// across threads. Synchronization.Mutex needs iOS 18; this works on 17.

import Foundation

public final class Locked<Value>: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Value

  public init(_ value: Value) {
    self.value = value
  }

  /// The current value.
  public var wrappedValue: Value {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  /// Reads or changes the value under the lock.
  @discardableResult
  public func withLock<Result>(_ body: (inout Value) throws -> Result) rethrows -> Result {
    lock.lock()
    defer { lock.unlock() }
    return try body(&value)
  }

  public func set(_ newValue: Value) {
    withLock { $0 = newValue }
  }
}
