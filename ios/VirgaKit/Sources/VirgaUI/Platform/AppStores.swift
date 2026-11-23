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

  /// The app's own.
  public static func device() -> AppStores {
    let directory = fileStoreDirectory()
    return AppStores(
      keyValue: keyValueStore(), tab: InMemoryKeyValueStore(), files: DiskFileStore(baseURL: directory), secrets: secretStore(),
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
