// Behaviour of the archive's store (src/lib/analyticsStore.js over a file
// store): one database per account, shared; the memory fallback; rows read
// back in IndexedDB's key order across a restart; the schema's version and
// the upgrade of an older database; compaction; deletion; and that no
// storage failure ever reaches a caller. Ports analyticsStore.test.js where
// it applies (the blocked-tab cases have no iOS equivalent: nothing else
// opens the database).

import Foundation
import Testing
import VirgaCore
@testable import VirgaArchive

/// A file store that refuses everything, or only writes.
actor FailingFileStore: FileStore {
  let readsFail: Bool
  init(readsFail: Bool = true) { self.readsFail = readsFail }
  struct Refused: Error {}
  func read(_ path: String) async throws -> Data? {
    if readsFail { throw Refused() }
    return nil
  }
  func write(_ data: Data, to path: String) async throws { throw Refused() }
  func delete(_ path: String) async throws { throw Refused() }
  func list(_ directory: String) async throws -> [String] {
    if readsFail { throw Refused() }
    return []
  }
}

@Suite struct AnalyticsStoreBehaviour {
  let alice = "did:plc:alice"
  let bob = "did:plc:bob"

  @Test func opensADatabaseNamedForTheAccount() async throws {
    let files = InMemoryFileStore()
    let registry = AnalyticsStoreRegistry()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    #expect(store.persistent)
    #expect(store.blocked == false)
    #expect(AnalyticsStore.analyticsDbName(alice) == "virga-analytics:did:plc:alice")
    #expect(AnalyticsStore.analyticsDbName(alice) != AnalyticsStore.analyticsDbName(bob))
    let schema = try #require(try await files.read("analytics/virga-analytics%3Adid%3Aplc%3Aalice/schema.json"))
    let parsed = try JSONValue.parse(schema)
    #expect(parsed["version"] == .number(1))
    #expect(parsed["name"] == .string("virga-analytics:did:plc:alice"))
    #expect(parsed["stores"]?["posts"] == .string("uri"))
    #expect(parsed["stores"]?["meta"] == .string("key"))
  }

  @Test func sharesOneHandlePerAccountAndNeverOneBetweenAccounts() async {
    let files = InMemoryFileStore()
    let registry = AnalyticsStoreRegistry()
    let a = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    let again = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    let b = await AnalyticsStore.openAnalyticsStore(bob, files: files, registry: registry)
    #expect(a === again)
    #expect(a !== b)
    await a.putAll("posts", [["uri": "at://alice/app.bsky.feed.post/1"]])
    #expect(await b.all("posts").isEmpty)
    #expect(await a.all("posts").count == 1)
  }

  @Test func keepsTwoAccountsApartInTheSessionOnlyFallbackToo() async {
    let registry = AnalyticsStoreRegistry()
    let a = await AnalyticsStore.openAnalyticsStore(alice, files: nil, registry: registry)
    let b = await AnalyticsStore.openAnalyticsStore(bob, files: nil, registry: registry)
    #expect(a.persistent == false)
    await a.putAll("posts", [["uri": "at://alice/app.bsky.feed.post/1"]])
    #expect(await b.all("posts").isEmpty)
    #expect(await a.all("posts").count == 1)
  }

  @Test func holdsNothingForNobody() async {
    let files = InMemoryFileStore()
    let store = await AnalyticsStore.openAnalyticsStore(nil, files: files, registry: AnalyticsStoreRegistry())
    #expect(store.persistent == false)
    #expect(await files.snapshot.isEmpty)
    let empty = await AnalyticsStore.openAnalyticsStore("", files: files, registry: AnalyticsStoreRegistry())
    #expect(empty.persistent == false)
  }

  @Test func theFallbackRemovesSingleRowsByKeyAsAnUnfollowDoes() async {
    let store = MemoryAnalyticsStore()
    await store.putAll("following", [
      ["uri": "at://me/app.bsky.graph.follow/a", "did": "did:plc:a"],
      ["uri": "at://me/app.bsky.graph.follow/b", "did": "did:plc:b"],
    ])
    await store.remove("following", ["at://me/app.bsky.graph.follow/a"])
    #expect(await store.all("following").map { $0["did"] } == [.string("did:plc:b")])
  }

