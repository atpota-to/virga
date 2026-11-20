// What the AppView says about posts and feeds (app.bsky.feed.defs): a
// post, a feed's entry (with the reply it is and why it's there), a thread,
// the stand-ins for a post that's gone or blocked, a feed generator, and
// the threadgate on a post.
//
// Views decode as the AppView sends them. A view that can be a union member
// keeps the `$type` it came with (`lexiconType`).

import Foundation

/// app.bsky.feed.defs#postView. `record` is the post record as JSON
/// (`postRecord` reads it).
public struct PostView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.feed.defs#postView"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var cid: String
  public var author: ProfileViewBasic
  public var record: JSONValue
  public var embed: EmbedView?
  public var bookmarkCount: Int?
  public var replyCount: Int?
  public var repostCount: Int?
  public var likeCount: Int?
  public var quoteCount: Int?
  public var indexedAt: String
  public var viewer: PostViewerState?
  public var labels: [Label]?
  public var threadgate: ThreadgateView?
  public var debug: JSONValue?

  public init(
    uri: String,
    cid: String,
    author: ProfileViewBasic,
    record: JSONValue,
    embed: EmbedView? = nil,
    bookmarkCount: Int? = nil,
    replyCount: Int? = nil,
    repostCount: Int? = nil,
    likeCount: Int? = nil,
    quoteCount: Int? = nil,
    indexedAt: String,
    viewer: PostViewerState? = nil,
    labels: [Label]? = nil,
    threadgate: ThreadgateView? = nil,
    debug: JSONValue? = nil,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.author = author
    self.record = record
    self.embed = embed
    self.bookmarkCount = bookmarkCount
    self.replyCount = replyCount
    self.repostCount = repostCount
    self.likeCount = likeCount
    self.quoteCount = quoteCount
    self.indexedAt = indexedAt
    self.viewer = viewer
    self.labels = labels
    self.threadgate = threadgate
    self.debug = debug
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, cid, author, record, embed, bookmarkCount, replyCount, repostCount, likeCount, quoteCount, indexedAt, viewer, labels, threadgate, debug
  }
}

/// app.bsky.feed.defs#viewerState: the reader and this post. `repost`
/// and `like` are the reader's records' AT-URIs.
public struct PostViewerState: Codable, Hashable, Sendable {
  public var repost: String?
  public var like: String?
  public var bookmarked: Bool?
  public var threadMuted: Bool?
  public var replyDisabled: Bool?
  public var embeddingDisabled: Bool?
  public var pinned: Bool?

  public init(
    repost: String? = nil,
    like: String? = nil,
    bookmarked: Bool? = nil,
    threadMuted: Bool? = nil,
    replyDisabled: Bool? = nil,
    embeddingDisabled: Bool? = nil,
    pinned: Bool? = nil
  ) {
    self.repost = repost
    self.like = like
    self.bookmarked = bookmarked
    self.threadMuted = threadMuted
    self.replyDisabled = replyDisabled
    self.embeddingDisabled = embeddingDisabled
    self.pinned = pinned
  }
}

/// app.bsky.feed.defs#threadgateView.
public struct ThreadgateView: Codable, Hashable, Sendable {
  public var uri: String?
  public var cid: String?
  public var record: JSONValue?
  public var lists: [ListViewBasic]?

  public init(
    uri: String? = nil,
    cid: String? = nil,
    record: JSONValue? = nil,
    lists: [ListViewBasic]? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.record = record
    self.lists = lists
  }
}

/// app.bsky.feed.defs#feedViewPost: one entry of a feed.
public struct FeedViewPost: Codable, Hashable, Sendable {
  public var post: PostView
  public var reply: FeedReplyRef?
  public var reason: FeedReason?
  public var feedContext: String?
  public var reqId: String?

  public init(
    post: PostView,
    reply: FeedReplyRef? = nil,
    reason: FeedReason? = nil,
    feedContext: String? = nil,
    reqId: String? = nil
  ) {
    self.post = post
    self.reply = reply
    self.reason = reason
    self.feedContext = feedContext
    self.reqId = reqId
  }
}

/// app.bsky.feed.defs#replyRef: the thread a feed entry replies in.
public struct FeedReplyRef: Codable, Hashable, Sendable {
  public var root: PostOrUnavailable
  public var parent: PostOrUnavailable
  public var grandparentAuthor: ProfileViewBasic?

  public init(
    root: PostOrUnavailable,
    parent: PostOrUnavailable,
    grandparentAuthor: ProfileViewBasic? = nil
  ) {
    self.root = root
    self.parent = parent
    self.grandparentAuthor = grandparentAuthor
  }
}

