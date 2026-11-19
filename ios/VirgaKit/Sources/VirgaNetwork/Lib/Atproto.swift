// Ports src/lib/atproto.js
//
// The public reads the app makes without a session: DID documents (the PLC
// directory for did:plc, the host for did:web), a DID's PDS, profiles from
// the public AppView, a did:plc's history, and the dates inside record keys.
// Every request carries a 15 s deadline, so a hung read can't wedge a sync.

import Foundation
import VirgaCore

/// A read that came back with a status that isn't 2xx: `HTTP <status>
/// <statusText> for <url> :: <first 200 characters of the body>`.
public struct AtprotoHTTPError: Error, Sendable, Hashable, LocalizedError {
  public var status: Int
  public var url: String
  public var message: String
  public var errorDescription: String? { message }
}

/// The TypeError JavaScript throws reading a property of a document that
/// isn't the shape the code expects (`services.find is not a function`):
/// the same message, so a caller shows what the web shows.
public struct ShapeError: Error, Sendable, Hashable, LocalizedError {
  public var message: String
  public var errorDescription: String? { message }
}

/// One entry of a did:plc's operation log, as getPlcHistory gives it.
public struct PlcHistoryEntry: Codable, Sendable, Hashable {
  /// When it was made (`createdAt`), or null.
  public var at: JSONValue
  /// The handles it names, without `at://`.
  public var handles: [String]
  /// The PDS it names, or null.
  public var pds: JSONValue
  public var nullified: Bool
  /// The operation's type (`plc_operation`, `create`, `plc_tombstone`), or null.
  public var type: JSONValue
}

/// A profile as resolveProfiles keeps it.
public struct ResolvedProfile: Codable, Sendable, Hashable {
  public var handle: String
  public var displayName: String
  public var avatar: String
}

public enum Atproto {
  public static let requestTimeoutMs: Double = 15_000
  public static let didDocTtlMs: Double = 10 * 60_000

  /// The DID documents read so far (`_didDocCache`), ten minutes each:
  /// what callers read off a document (its PDS) moves only on an account
  /// migration.
  public static let didDocumentCache = PromiseCache<JSONValue>()

  /// `fetchWithTimeout(url, init, ms)`: the request with the 15 s ceiling
  /// (or `ms`) every request in the module carries, as well as the task's
  /// own cancellation.
  public static func fetchWithTimeout(
    _ request: HTTPRequest,
    ms: Double = requestTimeoutMs,
    transport: any HTTPTransport = HTTP.transport
  ) async throws -> HTTPResponse {
    var timed = request
    timed.timeoutMs = ms
    return try await transport.send(timed)
  }

  /// `fetchJson(url)`: the body of a 2xx answer, else AtprotoHTTPError.
  static func fetchJson(_ url: String, transport: any HTTPTransport) async throws -> JSONValue {
    let response = try await fetchWithTimeout(HTTPRequest(url: url), transport: transport)
    if !response.ok {
      let text = response.text()
      throw AtprotoHTTPError(
        status: response.status, url: url,
        message: "HTTP \(response.status) \(response.statusText) for \(url) :: \(text.jsSlice(0, 200))")
    }
    return try response.json()
  }

  /// `resolvePds(did)`: the PDS a DID's document names (its
  /// `#atproto_pds` service, else its first), without a trailing slash.
  public static func resolvePds(
    _ did: String?,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock,
    cache: PromiseCache<JSONValue> = didDocumentCache
  ) async throws -> String {
    let doc = try await getDidDocument(did, transport: transport, clock: clock, cache: cache)
    // `doc?.service || []`, then `.find`: a document whose `service` is
    // something else fails as it does in JavaScript.
    let service = doc["service"].truthy ?? .array([])
    guard case .array(let services) = service else { throw ShapeError(message: "services.find is not a function") }
    var chosen: JSONValue?
    for entry in services {
      if entry.isNull { throw ShapeError(message: "Cannot read properties of null (reading 'id')") }
      if entry["id"] == .string("#atproto_pds") {
        chosen = entry["serviceEndpoint"]
        break
      }
    }
    var pds = chosen.truthy
    if pds == nil, let first = services.first {
      pds = first["serviceEndpoint"].truthy
    }
    guard let pds else { throw ShapeError(message: "No PDS endpoint for \(did ?? "undefined")") }
    guard case .string(var endpoint) = pds else { throw ShapeError(message: "pds.replace is not a function") }
    if endpoint.hasSuffix("/") { endpoint.removeLast() }
    return endpoint
  }

