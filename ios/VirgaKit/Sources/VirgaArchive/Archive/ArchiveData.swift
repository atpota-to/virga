// Ports src/archive/useAnalyticsArchive.js
//
// What the archive hook holds (its `data` state, EMPTY until the store is
// read): every store's rows, the sync marks kept in the meta store, and
// whether the archive will survive a reload. ArchiveModel publishes one of
// these; the export and the report models read it.

import Foundation
import VirgaCore
import VirgaRepo

/// One record of the meta store (`{ key, ...facts }`), kept as the JSON the
/// sync wrote, with typed views of the facts the sync and the pages read.
/// Spreading one into the next (`{ ...postsMeta, syncedAt }`) is
/// `updating(_:)`.
public struct ArchiveMetaRecord: Hashable, Sendable, Codable {
  public var members: [String: JSONValue]

  public init(_ members: [String: JSONValue] = [:]) {
    self.members = members
  }

  /// A stored record, or nil for anything that isn't an object.
  public init?(json: JSONValue?) {
    guard let members = json?.objectValue else { return nil }
    self.members = members
  }

  public var json: JSONValue { .object(members) }

  public subscript(_ key: String) -> JSONValue? {
    get { members[key] }
    set { members[key] = newValue }
  }

  /// `{ ...this, ...facts }`.
  public func updating(_ facts: [String: JSONValue]) -> ArchiveMetaRecord {
    var next = self
    for (key, value) in facts { next.members[key] = value }
    return next
  }

  func double(_ key: String) -> Double? {
    if case .number(let n)? = members[key] { return n }
    return nil
  }

  func int(_ key: String) -> Int? {
    guard let n = double(key), n.isFinite else { return nil }
    return Int(exactly: n.rounded(.towardZero))
  }

  /// When the sync that wrote this started (ms).
  public var syncedAt: Double? { double("syncedAt") }
  /// Whether the sweep read the whole set (posts: whether the build finished).
  public var complete: Bool? { members["complete"]?.boolValue }
  /// posts: the cursor an unfinished build resumes from.
  public var cursor: String? { members["cursor"]?.stringValue }
  /// posts: the row shape the archive's rows are in.
  public var shape: Int? { int("shape") }
  /// followers, following, blocks: how many.
  public var count: Int? { int("count") }
  /// followers: the profile's own counter at that sync.
  public var profileCount: Int? { int("profileCount") }
  /// blocks: how many block paths (a person can be on several).
  public var pathCount: Int? { int("pathCount") }
  /// blocks: 2 once moderation-list reach is counted.
  public var version: Int? { int("version") }
  /// repo: the revision the next diff starts from.
  public var rev: String? { members["rev"]?.stringValue }
  /// repo: the size of the last full pull, the next one's yardstick.
  public var bytes: Int? { int("bytes") }
  /// inbound, outbound: how far back the archive's events reach (ms).
  public var coverageMs: Double? { double("coverageMs") }
  /// inbound, outbound: whether a sweep stopped at its page cap.
  public var truncated: Bool? { members["truncated"]?.boolValue }
  /// lists: every list the account is on.
  public var lists: [ListInfo]? { members["lists"]?.arrayValue?.compactMap(ListInfo.init(json:)) }
}

/// The meta store's records, as the hook reads them (`data.meta`).
public struct ArchiveMeta: Hashable, Sendable {
  public var posts: ArchiveMetaRecord?
  public var followers: ArchiveMetaRecord?
  public var following: ArchiveMetaRecord?
  public var blocks: ArchiveMetaRecord?
  public var inbound: ArchiveMetaRecord?
  public var outbound: ArchiveMetaRecord?
  public var repo: ArchiveMetaRecord?
  public var followerLog: FollowerLogRecord?
  public var lists: ArchiveMetaRecord?
  /// Whether the store has been read (EMPTY's `meta` is `{}`).
  public var read: Bool

