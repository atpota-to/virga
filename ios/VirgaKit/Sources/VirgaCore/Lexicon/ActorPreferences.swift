// The account preferences Virga reads (app.bsky.actor.getPreferences): the
// default reply and quote settings, and saved feeds. Read and written back
// whole, so each keeps what it doesn't model, and preferences of any other
// kind are kept as JSON (ActorPreference.unknown).

import Foundation

/// app.bsky.actor.defs#postInteractionSettingsPref: who may reply to and
/// quote a new post by default. No `threadgateAllowRules` is everyone.
public struct PostInteractionSettingsPref: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.actor.defs#postInteractionSettingsPref"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var threadgateAllowRules: [ThreadgateRule]?
  public var postgateEmbeddingRules: [PostgateRule]?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    threadgateAllowRules: [ThreadgateRule]? = nil,
    postgateEmbeddingRules: [PostgateRule]? = nil,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.threadgateAllowRules = threadgateAllowRules
    self.postgateEmbeddingRules = postgateEmbeddingRules
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    threadgateAllowRules = r.optional("threadgateAllowRules")
    postgateEmbeddingRules = r.optional("postgateEmbeddingRules")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(threadgateAllowRules, "threadgateAllowRules")
    try w.put(postgateEmbeddingRules, "postgateEmbeddingRules")
  }
}

/// app.bsky.actor.defs#savedFeedsPrefV2.
public struct SavedFeedsPrefV2: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.actor.defs#savedFeedsPrefV2"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var items: [SavedFeed]
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    items: [SavedFeed],
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.items = items
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    items = try r.required("items")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(items, "items")
  }
}

/// app.bsky.actor.defs#savedFeed. `type` is 'feed', 'list' or 'timeline';
/// `value` the feed's or list's AT-URI ('following' for the timeline).
public struct SavedFeed: Codable, Hashable, Sendable {
  public var id: String
  public var type: String
  public var value: String
  public var pinned: Bool
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    id: String,
    type: String,
    value: String,
    pinned: Bool,
    extra: [String: JSONValue] = [:]
  ) {
    self.id = id
    self.type = type
    self.value = value
    self.pinned = pinned
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    id = try r.required("id")
    type = try r.required("type")
    value = try r.required("value")
    pinned = try r.required("pinned")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(id, "id")
    try w.put(type, "type")
    try w.put(value, "value")
    try w.put(pinned, "pinned")
  }
}

/// app.bsky.actor.defs#savedFeedsPref: the older shape, AT-URIs only.
public struct SavedFeedsPref: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.actor.defs#savedFeedsPref"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var pinned: [String]
  public var saved: [String]
  public var timelineIndex: Int?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    pinned: [String],
    saved: [String],
    timelineIndex: Int? = nil,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.pinned = pinned
    self.saved = saved
    self.timelineIndex = timelineIndex
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    pinned = try r.required("pinned")
    saved = try r.required("saved")
    timelineIndex = r.optional("timelineIndex")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(pinned, "pinned")
    try w.put(saved, "saved")
    try w.put(timelineIndex, "timelineIndex")
  }
}
