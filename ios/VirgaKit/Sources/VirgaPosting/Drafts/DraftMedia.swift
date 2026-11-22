// Ports src/posting/drafts/draftMedia.js
//
// The pictures and videos in saved drafts, kept on this device. A Bluesky
// draft can't hold media: it names each file by a `localRef` path that only
// means something on the device that saved it. Virga keeps those files in a
// store per account, keyed by the path, so a draft reopened here gets its
// media back and one opened anywhere else says its media is on another
// device.
//
// On the web the store is IndexedDB (`virga-posting:<did>`, store `media`,
// keyPath `ref`), with memory standing in where IndexedDB can't open. Here it
// is VirgaCore's FileStore (DraftMediaStorage: the app's DiskFileStore), laid
// out as the database is: under `<postingDbName(did)>/media/<ref>/`, each
// entry's file as `file` and the rest of the entry (`{ ref, name, type, size,
// savedAt }`, and the file's own name, type, size and lastModified) as
// `entry.json`, both names escaped into single path segments. Without a
// storage configured the same API is served from memory: the files last for
// the run, and nothing throws.

import Foundation
import VirgaCore

/// One kept file: `{ ref, file, name, type, size, savedAt }`. `file` is the
/// file as a state holds it (a ComposerFile's JSON), any value an older
/// entry held.
public struct DraftMediaEntry: Codable, Hashable, Sendable {
  public var ref: String
  public var file: JSONValue?
  public var name: JSONValue?
  public var type: JSONValue?
  public var size: JSONValue?
  public var savedAt: JSONValue?

  public init(
    ref: String, file: JSONValue?, name: JSONValue? = nil, type: JSONValue? = nil, size: JSONValue? = nil,
    savedAt: JSONValue? = nil
  ) {
    self.ref = ref
    self.file = file
    self.name = name
    self.type = type
    self.size = size
    self.savedAt = savedAt
  }

  /// The entry as the web's object, without the members it doesn't have.
  public var json: JSONValue {
    var out: JSONValue = ["ref": .string(ref)]
    if let file { out["file"] = file }
    if let name { out["name"] = name }
    if let type { out["type"] = type }
    if let size { out["size"] = size }
    if let savedAt { out["savedAt"] = savedAt }
    return out
  }

  public init(json: JSONValue) {
    self.init(
      ref: json["ref"]?.stringValue ?? "", file: json["file"], name: json["name"], type: json["type"],
      size: json["size"], savedAt: json["savedAt"])
  }
}

/// An account's media store, opened once and shared (the web's guarded
/// handle): `put` reports a failure to its caller; a failed `get`, `remove`
/// or `refs` reads as nothing (left behind; pruneDraftMedia catches it next
/// time).
public protocol DraftMediaStore: Sendable {
  /// False when only memory is holding the files.
  var persistent: Bool { get }
  /// Keeps the entries, replacing any under the same ref; all or none.
  func put(_ entries: [DraftMediaEntry]) async throws
  /// The entry kept under `ref`, or nil.
  func get(_ ref: String) async -> DraftMediaEntry?
  func remove(_ refs: [String]) async
  /// Every ref held.
  func refs() async -> [String]
}

/// Draft media in memory: kept in the order first put (a Map's), for the run.
public actor MemoryDraftMedia: DraftMediaStore {
  private var order: [JSKey] = []
  private var rows: [JSKey: DraftMediaEntry] = [:]

  public init() {}

  public nonisolated var persistent: Bool { false }

  public func put(_ entries: [DraftMediaEntry]) async throws {
    for entry in entries {
      let key = JSKey(entry.ref)
      if rows[key] == nil { order.append(key) }
      rows[key] = entry
    }
  }

  public func get(_ ref: String) async -> DraftMediaEntry? { rows[JSKey(ref)] }

  public func remove(_ refs: [String]) async {
    for ref in refs {
      let key = JSKey(ref)
      if rows.removeValue(forKey: key) != nil { order.removeAll { $0 == key } }
    }
  }

  public func refs() async -> [String] { order.map(\.value) }
}

