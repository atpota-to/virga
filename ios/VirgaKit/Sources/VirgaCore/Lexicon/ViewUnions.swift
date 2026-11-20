// The unions of the AppView's views and of a PDS's answers: a post's
// hydrated embed and its media, the record a quote embeds, a post or the
// stand-in for one that's gone or blocked, why a post is in a feed, a node
// of a thread, a relationship, an account preference, and applyWrites'
// writes and results. Each is decided by `$type`, keeps a member it doesn't
// know (or can't read) as JSON, and writes its member with its `$type`.
//
// The view unions are `indirect`: views nest each other (a quoted post's
// author can have a status with an embed of its own).

import Foundation

/// The member of a union `decoder` holds, by its `$type`.
private func decodeMember<U>(
  _ decoder: Decoder, _ members: [String: (Decoder) throws -> U?], unknown: (JSONValue) -> U
) throws -> U {
  if let type = Lexicon.type(in: decoder), let decode = members[type], let value = try decode(decoder) {
    return value
  }
  return unknown(try JSONValue(from: decoder))
}

/// A member decoder for `members`: the value, or nil when it isn't a `T`.
private func member<T: Decodable, U>(_ type: T.Type, _ wrap: @escaping (T) -> U) -> (Decoder) throws -> U? {
  { decoder in (try? T(from: decoder)).map(wrap) }
}

// MARK: - Embeds

/// A post's embed as the AppView hydrates it (PostView.embed, ViewRecord.embeds).
public indirect enum EmbedView: Hashable, Sendable {
  case images(ImagesEmbedView)
  case video(VideoEmbedView)
  case external(ExternalEmbedView)
  case record(RecordEmbedView)
  case recordWithMedia(RecordWithMediaEmbedView)
  case gallery(GalleryEmbedView)
  case unknown(JSONValue)
}

extension EmbedView: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        ImagesEmbedView.type: member(ImagesEmbedView.self, Self.images),
        VideoEmbedView.type: member(VideoEmbedView.self, Self.video),
        ExternalEmbedView.type: member(ExternalEmbedView.self, Self.external),
        RecordEmbedView.type: member(RecordEmbedView.self, Self.record),
        RecordWithMediaEmbedView.type: member(RecordWithMediaEmbedView.self, Self.recordWithMedia),
        GalleryEmbedView.type: member(GalleryEmbedView.self, Self.gallery),
      ], unknown: Self.unknown)
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

/// The media of a recordWithMedia view.
public indirect enum MediaEmbedView: Hashable, Sendable {
  case images(ImagesEmbedView)
  case video(VideoEmbedView)
  case external(ExternalEmbedView)
  case gallery(GalleryEmbedView)
  case unknown(JSONValue)
}

extension MediaEmbedView: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        ImagesEmbedView.type: member(ImagesEmbedView.self, Self.images),
        VideoEmbedView.type: member(VideoEmbedView.self, Self.video),
        ExternalEmbedView.type: member(ExternalEmbedView.self, Self.external),
        GalleryEmbedView.type: member(GalleryEmbedView.self, Self.gallery),
      ], unknown: Self.unknown)
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

/// What a record embed holds once hydrated (app.bsky.embed.record#view's `record`).
public indirect enum EmbeddedRecord: Hashable, Sendable {
  case post(ViewRecord)
  case notFound(ViewNotFound)
  case blocked(ViewBlocked)
  case detached(ViewDetached)
  case generator(GeneratorView)
  case list(ListView)
  case labeler(LabelerView)
  case starterPack(StarterPackViewBasic)
  case unknown(JSONValue)
}

