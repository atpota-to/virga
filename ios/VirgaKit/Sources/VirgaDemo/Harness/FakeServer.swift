// Ports harness/fakeServer.js (the sessions, the terms ledger and the proxy)
//
// Virga's server, in memory, as far as the session goes: the long sessions'
// tokens and grants (/api/oauth/session, /api/oauth/logout), the terms
// ledger (/api/terms/status, /api/terms/accept), and the signed-in calls
// (/api/oauth/proxy, /api/oauth/upload-blob), answered in the server's own
// request and response shapes. A 401 for a token the server doesn't know
// carries FRONTEND_SESSION_INVALID (sign-out answers 200 either way); a
// grant can be refused while its row stays, which the lite session check
// doesn't see until something has tried to use it.
//
// One deliberate difference from harness/fakeServer.js: there, a usable
// grant gets a 501 from the proxy, because the web harness's pages call
// their fake agents directly. On iOS every signed-in call goes through the
// proxy (VirgaNetwork's BackendFetchHandler), so here the proxy forwards the
// call to the account's fake agent (FakeAgent) as the account named by the
// token, and answers as server/oauth/handlers/proxy.js and uploadBlob.js
// answer: `{ success: true, data }`, or `{ success: false, error, code }`
// with the upstream status. The refusals before that (no token, a token
// the server doesn't know, a refused grant) are the web fake's own.
//
// Another addition, for the demo's sign-in sheet: /api/oauth/login, as
// server/oauth/handlers/login.js answers it, and `authorize(_:)`, the trip
// to the account's host (DemoAuthenticator), which mints a token as a
// sign-in does and sends the sheet back to the return page.
//
// The rest of the web fake's routes (scheduling, timers, the limits, the
// adviser and alt text, Defense) come with a later port: here they check
// the token as the web's do, then answer 503 UNAVAILABLE in plain words.
// Paths it doesn't know answer as the web's: 405 for a known path asked
// with another method, 404 for any other.
//
// It answers at `FakeServer.serverOrigin`, the web's SERVER_ORIGIN.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

public enum FakeServer {
  /// Where the fake server answers (`SERVER_ORIGIN`).
  public static let serverOrigin = "https://server.harness.invalid"

  /// The AI allowances per account per month, as the server's env defaults
  /// them (`DEFAULT_AI_LIMITS`).
  public static let defaultAiLimits = HarnessFlags.AILimits(adviser: 30, altText: 15, style: 3)

  /// The routes of the web fake that come with a later port: method, path
  /// and what they are.
  public static let laterRoutes: [(method: String, path: String, area: String)] = [
    ("POST", "/api/schedule/create", "scheduling"),
    ("GET", "/api/schedule/list", "scheduling"),
    ("GET", "/api/schedule/get", "scheduling"),
    ("GET", "/api/schedule/media", "scheduling"),
    ("POST", "/api/schedule/update", "scheduling"),
    ("POST", "/api/schedule/reorder", "scheduling"),
    ("POST", "/api/schedule/cancel", "scheduling"),
    ("POST", "/api/self-destruct/create", "timers"),
    ("GET", "/api/self-destruct/list", "timers"),
    ("POST", "/api/self-destruct/cancel", "timers"),
    ("GET", "/api/limits/status", "scheduling"),
    ("POST", "/api/ai/analyze-post", "the adviser"),
    ("POST", "/api/ai/synthesize-style", "the adviser"),
    ("POST", "/api/ai/alt-text", "alt text"),
    ("GET", "/api/defense/lists", "Defense"),
    ("POST", "/api/defense/list-create", "Defense"),
    ("POST", "/api/defense/keep", "Defense"),
    ("POST", "/api/defense/unkeep", "Defense"),
    ("POST", "/api/defense/plan", "Defense"),
    ("POST", "/api/defense/approve", "Defense"),
    ("GET", "/api/defense/history", "Defense"),
    ("POST", "/api/defense/undo", "Defense"),
    ("GET", "/api/defense/link", "Defense"),
    ("POST", "/api/defense/link-code", "Defense"),
    ("POST", "/api/defense/unlink", "Defense"),
    ("POST", "/api/defense/link-list", "Defense"),
  ]

