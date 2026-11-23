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
// with the upstream status, a read through another AppView that fails there
// asked once more of Bluesky's. The refusals before that (no token, a token
// the server doesn't know, a refused grant) are the web fake's own.
//
// Another addition, for the demo's sign-in sheet: /api/oauth/login, as
// server/oauth/handlers/login.js answers it, and `authorize(_:)`, the trip
// to the account's host (DemoAuthenticator), which mints a token as a
// sign-in does and sends the sheet back to the return page.
//
// The rest of the web fake's routes, scheduling, timers, the limits, the
// adviser and alt text, are in FakeServer+Schedule.swift and
// FakeServer+Timers.swift, the workers and the seeded rows in
// FakeServer+Workers.swift, and Defense's in FakeDefense.swift. Paths it
// doesn't know answer as the web's: 405 for a known path asked with another
// method, 404 for any other.
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

  /// The routes of the server's `api` table (every route but the session's,
  /// the terms' and the proxy's), as the web's `api` keys hold them.
  public static let apiRoutes: [(method: String, path: String)] =
    [
      ("POST", "/api/schedule/create"), ("GET", "/api/schedule/list"), ("GET", "/api/schedule/get"),
      ("GET", "/api/schedule/media"), ("POST", "/api/schedule/update"), ("POST", "/api/schedule/reorder"),
      ("POST", "/api/schedule/cancel"), ("POST", "/api/self-destruct/create"), ("GET", "/api/self-destruct/list"),
      ("POST", "/api/self-destruct/cancel"), ("GET", "/api/limits/status"), ("POST", "/api/ai/analyze-post"),
      ("POST", "/api/ai/synthesize-style"), ("POST", "/api/ai/alt-text"),
    ] + DemoDefense.routes

  /// The flags' per-feature limits as createServer's `limits` option (an
  /// unlimited one left out).
  public static func limitsOption(_ limits: HarnessFlags.Limits) -> JSONValue {
    var out: [String: JSONValue] = [:]
    if let n = limits.scheduledPosts { out["scheduledPosts"] = .number(n) }
    if let n = limits.postTimers { out["postTimers"] = .number(n) }
    if let n = limits.conditionalTimers { out["conditionalTimers"] = .number(n) }
    return .object(out)
  }

  /// The flags' AI allowances as createServer's `aiLimits` option (an
  /// unlimited one null).
  public static func aiLimitsOption(_ limits: HarnessFlags.AILimits) -> JSONValue {
    [
      "adviser": limits.adviser.map(JSONValue.number) ?? .null, "altText": limits.altText.map(JSONValue.number) ?? .null,
      "style": limits.style.map(JSONValue.number) ?? .null,
    ]
  }

  // MARK: The proxy, as server/oauth/handlers/proxy.js reads a call

  /// Params the proxy hands the SDK as booleans (`BOOLEAN_PARAMS`).
  public static let booleanParams = ["reverse", "validate", "includeTakedowns", "includeItemCount", "includePins"]
  /// … as numbers (`NUMERIC_PARAMS`).
  public static let numericParams = ["limit", "depth", "parentHeight"]
  /// … as lists, split on commas when sent as one (`ARRAY_PARAMS`).
  public static let arrayParams = ["feeds", "uris", "actors", "dids", "handles", "members", "labelers"]
  /// Bluesky's AppView as a proxy header (`BLUESKY_APPVIEW_PROXY`): what a
  /// read through another AppView falls back to.
  public static let blueskyAppviewProxy = "did:web:api.bsky.app#bsky_appview"

  /// The keys of `Array.prototype` (Node 22's V8), which a params object
  /// whose prototype became an array sees as its own.
  static let arrayPrototypeKeys = [
    "length", "constructor", "at", "concat", "copyWithin", "fill", "find", "findIndex", "findLast", "findLastIndex",
    "lastIndexOf", "pop", "push", "reverse", "shift", "unshift", "slice", "sort", "splice", "includes", "indexOf", "join",
    "keys", "entries", "values", "forEach", "filter", "flat", "flatMap", "map", "every", "some", "reduce", "reduceRight",
    "toReversed", "toSorted", "toSpliced", "with", "toLocaleString", "toString",
  ]
  /// Outputs that are bytes, not JSON (`BINARY_OUTPUT`).
  public static let binaryOutput = ["com.atproto.sync.getRepo", "com.atproto.sync.getBlob", "com.atproto.sync.getRecord"]

  /// `forwardedQuery(req)`: the call's params from its query string, with
  /// repeated keys as lists and the known non-string params coerced for the
  /// SDK. `method` is never forwarded, nor the router's own `action=proxy`.
  public static func forwardedQuery(_ pairs: [(String, String)]) -> JSONValue {
    var params: [(String, JSONValue)] = []
    func index(_ key: String) -> Int? { params.firstIndex { $0.0.jsEquals(key) } }
    // `params = {}` is a plain object, and `key in params` sees its
    // prototype's keys too (server/oauth/handlers/proxy.js; a bug of the
    // real server's, kept): a param named after one is first
    // `[].concat(<function>, value)`, which JSON holds as `[null, value]`.
    // `__proto__=x` sets the object's prototype to `[<prototype>, 'x']`, so
    // it is never a param of its own, and from then on the array's keys
    // (`length`, its indexes, Array.prototype's methods, `reverse` among
    // them) are "in" it too.
    var proto: [JSONValue]?
    func inherited(_ key: String) -> JSONValue?? {
      if let proto {
        if key == "length" { return .some(.number(Double(proto.count))) }
        if let i = Int(key), String(i) == key, i >= 0, i < proto.count { return .some(proto[i]) }
        if arrayPrototypeKeys.contains(key) { return .some(nil) }
      }
      return FakeXrpc.objectPrototypeKeys.contains(key) ? .some(nil) : nil
    }
    for (key, value) in pairs {
      if key == "__proto__" {
        // `[].concat(params.__proto__, value)`: an array prototype is spread.
        proto = (proto ?? [[:]]) + [.string(value)]
      } else if let i = index(key) {
        switch params[i].1 {
        case .array(let held): params[i].1 = .array(held + [.string(value)])
        default: params[i].1 = .array([params[i].1, .string(value)])
        }
      } else if let held = inherited(key) {
        // A function is null in JSON.
        params.append((key, .array([held ?? .null, .string(value)])))
      } else {
        params.append((key, .string(value)))
      }
    }
    if let i = index("action"), params[i].1 == .string("proxy") { params.remove(at: i) }
    if let i = index("method") { params.remove(at: i) }
    for name in booleanParams {
      if let i = index(name) {
        params[i].1 = .bool(params[i].1 == .string("true"))
      } else if case .some = inherited(name) {
        // Array.prototype.reverse, once the prototype is an array: not 'true'.
        params.append((name, false))
      }
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

/// Virga's server, in memory (`createServer`): the sessions, the terms
/// ledger, the proxy, scheduling, timers, the limits, the adviser and alt
/// text, Defense's routes, and the workers that act on them (`runCron`).
public final class DemoServer: Sendable {
  public let world: DemoWorld
  /// How the terms ledger starts: 'agreed' (every account has agreed, so
  /// the app opens), 'ask' (nobody has) or 'down' (nobody has, and an
  /// agreement can't be recorded).
  public let terms: String
  /// The per-feature limits (`featureLimits`): a feature absent is unlimited.
  public let featureLimits: [String: Int]
  /// The monthly AI allowances (`aiAllowance`): a kind absent is unlimited.
  public let aiAllowance: [String: Int]
  /// How long an AI answer takes, in ms.
  public let aiDelayMs: Double
  /// 'ok', 'slow' (longer than the adviser waits) or 'down' (503).
  public let ai: String
  /// Defense's routes and list writer, on the same tick.
  public let defense: DemoDefense
  /// Where a time written without an offset is read (the browser's zone on the web).
  public let timeZone: TimeZone
  let now: @Sendable () -> Double
  let sleep: @Sendable (Double) async -> Void
  let randomBytes: @Sendable (Int) -> [UInt8]
  let uuid: @Sendable () -> String
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
    /// Scheduled posts, as the table holds them (never removed).
    var scheduled: [ScheduledRow] = []
    /// Timers, as the table holds them (never removed).
    var timers: [TimerRow] = []
    /// `${rowId}/${mediaId}` → the stashed bytes.
    var media: [JSKey: StashedMedia] = [:]
    /// `${did}:${kind}:${month}` → how many answers the month has had.
    var aiUsage: [JSKey: Int] = [:]
  }

  let state: Locked<State>

  /// - Parameters:
  ///   - world: the accounts' worlds.
  ///   - terms: how the ledger starts ('agreed', 'ask', 'down' or 'newer').
  ///   - limits: the per-feature limits, as the server reads its env
  ///     (`{ scheduledPosts, postTimers, conditionalTimers }`, each a
  ///     positive whole number or left out for unlimited).
  ///   - aiLimits: the monthly AI allowances (`{ adviser, altText, style }`:
  ///     null is unlimited, absent is 30 / 15 / 3).
  ///   - seed: whether Mira starts with a few rows.
  ///   - aiDelayMs: how long an AI answer takes.
  ///   - ai: 'ok', 'slow' or 'down'.
  ///   - defenseWrites: whether "DEFENSE_WRITES" is on.
  ///   - moderator: 'on', 'off' or 'linked'.
  ///   - now: `Date.now()` (cut to whole milliseconds, as the web's is).
  ///   - sleep: the AI's wait.
  ///   - timeZone: where a time without an offset is read; the world's by default.
  ///   - randomBytes: the tokens' randomness (`crypto.getRandomValues`).
  ///   - uuid: `crypto.randomUUID()`, for the rows' ids.
  ///   - random: `Math.random()`, for Defense's link codes.
  ///   - tidClockId: the clock id of Defense's record keys (random on the web).
  ///   - agents: the account's fake agent, which the proxy forwards to (the
  ///     harness's `agentFor`). By default one with no latency, reading
  ///     its world's grant at each call, as agentFor's do.
  public init(
    world: DemoWorld,
    terms: String = "agreed",
    limits: JSONValue = [:],
    aiLimits: JSONValue = [:],
    seed: Bool = true,
    aiDelayMs: Double = 900,
    ai: String = "ok",
    defenseWrites: Bool = true,
    moderator: String = "on",
    now given: @escaping @Sendable () -> Double,
    sleep: @escaping @Sendable (Double) async -> Void = NetworkClock.live.sleep,
    timeZone: TimeZone? = nil,
    randomBytes: @escaping @Sendable (Int) -> [UInt8] = { count in (0..<count).map { _ in UInt8.random(in: 0...255) } },
    uuid: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() },
    random: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) },
    tidClockId: UInt64 = UInt64.random(in: 0..<1024),
    agents: (@Sendable (String) throws -> FakeAgent)? = nil
  ) {
    let now: @Sendable () -> Double = { given().rounded(.down) }
    self.world = world
    self.terms = terms
    self.now = now
    self.sleep = sleep
    self.timeZone = timeZone ?? world.timeZone
    self.randomBytes = randomBytes
    self.uuid = uuid
    self.aiDelayMs = aiDelayMs
    self.ai = ai
    var features: [String: Int] = [:]
    for feature in FakeServer.features {
      if let limit = FakeServer.limitValue(limits[feature]) { features[feature] = limit }
    }
    featureLimits = features
    var allowance: [String: Int] = [:]
    for (kind, fallback) in [("adviser", 30), ("style", 3), ("altText", 15)] {
      if let limit = FakeServer.aiLimitValue(aiLimits[kind], fallback) { allowance[kind] = limit }
    }
    aiAllowance = allowance
    if let agents {
      self.agents = agents
    } else {
      let made = Locked<[JSKey: FakeAgent]>([:])
      self.agents = { [world] did in
        guard world.world(did) != nil else { throw DemoWorldError.noAccount(did) }
        return made.withLock { held in
          if let agent = held[JSKey(did)] { return agent }
          let agent = FakeAgent(
            world: world, did: did, scope: { world.world(did)?.scope }, clock: NetworkClock(now: now, sleep: { _ in }))
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
    let state = Locked(start)
    self.state = state
    defense = DemoDefense(
      world: world, writes: defenseWrites, moderator: moderator, now: now,
      note: { line in DemoServer.note(state, now, line) }, random: random, clockId: tidClockId)
    if seed { try? state.withLock { try seedRows(&$0) } }
  }

  // MARK: Sessions

  func note(_ line: String) { Self.note(state, now, line) }

  /// `note(line)` from outside the lock (Defense's).
  static func note(_ state: Locked<State>, _ now: () -> Double, _ line: String) {
    let at = World.iso(now())
    state.withLock { s in Self.note(&s, at: at, line) }
  }

  /// `note(line)` under the lock: the log keeps the last 200 lines.
  static func note(_ s: inout State, at: String, _ line: String) {
    s.log.append((at, line))
    if s.log.count > 200 { s.log.removeFirst() }
  }

  func note(_ s: inout State, _ line: String) { Self.note(&s, at: World.iso(now()), line) }

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
  /// The scheduled posts, as the table holds them.
  public var scheduled: [ScheduledRow] { state.withLock { $0.scheduled } }
  /// The timers, as the table holds them.
  public var timers: [TimerRow] { state.withLock { $0.timers } }

  /// Changes the rows under the server's lock, as a test reaches into
  /// `inspect()` (fakeServer.test.js fills the timers to the cap that way).
  public func withRows<R>(_ body: (inout [ScheduledRow], inout [TimerRow]) throws -> R) rethrows -> R {
    try state.withLock { try body(&$0.scheduled, &$0.timers) }
  }

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
      guard FakeServer.apiRoutes.contains(where: { $0.method == method && $0.path == path }) else {
        let known = FakeServer.apiRoutes.contains { $0.path == path }
        return known
          ? ServerAnswer(405, FakeServer.failure("Method not allowed")) : ServerAnswer(404, FakeServer.failure("Not found"))
      }
      let did = try authOf(headers).did
      return try await api(method, path, did: did, query: query, body: body)
    } catch let coded as Coded {
      return ServerAnswer(coded.status, coded.body)
    } catch {
      return ServerAnswer(500, FakeServer.failure("something went wrong. please try again.", code: "INTERNAL"))
    }
  }

  /// `api[\`${method} ${path}\`](auth, { query, body })`.
  func api(_ method: String, _ path: String, did: String, query: [(String, String)], body: JSONValue?) async throws
    -> ServerAnswer
  {
    switch (method, path) {
    case ("POST", "/api/schedule/create"): return try scheduleCreate(did, body)
    case ("GET", "/api/schedule/list"): return scheduleList(did)
    case ("GET", "/api/schedule/get"): return try scheduleGet(did, query)
    case ("GET", "/api/schedule/media"): return try scheduleMedia(did, query)
    case ("POST", "/api/schedule/update"): return try scheduleUpdate(did, body)
    case ("POST", "/api/schedule/reorder"): return try scheduleReorder(did, body)
    case ("POST", "/api/schedule/cancel"): return try scheduleCancel(did, body, query)
    case ("POST", "/api/self-destruct/create"): return try timerCreate(did, body)
    case ("GET", "/api/self-destruct/list"): return timerList(did, query)
    case ("POST", "/api/self-destruct/cancel"): return try timerCancel(did, body, query)
    case ("GET", "/api/limits/status"): return try limitsStatus(did)
    case ("POST", "/api/ai/analyze-post"): return try await analyzePostRoute(did, body)
    case ("POST", "/api/ai/synthesize-style"): return try await synthesizeStyleRoute(did, body)
    case ("POST", "/api/ai/alt-text"): return try await altTextRoute(did, body)
    default:
      guard let answer = try defense.handle(method, path, did: did, query: query, body: body) else {
        return ServerAnswer(404, FakeServer.failure("Not found"))
      }
      return answer
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

  /// With terms=newer the server's documents are a version ahead of the
  /// app's, as they are for an iOS build made before a bump: nobody has
  /// agreed to them, and an agreement to the app's own version is refused.
  var serverTermsVersion: Int { terms == "newer" ? LegalVersion.termsVersion + 1 : LegalVersion.termsVersion }

  var currentTerms: [String: JSONValue] {
    ["version": .number(Double(serverTermsVersion)), "effectiveDate": .string(LegalVersion.termsEffectiveDate)]
  }

  func agreementOf(_ s: State, _ did: String, _ identity: String) -> TermsAgreement? {
    s.agreements.first {
      $0.did.jsEquals(did) && $0.terms_version == serverTermsVersion && $0.identity == identity
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
    guard body["version"] == .number(Double(serverTermsVersion)) else {
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
        did: did, policy_version: LegalVersion.termsEffectiveDate, terms_version: serverTermsVersion, identity: identity,
        accepted_at: at, ip: "203.0.113.7", user_agent: agent)
      s.agreements.append(row)
      return (row, true)
    }
    if created { note("\(did) agreed to version \(serverTermsVersion) (\(identity))") }
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
    // `executeXrpcCall(session, proxyHeader)`.
    func call(_ proxy: String?) async throws -> JSONValue {
      var agent = try agents(did)
      if let proxy, !proxy.isEmpty {
        let at = proxy.jsIndexOf("#")
        agent = at < 0 ? agent.withProxy("bsky_fg", proxy) : agent.withProxy(proxy.jsSlice(at + 1), proxy.jsSlice(0, at))
      }
      return try await agent.handle(xrpcMethod, input).data
    }
    // `sendXrpcError(err)`.
    func failed(_ error: any Error) -> ServerAnswer {
      if let error = error as? HarnessRepo.XrpcError {
        return ServerAnswer(FakeServer.httpStatusForXrpcError(error.status), FakeServer.failure(error.message, code: error.error))
      }
      return ServerAnswer(500, FakeServer.failure(jsMessage(error)))
    }
    let customProxy = headers.get("x-atproto-proxy")
    let usingCustomAppView = (customProxy.map { !$0.isEmpty } ?? false) && customProxy != FakeServer.blueskyAppviewProxy
    do {
      return ServerAnswer(200, ["success": true, "data": try await call(customProxy)])
    } catch {
      // A read whose chosen AppView failed (no status, a 5xx or the SDK's
      // InvalidResponse) tries Bluesky's once; not a write.
      let status = (error as? HarnessRepo.XrpcError)?.status ?? 0
      let upstreamFailure = status == 0 || status >= 500 || status == 2
      if !isPost && usingCustomAppView && upstreamFailure {
        do {
          return ServerAnswer(200, ["success": true, "data": try await call(FakeServer.blueskyAppviewProxy)])
        } catch {
          return failed(error)
        }
      }
      return failed(error)
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