  @Test func theFallbackKeepsTheOrderRowsWereFirstWritten() async {
    let store = MemoryAnalyticsStore()
    await store.putAll("posts", [["uri": "b", "n": 1], ["uri": "a", "n": 2]])
    await store.putAll("posts", [["uri": "b", "n": 3], ["uri": "c", "n": 4]])
    #expect(await store.all("posts").map { $0["n"] } == [.number(3), .number(2), .number(4)])
    await store.setMeta("posts", ["complete": true, "key": "ignored"])
    #expect(await store.getMeta("posts") == ["complete": true, "key": "posts"])
    #expect(await store.getMeta("nothing") == nil)
    await store.putAll("bogus", [["uri": "x"]])
    #expect(await store.all("bogus").isEmpty)
  }

  @Test func rowsSurviveARestartInKeyOrder() async {
    let files = InMemoryFileStore()
    let first = AnalyticsStoreRegistry()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: first)
    // IndexedDB's order: numbers first, then strings by UTF-16 code unit
    // (so "B" before "a", and the two spellings of é are two keys).
    await store.putAll("posts", [
      ["uri": "b", "n": 1], ["uri": "B", "n": 2], ["uri": "é", "n": 3], ["uri": "e\u{301}", "n": 4], ["uri": 7, "n": 5],
      ["uri": -1, "n": 6], ["n": 7], ["uri": .null, "n": 8], ["uri": true, "n": 9],
    ])
    await store.setMeta("posts", ["syncedAt": 5, "complete": false, "cursor": .null])
    await store.remove("posts", ["b"])
    let expected: [JSONValue] = [.number(6), .number(5), .number(2), .number(4), .number(3)]
    #expect(await store.all("posts").map { $0["n"]! } == expected)

