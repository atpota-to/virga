// Parity for src/posting/drafts/draftMedia.js (fixture publish.draftMedia):
// the paths, the media a state carries, and every store operation over the
// store in memory, with what the store held after. Behaviour tests hold the
// FileStore store (the web's IndexedDB) to the same API.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// _publish.js's withUuids: crypto.randomUUID counting up from 1.
final class CountingUUIDs: Sendable {
  private let n = Locked(0)
  func next() -> String {
    let value = n.withLock { value -> Int in
      value += 1
      return value
    }
    let digits = String(value)
    return "00000000-0000-4000-8000-" + String(repeating: "0", count: 12 - digits.count) + digits
  }
  var uuid: @Sendable () -> String { { [self] in next() } }
  var ref: @Sendable () -> String { { [self] in DraftMedia.newLocalRef(uuid: next) } }
}

/// What a fixture records of a store after a call: its refs and entries.
func storeJSON(_ media: any DraftMediaStore) async -> JSONValue {
  let refs = await media.refs()
  var entries: [JSONValue] = []
  for ref in refs { entries.append(await media.get(ref)?.json ?? .null) }
  return ["refs": .array(refs.map(JSONValue.string)), "entries": .array(entries), "persistent": .bool(media.persistent)]
}

@Suite struct DraftMediaParity {
  static let f = "publish.draftMedia"
  static let alice = "did:plc:alice"

  @Test func constants() throws {
    for c in try cases(Self.f, "draftMediaConstants") {
      check(["POSTING_DB_PREFIX": .string(DraftMedia.postingDbPrefix), "LOCAL_REF_PREFIX": .string(DraftMedia.localRefPrefix)], c)
    }
  }

  @Test func paths() throws {
    for c in try cases(Self.f, "postingDbName") {
      check(.string(DraftMedia.postingDbName(c.string("did") ?? "")), c)
    }
    for c in try cases(Self.f, "isVirgaLocalRef") {
      check(.bool(DraftMedia.isVirgaLocalRef(c.input["path"])), c)
    }
    for c in try cases(Self.f, "newLocalRef") {
      let uuids = CountingUUIDs()
      check([.string(uuids.ref()), .string(uuids.ref())], c)
    }
  }

  @Test func stateLocalRefsAndMissing() throws {
    for c in try cases(Self.f, "stateLocalRefs") {
      check(.array(DraftMedia.stateLocalRefs(c.input["state"]).map(JSONValue.string)), c)
    }
    for c in try cases(Self.f, "missingDraftMedia") {
      check(.array(DraftMedia.missingDraftMedia(c.input["state"])), c)
    }
  }

  static func seeded(_ c: ParityCase) async throws -> MemoryDraftMedia {
    let media = MemoryDraftMedia()
    try await media.put((c.input["seed"]?.arrayValue ?? []).map(DraftMediaEntry.init(json:)))
    return media
  }

  static func merged(_ result: JSONValue?, _ store: JSONValue) -> JSONValue {
    var out = store
    if let result { out["result"] = result }
    return out
  }

  @Test func storeDraftMedia() async throws {
    for c in try cases(Self.f, "storeDraftMedia") {
      let media = try await Self.seeded(c)
      let uuids = CountingUUIDs()
      let stored = try await DraftMedia.storeDraftMedia(
        Self.alice, c.input["state"] ?? .null, media: media, now: c.input["now"]?.doubleValue ?? 1, newRef: uuids.ref)
      let result: JSONValue = ["state": stored.state, "refs": .array(stored.refs.map(JSONValue.string))]
      check(Self.merged(result, await storeJSON(media)), c)
    }
  }

  @Test func loadDraftMedia() async throws {
    let previews: [String: (@Sendable (JSONValue) throws -> String?)?] = [
      "none": nil,
      "named": { file in "blob:\(file["name"]?.jsString ?? "undefined")" },
      "throws": { _ in throw JSONParseFailure() },
      "empty": { _ in nil },
    ]
    for c in try cases(Self.f, "loadDraftMedia") {
      let media = try await Self.seeded(c)
      let reopened = try c.input["state"] ?? JSONValue.parse(Self.reopened)
      let loaded = await DraftMedia.loadDraftMedia(
        Self.alice, reopened, media: media, makePreviewUrl: previews[c.string("preview") ?? "none"] ?? nil)
      let result: JSONValue = ["state": loaded.state, "missing": .array(loaded.missing.map(JSONValue.string))]
      check(Self.merged(result, await storeJSON(media)), c)
    }
  }

