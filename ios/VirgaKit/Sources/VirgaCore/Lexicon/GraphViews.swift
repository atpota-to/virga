// What the AppView says about lists, starter packs, labelers and
// relationships (app.bsky.graph.defs, app.bsky.labeler.defs).
//
// Views decode as the AppView sends them. A view that can be a union member
// keeps the `$type` it came with (`lexiconType`).

import Foundation

/// app.bsky.graph.defs#listViewBasic.
public struct ListViewBasic: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String
  public var name: String
  public var purpose: String
  public var avatar: String?
  public var listItemCount: Int?
  public var labels: [Label]?
  public var viewer: ListViewerState?
  public var indexedAt: String?

  public init(
    uri: String,
    cid: String,
    name: String,
    purpose: String,
    avatar: String? = nil,
    listItemCount: Int? = nil,
    labels: [Label]? = nil,
    viewer: ListViewerState? = nil,
    indexedAt: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.name = name
    self.purpose = purpose
    self.avatar = avatar
    self.listItemCount = listItemCount
    self.labels = labels
    self.viewer = viewer
    self.indexedAt = indexedAt
  }
}

/// app.bsky.graph.defs#listView.
public struct ListView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.graph.defs#listView"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var cid: String
  public var creator: ProfileView
  public var name: String
  public var purpose: String
  public var description: String?
  public var descriptionFacets: [Facet]?
  public var avatar: String?
  public var listItemCount: Int?
  public var labels: [Label]?
  public var viewer: ListViewerState?
  public var indexedAt: String

  public init(
    uri: String,
    cid: String,
    creator: ProfileView,
    name: String,
    purpose: String,
    description: String? = nil,
    descriptionFacets: [Facet]? = nil,
    avatar: String? = nil,
    listItemCount: Int? = nil,
    labels: [Label]? = nil,
    viewer: ListViewerState? = nil,
    indexedAt: String,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.creator = creator
    self.name = name
    self.purpose = purpose
    self.description = description
    self.descriptionFacets = descriptionFacets
    self.avatar = avatar
    self.listItemCount = listItemCount
    self.labels = labels
    self.viewer = viewer
    self.indexedAt = indexedAt
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, cid, creator, name, purpose, description, descriptionFacets, avatar, listItemCount, labels, viewer, indexedAt
  }
}

/// app.bsky.graph.defs#listViewerState. `blocked` is the reader's listblock's AT-URI.
public struct ListViewerState: Codable, Hashable, Sendable {
  public var muted: Bool?
  public var blocked: String?

  public init(muted: Bool? = nil, blocked: String? = nil) {
    self.muted = muted
    self.blocked = blocked
  }
}

/// app.bsky.graph.defs#listItemView. `uri` is the listitem record's.
public struct ListItemView: Codable, Hashable, Sendable {
  public var uri: String
  public var subject: ProfileView

  public init(uri: String, subject: ProfileView) {
    self.uri = uri
    self.subject = subject
  }
}

/// app.bsky.graph.defs#starterPackViewBasic.
public struct StarterPackViewBasic: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.graph.defs#starterPackViewBasic"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var cid: String
  public var record: JSONValue
  public var creator: ProfileViewBasic
  public var listItemCount: Int?
  public var joinedWeekCount: Int?
  public var joinedAllTimeCount: Int?
  public var labels: [Label]?
  public var indexedAt: String

  public init(
    uri: String,
    cid: String,
    record: JSONValue,
    creator: ProfileViewBasic,
    listItemCount: Int? = nil,
    joinedWeekCount: Int? = nil,
    joinedAllTimeCount: Int? = nil,
    labels: [Label]? = nil,
    indexedAt: String,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.record = record
    self.creator = creator
    self.listItemCount = listItemCount
    self.joinedWeekCount = joinedWeekCount
    self.joinedAllTimeCount = joinedAllTimeCount
    self.labels = labels
    self.indexedAt = indexedAt
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, cid, record, creator, listItemCount, joinedWeekCount, joinedAllTimeCount, labels, indexedAt
  }
}

