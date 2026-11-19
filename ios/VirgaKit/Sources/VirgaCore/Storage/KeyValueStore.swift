// The web app's localStorage, as a protocol: small string values by key,
// read and written synchronously, as the web reads and writes them. Ports
// keep the web's keys (`virga:preferences`, `virga:composer-autosave:<did>`)
// and its JSON, so `store.getItem(key)` reads exactly what the web would.
//
// The method names are the Web Storage API's, so a port reads like the code
// it ports. `setItem` throws where a browser can (a full or refused
// storage), and ports catch it where the web does. Logic never touches
// UserDefaults directly (PORTING.md): it takes a `KeyValueStore`, the app
// passes `UserDefaultsKeyValueStore`, tests and the demo
// `InMemoryKeyValueStore`.

import Foundation

public protocol KeyValueStore: Sendable {
  /// `localStorage.getItem(key)`: the value, or nil when there is none.
  func getItem(_ key: String) -> String?
  /// `localStorage.setItem(key, value)`. Throws when the store refuses
  /// (`KeyValueStoreError`), as a full browser storage does.
  func setItem(_ key: String, _ value: String) throws
  /// `localStorage.removeItem(key)`.
  func removeItem(_ key: String)
  /// Every key held, in no particular order (`localStorage.key(i)` for each i).
  func allKeys() -> [String]
}

public enum KeyValueStoreError: Error, Equatable, LocalizedError {
  /// The write would take the store past its quota.
  case quotaExceeded(key: String)
  /// The store refuses all writes (a test's stand-in for a disabled storage).
  case refused(key: String)

  public var errorDescription: String? {
    switch self {
    case .quotaExceeded(let key): return "Setting the value of '\(key)' exceeded the quota."
    case .refused(let key): return "The storage refused to set '\(key)'."
    }
  }
}

extension KeyValueStore {
  /// `JSON.parse(store.getItem(key) || 'null')` as the web writes it: the
  /// value as JSON, or nil when there is none or it isn't JSON.
  public func getJSON(_ key: String) -> JSONValue? {
    guard let text = getItem(key), !text.isEmpty else { return nil }
    return try? JSONValue.parse(text)
  }

  /// The stored JSON decoded as `T`, or nil when absent, unreadable or not a
  /// `T`. Read as JSON.parse reads it (so `{"a":1,}` is unreadable, as it is
  /// on the web), then decoded.
  public func getJSON<T: Decodable>(_ key: String, as type: T.Type) -> T? {
    guard let value = getJSON(key) else { return nil }
    return try? value.decode(T.self)
  }

  /// `store.setItem(key, JSON.stringify(value))`, as far as any reader can
  /// tell: the same JSON, though with its keys sorted (JSON.stringify keeps
  /// an object's insertion order). Where the stored text itself must be the
  /// web's byte for byte, write it yourself (Preferences.jsonString()).
  public func setJSON<T: Encodable>(_ key: String, _ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes, .sortedKeys]
    let data = try encoder.encode(value)
    try setItem(key, String(decoding: data, as: UTF8.self))
  }

  /// `localStorage.length`.
  public var count: Int { allKeys().count }
}

/// A store in memory: the tests', the demo's, and a stand-in where nothing
/// may persist. Can be given a quota (in UTF-16 code units of keys and
/// values, as browsers count it) or told to refuse writes, to exercise a
/// port's handling of a full storage.
public final class InMemoryKeyValueStore: KeyValueStore, Sendable {
  private let items: Locked<[String: String]>
  private let settings: Locked<(quota: Int?, refusesWrites: Bool)>

  public init(_ items: [String: String] = [:], quota: Int? = nil) {
    self.items = Locked(items)
    self.settings = Locked((quota, false))
  }

  /// Whether every write throws `KeyValueStoreError.refused`.
  public var refusesWrites: Bool {
    get { settings.wrappedValue.refusesWrites }
    set { settings.withLock { $0.refusesWrites = newValue } }
  }

  /// Everything held, for assertions.
  public var snapshot: [String: String] { items.wrappedValue }

  public func getItem(_ key: String) -> String? {
    items.wrappedValue[key]
  }

  public func setItem(_ key: String, _ value: String) throws {
    let (quota, refuses) = settings.wrappedValue
    if refuses { throw KeyValueStoreError.refused(key: key) }
    try items.withLock { items in
      if let quota {
        var used = items.reduce(0) { $0 + $1.key.utf16.count + $1.value.utf16.count }
        if let old = items[key] { used -= key.utf16.count + old.utf16.count }
        if used + key.utf16.count + value.utf16.count > quota { throw KeyValueStoreError.quotaExceeded(key: key) }
      }
      items[key] = value
    }
  }

  public func removeItem(_ key: String) {
    items.withLock { _ = $0.removeValue(forKey: key) }
  }

  public func allKeys() -> [String] {
    Array(items.wrappedValue.keys)
  }
}

/// The app's store: UserDefaults, every key under a prefix so the store
/// lists only its own keys (UserDefaults also holds the system's). Values
/// are strings, as localStorage's are.
public final class UserDefaultsKeyValueStore: KeyValueStore, @unchecked Sendable {
  // UserDefaults is documented as thread-safe.
  private let defaults: UserDefaults
  public let prefix: String

  /// `defaults` (the standard ones unless given) with keys under `prefix`.
  public init(defaults: UserDefaults = .standard, prefix: String = "localStorage:") {
    self.defaults = defaults
    self.prefix = prefix
  }

  /// A store in its own suite (`UserDefaults(suiteName:)`), for an app group
  /// or a test. Nil when the suite can't be opened.
  public convenience init?(suiteName: String, prefix: String = "localStorage:") {
    guard let defaults = UserDefaults(suiteName: suiteName) else { return nil }
    self.init(defaults: defaults, prefix: prefix)
  }

  public func getItem(_ key: String) -> String? {
    defaults.string(forKey: prefix + key)
  }

  public func setItem(_ key: String, _ value: String) throws {
    defaults.set(value, forKey: prefix + key)
  }

  public func removeItem(_ key: String) {
    defaults.removeObject(forKey: prefix + key)
  }

  public func allKeys() -> [String] {
    defaults.dictionaryRepresentation().keys
      .filter { $0.hasPrefix(prefix) }
      .map { String($0.dropFirst(prefix.count)) }
  }
}