  /// The words a later route answers with.
  public static func laterWords(_ area: String) -> String {
    "\(area) isn't in the demo's server yet."
  }

  // MARK: The proxy, as server/oauth/handlers/proxy.js reads a call

  /// Params the proxy hands the SDK as booleans (`BOOLEAN_PARAMS`).
  public static let booleanParams = ["reverse", "validate", "includeTakedowns", "includeItemCount", "includePins"]
  /// … as numbers (`NUMERIC_PARAMS`).
  public static let numericParams = ["limit", "depth", "parentHeight"]
  /// … as lists, split on commas when sent as one (`ARRAY_PARAMS`).
  public static let arrayParams = ["feeds", "uris", "actors", "dids", "handles", "members", "labelers"]
  /// Outputs that are bytes, not JSON (`BINARY_OUTPUT`).
  public static let binaryOutput = ["com.atproto.sync.getRepo", "com.atproto.sync.getBlob", "com.atproto.sync.getRecord"]

  /// `forwardedQuery(req)`: the call's params from its query string, with
  /// repeated keys as lists and the known non-string params coerced for the
  /// SDK. `method` is never forwarded, nor the router's own `action=proxy`.
  public static func forwardedQuery(_ pairs: [(String, String)]) -> JSONValue {
    var params: [(String, JSONValue)] = []
    func index(_ key: String) -> Int? { params.firstIndex { $0.0.jsEquals(key) } }
    for (key, value) in pairs {
      if let i = index(key) {
        switch params[i].1 {
        case .array(let held): params[i].1 = .array(held + [.string(value)])
        default: params[i].1 = .array([params[i].1, .string(value)])
        }
      } else {
        params.append((key, .string(value)))
      }
    }
    if let i = index("action"), params[i].1 == .string("proxy") { params.remove(at: i) }
    if let i = index("method") { params.remove(at: i) }
    for name in booleanParams {
      if let i = index(name) { params[i].1 = .bool(params[i].1.stringValue == "true") }
    }
    for name in numericParams {
      if let i = index(name) { params[i].1 = .number(params[i].1.jsNumber) }
    }
    for name in arrayParams {
      if let i = index(name), case .string(let text) = params[i].1, !text.isEmpty {
        params[i].1 = .array(text.jsSplit(",").map { $0.jsTrimmed() }.filter { !$0.isEmpty }.map(JSONValue.string))
      }
    }
    var out: [String: JSONValue] = [:]
    for (key, value) in params { out[key] = value }
    return .object(out)
  }

  /// `isSafeXrpcMethod(method)`: a lexicon NSID (`/^[a-z][a-z0-9]*(\.[a-zA-Z0-9]+){2,}$/`)
  /// with no segment that could reach an object's internals.
  public static func isSafeXrpcMethod(_ method: String?) -> Bool {
    guard let method else { return false }
    let parts = method.jsSplit(".")
    guard parts.count >= 3 else { return false }
    func ascii(_ part: String, _ ok: (UInt16) -> Bool) -> Bool { !part.isEmpty && part.utf16.allSatisfy(ok) }
    let lower: (UInt16) -> Bool = { (0x61...0x7A).contains($0) || (0x30...0x39).contains($0) }
    let any: (UInt16) -> Bool = { lower($0) || (0x41...0x5A).contains($0) }
    guard let first = parts[0].utf16.first, (0x61...0x7A).contains(first), ascii(parts[0], lower),
      parts.dropFirst().allSatisfy({ ascii($0, any) })
    else { return false }
    return !parts.contains { ["__proto__", "constructor", "prototype"].contains($0) }
  }

  /// `httpStatusForXrpcError(err)`: the upstream's own 4xx/5xx, 502 for
  /// the SDK's Unknown (1) and InvalidResponse (2), else 500.
  public static func httpStatusForXrpcError(_ status: Int?) -> Int {
    guard let status else { return 500 }
    if status == 1 || status == 2 { return 502 }
    return (400...599).contains(status) ? status : 500
  }

