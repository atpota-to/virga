// The AppView's answers to the queries the web app makes, as their
// lexicons shape them, for the network layer to decode into.

import Foundation

/// app.bsky.actor.getProfiles.
public struct GetProfilesOutput: Codable, Hashable, Sendable {
  public var profiles: [ProfileViewDetailed]

  public init(profiles: [ProfileViewDetailed]) {
    self.profiles = profiles
  }
}

/// app.bsky.actor.searchActors and searchActorsTypeahead.
public struct SearchActorsOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var actors: [ProfileView]

  public init(cursor: String? = nil, actors: [ProfileView]) {
    self.cursor = cursor
    self.actors = actors
  }
}

/// app.bsky.graph.getFollowers.
public struct GetFollowersOutput: Codable, Hashable, Sendable {
  public var subject: ProfileView
  public var cursor: String?
  public var followers: [ProfileView]

  public init(subject: ProfileView, cursor: String? = nil, followers: [ProfileView]) {
    self.subject = subject
    self.cursor = cursor
    self.followers = followers
  }
}

/// app.bsky.graph.getFollows.
public struct GetFollowsOutput: Codable, Hashable, Sendable {
  public var subject: ProfileView
  public var cursor: String?
  public var follows: [ProfileView]

  public init(subject: ProfileView, cursor: String? = nil, follows: [ProfileView]) {
    self.subject = subject
    self.cursor = cursor
    self.follows = follows
  }
}

/// app.bsky.graph.getRelationships.
public struct GetRelationshipsOutput: Codable, Hashable, Sendable {
  public var actor: String?
  public var relationships: [RelationshipResult]

  public init(actor: String? = nil, relationships: [RelationshipResult]) {
    self.actor = actor
    self.relationships = relationships
  }
}

/// app.bsky.graph.getList.
public struct GetListOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var list: ListView
  public var items: [ListItemView]

  public init(cursor: String? = nil, list: ListView, items: [ListItemView]) {
    self.cursor = cursor
    self.list = list
    self.items = items
  }
}

/// app.bsky.graph.getLists.
public struct GetListsOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var lists: [ListView]

  public init(cursor: String? = nil, lists: [ListView]) {
    self.cursor = cursor
    self.lists = lists
  }
}

/// app.bsky.graph.getStarterPack.
public struct GetStarterPackOutput: Codable, Hashable, Sendable {
  public var starterPack: StarterPackView

  public init(starterPack: StarterPackView) {
    self.starterPack = starterPack
  }
}

/// app.bsky.feed.getAuthorFeed (and any feed of FeedViewPosts).
public struct GetAuthorFeedOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var feed: [FeedViewPost]

  public init(cursor: String? = nil, feed: [FeedViewPost]) {
    self.cursor = cursor
    self.feed = feed
  }
}

/// app.bsky.feed.getPosts.
public struct GetPostsOutput: Codable, Hashable, Sendable {
  public var posts: [PostView]

  public init(posts: [PostView]) {
    self.posts = posts
  }
}

/// app.bsky.feed.searchPosts.
public struct SearchPostsOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var hitsTotal: Int?
  public var posts: [PostView]

  public init(cursor: String? = nil, hitsTotal: Int? = nil, posts: [PostView]) {
    self.cursor = cursor
    self.hitsTotal = hitsTotal
    self.posts = posts
  }
}

/// app.bsky.feed.getPostThread.
public struct GetPostThreadOutput: Codable, Hashable, Sendable {
  public var thread: ThreadNode
  public var threadgate: ThreadgateView?

  public init(thread: ThreadNode, threadgate: ThreadgateView? = nil) {
    self.thread = thread
    self.threadgate = threadgate
  }
}

/// app.bsky.feed.getFeedGenerator.
public struct GetFeedGeneratorOutput: Codable, Hashable, Sendable {
  public var view: GeneratorView
  public var isOnline: Bool
  public var isValid: Bool

  public init(view: GeneratorView, isOnline: Bool, isValid: Bool) {
    self.view = view
    self.isOnline = isOnline
    self.isValid = isValid
  }
}

/// app.bsky.feed.getFeedGenerators and getActorFeeds.
public struct GetFeedGeneratorsOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var feeds: [GeneratorView]

  public init(cursor: String? = nil, feeds: [GeneratorView]) {
    self.cursor = cursor
    self.feeds = feeds
  }
}

/// app.bsky.notification.listNotifications.
public struct ListNotificationsOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var notifications: [NotificationView]
  public var priority: Bool?
  public var seenAt: String?

  public init(
    cursor: String? = nil,
    notifications: [NotificationView],
    priority: Bool? = nil,
    seenAt: String? = nil
  ) {
    self.cursor = cursor
    self.notifications = notifications
    self.priority = priority
    self.seenAt = seenAt
  }
}

/// app.bsky.actor.getPreferences.
public struct GetPreferencesOutput: Codable, Hashable, Sendable {
  public var preferences: [ActorPreference]

  public init(preferences: [ActorPreference]) {
    self.preferences = preferences
  }
}

/// app.bsky.bookmark.defs#bookmarkView.
public struct BookmarkView: Codable, Hashable, Sendable {
  public var subject: StrongRef
  public var createdAt: String?
  public var item: PostOrUnavailable

  public init(subject: StrongRef, createdAt: String? = nil, item: PostOrUnavailable) {
    self.subject = subject
    self.createdAt = createdAt
    self.item = item
  }
}

/// app.bsky.bookmark.getBookmarks.
public struct GetBookmarksOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var bookmarks: [BookmarkView]

  public init(cursor: String? = nil, bookmarks: [BookmarkView]) {
    self.cursor = cursor
    self.bookmarks = bookmarks
  }
}

/// app.bsky.draft.getDrafts.
public struct GetDraftsOutput: Codable, Hashable, Sendable {
  public var cursor: String?
  public var drafts: [DraftView]

  public init(cursor: String? = nil, drafts: [DraftView]) {
    self.cursor = cursor
    self.drafts = drafts
  }
}

/// app.bsky.draft.createDraft.
public struct CreateDraftOutput: Codable, Hashable, Sendable {
  public var id: String

  public init(id: String) {
    self.id = id
  }
}
