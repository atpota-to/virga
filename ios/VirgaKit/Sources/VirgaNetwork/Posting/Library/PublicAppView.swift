// Ports src/posting/library/sources.js (publicXrpc, getPosts, resolveHandle,
// chunk and GET_POSTS_MAX: the public AppView reads other modules import)
//
// The rest of sources.js (the library's shelves, the link and record
// lookups) is the library's, in VirgaPosting; it calls these. The enum is
// named for what it reads rather than `Sources`, which the library keeps
// for its own port.

import Foundation
import VirgaCore

/// A public AppView read that failed: the AppView's `message` (or `HTTP
/// <status> from <nsid>`), its `status`, and its `error` name, so "gone"
/// can be told from "couldn't read".
public struct PublicXrpcError: Error, Sendable, Hashable, LocalizedError {
  public var message: String
  public var status: Int
  /// The AppView's error name (`NotFound`), or nil.
  public var error: JSONValue?
  public var errorDescription: String? { message }
}

/// What getPosts read: the post views, how many URIs weren't read (their
/// chunk failed), and the last failure.
public struct GetPostsResult: Sendable {
  public var views: [JSONValue]
  public var failed: Int
  public var error: (any Error)?

  /// The web's object, with the error as its message, for a fixture.
  public var json: JSONValue {
    [
      "views": .array(views), "failed": .number(Double(failed)),
      "error": error.map { .string(jsMessage($0)) } ?? .null,
    ]
  }
}

public enum PublicAppView {
  /// getPosts takes at most this many URIs a call.
  public static let getPostsMax = 25
  static let requestTimeoutMs: Double = 15_000

  /// `chunk(list, size)`.
  public static func chunk<T>(_ list: [T], _ size: Int = getPostsMax) -> [[T]] {
    guard size > 0 else { return list.isEmpty ? [] : [list] }
    return stride(from: 0, to: list.count, by: size).map { Array(list[$0..<min($0 + size, list.count)]) }
  }

  /// `publicXrpc(nsid, params, { appview })`: a public AppView read, to the
  /// answer's body. Arrays become repeated keys; nil and null are left out.
  /// A failure throws PublicXrpcError.
  public static func publicXrpc(
    _ nsid: String,
    _ params: QueryParams = [:],
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport
  ) async throws -> JSONValue {
    var pairs: [(String, String)] = []
    for item in params.items {
      guard let value = item.value, !value.isNull else { continue }
      if case .array(let values) = value {
        for element in values { pairs.append((item.name, element.jsString)) }
      } else {
        pairs.append((item.name, value.jsString))
      }
    }
    let response = try await transport.send(
      HTTPRequest(url: "\(appview)/xrpc/\(nsid)?\(JSURI.searchParams(pairs))", timeoutMs: requestTimeoutMs))
    if !response.ok {
      let body = response.jsonOrNull()
      let message = body?["message"].flatMap { $0.isTruthy ? $0.jsString : nil } ?? "HTTP \(response.status) from \(nsid)"
      throw PublicXrpcError(message: message, status: response.status, error: body?["error"].truthy)
    }
    return try response.json()
  }

  /// `getPosts(uris)`: post views for `uris`, read in chunks of 25 side by
  /// side, in chunk order. A chunk that couldn't be read is counted in
  /// `failed`, so a caller can tell posts that are gone from posts that
  /// weren't read.
  public static func getPosts(_ uris: [String?]?, transport: any HTTPTransport = HTTP.transport) async -> GetPostsResult {
    // `[...new Set(uris.filter(…))]`: by code unit.
    var unique: [String] = []
    var seen = Set<JSKey>()
    for uri in uris ?? [] {
      guard let uri, !uri.isEmpty, seen.insert(JSKey(uri)).inserted else { continue }
      unique.append(uri)
    }
    let parts = chunk(unique)
    let pages = await withTaskGroup(of: (Int, Result<JSONValue, any Error>).self) { group in
      for (index, part) in parts.enumerated() {
        group.addTask {
          do {
            let body = try await publicXrpc("app.bsky.feed.getPosts", ["uris": .array(part.map(JSONValue.string))], transport: transport)
            return (index, .success(body))
          } catch {
            return (index, .failure(error))
          }
        }
      }
      var out: [(Int, Result<JSONValue, any Error>)] = []
      for await page in group { out.append(page) }
      return out.sorted { $0.0 < $1.0 }
    }
    var views: [JSONValue] = []
    var failed = 0
    var lastError: (any Error)?
    for (index, page) in pages {
      switch page {
      case .success(let body):
        // `body?.posts || []`, then flattened one level.
        let posts = body["posts"].truthy ?? .array([])
        if case .array(let items) = posts { views.append(contentsOf: items) } else { views.append(posts) }
      case .failure(let error):
        failed += parts[index].count
        lastError = error
      }
    }
    return GetPostsResult(views: views, failed: failed, error: lastError)
  }

  /// `resolveHandle(handle)`: a handle's DID from the public AppView, or nil
  /// (for an empty handle, a failure, or an answer without a DID).
  public static func resolveHandle(_ handle: String?, transport: any HTTPTransport = HTTP.transport) async -> String? {
    var text = handle ?? ""
    if text.utf16.first == 0x40 { text = String(jsUnits: Array(text.utf16.dropFirst())) }
    let clean = text.jsTrimmed().jsLowercased()
    if clean.isEmpty { return nil }
    guard let body = try? await publicXrpc("com.atproto.identity.resolveHandle", ["handle": .string(clean)], transport: transport)
    else { return nil }
    return body["did"]?.stringValue
  }
}