extension EmbeddedRecord: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        ViewRecord.type: member(ViewRecord.self, Self.post),
        ViewNotFound.type: member(ViewNotFound.self, Self.notFound),
        ViewBlocked.type: member(ViewBlocked.self, Self.blocked),
        ViewDetached.type: member(ViewDetached.self, Self.detached),
        GeneratorView.type: member(GeneratorView.self, Self.generator),
        ListView.type: member(ListView.self, Self.list),
        LabelerView.type: member(LabelerView.self, Self.labeler),
        StarterPackViewBasic.type: member(StarterPackViewBasic.self, Self.starterPack),
      ], unknown: Self.unknown)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .post(let v): try Lexicon.encodeMember(v, to: encoder)
    case .notFound(let v): try Lexicon.encodeMember(v, to: encoder)
    case .blocked(let v): try Lexicon.encodeMember(v, to: encoder)
    case .detached(let v): try Lexicon.encodeMember(v, to: encoder)
    case .generator(let v): try Lexicon.encodeMember(v, to: encoder)
    case .list(let v): try Lexicon.encodeMember(v, to: encoder)
    case .labeler(let v): try Lexicon.encodeMember(v, to: encoder)
    case .starterPack(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

// MARK: - Posts and threads

/// A post, or the stand-in for one that's gone or behind a block (a feed
/// entry's reply root and parent, a bookmark's item).
public indirect enum PostOrUnavailable: Hashable, Sendable {
  case post(PostView)
  case notFound(NotFoundPost)
  case blocked(BlockedPost)
  case unknown(JSONValue)

  /// The post's URI, whichever it is.
  public var uri: String? {
    switch self {
    case .post(let v): return v.uri
    case .notFound(let v): return v.uri
    case .blocked(let v): return v.uri
    case .unknown(let raw): return raw["uri"]?.stringValue
    }
  }

  /// The post, when there is one.
  public var postView: PostView? {
    if case .post(let v) = self { return v }
    return nil
  }
}

extension PostOrUnavailable: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        PostView.type: member(PostView.self, Self.post),
        NotFoundPost.type: member(NotFoundPost.self, Self.notFound),
        BlockedPost.type: member(BlockedPost.self, Self.blocked),
      ], unknown: Self.unknown)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .post(let v): try Lexicon.encodeMember(v, to: encoder)
    case .notFound(let v): try Lexicon.encodeMember(v, to: encoder)
    case .blocked(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

/// Why a post is in a feed: someone reposted it, or it's pinned.
public indirect enum FeedReason: Hashable, Sendable {
  case repost(ReasonRepost)
  case pin(ReasonPin)
  case unknown(JSONValue)
}

extension FeedReason: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        ReasonRepost.type: member(ReasonRepost.self, Self.repost),
        ReasonPin.type: member(ReasonPin.self, Self.pin),
      ], unknown: Self.unknown)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .repost(let v): try Lexicon.encodeMember(v, to: encoder)
    case .pin(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

/// A node of a thread: a post with its parent and replies, or a stand-in.
public indirect enum ThreadNode: Hashable, Sendable {
  case post(ThreadViewPost)
  case notFound(NotFoundPost)
  case blocked(BlockedPost)
  case unknown(JSONValue)

  /// The post, when there is one.
  public var threadViewPost: ThreadViewPost? {
    if case .post(let v) = self { return v }
    return nil
  }
}

extension ThreadNode: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        ThreadViewPost.type: member(ThreadViewPost.self, Self.post),
        NotFoundPost.type: member(NotFoundPost.self, Self.notFound),
        BlockedPost.type: member(BlockedPost.self, Self.blocked),
      ], unknown: Self.unknown)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .post(let v): try Lexicon.encodeMember(v, to: encoder)
    case .notFound(let v): try Lexicon.encodeMember(v, to: encoder)
    case .blocked(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

// MARK: - Graph

/// One answer of getRelationships.
public enum RelationshipResult: Hashable, Sendable {
  case relationship(Relationship)
  case notFound(NotFoundActor)
  case unknown(JSONValue)
}

extension RelationshipResult: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        Relationship.type: member(Relationship.self, Self.relationship),
        NotFoundActor.type: member(NotFoundActor.self, Self.notFound),
      ], unknown: Self.unknown)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .relationship(let v): try Lexicon.encodeMember(v, to: encoder)
    case .notFound(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

// MARK: - Preferences

/// One of an account's preferences (app.bsky.actor.defs#preferences).
public enum ActorPreference: Hashable, Sendable {
  case postInteractionSettings(PostInteractionSettingsPref)
  case savedFeedsV2(SavedFeedsPrefV2)
  case savedFeeds(SavedFeedsPref)
  case unknown(JSONValue)
}

extension ActorPreference: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        PostInteractionSettingsPref.type: member(PostInteractionSettingsPref.self, Self.postInteractionSettings),
        SavedFeedsPrefV2.type: member(SavedFeedsPrefV2.self, Self.savedFeedsV2),
        SavedFeedsPref.type: member(SavedFeedsPref.self, Self.savedFeeds),
      ], unknown: Self.unknown)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .postInteractionSettings(let v): try Lexicon.encodeMember(v, to: encoder)
    case .savedFeedsV2(let v): try Lexicon.encodeMember(v, to: encoder)
    case .savedFeeds(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

// MARK: - applyWrites

/// One write of com.atproto.repo.applyWrites.
public enum ApplyWritesOperation: Hashable, Sendable {
  case create(ApplyWritesCreate)
  case update(ApplyWritesUpdate)
  case delete(ApplyWritesDelete)
  case unknown(JSONValue)
}

extension ApplyWritesOperation: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        ApplyWritesCreate.type: member(ApplyWritesCreate.self, Self.create),
        ApplyWritesUpdate.type: member(ApplyWritesUpdate.self, Self.update),
        ApplyWritesDelete.type: member(ApplyWritesDelete.self, Self.delete),
      ], unknown: Self.unknown)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .create(let v): try Lexicon.encodeMember(v, to: encoder)
    case .update(let v): try Lexicon.encodeMember(v, to: encoder)
    case .delete(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}

/// One result of com.atproto.repo.applyWrites.
public enum ApplyWritesResult: Hashable, Sendable {
  case create(ApplyWritesCreateResult)
  case update(ApplyWritesUpdateResult)
  case delete(ApplyWritesDeleteResult)
  case unknown(JSONValue)
}

extension ApplyWritesResult: Codable {
  public init(from decoder: Decoder) throws {
    self = try decodeMember(
      decoder,
      [
        ApplyWritesCreateResult.type: member(ApplyWritesCreateResult.self, Self.create),
        ApplyWritesUpdateResult.type: member(ApplyWritesUpdateResult.self, Self.update),
        ApplyWritesDeleteResult.type: member(ApplyWritesDeleteResult.self, Self.delete),
      ], unknown: Self.unknown)
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .create(let v): try Lexicon.encodeMember(v, to: encoder)
    case .update(let v): try Lexicon.encodeMember(v, to: encoder)
    case .delete(let v): try Lexicon.encodeMember(v, to: encoder)
    case .unknown(let raw): try raw.encode(to: encoder)
    }
  }
}
