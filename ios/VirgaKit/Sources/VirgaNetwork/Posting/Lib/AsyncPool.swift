// Ports src/posting/lib/asyncPool.js
//
// mapWithConcurrency: `fn` over `items` with at most `limit` calls in
// flight, results in input order. Like Promise.all it fails with the first
// failure, and as in the web the calls already running are not stopped by
// it (each worker stops at its own failure; the others go on through the
// list). Cancelling the calling task cancels them all, which is the web's
// AbortSignal threaded into `fn`.

import Foundation
import VirgaCore

public enum AsyncPool {
  /// `Math.max(1, Math.min(Math.floor(limit) || 1, length))`.
  public static func poolSize(_ limit: Double, count: Int) -> Int {
    var floored = limit.rounded(.down)
    if floored.isNaN || floored == 0 { floored = 1 }
    return Int(max(1, min(floored, Double(count))))
  }

  /// `mapWithConcurrency(items, limit, fn)`.
  public static func mapWithConcurrency<T: Sendable, R: Sendable>(
    _ items: [T],
    _ limit: Double,
    _ fn: @escaping @Sendable (T, Int) async throws -> R
  ) async throws -> [R] {
    if items.isEmpty { return [] }
    let size = poolSize(limit, count: items.count)
    let pool = Pool<R>(count: items.count)
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[R], any Error>) in
        pool.start(continuation, workers: size) {
          while let index = pool.next() {
            do {
              let result = try await fn(items[index], index)
              pool.store(result, at: index)
            } catch {
              pool.fail(error)
              return
            }
          }
        }
      }
    } onCancel: {
      pool.cancel()
    }
  }

  /// `mapWithConcurrency` with an integer limit.
  public static func mapWithConcurrency<T: Sendable, R: Sendable>(
    _ items: [T],
    _ limit: Int,
    _ fn: @escaping @Sendable (T, Int) async throws -> R
  ) async throws -> [R] {
    try await mapWithConcurrency(items, Double(limit), fn)
  }

  final class Pool<R: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var cursor = 0
    private let count: Int
    private var results: [R?]
    private var running = 0
    private var continuation: CheckedContinuation<[R], any Error>?
    private var tasks: [Task<Void, Never>] = []
    private var cancelled = false

    init(count: Int) {
      self.count = count
      self.results = Array(repeating: nil, count: count)
    }

    func start(_ continuation: CheckedContinuation<[R], any Error>, workers: Int, body: @escaping @Sendable () async -> Void) {
      lock.lock()
      self.continuation = continuation
      running = workers
      let alreadyCancelled = cancelled
      lock.unlock()
      var started: [Task<Void, Never>] = []
      for _ in 0..<workers {
        started.append(
          Task {
            await body()
            self.workerFinished()
          })
      }
      lock.lock()
      tasks = started
      lock.unlock()
      if alreadyCancelled { cancel() }
    }

    func next() -> Int? {
      lock.lock()
      defer { lock.unlock() }
      guard cursor < count else { return nil }
      defer { cursor += 1 }
      return cursor
    }

    func store(_ value: R, at index: Int) {
      lock.lock()
      results[index] = value
      lock.unlock()
    }

    func fail(_ error: any Error) {
      lock.lock()
      let held = continuation
      continuation = nil
      lock.unlock()
      held?.resume(throwing: error)
    }

    func workerFinished() {
      lock.lock()
      running -= 1
      var finished: CheckedContinuation<[R], any Error>?
      var values: [R] = []
      if running == 0, let held = continuation {
        continuation = nil
        finished = held
        values = results.map { $0! }
      }
      lock.unlock()
      finished?.resume(returning: values)
    }

    func cancel() {
      lock.lock()
      cancelled = true
      let running = tasks
      lock.unlock()
      for task in running { task.cancel() }
    }
  }
}
