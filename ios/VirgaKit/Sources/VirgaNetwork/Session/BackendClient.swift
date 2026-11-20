// Ports src/session/backendClient.js
//
// Talking to Virga's server for an account with a long session: the only
// kind of session the iOS app has. The server is a confidential OAuth
// client: it holds the account's atproto session, and the app holds an
// opaque token (`vg_…`) for it. Signed-in calls go to the server, which
// makes them as the account:
//
//   XRPC       /api/oauth/proxy         (BackendFetchHandler, under XRPCAgent)
//   blobs      /api/oauth/upload-blob   (BackendFetchHandler)
//   the rest   /api/*                   (VirgaBackend: scheduling, timers, the adviser, terms, Defense)
//
// This file has the module's constants, the address of an endpoint, the
// sign-in's request and return, the session checks and the sign-out.
// BackendFetchHandler.swift and VirgaBackend.swift have the rest of it.
//
// Where the web reads the page (`location.origin` when backendUrl is '',
// `history.replaceState` to take the token out of the address bar), the
// iOS app has no page: its server address is always configured, and the
// sign-in comes back through ASWebAuthenticationSession, never the address
// bar, so `origin` is a parameter and stripReturnFromAddress has nothing to
// do (VirgaUI). startBackendSignIn returns the address to open instead of
// navigating away and never settling.

import Foundation
import VirgaCore

/// An error from Virga's server or the calls to it, with the fields the web
/// sets on its Error objects: `status`, `code` (the server's, or the
/// client's own such as NETWORK_ERROR), `detail` and `payload`.
public struct BackendError: Error, Sendable, Hashable, LocalizedError, CustomStringConvertible {
  /// The JavaScript error's name: Error, TypeError or AbortError.
  public var name: String
  public var message: String
  public var status: Int?
  /// The code, as the server sent it (normally a string).
  public var code: JSONValue?
  public var detail: String?
  public var payload: JSONValue?

  public init(
    name: String = "Error",
    message: String,
    status: Int? = nil,
    code: JSONValue? = nil,
    detail: String? = nil,
    payload: JSONValue? = nil
  ) {
    self.name = name
    self.message = message
    self.status = status
    self.code = code
    self.detail = detail
    self.payload = payload
  }

  /// The code when it is a string.
  public var codeString: String? { code?.stringValue }

  public var errorDescription: String? { message }
  public var description: String { "\(name)(\(status.map(String.init) ?? "-") \(code?.jsString ?? "null")): \(message)" }

  /// The fields a fixture records.
  public var json: JSONValue {
    [
      "name": .string(name),
      "message": .string(message),
      "status": status.map { .number(Double($0)) } ?? .null,
      "code": code ?? .null,
      "detail": detail.map(JSONValue.string) ?? .null,
      "payload": payload ?? .null,
    ]
  }
}

public enum BackendClient {
  public static let proxyTimeoutMs: Double = 60_000
  /// An upload's deadline is its caller's (blobs.js); this one only stops a
  /// call with none from hanging for ever.
  public static let uploadFallbackTimeoutMs: Double = 10 * 60_000
  public static let liteTimeoutMs: Double = 8_000
  public static let sessionTimeoutMs: Double = 20_000

  public static let signinPendingKey = "virga:signin-pending"

  /// Where each sign-in endpoint lives on Virga's server.
  public enum BackendPaths {
    public static let login = "/api/oauth/login"
    public static let session = "/api/oauth/session"
    public static let proxy = "/api/oauth/proxy"
    public static let uploadBlob = "/api/oauth/upload-blob"
    public static let logout = "/api/oauth/logout"

    public static let all: [(String, String)] = [
      ("login", login), ("session", session), ("proxy", proxy), ("uploadBlob", uploadBlob), ("logout", logout),
    ]
  }

  /// Outputs that are bytes, not JSON: the proxy answers in a JSON envelope,
  /// so these can't go through it, and Virga reads them from the PDS.
  static let binaryOutput: Set<String> = ["com.atproto.sync.getRepo", "com.atproto.sync.getBlob", "com.atproto.sync.getRecord"]

  /// What a request answers when there is no token to send: the server's
  /// own 401, without asking it.
  static let noTokenEnvelope: JSONValue = [
    "success": false, "code": "FRONTEND_SESSION_INVALID", "error": "Not signed in through Virga’s server",
  ]

  // MARK: Addresses