  /// `/^Bearer\s+(\S+)$/i`: the token of an Authorization header.
  public static func bearer(_ header: String?) -> String? {
    let units = Array((header ?? "").utf16)
    let word = Array("bearer".utf16)
    guard units.count > word.count + 1,
      zip(units.prefix(word.count), word).allSatisfy({ $0.0 < 0x80 && ($0.0 | 0x20) == $0.1 })
    else { return nil }
    func space(_ unit: UInt16) -> Bool { Unicode.Scalar(unit).map(JSWhitespace.contains) ?? false }
    var i = word.count
    guard space(units[i]) else { return nil }
    while i < units.count, space(units[i]) { i += 1 }
    let token = units[i...]
    guard !token.isEmpty, !token.contains(where: space) else { return nil }
    return String(decoding: token, as: UTF16.self)
  }

  static func failure(_ error: String, code: String? = nil, _ extra: [String: JSONValue] = [:]) -> JSONValue {
    var out = extra
    out["success"] = false
    out["error"] = .string(error)
    if let code { out["code"] = .string(code) }
    return .object(out)
  }
}

/// A row of the terms ledger, as its table holds it.
public struct TermsAgreement: Codable, Hashable, Sendable {
  public var did: String
  public var policy_version: String
  public var terms_version: Int
  public var identity: String
  public var accepted_at: String
  public var ip: String?
  public var user_agent: String?

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(did, forKey: .did)
    try c.encode(policy_version, forKey: .policy_version)
    try c.encode(terms_version, forKey: .terms_version)
    try c.encode(identity, forKey: .identity)
    try c.encode(accepted_at, forKey: .accepted_at)
    try c.encode(ip, forKey: .ip)
    try c.encode(user_agent, forKey: .user_agent)
  }
}

/// What the server answers: a status and a JSON body (nil for a 204).
public struct ServerAnswer: Sendable, Hashable {
  public var status: Int
  public var body: JSONValue?

  public init(_ status: Int, _ body: JSONValue?) {
    self.status = status
    self.body = body
  }
}

/// Virga's server, in memory (`createServer`, as far as the session goes).
public final class DemoServer: Sendable {
  public let world: DemoWorld
  /// How the terms ledger starts: 'agreed' (every account has agreed, so
  /// the app opens), 'ask' (nobody has) or 'down' (nobody has, and an
  /// agreement can't be recorded).
  public let terms: String
  let now: @Sendable () -> Double
  let randomBytes: @Sendable (Int) -> [UInt8]
  let agents: @Sendable (String) throws -> FakeAgent

  struct State {
    /// token → did, in the order minted.
    var tokens = JSOrderedMap<String>()
    /// DIDs with the OAuth grant the workers act with.
    var grants = Set<JSKey>()
    /// Grants whose row is still stored but which the authorization server refuses.
    var refusedGrants = Set<JSKey>()
    /// Refused grants this server has found refused, by a full session
    /// check or a proxy call, as the server's in-memory deadGrants does.
    var knownRefused = Set<JSKey>()
    var agreements: [TermsAgreement] = []
    var log: [(at: String, line: String)] = []
  }

  let state: Locked<State>

  /// - Parameters:
  ///   - world: the accounts' worlds.
  ///   - terms: how the ledger starts ('agreed', 'ask' or 'down').
  ///   - now: `Date.now()`.
  ///   - randomBytes: the tokens' randomness (`crypto.getRandomValues`).
  ///   - agents: the account's fake agent, which the proxy forwards to (the
  ///     harness's `agentFor`). By default one with no latency, reading
  ///     the world's grant at each call.
  public init(
    world: DemoWorld,
    terms: String = "agreed",
    now: @escaping @Sendable () -> Double,
    randomBytes: @escaping @Sendable (Int) -> [UInt8] = { count in (0..<count).map { _ in UInt8.random(in: 0...255) } },
    agents: (@Sendable (String) throws -> FakeAgent)? = nil
  ) {
    self.world = world
    self.terms = terms
    self.now = now
    self.randomBytes = randomBytes
    if let agents {
      self.agents = agents
    } else {
      let made = Locked<[JSKey: FakeAgent]>([:])
      self.agents = { [world] did in
        guard world.world(did) != nil else { throw DemoWorldError.noAccount(did) }
        return made.withLock { held in
          if let agent = held[JSKey(did)] { return agent }
          let agent = FakeAgent(world: world, did: did, clock: NetworkClock(now: now, sleep: { _ in }))
          held[JSKey(did)] = agent
          return agent
        }
      }
    }
    var start = State()
    if terms == "agreed" {
      let at = World.iso(now() - 30 * 86_400_000)
      start.agreements = world.worlds.map { w in
        TermsAgreement(
          did: w.me.did, policy_version: LegalVersion.termsEffectiveDate, terms_version: LegalVersion.termsVersion,
          identity: "session", accepted_at: at, ip: nil, user_agent: nil)
      }
    }
    state = Locked(start)
  }

