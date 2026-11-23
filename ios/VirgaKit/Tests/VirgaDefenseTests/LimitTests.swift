// src/defense/limit.js's behaviour: work over a list with a few in flight,
// in order, all or nothing, and stopped by cancellation; a pause that ends
// early when its task is cancelled.

import Foundation
import Testing
import VirgaCore
@testable import VirgaDefense

@Suite struct LimitBehaviour {
  @Test func resultsInInputOrderWithAtMostLimitInFlight() async throws {
    let gauge = Locked((now: 0, peak: 0))
    let out = try await Limit.mapLimit(Array(0..<40), 6) { item, index in
      gauge.withLock { $0.now += 1; $0.peak = max($0.peak, $0.now) }
      // Later items finish sooner, so order comes from the index, not the finish.
      try await Task.sleep(nanoseconds: UInt64((40 - item) * 200_000))
      gauge.withLock { $0.now -= 1 }
      #expect(item == index)
      return item * 2
    }
    #expect(out == Array(0..<40).map { $0 * 2 })
    #expect(gauge.wrappedValue.peak <= 6)
    #expect(gauge.wrappedValue.peak > 1)
  }

  @Test func nothingToDo() async throws {
    let out = try await Limit.mapLimit([Int](), 6) { item, _ in item }
    #expect(out.isEmpty)
    // A limit below one still runs one lane.
    let one = try await Limit.mapLimit([1, 2, 3], 0) { item, _ in item + 1 }
    #expect(one == [2, 3, 4])
  }

  struct Boom: Error {}

  @Test func theFirstErrorFailsTheCallAndStartsNothingMore() async throws {
    let started = Locked([Int]())
    await #expect(throws: Boom.self) {
      _ = try await Limit.mapLimit(Array(0..<100), 1) { item, _ in
        started.withLock { $0.append(item) }
        if item == 3 { throw Boom() }
        return item
      }
    }
    #expect(started.wrappedValue == [0, 1, 2, 3])
  }

  @Test func cancellationStartsNothingMore() async throws {
    let started = Locked(0)
    let task = Task {
      try await Limit.mapLimit(Array(0..<1000), 2) { item, _ in
        started.withLock { $0 += 1 }
        try await Task.sleep(nanoseconds: 2_000_000)
        return item
      }
    }
    try await Task.sleep(nanoseconds: 10_000_000)
    task.cancel()
    await #expect(throws: CancellationError.self) { _ = try await task.value }
    #expect(started.wrappedValue < 1000)
  }

  @Test func withoutTheSignalEveryItemIsStillStarted() async throws {
    // mapLimit(items, limit, fn) with no `{ signal }`: a stop is fn's to
    // read, and every item still runs.
    let started = Locked(0)
    let task = Task {
      // Stopped before it starts.
      withUnsafeCurrentTask { $0?.cancel() }
      return try await Limit.mapLimit(Array(0..<50), 2, stopsWhenCancelled: false) { item, _ in
        started.withLock { $0 += 1 }
        return Task.isCancelled ? -1 : item
      }
    }
    let out = try await task.value
    #expect(out.count == 50)
    #expect(started.wrappedValue == 50)
    #expect(out.allSatisfy { $0 == -1 })
  }

  @Test func pauseWaitsAndEndsEarlyWhenCancelled() async throws {
    let clock = ContinuousClock()
    let waited = await clock.measure { await Limit.pause(30) }
    #expect(waited >= .milliseconds(25))
    let immediate = await clock.measure {
      await Limit.pause(0)
      await Limit.pause(.nan)
      await Limit.pause(-5)
    }
    #expect(immediate < .milliseconds(20))
    let task = Task { await clock.measure { await Limit.pause(60_000) } }
    try await Task.sleep(nanoseconds: 5_000_000)
    task.cancel()
    #expect(await task.value < .seconds(5))
  }
}
