// Scripted time and hand-opened gates for the adviser's behaviour tests:
// nothing here waits on a clock or counts yields, so the tests are
// deterministic however loaded the machine is.

import Foundation
import Testing
import VirgaCore
@testable import VirgaPosting

/// A one-shot gate: `wait()` suspends until `open(value)`; a gate already
/// open answers at once. Safe to open from anywhere, once (later opens are
/// ignored).
final class AdviserGateLatch<Value: Sendable>: Sendable {
  private struct State {
    var value: Value?
    var waiters: [CheckedContinuation<Value, Never>] = []
  }

  private let state = Locked(State())

  init() {}

  func wait() async -> Value {
    await withCheckedContinuation { continuation in
      let value = state.withLock { state -> Value? in
        if let value = state.value { return value }
        state.waiters.append(continuation)
        return nil
      }
      if let value { continuation.resume(returning: value) }
    }
  }

  func open(_ value: Value) {
    let waiters = state.withLock { state -> [CheckedContinuation<Value, Never>] in
      if state.value != nil { return [] }
      state.value = value
      defer { state.waiters = [] }
      return state.waiters
    }
    for waiter in waiters { waiter.resume(returning: value) }
  }

  var isOpen: Bool { state.withLock { $0.value != nil } }
}

extension AdviserGateLatch where Value == Void {
  func open() { open(()) }
}

/// A queue of gates handed out in turn, for work called several times: the
/// n-th call waits on `gate(n)`, and `called(n)` opens once it has started.
final class AdviserScript<Value: Sendable>: Sendable {
  private let gates = Locked<[AdviserGateLatch<Value>]>([])
  private let starts = Locked<[AdviserGateLatch<Void>]>([])
  private let count = Locked(0)

  private func ensure(_ index: Int) -> (AdviserGateLatch<Value>, AdviserGateLatch<Void>) {
    let gate = gates.withLock { list -> AdviserGateLatch<Value> in
      while list.count <= index { list.append(AdviserGateLatch()) }
      return list[index]
    }
    let start = starts.withLock { list -> AdviserGateLatch<Void> in
      while list.count <= index { list.append(AdviserGateLatch()) }
      return list[index]
    }
    return (gate, start)
  }

  /// The work's side: note the call, then wait for its answer.
  func next() async -> Value {
    let index = count.withLock { n -> Int in
      defer { n += 1 }
      return n
    }
    let (gate, start) = ensure(index)
    start.open()
    return await gate.wait()
  }

  /// The test's side: wait until call `index` (from 0) has started.
  func called(_ index: Int) async { await ensure(index).1.wait() }

  /// Answer call `index`.
  func answer(_ index: Int, _ value: Value) { ensure(index).0.open(value) }

  var calls: Int { count.withLock { $0 } }
}

/// setTimeout on the main actor, run by hand.
@MainActor final class ManualMainTimers {
  struct Timer {
    var ms: Double
    var fn: @MainActor () -> Void
    var live: Bool
  }

  var timers: [Timer] = []

  var set: MainActorSetTimer {
    { [unowned self] ms, fn in
      self.timers.append(Timer(ms: ms, fn: fn, live: true))
      return self.timers.count - 1
    }
  }

  var clear: MainActorClearTimer {
    { [unowned self] id in if self.timers.indices.contains(id) { self.timers[id].live = false } }
  }

  /// Runs every live timer due by `ms`.
  func run(upTo ms: Double) {
    for i in timers.indices where timers[i].live && timers[i].ms <= ms {
      timers[i].live = false
      timers[i].fn()
    }
  }

  var live: Int { timers.filter(\.live).count }
}
