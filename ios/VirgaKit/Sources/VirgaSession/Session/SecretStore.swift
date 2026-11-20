// Ports src/session/accounts.js (where a long session's token is kept)
//
// Where a long session's token is kept: the iOS app's Keychain, not the
// key-value store the rest of the web's localStorage maps to. The token is
// what Virga's server holds the account's session behind, so it is kept as a
// secret: in the Keychain on Apple platforms (`KeychainSecretStore`), in
// memory for tests and the demo (`InMemorySecretStore`).
//
// The keys are the web's (`virga:backend-token:<did>`), so a port reads like
// the code it ports.

import Foundation
import VirgaCore

#if canImport(Security)
import Security
#endif

/// A small store of secrets by key, read and written synchronously as the
/// web reads and writes its localStorage.
public protocol SecretStore: Sendable {
  /// The secret for `key`, or nil when there is none (or it can't be read).
  func secret(for key: String) -> String?
  /// Keeps `value` for `key`, replacing what was there. Throws when it can't.
  func setSecret(_ value: String, for key: String) throws
  /// Forgets `key`. Nothing kept is no error.
  func removeSecret(for key: String)
}

/// Secrets in memory: the tests' and the demo's.
public final class InMemorySecretStore: SecretStore, Sendable {
  private let items: Locked<[String: String]>
  private let refusing: Locked<Bool>

  public init(_ items: [String: String] = [:], refusesWrites: Bool = false) {
    self.items = Locked(items)
    self.refusing = Locked(refusesWrites)
  }

  public func secret(for key: String) -> String? {
    items.wrappedValue.jsValue(key)
  }

  public func setSecret(_ value: String, for key: String) throws {
    if refusing.wrappedValue { throw KeyValueStoreError.refused(key: key) }
    items.withLock { $0[key] = value }
  }

  public func removeSecret(for key: String) {
    items.withLock { _ = $0.removeValue(forKey: key) }
  }

  /// Whether writes are refused (a test's stand-in for a locked Keychain).
  public var refusesWrites: Bool {
    get { refusing.wrappedValue }
    set { refusing.set(newValue) }
  }

  /// Everything held, for a test to look at.
  public var snapshot: [String: String] { items.wrappedValue }
}

#if canImport(Security)
/// Secrets in the Keychain, as generic passwords under one service, readable
/// after the device's first unlock (a scheduled post's check runs in the
/// background) and never synced off the device.
public struct KeychainSecretStore: SecretStore {
  public let service: String
  public let accessGroup: String?

  public init(service: String = "app.virga.session", accessGroup: String? = nil) {
    self.service = service
    self.accessGroup = accessGroup
  }

  private func query(_ key: String) -> [String: Any] {
    var q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
    ]
    if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
    return q
  }

  public func secret(for key: String) -> String? {
    var q = query(key)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  public func setSecret(_ value: String, for key: String) throws {
    let data = Data(value.utf8)
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(query(key) as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var add = query(key)
      add.merge(attributes) { _, new in new }
      status = SecItemAdd(add as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw KeychainError(status: status) }
  }

  public func removeSecret(for key: String) {
    SecItemDelete(query(key) as CFDictionary)
  }
}

/// A Keychain call that didn't succeed, with its OSStatus.
public struct KeychainError: Error, Sendable, Hashable, LocalizedError {
  public var status: Int32
  public var errorDescription: String? { "The Keychain refused (OSStatus \(status))." }
}
#endif
