// Ports harness/harness.js (the worlds createHarness holds) and
// harness/fakeNetwork.js (its repo CAR cache); the rest of both files is in
// Harness/Harness+Flags.swift and Harness/FakeNetwork.swift.
//
// The made-up world the iOS app's demo mode, SwiftUI previews and UI tests
// run on: both accounts the web harness shows (Mira Okafor and Field Lab),
// the AppView over them and Defense's crowd, dated back from one `now`, so
// the two apps can be compared screen for screen.
//
// It holds what harness/harness.js's createHarness holds of the worlds
// (`worlds`, `worldOf`, each world's granted scope and PDS, `grantOf`,
// `regrant`; the scope helpers are in Harness/Harness.swift) and the repo
// CAR cache harness/fakeNetwork.js keeps. The fake network on it (the
// AppView, PDS, Constellation and Virga's server, as an HTTPTransport) is
// DemoTransport; the signed-in session on that is DemoSession.
//
// Thread-safe: the worlds sit behind a lock, so a fake network answering on
// any task and a preview reading on the main actor see the same state.
// Everything is deterministic given `now`.

import Foundation
import VirgaCore

public final class DemoWorld: Sendable {
  /// The `now` the web harness's README uses (`?now=1794700000000`), for
  /// previews and UI tests that want the same posts every run.
  public static let previewNow: Double = 1_794_700_000_000

  /// A world for SwiftUI previews, at `previewNow`. Shared: what a preview
  /// writes, the next one sees.
  public static let preview = DemoWorld(now: previewNow)

  /// The moment the worlds are dated back from, in epoch milliseconds.
  public let now: Double
  /// The scope the sessions were granted (the flags' `scope`): what
  /// `grantOf` answers for an account without one of its own.
  public let scope: String
  /// The zone a written post's time without an offset is read in (the
  /// web's browser zone); UTC unless given.
  public let timeZone: TimeZone
  private let state: Locked<[AccountWorld]>
  private let index: ViewsIndex
  private let cars = Locked<[JSKey: (revision: Int, car: [UInt8])]>([:])

  /// The harness's worlds, as createHarness builds them: one per account,
  /// Mira and Field Lab by default (`?accounts=1` is `[World.me]`), each
  /// built at `now`, with the session's granted `scope` (the flags' scope:
  /// `Harness.grantedScope(scope:defense:)`) and the harness's PDS.
  public convenience init(
    now: Double, accounts: [WorldAccount] = [World.me, World.lab], scope: String = Harness.defaultScope,
    timeZone: TimeZone = .gmt
  ) {
    let worlds = accounts.map { account in
      var world = World.buildWorld(now: now, account: account)
      // What Virga's server reports about the session (/api/oauth/session).
      world.scope = scope
      world.pdsUrl = World.pds
      return world
    }
    self.init(worlds: worlds, scope: scope, timeZone: timeZone)
  }

  /// `now` as a Date, cut to the millisecond as `Date.now()` is.
  public convenience init(
    now: Date, accounts: [WorldAccount] = [World.me, World.lab], scope: String = Harness.defaultScope,
    timeZone: TimeZone = .gmt
  ) {
    self.init(
      now: (now.timeIntervalSince1970 * 1000).rounded(.down), accounts: accounts, scope: scope, timeZone: timeZone)
  }

  /// Worlds built (and perhaps changed) elsewhere, kept as they are; `scope`
  /// is what `grantOf` answers for a world without one.
  public init(worlds: [AccountWorld], scope: String = Harness.defaultScope, timeZone: TimeZone = .gmt) {
    now = worlds.first?.now ?? .nan
    self.scope = scope
    self.timeZone = timeZone
    state = Locked(worlds)
    index = ViewsIndex(worlds)
  }

  /// The worlds as they are now.
  public var worlds: [AccountWorld] { state.wrappedValue }

  /// An account's world (`worldOf(did)`), or nil.
  public func world(_ did: String) -> AccountWorld? {
    worlds.first { $0.me.did.jsEquals(did) }
  }

  /// The AppView over the worlds as they are now.
  public var views: DemoViews { DemoViews(index: index, worlds: worlds, timeZone: timeZone) }

  /// Defense's crowd over the worlds as they are now (the views' own).
  public var crowd: DemoCrowd { views.crowd }

  /// What the account's session was granted now (`grantOf`): its world's
  /// scope, or the harness's for an account it doesn't have.
  public func grantOf(_ did: String) -> String {
    world(did)?.scope ?? scope
  }

  /// Signs the account in again with or without Defense's permission, as
  /// Turn on Defense (and Turn off) does (`regrant`): its world's scope
  /// changes at once. Answers the new scope.
  @discardableResult
  public func regrant(_ did: String, defense: Harness.DefenseLevel) throws -> String {
    try update(did) { world in
      let granted = Harness.withDefense(world.scope, defense)
      world.scope = granted
      return granted
    }
  }

  /// Changes one account's world under the lock: the way every write goes
  /// in, through HarnessRepo.
  @discardableResult
  public func update<Result>(_ did: String, _ body: (inout AccountWorld) throws -> Result) throws -> Result {
    try state.withLock { worlds in
      guard let i = worlds.firstIndex(where: { $0.me.did.jsEquals(did) }) else { throw DemoWorldError.noAccount(did) }
      return try body(&worlds[i])
    }
  }

  /// createRecord (`createOnly`) or putRecord in an account's repo.
  @discardableResult
  public func writeRecord(
    did: String, collection: String?, rkey: String?, record: JSONValue?, createOnly: Bool = false, now: Double
  ) throws -> HarnessRepo.WriteResult {
    try update(did) {
      try HarnessRepo.writeRecord(&$0, collection: collection, rkey: rkey, record: record, createOnly: createOnly, now: now)
    }
  }

  /// deleteRecord: whether there was one.
  @discardableResult
  public func removeRecord(did: String, collection: String, rkey: String) throws -> Bool {
    try update(did) { try HarnessRepo.removeRecord(&$0, collection, rkey) }
  }

  /// uploadBlob: keeps the bytes as one of the account's blobs and answers
  /// the blob ref.
  @discardableResult
  public func storeBlob(did: String, bytes: [UInt8], mimeType: String?) throws -> JSONValue {
    try update(did) { HarnessRepo.storeBlob(&$0, bytes, mimeType: mimeType) }
  }

  /// The account's repo as a CAR (com.atproto.sync.getRepo), built again
  /// only after a write, as the web's fake network caches it.
  public func repoCar(did: String) throws -> [UInt8] {
    guard let world = world(did) else { throw DemoWorldError.noAccount(did) }
    let key = JSKey(did)
    if let cached = cars.withLock({ $0[key] }), cached.revision == world.revision { return cached.car }
    let car = try BuildCar.buildRepoCar(world.me.did, World.repoRecords(world))
    cars.withLock { $0[key] = (world.revision, car) }
    return car
  }
}

/// What DemoWorld refuses, with the harness's words.
public enum DemoWorldError: Error, Hashable, Sendable, LocalizedError {
  case noAccount(String)

  public var errorDescription: String? {
    switch self {
    case .noAccount(let did): return "harness: no account \(did)"
    }
  }
}
