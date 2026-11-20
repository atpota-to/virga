// The records Virga reads from repos and writes to them: posts, the gates
// on who can reply and quote, likes, reposts, follows, blocks, lists and
// their items, list blocks, starter packs, profiles, feed generators and
// post templates (net.anisota.feed.template, Anisota's format).
//
// The structs here follow LexiconCoding.swift's rules: a record always
// writes its `$type`, required fields are non-optional, and `extra` keeps
// what this version doesn't read, so a record written back loses nothing.

import Foundation

/// app.bsky.feed.post#replyRef: the thread's first post and the post replied to.
public struct ReplyRef: Codable, Hashable, Sendable {
  public var root: StrongRef
  public var parent: StrongRef
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(root: StrongRef, parent: StrongRef, extra: [String: JSONValue] = [:]) {
    self.root = root
    self.parent = parent
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    root = try r.required("root")
    parent = try r.required("parent")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(root, "root")
    try w.put(parent, "parent")
  }
}

/// app.bsky.feed.post: a post.
public struct PostRecord: LexiconRecord {
  public static let nsid = "app.bsky.feed.post"

  public var text: String
  /// deprecated, before facets
  public var entities: [JSONValue]?
  public var facets: [Facet]?
  public var reply: ReplyRef?
  public var embed: PostEmbed?
  public var langs: [String]?
  public var labels: SelfLabels?
  public var tags: [String]?
  public var createdAt: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    text: String,
    entities: [JSONValue]? = nil,
    facets: [Facet]? = nil,
    reply: ReplyRef? = nil,
    embed: PostEmbed? = nil,
    langs: [String]? = nil,
    labels: SelfLabels? = nil,
    tags: [String]? = nil,
    createdAt: String,
    extra: [String: JSONValue] = [:]
  ) {
    self.text = text
    self.entities = entities
    self.facets = facets
    self.reply = reply
    self.embed = embed
    self.langs = langs
    self.labels = labels
    self.tags = tags
    self.createdAt = createdAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    text = try r.required("text")
    entities = r.optional("entities")
    facets = r.optional("facets")
    reply = r.optional("reply")
    embed = r.optional("embed")
    langs = r.optional("langs")
    labels = r.optional("labels")
    tags = r.optional("tags")
    createdAt = try r.required("createdAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(text, "text")
    try w.put(entities, "entities")
    try w.put(facets, "facets")
    try w.put(reply, "reply")
    try w.put(embed, "embed")
    try w.put(langs, "langs")
    try w.put(labels, "labels")
    try w.put(tags, "tags")
    try w.put(createdAt, "createdAt")
  }
}

/// app.bsky.feed.threadgate: who may reply to a thread. No `allow` is
/// everyone; an empty one is nobody.
public struct ThreadgateRecord: LexiconRecord {
  public static let nsid = "app.bsky.feed.threadgate"

  public var post: String
  public var allow: [ThreadgateRule]?
  public var createdAt: String
  public var hiddenReplies: [String]?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    post: String,
    allow: [ThreadgateRule]? = nil,
    createdAt: String,
    hiddenReplies: [String]? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.post = post
    self.allow = allow
    self.createdAt = createdAt
    self.hiddenReplies = hiddenReplies
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    post = try r.required("post")
    allow = r.optional("allow")
    createdAt = try r.required("createdAt")
    hiddenReplies = r.optional("hiddenReplies")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(post, "post")
    try w.put(allow, "allow")
    try w.put(createdAt, "createdAt")
    try w.put(hiddenReplies, "hiddenReplies")
  }
}

/// app.bsky.feed.postgate: whether a post may be quoted, and the quotes detached from it.
public struct PostgateRecord: LexiconRecord {
  public static let nsid = "app.bsky.feed.postgate"

  public var createdAt: String
  public var post: String
  public var detachedEmbeddingUris: [String]?
  public var embeddingRules: [PostgateRule]?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    createdAt: String,
    post: String,
    detachedEmbeddingUris: [String]? = nil,
    embeddingRules: [PostgateRule]? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.createdAt = createdAt
    self.post = post
    self.detachedEmbeddingUris = detachedEmbeddingUris
    self.embeddingRules = embeddingRules
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    createdAt = try r.required("createdAt")
    post = try r.required("post")
    detachedEmbeddingUris = r.optional("detachedEmbeddingUris")
    embeddingRules = r.optional("embeddingRules")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(createdAt, "createdAt")
    try w.put(post, "post")
    try w.put(detachedEmbeddingUris, "detachedEmbeddingUris")
    try w.put(embeddingRules, "embeddingRules")
  }
}