/// app.bsky.feed.defs#reasonRepost: in the feed because `by` reposted it.
public struct ReasonRepost: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.feed.defs#reasonRepost"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var by: ProfileViewBasic
  public var uri: String?
  public var cid: String?
  public var indexedAt: String

  public init(
    by: ProfileViewBasic,
    uri: String? = nil,
    cid: String? = nil,
    indexedAt: String,
    lexiconType: String? = nil
  ) {
    self.by = by
    self.uri = uri
    self.cid = cid
    self.indexedAt = indexedAt
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case by, uri, cid, indexedAt
  }
}

/// app.bsky.feed.defs#reasonPin: in the feed because it's pinned.
public struct ReasonPin: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.feed.defs#reasonPin"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?

  public init(lexiconType: String? = nil) {
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
  }
}

/// app.bsky.feed.defs#threadViewPost: a post in a thread, its parent and replies.
public struct ThreadViewPost: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.feed.defs#threadViewPost"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var post: PostView
  public var parent: ThreadNode?
  public var replies: [ThreadNode]?
  public var threadContext: ThreadContext?

  public init(
    post: PostView,
    parent: ThreadNode? = nil,
    replies: [ThreadNode]? = nil,
    threadContext: ThreadContext? = nil,
    lexiconType: String? = nil
  ) {
    self.post = post
    self.parent = parent
    self.replies = replies
    self.threadContext = threadContext
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case post, parent, replies, threadContext
  }
}

/// app.bsky.feed.defs#threadContext.
public struct ThreadContext: Codable, Hashable, Sendable {
  public var rootAuthorLike: String?

  public init(rootAuthorLike: String? = nil) {
    self.rootAuthorLike = rootAuthorLike
  }
}

/// app.bsky.feed.defs#notFoundPost: a post that's gone.
public struct NotFoundPost: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.feed.defs#notFoundPost"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var notFound: Bool

  public init(uri: String, notFound: Bool, lexiconType: String? = nil) {
    self.uri = uri
    self.notFound = notFound
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, notFound
  }
}

/// app.bsky.feed.defs#blockedPost: a post behind a block.
public struct BlockedPost: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.feed.defs#blockedPost"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var blocked: Bool
  public var author: BlockedAuthor

  public init(
    uri: String,
    blocked: Bool,
    author: BlockedAuthor,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.blocked = blocked
    self.author = author
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, blocked, author
  }
}

/// app.bsky.feed.defs#blockedAuthor.
public struct BlockedAuthor: Codable, Hashable, Sendable {
  public var did: String
  public var viewer: ActorViewerState?

  public init(did: String, viewer: ActorViewerState? = nil) {
    self.did = did
    self.viewer = viewer
  }
}

/// app.bsky.feed.defs#generatorView: a custom feed.
public struct GeneratorView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.feed.defs#generatorView"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var cid: String
  public var did: String
  public var creator: ProfileView
  public var displayName: String
  public var description: String?
  public var descriptionFacets: [Facet]?
  public var avatar: String?
  public var likeCount: Int?
  public var acceptsInteractions: Bool?
  public var labels: [Label]?
  public var viewer: GeneratorViewerState?
  public var contentMode: String?
  public var indexedAt: String

  public init(
    uri: String,
    cid: String,
    did: String,
    creator: ProfileView,
    displayName: String,
    description: String? = nil,
    descriptionFacets: [Facet]? = nil,
    avatar: String? = nil,
    likeCount: Int? = nil,
    acceptsInteractions: Bool? = nil,
    labels: [Label]? = nil,
    viewer: GeneratorViewerState? = nil,
    contentMode: String? = nil,
    indexedAt: String,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.did = did
    self.creator = creator
    self.displayName = displayName
    self.description = description
    self.descriptionFacets = descriptionFacets
    self.avatar = avatar
    self.likeCount = likeCount
    self.acceptsInteractions = acceptsInteractions
    self.labels = labels
    self.viewer = viewer
    self.contentMode = contentMode
    self.indexedAt = indexedAt
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, cid, did, creator, displayName, description, descriptionFacets, avatar, likeCount, acceptsInteractions, labels, viewer, contentMode, indexedAt
  }
}

/// app.bsky.feed.defs#generatorViewerState.
public struct GeneratorViewerState: Codable, Hashable, Sendable {
  public var like: String?

  public init(like: String? = nil) {
    self.like = like
  }
}
