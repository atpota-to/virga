// The key-value store (the web's localStorage) and the file store (its
// IndexedDB), in memory, on UserDefaults and on disk.

import Foundation
import Testing
@testable import VirgaCore

struct Thing: Codable, Equatable {
  var name: String
  var count: Int
}

@Suite struct KeyValueStoreTests {
  /// The behaviour every KeyValueStore shares.
  func exercise(_ store: KeyValueStore) throws {
    #expect(store.getItem("virga:a") == nil)
    try store.setItem("virga:a", "1")
    try store.setItem("virga:b", "")
    #expect(store.getItem("virga:a") == "1")
    #expect(store.getItem("virga:b") == "", "an empty string is a value, not nothing")
    try store.setItem("virga:a", "2")
    #expect(store.getItem("virga:a") == "2")
    #expect(Set(store.allKeys()) == ["virga:a", "virga:b"])
    #expect(store.count == 2)
    store.removeItem("virga:a")
    store.removeItem("virga:missing")
    #expect(store.getItem("virga:a") == nil)
    #expect(store.allKeys() == ["virga:b"])

    try store.setJSON("virga:thing", Thing(name: "jo", count: 3))
    #expect(store.getJSON("virga:thing", as: Thing.self) == Thing(name: "jo", count: 3))
    #expect(store.getJSON("virga:thing")?["count"] == 3)
    try store.setItem("virga:broken", "{not json")
    #expect(store.getJSON("virga:broken") == nil)
    #expect(store.getJSON("virga:broken", as: Thing.self) == nil)
    #expect(store.getJSON("virga:b") == nil, "'' reads as nothing, as JSON.parse(x || 'null') does")
    try store.setItem("virga:unicode", "naïve 👍🏽 \u{2028}")
    #expect(store.getItem("virga:unicode") == "naïve 👍🏽 \u{2028}")
    // A key that starts with a combining mark is still listed as itself.
    try store.setItem("\u{301}k", "v")
    #expect(store.allKeys().contains("\u{301}k"))
    #expect(store.getItem("\u{301}k") == "v")
  }

  @Test func inMemory() throws {
    try exercise(InMemoryKeyValueStore())
  }

  @Test func inMemoryStartsWithWhatItIsGiven() {
    let store = InMemoryKeyValueStore(["k": "v"])
    #expect(store.getItem("k") == "v")
    #expect(store.snapshot == ["k": "v"])
  }

  @Test func aQuotaRefusesWhatWouldOverflowIt() throws {
    let store = InMemoryKeyValueStore(quota: 10)
    try store.setItem("ab", "cdef")  // 6 units
    #expect(throws: KeyValueStoreError.quotaExceeded(key: "gh")) { try store.setItem("gh", "ijk") }
    try store.setItem("ab", "cdefghij")  // replacing counts the new value only: 10
    #expect(store.getItem("ab") == "cdefghij")
    #expect(store.getItem("gh") == nil)
    #expect(KeyValueStoreError.quotaExceeded(key: "gh").errorDescription == "Setting the value of 'gh' exceeded the quota.")
  }

  @Test func aRefusingStoreThrowsAndKeepsWhatItHad() throws {
    let store = InMemoryKeyValueStore(["k": "v"])
    store.refusesWrites = true
    #expect(throws: KeyValueStoreError.refused(key: "k")) { try store.setItem("k", "w") }
    #expect(store.getItem("k") == "v")
    store.refusesWrites = false
    try store.setItem("k", "w")
    #expect(store.getItem("k") == "w")
  }

  @Test func concurrentWritesAllLand() async throws {
    let store = InMemoryKeyValueStore()
    await withTaskGroup(of: Void.self) { group in
      for i in 0..<200 {
        group.addTask { try? store.setItem("k\(i)", "\(i)") }
      }
    }
    #expect(store.count == 200)
  }

  @Test func userDefaults() throws {
    let suite = "virga.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = UserDefaultsKeyValueStore(defaults: defaults, prefix: "test:")
    try exercise(store)
    // Only the store's own keys, under its prefix.
    defaults.set("other", forKey: "notOurs")
    #expect(!store.allKeys().contains("notOurs"))
    #expect(defaults.string(forKey: "test:virga:b") == "")
    // A second store over the same defaults sees the same values.
    let again = UserDefaultsKeyValueStore(defaults: defaults, prefix: "test:")
    #expect(again.getItem("virga:thing") != nil)
    // Another prefix is another store.
    let elsewhere = UserDefaultsKeyValueStore(defaults: defaults, prefix: "elsewhere:")
    #expect(elsewhere.allKeys().isEmpty)
  }
}

@Suite struct FileStoreTests {
  func exercise(_ store: FileStore) async throws {
    #expect(try await store.read("analytics/did:plc:a/posts.json") == nil)
    #expect(try await store.list("") == [])
    try await store.write(Data("one".utf8), to: "analytics/did:plc:a/posts.json")
    try await store.write(Data("two".utf8), to: "analytics/did:plc:a/followers.json")
    try await store.write(Data([0, 1, 2, 255]), to: "posting/did:plc:a/media/ref-1")
    try await store.write(Data(), to: "empty")
    #expect(try await store.read("analytics/did:plc:a/posts.json") == Data("one".utf8))
    #expect(try await store.read("posting/did:plc:a/media/ref-1") == Data([0, 1, 2, 255]))
    #expect(try await store.read("empty") == Data(), "an empty file is there, and empty")
    #expect(try await store.exists("empty"))
    #expect(try await store.read("analytics") == nil, "a directory is not a file")

    try await store.write(Data("uno".utf8), to: "analytics/did:plc:a/posts.json")
    #expect(try await store.read("analytics/did:plc:a/posts.json") == Data("uno".utf8))

    #expect(
      try await store.list("") == [
        "analytics/did:plc:a/followers.json", "analytics/did:plc:a/posts.json", "empty",
        "posting/did:plc:a/media/ref-1",
      ])
    #expect(try await store.list("analytics") == ["analytics/did:plc:a/followers.json", "analytics/did:plc:a/posts.json"])
    #expect(try await store.list("analytics/did:plc:a/posts.json") == [], "a file has nothing under it")
    #expect(try await store.list("nowhere") == [])