/// app.bsky.feed.like.
public struct LikeRecord: LexiconRecord {
  public static let nsid = "app.bsky.feed.like"

  public var subject: StrongRef
  public var createdAt: String
  public var via: StrongRef?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    subject: StrongRef,
    createdAt: String,
    via: StrongRef? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.subject = subject
    self.createdAt = createdAt
    self.via = via
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    subject = try r.required("subject")
    createdAt = try r.required("createdAt")
    via = r.optional("via")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(subject, "subject")
    try w.put(createdAt, "createdAt")
    try w.put(via, "via")
  }
}

/// app.bsky.feed.repost.
public struct RepostRecord: LexiconRecord {
  public static let nsid = "app.bsky.feed.repost"

  public var subject: StrongRef
  public var createdAt: String
  public var via: StrongRef?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    subject: StrongRef,
    createdAt: String,
    via: StrongRef? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.subject = subject
    self.createdAt = createdAt
    self.via = via
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    subject = try r.required("subject")
    createdAt = try r.required("createdAt")
    via = r.optional("via")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(subject, "subject")
    try w.put(createdAt, "createdAt")
    try w.put(via, "via")
  }
}

/// app.bsky.graph.follow: `subject` is the DID followed.
public struct FollowRecord: LexiconRecord {
  public static let nsid = "app.bsky.graph.follow"

  public var subject: String
  public var createdAt: String
  public var via: StrongRef?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    subject: String,
    createdAt: String,
    via: StrongRef? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.subject = subject
    self.createdAt = createdAt
    self.via = via
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    subject = try r.required("subject")
    createdAt = try r.required("createdAt")
    via = r.optional("via")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(subject, "subject")
    try w.put(createdAt, "createdAt")
    try w.put(via, "via")
  }
}

/// app.bsky.graph.block: `subject` is the DID blocked.
public struct BlockRecord: LexiconRecord {
  public static let nsid = "app.bsky.graph.block"

  public var subject: String
  public var createdAt: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(subject: String, createdAt: String, extra: [String: JSONValue] = [:]) {
    self.subject = subject
    self.createdAt = createdAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    subject = try r.required("subject")
    createdAt = try r.required("createdAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(subject, "subject")
    try w.put(createdAt, "createdAt")
  }
}

/// app.bsky.graph.list: a moderation, curation or reference list (ListPurpose).
public struct ListRecord: LexiconRecord {
  public static let nsid = "app.bsky.graph.list"

  public var purpose: String
  public var name: String
  public var description: String?
  public var descriptionFacets: [Facet]?
  public var avatar: BlobRef?
  public var labels: SelfLabels?
  public var createdAt: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    purpose: String,
    name: String,
    description: String? = nil,
    descriptionFacets: [Facet]? = nil,
    avatar: BlobRef? = nil,
    labels: SelfLabels? = nil,
    createdAt: String,
    extra: [String: JSONValue] = [:]
  ) {
    self.purpose = purpose
    self.name = name
    self.description = description
    self.descriptionFacets = descriptionFacets
    self.avatar = avatar
    self.labels = labels
    self.createdAt = createdAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    purpose = try r.required("purpose")
    name = try r.required("name")
    description = r.optional("description")
    descriptionFacets = r.optional("descriptionFacets")
    avatar = r.optional("avatar")
    labels = r.optional("labels")
    createdAt = try r.required("createdAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(purpose, "purpose")
    try w.put(name, "name")
    try w.put(description, "description")
    try w.put(descriptionFacets, "descriptionFacets")
    try w.put(avatar, "avatar")
    try w.put(labels, "labels")
    try w.put(createdAt, "createdAt")
  }
}

/// app.bsky.graph.listitem: `subject` (a DID) on `list` (an AT-URI).
public struct ListItemRecord: LexiconRecord {
  public static let nsid = "app.bsky.graph.listitem"

  public var subject: String
  public var list: String
  public var createdAt: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    subject: String,
    list: String,
    createdAt: String,
    extra: [String: JSONValue] = [:]
  ) {
    self.subject = subject
    self.list = list
    self.createdAt = createdAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    subject = try r.required("subject")
    list = try r.required("list")
    createdAt = try r.required("createdAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(subject, "subject")
    try w.put(list, "list")
    try w.put(createdAt, "createdAt")
  }
}

/// app.bsky.graph.listblock: `subject` is the AT-URI of the list blocked.
public struct ListBlockRecord: LexiconRecord {
  public static let nsid = "app.bsky.graph.listblock"