  // MARK: Sessions

  func note(_ line: String) {
    let at = World.iso(now())
    state.withLock { s in
      s.log.append((at, line))
      if s.log.count > 200 { s.log.removeFirst() }
    }
  }

  static func dropGrant(_ s: inout State, _ did: String) {
    s.grants.remove(JSKey(did))
    s.refusedGrants.remove(JSKey(did))
    s.knownRefused.remove(JSKey(did))
  }

  /// `mintToken(did)`: a new `vg_` token for the account, as a sign-in
  /// writes one, with a new grant (a refusal of the old one says nothing
  /// about it).
  public func mintToken(_ did: String) -> String {
    let token = "vg_" + randomBytes(32).map { String(format: "%02x", $0) }.joined()
    state.withLock { s in
      s.tokens[token] = did
      Self.dropGrant(&s, did)
      s.grants.insert(JSKey(did))
    }
    return token
  }

  /// `signOutToken(token, { keepGrant })`: per device, the grant goes only
  /// with the account's last token (or not at all, with `keepGrant`).
  @discardableResult
  public func signOutToken(_ token: String, keepGrant: Bool = false) -> (found: Bool, grantRevoked: Bool) {
    state.withLock { s in
      guard let did = s.tokens[token] else { return (false, false) }
      s.tokens.delete(token)
      if keepGrant { return (true, false) }
      let left = s.tokens.values.contains { $0.jsEquals(did) }
      if !left { Self.dropGrant(&s, did) }
      return (true, !left)
    }
  }

  /// `expireAccount(did)`: every token of the account stops working, as an
  /// expired session would.
  public func expireAccount(_ did: String) {
    state.withLock { s in
      for (token, owner) in s.tokens.entries where owner.jsEquals(did) { s.tokens.delete(token) }
      Self.dropGrant(&s, did)
    }
  }

  /// `refuseGrant(did)`: the tokens and the stored grant stay, but the grant
  /// is refused, as when a refresh fails.
  public func refuseGrant(_ did: String) {
    state.withLock { s in
      if s.grants.contains(JSKey(did)) { s.refusedGrants.insert(JSKey(did)) }
    }
  }

  /// Whether the server can act for the account: a grant, and not a refused one.
  func grantUsable(_ s: State, _ did: String) -> Bool {
    s.grants.contains(JSKey(did)) && !s.refusedGrants.contains(JSKey(did))
  }

  /// A restore of the grant, as restoreWithRetry: a refused one is remembered.
  func restoreGrant(_ did: String) -> Bool {
    state.withLock { s in
      if s.refusedGrants.contains(JSKey(did)) { s.knownRefused.insert(JSKey(did)) }
      return grantUsable(s, did)
    }
  }

  struct Coded: Error {
    var status: Int
    var body: JSONValue
  }

  /// `authOf(headers)`: the account a request's token names.
  func authOf(_ headers: HTTPHeaders) throws -> (did: String, token: String) {
    guard let token = FakeServer.bearer(headers.get("authorization")) else {
      throw Coded(status: 401, body: FakeServer.failure("Missing or invalid authorization header", code: "FRONTEND_SESSION_INVALID"))
    }
    guard let did = state.withLock({ $0.tokens[token] }) else {
      throw Coded(status: 401, body: FakeServer.failure("Invalid or expired session", code: "FRONTEND_SESSION_INVALID"))
    }
    return (did, token)
  }

  /// What the server holds, for tests: the tokens (in the order minted),
  /// the ledger and the log.
  public var tokens: [(token: String, did: String)] { state.withLock { $0.tokens.entries.map { ($0.key, $0.value) } } }
  public var agreements: [TermsAgreement] { state.withLock { $0.agreements } }
  public var log: [String] { state.withLock { $0.log.map(\.line) } }

