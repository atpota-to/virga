// The embeds of a post as the AppView hydrates them (app.bsky.embed.*#view):
// pictures with their CDN addresses, a video's playlist, a link card, and a
// quoted record, which may be a post, a feed, a list, a labeler, a starter
// pack, or a stand-in for one that's gone, blocked or detached.
//
// Views decode as the AppView sends them, and keep the `$type` they came
// with (`lexiconType`), since every one of them is a union member.

import Foundation

/// app.bsky.embed.images#view.
public struct ImagesEmbedView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.images#view"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var images: [EmbedViewImage]

  public init(images: [EmbedViewImage], lexiconType: String? = nil) {
    self.images = images
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case images
  }
}

/// app.bsky.embed.images#viewImage.
public struct EmbedViewImage: Codable, Hashable, Sendable {
  public var thumb: String
  public var fullsize: String
  public var alt: String
  public var aspectRatio: AspectRatio?

  public init(
    thumb: String,
    fullsize: String,
    alt: String,
    aspectRatio: AspectRatio? = nil
  ) {
    self.thumb = thumb
    self.fullsize = fullsize
    self.alt = alt
    self.aspectRatio = aspectRatio
  }
}

/// app.bsky.embed.video#view.
public struct VideoEmbedView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.video#view"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var cid: String
  public var playlist: String
  public var thumbnail: String?
  public var alt: String?
  public var aspectRatio: AspectRatio?
  public var presentation: String?

  public init(
    cid: String,
    playlist: String,
    thumbnail: String? = nil,
    alt: String? = nil,
    aspectRatio: AspectRatio? = nil,
    presentation: String? = nil,
    lexiconType: String? = nil
  ) {
    self.cid = cid
    self.playlist = playlist
    self.thumbnail = thumbnail
    self.alt = alt
    self.aspectRatio = aspectRatio
    self.presentation = presentation
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case cid, playlist, thumbnail, alt, aspectRatio, presentation
  }
}

/// app.bsky.embed.external#view.
public struct ExternalEmbedView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.external#view"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var external: EmbedViewExternal

  public init(external: EmbedViewExternal, lexiconType: String? = nil) {
    self.external = external
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case external
  }
}

/// app.bsky.embed.external#viewExternal.
public struct EmbedViewExternal: Codable, Hashable, Sendable {
  public var uri: String
  public var title: String
  public var description: String
  public var thumb: String?

  public init(uri: String, title: String, description: String, thumb: String? = nil) {
    self.uri = uri
    self.title = title
    self.description = description
    self.thumb = thumb
  }
}

/// app.bsky.embed.record#view.
public struct RecordEmbedView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.record#view"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var record: EmbeddedRecord

  public init(record: EmbeddedRecord, lexiconType: String? = nil) {
    self.record = record
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case record
  }
}

/// app.bsky.embed.recordWithMedia#view.
public struct RecordWithMediaEmbedView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.recordWithMedia#view"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var record: RecordEmbedView
  public var media: MediaEmbedView

  public init(
    record: RecordEmbedView,
    media: MediaEmbedView,
    lexiconType: String? = nil
  ) {
    self.record = record
    self.media = media
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case record, media
  }
}

/// app.bsky.embed.gallery#view: pictures as `items` (the web shows them as images).
public struct GalleryEmbedView: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.gallery#view"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var items: [GalleryViewItem]

  public init(items: [GalleryViewItem], lexiconType: String? = nil) {
    self.items = items
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case items
  }
}

/// One picture of a gallery view.
public struct GalleryViewItem: Codable, Hashable, Sendable {
  public var thumbnail: String?
  public var fullsize: String?
  public var alt: String?
  public var aspectRatio: AspectRatio?

  public init(
    thumbnail: String? = nil,
    fullsize: String? = nil,
    alt: String? = nil,
    aspectRatio: AspectRatio? = nil
  ) {
    self.thumbnail = thumbnail
    self.fullsize = fullsize
    self.alt = alt
    self.aspectRatio = aspectRatio
  }
}

/// app.bsky.embed.record#viewRecord: a quoted post. `value` is its record as JSON.
public struct ViewRecord: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.record#viewRecord"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var cid: String
  public var author: ProfileViewBasic
  public var value: JSONValue
  public var labels: [Label]?
  public var replyCount: Int?
  public var repostCount: Int?
  public var likeCount: Int?
  public var quoteCount: Int?
  public var embeds: [EmbedView]?
  public var indexedAt: String

  public init(
    uri: String,
    cid: String,
    author: ProfileViewBasic,
    value: JSONValue,
    labels: [Label]? = nil,
    replyCount: Int? = nil,
    repostCount: Int? = nil,
    likeCount: Int? = nil,
    quoteCount: Int? = nil,
    embeds: [EmbedView]? = nil,
    indexedAt: String,
    lexiconType: String? = nil
  ) {
    self.uri = uri
    self.cid = cid
    self.author = author
    self.value = value
    self.labels = labels
    self.replyCount = replyCount
    self.repostCount = repostCount
    self.likeCount = likeCount
    self.quoteCount = quoteCount
    self.embeds = embeds
    self.indexedAt = indexedAt
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, cid, author, value, labels, replyCount, repostCount, likeCount, quoteCount, embeds, indexedAt
  }
}

/// app.bsky.embed.record#viewNotFound.
public struct ViewNotFound: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.record#viewNotFound"

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

/// app.bsky.embed.record#viewBlocked.
public struct ViewBlocked: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.record#viewBlocked"

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

/// app.bsky.embed.record#viewDetached: a quote its post's author detached.
public struct ViewDetached: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.record#viewDetached"

  /// The `$type` this was read with, if any (written as a union member, it has its own).
  public var lexiconType: String?
  public var uri: String
  public var detached: Bool

  public init(uri: String, detached: Bool, lexiconType: String? = nil) {
    self.uri = uri
    self.detached = detached
    self.lexiconType = lexiconType
  }

  enum CodingKeys: String, CodingKey {
    case lexiconType = "$type"
    case uri, detached
  }
}
