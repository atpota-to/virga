// Ports src/posting/lib/postLink.js
//
// Links to records that a post can embed: posts, feeds, lists and starter
// packs, written as bsky.app links, aturi.to links or at:// URIs. Pure: an
// actor that is a handle comes back as a handle, and the caller resolves it.

import Foundation
import VirgaCore

/// A link to an embeddable record, read into its parts. `uri` is set only
/// when the actor is a DID (a handle has to be resolved first).
public struct RecordLink: Codable, Hashable, Sendable {
  public var kind: String
  public var collection: String
  public var actor: String
  public var did: String?
  public var handle: String?
  public var rkey: String
  public var url: String
  public var uri: String?
}

/// A link to a post: `{ actor, did?, handle?, rkey }`.
public struct PostLinkRef: Codable, Hashable, Sendable {
  public var actor: String
  public var did: String?
  public var handle: String?
  public var rkey: String
}

/// The record a URI names: `{ kind, did, collection, rkey }`.
public struct RecordURIParts: Codable, Hashable, Sendable {
  public var kind: String
  public var did: String
  public var collection: String
  public var rkey: String
}

/// The facet detector's view of a record link: `linkType` plus `postId`,
/// `feedId`, `listId` or `packId`.
public struct DetectedPostLink: Codable, Hashable, Sendable {
  public var type: String
  public var linkType: String
  public var handle: String
  public var postId: String?
  public var feedId: String?
  public var listId: String?
  public var packId: String?
  public var url: String

  /// The record key, whichever kind it is.
  public var rkey: String { postId ?? feedId ?? listId ?? packId ?? "" }
}

public struct PostLinkError: Error, LocalizedError, Hashable, Sendable {
  public let message: String
  public var errorDescription: String? { message }
}

public enum PostLink {
  /// The collection each embeddable kind lives in.
  public static let recordCollections: [String: String] = [
    "post": "app.bsky.feed.post",
    "feed": "app.bsky.feed.generator",
    "list": "app.bsky.graph.list",
    "starterpack": "app.bsky.graph.starterpack",
  ]

  static let kindByCollection = Dictionary(uniqueKeysWithValues: recordCollections.map { ($1, $0) })

  /// The embeddable kind a collection holds, or nil.
  public static func kindForCollection(_ collection: String?) -> String? {
    collection.flatMap { kindByCollection[$0] }
  }

  // The bsky.app path segment each kind lives under.
  static let bskySegment = ["post": "post", "feed": "feed", "list": "lists"]
  static let segmentKind = ["post": "post", "feed": "feed", "lists": "list"]