  // MARK: Routing

  /// `handle({ method, path, query, headers, body })`. `body` is the parsed
  /// JSON body (nil for none), `raw` the bytes as sent (an upload's).
  public func handle(
    method: String, path: String, query: [(String, String)], headers: HTTPHeaders, body: JSONValue?, raw: Data? = nil
  ) async -> ServerAnswer {
    do {
      if method == "OPTIONS" { return ServerAnswer(204, nil) }
      if path == "/api/oauth/session" { return sessionRoute(headers, query) }
      if path == "/api/oauth/logout" && method == "POST" { return logoutRoute(headers, body) }
      // The two routes that decide for themselves who is asking: one of
      // them takes a caller with no token at all.
      if path == "/api/terms/status" {
        return method == "GET" ? try termsStatus(headers) : ServerAnswer(405, FakeServer.failure("Method not allowed"))
      }
      if path == "/api/terms/accept" {
        return method == "POST" ? try termsAccept(headers, body) : ServerAnswer(405, FakeServer.failure("Method not allowed"))
      }
      if path == "/api/oauth/proxy" && (method == "GET" || method == "POST") {
        return await proxyRoute(method, headers, query, body)
      }
      if path == "/api/oauth/upload-blob" && method == "POST" {
        return await uploadRoute(headers, query, body, raw)
      }
      if path == "/api/oauth/login" && method == "GET" { return loginRoute(query) }
      guard let route = FakeServer.laterRoutes.first(where: { $0.method == method && $0.path == path }) else {
        let known = FakeServer.laterRoutes.contains { $0.path == path }
        return known
          ? ServerAnswer(405, FakeServer.failure("Method not allowed")) : ServerAnswer(404, FakeServer.failure("Not found"))
      }
      _ = try authOf(headers)
      return ServerAnswer(503, FakeServer.failure(FakeServer.laterWords(route.area), code: "UNAVAILABLE"))
    } catch let coded as Coded {
      return ServerAnswer(coded.status, coded.body)
    } catch {
      return ServerAnswer(500, FakeServer.failure("something went wrong. please try again.", code: "INTERNAL"))
    }
  }

  /// `createServerRouter(server, origin)`: a request to the server's origin
  /// as the server answers it, or nil for any other. A body is JSON when it
  /// is text (an upload's octet-stream is bytes, as the web's Uint8Array).
  public func route(_ request: HTTPRequest, origin: String = FakeServer.serverOrigin) async -> HTTPResponse? {
    guard let url = try? WebURL(request.url, base: "http://harness.invalid"), url.origin == origin else { return nil }
    var body: JSONValue?
    let type = request.headers.get("content-type") ?? ""
    if let data = request.body, !data.isEmpty, !type.lowercased().contains("octet-stream") {
      let text = String(decoding: data, as: UTF8.self)
      guard let parsed = try? JSONValue.parse(text) else {
        return Self.jsonResponse(400, FakeServer.failure("Invalid JSON body"))
      }
      body = parsed
    }
    var path = url.pathname
    while path.hasSuffix("/") { path.removeLast() }
    let answer = await handle(
      method: request.method.isEmpty ? "GET" : request.method.uppercased(), path: path, query: url.searchParams,
      headers: request.headers, body: body, raw: request.body)
    return Self.jsonResponse(answer.status, answer.body)
  }

  /// `jsonResponse(status, body)`: a 204 (a preflight's answer) carries no body.
  static func jsonResponse(_ status: Int, _ body: JSONValue?) -> HTTPResponse {
    if status == 204 { return HTTPResponse(status: status, headers: ["Access-Control-Allow-Origin": "*"]) }
    return HTTPResponse.json(body ?? .null, status: status, headers: ["Access-Control-Allow-Origin": "*"])
  }

  static func get(_ query: [(String, String)], _ name: String) -> String? {
    query.first { $0.0.jsEquals(name) }?.1
  }

  // MARK: The session check and sign-out (server/oauth/handlers/session.js, logout.js)

