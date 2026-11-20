// Ports harness/world.js: the shapes of a world and of what is in it.
//
// Field names are the harness's, and each type encodes to the JSON the
// harness's object would give (`JSON.stringify`, or the parity generators'
// `toJSON`), keys the web leaves out left out and its nulls written as null,
// so a world can be compared with the web's part by part.

import Foundation
import VirgaCore

/// One of the accounts a world is built for: ME (Mira Okafor) or LAB (Field
/// Lab), or any other made-up account, which gets a quiet world.
public struct WorldAccount: Codable, Hashable, Sendable {
  public var did: String
  public var handle: String
  public var displayName: String
  public var avatar: String?

  public init(did: String, handle: String, displayName: String, avatar: String? = nil) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
  }
}

/// Someone around the accounts: one of the cast, a follow outside it, or a
/// notification's author. Empty strings stand for no name or no picture.
public struct WorldPerson: Codable, Hashable, Sendable {
  public var did: String
  public var handle: String
  public var displayName: String
  public var avatar: String

  public init(did: String, handle: String, displayName: String, avatar: String) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
  }
}

/// The account's profile as getProfile gives it.
public struct WorldProfile: Codable, Hashable, Sendable {
  public var did: String
  public var handle: String
  public var displayName: String
  public var avatar: String?
  public var followersCount: Int
  public var followsCount: Int
  public var postsCount: Int
  public var createdAt: String
}

/// A self-reply's place in its thread: the record keys of the opener and of
/// the post it answers.
public struct WorldThread: Codable, Hashable, Sendable {
  public var root: String
  public var parent: String
}

/// One of the account's posts: the fixture's facts about it (what it is made
/// of, its counts), or, once written through the harness's repo, the record
/// itself with its CID and when it was written.
///
/// Which keys the web object has depends on where it came from, and the
/// encoding follows: Mira's posts carry every fixture key (nulls for no
/// reply, no quote, no link, no thread), Field Lab's only some, and a post
/// written in the harness only the written ones. `fixture` says which.
public struct WorldPost: Hashable, Sendable {
  public enum Fixture: String, Hashable, Sendable {
    /// Mira's posts (buildWorld's main loop): every fixture key.
    case busy
    /// Field Lab's (buildQuietWorld): rkey, at, text, replyTo, quoteOf, media and the counts.
    case quiet
  }

  public var fixture: Fixture?
  public var rkey: String
  public var at: String
  public var text: String
  /// The DID the post replies to (the account's own for a self-reply).
  public var replyTo: String?
  /// The DID of the author whose post this quotes.
  public var quoteOf: String?
  public var media: Bool
  public var video: Bool
  public var images: Int
  /// How many images have alt text; nil (the web's undefined) reads as 1.
  public var described: Int?
  public var link: String?
  public var gif: Bool
  public var tags: [String]
  public var thread: WorldThread?
  /// nil (the web's undefined) reads as ['en'].
  public var langs: [String]?
  public var likes: Int
  public var reposts: Int
  public var replies: Int
  public var quotes: Int
  /// The record as written through the harness's repo.
  public var record: JSONValue?
  public var cid: String?
  public var indexedAt: String?
  /// When it was written, in epoch milliseconds.
  public var writtenAt: Double?

  public init(
    fixture: Fixture?, rkey: String, at: String, text: String, replyTo: String? = nil,
    quoteOf: String? = nil, media: Bool = false, video: Bool = false, images: Int = 0,
    described: Int? = nil, link: String? = nil, gif: Bool = false, tags: [String] = [],
    thread: WorldThread? = nil, langs: [String]? = nil, likes: Int = 0, reposts: Int = 0,
    replies: Int = 0, quotes: Int = 0, record: JSONValue? = nil, cid: String? = nil,
    indexedAt: String? = nil, writtenAt: Double? = nil
  ) {
    self.fixture = fixture
    self.rkey = rkey
    self.at = at
    self.text = text
    self.replyTo = replyTo
    self.quoteOf = quoteOf
    self.media = media
    self.video = video
    self.images = images
    self.described = described
    self.link = link
    self.gif = gif
    self.tags = tags
    self.thread = thread
    self.langs = langs
    self.likes = likes
    self.reposts = reposts
    self.replies = replies
    self.quotes = quotes
    self.record = record
    self.cid = cid
    self.indexedAt = indexedAt
    self.writtenAt = writtenAt
  }
}

