// AT-URIs (`at://<repo>/<collection>/<rkey>`), read with the leniency the
// web app reads them with. The web has no one parser: each module matches
// its own regular expression, and they differ at the edges (a trailing
// slash, a query, a `?` inside the repo). Each reading here is one of those
// expressions exactly, named for what it allows, so a port picks the one
// its web module uses:
//
//   AtUri(_:)            ^at:\/\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/?$
//                        a record, and nothing else (src/posting/lib/postLink.js)
//   AtUri.parseExact     ^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$
//                        (src/posting/library/sources.js, library/model.js)
//   AtUri.parsePrefix    ^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)
//                        a record at the start, anything after it ignored
//                        (src/lib/atproto.js rkeyFromAtUri, lib/analyticsSync.js)
//   AtUri.authority(of:) ^at:\/\/([^/]+)\/  (composer/gatesModel.js, library/model.js)
//   AtUri.did(of:)       ^at:\/\/(did:[^/]+)  (src/lib/analytics.js didFromAtUri)
//
// All of them match code unit by code unit as JavaScript does, and are
// case-sensitive (`AT://` is not an AT-URI). ios/parity/cases/core.identity.js
// holds them to the web functions that use them.

import Foundation

public struct AtUri: Hashable, Sendable, CustomStringConvertible {
  /// The repo: a DID, or a handle where the URI was written with one.
  public var authority: String
  public var collection: String
  public var rkey: String

  public init(authority: String, collection: String, rkey: String) {
    self.authority = authority
    self.collection = collection
    self.rkey = rkey
  }

  /// `at://<authority>/<collection>/<rkey>`, as the web writes it with a
  /// template string.
  public var description: String { "at://\(authority)/\(collection)/\(rkey)" }

  /// The URI as a string (the same as `description`).
  public var string: String { description }

  /// The record a URI names, reading only a record URI: three segments,
  /// none holding `/`, `?` or `#`, and at most a trailing slash after them
  /// (postLink.js `AT_URI`).
  public init?(_ string: String) {
    guard let rest = Self.afterScheme(string) else { return nil }
    var segments = rest.split(separator: 0x2F, omittingEmptySubsequences: false).map(Array.init)
    if segments.count == 4, segments[3].isEmpty { segments.removeLast() }
    guard segments.count == 3, segments.allSatisfy({ !$0.isEmpty && !$0.contains(where: Self.isQueryOrFragment) }) else {
      return nil
    }
    self.init(authority: String(jsUnits: segments[0]), collection: String(jsUnits: segments[1]), rkey: String(jsUnits: segments[2]))
  }

  /// `^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$`: three segments, the last with
  /// no `?` or `#`, nothing after it.
  public static func parseExact(_ string: String) -> AtUri? {
    guard let rest = afterScheme(string) else { return nil }
    let segments = rest.split(separator: 0x2F, omittingEmptySubsequences: false)
    guard segments.count == 3, segments.allSatisfy({ !$0.isEmpty }), !segments[2].contains(where: isQueryOrFragment) else {
      return nil
    }
    return AtUri(
      authority: String(jsUnits: segments[0]), collection: String(jsUnits: segments[1]), rkey: String(jsUnits: segments[2]))
  }

  /// `^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)`: a record at the start, its key
  /// running to the first `/`, `?` or `#`, and anything after that ignored.
  public static func parsePrefix(_ string: String) -> AtUri? {
    guard let rest = afterScheme(string) else { return nil }
    guard let firstSlash = rest.firstIndex(of: 0x2F), firstSlash > 0 else { return nil }
    let afterAuthority = rest[(firstSlash + 1)...]
    guard let secondSlash = afterAuthority.firstIndex(of: 0x2F), secondSlash > afterAuthority.startIndex else { return nil }
    let keyStart = secondSlash + 1
    var keyEnd = keyStart
    while keyEnd < rest.count, rest[keyEnd] != 0x2F, !isQueryOrFragment(rest[keyEnd]) { keyEnd += 1 }
    guard keyEnd > keyStart else { return nil }
    return AtUri(
      authority: String(jsUnits: rest[..<firstSlash]),
      collection: String(jsUnits: rest[(firstSlash + 1)..<secondSlash]),
      rkey: String(jsUnits: rest[keyStart..<keyEnd]))
  }

  /// The repo of any URI with a path: `^at:\/\/([^/]+)\/`.
  public static func authority(of string: String?) -> String? {
    guard let string, let rest = afterScheme(string) else { return nil }
    guard let slash = rest.firstIndex(of: 0x2F), slash > 0 else { return nil }
    return String(jsUnits: rest[..<slash])
  }

  /// The DID a URI starts with: `^at:\/\/(did:[^/]+)` (analytics.js
  /// `didFromAtUri`). Nil when the repo isn't written as a DID.
  public static func did(of string: String?) -> String? {
    guard let string, let rest = afterScheme(string) else { return nil }
    let prefix = Array("did:".utf16)
    guard rest.count > prefix.count, Array(rest[0..<prefix.count]) == prefix else { return nil }
    let end = rest.firstIndex(of: 0x2F) ?? rest.count
    guard end > prefix.count else { return nil }
    return String(jsUnits: rest[..<end])
  }

  /// The record key of a URI, read as `parsePrefix` reads it (atproto.js
  /// `rkeyFromAtUri`).
  public static func rkey(of string: String?) -> String? {
    guard let string, !string.isEmpty else { return nil }
    return parsePrefix(string)?.rkey
  }

  /// The collection of a URI read as `parseExact` reads it (library/model.js
  /// `collectionOf`).
  public static func collection(of string: String?) -> String? {
    guard let string else { return nil }
    return parseExact(string)?.collection
  }

  static func isQueryOrFragment(_ unit: UInt16) -> Bool { unit == 0x3F || unit == 0x23 }

  /// The code units after `at://`, or nil when the string doesn't start with it.
  static func afterScheme(_ string: String) -> [UInt16]? {
    let units = Array(string.utf16)
    let scheme = Array("at://".utf16)
    guard units.count >= scheme.count, Array(units[0..<scheme.count]) == scheme else { return nil }
    return Array(units[scheme.count...])
  }
}

extension AtUri: Codable {
  /// Encoded as its string, as the lexicons write an at-uri.
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    let text = try container.decode(String.self)
    guard let parsed = AtUri(text) ?? AtUri.parsePrefix(text) else {
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an AT-URI: \(text)")
    }
    self = parsed
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(description)
  }
}