  /// A missing header carries no code, an unknown token carries
  /// FRONTEND_SESSION_INVALID. Lite reads only whether the grant row is
  /// there (and whether this server already found it refused); full
  /// restores it.
  func sessionRoute(_ headers: HTTPHeaders, _ query: [(String, String)]) -> ServerAnswer {
    guard let token = FakeServer.bearer(headers.get("authorization")) else {
      return ServerAnswer(401, ["success": false, "error": "Missing or invalid authorization header", "authenticated": false])
    }
    guard let did = state.withLock({ $0.tokens[token] }) else {
      return ServerAnswer(
        401,
        [
          "success": false, "error": "Invalid or expired session", "authenticated": false,
          "code": "FRONTEND_SESSION_INVALID",
        ])
    }
    let liteValue = Self.get(query, "lite")
    let lite = liteValue == "1" || liteValue == "true"
    let granted =
      lite
      ? state.withLock { $0.grants.contains(JSKey(did)) && !$0.knownRefused.contains(JSKey(did)) } : restoreGrant(did)
    let w = world.world(did)
    var out: [String: JSONValue] = [
      "success": true, "authenticated": true, "client": "virga", "oauthSessionMissing": .bool(!granted),
      "user": ["did": .string(did)],
    ]
    if lite { out["lite"] = true }
    if granted, let scope = w?.scope, !scope.isEmpty { out["scope"] = .string(scope) }
    if !lite, granted, let pds = w?.pdsUrl, !pds.isEmpty { out["pds"] = .string(pds) }
    return ServerAnswer(200, .object(out))
  }

  /// 200 whether or not the token was known, since there's nothing left to
  /// sign out either way.
  func logoutRoute(_ headers: HTTPHeaders, _ body: JSONValue?) -> ServerAnswer {
    guard let token = FakeServer.bearer(headers.get("authorization")) else {
      return ServerAnswer(200, ["success": true, "message": "No session to logout"])
    }
    let out = signOutToken(token, keepGrant: body?["keepGrant"] == .bool(true))
    return ServerAnswer(200, ["success": true, "message": "Logged out successfully", "grantRevoked": .bool(out.grantRevoked)])
  }

  // MARK: The terms ledger

  var currentTerms: [String: JSONValue] {
    ["version": .number(Double(LegalVersion.termsVersion)), "effectiveDate": .string(LegalVersion.termsEffectiveDate)]
  }

  func agreementOf(_ s: State, _ did: String, _ identity: String) -> TermsAgreement? {
    s.agreements.first {
      $0.did.jsEquals(did) && $0.terms_version == LegalVersion.termsVersion && $0.identity == identity
    }
  }

  /// GET /api/terms/status: only a session's own agreement counts.
  func termsStatus(_ headers: HTTPHeaders) throws -> ServerAnswer {
    let auth = try authOf(headers)
    let found = state.withLock { agreementOf($0, auth.did, "session") }
    var out = currentTerms
    out["success"] = true
    out["accepted"] = .bool(found != nil)
    out["acceptedAt"] = found.map { .string($0.accepted_at) } ?? .null
    return ServerAnswer(200, .object(out))
  }

