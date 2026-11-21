// Ports src/lib/analyticsStore.js
//
// The archive's store: the web's IndexedDB database per account, kept here
// in VirgaCore's FileStore (the app's DiskFileStore; tests and the demo an
// InMemoryFileStore). One database per DID, named as the web names it
// (`virga-analytics:<did>`), with the same object stores and key paths and
// the same rows as JSON, so an archive written by one reads in the other.
//
// Layout, under `analytics/<the name, URI-encoded>/`:
//
//   schema.json           { name, version, stores: { store: keyPath } }
//   <store>/<seq>.json    one write: { op: 'put', rows } | { op: 'remove',
//                         keys } | { op: 'base', rows } (the whole store)
//
// A store is its segments replayed in order (a `base` starts afresh), so a
// write costs what it writes, not the store's size, and the order the
// writes were made in is the order they land in: a page persisted before
// its cursor is checkpointed is always there when the cursor is. Past
// `compactAfter` segments, a store is rewritten as one base.
//
// Everything degrades, as on the web. Without a file store, or with a
// database a newer build wrote (a version above `dbVersion`), the same API
// is served from memory: the archive works for the session and re-syncs
// next time. No caller ever sees a storage error; a failed read is an empty
// store, a failed write is dropped.

import Foundation
import VirgaCore

/// The store handle every consumer of one account's archive shares.
public protocol AnalyticsStoreHandle: AnyObject, Sendable {
  /// Whether rows will survive a restart.
  var persistent: Bool { get }
  /// Whether the database is held by something at an older version (the
  /// web's other tab). Never true on iOS; kept for the model's words.
  var blocked: Bool { get }
  /// Every row of `store`, in key order (memory: in the order first written).
  func all(_ store: String) async -> [JSONValue]
  /// Writes `rows` (a row without its key is skipped) in one go.
  func putAll(_ store: String, _ rows: [JSONValue]) async
  /// Removes the rows with these keys in one go.
  func remove(_ store: String, _ keys: [JSONValue]) async
  /// Empties `store`.
  func clear(_ store: String) async
  /// The meta record `key`, or nil.
  func getMeta(_ key: String) async -> JSONValue?
  /// Writes the meta record `key` (`{ ...facts, key }`).
  func setMeta(_ key: String, _ facts: JSONValue) async
}

/// A key as IndexedDB orders it: numbers before strings, numbers by value,
/// strings by UTF-16 code unit.
enum AnalyticsStoreKey: Hashable, Comparable {
  case number(Double)
  case string(JSKey)

  /// A row's key, or nil for one IndexedDB wouldn't take (missing, null, NaN,
  /// or a kind this port doesn't key by: a boolean, an object, an array).
  init?(_ value: JSONValue?) {
    switch value {
    case .some(.number(let n)) where !n.isNaN: self = .number(n == 0 ? 0 : n)
    case .some(.string(let s)): self = .string(JSKey(s))
    default: return nil
    }
  }

  var json: JSONValue {
    switch self {
    case .number(let n): return .number(n)
    case .string(let s): return .string(s.value)
    }
  }

  static func < (a: AnalyticsStoreKey, b: AnalyticsStoreKey) -> Bool {
    switch (a, b) {
    case (.number(let x), .number(let y)): return x < y
    case (.number, .string): return true
    case (.string, .number): return false
    case (.string(let x), .string(let y)): return Array(x.value.utf16).lexicographicallyPrecedes(Array(y.value.utf16))
    }
  }
}

public enum AnalyticsStore {
  static let dbPrefix = "virga-analytics:"

  /// The schema's version. Opening creates any store an older database
  /// lacks and touches nothing else; a database above it is a newer
  /// build's, and is served from memory instead.
  public static let dbVersion = 1

  /// Where the file store keeps every account's archive.
  public static let rootDirectory = "analytics"

  /// The database holding one account's archive.
  public static func analyticsDbName(_ did: String) -> String {
    "\(dbPrefix)\(did)"
  }

  /// Store name → key path: one object store per archive, plus sync marks.
  public static let stores: [(name: String, keyPath: String)] = [
    ("posts", "uri"),
    ("followers", "did"),
    ("following", "uri"),
    ("blocks", "uri"),
    ("inbound", "uri"),
    ("outbound", "uri"),
    ("atmosphere", "uri"),
    ("actors", "did"),
    ("meta", "key"),
  ]