  /// `didWebDocumentUrl(did)`: where a did:web keeps its document
  /// (`did:web:example.com` → `https://example.com/.well-known/did.json`,
  /// a port arriving as `%3A`), or nil for anything that isn't a usable
  /// did:web (further `:` segments would be a path, which atproto accounts
  /// don't use).
  public static func didWebDocumentUrl(_ did: String?) -> String? {
    let text = did ?? ""
    let prefix = "did:web:"
    guard text.hasPrefix(prefix) else { return nil }
    let body = String(jsUnits: Array(text.utf16.dropFirst(prefix.utf16.count)))
    guard !body.isEmpty, !body.utf16.contains(where: { $0 == 0x3A || $0 == 0x2F || $0 == 0x3F || $0 == 0x23 }) else {
      return nil
    }
    let host = body.replacingOccurrences(of: "%3A", with: ":", options: .caseInsensitive)
    guard isWebHost(host) else { return nil }
    return "https://\(host)/.well-known/did.json"
  }

  /// `/^[a-z0-9.-]+(:\d+)?$/i`.
  static func isWebHost(_ host: String) -> Bool {
    let units = Array(host.utf16)
    var i = 0
    func nameUnit(_ u: UInt16) -> Bool {
      (0x61...0x7A).contains(u) || (0x41...0x5A).contains(u) || (0x30...0x39).contains(u) || u == 0x2E || u == 0x2D
    }
    while i < units.count, nameUnit(units[i]) { i += 1 }
    guard i > 0 else { return false }
    if i == units.count { return true }
    guard units[i] == 0x3A else { return false }
    let port = units[(i + 1)...]
    return !port.isEmpty && port.allSatisfy { (0x30...0x39).contains($0) }
  }

  /// `getDidDocument(did)`: the DID document for a did:plc or a did:web,
  /// through the cache.
  public static func getDidDocument(
    _ did: String?,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock,
    cache: PromiseCache<JSONValue> = didDocumentCache
  ) async throws -> JSONValue {
    guard let did, !did.isEmpty else { throw ShapeError(message: "getDidDocument: missing did") }
    let url: String?
    if did.hasPrefix("did:web:") {
      url = didWebDocumentUrl(did)
    } else {
      url = "\(AppConfig.plcDirectory)/\(JSURI.encodeURIComponent(did))"
    }
    guard let url else { throw ShapeError(message: "Unsupported did:web identifier \(did)") }
    return try await cache.value(for: did, ttl: didDocTtlMs, now: clock.now()) {
      try await fetchJson(url, transport: transport)
    }
  }

  /// `getProfile(actor, { appview })`: `app.bsky.actor.getProfile`, as the
  /// AppView answers it.
  public static func getProfile(
    _ actor: String,
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport
  ) async throws -> JSONValue {
    try await fetchJson(
      "\(appview)/xrpc/app.bsky.actor.getProfile?actor=\(JSURI.encodeURIComponent(actor))", transport: transport)
  }

  /// `getProfile` decoded as a ProfileViewDetailed.
  public static func getProfile(
    _ actor: String,
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport,
    as type: ProfileViewDetailed.Type
  ) async throws -> ProfileViewDetailed {
    try await getProfile(actor, appview: appview, transport: transport).decode(ProfileViewDetailed.self)
  }

