// Ports src/posting/adviser/gate.js
//
// The posting adviser's read, bounded so it can never hold the composer
// indefinitely. A read settles exactly once, on whichever comes first:
//
//   result     the adviser answered
//   error      it failed (the composer fails open)
//   timeout    past its deadline; treated like an error
//   cancelled  the writer chose to publish anyway or keep editing
//
// Anything arriving after that is dropped. Pure apart from the timer, which
// is injected (setTimer/clearTimer), so the race is tested with a scripted
// clock. The composer's pre-publish check and the adviser button both read
// through it (AdviserReader, useAdviserRead.js).
//
// The web hands the work an AbortSignal (`ended.signal`) that aborts when the
// read ends without its answer. Here that is AdviserAbortSignal: aiService
// checks it before sending, and the context and style reads run their fetch
// under it (`signal.run`), as `fetch(url, { signal })` does. The read never
// cancels its work's task: a request already sent runs to its end, as it
// does on the web (the server counts it, and its usage is still recorded).

import Foundation
import VirgaCore

// MARK: - The signal

/// An AbortController and its signal in one: `aborted`, `abort()`, and work
/// run under it. Shared between the read and its work, so it is Sendable.
public final class AdviserAbortSignal: Sendable {
  private struct State {
    var aborted = false
    var next = 0
    var handlers: [Int: @Sendable () -> Void] = [:]
  }

  private let state = Locked(State())

  public init() {}

  /// `signal.aborted`.
  public var aborted: Bool { state.withLock { $0.aborted } }

  /// `controller.abort()`: once; every waiting handler runs.
  public func abort() {
    let handlers = state.withLock { state -> [@Sendable () -> Void] in
      if state.aborted { return [] }
      state.aborted = true
      defer { state.handlers = [:] }
      return state.handlers.sorted { $0.key < $1.key }.map(\.value)
    }
    for handler in handlers { handler() }
  }

  /// Runs `handler` when the signal aborts (at once if it already has). The
  /// id removes it again.
  @discardableResult
  func onAbort(_ handler: @escaping @Sendable () -> Void) -> Int? {
    let id = state.withLock { state -> Int? in
      if state.aborted { return nil }
      state.next += 1
      state.handlers[state.next] = handler
      return state.next
    }
    if id == nil { handler() }
    return id
  }

  func removeHandler(_ id: Int?) {
    guard let id else { return }
    state.withLock { _ = $0.handlers.removeValue(forKey: id) }
  }

  /// `fetch(url, { signal })`: `work` in a task of its own that is cancelled
  /// when the signal aborts (or the caller is cancelled), so the request
  /// stops and the caller sees its CancellationError.
  public func run<T: Sendable>(_ work: @escaping @Sendable () async throws -> T) async throws -> T {
    let task = Task { try await work() }
    let id = onAbort { task.cancel() }
    defer { removeHandler(id) }
    return try await withTaskCancellationHandler {
      try await task.value
    } onCancel: {
      task.cancel()
    }
  }
}

extension Optional where Wrapped == AdviserAbortSignal {
  /// `signal?.aborted`.
  var aborted: Bool { self?.aborted ?? false }

  /// `fetch(url, { signal })` for an optional signal.
  func run<T: Sendable>(_ work: @escaping @Sendable () async throws -> T) async throws -> T {
    if let signal = self { return try await signal.run(work) }
    return try await work()
  }
}

// MARK: - Choices

/// What the writer can do while the adviser reads (ADVISER_CHOICES).
public enum AdviserChoice: String, Codable, CaseIterable, Hashable, Sendable {
  case publish
  case edit
}

// MARK: - A read

/// How a read ended (`{ outcome, result?, error?, choice? }`).
public struct AdviserReadEnded<Result: Sendable>: Sendable {
  public enum Outcome: String, Codable, Hashable, Sendable {
    case result, error, timeout, cancelled
  }

  public var outcome: Outcome
  public var result: Result?
  public var error: (any Error)?
  public var choice: AdviserChoice?