  struct JSONParseFailure: Error {}

  @Test func removeDraftMedia() async throws {
    for c in try cases(Self.f, "removeDraftMedia") {
      let media = try await Self.seeded(c)
      await DraftMedia.removeDraftMedia(Self.alice, c.input["refs"]?.arrayValue, media: media)
      check(await storeJSON(media), c)
    }
  }

  @Test func pruneDraftMedia() async throws {
    for c in try cases(Self.f, "pruneDraftMedia") {
      let media = try await Self.seeded(c)
      let dropped = await DraftMedia.pruneDraftMedia(
        c.string("did") ?? Self.alice, c.input["keep"]?.arrayValue, media: media,
        savedBefore: c.input["savedBefore"]?.doubleValue)
      check(Self.merged(.array(dropped.map(JSONValue.string)), await storeJSON(media)), c)
    }
  }

  static let reopened = """
    {"asDid":"did:plc:alice","posts":[{"id":"p1","images":[
      {"id":"x","localRef":"virga-media:1","alt":"a moth"},
      {"id":"y","localRef":"virga-media:untyped","mime":"image/webp"},
      {"id":"z","localRef":"virga-media:no-file","alt":"gone"},
      {"id":"w","localRef":"virga-media:sized","previewUrl":"blob:kept"},
      {"id":"u","localRef":"virga-media:missing","blob":{"ref":{"$link":"b"}}},
      {"id":"t","localRef":"file:///phone/1.jpg"},
      {"id":"s","localRef":"virga-media:1","file":{"name":"already.jpg","type":"image/jpeg","size":3}}]},
      {"id":"p2","images":[],"video":{"localRef":"virga-media:v","status":"idle"}}]}
    """
}

@Suite struct DraftMediaStoreBehaviour {
  static let alice = "did:plc:alice"

  static func storage() -> (DraftMediaStorage, InMemoryFileStore, InMemoryComposerFiles) {
    let store = InMemoryFileStore()
    let files = InMemoryComposerFiles(zeroFilled: false, now: { 1000 })
    return (DraftMediaStorage(store: store, files: files), store, files)
  }

  /// draftMedia.test.js: one database per account, opened once, its files kept.
  @Test func opensOneStorePerAccount() async throws {
    let (storage, _, _) = Self.storage()
    DraftMedia.resetDraftMedia()
    defer { DraftMedia.resetDraftMedia() }
    let alice = DraftMedia.openDraftMedia(Self.alice, storage: storage)
    let again = DraftMedia.openDraftMedia(Self.alice, storage: storage)
    #expect(alice.persistent)
    #expect((alice as? FileStoreDraftMedia)?.did == (again as? FileStoreDraftMedia)?.did)
    #expect(DraftMedia.postingDbName(Self.alice) == "virga-posting:did:plc:alice")
    // Without a storage, memory for the run; without a DID, a store of its own.
    DraftMedia.resetDraftMedia()
    #expect(!DraftMedia.openDraftMedia(Self.alice, storage: nil).persistent)
    #expect(!DraftMedia.openDraftMedia(nil).persistent)
  }

  /// The files go into the FileStore under the account's database name, and
  /// come back as files with the same bytes.
  @Test func keepsFilesInTheFileStore() async throws {
    let (storage, store, files) = Self.storage()
    let media = FileStoreDraftMedia(did: Self.alice, storage: storage)
    let picked = try await files.makeFile(Data([1, 2, 3]), name: "a.jpg", type: "image/jpeg", lastModified: 5)
    let state: JSONValue = [
      "asDid": .string(Self.alice),
      "posts": [["id": "p1", "images": [["id": "i1", "file": picked.json, "mime": "image/jpeg", "alt": "a moth"]]]],
    ]
    let uuids = CountingUUIDs()
    let saved = try await DraftMedia.storeDraftMedia(Self.alice, state, media: media, now: 42, newRef: uuids.ref)
    #expect(saved.refs == ["virga-media:00000000-0000-4000-8000-000000000001"])
    let paths = try await store.list("")
    #expect(
      paths == [
        "virga-posting%3Adid%3Aplc%3Aalice/media/virga-media%3A00000000-0000-4000-8000-000000000001/entry.json",
        "virga-posting%3Adid%3Aplc%3Aalice/media/virga-media%3A00000000-0000-4000-8000-000000000001/file",
      ])
    #expect(await media.refs() == saved.refs)

