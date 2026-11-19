// src/defense/scanStore.js's behaviour, ported from scanStore.test.js: one
// scan per account, its stages, its result or failure, and what stopping,
// replacing, clearing and signing out leave behind.

import Foundation
import Testing
import VirgaCore
@testable import VirgaDefense

private let mira = "did:plc:mira"
private let lab = "did:plc:lab"

/// A result to finish with: an empty summary of `uri`.
private func result(_ uri: String) -> ScanResult {
  let summary = Score.summarise(
    Harvest(uri: uri, participants: [], totals: HarvestTotals(participants: 0, engagements: [:])), [:])
  return ScanResult(
    summary: summary, post: ScanPost(uri: uri, authorDid: "did:plc:author"), canary: nil,
    startedAt: "2026-11-12T12:00:00.000Z", finishedAt: "2026-11-12T12:00:01.000Z")
}

/// A run that reports a stage, then waits for `release()` or `fail(_:)`,
/// and notes whether it saw its task cancelled.
private final class Held: Sendable {
  private let state = Locked((
    started: false, cancelled: false,
    continuation: CheckedContinuation<ScanResult, any Error>?.none,
    early: Result<ScanResult, any Error>?.none))
  let uri: String

  init(_ uri: String = "at://did:plc:mira/app.bsky.feed.post/1") { self.uri = uri }

  var started: Bool { state.wrappedValue.started }
  var sawCancel: Bool { state.wrappedValue.cancelled }

  var run: @Sendable (_ onStage: @escaping ScanStageHandler) async throws -> ScanResult {
    { [self] onStage in
      await onStage(ScanStageReport(stage: "harvest", done: 1, total: 4))
      state.withLock { $0.started = true }
      return try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { continuation in
          let early: Result<ScanResult, any Error>? = state.withLock { s in
            if let early = s.early { return early }
            s.continuation = continuation
            return nil
          }
          if let early { continuation.resume(with: early) }
        }
      } onCancel: {
        self.finish(.failure(CancellationError()), cancelled: true)
      }
    }
  }

  private func finish(_ outcome: Result<ScanResult, any Error>, cancelled: Bool = false) {
    let continuation = state.withLock { s -> CheckedContinuation<ScanResult, any Error>? in
      if cancelled { s.cancelled = true }
      let c = s.continuation
      s.continuation = nil
      if c == nil, s.early == nil { s.early = outcome }
      return c
    }
    continuation?.resume(with: outcome)
  }

  func release() { finish(.success(result(uri))) }
  func fail(_ error: any Error) { finish(.failure(error)) }
}

private struct NoCounts: Error, Equatable { let code = "vouches" }

/// Waits (briefly) for `condition`, letting the scan's task run.
@MainActor
private func until(_ condition: @MainActor () -> Bool) async {
  for _ in 0..<500 where !condition() {
    try? await Task.sleep(nanoseconds: 1_000_000)
  }
}

@MainActor
@Suite struct ScanStoreBehaviour {
  @Test func runsSaysHowFarItIsAndKeepsWhatItFound() async {
    let store = ScanStore()
    var seen: [ScanState.Status] = []
    store.subscribeScans { seen.append(store.scanFor(mira).status) }
    let h = Held("link-result")
    let done = store.startScan(mira, input: "link", now: { Date(ms: 5) }, run: h.run)
    await until { store.scanFor(mira).stage == "harvest" }
    let running = store.scanFor(mira)
    #expect(running.status == .running)
    #expect(running.input == "link")
    #expect(running.startedAt == 5)
    #expect(running.progress == .init(done: 1, total: 4))
    h.release()
    await done.value
    let finished = store.scanFor(mira)
    #expect(finished.status == .done)
    #expect(finished.input == "link")
    #expect(finished.result?.post.uri == "link-result")
    #expect(seen.contains(.running))
    #expect(seen.last == .done)
    // Another account's is its own.
    #expect(store.scanFor(lab).isIdle)
  }

  @Test func keepsAFailureToShowWithItsError() async {
    let store = ScanStore()
    let h = Held()
    let done = store.startScan(mira, input: "link", run: h.run)
    await until { h.started }
    h.fail(NoCounts())
    await done.value
    let failed = store.scanFor(mira)
    #expect(failed.status == .failed)
    #expect(failed.error as? NoCounts == NoCounts())
  }

  @Test func leavesNothingBehindWhenStopped() async {
    let store = ScanStore()
    let h = Held()
    let done = store.startScan(mira, input: "link", run: h.run)
    await until { store.scanFor(mira).stage == "harvest" }
    store.stopScan(mira)
    await done.value
    #expect(store.scanFor(mira).isIdle)
    #expect(h.sawCancel)
  }

  @Test func showsAFailureThatOnlyLooksLikeAStop() async {
    let store = ScanStore()
    let h = Held()
    let done = store.startScan(mira, input: "link", run: h.run)
    await until { h.started }
    // A timeout throws a cancellation of its own; nobody pressed Stop.
    h.fail(CancellationError())
    await done.value
    #expect(store.scanFor(mira).status == .failed)
  }

  @Test func forgetsTheScansOfAccountsNoLongerSignedIn() async {
    let store = ScanStore()
    let a = Held()
    let b = Held()
    let one = store.startScan(mira, input: "one", run: a.run)
    let two = store.startScan(lab, input: "two", run: b.run)
    await until { b.started }
    a.release()
    await one.value
    store.keepScansFor([lab])
    #expect(store.scanFor(mira).isIdle)
    #expect(store.scanFor(lab).status == .running)
    store.keepScansFor([])
    await two.value
    #expect(store.scanFor(lab).isIdle)
  }

  @Test func letsANewScanReplaceOneUnderWayWithoutTheOldAnswerLandingLate() async {
    let store = ScanStore()
    let first = Held("old")
    let second = Held("new")
    let a = store.startScan(mira, input: "one", run: first.run)
    await until { first.started }
    let b = store.startScan(mira, input: "two", run: second.run)
    await until { second.started }
    second.release()
    first.release()
    await a.value
    await b.value
    let state = store.scanFor(mira)
    #expect(state.status == .done)
    #expect(state.input == "two")
    #expect(state.result?.post.uri == "new")
    #expect(first.sawCancel)
  }

  @Test func forgetsAFinishedScanWhenCleared() async {
    let store = ScanStore()
    let h = Held()
    let done = store.startScan(mira, input: "link", run: h.run)
    await until { h.started }
    h.release()
    await done.value
    store.clearScan(mira)
    #expect(store.scanFor(mira).isIdle)
  }

  @Test func stopsHearingWhenUnsubscribed() async {
    let store = ScanStore()
    var heard = 0
    let stop = store.subscribeScans { heard += 1 }
    store.clearScan(mira)
    store.startScan(mira, input: "x", run: Held().run)
    let before = heard
    #expect(before >= 1)
    stop()
    store.stopScan(mira)
    #expect(heard == before)
    store.resetScansForTests()
    #expect(store.scans.isEmpty)
  }

  @Test func theSharedStoreIsOne() {
    #expect(ScanStore.shared === ScanStore.shared)
    #expect(ScanStore.idle.isIdle)
  }
}