/// Where draft media persist: the web's IndexedDB. `store` holds the bytes
/// (the app's DiskFileStore under Application Support), and `files` reads a
/// picked file's bytes and hands a kept one back as a file.
public struct DraftMediaStorage: Sendable {
  public var store: any FileStore
  public var files: any ComposerFiles

  public init(store: any FileStore, files: any ComposerFiles) {
    self.store = store
    self.files = files
  }
}

/// Draft media kept in a FileStore, as IndexedDB keeps them on the web.
public struct FileStoreDraftMedia: DraftMediaStore {
  public let did: String
  public let storage: DraftMediaStorage

  public init(did: String, storage: DraftMediaStorage) {
    self.did = did
    self.storage = storage
  }

  public var persistent: Bool { true }

  /// The directory an account's media are under: `<postingDbName(did)>/media`.
  public var directory: String { "\(DraftMedia.pathSegment(DraftMedia.postingDbName(did)))/media" }

  func folder(_ ref: String) -> String { "\(directory)/\(DraftMedia.pathSegment(ref))" }

  /// What `entry.json` holds: the entry without its bytes, and the file's own fields.
  struct Stored: Codable {
    var ref: String
    var name: JSONValue?
    var type: JSONValue?
    var size: JSONValue?
    var savedAt: JSONValue?
    var file: JSONValue?
  }

  public func put(_ entries: [DraftMediaEntry]) async throws {
    var written: [String] = []
    do {
      for entry in entries {
        let folder = folder(entry.ref)
        var fileFields: JSONValue? = entry.file
        if let file = ComposerFile(json: entry.file) {
          let data = try await storage.files.bytes(of: file)
          try await storage.store.write(data, to: "\(folder)/file")
          var fields = file.json
          fields["ref"] = nil
          fileFields = fields
        } else {
          try await storage.store.delete("\(folder)/file")
        }
        written.append(folder)
        let stored = Stored(
          ref: entry.ref, name: entry.name, type: entry.type, size: entry.size, savedAt: entry.savedAt,
          file: fileFields)
        try await storage.store.writeJSON(stored, to: "\(folder)/entry.json")
      }
    } catch {
      // One transaction on the web: what this put wrote goes again.
      for folder in written { try? await storage.store.delete(folder) }
      throw error
    }
  }

  public func get(_ ref: String) async -> DraftMediaEntry? {
    do {
      let folder = folder(ref)
      guard let stored = try await storage.store.readJSON("\(folder)/entry.json", as: Stored.self) else { return nil }
      var file = stored.file
      if let fields = stored.file, ComposerFile.isFile(fields) {
        let kept = try await storage.files.storedFile(
          at: "\(folder)/file", in: storage.store, name: fields["name"]?.stringValue,
          type: fields["type"]?.stringValue ?? "", size: fields["size"]?.doubleValue ?? 0,
          lastModified: fields["lastModified"]?.doubleValue)
        file = kept?.json
      }
      return DraftMediaEntry(
        ref: stored.ref, file: file, name: stored.name, type: stored.type, size: stored.size,
        savedAt: stored.savedAt)
    } catch {
      return nil
    }
  }

  public func remove(_ refs: [String]) async {
    for ref in refs { try? await storage.store.delete(folder(ref)) }
  }

  public func refs() async -> [String] {
    guard let paths = try? await storage.store.list(directory) else { return [] }
    let prefix = Array("\(directory)/".unicodeScalars)
    var refs: [String] = []
    for path in paths {
      let scalars = Array(path.unicodeScalars)
      guard scalars.count > prefix.count, Array(scalars[0..<prefix.count]) == prefix else { continue }
      let rest = String(String.UnicodeScalarView(scalars[prefix.count...]))
      let parts = rest.split(separator: "/", omittingEmptySubsequences: false)
      guard parts.count == 2, parts[1] == "entry.json", let ref = DraftMedia.unescapeSegment(String(parts[0])) else {
        continue
      }
      refs.append(ref)
    }
    // IndexedDB's getAllKeys: in key order, strings by code unit.
    return refs.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
  }
}

