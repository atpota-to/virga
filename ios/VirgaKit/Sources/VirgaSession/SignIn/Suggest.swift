// Ports src/signin/suggest.js
//
// Suggestions under the handle field: accounts whose handle or name starts
// with what has been typed, from Bluesky's public search. What is typed there
// goes to that API as it is typed (after a pause), which the Privacy Policy
// says; nothing is sent for one character, for a DID or for an address.

import Foundation
import VirgaCore
import VirgaNetwork

/// One suggestion: `{ did, handle, displayName, avatar }`.
public struct SignInSuggestion: Sendable, Hashable, Codable, AccountLike {
  public var did: String
  public var handle: String?
  public var displayName: String?
  public var avatar: String?

  public init(did: String, handle: String? = nil, displayName: String? = nil, avatar: String? = nil) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
  }

  enum CodingKeys: String, CodingKey { case did, handle, displayName, avatar }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(did, forKey: .did)
    try c.encode(handle, forKey: .handle)
    try c.encode(displayName, forKey: .displayName)
    try c.encode(avatar, forKey: .avatar)
  }
}

/// A search that came back with an error status: `HTTP <status>`.
public struct SuggestError: Error, Sendable, Hashable, LocalizedError, JSErrorConvertible {
  public var status: Int
  public var errorDescription: String? { "HTTP \(status)" }
  public var jsFields: JSErrorFields { JSErrorFields(message: "HTTP \(status)", status: status) }
}

public enum SignInSuggest {
  public static let suggestMinChars = 2
  public static let suggestLimit = 5
  /// Long enough that a handle typed at speed asks once, at the end.
  public static let suggestDebounceMs: Double = 250
  static let suggestTimeoutMs: Double = 6_000

  /// `suggestQuery(typed)`: what to search for, given what is in the field;
  /// nil when there is nothing worth asking.
  public static func suggestQuery(_ typed: String?) -> String? {
    let value = SignInIdentity.normalizeSignInInput(typed)
    guard SignInIdentity.classifySignInInput(value) == "handle" else { return nil }
    return value.jsLength >= suggestMinChars ? value : nil
  }

  /// `searchAccounts(term, { limit, appview })`: accounts matching `term`. An
  /// account whose handle no longer points at it is left out, since it can't
  /// be signed in to by that name. Throws when the search can't be made.
  public static func searchAccounts(
    _ term: String,
    limit: Int = suggestLimit,
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport
  ) async throws -> [SignInSuggestion] {
    let url = "\(appview)/xrpc/app.bsky.actor.searchActorsTypeahead?q=\(JSURI.encodeURIComponent(term))&limit=\(limit)"
    let response = try await Atproto.fetchWithTimeout(HTTPRequest(url: url), ms: suggestTimeoutMs, transport: transport)
    guard response.ok else { throw SuggestError(status: response.status) }
    let actors = response.jsonOrNull()?["actors"]?.arrayValue ?? []
    let usable = actors.compactMap { actor -> SignInSuggestion? in
      guard case .string(let did)? = actor["did"], case .string(let handle)? = actor["handle"], handle != "handle.invalid" else {
        return nil
      }
      var displayName: String?
      if case .string(let name)? = actor["displayName"] {
        let trimmed = name.jsTrimmed()
        displayName = trimmed.isEmpty ? nil : trimmed
      }
      return SignInSuggestion(did: did, handle: handle, displayName: displayName, avatar: actor["avatar"].truthy?.stringValue)
    }
    // `.slice(0, limit)`: a negative limit counts back from the end.
    let end = limit < 0 ? max(usable.count + limit, 0) : min(limit, usable.count)
    return Array(usable[..<end])
  }

  /// `moveActive(index, count, key)`: which suggestion a key moves to.
  /// `index` is the one marked now (-1 for none, the field itself); the
  /// arrows go round through the field. Keys are the web's names
  /// (ArrowDown, ArrowUp, Home, End).
  public static func moveActive(_ index: Int, _ count: Int, _ key: String) -> Int {
    if count <= 0 { return -1 }
    switch key {
    case "ArrowDown": return index >= count - 1 ? -1 : index + 1
    case "ArrowUp": return index < 0 ? count - 1 : index - 1
    case "Home": return 0
    case "End": return count - 1
    default: return index
    }
  }
}
