// app.bsky.richtext.facet and the small shared lexicon types around it.
// Defined here, in VirgaCore, because the archive, the composer, templates
// and Defense all read or write them. Encoded exactly as the web app writes
// them (src/posting/lib/facets.js), `$type` included.

import Foundation

/// A byte range in a post's UTF-8 text: [byteStart, byteEnd).
public struct ByteSlice: Codable, Hashable, Sendable {
  public var byteStart: Int
  public var byteEnd: Int

  public init(byteStart: Int, byteEnd: Int) {
    self.byteStart = byteStart
    self.byteEnd = byteEnd
  }
}

/// One feature of a facet: a mention, a link or a tag. Unknown features are
/// kept as JSON so a record read from elsewhere survives a round trip.
public enum FacetFeature: Hashable, Sendable {
  case mention(did: String)
  case link(uri: String)
  case tag(tag: String)
  case unknown(JSONValue)

  public static let mentionType = "app.bsky.richtext.facet#mention"
  public static let linkType = "app.bsky.richtext.facet#link"
  public static let tagType = "app.bsky.richtext.facet#tag"
}

extension FacetFeature: Codable {
  private enum CodingKeys: String, CodingKey {
    case type = "$type"
    case did, uri, tag
  }

  public init(from decoder: Decoder) throws {
    let raw = try JSONValue(from: decoder)
    let type = raw["$type"]?.stringValue
    switch type {
    case Self.mentionType:
      if let did = raw["did"]?.stringValue { self = .mention(did: did); return }
    case Self.linkType:
      if let uri = raw["uri"]?.stringValue { self = .link(uri: uri); return }
    case Self.tagType:
      if let tag = raw["tag"]?.stringValue { self = .tag(tag: tag); return }
    default:
      break
    }
    self = .unknown(raw)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .mention(let did):
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(Self.mentionType, forKey: .type)
      try container.encode(did, forKey: .did)
    case .link(let uri):
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(Self.linkType, forKey: .type)
      try container.encode(uri, forKey: .uri)
    case .tag(let tag):
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(Self.tagType, forKey: .type)
      try container.encode(tag, forKey: .tag)
    case .unknown(let raw):
      try raw.encode(to: encoder)
    }
  }
}

/// app.bsky.richtext.facet: a byte range and what it means.
public struct Facet: Codable, Hashable, Sendable {
  public static let type = "app.bsky.richtext.facet"

  public var index: ByteSlice
  public var features: [FacetFeature]

  public init(index: ByteSlice, features: [FacetFeature]) {
    self.index = index
    self.features = features
  }

  public init(byteStart: Int, byteEnd: Int, feature: FacetFeature) {
    self.init(index: ByteSlice(byteStart: byteStart, byteEnd: byteEnd), features: [feature])
  }

  private enum CodingKeys: String, CodingKey {
    case type = "$type"
    case index, features
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    index = try container.decode(ByteSlice.self, forKey: .index)
    features = try container.decodeIfPresent([FacetFeature].self, forKey: .features) ?? []
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(Self.type, forKey: .type)
    try container.encode(features, forKey: .features)
    try container.encode(index, forKey: .index)
  }
}

/// com.atproto.repo.strongRef: a record's AT-URI and CID.
public struct StrongRef: Codable, Hashable, Sendable {
  public var uri: String
  public var cid: String

  public init(uri: String, cid: String) {
    self.uri = uri
    self.cid = cid
  }
}

/// A blob reference as a record carries it:
/// `{ $type: 'blob', ref: { $link }, mimeType, size }`.
public struct BlobRef: Codable, Hashable, Sendable {
  public struct Link: Codable, Hashable, Sendable {
    public var link: String
    public init(link: String) { self.link = link }
    private enum CodingKeys: String, CodingKey { case link = "$link" }
  }

  public var ref: Link
  public var mimeType: String
  public var size: Int

  public init(cid: String, mimeType: String, size: Int) {
    self.ref = Link(link: cid)
    self.mimeType = mimeType
    self.size = size
  }

  public var cid: String { ref.link }

  private enum CodingKeys: String, CodingKey {
    case type = "$type"
    case ref, mimeType, size
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    ref = try container.decode(Link.self, forKey: .ref)
    mimeType = try container.decode(String.self, forKey: .mimeType)
    size = try container.decode(Int.self, forKey: .size)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode("blob", forKey: .type)
    try container.encode(ref, forKey: .ref)
    try container.encode(mimeType, forKey: .mimeType)
    try container.encode(size, forKey: .size)
  }
}

/// com.atproto.label.defs#selfLabels.
public struct SelfLabels: Codable, Hashable, Sendable {
  public static let type = "com.atproto.label.defs#selfLabels"

  public struct Value: Codable, Hashable, Sendable {
    public var val: String
    public init(val: String) { self.val = val }
  }

  public var values: [Value]

  public init(values: [String]) {
    self.values = values.map(Value.init(val:))
  }

  private enum CodingKeys: String, CodingKey {
    case type = "$type"
    case values
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    values = try container.decodeIfPresent([Value].self, forKey: .values) ?? []
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(Self.type, forKey: .type)
    try container.encode(values, forKey: .values)
  }
}