public enum DraftMedia {
  public static let postingDbPrefix = "virga-posting:"
  /// Paths Virga mints, so a localRef written by another app (a phone's file
  /// path) is never looked up here as if it might be ours.
  public static let localRefPrefix = "virga-media:"

  public static func postingDbName(_ did: String) -> String { "\(postingDbPrefix)\(did)" }

  public static func isVirgaLocalRef(_ path: String?) -> Bool {
    guard let path else { return false }
    return PostingJS.hasPrefix(path, localRefPrefix)
  }

  public static func isVirgaLocalRef(_ path: JSONValue?) -> Bool { isVirgaLocalRef(path?.stringValue) }

  /// `crypto.randomUUID()`: a version 4 UUID, lower-case.
  public static func randomUUID() -> String { UUID().uuidString.lowercased() }

  /// A fresh localRef path for a file about to be kept.
  public static func newLocalRef(uuid: () -> String = randomUUID) -> String { "\(localRefPrefix)\(uuid())" }

  // MARK: The stores

  /// Where draft media persist (the app sets this at launch); nil keeps them
  /// in memory for the run, as the web does without IndexedDB.
  public static let storage = Locked<DraftMediaStorage?>(nil)

  static let handles = Locked<[JSKey: any DraftMediaStore]>([:])

  /// `did`'s media store, opened once and shared. No DID gets a store of its own in memory.
  public static func openDraftMedia(_ did: String?, storage: DraftMediaStorage? = nil) -> any DraftMediaStore {
    guard let did, !did.isEmpty else { return MemoryDraftMedia() }
    let backing = storage ?? Self.storage.wrappedValue
    return handles.withLock { handles in
      if let open = handles[JSKey(did)] { return open }
      let store: any DraftMediaStore = backing.map { FileStoreDraftMedia(did: did, storage: $0) } ?? MemoryDraftMedia()
      handles[JSKey(did)] = store
      return store
    }
  }

  /// Forget the open stores (Remove from this device, and tests).
  public static func resetDraftMedia() {
    handles.withLock { $0.removeAll() }
  }

