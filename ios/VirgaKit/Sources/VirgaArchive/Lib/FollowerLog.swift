// Ports src/lib/followerLog.js
//
// Who left and who arrived between two complete follower sweeps. An
// unfollow deletes the follow record, so the only record of one is a
// comparison of the list at the last complete sync with the list now. Each
// sync with a complete list on both sides puts its differences in front of
// a log kept in the archive's meta store under 'followerLog'.

import Foundation
import VirgaCore

/// One change: `kind` "lost" or "gained", noticed by the sync at `at`
/// (ms); `since` is the sync before it, so it happened in between.
public struct FollowerLogEntry: ArchiveRecord {
  public var did: String
  public var handle: String
  public var displayName: String
  public var avatar: String
  public var followedAt: String?
  public var kind: String
  public var at: Double?
  public var since: Double?
  public var extra: [String: JSONValue]

  public init(
    did: String, handle: String, displayName: String, avatar: String, followedAt: String?, kind: String,
    at: Double?, since: Double?, extra: [String: JSONValue] = [:]
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
    self.followedAt = followedAt
    self.kind = kind
    self.at = at
    self.since = since
    self.extra = extra
  }

  static let known: Set<String> = ["did", "handle", "displayName", "avatar", "followedAt", "kind", "at", "since"]

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      did: f.string("did") ?? "", handle: f.string("handle") ?? "", displayName: f.string("displayName") ?? "",
      avatar: f.string("avatar") ?? "", followedAt: f.string("followedAt"), kind: f.string("kind") ?? "",
      at: f.double("at"), since: f.double("since"), extra: f.extra(Self.known))
  }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.put("did", did)
    b.put("handle", handle)
    b.put("displayName", displayName)
    b.put("avatar", avatar)
    b.put("followedAt", followedAt)
    b.put("kind", kind)
    b.putIfPresent("at", at)
    b.put("since", since)
    return b.json
  }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

/// The log as the meta store keeps it: `{ entries, lastSyncAt, firstSyncAt }`.
public struct FollowerLogRecord: ArchiveRecord {
  public var entries: [FollowerLogEntry]
  public var lastSyncAt: Double?
  public var firstSyncAt: Double?
  public var extra: [String: JSONValue]

  public init(entries: [FollowerLogEntry] = [], lastSyncAt: Double? = nil, firstSyncAt: Double? = nil, extra: [String: JSONValue] = [:]) {
    self.entries = entries
    self.lastSyncAt = lastSyncAt
    self.firstSyncAt = firstSyncAt
    self.extra = extra
  }

  public init?(json: JSONValue) {
    guard json.objectValue != nil else { return nil }
    let f = JSONFields(json)
    self.init(
      entries: (f["entries"]?.arrayValue ?? []).compactMap(FollowerLogEntry.init(json:)),
      lastSyncAt: f.double("lastSyncAt"), firstSyncAt: f.double("firstSyncAt"),
      extra: f.extra(["entries", "lastSyncAt", "firstSyncAt"]))
  }

  public var json: JSONValue {
    var b = JSONBuilder(extra)
    b.put("entries", .array(entries.map(\.json)))
    b.putIfPresent("lastSyncAt", lastSyncAt)
    b.putIfPresent("firstSyncAt", firstSyncAt)
    return b.json
  }

  public init(from decoder: any Decoder) throws { self = try Self.decodeRecord(from: decoder) }
  public func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

public enum FollowerLog {
  /// How many entries the log keeps; the oldest go first.
  public static let followerLogLimit = 5000

  /// The differences between two follower lists, as log entries: lost
  /// first, then gained, each in its own list's order.
  public static func followerChanges(_ before: [FollowerRow]?, _ after: [FollowerRow]?, at: Double?, since: Double? = nil) -> [FollowerLogEntry] {
    let was = Set((before ?? []).map { JSKey($0.did) })
    let now = Set((after ?? []).map { JSKey($0.did) })
    func entry(_ f: FollowerRow, _ kind: String) -> FollowerLogEntry {
      FollowerLogEntry(
        did: f.did, handle: f.handle, displayName: f.displayName, avatar: f.avatar,
        followedAt: f.followedAt.flatMap { $0.isEmpty ? nil : $0 }, kind: kind, at: at, since: since)
    }
    let lost = (before ?? []).filter { !$0.did.isEmpty && !now.contains(JSKey($0.did)) }.map { entry($0, "lost") }
    let gained = (after ?? []).filter { !$0.did.isEmpty && !was.contains(JSKey($0.did)) }.map { entry($0, "gained") }
    return lost + gained
  }

  /// The log with a sync's changes in front. A sync that changed nothing
  /// still moves `lastSyncAt`.
  public static func mergeFollowerLog(_ held: FollowerLogRecord?, _ changes: [FollowerLogEntry]?, _ at: Double?) -> FollowerLogRecord {
    let entries = Array(((changes ?? []) + (held?.entries ?? [])).prefix(followerLogLimit))
    let first = held?.firstSyncAt.flatMap { $0 == 0 || $0.isNaN ? nil : $0 } ?? at
    return FollowerLogRecord(entries: entries, lastSyncAt: at, firstSyncAt: first)
  }
}