  /// POST /api/terms/accept: with a token the account is the session's;
  /// without one it is the DID in the body, kept as a browser's own word.
  /// The first agreement stands, as the table's unique index makes it.
  func termsAccept(_ headers: HTTPHeaders, _ given: JSONValue?) throws -> ServerAnswer {
    if terms == "down" {
      return ServerAnswer(
        503, FakeServer.failure("agreements can't be recorded on Virga's server yet.", code: "UNAVAILABLE"))
    }
    var did = ""
    let identity: String
    if headers.get("authorization").map({ !$0.isEmpty }) ?? false {
      did = try authOf(headers).did
      identity = "session"
    } else {
      identity = "claimed"
    }
    // `body = {}` stands in for no body; a null one can't be read.
    let body = given ?? [:]
    if body.isNull { throw HarnessJSError.typeError("Cannot read properties of null (reading 'version')") }
    guard body["version"] == .number(Double(LegalVersion.termsVersion)) else {
      return ServerAnswer(
        409,
        FakeServer.failure(
          "the Terms of Service and Privacy Policy have changed. reload to read the current ones.", code: "TERMS_VERSION_MISMATCH",
          currentTerms))
    }
    if identity == "claimed" {
      guard case .string(let claimed)? = body["did"], Self.isClaimableDid(claimed) else {
        return ServerAnswer(400, FakeServer.failure("that isn't an account's DID.", code: "DID_INVALID"))
      }
      did = claimed
    }
    let at = World.iso(now())
    let agent = headers.get("user-agent").flatMap { $0.isEmpty ? nil : $0 }
    let (row, created) = state.withLock { s -> (TermsAgreement, Bool) in
      if let row = agreementOf(s, did, identity) { return (row, false) }
      let row = TermsAgreement(
        did: did, policy_version: LegalVersion.termsEffectiveDate, terms_version: LegalVersion.termsVersion, identity: identity,
        accepted_at: at, ip: "203.0.113.7", user_agent: agent)
      s.agreements.append(row)
      return (row, true)
    }
    if created { note("\(did) agreed to version \(LegalVersion.termsVersion) (\(identity))") }
    var out = currentTerms
    out["success"] = true
    out["identity"] = .string(identity)
    // A claim's answer says nothing about the row: the caller could be anyone.
    if identity == "claimed" { return ServerAnswer(200, .object(out)) }
    out["acceptedAt"] = .string(row.accepted_at)
    out["created"] = .bool(created)
    return ServerAnswer(200, .object(out))
  }

  /// `/^did:(plc|web):[A-Za-z0-9._:%-]+$/`.
  static func isClaimableDid(_ text: String) -> Bool {
    let units = Array(text.utf16)
    let plc = Array("did:plc:".utf16)
    let web = Array("did:web:".utf16)
    guard units.count > 8, Array(units.prefix(8)) == plc || Array(units.prefix(8)) == web else { return false }
    return units[8...].allSatisfy { u in
      (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) || (0x30...0x39).contains(u)
        || [0x2E, 0x5F, 0x3A, 0x25, 0x2D].contains(u)
    }
  }

  // MARK: The signed-in calls

  /// The refusals before a call goes anywhere: the web fake's proxyRoute,
  /// OAUTH_SESSION_MISSING above all. Nil when the call can go on, as the
  /// account the token names.
  func refusal(_ headers: HTTPHeaders) -> (ServerAnswer?, String?) {
    guard let token = FakeServer.bearer(headers.get("authorization")) else {
      return (ServerAnswer(401, FakeServer.failure("Missing or invalid authorization header")), nil)
    }
    guard let did = state.withLock({ $0.tokens[token] }) else {
      return (ServerAnswer(401, FakeServer.failure("Invalid or expired session", code: "FRONTEND_SESSION_INVALID")), nil)
    }
    if !restoreGrant(did) {
      return (
        ServerAnswer(
          401, FakeServer.failure("OAuth session missing. Automatic re-authentication required.", code: "OAUTH_SESSION_MISSING")),
        nil
      )
    }
    return (nil, did)
  }

  /// /api/oauth/proxy: the call named by X-XRPC-Method, made by the
  /// account's agent as server/oauth/handlers/proxy.js makes it.
  func proxyRoute(_ method: String, _ headers: HTTPHeaders, _ query: [(String, String)], _ body: JSONValue?) async
    -> ServerAnswer
  {
    let (refused, account) = refusal(headers)
    if let refused { return refused }
    guard let did = account else { return ServerAnswer(500, FakeServer.failure("Internal error")) }
    guard let xrpcMethod = headers.get("x-xrpc-method"), !xrpcMethod.isEmpty else {
      return ServerAnswer(400, FakeServer.failure("Missing X-XRPC-Method header"))
    }
    guard FakeServer.isSafeXrpcMethod(xrpcMethod) else {
      return ServerAnswer(400, FakeServer.failure("Invalid or unsupported XRPC method"))
    }
    if FakeServer.binaryOutput.contains(xrpcMethod) {
      return ServerAnswer(
        400,
        FakeServer.failure("\(xrpcMethod) answers in bytes and can't go through Virga's server; read it from the PDS directly."))
    }
    let isPost = method == "POST"
    let params = FakeServer.forwardedQuery(query)
    // `readJson(req)`: an object body, or none.
    var requestBody: JSONValue?
    if isPost, case .object(let members)? = body, !members.isEmpty { requestBody = body }
    let input: FakeXrpc.Input
    if let requestBody {
      input = .json(requestBody)
    } else if let members = params.objectValue, !members.isEmpty {
      input = .json(params)
    } else {
      input = .none
    }
    do {
      var agent = try agents(did)
      if let proxy = headers.get("x-atproto-proxy"), !proxy.isEmpty {
        let at = proxy.jsIndexOf("#")
        agent = at < 0 ? agent.withProxy("bsky_fg", proxy) : agent.withProxy(proxy.jsSlice(at + 1), proxy.jsSlice(0, at))
      }
      let answer = try await agent.handle(xrpcMethod, input)
      return ServerAnswer(200, ["success": true, "data": answer.data])
    } catch let error as HarnessRepo.XrpcError {
      return ServerAnswer(
        FakeServer.httpStatusForXrpcError(error.status), FakeServer.failure(error.message, code: error.error))
    } catch {
      return ServerAnswer(500, FakeServer.failure(jsMessage(error)))
    }
  }