  static func keyPath(_ store: String) -> String? {
    stores.first { $0.name.jsEquals(store) }?.keyPath
  }

  /// The directory a database lives in.
  static func directory(_ name: String) -> String {
    "\(rootDirectory)/\(JSURI.encodeURIComponent(name))"
  }

  /// Open (once per account) and return the store handle for `did`. The
  /// handle is memoized per account in `registry`, so every consumer shares
  /// it; a failed open memoizes the memory fallback rather than retrying.
  /// No DID, or no file store, is the memory fallback.
  public static func openAnalyticsStore(
    _ did: String?, files: (any FileStore)?, registry: AnalyticsStoreRegistry = .shared
  ) async -> any AnalyticsStoreHandle {
    guard let did, !did.isEmpty else { return MemoryAnalyticsStore() }
    return await registry.handle(for: did) {
      guard let files else { return MemoryAnalyticsStore() }
      return await FileAnalyticsStore.open(name: analyticsDbName(did), files: files) ?? MemoryAnalyticsStore()
    }
  }

  /// Forget every memoized handle, so the next open of any account reads
  /// its database afresh. What the session calls after deleting an
  /// account's data (its `resetAnalyticsStore` closure).
  public static func resetAnalyticsStore(registry: AnalyticsStoreRegistry = .shared) {
    registry.reset()
  }

  /// `indexedDB.deleteDatabase(name)` for the archive's databases: removes
  /// `virga-analytics:<did>`'s files, closing a handle open on it (its
  /// calls then fall back as if the database had gone). False for a name
  /// that isn't an archive's, or when the files can't be removed. The app
  /// routes the session's `deleteDatabase` here for these names.
  public static func deleteDatabase(
    _ name: String, files: (any FileStore)?, registry: AnalyticsStoreRegistry = .shared
  ) async -> Bool {
    let units = Array(name.utf16)
    let prefix = Array(dbPrefix.utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix, let files else { return false }
    let did = String(jsUnits: units[prefix.count...])
    if let open = registry.forget(did) { await open.close() }
    do {
      try await files.delete(directory(name))
      return true
    } catch {
      return false
    }
  }
}

/// The memoized handles (the web's module-level `_handles`), one per DID.
public final class AnalyticsStoreRegistry: Sendable {
  private let handles = Locked<[JSKey: Task<any AnalyticsStoreHandle, Never>]>([:])

  public init() {}

  /// The app's registry.
  public static let shared = AnalyticsStoreRegistry()

  func handle(
    for did: String, open: @escaping @Sendable () async -> any AnalyticsStoreHandle
  ) async -> any AnalyticsStoreHandle {
    let task = handles.withLock { handles -> Task<any AnalyticsStoreHandle, Never> in
      if let task = handles[JSKey(did)] { return task }
      let task = Task { await open() }
      handles[JSKey(did)] = task
      return task
    }
    return await task.value
  }

  /// Forget `did`'s handle, giving back the file store's if it was one.
  func forget(_ did: String) -> Task<any AnalyticsStoreHandle, Never>? {
    handles.withLock { $0.removeValue(forKey: JSKey(did)) }
  }