  public var subject: String
  public var createdAt: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(subject: String, createdAt: String, extra: [String: JSONValue] = [:]) {
    self.subject = subject
    self.createdAt = createdAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    subject = try r.required("subject")
    createdAt = try r.required("createdAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(subject, "subject")
    try w.put(createdAt, "createdAt")
  }
}

/// app.bsky.graph.starterpack#feedItem.
public struct StarterPackFeedItem: Codable, Hashable, Sendable {
  public var uri: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(uri: String, extra: [String: JSONValue] = [:]) {
    self.uri = uri
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    uri = try r.required("uri")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(uri, "uri")
  }
}

/// app.bsky.graph.starterpack.
public struct StarterPackRecord: LexiconRecord {
  public static let nsid = "app.bsky.graph.starterpack"

  public var name: String
  public var description: String?
  public var descriptionFacets: [Facet]?
  public var list: String
  public var feeds: [StarterPackFeedItem]?
  public var createdAt: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    name: String,
    description: String? = nil,
    descriptionFacets: [Facet]? = nil,
    list: String,
    feeds: [StarterPackFeedItem]? = nil,
    createdAt: String,
    extra: [String: JSONValue] = [:]
  ) {
    self.name = name
    self.description = description
    self.descriptionFacets = descriptionFacets
    self.list = list
    self.feeds = feeds
    self.createdAt = createdAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    name = try r.required("name")
    description = r.optional("description")
    descriptionFacets = r.optional("descriptionFacets")
    list = try r.required("list")
    feeds = r.optional("feeds")
    createdAt = try r.required("createdAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(name, "name")
    try w.put(description, "description")
    try w.put(descriptionFacets, "descriptionFacets")
    try w.put(list, "list")
    try w.put(feeds, "feeds")
    try w.put(createdAt, "createdAt")
  }
}

/// app.bsky.actor.profile (record key `self`).
public struct ProfileRecord: LexiconRecord {
  public static let nsid = "app.bsky.actor.profile"

  public var displayName: String?
  public var description: String?
  public var pronouns: String?
  public var website: String?
  public var avatar: BlobRef?
  public var banner: BlobRef?
  public var labels: SelfLabels?
  public var joinedViaStarterPack: StrongRef?
  public var pinnedPost: StrongRef?
  public var createdAt: String?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    displayName: String? = nil,
    description: String? = nil,
    pronouns: String? = nil,
    website: String? = nil,
    avatar: BlobRef? = nil,
    banner: BlobRef? = nil,
    labels: SelfLabels? = nil,
    joinedViaStarterPack: StrongRef? = nil,
    pinnedPost: StrongRef? = nil,
    createdAt: String? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.displayName = displayName
    self.description = description
    self.pronouns = pronouns
    self.website = website
    self.avatar = avatar
    self.banner = banner
    self.labels = labels
    self.joinedViaStarterPack = joinedViaStarterPack
    self.pinnedPost = pinnedPost
    self.createdAt = createdAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    displayName = r.optional("displayName")
    description = r.optional("description")
    pronouns = r.optional("pronouns")
    website = r.optional("website")
    avatar = r.optional("avatar")
    banner = r.optional("banner")
    labels = r.optional("labels")
    joinedViaStarterPack = r.optional("joinedViaStarterPack")
    pinnedPost = r.optional("pinnedPost")
    createdAt = r.optional("createdAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(displayName, "displayName")
    try w.put(description, "description")
    try w.put(pronouns, "pronouns")
    try w.put(website, "website")
    try w.put(avatar, "avatar")
    try w.put(banner, "banner")
    try w.put(labels, "labels")
    try w.put(joinedViaStarterPack, "joinedViaStarterPack")
    try w.put(pinnedPost, "pinnedPost")
    try w.put(createdAt, "createdAt")
  }
}

/// app.bsky.feed.generator: a custom feed's declaration.
public struct GeneratorRecord: LexiconRecord {
  public static let nsid = "app.bsky.feed.generator"

