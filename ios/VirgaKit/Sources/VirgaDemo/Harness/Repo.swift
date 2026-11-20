// Ports harness/repo.js
//
// The account's repo as the harness changes it. The fixtures in a world
// (World.buildWorld) are the repo as it was when the app opened; writes from
// the fake agent and from the fake server's publisher land here, in memory,
// and every reader (listRecords, getRecord, the author feed, the repo CAR,
// the public post views) goes through these functions, so a post written in
// the composer shows up everywhere a real one would.
//
// Records written here get their real CIDs (the DAG-CBOR hash the PDS would
// assign, VirgaRepo's RecordCid), because a thread is written with CIDs the
// client computed and a later read has to agree with them. The fixtures
// keep the placeholder 'bafyharness'.
//
// The web reads the clock for a written post's time (`new Date()`); here the
// caller passes `now`, as everywhere in the port. The web keeps a cache of
// each collection's listing until the next write; nothing else changes a
// world, so listing afresh gives the same rows.

import Foundation
import VirgaCore
import VirgaRepo

public enum HarnessRepo {
  static let post = "app.bsky.feed.post"

  /// The collections a world keeps as arrays of its own (`ARRAYS`).
  static func arrayName(_ collection: String) -> WritableKeyPath<AccountWorld, [WorldRecordRow]>? {
    switch collection {
    case "app.bsky.graph.follow": return \.follows
    case "app.bsky.feed.like": return \.likes
    case "app.bsky.feed.repost": return \.reposts
    default: return nil
    }
  }

  /// The names `ARRAYS[collection]` also finds, on Object.prototype: the web
  /// takes them for a collection with an array and fails on the array that
  /// isn't there.
  static let prototypeKeys: Set<String> = [
    "constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "__lookupGetter__",
    "__lookupSetter__", "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "__proto__",
    "toLocaleString",
  ]

  static func isPrototypeKey(_ collection: String) -> Bool {
    prototypeKeys.contains { $0.jsEquals(collection) }
  }

  public static func keyOf(_ collection: String, _ rkey: String) -> String { "\(collection)/\(rkey)" }