  func reset() {
    handles.withLock { $0.removeAll() }
  }
}

extension Task where Success == any AnalyticsStoreHandle, Failure == Never {
  /// Close the handle if it is a file store's.
  func close() async {
    if let store = await value as? FileAnalyticsStore { await store.close() }
  }
}

// MARK: - Memory

/// The fallback: every store in memory, in the order rows were first written.
public actor MemoryAnalyticsStore: AnalyticsStoreHandle {
  public nonisolated let persistent = false
  public nonisolated let blocked: Bool
  private var mem: [String: (order: [AnalyticsStoreKey], rows: [AnalyticsStoreKey: JSONValue])]

  public init(blocked: Bool = false) {
    self.blocked = blocked
    mem = Dictionary(uniqueKeysWithValues: AnalyticsStore.stores.map { ($0.name, ([], [:])) })
  }

  public func all(_ store: String) async -> [JSONValue] {
    guard let m = mem[store] else { return [] }
    return m.order.compactMap { m.rows[$0] }
  }

  public func putAll(_ store: String, _ rows: [JSONValue]) async {
    guard var m = mem[store], let keyPath = AnalyticsStore.keyPath(store) else { return }
    for row in rows {
      guard let key = AnalyticsStoreKey(row[keyPath]) else { continue }
      if m.rows[key] == nil { m.order.append(key) }
      m.rows[key] = row
    }
    mem[store] = m
  }

  public func remove(_ store: String, _ keys: [JSONValue]) async {
    guard var m = mem[store] else { return }
    let gone = Set(keys.compactMap { AnalyticsStoreKey($0) })
    guard !gone.isEmpty else { return }
    for key in gone { m.rows[key] = nil }
    m.order.removeAll { gone.contains($0) }
    mem[store] = m
  }

  public func clear(_ store: String) async {
    if mem[store] != nil { mem[store] = ([], [:]) }
  }

  public func getMeta(_ key: String) async -> JSONValue? {
    guard let row = mem["meta"]?.rows[.string(JSKey(key))], row.isTruthy else { return nil }
    return row
  }

  public func setMeta(_ key: String, _ facts: JSONValue) async {
    await putAll("meta", [AnalyticsStoreRow.withKey(facts, key)])
  }
}

enum AnalyticsStoreRow {
  /// `{ ...facts, key }`.
  static func withKey(_ facts: JSONValue, _ key: String) -> JSONValue {
    var members = facts.objectValue ?? [:]
    members["key"] = .string(key)
    return .object(members)
  }
}

// MARK: - Files

/// One account's database in a file store.
public actor FileAnalyticsStore: AnalyticsStoreHandle {
  public nonisolated let persistent = true
  public nonisolated let blocked = false
  /// The database's name (`virga-analytics:<did>`).
  public nonisolated let name: String
  let files: any FileStore
  let root: String
  private var loaded: [String: StoreState] = [:]
  private var closed = false

  /// A store's rows and where its next segment goes.
  struct StoreState {
    var rows: [AnalyticsStoreKey: JSONValue] = [:]
    var nextSeq = 0
    var segments: [String] = []
  }

  /// Past this many segments a store is rewritten as one.
  static let compactAfter = 32

  init(name: String, files: any FileStore) {
    self.name = name
    self.files = files
    root = AnalyticsStore.directory(name)
  }

  /// Open the database: make it (or bring an older one up to `dbVersion`),
  /// or nil when it can't be used (written by a newer build, unreadable
  /// schema, a store that refuses writes).
  static func open(name: String, files: any FileStore) async -> FileAnalyticsStore? {
    let store = FileAnalyticsStore(name: name, files: files)
    let path = "\(store.root)/schema.json"
    do {
      var version = 0
      if let data = try await files.read(path) {
        guard let schema = try? JSONValue.parse(data), let held = schema["version"]?.intValue else { return nil }
        version = held
      }
      if version > AnalyticsStore.dbVersion { return nil }
      if version < AnalyticsStore.dbVersion {
        // The upgrade: every store a database lacks exists from here on
        // (an absent store reads empty), and nothing held is touched.
        let schema: JSONValue = [
          "name": .string(name),
          "version": .number(Double(AnalyticsStore.dbVersion)),
          "stores": .object(Dictionary(uniqueKeysWithValues: AnalyticsStore.stores.map { ($0.name, JSONValue.string($0.keyPath)) })),
        ]
        try await files.write(try schema.data(sortedKeys: true), to: path)
      }
      return store
    } catch {
      return nil
    }
  }

  /// Step aside (the database was deleted): every later call falls back as
  /// if the database had gone.
  func close() {
    closed = true
    loaded = [:]
  }

  static func segmentName(_ seq: Int) -> String {
    let digits = String(seq)
    return String(repeating: "0", count: max(0, 12 - digits.count)) + digits + ".json"
  }

  /// The store's state, read from its segments the first time.
  private func state(_ store: String) async throws -> StoreState {
    if let state = loaded[store] { return state }
    guard let keyPath = AnalyticsStore.keyPath(store) else { throw FileStoreError.invalidPath(store) }
    var state = StoreState()
    let dir = "\(root)/\(store)"
    for path in try await files.list(dir) {
      guard let data = try await files.read(path), let segment = try? JSONValue.parse(data) else { continue }
      let file = String(path.utf16.split(separator: 0x2F).last.map { String(jsUnits: $0) } ?? "")
      if let seq = Int(file.replacingOccurrences(of: ".json", with: "")) { state.nextSeq = max(state.nextSeq, seq + 1) }
      state.segments.append(path)
      switch segment["op"]?.stringValue {
      case "base":
        state.rows = [:]
        for row in segment["rows"]?.arrayValue ?? [] {
          if let key = AnalyticsStoreKey(row[keyPath]) { state.rows[key] = row }
        }
      case "put":
        for row in segment["rows"]?.arrayValue ?? [] {
          if let key = AnalyticsStoreKey(row[keyPath]) { state.rows[key] = row }
        }
      case "remove":
        for key in segment["keys"]?.arrayValue ?? [] {
          if let key = AnalyticsStoreKey(key) { state.rows[key] = nil }
        }
      default:
        continue
      }
    }
    loaded[store] = state
    return state
  }

  /// Writes one segment, then applies it; rewrites the store as one base
  /// when it has too many.
  private func append(_ store: String, _ segment: JSONValue, apply: (inout StoreState) -> Void) async throws {
    var state = try await state(store)
    let path = "\(root)/\(store)/\(Self.segmentName(state.nextSeq))"
    try await files.write(try segment.data(sortedKeys: false), to: path)
    state.nextSeq += 1
    state.segments.append(path)
    apply(&state)
    if state.segments.count > Self.compactAfter {
      let rows = state.rows.keys.sorted().compactMap { state.rows[$0] }
      let base = "\(root)/\(store)/\(Self.segmentName(state.nextSeq))"
      let old = state.segments
      do {
        try await files.write(try JSONValue.object(["op": "base", "rows": .array(rows)]).data(sortedKeys: false), to: base)
        state.nextSeq += 1
        state.segments = [base]
        for path in old { try? await files.delete(path) }
      } catch {
        // Kept as segments: the store still reads the same.
      }
    }
    loaded[store] = state
  }

  public func all(_ store: String) async -> [JSONValue] {
    guard !closed, let state = try? await state(store) else { return [] }
    return state.rows.keys.sorted().compactMap { state.rows[$0] }
  }

  public func putAll(_ store: String, _ rows: [JSONValue]) async {
    guard !closed, !rows.isEmpty, let keyPath = AnalyticsStore.keyPath(store) else { return }
    let keyed = rows.compactMap { row in AnalyticsStoreKey(row[keyPath]).map { ($0, row) } }
    guard !keyed.isEmpty else { return }
    // Dropped on failure: the next sync rebuilds what this write lost.
    try? await append(store, ["op": "put", "rows": .array(keyed.map(\.1))]) { state in
      for (key, row) in keyed { state.rows[key] = row }
    }
  }

  public func remove(_ store: String, _ keys: [JSONValue]) async {
    guard !closed, !keys.isEmpty, AnalyticsStore.keyPath(store) != nil else { return }
    let gone = keys.compactMap { AnalyticsStoreKey($0) }
    guard !gone.isEmpty else { return }
    try? await append(store, ["op": "remove", "keys": .array(gone.map(\.json))]) { state in
      for key in gone { state.rows[key] = nil }
    }
  }

  public func clear(_ store: String) async {
    guard !closed, AnalyticsStore.keyPath(store) != nil else { return }
    do {
      try await files.delete("\(root)/\(store)")
      var state = (try? await self.state(store)) ?? StoreState()
      state.rows = [:]
      state.segments = []
      loaded[store] = state
    } catch {
      // Ignored, as the web ignores a failed clear.
    }
  }

  public func getMeta(_ key: String) async -> JSONValue? {
    guard !closed, let state = try? await state("meta"), let row = state.rows[.string(JSKey(key))], row.isTruthy else {
      return nil
    }
    return row
  }

  public func setMeta(_ key: String, _ facts: JSONValue) async {
    await putAll("meta", [AnalyticsStoreRow.withKey(facts, key)])
  }
}
