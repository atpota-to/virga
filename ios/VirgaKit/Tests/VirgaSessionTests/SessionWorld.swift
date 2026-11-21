// The world outside the session controller, stood in for as
// src/session/sessionController.test.js stands it in: the stores in memory,
// Virga's server behind a MockTransport answering from a closure, a browser
// driver with sessions to restore, a clock whose waits return at once, and
// the provider's state setters writing into a Recorder.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaSession

enum People {
  static let mira = "did:plc:virgaharnessmira2zq4x"
  static let lab = "did:plc:virgaharnesslab7k2pq"
  static let third = "did:plc:virgaharnessthird2kq"
  static let token = "vg_" + String(repeating: "ab", count: 32)
  static let token2 = "vg_" + String(repeating: "cd", count: 32)
  static let server = "https://server.example"
  static let origin = "https://virga.example"
}

/// A fetch handler that answers every call with `{}` (the test's
/// `oauthSession(did).fetchHandler`).
struct EmptyAnswers: XRPCFetchHandler {
  func handle(_ request: XRPCHandlerRequest) async throws -> HTTPResponse { .json([:]) }
}

/// `oauthSession(did)`: a browser session for an account.
struct FakeOAuthSession: BrowserOAuthSession, Hashable {
  let sub: String
  var fetchHandler: any XRPCFetchHandler { EmptyAnswers() }

  init(_ sub: String) { self.sub = sub }
}

/// `fakeBrowser({ sessions, callback, legacy })`.
final class FakeBrowser: BrowserSessionDriver, @unchecked Sendable {
  struct SignInCall: Sendable, Hashable {
    var input: String
    var scope: String
    var intent: String
    var prompt: String?
  }

  struct State: Sendable {
    var sessions: [String: FakeOAuthSession] = [:]
    var callback: (session: FakeOAuthSession, intent: String)?
    var legacy: FakeOAuthSession?
    /// When set, every restore fails with this.
    var restoreError: BrowserRestoreError?
    var restores: [String] = []
    var signIns: [SignInCall] = []
    var signOuts: [(did: String, session: String?)] = []
    var onDeletedCalls = 0
  }

  let state: Locked<State>
  /// Runs as a session is ended (the test's `browser.signOut.mockImplementation`).
  let onSignOut = Locked<(@Sendable (String) -> Void)?>(nil)
  @MainActor private var dropped: [@MainActor (String?, Bool) -> Void] = []

  init(sessions: [String] = [], callback: (did: String, intent: String)? = nil, legacy: String? = nil) {
    var initial = State()
    for did in sessions { initial.sessions[did] = FakeOAuthSession(did) }
    if let callback { initial.callback = (FakeOAuthSession(callback.did), callback.intent) }
    if let legacy { initial.legacy = FakeOAuthSession(legacy) }
    state = Locked(initial)
  }

  func add(_ did: String) { state.withLock { $0.sessions[did] = FakeOAuthSession(did) } }

  func finishCallback() async throws -> (session: any BrowserOAuthSession, intent: String)? {
    guard let callback = state.wrappedValue.callback else { return nil }
    return (callback.session, callback.intent)
  }

  func legacySession() async throws -> (any BrowserOAuthSession)? { state.wrappedValue.legacy }

  func restore(_ did: String) async throws -> any BrowserOAuthSession {
    let found = state.withLock { s -> FakeOAuthSession? in
      s.restores.append(did)
      return s.sessions[did]
    }
    if let error = state.wrappedValue.restoreError { throw error }
    if let found { return found }
    throw BrowserRestoreError(restoreFailure: "expired", message: "The session was deleted by another process")
  }

  func signIn(_ input: String, scope: String, intent: String, prompt: String?) async throws {
    state.withLock { $0.signIns.append(SignInCall(input: input, scope: scope, intent: intent, prompt: prompt)) }
  }

  func signOut(_ did: String, session: (any BrowserOAuthSession)?) async {
    onSignOut.wrappedValue?(did)
    state.withLock { $0.signOuts.append((did, session?.sub)) }
  }

  func grantedScope(_ session: (any BrowserOAuthSession)?) async -> String? {
    session == nil ? nil : AppConfig.oauthScope
  }

  @MainActor func onDeleted(_ handler: @escaping @MainActor (_ sub: String?, _ revoked: Bool) -> Void) {
    state.withLock { $0.onDeletedCalls += 1 }
    dropped.append(handler)
  }

  /// `browser.drop(sub, { revoked })`: the library dropped a session.
  @MainActor func drop(_ sub: String?, revoked: Bool) {
    for handler in dropped { handler(sub, revoked) }
  }

  var signIns: [SignInCall] { state.wrappedValue.signIns }
  var restores: [String] { state.wrappedValue.restores }
}

