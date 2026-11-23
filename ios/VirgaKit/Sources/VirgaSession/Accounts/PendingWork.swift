// Ports src/accounts/pendingWork.js
//
// What a long session has waiting on Virga's server: scheduled posts not yet
// out and post timers still counting down. Both run on the grant Virga's
// server holds for the account, and the server ends that grant when the
// last browser or device signed in to Virga with the account signs out.
// Virga can't see the others, so a sign-out with work waiting asks first and
// says what stops if this one was the last.
//
// The lists are the posting services' (scheduleService.listScheduled,
// timerService.listTimers, VirgaPosting), which sit above this target, so
// they come in as PendingWorkServices; VirgaPosting supplies the real ones.

import Foundation
import Observation
import VirgaCore
import VirgaNetwork

/// `{ posts, timers }`: how many of each Virga's grant carries.
public struct PendingWorkCount: Sendable, Hashable, Codable {
  public var posts: Int
  public var timers: Int

  public init(posts: Int, timers: Int) {
    self.posts = posts
    self.timers = timers
  }
}

/// One account's answer in `byDid`: counted, couldn't be read (`null`), or
/// not asked about (`undefined`).
public enum PendingWorkEntry: Sendable, Hashable {
  case absent
  case unreadable
  case counted(PendingWorkCount)
}

/// The posting services readPendingWork reads through.
public struct PendingWorkServices: Sendable {
  /// `(await listScheduled(requester)).rows`.
  public var listScheduled: @Sendable (VirgaBackend) async throws -> [JSONValue]
  /// `(await listTimers(requester)).rows`.
  public var listTimers: @Sendable (VirgaBackend) async throws -> [JSONValue]
  /// scheduleService's `isActiveScheduledRow`.
  public var isActiveScheduledRow: @Sendable (JSONValue) -> Bool
  /// timerService's `isLiveTimer`.
  public var isLiveTimer: @Sendable (JSONValue) -> Bool

  public init(
    listScheduled: @escaping @Sendable (VirgaBackend) async throws -> [JSONValue],
    listTimers: @escaping @Sendable (VirgaBackend) async throws -> [JSONValue],
    isActiveScheduledRow: @escaping @Sendable (JSONValue) -> Bool,
    isLiveTimer: @escaping @Sendable (JSONValue) -> Bool
  ) {
    self.listScheduled = listScheduled
    self.listTimers = listTimers
    self.isActiveScheduledRow = isActiveScheduledRow
    self.isLiveTimer = isLiveTimer
  }
}

public enum PendingWork {
  /// Long enough for a cold start on Virga's server; a sign-out that waits
  /// any longer reads as stuck, and the dialog then says it couldn't check.
  public static let checkTimeoutMs: Double = 8_000

  /// `countPendingWork({ scheduled, timers }, { isActiveScheduledRow, isLiveTimer })`.
  public static func countPendingWork(
    scheduled: [JSONValue]? = [],
    timers: [JSONValue]? = [],
    isActiveScheduledRow: (JSONValue) -> Bool,
    isLiveTimer: (JSONValue) -> Bool
  ) -> PendingWorkCount {
    PendingWorkCount(
      posts: (scheduled ?? []).filter(isActiveScheduledRow).count,
      timers: (timers ?? []).filter(isLiveTimer).count)
  }

  /// `hasPendingWork(work)`: whether `work` needs saying. Nil is work that
  /// couldn't be read, which does.
  public static func hasPendingWork(_ work: PendingWorkCount?) -> Bool {
    guard let work else { return true }
    return work.posts + work.timers > 0
  }

  /// `hasPendingWork(byDid[did])`: an account nobody asked about (`undefined`)
  /// doesn't.
  public static func hasPendingWork(_ entry: PendingWorkEntry) -> Bool {
    switch entry {
    case .absent: return false
    case .unreadable: return true
    case .counted(let work): return hasPendingWork(work)
    }
  }

  /// `readPendingWork(requester, { timeoutMs })`: one account's waiting
  /// work. Throws when either list can't be read, or both haven't come back
  /// within `timeoutMs`.
  public static func readPendingWork(
    _ requester: VirgaBackend,
    services: PendingWorkServices,
    timeoutMs: Double = checkTimeoutMs
  ) async throws -> PendingWorkCount {
    try await withDeadline(ms: timeoutMs > 0 ? timeoutMs : nil) {
      async let queue = services.listScheduled(requester)
      async let live = services.listTimers(requester)
      let (scheduled, timers) = try await (queue, live)
      return countPendingWork(
        scheduled: scheduled, timers: timers, isActiveScheduledRow: services.isActiveScheduledRow,
        isLiveTimer: services.isLiveTimer)
    }
  }
}

/// `usePendingWork(accounts, backendFor, enabled)`: the waiting work of each
/// long-session account, read while enabled. A browser session holds nothing
/// on Virga's server and isn't asked.
@MainActor
@Observable
public final class PendingWorkModel {
  /// The accounts asked about, as the hook's key (`dids.join(' ')`).
  public private(set) var key: String = ""
  public private(set) var checking = false
  /// Each asked-about account's answer.
  public private(set) var byDid: [String: PendingWorkCount?] = [:]

  @ObservationIgnored private let backendFor: @MainActor (String) -> VirgaBackend?
  @ObservationIgnored private let services: PendingWorkServices
  @ObservationIgnored private var task: Task<Void, Never>?

  public init(backendFor: @escaping @MainActor (String) -> VirgaBackend?, services: PendingWorkServices) {
    self.backendFor = backendFor
    self.services = services
  }

  /// `byDid[did]`, telling an account that wasn't asked about from one that
  /// couldn't be read.
  public func entry(_ did: String) -> PendingWorkEntry {
    guard let value = byDid.jsValue(did) else { return .absent }
    return value.map(PendingWorkEntry.counted) ?? .unreadable
  }

  /// The hook's arguments changed: read again when the accounts to ask about
  /// did.
  public func update(accounts: [SessionAccount]?, enabled: Bool) {
    let dids = enabled ? (accounts ?? []).filter { $0.mode == "backend" && $0.status != .needsSignIn }.map(\.did) : []
    let next = dids.joined(separator: " ")
    guard !next.jsEquals(key) else { return }
    task?.cancel()
    key = next
    byDid = [:]
    guard !next.isEmpty else {
      checking = false
      return
    }
    checking = true
    let services = self.services
    let asked = dids.map { ($0, backendFor($0)) }
    task = Task { [weak self] in
      var entries: [(String, PendingWorkCount?)] = []
      await withTaskGroup(of: (Int, String, PendingWorkCount?).self) { group in
        for (index, (did, requester)) in asked.enumerated() {
          group.addTask {
            guard let requester else { return (index, did, PendingWorkCount(posts: 0, timers: 0)) }
            let work = try? await PendingWork.readPendingWork(requester, services: services)
            return (index, did, work)
          }
        }
        var collected: [(Int, String, PendingWorkCount?)] = []
        for await entry in group { collected.append(entry) }
        entries = collected.sorted { $0.0 < $1.0 }.map { ($0.1, $0.2) }
      }
      guard !Task.isCancelled, let self, self.key.jsEquals(next) else { return }
      var out: [String: PendingWorkCount?] = [:]
      for (did, work) in entries { out[did] = .some(work) }
      self.byDid = out
      self.checking = false
    }
  }

  /// Calls off a read under way (the dialog closed).
  public func stop() {
    task?.cancel()
    task = nil
  }
}