  public init(outcome: Outcome, result: Result? = nil, error: (any Error)? = nil, choice: AdviserChoice? = nil) {
    self.outcome = outcome
    self.result = result
    self.error = error
    self.choice = choice
  }
}

/// One read under way (`{ promise, cancel, isSettled }`).
public final class AdviserRead<Result: Sendable>: Sendable {
  public typealias Ended = AdviserReadEnded<Result>

  private struct State {
    var ended: Ended?
    var waiters: [CheckedContinuation<Ended, Never>] = []
    var timer: Int?
    var work: Task<Void, Never>?
  }

  private let state = Locked(State())
  /// The signal the work was handed (`ended.signal`).
  public let signal = AdviserAbortSignal()
  let clearTimer: PublishWatch.ClearTimer

  init(clearTimer: @escaping PublishWatch.ClearTimer) {
    self.clearTimer = clearTimer
  }

  /// `await read.promise`: how the read ended.
  public var value: Ended {
    get async {
      await withCheckedContinuation { (continuation: CheckedContinuation<Ended, Never>) in
        let ended = state.withLock { state -> Ended? in
          if let ended = state.ended { return ended }
          state.waiters.append(continuation)
          return nil
        }
        if let ended { continuation.resume(returning: ended) }
      }
    }
  }

  /// `read.isSettled()`.
  public var isSettled: Bool { state.withLock { $0.ended != nil } }

  /// `read.cancel(choice)`: settles as cancelled, or false when it already
  /// settled.
  @discardableResult
  public func cancel(_ choice: AdviserChoice) -> Bool {
    settle(Ended(outcome: .cancelled, choice: choice))
  }

  /// The work's own task, for tests that wait until a late answer has been
  /// dropped.
  var workTask: Task<Void, Never>? { state.withLock { $0.work } }

  @discardableResult
  func settle(_ value: Ended) -> Bool {
    let taken = state.withLock { state -> (timer: Int?, waiters: [CheckedContinuation<Ended, Never>])? in
      if state.ended != nil { return nil }
      state.ended = value
      defer {
        state.waiters = []
        state.timer = nil
      }
      return (state.timer, state.waiters)
    }
    guard let taken else { return false }
    if let timer = taken.timer { clearTimer(timer) }
    if value.outcome == .timeout || value.outcome == .cancelled { signal.abort() }
    for waiter in taken.waiters { waiter.resume(returning: value) }
    return true
  }

  func setTimer(_ id: Int) {
    let settled = state.withLock { state -> Bool in
      if state.ended != nil { return true }
      state.timer = id
      return false
    }
    if settled { clearTimer(id) }
  }

  func setWork(_ task: Task<Void, Never>) {
    state.withLock { $0.work = task }
  }
}

/// `withinMs`'s rejection: `timed out after <ms>ms`.
public struct AdviserDeadlineError: Error, LocalizedError, Hashable, Sendable {
  public var ms: Double
  public var message: String { "timed out after \(JSNumber.format(ms))ms" }
  public var errorDescription: String? { message }
}

public enum AdviserGate {
  /// Longest a pre-publish check may hold a post; past it the composer fails
  /// open as on an error.
  public static let adviserGateTimeoutMs: Double = 10000

  /// How long the read waits for a reply's thread context; past it the
  /// adviser reads against the parent post alone.
  public static let adviserContextTimeoutMs: Double = 4000

  /// `ADVISER_CHOICES`: `{ PUBLISH: 'publish', EDIT: 'edit' }`.
  public static let adviserChoices: [String: AdviserChoice] = ["PUBLISH": .publish, "EDIT": .edit]

  /// Busy-surface button labels.
  public static let adviserChoiceLabels: [AdviserChoice: String] = [.publish: "Publish anyway", .edit: "Keep editing"]

  /// Choices a read offers: the pre-publish check offers both; a read
  /// requested from the adviser button has nothing to publish past.
  public static func adviserReadChoices(_ gate: Bool) -> [AdviserChoice] {
    gate ? [.publish, .edit] : [.edit]
  }