  // Only the bare host and www.: a subdomain is not bsky.app, and the record
  // must be the path's own. The web's `/i` is written as explicit classes.
  static let bskyProfileRecord = JSRegex(
    #"^[hH][tT][tT][pP][sS]?://(?:[wW][wW][wW]\.)?[bB][sS][kK][yY]\.[aA][pP][pP]/[pP][rR][oO][fF][iI][lL][eE]/([^/?#]+)/([pP][oO][sS][tT]|[fF][eE][eE][dD]|[lL][iI][sS][tT][sS])/([^/?#]+)"#
  )
  static let bskyStarterPack = JSRegex(
    #"^[hH][tT][tT][pP][sS]?://(?:[wW][wW][wW]\.)?[bB][sS][kK][yY]\.[aA][pP][pP]/(?:[sS][tT][aA][rR][tT][eE][rR]-[pP][aA][cC][kK]|[sS][tT][aA][rR][tT])/([^/?#]+)/([^/?#]+)"#
  )
  static let waypoint = JSRegex(
    #"^[hH][tT][tT][pP][sS]?://(?:[wW][wW][wW]\.)?[aA][tT][uU][rR][iI]\.[tT][oO]/([^/?#]+)/([^/?#]+)/([^/?#]+)"#)
  static let atUri = JSRegex(#"^at://([^/?#]+)/([^/?#]+)/([^/?#]+)/?\z"#)

  static func decodeSegment(_ segment: String) -> String {
    (try? URIComponent.decodeURIComponent(segment)) ?? segment
  }

  static func result(_ kind: String, _ actor: String, _ rkey: String, _ url: String) -> RecordLink {
    let cleanActor = decodeSegment(actor)
    let collection = recordCollections[kind]!
    var out = RecordLink(
      kind: kind, collection: collection, actor: cleanActor, did: nil, handle: nil,
      rkey: decodeSegment(rkey), url: url, uri: nil)
    if PostingJS.hasPrefix(cleanActor, "did:") {
      out.did = cleanActor
      out.uri = "at://\(cleanActor)/\(collection)/\(out.rkey)"
    } else {
      var handle = cleanActor
      if handle.utf16.first == 0x40 { handle = String(handle.unicodeScalars.dropFirst()) }
      out.handle = PostingJS.toLowerCase(handle)
    }
    return out
  }

  static func groups(_ regex: JSRegex, _ text: String) -> [String]? {
    guard let match = regex.firstMatch(in: text) else { return nil }
    let units = Array(text.utf16)
    return (1...match.groups.count).map { match.group($0, in: units) ?? "" }
  }

  /// A link to an embeddable record, read into its parts, or nil for anything
  /// else (non-strings included: pass nil).
  public static func parseRecordLink(_ input: String?) -> RecordLink? {
    guard let input else { return nil }
    let url = input.jsTrimmed()
    if url.isEmpty { return nil }

    if let m = groups(atUri, url) {
      guard let kind = kindForCollection(m[1]) else { return nil }
      return result(kind, m[0], m[2], url)
    }
    if let m = groups(bskyProfileRecord, url) {
      return result(segmentKind[m[1].lowercased()]!, m[0], m[2], url)
    }
    if let m = groups(bskyStarterPack, url) {
      return result("starterpack", m[0], m[1], url)
    }
    if let m = groups(waypoint, url) {
      guard let kind = kindForCollection(m[1]) else { return nil }
      return result(kind, m[0], m[2], url)
    }
    return nil
  }

  /// A link to a post, or nil when the input isn't a post link.
  public static func parsePostLink(_ url: String?) -> PostLinkRef? {
    guard let parsed = parseRecordLink(url), parsed.kind == "post" else { return nil }
    var out = PostLinkRef(actor: parsed.actor, did: nil, handle: nil, rkey: parsed.rkey)
    if let did = parsed.did { out.did = did } else { out.handle = parsed.handle }
    return out
  }

  /// `at://<did>/<collection>/<rkey>` for a kind.
  public static func recordUri(_ did: String, _ kind: String, _ rkey: String) throws -> String {
    guard let collection = recordCollections[kind] else {
      throw PostLinkError(message: "Not an embeddable kind: \(kind)")
    }
    return "at://\(did)/\(collection)/\(rkey)"
  }

  /// The record a `uri` names, if it is an embeddable kind.
  public static func parseRecordUri(_ uri: String?) -> RecordURIParts? {
    guard let uri, let m = groups(atUri, uri), let kind = kindForCollection(m[1]) else { return nil }
    return RecordURIParts(kind: kind, did: m[0], collection: m[1], rkey: m[2])
  }

  /// The bsky.app page for a record URI, or nil for a kind bsky.app has no
  /// page for. `actor` (a handle) reads better than the DID when known.
  public static func bskyUrlFor(_ uri: String?, _ actor: String? = nil) -> String? {
    guard let parsed = parseRecordUri(uri) else { return nil }
    let who = URIComponent.encodeURIComponent((actor?.isEmpty == false ? actor : nil) ?? parsed.did)
    if parsed.kind == "starterpack" {
      return "https://bsky.app/starter-pack/\(who)/\(parsed.rkey)"
    }
    return "https://bsky.app/profile/\(who)/\(bskySegment[parsed.kind]!)/\(parsed.rkey)"
  }

  /// The facet detector's view of a link: what kind of record it embeds, or
  /// nil for anything that isn't a record link (at:// URIs included: they
  /// aren't links in post text).
  public static func detectPostLink(_ url: String?) -> DetectedPostLink? {
    guard let parsed = parseRecordLink(url), !PostingJS.hasPrefix(parsed.url, "at://") else { return nil }
    var out = DetectedPostLink(type: "bluesky", linkType: parsed.kind, handle: parsed.actor, url: parsed.url)
    switch parsed.kind {
    case "post": out.postId = parsed.rkey
    case "feed": out.feedId = parsed.rkey
    case "list": out.listId = parsed.rkey
    default: out.packId = parsed.rkey
    }
    return out
  }
}
