// The app's stores (VirgaUI's Platform/AppStores.swift), held to the
// logic targets' protocols on a real device's storage: the web's
// localStorage in a UserDefaults suite of the app's own, its IndexedDB under
// Application Support, a long session's token in the Keychain.

// VirgaUI exists only where UIKit does (iOS); a `swift build` on a Mac
// skips these with it.
#if canImport(UIKit)
import Foundation
import Security
import VirgaCore
import VirgaSession
import VirgaUI
import XCTest

final class KeyValueStoreTests: XCTestCase {
  private var suite = ""

  override func setUp() {
    suite = "app.virga.tests.\(UUID().uuidString)"
  }

  override func tearDown() {
    UserDefaults.standard.removePersistentDomain(forName: suite)
  }

  func testTheSuiteIsTheAppsOwn() {
    XCTAssertEqual(AppStores.suiteName("app.virga"), "app.virga.localStorage")
  }

  func testKeepsTheWebsKeysAndValues() throws {
    let store = AppStores.keyValueStore(suite: suite)
    let json = "{\"sky\":\"dusk\",\"accent\":\"teal\"}"
    try store.setItem(Preferences.preferencesKey, json)
    XCTAssertEqual(store.getItem(Preferences.preferencesKey), json)
    XCTAssertEqual(store.allKeys(), [Preferences.preferencesKey])
    // Another store over the same suite (another window, the next launch) reads it.
    XCTAssertEqual(AppStores.keyValueStore(suite: suite).getItem(Preferences.preferencesKey), json)
  }

  func testRemovesAKey() throws {
    let store = AppStores.keyValueStore(suite: suite)
    try store.setItem("virga:account", "did:plc:abc")
    store.removeItem("virga:account")
    XCTAssertNil(store.getItem("virga:account"))
    XCTAssertEqual(store.allKeys(), [])
  }

  func testListsOnlyItsOwnKeys() throws {
    let store = AppStores.keyValueStore(suite: suite)
    UserDefaults(suiteName: suite)?.set("system", forKey: "NotTheWebs")
    try store.setItem("virga:accounts", "[]")
    XCTAssertEqual(store.allKeys(), ["virga:accounts"])
  }

  func testThePreferencesRoundTrip() {
    let store = AppStores.keyValueStore(suite: suite)
    var prefs = Preferences()
    prefs.sky = .night
    prefs.accent = .rose
    Preferences.writePreferences(prefs, store: store)
    XCTAssertEqual(Preferences.readPreferences(store: store), prefs)
  }
}

final class FileStoreTests: XCTestCase {
  private var directory = ""

  override func setUp() {
    directory = "VirgaTests-\(UUID().uuidString)"
  }

  override func tearDown() {
    let base = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
    if let base { try? FileManager.default.removeItem(at: base.appendingPathComponent(directory)) }
  }

  func testWritesReadsAndListsUnderApplicationSupport() async throws {
    let store = AppStores.fileStore(directory: directory)
    let bytes = Data("{\"posts\":[]}".utf8)
    try await store.write(bytes, to: "analytics/did:plc:abc/posts.json")
    let read = try await store.read("analytics/did:plc:abc/posts.json")
    XCTAssertEqual(read, bytes)
    let listed = try await store.list("analytics")
    XCTAssertEqual(listed, ["analytics/did:plc:abc/posts.json"])
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
    let file = base.appendingPathComponent(directory).appendingPathComponent("analytics/did:plc:abc/posts.json")
    XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
  }

  func testDeletesAFolderAndWhatIsInIt() async throws {
    let store = AppStores.fileStore(directory: directory)
    try await store.write(Data("a".utf8), to: "posting/did:plc:abc/media/1")
    try await store.delete("posting/did:plc:abc")
    let gone = try await store.read("posting/did:plc:abc/media/1")
    XCTAssertNil(gone)
  }