  /// `backendAddress(backendUrl, path)`: `path` on Virga's server, under
  /// `backendUrl` (or `origin`, the page's, when it is empty). Appended, not
  /// resolved, so a `backendUrl` with a path prefix keeps it.
  public static func backendAddress(_ backendUrl: String?, _ path: String, origin: String? = nil) throws -> WebURL {
    let base = ((backendUrl?.isEmpty == false ? backendUrl : nil) ?? origin ?? "").jsRemovingTrailingSlashes()
    if base.isEmpty {
      throw BackendError(name: "TypeError", message: "Virga’s server has no address here (pass backendUrl)")
    }
    return try WebURL("\(base)\(path.jsStartsWith("/") ? "" : "/")\(path)")
  }

  // MARK: The pending sign-in

  /// What startBackendSignIn keeps for the return: the nonce in the return
  /// address, and what the sign-in was for.
  public struct SigninPending: Sendable, Hashable {
    public var nonce: String
    public var mode: String
    public var intent: String
    public var did: String?
    public var at: Double

    public init(nonce: String, mode: String = "backend", intent: String = "add", did: String? = nil, at: Double) {
      self.nonce = nonce
      self.mode = mode
      self.intent = intent
      self.did = did
      self.at = at
    }

    /// `JSON.stringify({ nonce, mode, intent, did, at })`, in that order.
    public var jsonString: String {
      let didText = did.map(JSONStringify.quote) ?? "null"
      return "{\"nonce\":\(JSONStringify.quote(nonce)),\"mode\":\(JSONStringify.quote(mode)),\"intent\":\(JSONStringify.quote(intent)),\"did\":\(didText),\"at\":\(JSNumber.format(at))}"
    }

    public var json: JSONValue {
      ["nonce": .string(nonce), "mode": .string(mode), "intent": .string(intent), "did": did.map(JSONValue.string) ?? .null,
       "at": .number(at)]
    }
  }

  /// `readSigninPending(storage)`: what was stored, when it has a string
  /// nonce; nil otherwise or when it can't be read.
  public static func readSigninPending(_ storage: (any KeyValueStore)?) -> JSONValue? {
    let raw = storage?.getItem(signinPendingKey) ?? ""
    guard let value = try? JSONValue.parse(raw.isEmpty ? "null" : raw) else { return nil }
    guard value.isTruthy, value["nonce"]?.stringValue != nil else { return nil }
    return value
  }

  /// `writeSigninPending(storage, pending)`. A storage that refuses is
  /// ignored: the return is then refused, and the person signs in again.
  public static func writeSigninPending(_ storage: (any KeyValueStore)?, _ pending: SigninPending) {
    try? storage?.setItem(signinPendingKey, pending.jsonString)
  }

  /// `writeSigninPending(storage, pending)` for any JSON.
  public static func writeSigninPending(_ storage: (any KeyValueStore)?, _ pending: JSONValue) {
    try? storage?.setItem(signinPendingKey, JSONStringify.stringify(pending))
  }

  public static func clearSigninPending(_ storage: (any KeyValueStore)?) {
    storage?.removeItem(signinPendingKey)
  }

  // MARK: The login request

  /// What a sign-in may ask the account's host to show first; the server
  /// takes these four and no others.
  public static let signinPrompts = ["login", "consent", "select_account", "create"]

  /// `signInPrompt(prompt)`: the prompt if a sign-in may send it.
  public static func signInPrompt(_ prompt: String?) -> String? {
    guard let prompt, signinPrompts.contains(prompt) else { return nil }
    return prompt
  }

  public struct LoginRequest: Sendable, Hashable {
    public var url: String
    public var returnUrl: String
  }

  /// `buildLoginRequest(...)`: the address the server is asked for, and
  /// where it sends the person back. `defense` is what the web passes:
  /// true or "scan" asks for Defense's scan permissions, "lists" for the
  /// lists' too, anything else for neither.
  public static func buildLoginRequest(
    backendUrl: String?,
    handle: String,
    origin: String,
    returnPath: String,
    nonce: String,
    prompt: String? = nil,
    defense: JSONValue = false
  ) throws -> LoginRequest {
    var returnUrl = try WebURL(returnPath, base: origin)
    returnUrl.setSearch(JSURI.searchParams([("n", nonce)]))
    var url = try backendAddress(backendUrl, BackendPaths.login, origin: origin)
    url.setSearchParam("handle", handle)
    url.setSearchParam("redirect_uri", returnUrl.href)
    if let prompt = signInPrompt(prompt) { url.setSearchParam("prompt", prompt) }
    if defense == .bool(true) || defense == .string("scan") {
      url.setSearchParam("defense", "1")
    } else if defense == .string("lists") {
      url.setSearchParam("defense", "lists")
    }
    return LoginRequest(url: url.href, returnUrl: returnUrl.href)
  }