  /// A path segment for a database name or a ref: every unit outside
  /// `[A-Za-z0-9_-]` escaped as `%XX` of its UTF-8 bytes, so it can never be
  /// `.`, `..` or hold a `/`.
  static func pathSegment(_ text: String) -> String {
    var out = ""
    for byte in text.utf8 {
      switch byte {
      case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"),
        UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "-"), UInt8(ascii: "_"):
        out.unicodeScalars.append(Unicode.Scalar(byte))
      default:
        out += String(format: "%%%02X", byte)
      }
    }
    return out
  }

  static func unescapeSegment(_ segment: String) -> String? {
    var bytes: [UInt8] = []
    var units = Array(segment.utf8)[...]
    while let byte = units.popFirst() {
      if byte == UInt8(ascii: "%") {
        guard units.count >= 2, let value = UInt8(String(decoding: units.prefix(2), as: UTF8.self), radix: 16) else {
          return nil
        }
        bytes.append(value)
        units = units.dropFirst(2)
      } else {
        bytes.append(byte)
      }
    }
    return String(bytes: bytes, encoding: .utf8)
  }

  // MARK: Media in a ComposerState

  /// `v && typeof v === 'object' && typeof v.size === 'number' && typeof v.type === 'string'`.
  static func isFileLike(_ value: JSONValue?) -> Bool {
    guard case .object? = value else { return false }
    if case .number? = value?["size"], case .string? = value?["type"] { return true }
    return false
  }

  /// Where an item of a state's media is: `{ kind, postIndex, imageIndex, item }`.
  struct At {
    var kind: String
    var postIndex: Int
    var imageIndex: Int?
    var item: JSONValue
  }

  static func mediaOf(_ state: JSONValue?) -> [At] {
    var out: [At] = []
    for (postIndex, post) in ComposerJS.list(state?["posts"]).enumerated() {
      for (imageIndex, image) in ComposerJS.list(post["images"]).enumerated() {
        out.append(At(kind: "image", postIndex: postIndex, imageIndex: imageIndex, item: image))
      }
      if let video = post["video"], video.isTruthy {
        out.append(At(kind: "video", postIndex: postIndex, imageIndex: nil, item: video))
      }
    }
    return out
  }

  /// `{ ...item, ...patch }` at `at`, in a copy of the state.
  static func withItem(_ state: JSONValue, _ at: At, _ patch: [String: JSONValue]) -> JSONValue {
    var out = state
    var posts = ComposerJS.list(state["posts"])
    guard posts.indices.contains(at.postIndex) else { return state }
    var post = posts[at.postIndex]
    if at.kind == "video" {
      var video = ComposerJS.spread(post["video"])
      for (key, value) in patch { video[key] = value }
      post = .object(ComposerJS.spread(post).merging(["video": .object(video)]) { $1 })
    } else {
      var images = ComposerJS.list(post["images"])
      if let index = at.imageIndex, images.indices.contains(index) {
        var image = ComposerJS.spread(images[index])
        for (key, value) in patch { image[key] = value }
        images[index] = .object(image)
      }
      post = .object(ComposerJS.spread(post).merging(["images": .array(images)]) { $1 })
    }
    posts[at.postIndex] = post
    out["posts"] = .array(posts)
    return out
  }

  /// Every localRef path a state's media carries.
  public static func stateLocalRefs(_ state: JSONValue?) -> [String] {
    mediaOf(state).compactMap { at in
      guard let ref = at.item["localRef"]?.stringValue, !ref.isEmpty else { return nil }
      return ref
    }
  }

  /// What storeDraftMedia gives back: the state with the paths set, and
  /// every path it now uses.
  public struct Stored: Sendable, Hashable {
    public var state: JSONValue
    public var refs: [String]
  }

  /// Keep every picked file in `state` that `did`'s store doesn't hold yet,
  /// and give it a `localRef`. A file that already has one of Virga's paths
  /// keeps it, and is copied into this store when it isn't there (a draft
  /// opened from one account and saved as another). Media without a file are
  /// left as they are. Throws when the files couldn't be written, so a draft
  /// never names media this device doesn't hold.
  public static func storeDraftMedia(
    _ did: String?, _ state: JSONValue, media: (any DraftMediaStore)? = nil,
    now: Double = Date().timeIntervalSince1970 * 1000, newRef: () -> String = { newLocalRef() }
  ) async throws -> Stored {
    let store = media ?? openDraftMedia(did)
    var next = state
    var entries: [DraftMediaEntry] = []
    for at in mediaOf(state) {
      let item = at.item
      guard isFileLike(item["file"]), let file = item["file"] else { continue }
      var ref = isVirgaLocalRef(item["localRef"]) ? item["localRef"]?.stringValue : nil
      if let held = ref, await store.get(held) != nil { continue }
      // A new file, or one attached again over another app's path, which
      // this device could never look up.
      if ref == nil {
        let minted = newRef()
        ref = minted
        next = withItem(next, at, ["localRef": .string(minted)])
      }
      let type = file["type"].truthy ?? item["mime"].truthy ?? ""
      entries.append(
        DraftMediaEntry(
          ref: ref ?? "", file: file, name: .string(file["name"]?.stringValue ?? ""), type: type,
          size: file["size"], savedAt: .number(now)))
    }
    try await store.put(entries)
    return Stored(state: next, refs: stateLocalRefs(next))
  }

  /// What loadDraftMedia gives back: the state with the files found, and the
  /// paths it couldn't find (media saved on another device, or cleared since).
  public struct Loaded: Sendable, Hashable {
    public var state: JSONValue
    public var missing: [String]
  }

  /// Give back the files a state's localRefs name, where this device holds
  /// them. A missing item keeps its path and alt text so the composer can
  /// ask for it again. `makePreviewUrl(file)` gives each found image its
  /// preview (nil for none: the web's URL.createObjectURL has no logic-side
  /// equivalent, so the app passes its own).
  public static func loadDraftMedia(
    _ did: String?, _ state: JSONValue, media: (any DraftMediaStore)? = nil,
    makePreviewUrl: (@Sendable (JSONValue) throws -> String?)? = nil
  ) async -> Loaded {
    let store = media ?? openDraftMedia(did)
    var next = state
    var missing: [String] = []
    for at in mediaOf(state) {
      let item = at.item
      guard let ref = item["localRef"], ref.isTruthy, !isFileLike(item["file"]) else { continue }
      var entry: DraftMediaEntry?
      if isVirgaLocalRef(ref), let path = ref.stringValue { entry = await store.get(path) }
      guard let entry, let file = entry.file, file.isTruthy else {
        if !(item["blob"]?.isTruthy ?? false) { missing.append(ref.stringValue ?? ref.jsString) }
        continue
      }
      var patch: [String: JSONValue] = ["file": file, "mime": entry.type.truthy ?? item["mime"].truthy ?? ""]
      if let size = entry.size.nonNull ?? file["size"] { patch["size"] = size }
      if at.kind == "image", !(item["previewUrl"]?.isTruthy ?? false), let makePreviewUrl {
        do {
          let url = try makePreviewUrl(file)
          patch["previewUrl"] = url.map(JSONValue.string) ?? .null
        } catch {
          // No preview; the composer shows the file's name.
        }
      }
      next = withItem(next, at, patch)
    }
    return Loaded(state: next, missing: missing)
  }

  /// The media a state names that it has neither a file nor an uploaded
  /// blob for: what has to be attached again before the post can go out,
  /// `{ kind, postIndex, imageIndex, localRef, alt }`.
  public static func missingDraftMedia(_ state: JSONValue?) -> [JSONValue] {
    mediaOf(state).compactMap { at in
      let item = at.item
      guard let ref = item["localRef"], ref.isTruthy, !isFileLike(item["file"]), !(item["blob"]?.isTruthy ?? false)
      else { return nil }
      var out: JSONValue = [
        "kind": .string(at.kind), "postIndex": .number(Double(at.postIndex)), "localRef": ref,
        "alt": item["alt"].truthy ?? "",
      ]
      if let index = at.imageIndex { out["imageIndex"] = .number(Double(index)) }
      return out
    }
  }

  /// Forget the files at `refs` (only Virga's own paths).
  public static func removeDraftMedia(_ did: String?, _ refs: [JSONValue]?, media: (any DraftMediaStore)? = nil) async {
    let list = (refs ?? []).compactMap { isVirgaLocalRef($0) ? $0.stringValue : nil }
    if list.isEmpty { return }
    let store = media ?? openDraftMedia(did)
    await store.remove(list)
  }

  public static func removeDraftMedia(_ did: String?, _ refs: [String], media: (any DraftMediaStore)? = nil) async {
    await removeDraftMedia(did, refs.map(JSONValue.string), media: media)
  }

  /// Forget every file no draft in `keep` still names. Only safe with the
  /// complete list of the account's drafts, plus any path the open composer
  /// holds. With `savedBefore` (a time in ms), a file kept at or after it
  /// stays whatever `keep` says: it may belong to a draft being saved while
  /// the list was read. Returns the paths forgotten.
  public static func pruneDraftMedia(
    _ did: String?, _ keep: [JSONValue]?, media: (any DraftMediaStore)? = nil, savedBefore: Double? = nil
  ) async -> [String] {
    let store = media ?? openDraftMedia(did)
    let kept = keep ?? []
    var drop = await store.refs().filter { ref in !kept.contains { ComposerJS.sameValueZero($0, .string(ref)) } }
    if let savedBefore {
      var old: [String] = []
      for ref in drop {
        let entry = await store.get(ref)
        // Every entry this module writes has a savedAt; one without can't
        // be from a save in progress.
        let fresh = entry.map { ComposerJS.greaterOrEqual($0.savedAt, .number(savedBefore)) } ?? false
        if entry == nil || !fresh { old.append(ref) }
      }
      drop = old
    }
    await store.remove(drop)
    return drop
  }
}
