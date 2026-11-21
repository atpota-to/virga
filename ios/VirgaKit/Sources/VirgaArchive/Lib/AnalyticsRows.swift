// Ports src/lib/analytics.js
// Ports src/lib/analyticsSync.js
//
// The archive's row shapes: what analytics.js's shapers and analyticsSync.js's
// sweeps produce and analyticsStore.js keeps, with the web's field names, so
// a row written here reads in the web app and the other way round. Each row
// converts to and from JSON by hand (`init?(json:)`, `json`), which is what
// the store keeps; Codable goes through the same two.
//
// Reading is lenient, as the web reads a stored object: a field of the
// wrong type reads as absent, and a count that isn't a number as 0. Fields
// the web always writes (null included) are always written; fields it
// writes only sometimes (an inbound event's `subject`, a list block's
// `listUri`) only when present. Members this port doesn't know are kept in
// `extra` and written back.

import Foundation
import VirgaCore
import VirgaRepo

/// A row the archive stores: JSON in, JSON out.
public protocol ArchiveRecord: Codable, Hashable, Sendable {
  init?(json: JSONValue)
  var json: JSONValue { get }
}

/// Something with a time the analytics read (`item.at`): a number of
/// milliseconds or a string `Date.parse` reads.
public protocol ArchiveTimed {
  var atValue: JSONValue? { get }
}

extension JSONValue: ArchiveTimed {
  /// `item?.at`.
  public var atValue: JSONValue? { self["at"] }
}

/// Reading a stored object's members as JavaScript would find them.
struct JSONFields {
  let members: [String: JSONValue]

  init(_ json: JSONValue) {
    members = json.objectValue ?? [:]
  }

  subscript(_ key: String) -> JSONValue? { members[key] }

  func string(_ key: String) -> String? { members[key]?.stringValue }
  func bool(_ key: String) -> Bool? { members[key]?.boolValue }
  func double(_ key: String) -> Double? {
    if case .number(let n) = members[key] { return n }
    return nil
  }
  /// A count: a number (truncated to a whole one), else 0, as `x || 0` reads a number.
  func count(_ key: String) -> Int {
    guard case .number(let n) = members[key], n.isFinite else { return 0 }
    return Int(exactly: n.rounded(.towardZero)) ?? 0
  }
  func int(_ key: String) -> Int? {
    guard case .number(let n) = members[key], n.isFinite else { return nil }
    return Int(exactly: n.rounded(.towardZero))
  }
  func strings(_ key: String) -> [String]? {
    guard case .array(let items) = members[key] else { return nil }
    return items.compactMap(\.stringValue)
  }
  /// The members not named in `known`.
  func extra(_ known: Set<String>) -> [String: JSONValue] {
    members.filter { !known.contains($0.key) }
  }
}

/// Building a row's JSON: `put` writes a value (nil as null), `putIfPresent`
/// only a present one.
struct JSONBuilder {
  var members: [String: JSONValue]

  init(_ extra: [String: JSONValue] = [:]) {
    members = extra
  }

  mutating func put(_ key: String, _ value: String?) { members[key] = value.map(JSONValue.string) ?? .null }
  mutating func put(_ key: String, _ value: Int?) { members[key] = value.map { .number(Double($0)) } ?? .null }
  mutating func put(_ key: String, _ value: Double?) { members[key] = value.map(JSONValue.number) ?? .null }
  mutating func put(_ key: String, _ value: Bool?) { members[key] = value.map(JSONValue.bool) ?? .null }
  mutating func put(_ key: String, _ value: [String]?) {
    members[key] = value.map { .array($0.map(JSONValue.string)) } ?? .null
  }
  mutating func put(_ key: String, _ value: JSONValue?) { members[key] = value ?? .null }
  mutating func putIfPresent(_ key: String, _ value: String?) { if let value { members[key] = .string(value) } }
  mutating func putIfPresent(_ key: String, _ value: Int?) { if let value { members[key] = .number(Double(value)) } }
  mutating func putIfPresent(_ key: String, _ value: Double?) { if let value { members[key] = .number(value) } }
  mutating func putIfPresent(_ key: String, _ value: Bool?) { if let value { members[key] = .bool(value) } }
  mutating func putIfPresent(_ key: String, _ value: [String]?) {
    if let value { members[key] = .array(value.map(JSONValue.string)) }
  }
  mutating func putIfPresent(_ key: String, _ value: JSONValue?) { if let value { members[key] = value } }

  var json: JSONValue { .object(members) }
}

/// Codable through `json`.
struct ArchiveRecordDecodingError: Error, CustomStringConvertible {
  let type: String
  var description: String { "not a \(type) row" }
}