    try await store.delete("analytics/did:plc:a/followers.json")
    try await store.delete("never/there")
    #expect(try await store.read("analytics/did:plc:a/followers.json") == nil)
    try await store.delete("analytics")
    #expect(try await store.list("analytics") == [])
    #expect(try await store.list("") == ["empty", "posting/did:plc:a/media/ref-1"])

    try await store.writeJSON(Thing(name: "jo", count: 2), to: "json/thing.json")
    #expect(try await store.readJSON("json/thing.json", as: Thing.self) == Thing(name: "jo", count: 2))
    #expect(try await store.readJSON("json/none.json", as: Thing.self) == nil)

    for bad in ["", "/abs", "a//b", "a/./b", "../escape", "a/..", "trailing/", "back\\slash"] {
      await #expect(throws: FileStoreError.invalidPath(bad)) { try await store.write(Data(), to: bad) }
      await #expect(throws: FileStoreError.self) { _ = try await store.read(bad) }
    }
    await #expect(throws: FileStoreError.self) { _ = try await store.list("../") }
  }

  @Test func inMemory() async throws {
    try await exercise(InMemoryFileStore())
  }

  /// A combining mark joins the "/" before it into one Character; the
  /// path is still cut at that "/", so ".." can't hide behind one.
  func combiningMarks(_ store: FileStore) async throws {
    for bad in ["../\u{301}", "a/../\u{301}", "..\u{301}/../x", "a/\u{301}/../../x"] {
      let parts = bad.unicodeScalars.split(separator: "/").map { String(String.UnicodeScalarView($0)) }
      if parts.contains("..") {
        await #expect(throws: FileStoreError.invalidPath(bad)) { try await store.write(Data("x".utf8), to: bad) }
      }
    }
    try await store.write(Data("x".utf8), to: "a/\u{301}b")
    #expect(try await store.list("a") == ["a/\u{301}b"])
    #expect(try await store.read("a/\u{301}b") == Data("x".utf8))
    try await store.write(Data("y".utf8), to: "\u{301}top")
    #expect(try await store.list("").contains("\u{301}top"))
    try await store.delete("a")
    #expect(try await store.read("a/\u{301}b") == nil, "deleting a directory takes what is under it")
  }

  @Test func combiningMarksInMemory() async throws {
    try await combiningMarks(InMemoryFileStore())
  }

  @Test func combiningMarksOnDisk() async throws {
    let base = try temporaryDirectory()
    let inner = base.appendingPathComponent("store", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: base) }
    try await combiningMarks(DiskFileStore(baseURL: inner))
    // Nothing was written beside the store.
    #expect(try FileManager.default.contentsOfDirectory(atPath: base.path) == ["store"])
  }

  @Test func inMemoryKeepsFilesAndDirectoriesApart() async throws {
    let store = InMemoryFileStore()
    try await store.write(Data("x".utf8), to: "a/b")
    await #expect(throws: FileStoreError.self) { try await store.write(Data(), to: "a") }
    await #expect(throws: FileStoreError.self) { try await store.write(Data(), to: "a/b/c") }
  }

  func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("virga-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  @Test func onDisk() async throws {
    let base = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: base) }
    let store = DiskFileStore(baseURL: base)
    try await exercise(store)
    // What it wrote is a plain file where the path says, and nothing else
    // (no temporary file left behind by the atomic write).
    let file = base.appendingPathComponent("posting/did:plc:a/media/ref-1")
    #expect(FileManager.default.contents(atPath: file.path) == Data([0, 1, 2, 255]))
    let leftovers = try FileManager.default.contentsOfDirectory(atPath: file.deletingLastPathComponent().path)
    #expect(leftovers == ["ref-1"])
  }

  @Test func onDiskInABaseThatDoesNotExistYet() async throws {
    let base = try temporaryDirectory().appendingPathComponent("not/yet", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: base.deletingLastPathComponent().deletingLastPathComponent()) }
    let store = DiskFileStore(baseURL: base)
    #expect(try await store.list("") == [])
    #expect(try await store.read("x") == nil)
    try await store.write(Data("x".utf8), to: "x")
    #expect(try await store.list("") == ["x"])
  }

  @Test func concurrentWritesAllLand() async throws {
    let base = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: base) }
    for store in [DiskFileStore(baseURL: base) as FileStore, InMemoryFileStore()] {
      try await withThrowingTaskGroup(of: Void.self) { group in
        for i in 0..<50 {
          group.addTask { try await store.write(Data("\(i)".utf8), to: "many/\(i % 5)/file-\(i)") }
        }
        try await group.waitForAll()
      }
      #expect(try await store.list("many").count == 50)
      #expect(try await store.read("many/3/file-13") == Data("13".utf8))
    }
  }
}
