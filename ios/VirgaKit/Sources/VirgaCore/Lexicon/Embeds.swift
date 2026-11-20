// The embeds a post record carries (app.bsky.embed.*): images, a video, a
// link card, a quoted record, a quoted record with media, and the newer
// gallery, which the web reads as images (src/posting/lib/embeds.js). The
// views the AppView hydrates them into are EmbedViews.swift.
//
// The structs here follow LexiconCoding.swift's rules: required fields are
// non-optional, `extra` keeps what this version doesn't read, and a union
// member keeps the `$type` it was read with (a new one carries its own).

import Foundation

/// app.bsky.embed.defs#aspectRatio: a picture's width and height, in any unit.
public struct AspectRatio: Codable, Hashable, Sendable {
  public var width: Int
  public var height: Int

  public init(width: Int, height: Int) {
    self.width = width
    self.height = height
  }
}

/// app.bsky.embed.images#image: one picture of an images embed.
public struct EmbedImage: Codable, Hashable, Sendable {
  public var image: BlobRef
  public var alt: String
  public var aspectRatio: AspectRatio?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    image: BlobRef,
    alt: String,
    aspectRatio: AspectRatio? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.image = image
    self.alt = alt
    self.aspectRatio = aspectRatio
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    image = try r.required("image")
    alt = try r.required("alt")
    aspectRatio = r.optional("aspectRatio")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(image, "image")
    try w.put(alt, "alt")
    try w.put(aspectRatio, "aspectRatio")
  }
}

/// app.bsky.embed.images: up to four pictures.
public struct ImagesEmbed: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.images"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var images: [EmbedImage]
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    images: [EmbedImage],
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.images = images
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    images = try r.required("images")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(images, "images")
  }
}

/// app.bsky.embed.video#caption: a WebVTT caption file in one language.
public struct VideoCaption: Codable, Hashable, Sendable {
  public var lang: String
  public var file: BlobRef
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(lang: String, file: BlobRef, extra: [String: JSONValue] = [:]) {
    self.lang = lang
    self.file = file
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lang = try r.required("lang")
    file = try r.required("file")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(lang, "lang")
    try w.put(file, "file")
  }
}

/// app.bsky.embed.video: one video, with its captions.
public struct VideoEmbed: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.video"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var video: BlobRef
  public var captions: [VideoCaption]?
  public var alt: String?
  public var aspectRatio: AspectRatio?
  /// 'default' or 'gif'
  public var presentation: String?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    video: BlobRef,
    captions: [VideoCaption]? = nil,
    alt: String? = nil,
    aspectRatio: AspectRatio? = nil,
    presentation: String? = nil,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.video = video
    self.captions = captions
    self.alt = alt
    self.aspectRatio = aspectRatio
    self.presentation = presentation
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    video = try r.required("video")
    captions = r.optional("captions")
    alt = r.optional("alt")
    aspectRatio = r.optional("aspectRatio")
    presentation = r.optional("presentation")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(video, "video")
    try w.put(captions, "captions")
    try w.put(alt, "alt")
    try w.put(aspectRatio, "aspectRatio")
    try w.put(presentation, "presentation")
  }
}

/// app.bsky.embed.external#external: a link card.
public struct EmbedExternal: Codable, Hashable, Sendable {
  public var uri: String
  public var title: String
  public var description: String
  public var thumb: BlobRef?
  /// Records behind the page (standard.site), as the web writes them: under
  /// `associatedRefs`, a name the lexicon doesn't have.
  public var associatedRefs: [StrongRef]?
  /// The lexicon's own field for those records (app.bsky.embed.external
  /// `associatedRecords`), as other clients write it.
  public var associatedRecords: [StrongRef]?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    uri: String,
    title: String,
    description: String,
    thumb: BlobRef? = nil,
    associatedRefs: [StrongRef]? = nil,
    associatedRecords: [StrongRef]? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.uri = uri
    self.title = title
    self.description = description
    self.thumb = thumb
    self.associatedRefs = associatedRefs
    self.associatedRecords = associatedRecords
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    uri = try r.required("uri")
    title = try r.required("title")
    description = try r.required("description")
    thumb = r.optional("thumb")
    associatedRefs = r.optional("associatedRefs")
    associatedRecords = r.optional("associatedRecords")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(uri, "uri")
    try w.put(title, "title")
    try w.put(description, "description")
    try w.put(thumb, "thumb")
    try w.put(associatedRefs, "associatedRefs")
    try w.put(associatedRecords, "associatedRecords")
  }
}

/// app.bsky.embed.external: a link card.
public struct ExternalEmbed: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.external"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var external: EmbedExternal
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    external: EmbedExternal,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.external = external
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    external = try r.required("external")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(external, "external")
  }
}

/// app.bsky.embed.record: a quoted post, or an embedded feed, list or starter pack.
public struct RecordEmbed: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.record"

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

/// app.bsky.embed.recordWithMedia: a quoted record and media together.
public struct RecordWithMediaEmbed: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.recordWithMedia"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var record: RecordEmbed
  public var media: MediaEmbed
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    record: RecordEmbed,
    media: MediaEmbed,
    lexiconType: String? = Self.type,
    extra: [String: JSONValue] = [:]
  ) {
    self.record = record
    self.media = media
    self.lexiconType = lexiconType
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    lexiconType = r.type
    record = try r.required("record")
    media = try r.required("media")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: lexiconType, extra: extra)
    try w.put(record, "record")
    try w.put(media, "media")
  }
}

/// One picture of a gallery.
public struct GalleryItem: Codable, Hashable, Sendable {
  public var image: BlobRef
  public var alt: String?
  public var aspectRatio: AspectRatio?
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    image: BlobRef,
    alt: String? = nil,
    aspectRatio: AspectRatio? = nil,
    extra: [String: JSONValue] = [:]
  ) {
    self.image = image
    self.alt = alt
    self.aspectRatio = aspectRatio
    self.extra = extra
  }

  public init(from decoder: Decoder) throws {
    var r = try LexiconReader(decoder)
    image = try r.required("image")
    alt = r.optional("alt")
    aspectRatio = r.optional("aspectRatio")
    extra = try r.extra()
  }

  public func encode(to encoder: Encoder) throws {
    var w = try LexiconWriter(encoder, type: nil, extra: extra)
    try w.put(image, "image")
    try w.put(alt, "alt")
    try w.put(aspectRatio, "aspectRatio")
  }
}

/// app.bsky.embed.gallery: pictures as `items`, which the web rewrites as
/// an images embed to show (embeds.js normalizeImageEmbed).
public struct GalleryEmbed: LexiconTypedObject, Hashable, Sendable {
  public static let type = "app.bsky.embed.gallery"

  /// The `$type` this was read with (a new one has its own).
  public var lexiconType: String?
  public var items: [GalleryItem]
  /// Fields this version doesn't read, kept for the round trip.
  public var extra: [String: JSONValue]

  public init(
    items: [GalleryItem],
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
