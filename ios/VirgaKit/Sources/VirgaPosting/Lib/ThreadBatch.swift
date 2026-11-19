// Ports src/posting/lib/threadBatch.js
//
// A whole thread as ONE atomic com.atproto.repo.applyWrites batch, as
// Bluesky's app does it. Every post gets a client TID, and each reply names
// its parent's locally computed CID (VirgaRepo's RecordCid), so nothing has to
// come back from the server between posts. Client keys make the batch safe to
// retry (keyed on the first post's rkey: the batch is atomic, so if the first
// post landed, all did).

import Foundation
import VirgaCore
import VirgaRepo

/// Where a thread's first post replies into an existing thread.
public struct ThreadReplyTo: Codable, Hashable, Sendable {
  public var root: StrongRef
  public var parent: StrongRef
  public init(root: StrongRef, parent: StrongRef) {
    self.root = root
    self.parent = parent
  }
}

/// One `com.atproto.repo.applyWrites#create`.
public struct ApplyWritesCreate: Codable, Hashable, Sendable {
  public static let type = "com.atproto.repo.applyWrites#create"
  public var collection: String
  public var rkey: String
  public var value: JSONValue

  private enum CodingKeys: String, CodingKey {
    case type = "$type"
    case collection, rkey, value
  }

  public init(collection: String, rkey: String, value: JSONValue) {
    self.collection = collection
    self.rkey = rkey
    self.value = value
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    collection = try container.decode(String.self, forKey: .collection)
    rkey = try container.decode(String.self, forKey: .rkey)
    value = try container.decode(JSONValue.self, forKey: .value)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(Self.type, forKey: .type)
    try container.encode(collection, forKey: .collection)
    try container.encode(rkey, forKey: .rkey)
    try container.encode(value, forKey: .value)
  }
}

/// A post the batch creates, with the URI and CID it will have.
public struct CreatedPost: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String
  public var rkey: String
  public var record: JSONValue
}

public struct ThreadWrites: Codable, Hashable, Sendable {
  public var writes: [ApplyWritesCreate]
  public var created: [CreatedPost]
}

/// `RangeError: Invalid time value`, which `toISOString` throws.
public struct InvalidTimeValueError: Error, LocalizedError, Hashable, Sendable {
  public let message = "Invalid time value"
  public var errorDescription: String? { message }
}

public enum ThreadBatch {
  /// The writes for a thread.
  ///
  /// - Parameters:
  ///   - did: the repo the thread is written to.
  ///   - records: base records in thread order, each carrying its `$type`
  ///     (required for a correct CID) and no reply. A record's own
  ///     `createdAt` is kept if it is later than the one before it;
  ///     otherwise each gets `nowMs` plus a millisecond per post.
  ///   - replyTo: when the thread's first post replies to an existing post.
  ///   - nowMs: the time in epoch milliseconds (the web's `now`, a Date, a
  ///     number or a date string, read as `new Date(now).getTime()`).
  ///   - timeZone: the zone a zone-less `createdAt` is read in (the web reads
  ///     it in the browser's).
  ///   - mintTid: a TID for a time in milliseconds (the web's `nextTid`).
  public static func buildThreadWrites(
    did: String,
    collection: String = "app.bsky.feed.post",
    records: [JSONValue],
    replyTo: ThreadReplyTo? = nil,
    nowMs: Double,
    timeZone: TimeZone,
    mintTid: (Double) -> String = { TIDClock.shared.next(ms: $0) }
  ) throws -> ThreadWrites {
    var writes: [ApplyWritesCreate] = []
    var created: [CreatedPost] = []

    // Posts sharing a createdAt sort unpredictably, so timestamps and TIDs
    // both strictly increase. `new Date(now).getTime()`: TimeClip.
    var lastMs = abs(nowMs) > 8.64e15 || !nowMs.isFinite ? .nan : nowMs.rounded(.towardZero) + 0
    var first = true

    // When the first post replies into an existing thread, the whole batch
    // shares that thread's root; otherwise the first post becomes the root.
    var rootRef = replyTo?.root
    var parentRef = replyTo?.parent

    for base in records {
      let own = base["createdAt"].map { VirgaCore.JSDate.parse($0.jsString, timeZone: timeZone) } ?? .nan
      let hasOwn = own.isFinite && (first || own > lastMs)
      let ms = hasOwn ? own : first ? lastMs : lastMs + 1
      lastMs = ms
      first = false

      guard ms.isFinite, let createdAt = VirgaCore.JSDate.toISOString(ms) else { throw InvalidTimeValueError() }
      let rkey = mintTid(ms)
      let uri = "at://\(did)/\(collection)/\(rkey)"
      var fields = base.objectValue ?? [:]
      fields["createdAt"] = .string(createdAt)
      fields["reply"] = nil
      if let parentRef, let rootRef {
        fields["reply"] = ["root": refJSON(rootRef), "parent": refJSON(parentRef)]
      }
      let record = JSONValue.object(fields)
      let cid = try RecordCid.computeRecordCid(record)

      writes.append(ApplyWritesCreate(collection: collection, rkey: rkey, value: record))
      created.append(CreatedPost(uri: uri, cid: cid, rkey: rkey, record: record))

      let ref = StrongRef(uri: uri, cid: cid)
      if rootRef == nil { rootRef = ref }
      parentRef = ref
    }
    return ThreadWrites(writes: writes, created: created)
  }

  /// `buildThreadWrites` at a `Date`.
  public static func buildThreadWrites(
    did: String,
    collection: String = "app.bsky.feed.post",
    records: [JSONValue],
    replyTo: ThreadReplyTo? = nil,
    now: Date = Date(),
    timeZone: TimeZone,
    mintTid: (Double) -> String = { TIDClock.shared.next(ms: $0) }
  ) throws -> ThreadWrites {
    try buildThreadWrites(
      did: did, collection: collection, records: records, replyTo: replyTo,
      nowMs: (now.timeIntervalSince1970 * 1000).rounded(.down), timeZone: timeZone, mintTid: mintTid)
  }

  static func refJSON(_ ref: StrongRef) -> JSONValue {
    ["uri": .string(ref.uri), "cid": .string(ref.cid)]
  }
}
