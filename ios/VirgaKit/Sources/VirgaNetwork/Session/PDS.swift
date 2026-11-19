// Ports src/session/pds.js
//
// Where an account's repo lives: the `#atproto_pds` service in its DID
// document. A post's video is uploaded with a pass minted for this host, and
// it is the same however the account signed in, which is why it is read from
// the identity and not from the session.

import Foundation
import VirgaCore

public enum PDS {
  /// `pdsFromDidDocument(doc)`: the PDS endpoint the document names (its
  /// `#atproto_pds` service, written short or as `<doc.id>#atproto_pds`),
  /// without trailing slashes, or nil. Never guesses from another service,
  /// and takes only an http(s) address.
  public static func pdsFromDidDocument(_ doc: JSONValue?) -> String? {
    pdsFromDidDocument(doc, didValue: doc?["id"])
  }

  /// `pdsFromDidDocument(doc, did)`.
  public static func pdsFromDidDocument(_ doc: JSONValue?, did: String?) -> String? {
    pdsFromDidDocument(doc, didValue: did.map(JSONValue.string))
  }

  static func pdsFromDidDocument(_ doc: JSONValue?, didValue did: JSONValue?) -> String? {
    let services = doc?["service"]?.arrayValue ?? []
    let isPds: (JSONValue) -> Bool = { service in
      if service["id"] == .string("#atproto_pds") { return true }
      guard let did, did.isTruthy else { return false }
      return service["id"] == .string("\(did.jsString)#atproto_pds")
    }
    guard let service = services.first(where: isPds), let endpoint = service["serviceEndpoint"]?.stringValue else {
      return nil
    }
    guard let url = try? WebURL(endpoint), url.protocol == "https:" || url.protocol == "http:" else { return nil }
    var trimmed = endpoint
    while trimmed.hasSuffix("/") { trimmed.removeLast() }
    return trimmed
  }

  /// `createPdsResolver({ getDidDocument })`.
  public static func createPdsResolver(
    getDidDocument: @escaping @Sendable (String) async throws -> JSONValue
  ) -> PDSResolver {
    PDSResolver(getDidDocument: getDidDocument)
  }

  /// The app's resolver (`shared`), reading DID documents through
  /// Atproto.getDidDocument with the app's transport.
  public static let shared = PDSResolver { did in try await Atproto.getDidDocument(did) }

  /// `resolvePdsUrl(did)`: the account's PDS, e.g.
  /// `https://morel.us-east.host.bsky.network`.
  public static func resolvePdsUrl(_ did: String?) async throws -> String {
    try await shared.resolvePdsUrl(did)
  }

  /// `rememberPdsUrl(did, pdsUrl)`.
  public static func rememberPdsUrl(_ did: String?, _ pdsUrl: String?) async {
    await shared.remember(did, pdsUrl)
  }
}

/// A resolver with its own per-account cache. The cache holds the lookup
/// under way, so callers at the same time share one, and forgets a failure
/// so the next caller asks again. An account's PDS changes only when it
/// migrates, so an answer is kept.
public actor PDSResolver {
  public struct MissingDid: Error, Sendable, LocalizedError {
    public var errorDescription: String? { "resolvePdsUrl: missing did" }
  }

  public struct NoPds: Error, Sendable, LocalizedError {
    public var did: String
    public var errorDescription: String? { "No PDS listed for \(did)" }
  }

  let getDidDocument: @Sendable (String) async throws -> JSONValue
  private let cache = PromiseCache<String>()

  public init(getDidDocument: @escaping @Sendable (String) async throws -> JSONValue) {
    self.getDidDocument = getDidDocument
  }

  public func resolvePdsUrl(_ did: String?) async throws -> String {
    guard let did, !did.isEmpty else { throw MissingDid() }
    let read = getDidDocument
    return try await cache.value(for: did, now: 0) {
      let doc = try await read(did)
      guard let pds = PDS.pdsFromDidDocument(doc, did: did) else { throw NoPds(did: did) }
      return pds
    }
  }

  /// `remember(did, pdsUrl)`: a PDS learned another way (the server's
  /// session answer), so no lookup is needed. Only an http(s) address.
  public func remember(_ did: String?, _ pdsUrl: String?) async {
    guard let did, !did.isEmpty, let pdsUrl, pdsUrl.hasPrefix("https://") || pdsUrl.hasPrefix("http://") else { return }
    var trimmed = pdsUrl
    while trimmed.hasSuffix("/") { trimmed.removeLast() }
    await cache.set(did, trimmed)
  }

  public func forget(_ did: String?) async {
    guard let did else { return }
    await cache.remove(did)
  }
}
