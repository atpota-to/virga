// A cache that holds the read under way, not only its answer: the web's
// `cache.set(key, promise)` pattern (atproto.js's DID documents, pds.js's
// resolver). Callers asking for the same key at the same time share one
// read; a read that fails is dropped, so the next caller asks again rather
// than inheriting the failure; an entry older than its time to live is read
// again. Keys are compared by code unit, as a JavaScript Map compares them.

import Foundation
import VirgaCore

public actor PromiseCache<Value: Sendable> {
  struct Entry {
    let id: UInt64
    let task: Task<Value, any Error>
    let at: Double
  }

  private var entries: [JSKey: Entry] = [:]
  private var counter: UInt64 = 0

  public init() {}

  /// The value for `key`: the held read when there is one younger than
  /// `ttl` milliseconds (nil: for ever), else a new `read()`.
  public func value(
    for key: String,
    ttl: Double? = nil,
    now: Double,
    read: @escaping @Sendable () async throws -> Value
  ) async throws -> Value {
    let key = JSKey(key)
    if let held = entries[key], ttl.map({ now - held.at < $0 }) ?? true {
      return try await held.task.value
    }
    counter += 1
    let id = counter
    let task = Task { try await read() }
    entries[key] = Entry(id: id, task: task, at: now)
    do {
      return try await task.value
    } catch {
      if entries[key]?.id == id { entries[key] = nil }
      throw error
    }
  }

  /// Holds a value learned another way, so no read is needed.
  public func set(_ key: String, _ value: Value, now: Double = 0) {
    counter += 1
    entries[JSKey(key)] = Entry(id: counter, task: Task { value }, at: now)
  }

  public func remove(_ key: String) {
    entries[JSKey(key)] = nil
  }

  public func removeAll() {
    entries = [:]
  }

  public func contains(_ key: String) -> Bool { entries[JSKey(key)] != nil }
}