    // Reopened as a draft has them: paths and alt text, no files.
    let reopened: JSONValue = [
      "asDid": .string(Self.alice),
      "posts": [["id": "p1", "images": [["id": "x", "localRef": .string(saved.refs[0]), "alt": "a moth"]]]],
    ]
    let back = await DraftMedia.loadDraftMedia(Self.alice, reopened, media: media) { file in "preview:\(file["name"]?.jsString ?? "")" }
    #expect(back.missing.isEmpty)
    let image = back.state["posts"]?[0]?["images"]?[0]
    #expect(image?["mime"] == "image/jpeg")
    #expect(image?["size"] == 3)
    #expect(image?["previewUrl"] == "preview:a.jpg")
    let file = ComposerFile(json: image?["file"])
    #expect(file?.name == "a.jpg")
    #expect(file?.lastModified == 5)
    #expect(try await files.bytes(of: file!) == Data([1, 2, 3]))
    #expect(await media.get(saved.refs[0])?.savedAt == 42)

    // Forgotten again.
    await DraftMedia.removeDraftMedia(Self.alice, saved.refs, media: media)
    #expect(await media.refs().isEmpty)
    #expect(try await store.list("").isEmpty)
  }

  /// A put is all or none: when a file's bytes are gone, nothing of it stays.
  @Test func aFailedPutKeepsNothing() async throws {
    let (storage, store, files) = Self.storage()
    let media = FileStoreDraftMedia(did: Self.alice, storage: storage)
    let good = try await files.makeFile(Data([9]), name: "g.jpg", type: "image/jpeg", lastModified: 1)
    let gone = ComposerFile(name: "x.jpg", type: "image/jpeg", size: 4, ref: "nowhere")
    await #expect(throws: ComposerFileGoneError.self) {
      try await media.put([
        DraftMediaEntry(ref: "virga-media:good", file: good.json, savedAt: 1),
        DraftMediaEntry(ref: "virga-media:gone", file: gone.json, savedAt: 1),
      ])
    }
    #expect(try await store.list("").isEmpty)
    #expect(await media.refs().isEmpty)
  }

  /// Remove from this browser with its data: `virga-posting:<did>` goes,
  /// every kept file of that account with it, and its open store is
  /// forgotten (the web's handle closes on the delete's versionchange).
  /// Another account's files and store stay.
  @Test func deletingThePostingDatabaseRemovesThatAccountsFiles() async throws {
    let (storage, store, files) = Self.storage()
    let gone = "did:plc:deletes-its-drafts"
    let kept = "did:plc:keeps-its-drafts"
    let picked = try await files.makeFile(Data([1, 2, 3]), name: "a.jpg", type: "image/jpeg", lastModified: 5)
    func draft(_ did: String) -> JSONValue {
      ["asDid": .string(did), "posts": [["id": "p1", "images": [["id": "i1", "file": picked.json, "mime": "image/jpeg"]]]]]
    }
    let goneMedia = DraftMedia.openDraftMedia(gone, storage: storage)
    _ = try await DraftMedia.storeDraftMedia(gone, draft(gone), media: goneMedia, now: 1)
    let keptMedia = DraftMedia.openDraftMedia(kept, storage: storage)
    let keptSaved = try await DraftMedia.storeDraftMedia(kept, draft(kept), media: keptMedia, now: 1)

    #expect(DraftMedia.isPostingDbName(DraftMedia.postingDbName(gone)))
    #expect(!DraftMedia.isPostingDbName("virga-analytics:\(gone)"))
    #expect(!DraftMedia.isPostingDbName(DraftMedia.postingDbPrefix))
    #expect(await DraftMedia.deleteDatabase("virga-analytics:\(gone)", files: store) == false)
    #expect(await DraftMedia.deleteDatabase(DraftMedia.postingDbName(gone), files: store))

    let left = try await store.list("")
    #expect(left.allSatisfy { $0.hasPrefix("virga-posting%3Adid%3Aplc%3Akeeps-its-drafts/") }, "\(left)")
    #expect(left.count == 2, "\(left)")
    #expect(DraftMedia.handles.withLock { $0[JSKey(gone)] } == nil)
    #expect(await DraftMedia.openDraftMedia(gone, storage: storage).refs().isEmpty)
    #expect(await DraftMedia.openDraftMedia(kept, storage: storage).refs() == keptSaved.refs)
    // A database that isn't there deletes as IndexedDB's does: it went.
    #expect(await DraftMedia.deleteDatabase(DraftMedia.postingDbName("did:plc:never-saved"), files: store))
    _ = await DraftMedia.deleteDatabase(DraftMedia.postingDbName(kept), files: store)
  }

  /// Saving a draft again, and pruning, only look at the entries: the
  /// bytes are handed back as a file (a copy, on the device) only when a
  /// draft is opened, as IndexedDB's get hands back its stored File.
  @Test func checksReadEntriesWithoutCopyingTheBytes() async throws {
    let (storage, _, files) = Self.storage()
    let media = FileStoreDraftMedia(did: Self.alice, storage: storage)
    let picked = try await files.makeFile(Data([1, 2, 3]), name: "a.jpg", type: "image/jpeg", lastModified: 5)
    let state: JSONValue = [
      "asDid": .string(Self.alice),
      "posts": [["id": "p1", "images": [["id": "i1", "file": picked.json, "mime": "image/jpeg"]]]],
    ]
    let saved = try await DraftMedia.storeDraftMedia(Self.alice, state, media: media, now: 42, newRef: CountingUUIDs().ref)
    let made = await files.snapshot.count
    // Saved again: the file is held already, so nothing is copied or written.
    let again = try await DraftMedia.storeDraftMedia(Self.alice, saved.state, media: media, now: 99)
    #expect(again.refs == saved.refs)
    #expect(await files.snapshot.count == made)
    let held = try #require(await media.entry(saved.refs[0]))
    #expect(held.savedAt == 42)
    #expect(held.type == "image/jpeg")
    #expect(held.file?["name"] == "a.jpg")
    #expect(held.file?["size"] == 3)
    #expect(await media.entry("virga-media:none") == nil)
    // A prune reads when each was saved, and copies nothing either.
    #expect(await DraftMedia.pruneDraftMedia(Self.alice, [], media: media, savedBefore: 10).isEmpty)
    #expect(await files.snapshot.count == made)
    // Opening the draft hands the file back.
    let opened = await DraftMedia.loadDraftMedia(Self.alice, ["posts": [["id": "p1", "images": [["localRef": .string(saved.refs[0])]]]]], media: media)
    #expect(opened.missing.isEmpty)
    #expect(await files.snapshot.count == made + 1)
  }

  /// Refs come back in key order, as IndexedDB's getAllKeys gives them, and
  /// pruning leaves new files and the ones kept.
  @Test func prunesInKeyOrder() async throws {
    let (storage, _, files) = Self.storage()
    let media = FileStoreDraftMedia(did: Self.alice, storage: storage)
    let bytes = try await files.makeFile(Data([0]), name: "a", type: "image/jpeg", lastModified: 1)
    try await media.put([
      DraftMediaEntry(ref: "virga-media:c", file: bytes.json, savedAt: 100),
      DraftMediaEntry(ref: "virga-media:a", file: bytes.json, savedAt: 100),
      DraftMediaEntry(ref: "virga-media:new", file: bytes.json, savedAt: 300),
      DraftMediaEntry(ref: "virga-media:b/../x", file: bytes.json, savedAt: 100),
    ])
    #expect(await media.refs() == ["virga-media:a", "virga-media:b/../x", "virga-media:c", "virga-media:new"])
    let dropped = await DraftMedia.pruneDraftMedia(Self.alice, ["virga-media:a"], media: media, savedBefore: 200)
    #expect(dropped == ["virga-media:b/../x", "virga-media:c"])
    #expect(await media.refs() == ["virga-media:a", "virga-media:new"])
  }
}