extension ArchiveRecord {
  static func decodeRecord(from decoder: any Decoder) throws -> Self {
    let value = try JSONValue(from: decoder)
    guard let row = Self(json: value) else { throw ArchiveRecordDecodingError(type: String(describing: Self.self)) }
    return row
  }
}

// MARK: - Posts

/// One of the account's own posts as the archive keeps it
/// (`compactPostFromFeedItem`, `compactPostFromRecord`): when, its words and
/// what it is made of, whom it answered or quoted, and its four counts.
/// Rows of shape 1 (`meta.posts.shape` below 2) have only uri, rkey, at, a
/// 200-character text, replyTo, quoteOf, hasMedia and the counts.
public struct PostRow: ArchiveRecord, ArchiveTimed {
  public var uri: String
  public var rkey: String?
  /// When it was made: the record's createdAt, as the record has it.
  public var at: String?
  public var text: String?
  /// The text's length in graphemes, as Bluesky counts it.
  public var len: Int?
  /// The DID a reply answers, or nil for a top-level post.
  public var replyTo: String?
  /// The DID a quote quotes.
  public var quoteOf: String?
  public var hasMedia: Bool?
  /// "image", "video", "gif" or "link", or nil.
  public var media: String?
  public var mediaCount: Int?
  public var altCount: Int?
  public var tags: [String]?
  public var links: [String]?
  public var mentions: [String]?
  public var langs: [String]?
  public var threadOf: String?
  public var threadKey: String?
  public var likes: Int
  public var reposts: Int
  public var replies: Int
  public var quotes: Int
  /// A time in milliseconds some callers attach (rateSeries reads it first).
  public var atMs: Double?
  /// Members this port doesn't model.
  public var extra: [String: JSONValue]

  public init(
    uri: String, rkey: String? = nil, at: String? = nil, text: String? = nil, len: Int? = nil,
    replyTo: String? = nil, quoteOf: String? = nil, hasMedia: Bool? = nil, media: String? = nil,
    mediaCount: Int? = nil, altCount: Int? = nil, tags: [String]? = nil, links: [String]? = nil,
    mentions: [String]? = nil, langs: [String]? = nil, threadOf: String? = nil, threadKey: String? = nil,
    likes: Int = 0, reposts: Int = 0, replies: Int = 0, quotes: Int = 0, atMs: Double? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.uri = uri
    self.rkey = rkey
    self.at = at
    self.text = text
    self.len = len
    self.replyTo = replyTo
    self.quoteOf = quoteOf
    self.hasMedia = hasMedia
    self.media = media
    self.mediaCount = mediaCount
    self.altCount = altCount
    self.tags = tags
    self.links = links
    self.mentions = mentions
    self.langs = langs
    self.threadOf = threadOf
    self.threadKey = threadKey
    self.likes = likes
    self.reposts = reposts
    self.replies = replies
    self.quotes = quotes
    self.atMs = atMs
    self.extra = extra
  }

  static let known: Set<String> = [
    "uri", "rkey", "at", "text", "len", "replyTo", "quoteOf", "hasMedia", "media", "mediaCount", "altCount",
    "tags", "links", "mentions", "langs", "threadOf", "threadKey", "likes", "reposts", "replies", "quotes", "atMs",
  ]

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      uri: f.string("uri") ?? "", rkey: f.string("rkey"), at: f.string("at"), text: f.string("text"),
      len: f.int("len"), replyTo: f.string("replyTo"), quoteOf: f.string("quoteOf"), hasMedia: f.bool("hasMedia"),
      media: f.string("media"), mediaCount: f.int("mediaCount"), altCount: f.int("altCount"),
      tags: f.strings("tags"), links: f.strings("links"), mentions: f.strings("mentions"), langs: f.strings("langs"),
      threadOf: f.string("threadOf"), threadKey: f.string("threadKey"),
      likes: f.count("likes"), reposts: f.count("reposts"), replies: f.count("replies"), quotes: f.count("quotes"),
      atMs: f.double("atMs"), extra: f.extra(Self.known))
  }

  /// Whether the row has the current shape's fields (a shape-2 row always
  /// has `len`).
  var hasCurrentShape: Bool { len != nil }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.putIfPresent("uri", uri.isEmpty ? nil : uri)
    b.putIfPresent("rkey", rkey)
    b.putIfPresent("at", at)
    b.putIfPresent("text", text)
    b.put("replyTo", replyTo)
    b.put("quoteOf", quoteOf)
    b.putIfPresent("hasMedia", hasMedia)
    if hasCurrentShape {
      b.put("len", len)
      b.put("media", media)
      b.put("mediaCount", mediaCount ?? 0)
      b.put("altCount", altCount ?? 0)
      b.put("tags", tags ?? [])
      b.put("links", links ?? [])
      b.put("mentions", mentions ?? [])
      b.put("langs", langs ?? [])
      b.put("threadOf", threadOf)
      b.put("threadKey", threadKey)
    } else {
      b.putIfPresent("media", media)
      b.putIfPresent("mediaCount", mediaCount)
      b.putIfPresent("altCount", altCount)
      b.putIfPresent("tags", tags)
      b.putIfPresent("links", links)
      b.putIfPresent("mentions", mentions)
      b.putIfPresent("langs", langs)
      b.putIfPresent("threadOf", threadOf)
      b.putIfPresent("threadKey", threadKey)
    }
    b.put("likes", likes)
    b.put("reposts", reposts)
    b.put("replies", replies)
    b.put("quotes", quotes)
    b.putIfPresent("atMs", atMs)
    return b.json
  }

  public var atValue: JSONValue? { at.map(JSONValue.string) }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