    AnalyticsStore.resetAnalyticsStore(registry: first)
    let reopened = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: first)
    #expect(reopened !== store)
    #expect(await reopened.all("posts").map { $0["n"]! } == expected)
    #expect(await reopened.getMeta("posts") == ["syncedAt": 5, "complete": false, "cursor": .null, "key": "posts"])
  }

  @Test func clearEmptiesOneStoreAndNoOther() async {
    let files = InMemoryFileStore()
    let registry = AnalyticsStoreRegistry()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    await store.putAll("posts", [["uri": "a"]])
    await store.putAll("inbound", [["uri": "i"]])
    await store.clear("posts")
    await store.putAll("posts", [["uri": "b"]])
    #expect(await store.all("posts") == [["uri": "b"]])
    registry.reset()
    let again = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    #expect(await again.all("posts") == [["uri": "b"]])
    #expect(await again.all("inbound") == [["uri": "i"]])
  }

  @Test func manyWritesAreFoldedIntoOneSegment() async throws {
    let files = InMemoryFileStore()
    let registry = AnalyticsStoreRegistry()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    for i in 0..<100 {
      await store.putAll("atmosphere", [["uri": .string("at://x/c/\(i)"), "collection": "c", "at": .number(Double(i))]])
      if i % 10 == 9 { await store.remove("atmosphere", [.string("at://x/c/\(i)")]) }
    }
    let segments = try await files.list("analytics/virga-analytics%3Adid%3Aplc%3Aalice/atmosphere")
    #expect(segments.count <= FileAnalyticsStore.compactAfter + 1)
    registry.reset()
    let again = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    let rows = await again.all("atmosphere")
    #expect(rows.count == 90)
    #expect(rows.first?["uri"] == .string("at://x/c/0"))
  }

  @Test func aDatabaseANewerBuildWroteIsServedFromMemory() async throws {
    let files = InMemoryFileStore()
    let path = "analytics/virga-analytics%3Adid%3Aplc%3Aalice/schema.json"
    try await files.write(Data(#"{"version":2}"#.utf8), to: path)
    let registry = AnalyticsStoreRegistry()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    #expect(store.persistent == false)
    // Memoized: the next open doesn't ask again.
    let again = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    #expect(again === store)
    // And the newer database is left as it was.
    #expect(try await files.read(path) == Data(#"{"version":2}"#.utf8))
  }

  @Test func anOlderDatabaseIsBroughtUpAndKeepsItsRows() async throws {
    let files = InMemoryFileStore()
    let dir = "analytics/virga-analytics%3Adid%3Aplc%3Aalice"
    // A database from before the schema file: one store's rows, no schema.
    try await files.write(Data(#"{"op":"put","rows":[{"uri":"at://a/app.bsky.feed.post/1","likes":3}]}"#.utf8), to: "\(dir)/posts/000000000000.json")
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: AnalyticsStoreRegistry())
    #expect(store.persistent)
    #expect(await store.all("posts") == [["uri": "at://a/app.bsky.feed.post/1", "likes": 3]])
    // Every store exists now, the new ones empty.
    #expect(await store.all("atmosphere").isEmpty)
    let schema = try JSONValue.parse(try #require(try await files.read("\(dir)/schema.json")))
    #expect(schema["version"] == .number(Double(AnalyticsStore.dbVersion)))
  }

  @Test func noStorageFailureReachesACaller() async {
    let refusing = await AnalyticsStore.openAnalyticsStore(alice, files: FailingFileStore(), registry: AnalyticsStoreRegistry())
    // An open that fails is the session-only fallback.
    #expect(refusing.persistent == false)
    await refusing.putAll("posts", [["uri": "a"]])
    #expect(await refusing.all("posts").count == 1)

    // A store that opens but then fails its writes drops them quietly.
    let files = InMemoryFileStore()
    let store = FileAnalyticsStore(name: AnalyticsStore.analyticsDbName(alice), files: FailingFileStore(readsFail: false))
    await store.putAll("posts", [["uri": "a"]])
    await store.remove("posts", ["a"])
    await store.clear("posts")
    await store.setMeta("posts", ["complete": true])
    #expect(await store.all("posts").isEmpty)
    #expect(await store.getMeta("posts") == nil)
    #expect(await files.snapshot.isEmpty)
  }

  @Test func deletingTheDatabaseClosesItsHandle() async throws {
    let files = InMemoryFileStore()
    let registry = AnalyticsStoreRegistry()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    let other = await AnalyticsStore.openAnalyticsStore(bob, files: files, registry: registry)
    await store.putAll("posts", [["uri": "a"]])
    await other.putAll("posts", [["uri": "b"]])
    #expect(await AnalyticsStore.deleteDatabase("virga-analytics:\(alice)", files: files, registry: registry))
    #expect(await AnalyticsStore.deleteDatabase("virga-posting:\(alice)", files: files, registry: registry) == false)
    // The old handle steps aside: reads are empty, writes go nowhere.
    #expect(await store.all("posts").isEmpty)
    await store.putAll("posts", [["uri": "c"]])
    #expect(try await files.list("analytics/virga-analytics%3Adid%3Aplc%3Aalice").isEmpty)
    // A relaunch: every handle forgotten, and the next open starts afresh.
    AnalyticsStore.resetAnalyticsStore(registry: registry)
    let fresh = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    #expect(fresh.persistent)
    #expect(await fresh.all("posts").isEmpty)
    let bobAgain = await AnalyticsStore.openAnalyticsStore(bob, files: files, registry: registry)
    #expect(await bobAgain.all("posts") == [["uri": "b"]])
  }

  /// Deleting one account's database forgets and closes that account's
  /// handle only. Another account's open archive and every later open of
  /// it share the one handle, so no two pictures of one folder write its
  /// segments (the app's resetAnalyticsStore leaves the registry alone).
  @Test func deletingOneAccountsDatabaseLeavesAnothersHandleShared() async throws {
    let files = InMemoryFileStore()
    let registry = AnalyticsStoreRegistry()
    let held = await AnalyticsStore.openAnalyticsStore(bob, files: files, registry: registry)
    await held.putAll("posts", [["uri": "at://bob/p/1"]])
    _ = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    #expect(await AnalyticsStore.deleteDatabase("virga-analytics:\(alice)", files: files, registry: registry))
    let again = await AnalyticsStore.openAnalyticsStore(bob, files: files, registry: registry)
    #expect(again === held)
    await held.putAll("posts", [["uri": "at://bob/p/2"]])
    await again.putAll("posts", [["uri": "at://bob/p/3"]])
    // A relaunch reads every write.
    let relaunched = await AnalyticsStore.openAnalyticsStore(bob, files: files, registry: AnalyticsStoreRegistry())
    let uris = await relaunched.all("posts").compactMap { $0["uri"]?.stringValue }
    #expect(uris == ["at://bob/p/1", "at://bob/p/2", "at://bob/p/3"])
  }

  @Test func rowsKeepTheWebsShape() async {
    let files = InMemoryFileStore()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: AnalyticsStoreRegistry())
    let row = Analytics.compactPostFromRecord(
      "at://did:plc:alice/app.bsky.feed.post/3abc", ["text": "hello", "createdAt": "2026-06-10T12:00:00.000Z"],
      timeZone: TimeZone(identifier: "UTC")!)!
    await store.putAll("posts", [row.json])
    let back = await store.all("posts")
    #expect(back.count == 1)
    #expect(PostRow(json: back[0]) == row)
    #expect(back[0]["replyTo"] == .null)
    #expect(back[0]["tags"] == .array([]))
  }
}

/// An in-memory file store whose every call stops for a moment first, so
/// calls made at the same time interleave as they do over a real disk.
actor SlowFileStore: FileStore {
  let base = InMemoryFileStore()
  func pause() async {
    for _ in 0..<5 { await Task.yield() }
  }
  func read(_ path: String) async throws -> Data? {
    await pause()
    return try await base.read(path)
  }
  func write(_ data: Data, to path: String) async throws {
    await pause()
    try await base.write(data, to: path)
  }
  func delete(_ path: String) async throws {
    await pause()
    try await base.delete(path)
  }
  func list(_ directory: String) async throws -> [String] {
    await pause()
    return try await base.list(directory)
  }
}

@Suite struct AnalyticsStoreConcurrency {
  let alice = "did:plc:alice"

  /// The web's IndexedDB runs one connection's transactions on a store in
  /// the order they were made, so writes made at the same time (a page of
  /// the sync and a post just made, or two People lists' cards) all land.
  @Test func writesMadeAtOnceAllLandAndSurviveARestart() async {
    let files = SlowFileStore()
    let registry = AnalyticsStoreRegistry()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    await withTaskGroup(of: Void.self) { group in
      for i in 0..<12 {
        group.addTask { await store.putAll("posts", [["uri": .string("at://alice/p/\(i)"), "n": .number(Double(i))]]) }
      }
      group.addTask { await store.setMeta("posts", ["syncedAt": 1]) }
      group.addTask { _ = await store.all("posts") }
    }
    #expect(await store.all("posts").count == 12)
    registry.reset()
    let again = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    #expect(await again.all("posts").count == 12)
    #expect(await again.getMeta("posts")?["syncedAt"] == .number(1))
  }

  /// A write made while the store is first being read is not lost to the
  /// read's older picture of it.
  @Test func aWriteDuringTheFirstReadIsKept() async {
    let files = SlowFileStore()
    let registry = AnalyticsStoreRegistry()
    let first = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    await first.putAll("posts", [["uri": "at://alice/p/held"]])
    registry.reset()
    let store = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    async let read = store.all("posts")
    async let write: Void = store.putAll("posts", [["uri": "at://alice/p/new"]])
    _ = await (read, write)
    #expect(await store.all("posts").count == 2)
    await store.putAll("posts", [["uri": "at://alice/p/later"]])
    registry.reset()
    let again = await AnalyticsStore.openAnalyticsStore(alice, files: files, registry: registry)
    #expect(await again.all("posts").count == 3)
  }
}

/// An in-memory file store that can hold its writes until released, and
/// says when one is waiting and what was deleted.
actor HeldWritesFileStore: FileStore {
  let base = InMemoryFileStore()
  private var holding = false
  private var held: [CheckedContinuation<Void, Never>] = []
  private(set) var writesHeld = 0
  private(set) var deleted: [String] = []

  func hold() { holding = true }

  func release() {
    holding = false
    for waiting in held { waiting.resume() }
    held = []
  }

  func read(_ path: String) async throws -> Data? { try await base.read(path) }

  func write(_ data: Data, to path: String) async throws {
    if holding {
      writesHeld += 1
      await withCheckedContinuation { held.append($0) }
    }
    try await base.write(data, to: path)
  }

  func delete(_ path: String) async throws {
    deleted.append(path)
    try await base.delete(path)
  }

  func list(_ directory: String) async throws -> [String] { try await base.list(directory) }
}

@Suite struct AnalyticsStoreDeletion {
  let gone = "did:plc:gone"

  /// Removing an account with its data while its sync writes: the write
  /// under way lands before the folder goes, as IndexedDB's delete waits
  /// for the connection's transactions, so nothing of the account is left
  /// and its next sign-in starts empty.
  @Test(.timeLimit(.minutes(1))) func deletingWaitsForTheWriteUnderWay() async throws {
    let files = HeldWritesFileStore()
    let registry = AnalyticsStoreRegistry()
    let name = AnalyticsStore.analyticsDbName(gone)
    let store = await AnalyticsStore.openAnalyticsStore(gone, files: files, registry: registry)
    let opened = try #require(store as? FileAnalyticsStore)
    await files.hold()
    let write = Task { await store.putAll("atmosphere", [["uri": "at://did:plc:gone/x/1"]]) }
    while await files.writesHeld == 0 { await Task.yield() }
    let finished = Locked(false)
    let delete = Task {
      let went = await AnalyticsStore.deleteDatabase(name, files: files, registry: registry)
      finished.set(true)
      return went
    }
    // Either the delete waits its turn behind the write, or it has run
    // ahead of it.
    while await opened.queued == 0, !finished.wrappedValue { await Task.yield() }
    #expect(!finished.wrappedValue, "the delete didn't wait for the write under way")
    #expect(await files.deleted.isEmpty, "the folder went while a write was under way")
    await files.release()
    await write.value
    #expect(await delete.value)
    let left = try await files.list(AnalyticsStore.directory(name))
    #expect(left.isEmpty, "\(left)")
    // Calls after the delete go nowhere.
    await store.putAll("atmosphere", [["uri": "at://did:plc:gone/x/2"]])
    #expect(try await files.list(AnalyticsStore.directory(name)).isEmpty)
    let fresh = await AnalyticsStore.openAnalyticsStore(gone, files: files, registry: registry)
    #expect(await fresh.all("atmosphere").isEmpty)
  }
}

@Suite struct AnalyticsStoreScale {
  /// A big repo's worth of atmosphere rows (the web measured ~190,000 on
  /// one account) written in the sync's 5,000-row chunks and read back:
  /// each write costs what it writes, so this stays well inside a test's time.
  @Test func aBigRepoWritesInChunksAndReadsBackInOrder() async {
    let files = InMemoryFileStore()
    let registry = AnalyticsStoreRegistry()
    let store = await AnalyticsStore.openAnalyticsStore("did:plc:big", files: files, registry: registry)
    let total = 60_000
    let started = Date()
    for start in stride(from: 0, to: total, by: 5000) {
      let rows: [JSONValue] = (start..<min(start + 5000, total)).map { i in
        ["uri": .string("at://did:plc:big/c/\(String(format: "%06d", total - i))"), "collection": "c", "at": .number(Double(i))]
      }
      await store.putAll("atmosphere", rows)
    }
    registry.reset()
    let again = await AnalyticsStore.openAnalyticsStore("did:plc:big", files: files, registry: registry)
    let rows = await again.all("atmosphere")
    #expect(rows.count == total)
    #expect(rows.first?["uri"] == .string("at://did:plc:big/c/000001"))
    #expect(Date().timeIntervalSince(started) < 60)
  }
}
