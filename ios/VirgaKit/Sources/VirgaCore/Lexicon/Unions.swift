// The record-side unions: a post's embed, the media of a quoted record with
// media, the threadgate's rules and the postgate's. Each is decided by
// `$type`, keeps a member it doesn't know (or can't read) as JSON, and
// writes its member with its `$type`, as atproto JSON does.

import Foundation

/// app.bsky.feed.post's `embed`.
public enum PostEmbed: Hashable, Sendable {
  case images(ImagesEmbed)
  case video(VideoEmbed)
  case external(ExternalEmbed)
  case record(RecordEmbed)
  case recordWithMedia(RecordWithMediaEmbed)
  case gallery(GalleryEmbed)
  case unknown(JSONValue)

  /// The `$type` of the member.
  public var type: String? {
    switch self {
    case .images: return ImagesEmbed.type
    case .video: return VideoEmbed.type
    case .external: return ExternalEmbed.type
    case .record: return RecordEmbed.type
    case .recordWithMedia: return RecordWithMediaEmbed.type
    case .gallery: return GalleryEmbed.type
    case .unknown(let raw): return raw["$type"]?.stringValue
    }
  }
}

extension PostEmbed: Codable {
  public init(from decoder: Decoder) throws {
    switch Lexicon.type(in: decoder) {
    case ImagesEmbed.type: self = try Lexicon.member(decoder, ImagesEmbed.self, Self.images, unknown: Self.unknown)
    case VideoEmbed.type: self = try Lexicon.member(decoder, VideoEmbed.self, Self.video, unknown: Self.unknown)
    case ExternalEmbed.type: self = try Lexicon.member(decoder, ExternalEmbed.self, Self.external, unknown: Self.unknown)
    case RecordEmbed.type: self = try Lexicon.member(decoder, RecordEmbed.self, Self.record, unknown: Self.unknown)
    case RecordWithMediaEmbed.type:
      self = try Lexicon.member(decoder, RecordWithMediaEmbed.self, Self.recordWithMedia, unknown: Self.unknown)
    case GalleryEmbed.type: self = try Lexicon.member(decoder, GalleryEmbed.self, Self.gallery, unknown: Self.unknown)
    default: self = .unknown(try JSONValue(from: decoder))
    }
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .images(let v): try Lexicon.encodeMember(v, to: encoder)
    case .video(let v): try Lexicon.encodeMember(v, to: encoder)
    case .external(let v): try Lexicon.encodeMember(v, to: encoder)
    case .record(let v): try Lexicon.encodeMember(v, to: encoder)
    case .recordWithMedia(let v): try Lexicon.encodeMember(v, to: encoder)
    case .gallery(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

/// app.bsky.embed.recordWithMedia's `media`.
public enum MediaEmbed: Hashable, Sendable {
  case images(ImagesEmbed)
  case video(VideoEmbed)
  case external(ExternalEmbed)
  case gallery(GalleryEmbed)
  case unknown(JSONValue)
}

extension MediaEmbed: Codable {
  public init(from decoder: Decoder) throws {
    switch Lexicon.type(in: decoder) {
    case ImagesEmbed.type: self = try Lexicon.member(decoder, ImagesEmbed.self, Self.images, unknown: Self.unknown)
    case VideoEmbed.type: self = try Lexicon.member(decoder, VideoEmbed.self, Self.video, unknown: Self.unknown)
    case ExternalEmbed.type: self = try Lexicon.member(decoder, ExternalEmbed.self, Self.external, unknown: Self.unknown)
    case GalleryEmbed.type: self = try Lexicon.member(decoder, GalleryEmbed.self, Self.gallery, unknown: Self.unknown)
    default: self = .unknown(try JSONValue(from: decoder))
    }
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .images(let v): try Lexicon.encodeMember(v, to: encoder)
    case .video(let v): try Lexicon.encodeMember(v, to: encoder)
    case .external(let v): try Lexicon.encodeMember(v, to: encoder)
    case .gallery(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

/// One rule of a threadgate's `allow` (and of the default reply settings,
/// postInteractionSettingsPref, and a draft's threadgateAllow).
public enum ThreadgateRule: Hashable, Sendable {
  /// Accounts mentioned in the post.
  case mention
  /// Accounts that follow the author.
  case follower
  /// Accounts the author follows.
  case following
  /// Accounts on a list (its AT-URI).
  case list(String)
  case unknown(JSONValue)

  public static let mentionType = "app.bsky.feed.threadgate#mentionRule"
  public static let followerType = "app.bsky.feed.threadgate#followerRule"
  public static let followingType = "app.bsky.feed.threadgate#followingRule"
  public static let listType = "app.bsky.feed.threadgate#listRule"
}

extension ThreadgateRule: Codable {
  public init(from decoder: Decoder) throws {
    let raw = try JSONValue(from: decoder)
    // Only a rule exactly as the lexicon writes it is read as one, so
    // anything more round-trips as it came.
    let keys = Set(raw.objectValue?.keys.map { $0 } ?? [])
    switch raw["$type"]?.stringValue {
    case Self.mentionType where keys == ["$type"]: self = .mention
    case Self.followerType where keys == ["$type"]: self = .follower
    case Self.followingType where keys == ["$type"]: self = .following
    case Self.listType where keys == ["$type", "list"]:
      if let list = raw["list"]?.stringValue { self = .list(list) } else { self = .unknown(raw) }
    default: self = .unknown(raw)
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: LexiconKey.self)
    switch self {
    case .mention: try container.encode(Self.mentionType, forKey: "$type")
    case .follower: try container.encode(Self.followerType, forKey: "$type")
    case .following: try container.encode(Self.followingType, forKey: "$type")
    case .list(let uri):
      try container.encode(Self.listType, forKey: "$type")
      try container.encode(uri, forKey: "list")
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

/// One rule of a postgate's `embeddingRules`: only `disable` (no quoting) so far.
public enum PostgateRule: Hashable, Sendable {
  case disable
  case unknown(JSONValue)

  public static let disableType = "app.bsky.feed.postgate#disableRule"
}

extension PostgateRule: Codable {
  public init(from decoder: Decoder) throws {
    let raw = try JSONValue(from: decoder)
    if raw["$type"]?.stringValue == Self.disableType, raw.objectValue?.count == 1 {
      self = .disable
    } else {
      self = .unknown(raw)
    }
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .disable:
      var container = encoder.container(keyedBy: LexiconKey.self)
      try container.encode(Self.disableType, forKey: "$type")
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

/// app.bsky.graph.defs#listPurpose's known values.
public enum ListPurpose {
  public static let modlist = "app.bsky.graph.defs#modlist"
  public static let curatelist = "app.bsky.graph.defs#curatelist"
  public static let referencelist = "app.bsky.graph.defs#referencelist"
}