// MARK: - Engagement events

/// One act of engagement (`{ uri, did, kind, at }`): inbound, where `did`
/// is who did it (`subject` is the post it was about, when the
/// notification said), or outbound, where `did` is whom it was aimed at.
public struct EngagementEvent: ArchiveRecord, ArchiveTimed {
  public var uri: String
  public var did: String
  /// "like", "repost", "reply", "quote" or "mention".
  public var kind: String
  /// When: an ISO string, as the record or notification has it (a number
  /// of milliseconds is read too, as the web's analytics read either).
  public var at: JSONValue?
  public var subject: String?
  public var extra: [String: JSONValue]

  public init(uri: String, did: String, kind: String, at: JSONValue?, subject: String? = nil, extra: [String: JSONValue] = [:]) {
    self.uri = uri
    self.did = did
    self.kind = kind
    self.at = at
    self.subject = subject
    self.extra = extra
  }

  public init(uri: String, did: String, kind: String, at: String?, subject: String? = nil) {
    self.init(uri: uri, did: did, kind: kind, at: at.map(JSONValue.string), subject: subject)
  }

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      uri: f.string("uri") ?? "", did: f.string("did") ?? "", kind: f.string("kind") ?? "", at: f["at"],
      subject: f.string("subject"), extra: f.extra(["uri", "did", "kind", "at", "subject"]))
  }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.put("uri", uri)
    b.put("did", did)
    b.put("kind", kind)
    b.putIfPresent("at", at)
    b.putIfPresent("subject", subject)
    return b.json
  }

  /// The time as text, when it is text.
  public var atText: String? { at?.stringValue }
  public var atValue: JSONValue? { at }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

// MARK: - Followers, follows, blocks

/// A current follower (`sweepFollowers`), dated by their follow record's TID.
public struct FollowerRow: ArchiveRecord {
  public var did: String
  public var handle: String
  public var displayName: String
  public var avatar: String
  /// ISO time of their follow record, or nil for a non-TID record key.
  public var followedAt: String?
  public var extra: [String: JSONValue]

  public init(did: String, handle: String = "", displayName: String = "", avatar: String = "", followedAt: String? = nil, extra: [String: JSONValue] = [:]) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
    self.followedAt = followedAt
    self.extra = extra
  }

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      did: f.string("did") ?? "", handle: f.string("handle") ?? "", displayName: f.string("displayName") ?? "",
      avatar: f.string("avatar") ?? "", followedAt: f.string("followedAt"),
      extra: f.extra(["did", "handle", "displayName", "avatar", "followedAt"]))
  }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.put("did", did)
    b.put("handle", handle)
    b.put("displayName", displayName)
    b.put("avatar", avatar)
    b.put("followedAt", followedAt)
    return b.json
  }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

/// One of the account's own follow records (`followFromRecord`), keyed by
/// the record's URI: a repo can hold two for one account.
public struct FollowingRow: ArchiveRecord {
  public var uri: String
  public var did: String
  public var followedAt: String?
  public var extra: [String: JSONValue]

  public init(uri: String, did: String, followedAt: String?, extra: [String: JSONValue] = [:]) {
    self.uri = uri
    self.did = did
    self.followedAt = followedAt
    self.extra = extra
  }

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      uri: f.string("uri") ?? "", did: f.string("did") ?? "", followedAt: f.string("followedAt"),
      extra: f.extra(["uri", "did", "followedAt"]))
  }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.put("uri", uri)
    b.put("did", did)
    b.put("followedAt", followedAt)
    return b.json
  }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

/// One block path pointing at the account (`sweepBlocks`): a direct block
/// record, or a moderation-list subscription (`source` "list", with the
/// list's URI). Rows archived before moderation lists have no source and
/// read as direct.
public struct BlockRow: ArchiveRecord {
  public var uri: String
  public var did: String
  public var source: String?
  public var listUri: String?
  public var blockedAt: String?
  public var extra: [String: JSONValue]

