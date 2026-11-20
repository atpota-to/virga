// Ports src/signin/identity.js
//
// Who a typed handle belongs to and where they sign in, looked up before
// the app leaves, so the sign-in can ask "Is this you?" and name the host
// the reader is about to visit. A handle nobody can resolve stops here, in
// words, instead of failing on someone else's page. Everything after that
// first answer is best-effort.
//
// The lookups are public reads and need no session: the profile and the
// handle from Bluesky's public API, the DID document from the PLC directory
// (or the did:web's own host), and the host's own sign-in metadata
// (/.well-known/oauth-protected-resource). Cancelling the task is the web's
// signal: the lookup throws CancellationError.

import Foundation
import VirgaCore
import VirgaNetwork

/// `{ did, handle, displayName, avatar, host, pds }`: the account and where
/// it signs in. `host` and `pds` are nil when they couldn't be found.
public struct SignInIdentityAnswer: Sendable, Hashable, Codable, AccountLike {
  public var did: String
  public var handle: String?
  public var displayName: String?
  public var avatar: String?
  public var host: String?
  public var pds: String?

  public init(did: String, handle: String? = nil, displayName: String? = nil, avatar: String? = nil, host: String? = nil, pds: String? = nil) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
    self.host = host
    self.pds = pds
  }

  enum CodingKeys: String, CodingKey { case did, handle, displayName, avatar, host, pds }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(did, forKey: .did)
    try c.encode(handle, forKey: .handle)
    try c.encode(displayName, forKey: .displayName)
    try c.encode(avatar, forKey: .avatar)
    try c.encode(host, forKey: .host)
    try c.encode(pds, forKey: .pds)
  }
}

/// `{ host, pds }`: where an account signs in.
public struct SignInHost: Sendable, Hashable, Codable {
  public var host: String?
  public var pds: String?

  enum CodingKeys: String, CodingKey { case host, pds }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(host, forKey: .host)
    try c.encode(pds, forKey: .pds)
  }
}

/// A handle (or DID) that resolves to no account at all.
public struct IdentityNotFoundError: Error, Sendable, Hashable, LocalizedError, JSErrorConvertible {
  public var input: String
  public var errorDescription: String? { "No account found for \(input)" }
  public var jsFields: JSErrorFields { JSErrorFields(name: "IdentityNotFoundError", message: "No account found for \(input)") }
}

/// The lookup itself failed (offline, a service down): the handle may be fine.
public struct IdentityLookupError: Error, Sendable, LocalizedError, JSErrorConvertible {
  public var input: String
  /// What went wrong underneath, as its message.
  public var cause: String?
  public var errorDescription: String? { "Could not look up \(input)" }
  public var jsFields: JSErrorFields { JSErrorFields(name: "IdentityLookupError", message: "Could not look up \(input)") }
}

public enum SignInIdentity {
  static let profileTimeoutMs: Double = 8_000
  static let handleTimeoutMs: Double = 8_000
  static let hostTimeoutMs: Double = 3_000

  /// Zero-width characters and direction marks: they ride along when a
  /// handle is copied from a web page, and no server knows the handle with
  /// them in it. `[​-‍﻿‪-‮⁦-⁩]`.
  static func isInvisible(_ unit: UInt16) -> Bool {
    (0x200B...0x200D).contains(unit) || unit == 0xFEFF || (0x202A...0x202E).contains(unit) || (0x2066...0x2069).contains(unit)
  }

  /// `cleanTyped(raw)`: what typing leaves in the field: the invisible
  /// characters taken out, nothing else changed.
  public static func cleanTyped(_ raw: String?) -> String {
    (raw ?? "").units.filter { !isInvisible($0) }.string
  }

  /// `/^https?:\/\//i`.
  static func isHttpAddress(_ units: Units) -> Bool {
    units.hasPrefix("http://", ignoringCase: true) || units.hasPrefix("https://", ignoringCase: true)
  }

  /// `/^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/?#\s]+)/i`: the handle
  /// or DID in a pasted bsky.app profile link.
  static func profileLinkTarget(_ value: Units) -> Units? {
    var i: Int
    if value.hasPrefix("https://", ignoringCase: true) {
      i = 8
    } else if value.hasPrefix("http://", ignoringCase: true) {
      i = 7
    } else {
      return nil
    }
    let rest = Array(value[i...])
    if rest.hasPrefix("www.", ignoringCase: true), Array(rest[4...]).hasPrefix("bsky.app/profile/", ignoringCase: true) {
      i += 4
    }
    guard Array(value[i...]).hasPrefix("bsky.app/profile/", ignoringCase: true) else { return nil }
    i += 17
    var end = i
    while end < value.count, value[end] != Unit.slash, value[end] != 0x3F, value[end] != Unit.hash, !Unit.isWhitespace(value[end]) {
      end += 1
    }
    return end > i ? Array(value[i..<end]) : nil
  }

