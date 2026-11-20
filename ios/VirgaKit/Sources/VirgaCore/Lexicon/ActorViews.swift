// What the AppView says about accounts (app.bsky.actor.defs): the three
// profile views, the signed-in reader's relationship to an account (viewer
// state, known followers), what an account has (lists, feeds, chat), its
// verification and status, and labels (com.atproto.label.defs#label).
//
// Views decode as the AppView sends them: required fields non-optional,
// the rest optional, unknown fields ignored.

import Foundation

/// com.atproto.label.defs#label: a label a labeler put on an account or record.
public struct Label: Codable, Hashable, Sendable {
  public var ver: Int?
  public var src: String
  public var uri: String
  public var cid: String?
  public var val: String
  public var neg: Bool?
  public var cts: String
  public var exp: String?
  /// bytes, as `{ "$bytes": base64 }`
  public var sig: JSONValue?

  public init(
    ver: Int? = nil,
    src: String,
    uri: String,
    cid: String? = nil,
    val: String,
    neg: Bool? = nil,
    cts: String,
    exp: String? = nil,
    sig: JSONValue? = nil
  ) {
    self.ver = ver
    self.src = src
    self.uri = uri
    self.cid = cid
    self.val = val
    self.neg = neg
    self.cts = cts
    self.exp = exp
    self.sig = sig
  }
}

/// app.bsky.actor.defs#profileViewBasic.
public struct ProfileViewBasic: Codable, Hashable, Sendable {
  public var did: String
  public var handle: String
  public var displayName: String?
  public var pronouns: String?
  public var avatar: String?
  public var associated: ProfileAssociated?
  public var viewer: ActorViewerState?
  public var labels: [Label]?
  public var createdAt: String?
  public var verification: VerificationState?
  public var status: StatusView?
  public var debug: JSONValue?

  public init(
    did: String,
    handle: String,
    displayName: String? = nil,
    pronouns: String? = nil,
    avatar: String? = nil,
    associated: ProfileAssociated? = nil,
    viewer: ActorViewerState? = nil,
    labels: [Label]? = nil,
    createdAt: String? = nil,
    verification: VerificationState? = nil,
    status: StatusView? = nil,
    debug: JSONValue? = nil
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.pronouns = pronouns
    self.avatar = avatar
    self.associated = associated
    self.viewer = viewer
    self.labels = labels
    self.createdAt = createdAt
    self.verification = verification
    self.status = status
    self.debug = debug
  }
}

/// app.bsky.actor.defs#profileView.
public struct ProfileView: Codable, Hashable, Sendable {
  public var did: String
  public var handle: String
  public var displayName: String?
  public var pronouns: String?
  public var description: String?
  public var avatar: String?
  public var associated: ProfileAssociated?
  public var indexedAt: String?
  public var createdAt: String?
  public var viewer: ActorViewerState?
  public var labels: [Label]?
  public var verification: VerificationState?
  public var status: StatusView?
  public var debug: JSONValue?

  public init(
    did: String,
    handle: String,
    displayName: String? = nil,
    pronouns: String? = nil,
    description: String? = nil,
    avatar: String? = nil,
    associated: ProfileAssociated? = nil,
    indexedAt: String? = nil,
    createdAt: String? = nil,
    viewer: ActorViewerState? = nil,
    labels: [Label]? = nil,
    verification: VerificationState? = nil,
    status: StatusView? = nil,
    debug: JSONValue? = nil
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.pronouns = pronouns
    self.description = description
    self.avatar = avatar
    self.associated = associated
    self.indexedAt = indexedAt
    self.createdAt = createdAt
    self.viewer = viewer
    self.labels = labels
    self.verification = verification
    self.status = status
    self.debug = debug
  }
}

/// app.bsky.actor.defs#profileViewDetailed: getProfile's and getProfiles'.
public struct ProfileViewDetailed: Codable, Hashable, Sendable {
  public var did: String
  public var handle: String
  public var displayName: String?
  public var description: String?
  public var pronouns: String?
  public var website: String?
  public var avatar: String?
  public var banner: String?
  public var followersCount: Int?
  public var followsCount: Int?
  public var postsCount: Int?
  public var associated: ProfileAssociated?
  public var joinedViaStarterPack: StarterPackViewBasic?
  public var indexedAt: String?
  public var createdAt: String?
  public var viewer: ActorViewerState?
  public var labels: [Label]?
  public var pinnedPost: StrongRef?
  public var verification: VerificationState?
  public var status: StatusView?
  public var debug: JSONValue?

  public init(
    did: String,
    handle: String,
    displayName: String? = nil,
    description: String? = nil,
    pronouns: String? = nil,
    website: String? = nil,
    avatar: String? = nil,
    banner: String? = nil,
    followersCount: Int? = nil,
    followsCount: Int? = nil,
    postsCount: Int? = nil,
    associated: ProfileAssociated? = nil,
    joinedViaStarterPack: StarterPackViewBasic? = nil,
    indexedAt: String? = nil,
    createdAt: String? = nil,
    viewer: ActorViewerState? = nil,
    labels: [Label]? = nil,
    pinnedPost: StrongRef? = nil,
    verification: VerificationState? = nil,
    status: StatusView? = nil,
    debug: JSONValue? = nil
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.description = description
    self.pronouns = pronouns
    self.website = website
    self.avatar = avatar
    self.banner = banner
    self.followersCount = followersCount
    self.followsCount = followsCount
    self.postsCount = postsCount
    self.associated = associated
    self.joinedViaStarterPack = joinedViaStarterPack
    self.indexedAt = indexedAt
    self.createdAt = createdAt
    self.viewer = viewer
    self.labels = labels
    self.pinnedPost = pinnedPost
    self.verification = verification
    self.status = status
    self.debug = debug
  }
}

