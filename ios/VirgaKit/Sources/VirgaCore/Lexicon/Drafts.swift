// Bluesky's private drafts (app.bsky.draft.*), as the web writes and reads
// them (src/posting/drafts/drafts.js): a draft is posts, each with its text
// and its media by local reference (the device keeps the bytes), plus the
// reply and quote settings chosen for it.
//
// The web writes more on a draft post than the lexicon declares (its
// facets, tags, embed, reply and `virgaCard`); those are modelled too, and
// anything else is kept in `extra`, so a draft another app wrote is sent
// back as it came. Every object keeps the `$type` it was read with; new ones
// carry their own, as the web writes them.

import Foundation

/// app.bsky.draft.defs#draft.
public struct Draft: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.draft.defs#draft"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var deviceId: String?
  public var deviceName: String?
  public var posts: [DraftPost]
  public var langs: [String]?
  public var postgateEmbeddingRules: [PostgateRule]?
  public var threadgateAllow: [ThreadgateRule]?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    deviceId: String? = nil,
    deviceName: String? = nil,
    posts: [DraftPost],
    langs: [String]? = nil,
    postgateEmbeddingRules: [PostgateRule]? = nil,
    threadgateAllow: [ThreadgateRule]? = nil,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.deviceId = deviceId
    self.deviceName = deviceName
    self.posts = posts
    self.langs = langs
    self.postgateEmbeddingRules = postgateEmbeddingRules
    self.threadgateAllow = threadgateAllow
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    deviceId = r.optional("deviceId")
    deviceName = r.optional("deviceName")
    posts = try r.required("posts")
    langs = r.optional("langs")
    postgateEmbeddingRules = r.optional("postgateEmbeddingRules")
    threadgateAllow = r.optional("threadgateAllow")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(deviceId, "deviceId")
    try w.put(deviceName, "deviceName")
    try w.put(posts, "posts")
    try w.put(langs, "langs")
    try w.put(postgateEmbeddingRules, "postgateEmbeddingRules")
    try w.put(threadgateAllow, "threadgateAllow")
  }
}

/// app.bsky.draft.defs#draftPost, with the web's own fields (facets,
/// tags, embed, reply, virgaCard).
public struct DraftPost: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.draft.defs#draftPost"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var text: String
  public var labels: SelfLabels?
  public var embedImages: [DraftEmbedImage]?
  public var embedVideos: [DraftEmbedVideo]?
  public var embedExternals: [DraftEmbedExternal]?
  public var embedRecords: [DraftEmbedRecord]?
  /// Virga's: the post's facets as it would carry them
  public var facets: [Facet]?
  /// Virga's
  public var tags: [String]?
  /// Virga's: media already uploaded as this account
  public var embed: PostEmbed?
  /// Virga's: the post replied to, on the first post
  public var reply: ReplyRef?
  /// Virga's: a link card's thumb address and whether it was edited
  public var virgaCard: JSONValue?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    text: String,
    labels: SelfLabels? = nil,
    embedImages: [DraftEmbedImage]? = nil,
    embedVideos: [DraftEmbedVideo]? = nil,
    embedExternals: [DraftEmbedExternal]? = nil,
    embedRecords: [DraftEmbedRecord]? = nil,
    facets: [Facet]? = nil,
    tags: [String]? = nil,
    embed: PostEmbed? = nil,
    reply: ReplyRef? = nil,
    virgaCard: JSONValue? = nil,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.text = text
    self.labels = labels
    self.embedImages = embedImages
    self.embedVideos = embedVideos
    self.embedExternals = embedExternals
    self.embedRecords = embedRecords
    self.facets = facets
    self.tags = tags
    self.embed = embed
    self.reply = reply
    self.virgaCard = virgaCard
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    text = try r.required("text")
    labels = r.optional("labels")
    embedImages = r.optional("embedImages")
    embedVideos = r.optional("embedVideos")
    embedExternals = r.optional("embedExternals")
    embedRecords = r.optional("embedRecords")
    facets = r.optional("facets")
    tags = r.optional("tags")
    embed = r.optional("embed")
    reply = r.optional("reply")
    virgaCard = r.optional("virgaCard")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(text, "text")
    try w.put(labels, "labels")
    try w.put(embedImages, "embedImages")
    try w.put(embedVideos, "embedVideos")
    try w.put(embedExternals, "embedExternals")
    try w.put(embedRecords, "embedRecords")
    try w.put(facets, "facets")
    try w.put(tags, "tags")
    try w.put(embed, "embed")
    try w.put(reply, "reply")
    try w.put(virgaCard, "virgaCard")
  }
}