  /// `resolveProfiles(dids, { appview })`: `{ did: { handle, displayName,
  /// avatar } }` for many accounts, 25 to a request. A request that fails
  /// is asked once more after 400 ms, and then its accounts are left out
  /// (a deactivated account and one that couldn't be reached look the
  /// same, and neither should be invented).
  public static func resolveProfiles(
    _ dids: [String?]?,
    appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock
  ) async -> [String: ResolvedProfile] {
    var unique: [String] = []
    var seen = Set<String>()
    for did in dids ?? [] {
      guard let did, !did.isEmpty, !seen.contains(did) else { continue }
      seen.insert(did)
      unique.append(did)
    }
    var out: [String: ResolvedProfile] = [:]
    var start = 0
    while start < unique.count {
      let part = unique[start..<min(start + 25, unique.count)]
      start += 25
      let url = "\(appview)/xrpc/app.bsky.actor.getProfiles?\(JSURI.searchParams(part.map { ("actors", $0) }))"
      let body: JSONValue
      do {
        body = try await fetchJson(url, transport: transport)
      } catch {
        await clock.sleep(400)
        guard let again = try? await fetchJson(url, transport: transport) else { continue }
        body = again
      }
      for profile in body["profiles"]?.arrayValue ?? [] {
        guard let did = profile["did"], did.isTruthy else { continue }
        func field(_ name: String) -> String {
          guard let value = profile[name], value.isTruthy else { return "" }
          return value.stringValue ?? value.jsString
        }
        out[did.jsString] = ResolvedProfile(handle: field("handle"), displayName: field("displayName"), avatar: field("avatar"))
      }
    }
    return out
  }

  /// `rkeyFromAtUri(uri)`: the record key of `at://did/collection/rkey`.
  public static func rkeyFromAtUri(_ uri: String?) -> String? { AtUri.rkey(of: uri) }

  static let tidAlphabet = Array("234567abcdefghijklmnopqrstuvwxyz".unicodeScalars)

  /// `tidToTimestamp(rkey)`: the time a TID record key was minted, as an
  /// ISO string, or nil for a key that isn't a well-formed TID. (Laxer than
  /// TID.tidTimestamp: any of the 32 characters may lead.)
  public static func tidToTimestamp(_ rkey: String?) -> String? {
    let text = rkey ?? ""
    guard text.utf16.count == 13 else { return nil }
    var values: [UInt64] = []
    for scalar in text.unicodeScalars {
      guard let index = tidAlphabet.firstIndex(of: scalar) else { return nil }
      values.append(UInt64(index))
    }
    guard values.count == 13 else { return nil }
    // 65 bits: the leading character's five sit above the other sixty.
    var rest: UInt64 = 0
    for value in values.dropFirst() { rest = rest << 5 | value }
    let micros = (values[0] << 50) | (rest >> 10)
    let ms = Double(micros / 1000)
    guard ms > 0 else { return nil }
    return JSDate.toISOString(ms)
  }

  /// `getPlcHistory(did)`: a did:plc's operation log, oldest first, or nil
  /// for a did:web (which keeps no history) or when the directory can't be
  /// read.
  public static func getPlcHistory(_ did: String?, transport: any HTTPTransport = HTTP.transport) async -> [PlcHistoryEntry]? {
    guard let did, did.hasPrefix("did:plc:") else { return nil }
    guard
      let response = try? await fetchWithTimeout(
        HTTPRequest(url: "\(AppConfig.plcDirectory)/\(did)/log/audit"), ms: 15_000, transport: transport),
      response.ok,
      let log = try? response.json(),
      case .array(let entries) = log
    else { return nil }
    var out: [PlcHistoryEntry] = []
    for entry in entries {
      let op = entry["operation"].truthy ?? .object([:])
      let akas: [JSONValue]
      if let alsoKnownAs = op["alsoKnownAs"], alsoKnownAs.isTruthy {
        // `.map` on anything but an array throws, and the whole read is null.
        guard case .array(let items) = alsoKnownAs else { return nil }
        akas = items
      } else if let handle = op["handle"], handle.isTruthy {
        akas = [.string("at://\(handle.jsString)")]
      } else {
        akas = []
      }
      let handles = akas.map { aka -> String in
        let text = aka.jsString
        return text.hasPrefix("at://") ? String(text.dropFirst(5)) : text
      }.filter { !$0.isEmpty }
      let endpoint = op["services"]?["atproto_pds"]?["endpoint"].truthy
      let pds = endpoint ?? op["service"].truthy ?? .null
      out.append(
        PlcHistoryEntry(
          at: entry["createdAt"].truthy ?? .null,
          handles: handles,
          pds: pds,
          nullified: entry["nullified"]?.isTruthy ?? false,
          type: op["type"].truthy ?? .null))
    }
    return out
  }
}
