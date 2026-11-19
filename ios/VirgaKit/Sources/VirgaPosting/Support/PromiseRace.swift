// `Promise.race([work, timeout])` for the posting ports: the value of the
// work, or a fallback once the time is up, whichever comes first.
//
// A task group can't stand in for it: a group returns only once every child
// has finished, so work that doesn't stop when it is cancelled (a request
// that ignores cancellation) would hold the caller past its timeout. A
// promise that loses a race is simply no longer waited for; here the loser is
// cancelled and not waited for either.

import Foundation
import VirgaCore

enum PromiseRace {
  /// The value `work` returns, or `fallback` when `timeoutMs` passes first
  /// (or the caller is cancelled). The work is cancelled once the race is
  /// decided either way, and nothing waits for it to stop.
  static func race<T: Sendable>(
    timeoutMs: Double,
    fallback: T,
    _ work: @escaping @Sendable () async -> T
  ) async -> T {
    let race = Race<T>()
    return await withTaskCancellationHandler {
      await withCheckedContinuation { (continuation: CheckedContinuation<T, Never>) in
        race.start(
          continuation,
          work: Task { race.finish(await work()) },
          timer: Task {
            try? await Task.sleep(for: .milliseconds(max(0, timeoutMs)))
            race.finish(fallback)
          })
      }
    } onCancel: {
      race.finish(fallback)
    }
  }

  /// One race's state: the continuation to resume once, and the two tasks to
  /// cancel when it is decided.
  final class Race<T: Sendable>: Sendable {
    private struct State {
      var continuation: CheckedContinuation<T, Never>?
      var result: T?
      var tasks: [Task<Void, Never>] = []
      var decided = false
    }

    private let state = Locked(State())

    func start(_ continuation: CheckedContinuation<T, Never>, work: Task<Void, Never>, timer: Task<Void, Never>) {
      let early: T? = state.withLock { state in
        state.tasks = [work, timer]
        if state.decided { return state.result }
        state.continuation = continuation
        return nil
      }
      if let early {
        work.cancel()
        timer.cancel()
        continuation.resume(returning: early)
      }
    }

    func finish(_ value: T) {
      let (continuation, tasks): (CheckedContinuation<T, Never>?, [Task<Void, Never>]) = state.withLock { state in
        if state.decided { return (nil, []) }
        state.decided = true
        state.result = value
        defer { state.continuation = nil }
        return (state.continuation, state.tasks)
      }
      for task in tasks { task.cancel() }
      continuation?.resume(returning: value)
    }
  }
}