  /// `at://did/collection/rkey` → its parts, or nil.
  public static func parseAtUri(_ uri: String?) -> ParsedAtUri? {
    let text = uri ?? ""
    guard text.jsHasPrefix("at://") else { return nil }
    let parts = text.jsSlice(5).jsSplit("/")
    guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty }),
      !parts[2].utf16.contains(where: { $0 == 0x3F || $0 == 0x23 })  // ? and #
    else { return nil }
    return ParsedAtUri(did: parts[0], collection: parts[1], rkey: parts[2])
  }

  /// `{ did, collection, rkey }` of an AT-URI.
  public struct ParsedAtUri: Codable, Hashable, Sendable {
    public var did: String
    public var collection: String
    public var rkey: String
  }

  /// An XRPC-shaped failure: `error` is the lexicon's name, `status` the
  /// HTTP one, `message` what the web's XRPCError says.
  public struct XrpcError: Error, Hashable, Sendable, LocalizedError {
    public let name = "XRPCError"
    public var status: Int
    public var error: String
    public var message: String

    public init(_ status: Int, _ error: String, _ message: String? = nil) {
      self.status = status
      self.error = error
      self.message = (message?.isEmpty == false ? message : nil) ?? error
    }

    public var errorDescription: String? { message }
  }

  /// A record as listRecords and getRecord give it.
  public struct Row: Codable, Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var value: JSONValue
  }

  /// What a write answers: `{ uri, cid, created }`.
  public struct WriteResult: Codable, Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var created: Bool
  }

  static func touch(_ world: inout AccountWorld) {
    world.revision += 1
  }

  static func uriOf(_ world: AccountWorld, _ collection: String, _ rkey: String) -> String {
    "at://\(world.me.did)/\(collection)/\(rkey)"
  }

  static func rkeyOfUri(_ uri: String) -> String { uri.jsSplit("/").last ?? "" }

  /// The posts array keeps newest first, by record key, as the fixtures do.
  static func insertPost(_ world: inout AccountWorld, _ entry: WorldPost) {
    if let i = world.posts.firstIndex(where: { $0.rkey.jsLess(entry.rkey) }) {
      world.posts.insert(entry, at: i)
    } else {
      world.posts.append(entry)
    }
  }

  static func notIterable() -> HarnessJSError {
    .typeError("world[ARRAYS[collection]] is not iterable")
  }

  /// Every record in one collection, newest first (listRecords' default
  /// order).
  public static func listCollection(_ world: AccountWorld, _ collection: String) throws -> [Row] {
    var byKey = JSOrderedMap<Row>()
    func add(_ rkey: String, _ value: JSONValue, _ cid: String? = nil) {
      byKey[rkey] = Row(uri: uriOf(world, collection, rkey), cid: cid ?? "bafyharness", value: value)
    }
    if collection.jsEquals(post) {
      for p in world.posts { add(p.rkey, World.postRecord(p), p.cid) }
    } else if let path = arrayName(collection) {
      for r in world[keyPath: path] { add(rkeyOfUri(r.uri), r.value, r.cid) }
    } else if isPrototypeKey(collection) {
      throw notIterable()
    } else if collection.jsEquals("app.bsky.actor.profile") {
      add("self", ["$type": "app.bsky.actor.profile", "displayName": .string(world.profile.displayName)])
    }
    for r in world.others where r.collection.jsEquals(collection) { add(r.rkey, r.value) }
    let prefix = "\(collection)/"
    for (key, r) in world.written.entries where key.jsHasPrefix(prefix) {
      add(key.jsSlice(prefix.jsLength), r.value, r.cid)
    }
    for key in world.removed.elements where key.jsHasPrefix(prefix) {
      byKey.delete(key.jsSlice(prefix.jsLength))
    }
    return byKey.entries
      .jsSorted { a, b in a.key.jsLess(b.key) ? 1 : b.key.jsLess(a.key) ? -1 : 0 }
      .map(\.value)
  }

  /// One record, or nil.
  public static func readRecord(_ world: AccountWorld, _ collection: String, _ rkey: String) throws -> Row? {
    if collection.jsEquals(post) {
      guard let p = world.posts.first(where: { $0.rkey.jsEquals(rkey) }) else { return nil }
      let cid = p.cid.flatMap { $0.isEmpty ? nil : $0 } ?? "bafyharness"
      return Row(uri: uriOf(world, collection, rkey), cid: cid, value: World.postRecord(p))
    }
    let key = keyOf(collection, rkey)
    if world.removed.has(key) { return nil }
    if let written = world.written[key] {
      return Row(uri: uriOf(world, collection, rkey), cid: written.cid, value: written.value)
    }
    return try listCollection(world, collection).first { rkeyOfUri($0.uri).jsEquals(rkey) }
  }

  /// Write a record, as createRecord (`createOnly`) or putRecord would. A
  /// create over an existing key is refused the way a PDS refuses it.
  ///
  /// - Parameters:
  ///   - record: the record as the request carried it (an object; an array
  ///     is spread into one, as the web spreads it).
  ///   - now: when it's written, in epoch milliseconds (the web's clock).
  @discardableResult
  public static func writeRecord(
    _ world: inout AccountWorld,
    collection: String?,
    rkey: String?,
    record: JSONValue?,
    createOnly: Bool = false,
    now: Double
  ) throws -> WriteResult {
    guard let collection, !collection.isEmpty, let rkey, !rkey.isEmpty else {
      throw XrpcError(400, "InvalidRequest", "A record needs a collection and a key")
    }
    guard let record, record.isTruthy, record.objectValue != nil || record.arrayValue != nil else {
      throw XrpcError(400, "InvalidRequest", "A record is required")
    }
    let value: JSONValue
    if record["$type"]?.isTruthy == true {
      value = record
    } else {
      var spread: [String: JSONValue] = ["$type": .string(collection)]
      for (key, member) in record.jsSpread { spread[key] = member }
      value = .object(spread)
    }
    let existing = try readRecord(world, collection, rkey)
    if existing != nil && createOnly {
      throw XrpcError(400, "InvalidRequest", "Record already exists at \(keyOf(collection, rkey))")
    }
    let cid = try RecordCid.computeRecordCid(value)
    let uri = uriOf(world, collection, rkey)
    let key = keyOf(collection, rkey)
    world.removed.delete(key)

    if collection.jsEquals(post) {
      let stamp = World.iso(now)
      let at = value["createdAt"]?.stringValue ?? stamp
      let text = value["text"]?.stringValue ?? ""
      if let i = world.posts.firstIndex(where: { $0.rkey.jsEquals(rkey) }) {
        var p = world.posts[i]
        p.at = at
        p.text = text
        p.record = value
        p.cid = cid
        p.indexedAt = p.indexedAt.flatMap { $0.isEmpty ? nil : $0 } ?? stamp
        p.writtenAt = now
        p.likes = 0
        p.reposts = 0
        p.replies = 0
        p.quotes = 0
        world.posts[i] = p
      } else {
        insertPost(
          &world,
          WorldPost(
            fixture: nil, rkey: rkey, at: at, text: text, record: value, cid: cid, indexedAt: stamp, writtenAt: now))
      }
      world.profile.postsCount = world.posts.count
    } else if let path = arrayName(collection) {
      let row = WorldRecordRow(uri: uri, cid: cid, value: value)
      if let i = world[keyPath: path].firstIndex(where: { rkeyOfUri($0.uri).jsEquals(rkey) }) {
        world[keyPath: path][i] = row
      } else {
        world[keyPath: path].insert(row, at: 0)
      }
    } else {
      world.written[key] = WorldWritten(value: value, cid: cid)
    }
    touch(&world)
    return WriteResult(uri: uri, cid: cid, created: existing == nil)
  }

  /// Delete a record. True when there was one. Deleting nothing isn't an
  /// error, as on a PDS.
  @discardableResult
  public static func removeRecord(_ world: inout AccountWorld, _ collection: String, _ rkey: String) throws -> Bool {
    let key = keyOf(collection, rkey)
    var found = false
    if collection.jsEquals(post) {
      if let i = world.posts.firstIndex(where: { $0.rkey.jsEquals(rkey) }) {
        world.posts.remove(at: i)
        world.profile.postsCount = world.posts.count
        found = true
      }
    } else if let path = arrayName(collection) {
      let before = world[keyPath: path].count
      world[keyPath: path].removeAll { rkeyOfUri($0.uri).jsEquals(rkey) }
      found = world[keyPath: path].count != before
    } else if isPrototypeKey(collection) {
      throw HarnessJSError.typeError("Cannot read properties of undefined (reading 'length')")
    } else {
      found = try readRecord(world, collection, rkey) != nil
      world.written.delete(key)
      if world.others.contains(where: { $0.collection.jsEquals(collection) && $0.rkey.jsEquals(rkey) }) {
        world.removed.add(key)
      }
    }
    if found { touch(&world) }
    return found
  }

  /// Keep uploaded bytes as one of the account's blobs, with the CID a PDS
  /// would give them. Answers the blob ref uploadBlob gives back.
  @discardableResult
  public static func storeBlob(_ world: inout AccountWorld, _ bytes: [UInt8], mimeType: String?) -> JSONValue {
    let cid = CID.create(codec: CID.codecRaw, data: bytes).string
    world.blobs[cid] = WorldBlob(bytes: bytes, mimeType: mimeType, size: bytes.count)
    var ref: [String: JSONValue] = [
      "$type": "blob", "ref": ["$link": .string(cid)], "size": .number(Double(bytes.count)),
    ]
    if let mimeType { ref["mimeType"] = .string(mimeType) }
    return .object(ref)
  }

  /// An uploaded blob's bytes, or nil.
  public static func readBlob(_ world: AccountWorld, _ cid: String) -> WorldBlob? {
    world.blobs[cid]
  }

  /// A blob as a `data:` URL, for post views (the web shows them with
  /// <img>, which no fetch fake can answer).
  public static func blobDataUrl(_ world: AccountWorld, _ cid: String, maxBytes: Int = 2_000_000) -> String? {
    guard let blob = readBlob(world, cid), blob.size <= maxBytes else { return nil }
    return "data:\(blob.mimeType ?? "undefined");base64,\(Data(blob.bytes).base64EncodedString())"
  }
}
