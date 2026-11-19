// Ports src/defense/scanStore.js
//
// The latest scan of each account, in memory. A scan keeps running when the
// page that started it is left, and is there when it is opened again; a
// relaunch starts with none. Nothing is written to storage: a scan holds
// other people's handles and names, and docs/DEFENSE.md keeps those in
// memory unless there is a reason to keep them longer.
//
// One scan at a time per account. Starting another stops the one under way.
// The web's module-level maps are one shared store (`ScanStore.shared`);
// its AbortController is the scan's Task, cancelled.

import Foundation
import Observation

/// An account's scan, as the page shows it.
public struct ScanState: Sendable {
  public enum Status: String, Codable, Hashable, Sendable {
    case idle, running, done, failed
  }

  /// How far a running stage is: `done` of `total`.
  public struct Progress: Codable, Hashable, Sendable {
    public var done: Int
    public var total: Int

    public init(done: Int, total: Int) {
      self.done = done
      self.total = total
    }
  }

  public var status: Status
  /// What was pasted (or the post's at:// URI).
  public var input: String?
  /// When it started, in epoch milliseconds.
  public var startedAt: Double?
  /// running: the stage it is in, and how far, when the stage can say.
  public var stage: String?
  public var progress: Progress?
  /// done: what it found.
  public var result: ScanResult?
  /// failed: why (scan.js's ScanError, in wave 2, or whatever the run threw).
  public var error: (any Error)?

  public init(
    status: Status,
    input: String? = nil,
    startedAt: Double? = nil,
    stage: String? = nil,
    progress: Progress? = nil,
    result: ScanResult? = nil,
    error: (any Error)? = nil
  ) {
    self.status = status
    self.input = input
    self.startedAt = startedAt
    self.stage = stage
    self.progress = progress
    self.result = result
    self.error = error
  }

  /// IDLE: no scan.
  public static let idle = ScanState(status: .idle)

  public var isIdle: Bool { status == .idle }
}

@MainActor
@Observable
public final class ScanStore {
  /// The tab's store: the web module's maps.
  public static let shared = ScanStore()

  /// IDLE.
  public static let idle = ScanState.idle

  /// Every account's scan, by DID. Views observe this.
  public private(set) var scans: [String: ScanState] = [:]

  @ObservationIgnored private var controllers: [String: Controller] = [:]
  @ObservationIgnored private var listeners: [Int: @MainActor () -> Void] = [:]
  @ObservationIgnored private var nextListener = 0
  @ObservationIgnored private let now: () -> Date

  /// One scan's handle: whether it was stopped, and its task.
  @MainActor final class Controller {
    var aborted = false
    var task: Task<Void, Never>?

    func abort() {
      aborted = true
      task?.cancel()
    }
  }

  public init(now: @escaping () -> Date = Date.init) {
    self.now = now
  }

  private func set(_ did: String, _ state: ScanState) {
    scans[did] = state
    for listener in listeners.sorted(by: { $0.key < $1.key }).map(\.value) { listener() }
  }

  private func isCurrent(_ did: String, _ controller: Controller) -> Bool {
    controllers[did] === controller
  }

  /// The account's scan: idle, running, done or failed.
  public func scanFor(_ did: String) -> ScanState {
    scans[did] ?? .idle
  }

  /// Hear about every change. Returns the way to stop.
  @discardableResult
  public func subscribeScans(_ listener: @escaping @MainActor () -> Void) -> @MainActor () -> Void {
    let id = nextListener
    nextListener += 1
    listeners[id] = listener
    return { [weak self] in self?.listeners[id] = nil }
  }

  /// Start a scan for `did`. `run` does the work (runScan, in wave 2) and
  /// returns its result, reporting each stage through the handler it is
  /// given. The state goes `running` (with the stage and its progress),
  /// then `done` (with `result`) or `failed` (with `error`); a scan that was
  /// stopped or replaced leaves no trace of its own. The returned task ends
  /// when the scan has settled.
  @discardableResult
  public func startScan(
    _ did: String,
    input: String,
    now: (() -> Date)? = nil,
    run: @escaping @Sendable (_ onStage: @escaping ScanStageHandler) async throws -> ScanResult
  ) -> Task<Void, Never> {
    controllers[did]?.abort()
    let controller = Controller()
    controllers[did] = controller
    // Whole milliseconds, as the web's Date.now() gives.
    let startedAt = ((now ?? self.now)().timeIntervalSince1970 * 1000).rounded()
    set(did, ScanState(status: .running, input: input, startedAt: startedAt))

    let onStage: ScanStageHandler = { [weak self] report in
      await self?.stage(did, controller, report)
    }
    let task = Task { [weak self] in
      do {
        let result = try await run(onStage)
        self?.settle(did, controller, input: input, startedAt: startedAt, .success(result))
      } catch {
        self?.settle(did, controller, input: input, startedAt: startedAt, .failure(error))
      }
    }
    controller.task = task
    return task
  }

  private func stage(_ did: String, _ controller: Controller, _ report: ScanStageReport) {
    guard isCurrent(did, controller) else { return }
    var state = scanFor(did)
    state.stage = report.stage
    if let done = report.done, let total = report.total, total != 0 {
      state.progress = .init(done: done, total: total)
    } else {
      state.progress = nil
    }
    set(did, state)
  }

  private func settle(
    _ did: String,
    _ controller: Controller,
    input: String,
    startedAt: Double,
    _ outcome: Result<ScanResult, any Error>
  ) {
    guard isCurrent(did, controller) else { return }
    switch outcome {
    case .success(let result):
      set(did, ScanState(status: .done, input: input, startedAt: startedAt, result: result))
    case .failure(let error):
      // Idle only when this scan was stopped; any other failure is shown,
      // a cancellation of the run's own (a timeout) included.
      if controller.aborted {
        set(did, .idle)
      } else {
        set(did, ScanState(status: .failed, input: input, startedAt: startedAt, error: error))
      }
    }
    if isCurrent(did, controller) { controllers[did] = nil }
  }

  /// Stop the scan under way, if there is one. What it found so far is dropped.
  public func stopScan(_ did: String) {
    guard let controller = controllers[did] else { return }
    controllers[did] = nil
    controller.abort()
    set(did, .idle)
  }

  /// Forget the account's scan, stopping it first if it is running.
  public func clearScan(_ did: String) {
    stopScan(did)
    if scans[did] != nil { set(did, .idle) }
  }

  /// Forget every account's scan but those of `dids`, stopping any under
  /// way: a scan holds other people's names and shouldn't outlive its
  /// account's session.
  public func keepScansFor(_ dids: [String]?) {
    let keep = Set(dids ?? [])
    for did in Set(scans.keys).union(controllers.keys).sorted() where !keep.contains(did) {
      clearScan(did)
    }
  }

  /// Tests only: stop everything and forget it all, listeners included.
  public func resetScansForTests() {
    for controller in controllers.values { controller.abort() }
    controllers.removeAll()
    scans.removeAll()
    listeners.removeAll()
  }
}