/// app.bsky.graph.defs#starterPackView.
public struct StarterPackView: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String
  public var record: JSONValue
  public var creator: ProfileViewBasic
  public var list: ListViewBasic?
  public var listItemsSample: [ListItemView]?
  public var feeds: [GeneratorView]?
  public var joinedWeekCount: Int?
  public var joinedAllTimeCount: Int?
  public var labels: [Label]?
  public var indexedAt: String

  public init(
    uri: String,
    cid: String,
    record: JSONValue,
    creator: ProfileViewBasic,
    list: ListViewBasic? = nil,
    listItemsSample: [ListItemView]? = nil,
    feeds: [GeneratorView]? = nil,
    joinedWeekCount: Int? = nil,
    joinedAllTimeCount: Int? = nil,
    labels: [Label]? = nil,
    indexedAt: String
  ) {
    self.uri = uri
    self.cid = cid
    self.record = record
    self.creator = creator
    self.list = list
    self.listItemsSample = listItemsSample
    self.feeds = feeds
    self.joinedWeekCount = joinedWeekCount
    self.joinedAllTimeCount = joinedAllTimeCount
    self.labels = labels
    self.indexedAt = indexedAt
  }
}

/// app.bsky.labeler.defs#labelerView.
public struct LabelerView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.labeler.defs#labelerView"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var cid: String
  public var creator: ProfileView
  public var likeCount: Int?
  public var viewer: LabelerViewerState?
  public var indexedAt: String
  public var labels: [Label]?

  public init(
    uri: String,
    cid: String,
    creator: ProfileView,
    likeCount: Int? = nil,
    viewer: LabelerViewerState? = nil,
    indexedAt: String,
    labels: [Label]? = nil,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.creator = creator
    self.likeCount = likeCount
    self.viewer = viewer
    self.indexedAt = indexedAt
    self.labels = labels
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, cid, creator, likeCount, viewer, indexedAt, labels
  }
}

/// app.bsky.labeler.defs#labelerViewerState.
public struct LabelerViewerState: Codable, Hashable, Sendable {
  public var like: String?

  public init(like: String? = nil) {
    self.like = like
  }
}

/// app.bsky.graph.defs#relationship: `actor` and `did`, each way. Each
/// field is the record's AT-URI when it holds.
public struct Relationship: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.graph.defs#relationship"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var did: String
  public var following: String?
  public var followedBy: String?
  public var blocking: String?
  public var blockedBy: String?
  public var blockingByList: String?
  public var blockedByList: String?

  public init(
    did: String,
    following: String? = nil,
    followedBy: String? = nil,
    blocking: String? = nil,
    blockedBy: String? = nil,
    blockingByList: String? = nil,
    blockedByList: String? = nil,
    lexiconType: String? = nil
  ) {
    self.did = did
    self.following = following
    self.followedBy = followedBy
    self.blocking = blocking
    self.blockedBy = blockedBy
    self.blockingByList = blockingByList
    self.blockedByList = blockedByList
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case did, following, followedBy, blocking, blockedBy, blockingByList, blockedByList
  }
}

/// app.bsky.graph.defs#notFoundActor.
public struct NotFoundActor: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.graph.defs#notFoundActor"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var actor: String
  public var notFound: Bool

  public init(actor: String, notFound: Bool, lexiconType: String? = nil) {
    self.actor = actor
    self.notFound = notFound
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case actor, notFound
  }
}

/// app.bsky.notification.listNotifications#notification (not
/// `Notification`, which is Foundation's). `reason` is 'like', 'repost',
/// 'follow', 'mention', 'reply', 'quote', 'starterpack-joined', …;
/// `record` is the record behind it, as JSON. (`cid` and `isRead` are
/// required by the lexicon and always sent by the AppView; the harness,
/// which the demo runs on, leaves them out.)
public struct NotificationView: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String?
  public var author: ProfileView
  public var reason: String
  public var reasonSubject: String?
  public var record: JSONValue
  public var isRead: Bool?
  public var indexedAt: String
  public var labels: [Label]?

  public init(
    uri: String,
    cid: String? = nil,
    author: ProfileView,
    reason: String,
    reasonSubject: String? = nil,
    record: JSONValue,
    isRead: Bool? = nil,
    indexedAt: String,
    labels: [Label]? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.author = author
    self.reason = reason
    self.reasonSubject = reasonSubject
    self.record = record
    self.isRead = isRead
    self.indexedAt = indexedAt
    self.labels = labels
  }
}