  /// `normalizeSignInInput(raw)`: what the reader typed, as a sign-in can
  /// use it: invisible characters out, NFKC, trimmed, lower case, a leading
  /// @ dropped, and a pasted bsky.app profile link reduced to the handle (or
  /// DID) in it. Any other address passes through as typed: a sign-in takes
  /// a host's address too.
  public static func normalizeSignInInput(_ raw: String?) -> String {
    var value = cleanTyped(raw).precomposedStringWithCompatibilityMapping.jsTrimmed()
    if value.isEmpty { return "" }
    if let target = profileLinkTarget(value.units) {
      let text = target.string
      value = (try? JSURI.decodeURIComponent(text)) ?? text
    }
    var units = value.units
    if isHttpAddress(units) { return value }
    while units.first == Unit.at { units.removeFirst() }
    value = units.string
    // A DID's method is lower case already, and what follows it is not ours to change.
    return units.hasPrefix("did:") ? value : value.jsLowercased()
  }

  /// `classifySignInInput(value)`: 'url' (a host's address), 'did', 'handle', or 'empty'.
  public static func classifySignInInput(_ value: String?) -> String {
    guard let value, !value.isEmpty else { return "empty" }
    let units = value.units
    if isHttpAddress(units) { return "url" }
    if units.hasPrefix("did:") { return "did" }
    return "handle"
  }

  /// `hostnameOf(url)`: the host name in an address, or nil.
  public static func hostnameOf(_ url: String?) -> String? {
    guard let url, let parsed = try? WebURL(url) else { return nil }
    return parsed.hostname.isEmpty ? nil : parsed.hostname
  }

  /// `hostLabelForPds(pdsUrl)`: the name a reader knows a PDS by.
  /// Bluesky's own PDSes (…host.bsky.network) sit behind bsky.social.
  public static func hostLabelForPds(_ pdsUrl: String?) -> String? {
    guard let host = hostnameOf(pdsUrl) else { return nil }
    if host == "bsky.network" || host.units.reversed().starts(with: ".bsky.network".units.reversed()) { return "bsky.social" }
    return host
  }

  /// `handleFromDidDocument(doc)`: the handle a DID document claims
  /// (`alsoKnownAs: ['at://handle']`), or nil.
  public static func handleFromDidDocument(_ doc: JSONValue?) -> String? {
    for name in doc?["alsoKnownAs"]?.arrayValue ?? [] {
      // /^at:\/\/([a-z0-9.-]+)$/i, with a dot in it
      let units = name.jsString.units
      guard units.hasPrefix("at://", ignoringCase: true) else { continue }
      let rest = units[5...]
      guard !rest.isEmpty,
        rest.allSatisfy({ Unit.isLower(Unit.asciiLower($0)) || Unit.isDigit($0) || $0 == Unit.dot || $0 == Unit.hyphen })
      else { continue }
      if rest.contains(Unit.dot) { return Array(rest).string.jsLowercased() }
    }
    return nil
  }

  // MARK: The lookups

  /// `createIdentityResolver({ fetch, getDidDocument, appview })`.
  public struct Resolver: Sendable {
    public var transport: any HTTPTransport
    public var clock: NetworkClock
    /// The DID documents read (atproto.js's shared cache by default).
    public var cache: PromiseCache<JSONValue>
    public var appview: String

    public init(
      transport: any HTTPTransport = HTTP.transport,
      clock: NetworkClock = HTTP.clock,
      cache: PromiseCache<JSONValue> = Atproto.didDocumentCache,
      appview: String = AppConfig.appview
    ) {
      self.transport = transport
      self.clock = clock
      self.cache = cache
      self.appview = appview
    }

    /// `read(url, signal, ms)`: `{ status, ok, body }` for a JSON read;
    /// throws when the request itself fails.
    func read(_ url: String, _ ms: Double) async throws -> (status: Int, ok: Bool, body: JSONValue?) {
      let response = try await Atproto.fetchWithTimeout(HTTPRequest(url: url), ms: ms, transport: transport)
      return (response.status, response.ok, response.jsonOrNull())
    }

    func getDidDocument(_ did: String) async throws -> JSONValue {
      try await Atproto.getDidDocument(did, transport: transport, clock: clock, cache: cache)
    }

