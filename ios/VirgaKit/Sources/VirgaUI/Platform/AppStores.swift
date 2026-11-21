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

  public init(keyValue: any KeyValueStore, tab: any KeyValueStore, files: any FileStore, secrets: any SecretStore) {
    self.keyValue = keyValue
    self.tab = tab
    self.files = files
    self.secrets = secrets
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

  /// IndexedDB: `Application Support/Virga/` (made if it isn't there).
  public static func fileStore(directory: String = AppConfig.appName) -> any FileStore {
    let fm = FileManager.default
    let base = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
      ?? fm.temporaryDirectory
    let root = base.appendingPathComponent(directory, isDirectory: true)
    try? fm.createDirectory(at: root, withIntermediateDirectories: true)
    return DiskFileStore(baseURL: root)
  }

  /// The tokens: the Keychain, this device only, after first unlock.
  public static func secretStore(service: String = keychainService()) -> any SecretStore {
    KeychainSecretStore(service: service)
  }

  /// The app's own.
  public static func device() -> AppStores {
    AppStores(keyValue: keyValueStore(), tab: InMemoryKeyValueStore(), files: fileStore(), secrets: secretStore())
  }

  /// Nothing persists: the demo's, a preview's.
  public static func inMemory(_ items: [String: String] = [:], secrets: [String: String] = [:]) -> AppStores {
    AppStores(
      keyValue: InMemoryKeyValueStore(items), tab: InMemoryKeyValueStore(), files: InMemoryFileStore(),
      secrets: InMemorySecretStore(secrets))
  }
}
#endif