/// app.bsky.actor.defs#viewerState: the signed-in reader and this account.
/// `following` and `followedBy` are the follow records' AT-URIs.
public struct ActorViewerState: Codable, Hashable, Sendable {
  public var muted: Bool?
  public var mutedByList: ListViewBasic?
  public var blockedBy: Bool?
  public var blocking: String?
  public var blockingByList: ListViewBasic?
  public var following: String?
  public var followedBy: String?
  public var knownFollowers: KnownFollowers?
  public var activitySubscription: ActivitySubscription?

  public init(
    muted: Bool? = nil,
    mutedByList: ListViewBasic? = nil,
    blockedBy: Bool? = nil,
    blocking: String? = nil,
    blockingByList: ListViewBasic? = nil,
    following: String? = nil,
    followedBy: String? = nil,
    knownFollowers: KnownFollowers? = nil,
    activitySubscription: ActivitySubscription? = nil
  ) {
    self.muted = muted
    self.mutedByList = mutedByList
    self.blockedBy = blockedBy
    self.blocking = blocking
    self.blockingByList = blockingByList
    self.following = following
    self.followedBy = followedBy
    self.knownFollowers = knownFollowers
    self.activitySubscription = activitySubscription
  }
}

/// app.bsky.actor.defs#knownFollowers: people the reader follows who follow this account.
public struct KnownFollowers: Codable, Hashable, Sendable {
  public var count: Int
  public var followers: [ProfileViewBasic]

  public init(count: Int, followers: [ProfileViewBasic]) {
    self.count = count
    self.followers = followers
  }
}

/// app.bsky.notification.defs#activitySubscription.
public struct ActivitySubscription: Codable, Hashable, Sendable {
  public var post: Bool
  public var reply: Bool

  public init(post: Bool, reply: Bool) {
    self.post = post
    self.reply = reply
  }
}

/// app.bsky.actor.defs#profileAssociated: what the account has made.
public struct ProfileAssociated: Codable, Hashable, Sendable {
  public var lists: Int?
  public var feedgens: Int?
  public var starterPacks: Int?
  public var labeler: Bool?
  public var chat: ProfileAssociatedChat?
  public var activitySubscription: ProfileAssociatedActivitySubscription?
  public var germ: JSONValue?

  public init(
    lists: Int? = nil,
    feedgens: Int? = nil,
    starterPacks: Int? = nil,
    labeler: Bool? = nil,
    chat: ProfileAssociatedChat? = nil,
    activitySubscription: ProfileAssociatedActivitySubscription? = nil,
    germ: JSONValue? = nil
  ) {
    self.lists = lists
    self.feedgens = feedgens
    self.starterPacks = starterPacks
    self.labeler = labeler
    self.chat = chat
    self.activitySubscription = activitySubscription
    self.germ = germ
  }
}

/// app.bsky.actor.defs#profileAssociatedChat: who may start a chat ('all', 'none', 'following').
public struct ProfileAssociatedChat: Codable, Hashable, Sendable {
  public var allowIncoming: String
  public var allowGroupInvites: String?

  public init(allowIncoming: String, allowGroupInvites: String? = nil) {
    self.allowIncoming = allowIncoming
    self.allowGroupInvites = allowGroupInvites
  }
}

/// app.bsky.actor.defs#profileAssociatedActivitySubscription.
public struct ProfileAssociatedActivitySubscription: Codable, Hashable, Sendable {
  public var allowSubscriptions: String

  public init(allowSubscriptions: String) {
    self.allowSubscriptions = allowSubscriptions
  }
}

/// app.bsky.actor.defs#verificationState.
public struct VerificationState: Codable, Hashable, Sendable {
  public var verifications: [VerificationView]
  public var verifiedStatus: String
  public var trustedVerifierStatus: String

  public init(
    verifications: [VerificationView],
    verifiedStatus: String,
    trustedVerifierStatus: String
  ) {
    self.verifications = verifications
    self.verifiedStatus = verifiedStatus
    self.trustedVerifierStatus = trustedVerifierStatus
  }
}

/// app.bsky.actor.defs#verificationView.
public struct VerificationView: Codable, Hashable, Sendable {
  public var issuer: String
  public var uri: String
  public var isValid: Bool
  public var createdAt: String

  public init(issuer: String, uri: String, isValid: Bool, createdAt: String) {
    self.issuer = issuer
    self.uri = uri
    self.isValid = isValid
    self.createdAt = createdAt
  }
}

/// app.bsky.actor.defs#statusView: a live status.
public struct StatusView: Codable, Hashable, Sendable {
  public var uri: String?
  public var cid: String?
  public var status: String
  public var record: JSONValue
  public var embed: EmbedView?
  public var labels: [Label]?
  public var expiresAt: String?
  public var isActive: Bool?
  public var isDisabled: Bool?

  public init(
    uri: String? = nil,
    cid: String? = nil,
    status: String,
    record: JSONValue,
    embed: EmbedView? = nil,
    labels: [Label]? = nil,
    expiresAt: String? = nil,
    isActive: Bool? = nil,
    isDisabled: Bool? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.status = status
    self.record = record
    self.embed = embed
    self.labels = labels
    self.expiresAt = expiresAt
    self.isActive = isActive
    self.isDisabled = isDisabled
  }
}