  public init(uri: String, did: String, source: String? = nil, listUri: String? = nil, blockedAt: String? = nil, extra: [String: JSONValue] = [:]) {
    self.uri = uri
    self.did = did
    self.source = source
    self.listUri = listUri
    self.blockedAt = blockedAt
    self.extra = extra
  }

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      uri: f.string("uri") ?? "", did: f.string("did") ?? "", source: f.string("source"), listUri: f.string("listUri"),
      blockedAt: f.string("blockedAt"), extra: f.extra(["uri", "did", "source", "listUri", "blockedAt"]))
  }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.put("uri", uri)
    b.put("did", did)
    b.putIfPresent("source", source)
    b.putIfPresent("listUri", listUri)
    if source != nil || blockedAt != nil { b.put("blockedAt", blockedAt) }
    return b.json
  }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

/// A list the account is on (`sweepBlocks`' `lists`), for Lists you're on.
public struct ListInfo: ArchiveRecord {
  public var uri: String
  public var owner: String
  public var name: String
  /// "moderation", "reference" or "curation".
  public var purpose: String
  public var memberAt: String?
  /// How many subscribe to block it, for a moderation list once walked.
  public var subscribers: Int?
  public var extra: [String: JSONValue]

  public init(uri: String, owner: String, name: String, purpose: String, memberAt: String?, subscribers: Int?, extra: [String: JSONValue] = [:]) {
    self.uri = uri
    self.owner = owner
    self.name = name
    self.purpose = purpose
    self.memberAt = memberAt
    self.subscribers = subscribers
    self.extra = extra
  }

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      uri: f.string("uri") ?? "", owner: f.string("owner") ?? "", name: f.string("name") ?? "",
      purpose: f.string("purpose") ?? "", memberAt: f.string("memberAt"), subscribers: f.int("subscribers"),
      extra: f.extra(["uri", "owner", "name", "purpose", "memberAt", "subscribers"]))
  }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.put("uri", uri)
    b.put("owner", owner)
    b.put("name", name)
    b.put("purpose", purpose)
    b.put("memberAt", memberAt)
    b.put("subscribers", subscribers)
    return b.json
  }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

/// A resolved profile card for the People lists (`hydrateActors`), with
/// what the tools learned about the account (`checkActivity`).
public struct ActorCard: ArchiveRecord {
  public var did: String
  public var handle: String?
  public var displayName: String?
  public var avatar: String?
  /// When the card was resolved (ms).
  public var at: Double?
  public var lastActiveAt: String?
  public var gone: Bool?
  /// When activity was last read (ms).
  public var activityAt: Double?
  public var extra: [String: JSONValue]

  public init(
    did: String, handle: String? = nil, displayName: String? = nil, avatar: String? = nil, at: Double? = nil,
    lastActiveAt: String? = nil, gone: Bool? = nil, activityAt: Double? = nil, extra: [String: JSONValue] = [:]
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
    self.at = at
    self.lastActiveAt = lastActiveAt
    self.gone = gone
    self.activityAt = activityAt
    self.extra = extra
  }

  static let known: Set<String> = ["did", "handle", "displayName", "avatar", "at", "lastActiveAt", "gone", "activityAt"]

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      did: f.string("did") ?? "", handle: f.string("handle"), displayName: f.string("displayName"),
      avatar: f.string("avatar"), at: f.double("at"), lastActiveAt: f.string("lastActiveAt"), gone: f.bool("gone"),
      activityAt: f.double("activityAt"), extra: f.extra(Self.known))
    // lastActiveAt is written as null when the account has never posted.
    if f["lastActiveAt"] == .null { extra["lastActiveAt"] = .null }
  }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.put("did", did)
    b.putIfPresent("handle", handle)
    b.putIfPresent("displayName", displayName)
    b.putIfPresent("avatar", avatar)
    b.putIfPresent("at", at)
    b.putIfPresent("lastActiveAt", lastActiveAt)
    b.putIfPresent("gone", gone)
    b.putIfPresent("activityAt", activityAt)
    return b.json
  }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

extension AtmosphereRow {
  /// The row as the archive stores it: `{ uri, collection, at }`.
  public var json: JSONValue {
    .object(["uri": .string(uri), "collection": .string(collection), "at": .number(at)])
  }

  /// A stored row, or nil for one without a URI, collection and time.
  public init?(json: JSONValue) {
    let f = JSONFields(json)
    guard let uri = f.string("uri"), let collection = f.string("collection"), let at = f.double("at") else { return nil }
    self.init(uri: uri, collection: collection, at: at)
  }
}