  func testTheFolderIsBackedUpUntilThatIsTurnedOff() async throws {
    let kv = InMemoryKeyValueStore()
    let folder = AppStores.fileStoreDirectory(directory)
    XCTAssertTrue(AppStores.backsUp(kv), "backups are on before anyone chooses")
    XCTAssertTrue(AppStores.markBackup(AppStores.backsUp(kv), directory: folder))
    XCTAssertEqual(AppStores.isExcludedFromBackup(folder), false)

    AppStores.setBacksUp(false, store: kv, directory: folder)
    XCTAssertEqual(kv.getItem(AppStores.backupKey), "off")
    XCTAssertFalse(AppStores.backsUp(kv))
    XCTAssertEqual(AppStores.isExcludedFromBackup(folder), true)
    // What the store writes afterwards lands in the folder that's left out.
    try await DiskFileStore(baseURL: folder).write(Data("{}".utf8), to: "analytics/did:plc:abc/posts.json")
    XCTAssertEqual(AppStores.isExcludedFromBackup(folder), true)

    AppStores.setBacksUp(true, store: kv, directory: folder)
    XCTAssertEqual(kv.getItem(AppStores.backupKey), "on")
    XCTAssertEqual(AppStores.isExcludedFromBackup(folder), false)
  }

  func testWithNoFolderOnlyTheChoiceIsKept() {
    let kv = InMemoryKeyValueStore()
    AppStores.setBacksUp(false, store: kv, directory: nil)
    XCTAssertFalse(AppStores.backsUp(kv))
    XCTAssertFalse(AppStores.markBackup(false, directory: nil))
    XCTAssertNil(AppStores.isExcludedFromBackup(nil))
  }

  func testAnUnknownStoredValueStillBacksUp() throws {
    let kv = InMemoryKeyValueStore()
    try kv.setItem(AppStores.backupKey, "maybe")
    XCTAssertTrue(AppStores.backsUp(kv))
  }

  func testRefusesAPathOutsideTheStore() async {
    let store = AppStores.fileStore(directory: directory)
    do {
      try await store.write(Data("x".utf8), to: "../outside")
      XCTFail("a path out of the store was written")
    } catch {
      XCTAssertTrue(error is FileStoreError, "\(error)")
    }
  }
}

final class SecretStoreTests: XCTestCase {
  private var service = ""

  override func setUp() {
    service = "app.virga.tests.\(UUID().uuidString)"
  }

  /// The simulator refuses the Keychain to an app built without signing
  /// (errSecMissingEntitlement); the store then can't be checked here.
  private func keep(_ store: any SecretStore, _ value: String, for key: String) throws {
    do {
      try store.setSecret(value, for: key)
    } catch let error as KeychainError where error.status == errSecMissingEntitlement {
      throw XCTSkip("The Keychain isn't open to an unsigned build.")
    }
  }

  func testKeepsReplacesAndForgetsAToken() throws {
    let store = AppStores.secretStore(service: service)
    let key = Accounts.backendTokenKey("did:plc:abc")
    try keep(store, "vg_" + String(repeating: "a", count: 64), for: key)
    XCTAssertEqual(store.secret(for: key), "vg_" + String(repeating: "a", count: 64))
    try keep(store, "vg_" + String(repeating: "b", count: 64), for: key)
    XCTAssertEqual(store.secret(for: key), "vg_" + String(repeating: "b", count: 64))
    store.removeSecret(for: key)
    XCTAssertNil(store.secret(for: key))
  }

  func testKeepsItOnThisDeviceAfterTheFirstUnlock() throws {
    let store = AppStores.secretStore(service: service)
    let key = Accounts.backendTokenKey("did:plc:xyz")
    try keep(store, "secret", for: key)
    defer { store.removeSecret(for: key) }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecReturnAttributes as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &result), errSecSuccess)
    let attributes = result as? [String: Any]
    XCTAssertEqual(attributes?[kSecAttrAccessible as String] as? String, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
  }

  func testAMissingTokenIsNil() {
    XCTAssertNil(AppStores.secretStore(service: service).secret(for: "virga:backend-token:did:plc:none"))
  }
}
#endif