extension WorldPost: Codable {
  enum CodingKeys: String, CodingKey {
    case rkey, at, text, replyTo, quoteOf, media, video, images, described, link, gif, tags, thread, langs
    case likes, reposts, replies, quotes, record, cid, indexedAt, writtenAt
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    fixture = c.contains(.video) ? .busy : c.contains(.replyTo) ? .quiet : nil
    rkey = try c.decode(String.self, forKey: .rkey)
    at = try c.decode(String.self, forKey: .at)
    text = try c.decode(String.self, forKey: .text)
    replyTo = try c.decodeIfPresent(String.self, forKey: .replyTo)
    quoteOf = try c.decodeIfPresent(String.self, forKey: .quoteOf)
    media = try c.decodeIfPresent(Bool.self, forKey: .media) ?? false
    video = try c.decodeIfPresent(Bool.self, forKey: .video) ?? false
    images = try c.decodeIfPresent(Int.self, forKey: .images) ?? 0
    described = try c.decodeIfPresent(Int.self, forKey: .described)
    link = try c.decodeIfPresent(String.self, forKey: .link)
    gif = try c.decodeIfPresent(Bool.self, forKey: .gif) ?? false
    tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
    thread = try c.decodeIfPresent(WorldThread.self, forKey: .thread)
    langs = try c.decodeIfPresent([String].self, forKey: .langs)
    likes = try c.decodeIfPresent(Int.self, forKey: .likes) ?? 0
    reposts = try c.decodeIfPresent(Int.self, forKey: .reposts) ?? 0
    replies = try c.decodeIfPresent(Int.self, forKey: .replies) ?? 0
    quotes = try c.decodeIfPresent(Int.self, forKey: .quotes) ?? 0
    record = try c.decodeIfPresent(JSONValue.self, forKey: .record)
    cid = try c.decodeIfPresent(String.self, forKey: .cid)
    indexedAt = try c.decodeIfPresent(String.self, forKey: .indexedAt)
    writtenAt = try c.decodeIfPresent(Double.self, forKey: .writtenAt)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(rkey, forKey: .rkey)
    try c.encode(at, forKey: .at)
    try c.encode(text, forKey: .text)
    if fixture != nil {
      try c.encode(replyTo, forKey: .replyTo)  // null when there is none
      try c.encode(quoteOf, forKey: .quoteOf)
      try c.encode(media, forKey: .media)
    }
    if fixture == .busy {
      try c.encode(video, forKey: .video)
      try c.encode(images, forKey: .images)
      try c.encodeIfPresent(described, forKey: .described)
      try c.encode(link, forKey: .link)
      try c.encode(gif, forKey: .gif)
      try c.encode(tags, forKey: .tags)
      try c.encode(thread, forKey: .thread)
      try c.encodeIfPresent(langs, forKey: .langs)
    }
    try c.encode(likes, forKey: .likes)
    try c.encode(reposts, forKey: .reposts)
    try c.encode(replies, forKey: .replies)
    try c.encode(quotes, forKey: .quotes)
    try c.encodeIfPresent(record, forKey: .record)
    try c.encodeIfPresent(cid, forKey: .cid)
    try c.encodeIfPresent(indexedAt, forKey: .indexedAt)
    try c.encodeIfPresent(writtenAt, forKey: .writtenAt)
  }
}

/// One of the account's followers, as getFollowers pages them, with the
/// follow record pointing at the account.
public struct WorldFollower: Codable, Hashable, Sendable {
  public struct Viewer: Codable, Hashable, Sendable {
    public var followedBy: String
  }

  public var did: String
  public var handle: String
  public var displayName: String
  public var avatar: String
  public var viewer: Viewer
}

/// A record in one of the account's own collections (follows, likes,
/// reposts): `{ uri, value }` as the fixtures have it, `{ uri, cid, value }`
/// once written through the harness's repo.
public struct WorldRecordRow: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String?
  public var value: JSONValue

  public init(uri: String, cid: String? = nil, value: JSONValue) {
    self.uri = uri
    self.cid = cid
    self.value = value
  }
}

/// A notification as listNotifications gives it (the harness's shape: no cid,
/// no isRead).
public struct WorldNotification: Codable, Hashable, Sendable {
  public struct Record: Codable, Hashable, Sendable {
    public var createdAt: String
  }

  public var uri: String
  public var reason: String
  public var reasonSubject: String?
  public var author: WorldPerson
  public var record: Record
  public var indexedAt: String
}

/// A record in someone else's repo pointing at the account: a block, a list
/// item, a list block (`{ did, collection, rkey }`, as Constellation lists
/// backlinks).
public struct WorldBacklink: Codable, Hashable, Sendable {
  public var did: String
  public var collection: String
  public var rkey: String
}

/// A list someone else made that holds the account, with its subscribers
/// for a moderation list.
public struct WorldList: Codable, Hashable, Sendable {
  public var name: String
  public var uri: String
  public var purpose: String
  public var item: WorldBacklink
  public var subscribers: [WorldBacklink]
}

/// A record of another app in the account's repo.
public struct WorldOtherRecord: Codable, Hashable, Sendable {
  public var collection: String
  public var rkey: String
  public var value: JSONValue
}

/// A feed the account made.
public struct WorldFeed: Codable, Hashable, Sendable {
  public var name: String
  public var description: String
  public var likeCount: Int
  public var uri: String
  public var createdAt: String
}