/// The provider's state, as the controller sets it (`state` and `log` in the web's setup()).
@MainActor
final class Recorder {
  var rows: [AccountRow] = []
  var statuses: [String: AccountStatus] = [:]
  var active = SessionController.noActive
  var switching: String?
  var error: (any Error)?
  var activeLog: [String?] = []
  var switchingLog: [String?] = []
  /// The open account each time `switching` was set.
  var activeWhenSwitching: [String?] = []
  var finishingLog: [Bool] = []
  var events: [SessionEvent] = []

  var sink: SessionControllerSink {
    SessionControllerSink(
      rows: { [unowned self] in self.rows = $0 },
      statuses: { [unowned self] in self.statuses = $0 },
      active: { [unowned self] in
        self.active = $0
        self.activeLog.append($0.did)
      },
      switching: { [unowned self] in
        self.switching = $0
        self.switchingLog.append($0)
        self.activeWhenSwitching.append(self.active.did)
      },
      error: { [unowned self] in self.error = $0 },
      finishing: { [unowned self] in self.finishingLog.append($0) })
  }

  var eventNames: [String] { events.map(\.name) }
}

/// Calls the environment's closures heard, across tasks.
final class Heard: Sendable {
  let profiles = Locked<[String]>([])
  let remembered = Locked<[[String]]>([])
  let resets = Locked<[String?]>([])
  let deleted = Locked<[String]>([])
  let assigned = Locked<[String]>([])
  let waits = Locked<[Double]>([])
  let clock = Locked<Double>(Fixed.now)
}

/// A controller over a fake world: `setup({ storage, tabStorage, browser, backendReturn, onCallbackPath, answer })`.
@MainActor
struct World {
  let ctrl: SessionController
  let state: Recorder
  let storage: InMemoryKeyValueStore
  let tabStorage: InMemoryKeyValueStore
  let secrets: InMemorySecretStore
  let browser: FakeBrowser
  let transport: MockTransport
  let heard: Heard
  let env: SessionEnvironment

  typealias Answer = @Sendable (_ url: String, _ request: HTTPRequest) -> MockTransport.Response

  /// `json({ success: true })` for everything.
  static let fine: Answer = { _, _ in .json(["success": true]) }

  init(
    storage: InMemoryKeyValueStore = InMemoryKeyValueStore(),
    tabStorage: InMemoryKeyValueStore = InMemoryKeyValueStore(),
    secrets: InMemorySecretStore = InMemorySecretStore(),
    browser: FakeBrowser = FakeBrowser(),
    backendReturn: BackendClient.BackendReturn? = nil,
    onCallbackPath: Bool = false,
    authMode: String = "browser",
    authenticator: (any WebAuthenticator)? = nil,
    answer: @escaping Answer = World.fine
  ) {
    self.init(
      storage: storage, tabStorage: tabStorage, secrets: secrets, browser: browser, backendReturn: backendReturn,
      onCallbackPath: onCallbackPath, authMode: authMode, authenticator: authenticator, getProfile: nil, answer: answer)
  }

  init(
    storage: InMemoryKeyValueStore = InMemoryKeyValueStore(),
    tabStorage: InMemoryKeyValueStore = InMemoryKeyValueStore(),
    secrets: InMemorySecretStore = InMemorySecretStore(),
    browser: FakeBrowser = FakeBrowser(),
    backendReturn: BackendClient.BackendReturn? = nil,
    onCallbackPath: Bool = false,
    authMode: String = "browser",
    authenticator: (any WebAuthenticator)? = nil,
    getProfile: (@Sendable (String) async throws -> JSONValue?)?,
    answer: @escaping Answer = World.fine
  ) {
    let state = Recorder()
    let transport = MockTransport()
    transport.on(.any) { request in answer(request.url, request) }
    let heard = Heard()
    let env = SessionEnvironment(
      storage: storage,
      tabStorage: tabStorage,
      secrets: secrets,
      browser: browser,
      backendUrl: People.server,
      transport: transport,
      clock: NetworkClock(
        // Date.now(): a millisecond on at each reading, so two touches of
        // the account list are never at the same time.
        now: { heard.clock.withLock { $0 += 1; return $0 } },
        sleep: { ms in
          heard.waits.withLock { $0.append(ms) }
          await Task.yield()
        }),
      backendReturn: backendReturn,
      onCallbackPath: onCallbackPath,
      authMode: authMode,
      getProfile: getProfile ?? { did in
        heard.profiles.withLock { $0.append(did) }
        return [
          "did": .string(did), "handle": .string(did == People.mira ? "mira.example.com" : "lab.example.org"),
          "displayName": "Someone", "avatar": "https://cdn.example/a.jpg",
        ]
      },
      resolvePdsUrl: { _ in "https://pds.example" },
      rememberPdsUrl: { did, url in heard.remembered.withLock { $0.append([did, url]) } },
      resetAnalyticsStore: { did in heard.resets.withLock { $0.append(did) } },
      deleteDatabase: { name in
        heard.deleted.withLock { $0.append(name) }
        return true
      },
      dispatch: { name, detail in state.events.append(SessionEvent(name: name, detail: detail)) },
      origin: { People.origin },
      assign: { url in heard.assigned.withLock { $0.append(url) } },
      authenticator: authenticator,
      randomBytes: { count in (0..<count).map { UInt8(($0 * 37 + 11) & 0xff) } })
    self.ctrl = SessionController(set: state.sink, env: env)
    self.state = state
    self.storage = storage
    self.tabStorage = tabStorage
    self.secrets = secrets
    self.browser = browser
    self.transport = transport
    self.heard = heard
    self.env = env
  }