  /// /api/oauth/upload-blob: the raw bytes, their type in `encoding`, put in
  /// the account's repo as server/oauth/handlers/uploadBlob.js does.
  func uploadRoute(_ headers: HTTPHeaders, _ query: [(String, String)], _ body: JSONValue?, _ raw: Data?) async
    -> ServerAnswer
  {
    let (refused, account) = refusal(headers)
    if let refused { return refused }
    guard let did = account else { return ServerAnswer(500, FakeServer.failure("Internal error")) }
    // `extractBlobPayload(body, encoding)`: a JSON envelope `{ blob, encoding }`,
    // or the raw bytes with the type in the query.
    var bytes: [UInt8]
    var encoding: String
    if case .object = body {
      guard case .string(let blob)? = body?["blob"], !blob.isEmpty else {
        return ServerAnswer(400, FakeServer.failure("Missing blob data"))
      }
      guard let type = body?["encoding"].jsTruthy else {
        return ServerAnswer(400, FakeServer.failure("Missing encoding/content-type"))
      }
      bytes = Self.lenientBase64(blob)
      encoding = type.stringValue ?? type.jsString
      if bytes.isEmpty { return ServerAnswer(400, FakeServer.failure("Missing blob data")) }
    } else {
      bytes = [UInt8](raw ?? Data())
      if bytes.isEmpty { return ServerAnswer(400, FakeServer.failure("Missing blob data")) }
      guard let type = Self.get(query, "encoding"), !type.isEmpty else {
        return ServerAnswer(400, FakeServer.failure("Missing encoding/content-type"))
      }
      encoding = type
    }
    do {
      let agent = try agents(did)
      let answer = try await agent.handle("com.atproto.repo.uploadBlob", .bytes(bytes), ["encoding": .string(encoding)])
      return ServerAnswer(200, ["success": true, "data": ["blob": answer.data["blob"] ?? .null]])
    } catch {
      let message = jsMessage(error)
      let lower = message.lowercased()
      if lower.contains("expired") || lower.contains("invalid") || lower.contains("unauthorized") {
        return ServerAnswer(401, FakeServer.failure("Session expired. Please re-authenticate.", code: "SESSION_EXPIRED"))
      }
      let status = (error as? HarnessRepo.XrpcError).map(\.status).flatMap { (400...599).contains($0) ? $0 : nil } ?? 500
      return ServerAnswer(status, FakeServer.failure(message.isEmpty ? "Internal error" : message))
    }
  }

  /// `Buffer.from(text, 'base64')`: Node's lenient reading (anything outside
  /// the alphabet skipped, decoding stopped at the padding).
  static func lenientBase64(_ text: String) -> [UInt8] {
    var units: [UInt16] = []
    for unit in text.utf16 {
      if unit == 0x3D { break }
      if unit == 0x2D { units.append(0x2B) } else if unit == 0x5F { units.append(0x2F) } else if JSBase64.value(unit) != nil {
        units.append(unit)
      }
    }
    if units.count % 4 == 1 { units.removeLast() }
    return (try? JSBase64.atob(String(decoding: units, as: UTF16.self))) ?? []
  }
}
