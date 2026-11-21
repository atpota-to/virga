// Ports src/defense/limit.js
//
// Run async work over a list with at most `limit` in flight at once. The
// AppView's batch reads (25 profiles, 30 relationships a call) made one
// after another would make scoring a 2,000-account scan wait on 150 round
// trips in a row; a handful in flight cuts that by several times while
// staying well under what one account should ask of the AppView.
//
// The web's AbortSignal is Swift's task cancellation: an item is never
// started once the calling task is cancelled, and `pause` ends early.

import Foundation
import VirgaCore

public enum Limit {
  /// APPVIEW_CONCURRENCY: how many AppView batch reads may be in flight at once.
  public static let appviewConcurrency = 6

  /// `fn` over every item, at most `limit` at a time, results in input
  /// order. The first error fails the whole call, as Promise.all does, and
  /// no further items are started after it, nor after the task is
  /// cancelled. (Items already in flight are cancelled and awaited, where
  /// the web leaves them to finish unread.)
  ///
  /// `stopsWhenCancelled: false` is the web's call without `{ signal }`
  /// (harvest.js's): every item is still started once the task is
  /// cancelled, and `fn` decides what a stop means for it.
  public static func mapLimit<T: Sendable, R: Sendable>(
    _ items: [T],
    _ limit: Int,
    stopsWhenCancelled: Bool = true,
    _ fn: @escaping @Sendable (_ item: T, _ index: Int) async throws -> R
  ) async throws -> [R] {
    let lanes = Swift.max(1, Swift.min(limit, items.count))
    let state = Locked((next: 0, failed: false))
    let count = items.count
    return try await withThrowingTaskGroup(of: [(Int, R)].self) { group in
      for _ in 0..<lanes {
        group.addTask {
          var done: [(Int, R)] = []
          while state.withLock({ !$0.failed && $0.next < count }) {
            if stopsWhenCancelled { try Task.checkCancellation() }
            let taken: Int? = state.withLock { s in
              guard !s.failed, s.next < count else { return nil }
              s.next += 1
              return s.next - 1
            }
            guard let i = taken else { break }
            do {
              done.append((i, try await fn(items[i], i)))
            } catch {
              state.withLock { $0.failed = true }
              throw error
            }
          }
          return done
        }
      }
      var out = [R?](repeating: nil, count: count)
      for try await finished in group {
        for (i, value) in finished { out[i] = value }
      }
      return out.map { $0! }
    }
  }

  /// `items` cut into consecutive slices of `size` (at least 1: the web's
  /// loop would never end on 0).
  public static func chunks<T>(_ items: [T], _ size: Int) -> [[T]] {
    precondition(size > 0, "chunks needs a size of at least 1")
    return stride(from: 0, to: items.count, by: size).map { Array(items[$0..<Swift.min($0 + size, items.count)]) }
  }

  /// Returns after `ms` milliseconds, or at once when the task is cancelled
  /// (it never throws). Nothing to wait for when `ms` is 0, NaN or less.
  public static func pause(_ ms: Double) async {
    guard ms > 0, !Task.isCancelled else { return }
    try? await Task.sleep(nanoseconds: UInt64(Swift.min(ms, 1e12) * 1_000_000))
  }
}