  public init(
    posts: ArchiveMetaRecord? = nil, followers: ArchiveMetaRecord? = nil, following: ArchiveMetaRecord? = nil,
    blocks: ArchiveMetaRecord? = nil, inbound: ArchiveMetaRecord? = nil, outbound: ArchiveMetaRecord? = nil,
    repo: ArchiveMetaRecord? = nil, followerLog: FollowerLogRecord? = nil, lists: ArchiveMetaRecord? = nil,
    read: Bool = false
  ) {
    self.posts = posts
    self.followers = followers
    self.following = following
    self.blocks = blocks
    self.inbound = inbound
    self.outbound = outbound
    self.repo = repo
    self.followerLog = followerLog
    self.lists = lists
    self.read = read
  }

  /// The nine keys in the order the hook reads them.
  public static let keys = ["posts", "followers", "following", "blocks", "inbound", "outbound", "repo", "followerLog", "lists"]

  /// The JSON the hook's state holds: every key, null where nothing is
  /// stored, once read; `{}` before.
  public var json: JSONValue {
    guard read else { return .object([:]) }
    return .object([
      "posts": posts?.json ?? .null,
      "followers": followers?.json ?? .null,
      "following": following?.json ?? .null,
      "blocks": blocks?.json ?? .null,
      "inbound": inbound?.json ?? .null,
      "outbound": outbound?.json ?? .null,
      "repo": repo?.json ?? .null,
      "followerLog": followerLog?.json ?? .null,
      "lists": lists?.json ?? .null,
    ])
  }

  /// Meta read from JSON (an export's `meta`, or the state's).
  public init(json: JSONValue?) {
    let members = json?.objectValue ?? [:]
    self.init(
      posts: ArchiveMetaRecord(json: members["posts"]), followers: ArchiveMetaRecord(json: members["followers"]),
      following: ArchiveMetaRecord(json: members["following"]), blocks: ArchiveMetaRecord(json: members["blocks"]),
      inbound: ArchiveMetaRecord(json: members["inbound"]), outbound: ArchiveMetaRecord(json: members["outbound"]),
      repo: ArchiveMetaRecord(json: members["repo"]), followerLog: members["followerLog"].flatMap(FollowerLogRecord.init(json:)),
      lists: ArchiveMetaRecord(json: members["lists"]), read: !members.isEmpty)
  }
}

/// The archive as the hook holds it: EMPTY until the store has been read.
public struct ArchiveData: Hashable, Sendable {
  public var loaded: Bool
  /// Whether rows will survive a restart (false: served from memory).
  public var persistent: Bool
  /// Session-only because another holder has the database at an older
  /// version (never on iOS, where nothing else opens it).
  public var blocked: Bool
  public var posts: [PostRow]
  public var followers: [FollowerRow]
  public var following: [FollowingRow]
  public var blocks: [BlockRow]
  public var inbound: [EngagementEvent]
  public var outbound: [EngagementEvent]
  public var atmosphere: [AtmosphereRow]
  public var meta: ArchiveMeta
  /// Moves on every read of the store (and on every applied post change),
  /// so a page knows its data changed.
  public var rev: Int
  /// Moves when a follow is written or removed.
  public var followRev: Int

  public init(
    loaded: Bool = false, persistent: Bool = true, blocked: Bool = false, posts: [PostRow] = [],
    followers: [FollowerRow] = [], following: [FollowingRow] = [], blocks: [BlockRow] = [],
    inbound: [EngagementEvent] = [], outbound: [EngagementEvent] = [], atmosphere: [AtmosphereRow] = [],
    meta: ArchiveMeta = ArchiveMeta(), rev: Int = 0, followRev: Int = 0
  ) {
    self.loaded = loaded
    self.persistent = persistent
    self.blocked = blocked
    self.posts = posts
    self.followers = followers
    self.following = following
    self.blocks = blocks
    self.inbound = inbound
    self.outbound = outbound
    self.atmosphere = atmosphere
    self.meta = meta
    self.rev = rev
    self.followRev = followRev
  }

  /// The hook's EMPTY.
  public static let empty = ArchiveData()
}