  /// Sixteen random bytes as hex: the sign-in's nonce.
  public static func randomNonce(_ bytes: [UInt8]) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
  }

  /// `startBackendSignIn(...)`. Fetches the login address as JSON (so a
  /// handle that doesn't resolve, or a server that's down, comes back as an
  /// error to word), keeps the nonce in `sessionStorage` and returns the
  /// authorization address, handing it to `assign` too. The app opens it in
  /// ASWebAuthenticationSession; the return is read by readBackendReturn.
  ///
  /// Throws BackendError: code CANCELLED (an AbortError) when the task was
  /// cancelled before the address came back, NETWORK_ERROR (a TypeError)
  /// when the server couldn't be reached, else the server's code and status.
  @discardableResult
  public static func startBackendSignIn(
    backendUrl: String?,
    handle: String,
    origin: String,
    returnPath: String,
    mode: String = "backend",
    intent: String = "add",
    did: String? = nil,
    prompt: String? = nil,
    defense: JSONValue = false,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock,
    randomBytes: @Sendable (Int) -> [UInt8] = { count in (0..<count).map { _ in UInt8.random(in: 0...255) } },
    sessionStorage: (any KeyValueStore)?,
    assign: @Sendable (String) -> Void = { _ in }
  ) async throws -> String {
    let nonce = randomNonce(randomBytes(16))
    let request = try buildLoginRequest(
      backendUrl: backendUrl, handle: handle, origin: origin, returnPath: returnPath, nonce: nonce, prompt: prompt,
      defense: defense)
    let calledOff = BackendError(name: "AbortError", message: "The sign-in was called off", code: "CANCELLED")
    // A fetch whose signal is already aborted rejects without sending.
    if Task.isCancelled { throw calledOff }
    let response: HTTPResponse
    do {
      response = try await transport.send(
        HTTPRequest(url: request.url, headers: ["Accept": "application/json"], timeoutMs: sessionTimeoutMs))
    } catch {
      if Task.isCancelled || error is CancellationError { throw calledOff }
      throw BackendError(name: "TypeError", message: "Failed to fetch", code: "NETWORK_ERROR")
    }
    let body = response.jsonOrNull()
    if Task.isCancelled { throw calledOff }
    guard response.ok, body?["success"]?.isTruthy == true, let authUrl = body?["authUrl"]?.stringValue else {
      let message = body?["error"]?.stringValue ?? "Sign-in couldn’t start (HTTP \(response.status))"
      let code = body?["code"].truthy
      throw BackendError(message: message, status: response.status, code: code)
    }
    writeSigninPending(sessionStorage, SigninPending(nonce: nonce, mode: mode, intent: intent, did: did, at: clock.now()))
    assign(authUrl)
    return authUrl
  }

  // MARK: The return

  /// The address the sign-in came back to: `{ pathname, search, hash }`.
  public struct ReturnLocation: Sendable, Hashable {
    public var pathname: String
    public var search: String
    public var hash: String

    public init(pathname: String, search: String = "", hash: String = "") {
      self.pathname = pathname
      self.search = search
      self.hash = hash
    }

    /// The parts of a URL, as `location` has them.
    public init(_ url: WebURL) {
      self.init(pathname: url.pathname, search: url.search, hash: url.hash)
    }
  }

  /// A return that failed: `error.params.get('error')` is `code`.
  public struct ReturnError: Error, Sendable, Hashable, LocalizedError {
    public var code: String
    public var message: String
    /// `error.params`: `error` and, when there is one, `error_description`.
    public var params: [String: String]

    init(_ code: String, _ description: String?) {
      self.code = code
      self.message = (description?.isEmpty == false ? description : nil) ?? code
      var params = ["error": code]
      if let description, !description.isEmpty { params["error_description"] = description }
      self.params = params
    }

    public var errorDescription: String? { message }
  }

  public enum BackendReturn: Sendable, Hashable {
    /// The sign-in finished: the account and its token. `intent` is the
    /// pending sign-in's (normally "add" or "reauth").
    case session(did: String, token: String, intent: JSONValue, pending: JSONValue)
    /// It failed; `orphanToken` is a well-formed token that was refused, to
    /// be signed out rather than left alive on the server.
    case error(ReturnError, orphanToken: String?)

    /// The web's object, for a fixture.
    public var json: JSONValue {
      switch self {
      case .session(let did, let token, let intent, let pending):
        return ["kind": "session", "did": .string(did), "token": .string(token), "intent": intent, "pending": pending]
      case .error(let error, let orphanToken):
        var out: JSONValue = [
          "kind": "error",
          "error": [
            "message": .string(error.message), "code": .string(error.code),
            "params": .object(error.params.mapValues(JSONValue.string)),
          ],
        ]
        if let orphanToken { out["orphanToken"] = .string(orphanToken) }
        return out
      }
    }
  }

  /// `readBackendReturn(location, pending, returnPath)`: nil when this isn't
  /// a return. A token is taken only from the fragment and only when the
  /// nonce in the address is the one this sign-in sent; an error return
  /// carries no token, so it is shown even without the nonce.
  public static func readBackendReturn(_ location: ReturnLocation, _ pending: JSONValue?, _ returnPath: String) -> BackendReturn? {
    guard location.pathname.jsEquals(returnPath) || location.pathname.jsEquals("\(returnPath)/") else { return nil }
    let query = JSURI.parseSearchParams(location.search)
    var hash = location.hash
    if hash.unicodeScalars.first == "#" { hash.unicodeScalars.removeFirst() }
    let fragment = JSURI.parseSearchParams(hash)
    func get(_ pairs: [(String, String)], _ name: String) -> String? { pairs.first { $0.0.jsEquals(name) }?.1 }
    func truthy(_ text: String?) -> String? { text?.isEmpty == false ? text : nil }

    if let code = truthy(get(query, "error")) ?? truthy(get(fragment, "error")) {
      let description = truthy(get(query, "error_description")) ?? truthy(get(fragment, "error_description"))
      return .error(ReturnError(code, description), orphanToken: nil)
    }

    let token = get(fragment, "session")
    let did = get(fragment, "did")
    if truthy(token) == nil && truthy(did) == nil { return nil }
    let nonce = get(query, "n")
    // `pending.nonce !== nonce`: the same string, code unit for code unit.
    // (JSONValue's == compares strings by canonical equivalence.)
    var nonceMatches = false
    if case .string(let held)? = pending?["nonce"], let nonce { nonceMatches = held.jsEquals(nonce) }
    if pending.truthy.isPresent == false || truthy(nonce) == nil || !nonceMatches {
      let error = ReturnError("unexpected_return", "This sign-in wasn’t started from this tab, so it was ignored.")
      return .error(error, orphanToken: isToken(token ?? "") ? token : nil)
    }
    guard let token, isToken(token), let did, isDid(did) else {
      return .error(ReturnError("callback_failed", "The sign-in came back without a usable session."), orphanToken: nil)
    }
    let intent = pending?["intent"].truthy ?? "add"
    return .session(did: did, token: token, intent: intent, pending: pending ?? .null)
  }

  /// `/^vg_[0-9a-f]{64}$/`.
  public static func isToken(_ text: String) -> Bool {
    let units = Array(text.utf8)
    guard units.count == 67, units[0] == 0x76, units[1] == 0x67, units[2] == 0x5F else { return false }
    return units[3...].allSatisfy { (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }
  }

  /// `/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/`.
  static func isDid(_ text: String) -> Bool {
    let units = Array(text.utf8)
    guard units.count > 4, units[0...3].elementsEqual("did:".utf8) else { return false }
    var i = 4
    let methodStart = i
    while i < units.count, (0x61...0x7A).contains(units[i]) { i += 1 }
    guard i > methodStart, i < units.count, units[i] == 0x3A else { return false }
    i += 1
    let rest = units[i...]
    guard !rest.isEmpty else { return false }
    return rest.allSatisfy { b in
      (0x61...0x7A).contains(b) || (0x41...0x5A).contains(b) || (0x30...0x39).contains(b) || b == 0x2E || b == 0x5F
        || b == 0x3A || b == 0x25 || b == 0x2D
    }
  }

  /// `strippedReturnAddress(location)`: the path alone.
  public static func strippedReturnAddress(_ location: ReturnLocation) -> String { location.pathname }

  // MARK: Errors from the server's own API

  /// `requestError(status, body)`: the error a failed call to Virga's server
  /// throws. Its endpoints don't share one shape: some put a code in
  /// `code`, the AI ones put it in `error` (`monthly_limit`), most put a
  /// sentence in `error`.
  public static func requestError(_ status: Int, _ body: JSONValue?) -> BackendError {
    let detail = body?["error"]?.stringValue
    var code: JSONValue? = body?["code"].nonNull
    if !code.isPresent, let error = detail, isSnakeCode(error) {
      code = .string(error)
    }
    let message =
      (detail?.isEmpty == false ? detail : nil)
      ?? (body?["message"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 }
      ?? "Virga’s server answered \(status == 0 ? "nothing" : String(status))"
    return BackendError(message: message, status: status, code: code, detail: detail, payload: body.nonNull)
  }

  /// `/^[a-z_]+$/`.
  static func isSnakeCode(_ text: String) -> Bool {
    !text.isEmpty && text.utf8.allSatisfy { (0x61...0x7A).contains($0) || $0 == 0x5F }
  }

  // MARK: Session checks and sign-out

  /// `{ ok, status, data }`, the raw answer of a session check.
  public struct SessionRead: Sendable, Hashable {
    public var ok: Bool
    public var status: Int
    public var data: JSONValue?

    public var json: JSONValue { ["ok": .bool(ok), "status": .number(Double(status)), "data": data ?? .null] }
  }

  static func sessionRead(
    backendUrl: String?, token: String, transport: any HTTPTransport, lite: Bool, timeoutMs: Double, origin: String?
  ) async -> SessionRead {
    do {
      let url = try backendAddress(backendUrl, BackendPaths.session, origin: origin).href + (lite ? "?lite=1" : "")
      let response = try await transport.send(
        HTTPRequest(method: "GET", url: url, headers: ["Authorization": "Bearer \(token)"], timeoutMs: backendDeadline(timeoutMs)))
      return SessionRead(ok: response.ok, status: response.status, data: response.jsonOrNull())
    } catch {
      // Unreachable or timed out: nothing is known.
      return SessionRead(ok: false, status: 0, data: nil)
    }
  }

  /// `checkBackendSession(...)`: the side-effect-free check, one row read on
  /// the server, no refresh. Never throws. A `timeoutMs` of 0 is no deadline,
  /// as the web's `withDeadline` reads it.
  public static func checkBackendSession(
    backendUrl: String?,
    token: String,
    transport: any HTTPTransport = HTTP.transport,
    timeoutMs: Double = liteTimeoutMs,
    origin: String? = nil
  ) async -> SessionRead {
    await sessionRead(backendUrl: backendUrl, token: token, transport: transport, lite: true, timeoutMs: timeoutMs, origin: origin)
  }

  /// `fetchBackendSession(...)`: the full check, which restores the session
  /// on the server and answers with the granted `scope` and the account's
  /// `pds`. Never throws.
  public static func fetchBackendSession(
    backendUrl: String?,
    token: String,
    transport: any HTTPTransport = HTTP.transport,
    timeoutMs: Double = sessionTimeoutMs,
    origin: String? = nil
  ) async -> SessionRead {
    await sessionRead(backendUrl: backendUrl, token: token, transport: transport, lite: false, timeoutMs: timeoutMs, origin: origin)
  }

  /// The codes Virga's server answers 503 with when it couldn't finish the
  /// sign-out yet and has left the token in place.
  static let transientLogoutCodes: Set<String> = ["VALIDATION_TRANSIENT_ERROR", "LOGOUT_TRANSIENT_ERROR"]
  public static let logoutRetryMs: Double = 1500

  /// `backendSignOut(...)`: signs this device's token out. Per device; the
  /// server ends the account's grant only when no token is left, and never
  /// with `keepGrant`. A sign-out the server couldn't finish is tried once
  /// more. Never throws; true when the server confirmed.
  public static func backendSignOut(
    backendUrl: String?,
    token: String?,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock,
    retryDelayMs: Double = logoutRetryMs,
    keepGrant: Bool = false,
    origin: String? = nil
  ) async -> Bool {
    guard let token, !token.isEmpty else { return false }
    let requestBody = keepGrant ? "{\"keepGrant\":true}" : "{}"
    // An address that can't be made fails the attempt, as it does inside
    // the web's try.
    guard let url = try? backendAddress(backendUrl, BackendPaths.logout, origin: origin).href else { return false }
    enum Outcome { case done, failed, again }
    func attempt() async throws -> Outcome {
      let response = try await transport.send(
        HTTPRequest(
          method: "POST", url: url,
          headers: ["Authorization": "Bearer \(token)", "Content-Type": "application/json"],
          text: requestBody, timeoutMs: sessionTimeoutMs))
      if response.ok { return .done }
      if response.status != 503 { return .failed }
      let code = response.jsonOrNull()?["code"]?.stringValue
      return code.map(transientLogoutCodes.contains) == true ? .again : .failed
    }
    do {
      let first = try await attempt()
      if first != .again { return first == .done }
    } catch {
      return false
    }
    await clock.sleep(retryDelayMs)
    do {
      return try await attempt() == .done
    } catch {
      return false
    }
  }
}