    /// `resolveSignInHost(did, { document })`: where an account signs in.
    /// `host` is the name of the page it will approve Virga on (its PDS's
    /// authorization server when the PDS names one, else the PDS itself).
    /// Never throws, except when the lookup was cancelled.
    public func resolveSignInHost(_ did: String, document: JSONValue? = nil) async throws -> SignInHost {
      var pds: String?
      do {
        let doc: JSONValue
        if let document, document.isTruthy {
          doc = document
        } else {
          doc = try await getDidDocument(did)
        }
        pds = PDS.pdsFromDidDocument(doc, did: did)
      } catch {
        // No document to read; the sign-in itself will say if the account is gone.
      }
      try Task.checkCancellation()
      guard let pds else { return SignInHost(host: nil, pds: nil) }
      do {
        let url = try WebURL("/.well-known/oauth-protected-resource", base: pds).href
        let answer = try await read(url, SignInIdentity.hostTimeoutMs)
        var server: JSONValue?
        if answer.ok, case .array(let servers)? = answer.body?["authorization_servers"] { server = servers.first }
        if let text = server?.stringValue, let host = SignInIdentity.hostnameOf(text) { return SignInHost(host: host, pds: pds) }
      } catch {
        try Task.checkCancellation()
        // A PDS that doesn't publish it still has a name.
      }
      return SignInHost(host: SignInIdentity.hostLabelForPds(pds), pds: pds)
    }

    /// `resolveSignInIdentity(input)`: the account behind a handle or a DID.
    /// The public profile when there is one; otherwise the handle is
    /// resolved on its own, since an account the AppView hasn't indexed can
    /// still sign in.
    ///
    /// Throws IdentityNotFoundError when nobody has that handle (or DID),
    /// IdentityLookupError when the lookup couldn't be made, and
    /// CancellationError when the task is cancelled.
    public func resolveSignInIdentity(_ input: String) async throws -> SignInIdentityAnswer {
      var identity: SignInIdentityAnswer?
      var profileFailure: (any Error)?
      let isDid = input.units.hasPrefix("did:")
      do {
        let answer = try await read(
          "\(appview)/xrpc/app.bsky.actor.getProfile?actor=\(JSURI.encodeURIComponent(input))", SignInIdentity.profileTimeoutMs)
        if answer.ok, case .string(let did)? = answer.body?["did"] {
          let body = answer.body
          var handle: String?
          if case .string(let h)? = body?["handle"], !h.isEmpty, h != "handle.invalid" {
            handle = h
          } else {
            handle = isDid ? nil : input
          }
          var displayName: String?
          if case .string(let name)? = body?["displayName"] {
            let trimmed = name.jsTrimmed()
            displayName = trimmed.isEmpty ? nil : trimmed
          }
          identity = SignInIdentityAnswer(did: did, handle: handle, displayName: displayName, avatar: body?["avatar"].truthy?.stringValue)
        }
      } catch {
        try Task.checkCancellation()
        profileFailure = error
      }

      var document: JSONValue?
      if identity == nil && isDid {
        do {
          document = try await getDidDocument(input)
        } catch {
          try Task.checkCancellation()
          // The directory answers 404 for a DID it has never heard of. Any
          // other failure says nothing about the DID.
          let status = JSErrorFields(error)?.status
          if status == 404 || status == 410 { throw IdentityNotFoundError(input: input) }
          throw IdentityLookupError(input: input, cause: jsMessage(error))
        }
        identity = SignInIdentityAnswer(did: input, handle: SignInIdentity.handleFromDidDocument(document))
      }

      if identity == nil {
        let answer: (status: Int, ok: Bool, body: JSONValue?)
        do {
          answer = try await read(
            "\(appview)/xrpc/com.atproto.identity.resolveHandle?handle=\(JSURI.encodeURIComponent(input))", SignInIdentity.handleTimeoutMs)
        } catch {
          try Task.checkCancellation()
          throw IdentityLookupError(input: input, cause: jsMessage(error))
        }
        if answer.ok, case .string(let did)? = answer.body?["did"] {
          identity = SignInIdentityAnswer(did: did, handle: input)
        } else if answer.status >= 400 && answer.status < 500 && answer.status != 429 {
          // An unknown handle is answered 400.
          throw IdentityNotFoundError(input: input)
        } else {
          throw IdentityLookupError(input: input, cause: profileFailure.map(jsMessage) ?? "HTTP \(answer.status)")
        }
      }

      try Task.checkCancellation()
      guard var found = identity else { throw IdentityLookupError(input: input) }
      let where_ = try await resolveSignInHost(found.did, document: document)
      found.host = where_.host
      found.pds = where_.pds
      return found
    }
  }

  /// The shared resolver, over the app's transport and the shared DID cache.
  public static func resolveSignInHost(_ did: String, document: JSONValue? = nil) async throws -> SignInHost {
    try await Resolver().resolveSignInHost(did, document: document)
  }

  public static func resolveSignInIdentity(_ input: String) async throws -> SignInIdentityAnswer {
    try await Resolver().resolveSignInIdentity(input)
  }
}
