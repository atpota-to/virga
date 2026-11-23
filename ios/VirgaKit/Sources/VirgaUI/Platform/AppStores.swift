// The app's storage, over the logic targets' protocols:
//
//   KeyValueStore   the web's localStorage: UserDefaults, in a suite of the
//                   app's own (`<bundle id>.localStorage`), every key the
//                   web's (`virga:preferences`, `virga:accounts`, …) under
//                   VirgaCore's UserDefaultsKeyValueStore prefix.
//   tab storage     the web's sessionStorage: in memory, for this run.
//   FileStore       the web's IndexedDB: files under the app's Application
//                   Support directory (`Virga/`), written atomically.
//   SecretStore     a long session's token: the Keychain, a generic
//                   password under the app's service, readable after the
//                   device's first unlock and never synced off it.
//
// The device's backups (iCloud's, or a computer's) take the file store's
// folder and the key-value store, as iOS does for Application Support and
// UserDefaults, unless the person turns the folder's backup off in Settings ›
// Data and sync (`backupKey`). The Keychain item is this-device-only, so a
// backup never carries the token. The web has no counterpart: a browser
// doesn't back IndexedDB up anywhere.
//
// The demo (and previews, and tests) use the in-memory stand-ins of each.
// ios/AppTests holds these to the protocols.

#if canImport(UIKit)
import Foundation
import VirgaCore
import VirgaSession

public struct AppStores {
  public var keyValue: any KeyValueStore
  public var tab: any KeyValueStore
  public var files: any FileStore
  public var secrets: any SecretStore
  /// Where the file store keeps its files on disk (nil: in memory).
  public var filesDirectory: URL?

  public init(
    keyValue: any KeyValueStore, tab: any KeyValueStore, files: any FileStore, secrets: any SecretStore, filesDirectory: URL? = nil
  ) {
    self.keyValue = keyValue
    self.tab = tab
    self.files = files
    self.secrets = secrets
    self.filesDirectory = filesDirectory
  }

  /// The app's identity for its stores: its bundle identifier.
  public static var appIdentifier: String { Bundle.main.bundleIdentifier ?? "app.virga" }

  /// The suite the key-value store keeps its keys in.
  public static func suiteName(_ app: String = appIdentifier) -> String { "\(app).localStorage" }

  /// The Keychain service the tokens are kept under.
  public static func keychainService(_ app: String = appIdentifier) -> String { "\(app).session" }

  /// localStorage: UserDefaults in the app's own suite (the standard
  /// defaults if the suite can't be opened).
  public static func keyValueStore(suite: String = suiteName()) -> any KeyValueStore {
    UserDefaultsKeyValueStore(suiteName: suite) ?? UserDefaultsKeyValueStore()
  }

  /// IndexedDB's folder: `Application Support/Virga/` (made if it isn't there).
  public static func fileStoreDirectory(_ directory: String = AppConfig.appName) -> URL {
    let fm = FileManager.default
    let base = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
      ?? fm.temporaryDirectory
    let root = base.appendingPathComponent(directory, isDirectory: true)
    try? fm.createDirectory(at: root, withIntermediateDirectories: true)
    return root
  }

  /// IndexedDB: the files under `fileStoreDirectory`.
  public static func fileStore(directory: String = AppConfig.appName) -> any FileStore {
    DiskFileStore(baseURL: fileStoreDirectory(directory))
  }

  /// How much the folder holds on disk, in bytes (navigator.storage's
  /// estimate, for the app's own files), or nil with no folder to read.
  public static func bytesUsed(at directory: URL?) async -> Int? {
    guard let directory else { return nil }
    return await Task.detached(priority: .utility) { () -> Int? in walk(directory) }.value
  }

  /// The folder's files' sizes added up, read synchronously (the
  /// enumerator isn't for an async context).
  static func walk(_ directory: URL) -> Int? {
    let keys: [URLResourceKey] = [.totalFileAllocatedSizeKey, .fileAllocatedSizeKey, .isRegularFileKey]
    guard let files = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: keys) else { return nil }
    var total = 0
    while let url = files.nextObject() as? URL {
      guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true else { continue }
      total += values.totalFileAllocatedSize ?? values.fileAllocatedSize ?? 0
    }
    return total
  }

  /// The tokens: the Keychain, this device only, after first unlock.
  public static func secretStore(service: String = keychainService()) -> any SecretStore {
    KeychainSecretStore(service: service)
  }

  // MARK: Backups

  /// Whether the file store's folder goes into the device's backups, in the
  /// key-value store, for everyone on the device: "off" leaves it out, and
  /// anything else, or nothing, keeps it in. The app's own key; the web has
  /// no backup to choose.
  public static let backupKey = "virga:ios-backup"

  /// Whether the folder is to be backed up: yes unless it was turned off.
  public static func backsUp(_ store: any KeyValueStore) -> Bool {
    store.getItem(backupKey) != "off"
  }

  /// Keeps the choice and marks the folder to match (with no folder, as in
  /// the demo, only the choice is kept).
  public static func setBacksUp(_ on: Bool, store: any KeyValueStore, directory: URL?) {
    try? store.setItem(backupKey, on ? "on" : "off")
    markBackup(on, directory: directory)
  }

  /// Marks the folder in or out of backups. Leaving a folder out leaves out
  /// everything under it, files written later included. The mark stays
  /// with the folder, and the store never removes the folder itself, but
  /// the app sets it again at every launch, in case the folder was made anew.
  @discardableResult
  public static func markBackup(_ on: Bool, directory: URL?) -> Bool {
    guard var directory else { return false }
    var values = URLResourceValues()
    values.isExcludedFromBackup = !on
    do {
      try directory.setResourceValues(values)
      return true
    } catch {
      return false
    }
  }

  /// Whether the folder is marked to be left out of backups (nil: no folder,
  /// or the mark can't be read).
  public static func isExcludedFromBackup(_ directory: URL?) -> Bool? {
    guard let directory else { return nil }
    return (try? directory.resourceValues(forKeys: [.isExcludedFromBackupKey]))?.isExcludedFromBackup
  }

  /// The app's own, its folder marked in or out of backups as last chosen.
  public static func device() -> AppStores {
    let directory = fileStoreDirectory()
    let keyValue = keyValueStore()
    markBackup(backsUp(keyValue), directory: directory)
    return AppStores(
      keyValue: keyValue, tab: InMemoryKeyValueStore(), files: DiskFileStore(baseURL: directory), secrets: secretStore(),
      filesDirectory: directory)
  }

  /// Nothing persists: the demo's, a preview's.
  public static func inMemory(_ items: [String: String] = [:], secrets: [String: String] = [:]) -> AppStores {
    AppStores(
      keyValue: InMemoryKeyValueStore(items), tab: InMemoryKeyValueStore(), files: InMemoryFileStore(),
      secrets: InMemorySecretStore(secrets))
  }
}
#endif