  // MARK: What the server was asked

  /// Requests whose address ends with `suffix`.
  func calls(endingWith suffix: String) -> [HTTPRequest] {
    transport.requests.filter { $0.url.hasSuffix(suffix) }
  }

  /// `loggedOut(fetch)`: the tokens Virga's server was asked to sign out, in order.
  var loggedOut: [String] {
    calls(endingWith: "/api/oauth/logout").map { $0.headers.get("authorization") ?? "" }
  }

  /// `keptGrants(fetch)`: whether each of those sign-outs asked the server to keep the grant.
  var keptGrants: [Bool] {
    calls(endingWith: "/api/oauth/logout").map { request in
      let body = request.body.flatMap { try? JSONValue.parse($0) }
      return body?["keepGrant"] == .bool(true)
    }
  }

  /// The token kept for an account (the web's `storage.getItem(backendTokenKey(did))`).
  func token(_ did: String) -> String? { secrets.secret(for: Accounts.backendTokenKey(did)) }

  func row(_ did: String) -> AccountRow? { Accounts.findAccount(Accounts.readAccounts(storage), did) }

  /// Waits for the work the controller sets off without waiting for it
  /// (the full session check, the lite checks, the profile refresh, the
  /// sign-outs of dropped tokens) to finish.
  func settle() async {
    _ = await eventually { ctrl.learning.isEmpty && !ctrl.backendChecker.checking && !ctrl.browserChecker.checking }
    for _ in 0..<20 { await Task.yield() }
    _ = await eventually { ctrl.learning.isEmpty && !ctrl.backendChecker.checking && !ctrl.browserChecker.checking }
  }
}

/// `remember(storage, did, mode, { token, at })`.
func remember(_ world: (storage: InMemoryKeyValueStore, secrets: InMemorySecretStore), _ did: String, _ mode: String, token: String? = nil, at: Double = 1) {
  Accounts.recordSignIn(world.storage, did: did, mode: mode, now: at)
  if let token { Accounts.writeBackendToken(world.secrets, did, token) }
}

/// The stores a test fills before the controller is made.
struct Stores {
  let storage = InMemoryKeyValueStore()
  let tabStorage = InMemoryKeyValueStore()
  let secrets = InMemorySecretStore()

  var pair: (storage: InMemoryKeyValueStore, secrets: InMemorySecretStore) { (storage, secrets) }

  func remember(_ did: String, _ mode: String, token: String? = nil, at: Double = 1) {
    VirgaSessionTests.remember(pair, did, mode, token: token, at: at)
  }
}

extension MockTransport.Response {
  /// `json({ success: false, code }, status)`.
  static func failure(_ code: String, status: Int, error: String? = nil) -> MockTransport.Response {
    var body: JSONValue = ["success": false, "code": .string(code)]
    if let error { body["error"] = .string(error) }
    return .json(body, status: status)
  }
}

/// A return from Virga's server, as readBackendReturn reads one.
func sessionReturn(_ did: String, _ token: String, intent: String) -> BackendClient.BackendReturn {
  .session(did: did, token: token, intent: .string(intent), pending: ["nonce": "n", "intent": .string(intent)])
}

/// A return that failed, with the code in `error.params`; `orphanToken` a
/// token it carried that must not be left alive.
func errorReturn(_ code: String, orphanToken: String? = nil) -> BackendClient.BackendReturn {
  var hash = ""
  if let orphanToken { hash = "#session=\(orphanToken)&did=\(People.mira)" }
  let search = orphanToken == nil ? "?error=\(code)" : "?n=elsewhere"
  return BackendClient.readBackendReturn(
    BackendClient.ReturnLocation(pathname: AppConfig.oauthReturnPath, search: search, hash: hash),
    orphanToken == nil ? nil : ["nonce": "mine"], AppConfig.oauthReturnPath)!
}

/// The error `body` throws, or nil when it doesn't.
@MainActor
func thrown<T>(_ body: @MainActor () async throws -> T) async -> (any Error)? {
  do {
    _ = try await body()
    return nil
  } catch {
    return error
  }
}