  /// The error a read reports when its deadline passes.
  public static let adviserTimeoutMessage =
    "The adviser took too long to answer, so it has not read this draft. You can still publish it as it is."

  /// Start a read that settles once: on its answer, its failure, its
  /// deadline (`timeoutMs`, nil for none), or the writer's choice.
  ///
  /// `work` is handed the read's signal, which aborts when the read ends
  /// without its answer: on the deadline or the writer's choice. It starts
  /// on a task of its own (the web's microtask), so a work that throws at
  /// once still settles as an error.
  public static func startAdviserRead<Result: Sendable>(
    _ work: @escaping @Sendable (AdviserAbortSignal) async throws -> Result,
    timeoutMs: Double? = nil,
    setTimer: PublishWatch.SetTimer? = nil,
    clearTimer: PublishWatch.ClearTimer? = nil
  ) -> AdviserRead<Result> {
    let timers = setTimer.map { ($0, clearTimer ?? { _ in }) } ?? PublishWatch.taskTimers()
    let read = AdviserRead<Result>(clearTimer: timers.1)
    if let timeoutMs {
      let id = timers.0(timeoutMs) { [weak read] in read?.settle(AdviserReadEnded(outcome: .timeout)) }
      read.setTimer(id)
    }
    let signal = read.signal
    read.setWork(
      Task { [read] in
        do {
          let result = try await work(signal)
          read.settle(AdviserReadEnded(outcome: .result, result: result))
        } catch {
          read.settle(AdviserReadEnded(outcome: .error, error: error))
        }
      })
    return read
  }

  /// `setTimeout`'s wait as a sleep, for withinMs: returns early when the
  /// task is cancelled.
  public static let taskSleep: @Sendable (Double) async -> Void = { ms in
    try? await Task.sleep(for: PromiseRace.timerDelay(ms))
  }

  /// `withinMs(promise, ms)`: the work's answer, or AdviserDeadlineError
  /// when `ms` passes first. For the steps inside a read that have their own
  /// fallback on failure. The loser is cancelled once the race is decided
  /// (the web's promise is simply no longer waited for).
  public static func withinMs<T: Sendable>(
    _ ms: Double,
    sleep: @escaping @Sendable (Double) async -> Void = AdviserGate.taskSleep,
    _ work: @escaping @Sendable () async throws -> T
  ) async throws -> T {
    let race = DeadlineRace<T>()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, any Error>) in
        race.start(
          continuation,
          work: Task {
            do { race.finish(.success(try await work())) } catch { race.finish(.failure(error)) }
          },
          timer: Task {
            await sleep(ms)
            if Task.isCancelled { return }
            race.finish(.failure(AdviserDeadlineError(ms: ms)))
          })
      }
    } onCancel: {
      race.cancelWork()
    }
  }

  /// One withinMs race: the continuation to resume once, and the two tasks
  /// to cancel when it is decided.
  final class DeadlineRace<T: Sendable>: Sendable {
    private struct State {
      var continuation: CheckedContinuation<T, any Error>?
      var result: Result<T, any Error>?
      var tasks: [Task<Void, Never>] = []
    }

    private let state = Locked(State())

    func start(_ continuation: CheckedContinuation<T, any Error>, work: Task<Void, Never>, timer: Task<Void, Never>) {
      let early = state.withLock { state -> Result<T, any Error>? in
        state.tasks = [work, timer]
        if let result = state.result { return result }
        state.continuation = continuation
        return nil
      }
      if let early {
        work.cancel()
        timer.cancel()
        continuation.resume(with: early)
      }
    }

    func finish(_ result: Result<T, any Error>) {
      let (continuation, tasks) = state.withLock {
        state -> (CheckedContinuation<T, any Error>?, [Task<Void, Never>]) in
        if state.result != nil { return (nil, []) }
        state.result = result
        defer { state.continuation = nil }
        return (state.continuation, state.tasks)
      }
      for task in tasks { task.cancel() }
      continuation?.resume(with: result)
    }

    func cancelWork() {
      let tasks = state.withLock { $0.tasks }
      tasks.first?.cancel()
    }
  }
}