/// A list the account made, with its members' DIDs.
public struct WorldOwnList: Codable, Hashable, Sendable {
  public var name: String
  public var description: String
  public var purpose: String
  public var uri: String
  public var members: [String]
  public var createdAt: String
}

/// A Bluesky draft as getDrafts gives it back (`draft` is the
/// app.bsky.draft.defs#draft object).
public struct WorldDraft: Codable, Hashable, Sendable {
  public var id: String
  public var draft: JSONValue
  public var createdAt: String
  public var updatedAt: String

  public init(id: String, draft: JSONValue, createdAt: String, updatedAt: String) {
    self.id = id
    self.draft = draft
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

/// A post saved for later.
public struct WorldBookmark: Codable, Hashable, Sendable {
  public var uri: String
  public var createdAt: String

  public init(uri: String, createdAt: String) {
    self.uri = uri
    self.createdAt = createdAt
  }
}

/// A record written through the harness's repo in a collection the world
/// has no array for, with its CID.
public struct WorldWritten: Codable, Hashable, Sendable {
  public var value: JSONValue
  public var cid: String

  public init(value: JSONValue, cid: String) {
    self.value = value
    self.cid = cid
  }
}

/// Uploaded bytes, kept as one of the account's blobs.
public struct WorldBlob: Codable, Hashable, Sendable {
  public var bytes: [UInt8]
  public var mimeType: String
  public var size: Int

  public init(bytes: [UInt8], mimeType: String, size: Int) {
    self.bytes = bytes
    self.mimeType = mimeType
    self.size = size
  }
}

/// One account's world (harness/world.js's `buildWorld`): its profile, posts
/// with their counts, followers, follows, notifications, likes and reposts,
/// the rest of its repo, the blocks and lists pointing at it, and what it has
/// on the posting side; then what the harness changes as the app is used
/// (`written`, `removed`, `blobs`, `revision`, through HarnessRepo).
///
/// Arrays are in the order the web pages them: posts, followers,
/// notifications, likes and reposts newest first.
public struct AccountWorld: Codable, Hashable, Sendable {
  public var me: WorldAccount
  /// The moment the world is dated back from, in epoch milliseconds.
  public var now: Double
  /// When the account's history starts.
  public var start: Double
  public var profile: WorldProfile
  public var cast: [WorldPerson]
  /// The follows outside the cast (none for Field Lab).
  public var followedOnly: [WorldPerson]
  public var posts: [WorldPost]
  public var followers: [WorldFollower]
  public var follows: [WorldRecordRow]
  public var notifications: [WorldNotification]
  public var likes: [WorldRecordRow]
  public var reposts: [WorldRecordRow]
  public var blockers: [WorldBacklink]
  public var lists: [WorldList]
  public var others: [WorldOtherRecord]
  public var feeds: [WorldFeed]
  public var ownLists: [WorldOwnList]
  /// app.bsky.actor.getPreferences' `preferences`.
  public var preferences: [JSONValue]
  public var drafts: [WorldDraft]
  public var bookmarks: [WorldBookmark]
  /// Records written in collections without an array of their own, by
  /// `collection/rkey`, in the order written (the templates are there from
  /// the start).
  public var written: JSOrderedMap<WorldWritten>
  /// Keys of fixture records deleted through the repo.
  public var removed: JSOrderedSet
  /// Uploaded blobs by CID.
  public var blobs: JSOrderedMap<WorldBlob>
  /// Bumped on every write, so a cached CAR knows it is stale.
  public var revision: Int
  /// What Virga's server reports the session was granted, and the account's
  /// PDS: harness/harness.js sets these on each world it makes.
  public var scope: String?
  public var pdsUrl: String?
}

/// When an account outside the main account last posted (World.activityOf):
/// days ago, or gone (deleted or deactivated), or never. Encodes as the web's
/// number or string.
public enum WorldActivity: Hashable, Sendable, Codable {
  case daysAgo(Int)
  case gone
  case never

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let days = try? c.decode(Int.self) {
      self = .daysAgo(days)
    } else {
      let word = try c.decode(String.self)
      switch word {
      case "gone": self = .gone
      case "never": self = .never
      default:
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not an activity: \(word)")
      }
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .daysAgo(let days): try c.encode(days)
    case .gone: try c.encode("gone")
    case .never: try c.encode("never")
    }
  }
}

/// harness/world.js's `mulberry`: a seeded generator of numbers in [0, 1),
/// bit for bit the web's. Call it (`rand()`) for the next one.
public struct Mulberry: Sendable, Hashable {
  private var a: Int32

  /// `mulberry(seed)`: the seed as `seed | 0` reads it.
  public init(seed: Double) {
    a = JSMath.toInt32(seed)
  }

  public mutating func next() -> Double {
    a = a &+ 0x6d2b_79f5
    let u = UInt32(bitPattern: a)
    var t = (u ^ (u >> 15)) &* (1 | u)
    t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
    return Double(t ^ (t >> 14)) / 4_294_967_296
  }

  public mutating func callAsFunction() -> Double { next() }
}