  public var did: String
  public var displayName: String
  public var description: String?
  public var descriptionFacets: [Facet]?
  public var avatar: BlobRef?
  public var acceptsInteractions: Bool?
  public var labels: SelfLabels?
  public var contentMode: String?
  public var createdAt: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    did: String,
    displayName: String,
    description: String? = nil,
    descriptionFacets: [Facet]? = nil,
    avatar: BlobRef? = nil,
    acceptsInteractions: Bool? = nil,
    labels: SelfLabels? = nil,
    contentMode: String? = nil,
    createdAt: String,
    extra: [String: JSONValue] = [:]
  ) {
    self.did = did
    self.displayName = displayName
    self.description = description
    self.descriptionFacets = descriptionFacets
    self.avatar = avatar
    self.acceptsInteractions = acceptsInteractions
    self.labels = labels
    self.contentMode = contentMode
    self.createdAt = createdAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    did = try r.required("did")
    displayName = try r.required("displayName")
    description = r.optional("description")
    descriptionFacets = r.optional("descriptionFacets")
    avatar = r.optional("avatar")
    acceptsInteractions = r.optional("acceptsInteractions")
    labels = r.optional("labels")
    contentMode = r.optional("contentMode")
    createdAt = try r.required("createdAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(did, "did")
    try w.put(displayName, "displayName")
    try w.put(description, "description")
    try w.put(descriptionFacets, "descriptionFacets")
    try w.put(avatar, "avatar")
    try w.put(acceptsInteractions, "acceptsInteractions")
    try w.put(labels, "labels")
    try w.put(contentMode, "contentMode")
    try w.put(createdAt, "createdAt")
  }
}

/// One blank of a template: what the editor asks for (postTemplates.js normalizeVariable).
public struct TemplateVariable: Codable, Hashable, Sendable {
  public var key: String
  public var label: String?
  public var hint: String?
  /// 'choice', with `choices`
  public var kind: String?
  public var choices: [String]?
  public var `default`: String?
  public var optional: Bool?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    key: String,
    label: String? = nil,
    hint: String? = nil,
    kind: String? = nil,
    choices: [String]? = nil,
    `default`: String? = nil,
    optional: Bool? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.key = key
    self.label = label
    self.hint = hint
    self.kind = kind
    self.choices = choices
    self.`default` = `default`
    self.optional = optional
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    key = try r.required("key")
    label = r.optional("label")
    hint = r.optional("hint")
    kind = r.optional("kind")
    choices = r.optional("choices")
    `default` = r.optional("default")
    optional = r.optional("optional")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(key, "key")
    try w.put(label, "label")
    try w.put(hint, "hint")
    try w.put(kind, "kind")
    try w.put(choices, "choices")
    try w.put(`default`, "default")
    try w.put(optional, "optional")
  }
}

/// net.anisota.feed.template: a saved reply or post (postTemplates.js
/// templateToRecord writes it; normalizeTemplateRecord reads it).
public struct TemplateRecord: LexiconRecord {
  public static let nsid = "net.anisota.feed.template"

  public var name: String
  public var text: String
  public var variables: [TemplateVariable]?
  public var embed: PostEmbed?
  /// 'any', 'reply' or 'post'
  public var use: String?
  public var group: String?
  public var shortcut: String?
  public var keywords: [String]?
  public var langs: [String]?
  public var createdAt: String?
  public var updatedAt: String?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    name: String,
    text: String,
    variables: [TemplateVariable]? = nil,
    embed: PostEmbed? = nil,
    use: String? = nil,
    group: String? = nil,
    shortcut: String? = nil,
    keywords: [String]? = nil,
    langs: [String]? = nil,
    createdAt: String? = nil,
    updatedAt: String? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.name = name
    self.text = text
    self.variables = variables
    self.embed = embed
    self.use = use
    self.group = group
    self.shortcut = shortcut
    self.keywords = keywords
    self.langs = langs
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder, recordType: Self.nsid)
    name = try r.required("name")
    text = try r.required("text")
    variables = r.optional("variables")
    embed = r.optional("embed")
    use = r.optional("use")
    group = r.optional("group")
    shortcut = r.optional("shortcut")
    keywords = r.optional("keywords")
    langs = r.optional("langs")
    createdAt = r.optional("createdAt")
    updatedAt = r.optional("updatedAt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: Self.nsid, extra: extra)
    try w.put(name, "name")
    try w.put(text, "text")
    try w.put(variables, "variables")
    try w.put(embed, "embed")
    try w.put(use, "use")
    try w.put(group, "group")
    try w.put(shortcut, "shortcut")
    try w.put(keywords, "keywords")
    try w.put(langs, "langs")
    try w.put(createdAt, "createdAt")
    try w.put(updatedAt, "updatedAt")
  }
}