/// app.bsky.draft.defs#draftEmbedLocalRef: where the device keeps the media.
public struct DraftEmbedLocalRef: Codable, Hashable, Sendable {
  public var path: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(path: String, extra: [String: JSONValue] = [:]) {
    self.path = path
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    path = try r.required("path")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(path, "path")
  }
}

/// app.bsky.draft.defs#draftEmbedCaption.
public struct DraftEmbedCaption: Codable, Hashable, Sendable {
  public var lang: String
  public var content: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(lang: String, content: String, extra: [String: JSONValue] = [:]) {
    self.lang = lang
    self.content = content
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lang = try r.required("lang")
    content = try r.required("content")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(lang, "lang")
    try w.put(content, "content")
  }
}

/// app.bsky.draft.defs#draftEmbedImage.
public struct DraftEmbedImage: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.draft.defs#draftEmbedImage"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var localRef: DraftEmbedLocalRef
  public var alt: String?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    localRef: DraftEmbedLocalRef,
    alt: String? = nil,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.localRef = localRef
    self.alt = alt
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    localRef = try r.required("localRef")
    alt = r.optional("alt")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(localRef, "localRef")
    try w.put(alt, "alt")
  }
}

/// app.bsky.draft.defs#draftEmbedVideo.
public struct DraftEmbedVideo: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.draft.defs#draftEmbedVideo"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var localRef: DraftEmbedLocalRef
  public var alt: String?
  public var captions: [DraftEmbedCaption]?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    localRef: DraftEmbedLocalRef,
    alt: String? = nil,
    captions: [DraftEmbedCaption]? = nil,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.localRef = localRef
    self.alt = alt
    self.captions = captions
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    localRef = try r.required("localRef")
    alt = r.optional("alt")
    captions = r.optional("captions")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(localRef, "localRef")
    try w.put(alt, "alt")
    try w.put(captions, "captions")
  }
}

/// app.bsky.draft.defs#draftEmbedExternal.
public struct DraftEmbedExternal: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.draft.defs#draftEmbedExternal"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var uri: String
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    uri: String,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.uri = uri
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    uri = try r.required("uri")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(uri, "uri")
  }
}

/// app.bsky.draft.defs#draftEmbedRecord.
public struct DraftEmbedRecord: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.draft.defs#draftEmbedRecord"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var record: StrongRef
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    record: StrongRef,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.record = record
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    record = try r.required("record")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(record, "record")
  }
}

/// app.bsky.draft.defs#draftWithId: what updateDraft is sent.
public struct DraftWithId: Codable, Hashable, Sendable {
  public var id: String
  public var draft: Draft
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(id: String, draft: Draft, extra: [String: JSONValue] = [:]) {
    self.id = id
    self.draft = draft
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    id = try r.required("id")
    draft = try r.required("draft")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(id, "id")
    try w.put(draft, "draft")
  }
}

/// app.bsky.draft.defs#draftView: what getDrafts gives.
public struct DraftView: Codable, Hashable, Sendable {
  public var id: String
  public var draft: Draft
  public var createdAt: String
  public var updatedAt: String

  public init(id: String, draft: Draft, createdAt: String, updatedAt: String) {
    self.id = id
    self.draft = draft
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}
