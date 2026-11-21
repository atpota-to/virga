// Ports src/session/sessionController.js
//
// The session layer's workings, apart from the view: which account is open,
// how each account's agent is built (BackendFetchHandler for a long session,
// the browser driver for a browser one), switching, signing in and out, and
// noticing a sign-in that has ended. SessionModel (useAtprotoSession) holds
// the state; this decides what goes in it.
//
// The web's controller is a closure over its maps, run on one thread with
// awaits as its only interleaving points; here it is a @MainActor class, for
// the same reason. `createSessionController(set, env)` is
// `SessionController(set:env:)`, the module's other functions its statics.
//
// iOS signs in only through Virga's server, and the sign-in comes back here
// rather than as a new page load: `signIn` opens the login address in the
// environment's WebAuthenticator (ASWebAuthenticationSession) and finishes
// with what start() does with a return (`completeSignIn`). Without an
// authenticator it stops where the web's does, having handed the address to
// `assign`.

import Foundation
import VirgaCore
import VirgaNetwork

/// `{ mode, intent, prompt, defense, did }`, signIn's options. `mode` nil is
/// the environment's authMode; `defense` nil is "unsaid" (an account this
/// device remembers keeps what it had).
public struct SignInOptions: Sendable, Hashable {
  public var mode: String?
  /// 'add' or 'reauth'.
  public var intent: String
  /// 'create' opens the host's page on making an account (SIGNIN_PROMPTS).
  public var prompt: String?
  /// true or 'scan', 'lists', or false; nil for unsaid.
  public var defense: JSONValue?
  /// Which remembered account this is, when the caller knows.
  public var did: String?

  public init(mode: String? = nil, intent: String = "add", prompt: String? = nil, defense: JSONValue? = nil, did: String? = nil) {
    self.mode = mode
    self.intent = intent
    self.prompt = prompt
    self.defense = defense
    self.did = did
  }
}

/// `{ sub, did, mode }`: the open account's session (a browser session's
/// library object rides along as `oauth`).
public struct SessionInfo: Sendable {
  public var sub: String
  public var did: String
  public var mode: String
  public var oauth: (any BrowserOAuthSession)?

  public init(sub: String, did: String, mode: String, oauth: (any BrowserOAuthSession)? = nil) {
    self.sub = sub
    self.did = did
    self.mode = mode
    self.oauth = oauth
  }
}

/// `{ did, agent, session, mode }`, always published together.
public struct ActiveSession: Sendable {
  public var did: String?
  public var agent: XRPCAgent?
  public var session: SessionInfo?
  public var mode: String?

  public init(did: String? = nil, agent: XRPCAgent? = nil, session: SessionInfo? = nil, mode: String? = nil) {
    self.did = did
    self.agent = agent
    self.session = session
    self.mode = mode
  }
}

/// `{ did, agent, pdsUrl }`: an account to act as.
public struct SessionTarget: Sendable {
  public var did: String
  public var agent: XRPCAgent
  public var pdsUrl: String

  public init(did: String, agent: XRPCAgent, pdsUrl: String) {
    self.did = did
    self.agent = agent
    self.pdsUrl = pdsUrl
  }
}

/// `capabilitiesFrom`'s answer: what an account can do here.
public struct AccountCapabilities: Sendable, Hashable, Codable {
  public var mode: String?
  public var canPost: Bool
  public var canSchedule: Bool
  public var canUseAi: Bool
  /// 'granted', 'missing', or 'unknown' while nobody has read the grant.
  public var defense: String
  /// The same of the permission to write Defense's lists.
  public var lists: String
  public var canWriteLists: Bool
  /// The tokens Virga asks for that the session wasn't granted.
  public var missing: [String]

  public init(
    mode: String?, canPost: Bool, canSchedule: Bool, canUseAi: Bool, defense: String, lists: String, canWriteLists: Bool,
    missing: [String]
  ) {
    self.mode = mode
    self.canPost = canPost
    self.canSchedule = canSchedule
    self.canUseAi = canUseAi
    self.defense = defense
    self.lists = lists
    self.canWriteLists = canWriteLists
    self.missing = missing
  }

  enum CodingKeys: String, CodingKey { case mode, canPost, canSchedule, canUseAi, defense, lists, canWriteLists, missing }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    if let mode { try c.encode(mode, forKey: .mode) } else { try c.encodeNil(forKey: .mode) }
    try c.encode(canPost, forKey: .canPost)
    try c.encode(canSchedule, forKey: .canSchedule)
    try c.encode(canUseAi, forKey: .canUseAi)
    try c.encode(defense, forKey: .defense)
    try c.encode(lists, forKey: .lists)
    try c.encode(canWriteLists, forKey: .canWriteLists)
    try c.encode(missing, forKey: .missing)
  }
}

/// The provider's state setters: `set.rows`, `set.statuses`, `set.active`,
/// `set.switching`, `set.error`. `finishing` is the app's own: on the web a
/// sign-in's return is a new page load, which shows `loading` while the
/// account opens; here the return comes back to the running app, and
/// `finishing(true)` … `finishing(false)` brackets the same work.
public struct SessionControllerSink {
  public var rows: @MainActor ([AccountRow]) -> Void
  public var statuses: @MainActor ([String: AccountStatus]) -> Void
  public var active: @MainActor (ActiveSession) -> Void
  public var switching: @MainActor (String?) -> Void
  public var error: @MainActor ((any Error)?) -> Void
  public var finishing: @MainActor (Bool) -> Void

  public init(
    rows: @escaping @MainActor ([AccountRow]) -> Void = { _ in },
    statuses: @escaping @MainActor ([String: AccountStatus]) -> Void = { _ in },
    active: @escaping @MainActor (ActiveSession) -> Void = { _ in },
    switching: @escaping @MainActor (String?) -> Void = { _ in },
    error: @escaping @MainActor ((any Error)?) -> Void = { _ in },
    finishing: @escaping @MainActor (Bool) -> Void = { _ in }
  ) {
    self.rows = rows
    self.statuses = statuses
    self.active = active
    self.switching = switching
    self.error = error
    self.finishing = finishing
  }
}

/// The world outside, passed in so the tests can stand in for it: the
/// web's `env`.
public struct SessionEnvironment {
  /// localStorage: the account list, the open account, the hint.
  public var storage: (any KeyValueStore)?
  /// sessionStorage: this run's pending sign-in and the account open when one started.
  public var tabStorage: (any KeyValueStore)?
  /// Where long sessions' tokens are kept (the Keychain).
  public var secrets: (any SecretStore)?
  public var browser: any BrowserSessionDriver
  /// Virga's server.
  public var backendUrl: String?
  public var transport: any HTTPTransport
  /// Date.now() and setTimeout.
  public var clock: NetworkClock
  /// readBackendReturn's result for this launch (nil on iOS: returns come
  /// back through signIn).
  public var backendReturn: BackendClient.BackendReturn?
  /// Whether this launch is a browser sign-in's callback (never on iOS).
  public var onCallbackPath: Bool
  /// The mode for new sign-ins: 'backend' on iOS.
  public var authMode: String
  /// The public profile (atproto.js getProfile), or nil.
  public var getProfile: @Sendable (String) async throws -> JSONValue?
  public var resolvePdsUrl: @Sendable (String) async throws -> String
  public var rememberPdsUrl: @Sendable (String, String) async -> Void
  /// `resetAnalyticsStore()` (src/lib/analyticsStore.js): starts the
  /// archive's stores afresh after an account's data is deleted, as the web
  /// drops every open database handle. Called with the account whose data
  /// went (the web resets them all, and an implementation may too). The
  /// archive (VirgaArchive) sits above this target, so the app passes its
  /// reset in; nothing by default.
  public var resetAnalyticsStore: @Sendable (_ did: String?) async -> Void
  /// Deletes one of an account's databases (`virga-analytics:<did>`,
  /// `virga-posting:<did>`), answering whether it went. On iOS these are the
  /// archive's and the posting store's FileStore folders.
  public var deleteDatabase: @Sendable (String) async -> Bool
  /// `window.dispatchEvent(new CustomEvent(name, { detail }))`.
  public var dispatch: @MainActor (String, JSONValue) -> Void
  /// The origin a sign-in comes back to (Virga's own site: the server's).
  public var origin: @Sendable () -> String
  /// `location.assign(url)`: the web's last step of a sign-in.
  public var assign: @Sendable (String) -> Void
  /// Opens the sign-in and waits for its return (ASWebAuthenticationSession).
  public var authenticator: (any WebAuthenticator)?
  /// The sign-in's nonce bytes.
  public var randomBytes: @Sendable (Int) -> [UInt8]

  public init(
    storage: (any KeyValueStore)?,
    tabStorage: (any KeyValueStore)?,
    secrets: (any SecretStore)?,
    browser: any BrowserSessionDriver = NoBrowserSessions(),
    backendUrl: String?,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock,
    backendReturn: BackendClient.BackendReturn? = nil,
    onCallbackPath: Bool = false,
    authMode: String = "backend",
    getProfile: @escaping @Sendable (String) async throws -> JSONValue? = { did in try await Atproto.getProfile(did) },
    resolvePdsUrl: @escaping @Sendable (String) async throws -> String = { did in try await PDS.resolvePdsUrl(did) },
    rememberPdsUrl: @escaping @Sendable (String, String) async -> Void = { did, url in await PDS.rememberPdsUrl(did, url) },
    resetAnalyticsStore: @escaping @Sendable (_ did: String?) async -> Void = { _ in },
    deleteDatabase: @escaping @Sendable (String) async -> Bool = { _ in false },
    dispatch: @escaping @MainActor (String, JSONValue) -> Void = { name, detail in SessionEvents.shared.dispatch(name, detail) },
    origin: (@Sendable () -> String)? = nil,
    assign: @escaping @Sendable (String) -> Void = { _ in },
    authenticator: (any WebAuthenticator)? = nil,
    randomBytes: @escaping @Sendable (Int) -> [UInt8] = { count in (0..<count).map { _ in UInt8.random(in: 0...255) } }
  ) {
    self.storage = storage
    self.tabStorage = tabStorage
    self.secrets = secrets
    self.browser = browser
    self.backendUrl = backendUrl
    self.transport = transport
    self.clock = clock
    self.backendReturn = backendReturn
    self.onCallbackPath = onCallbackPath
    self.authMode = authMode
    self.getProfile = getProfile
    self.resolvePdsUrl = resolvePdsUrl
    self.rememberPdsUrl = rememberPdsUrl
    self.resetAnalyticsStore = resetAnalyticsStore
    self.deleteDatabase = deleteDatabase
    self.dispatch = dispatch
    let server = backendUrl ?? ""
    self.origin = origin ?? { (try? WebURL(server).origin) ?? server }
    self.assign = assign
    self.authenticator = authenticator
    self.randomBytes = randomBytes
  }
}

@MainActor
public final class SessionController {
  // MARK: The module's own functions

  /// `NO_ACTIVE`.
  public nonisolated static let noActive = ActiveSession()

  /// The 401 codes the server gives when the token is good but the account's
  /// grant couldn't be restored (revoked at the PDS, or a refresh that died).
  nonisolated static let grantGoneCodes: Set<String> = ["OAUTH_SESSION_MISSING", "SESSION_EXPIRED"]

  /// `capabilitiesFrom(row, status)`: what an account can do here. A grant
  /// nobody has read yet is taken to be enough; scheduling and the adviser
  /// run on Virga's server, so they need a long session that still holds.
  public nonisolated static func capabilitiesFrom(_ row: AccountRow?, _ status: AccountStatus?) -> AccountCapabilities {
    let mode = row.map(\.mode).flatMap { $0.isEmpty ? nil : $0 }
    let live = row != nil && status != .needsSignIn
    let granted = row?.scope
    let missing = granted.map { Scopes.missingScopes($0, AppConfig.oauthScope) } ?? []
    let postingGranted = granted.map { Scopes.missingScopes($0, AppConfig.postingTokens).isEmpty } ?? true
    let longSession = mode == "backend" && live
    let level = granted.flatMap(grantedDefenseLevel)
    let defense = granted == nil ? "unknown" : level != nil ? "granted" : "missing"
    let lists = granted == nil ? "unknown" : level == .lists ? "granted" : "missing"
    return AccountCapabilities(
      mode: mode, canPost: live && postingGranted, canSchedule: longSession, canUseAi: longSession, defense: defense, lists: lists,
      canWriteLists: longSession && lists != "missing", missing: missing)
  }

  /// `holdsDefense(granted)`: whether a granted scope covers Defense's permission.
  public nonisolated static func holdsDefense(_ granted: String?) -> Bool {
    guard let granted else { return false }
    return Scopes.missingScopes(granted, AppConfig.defenseTokens).isEmpty
  }

  /// `grantedDefenseLevel(granted)`: how much of Defense a granted scope
  /// covers: .lists (the read and the list writes), .scan (the read), or nil
  /// (the web's false).
  public nonisolated static func grantedDefenseLevel(_ granted: String?) -> AppConfig.DefenseLevel? {
    guard holdsDefense(granted), let granted else { return nil }
    return Scopes.missingScopes(granted, AppConfig.listTokens).isEmpty ? .lists : .scan
  }

  // MARK: State

  let set: SessionControllerSink
  let env: SessionEnvironment
  /// Agents built for accounts that aren't open: did → the build under way.
  var agents: [JSKey: (id: Int, task: Task<XRPCAgent, any Error>)] = [:]
  /// What each account's agent was built from.
  var built: [JSKey: (mode: String, token: String?)] = [:]
  var browserSessions: [JSKey: any BrowserOAuthSession] = [:]
  var requesters: [JSKey: (token: String, requester: VirgaBackend)] = [:]
  /// Accounts whose session this controller is ending on purpose.
  var signingOut: Set<JSKey> = []
  /// did → when the last forced check ran.
  var lastRecovery: [JSKey: Double] = [:]
  /// Long sessions whose grant the server last said it couldn't restore.
  /// The lite check only reads the grant's row, which outlives a refresh
  /// token that has died, so its "valid" can't clear this: only a full check
  /// or an answer that came back through the grant can.
  var grantGone: Set<JSKey> = []
  /// did → the full check under way.
  var learning: [JSKey: Task<Void, Never>] = [:]
  public private(set) var active = SessionController.noActive
  var statuses: [JSKey: AccountStatus] = [:]
  var switchSeq = 0
  var started: Task<Void, Never>?
  var refreshed: Set<JSKey> = []
  var nextAgentId = 0
  lazy var backendChecker: SessionChecker = makeBackendChecker()
  lazy var browserChecker: SessionChecker = makeBrowserChecker()

  /// `createSessionController(set, env)`.
  public init(set: SessionControllerSink, env: SessionEnvironment) {
    self.set = set
    self.env = env
  }

  var now: Double { env.clock.now() }

  func rows() -> [AccountRow] { Accounts.readAccounts(env.storage) }
  func find(_ did: String?) -> AccountRow? { Accounts.findAccount(rows(), did) }
  func token(_ did: String) -> String? { Accounts.readBackendToken(env.secrets, did) }

  /// The remembered account a sign-in is for: by `did` when the caller
  /// knows it, else by the input as a DID, else by the input as a handle,
  /// and only when exactly one account has it, since a handle can move
  /// between accounts.
  func rememberedFor(_ input: String, did: String?) -> AccountRow? {
    let list = rows()
    if let did, !did.isEmpty { return list.first { $0.did.jsEquals(did) } }
    let text = input.jsLowercased()
    if text.isEmpty { return nil }
    if let byDid = list.first(where: { $0.did.jsEquals(input) }) { return byDid }
    let byHandle = list.filter { row in row.handle.map { !$0.isEmpty && $0.jsLowercased().jsEquals(text) } ?? false }
    return byHandle.count == 1 ? byHandle[0] : nil
  }

  @discardableResult
  func refreshRows() -> [AccountRow] {
    let list = rows()
    SessionHint.syncSessionHint(env.storage, list)
    set.rows(list)
    return list
  }

  func publishStatuses() {
    var out: [String: AccountStatus] = [:]
    for (key, status) in statuses { out[key.value] = status }
    set.statuses(out)
  }

  func setStatus(_ did: String, _ status: AccountStatus) {
    if statuses[JSKey(did)] == status { return }
    statuses[JSKey(did)] = status
    publishStatuses()
  }

  func clearStatus(_ did: String) {
    guard statuses[JSKey(did)] != nil else { return }
    statuses[JSKey(did)] = nil
    publishStatuses()
  }

  /// `statusOf(did)`: the status an account is shown with.
  public func statusOf(_ did: String) -> AccountStatus {
    guard let account = find(did), !account.isSignedOut else { return .needsSignIn }
    if account.mode == "backend" && token(did) == nil { return .needsSignIn }
    return statuses[JSKey(did)] ?? .ready
  }

  func forgetBuilt(_ did: String) {
    let key = JSKey(did)
    built[key] = nil
    agents[key] = nil
    requesters[key] = nil
    browserSessions[key] = nil
    grantGone.remove(key)
    backendChecker.forget(did)
    browserChecker.forget(did)
  }

  func publish(_ next: ActiveSession) {
    active = next
    set.active(next)
  }

  /// An account that can't be used again without a new sign-in. Its row is
  /// kept (signed out) and its token dropped. `discovered` is false when
  /// this controller ended the session itself; only a discovered death sends
  /// the open account's reader to sign in again (SessionNotices listens).
  func markNeedsSignIn(_ did: String, discovered: Bool = true) {
    Accounts.markSignedOut(env.storage, did)
    Accounts.removeBackendToken(env.secrets, did)
    forgetBuilt(did)
    setStatus(did, .needsSignIn)
    refreshRows()
    if discovered { env.dispatch(Accounts.sessionExpiredEvent, ["did": .string(did)]) }
  }

  /// A 401 from the server: maybe dead, maybe a cold start. Confirm before
  /// acting, and not more than once every ten seconds. One that says the
  /// grant couldn't be restored is asked of the full check, and the account
  /// is shown as unknown (which offers a sign-in) until something says the
  /// grant holds again.
  func onUnauthorized(_ did: String, _ code: JSONValue?) {
    let grantCode = code?.stringValue.map { Self.grantGoneCodes.contains($0) } ?? false
    if grantCode && usable(did) {
      grantGone.insert(JSKey(did))
      setStatus(did, .unknown)
    }
    let at = lastRecovery[JSKey(did)] ?? 0
    if now - at < 10_000 { return }
    lastRecovery[JSKey(did)] = now
    if grantCode {
      Task { await self.learnBackendSession(did) }
    } else {
      Task { await self.backendChecker.check(did, force: true) }
    }
  }

  /// An answer that came back through the grant: it holds after all.
  func onAuthorized(_ did: String) {
    if grantGone.remove(JSKey(did)) != nil && statuses[JSKey(did)] == .unknown { setStatus(did, .ready) }
  }

  func settleCheck(_ did: String, _ result: SessionCheckResult) {
    let status = SessionHealth.statusFromCheck(result)
    if status == .needsSignIn {
      if find(did)?.isSignedOut != true { markNeedsSignIn(did) }
    } else if status == .ready && grantGone.contains(JSKey(did)) {
      setStatus(did, .unknown)
    } else {
      setStatus(did, status)
    }
  }

  func makeBackendChecker() -> SessionChecker {
    let env = self.env
    return SessionChecker(
      probe: { did in
        guard let token = Accounts.readBackendToken(env.secrets, did) else {
          return SessionCheckResult(status: .expired, definitive: false)
        }
        return SessionHealth.interpretLiteSessionResponse(
          await BackendClient.checkBackendSession(backendUrl: env.backendUrl, token: token, transport: env.transport))
      },
      now: { env.clock.now() },
      sleep: env.clock.sleep,
      onResult: { [weak self] did, result in self?.settleCheck(did, result) })
  }

  // A browser session is read from the device's own store, so its answer
  // needs no confirming: a session the library can't restore is gone.
  func makeBrowserChecker() -> SessionChecker {
    SessionChecker(
      probe: { [weak self] did in
        guard let self else { return .unknown }
        do {
          let session: any BrowserOAuthSession
          if let held = self.browserSessions[JSKey(did)] {
            session = held
          } else {
            session = try await self.env.browser.restore(did)
          }
          self.browserSessions[JSKey(did)] = session
          return .valid
        } catch {
          return (error as? BrowserRestoreError)?.restoreFailure == "expired" ? .dead : .unknown
        }
      },
      now: { [env] in env.clock.now() },
      rounds: 1,
      sleep: env.clock.sleep,
      onResult: { [weak self] did, result in self?.settleCheck(did, result) })
  }

  /// The agent's fetch handler for a long session: Virga's server, with the
  /// token read at each request (another sign-in may have replaced it).
  func backendAgent(_ did: String) -> XRPCAgent {
    XRPCAgent(
      did: did,
      fetchHandler: SessionFetchHandler(
        backendUrl: env.backendUrl, did: did, secrets: env.secrets, transport: env.transport, controller: WeakController(self)))
  }

  /// `build(account)`: `{ did, agent, session, mode }` for an account.
  /// Throws REAUTH_REQUIRED when only a sign-in will do.
  func build(_ account: AccountRow) async throws -> ActiveSession {
    let did = account.did
    if account.mode == "backend" {
      guard let token = token(did) else { throw Accounts.makeReauthRequiredError(did) }
      built[JSKey(did)] = ("backend", token)
      return ActiveSession(did: did, agent: backendAgent(did), session: SessionInfo(sub: did, did: did, mode: "backend"), mode: "backend")
    }
    var oauth = browserSessions[JSKey(did)]
    if oauth == nil {
      let restored: any BrowserOAuthSession
      do {
        restored = try await env.browser.restore(did)
      } catch {
        if let failure = error as? BrowserRestoreError, failure.restoreFailure == "expired" {
          throw ReauthRequiredError(did: did, cause: failure.message)
        }
        throw error
      }
      browserSessions[JSKey(did)] = restored
      oauth = restored
      let browser = env.browser
      Task {
        let scope = await browser.grantedScope(restored)
        if let scope, !scope.isEmpty, !(self.find(did)?.scope).jsEquals(scope) {
          Accounts.updateAccount(self.env.storage, did) { $0.scope = scope }
          self.refreshRows()
        }
      }
    }
    built[JSKey(did)] = ("browser", nil)
    let session = oauth!
    return ActiveSession(
      did: did, agent: XRPCAgent(did: did, fetchHandler: session.fetchHandler),
      session: SessionInfo(sub: did, did: did, mode: "browser", oauth: session), mode: "browser")
  }

  /// `learnBackendSession(did)`: ask the server what this long session was
  /// granted, and where the repo is. This is the check that restores the
  /// grant, so it is the one that can tell a grant that has died from one
  /// that holds.
  func learnBackendSession(_ did: String) async {
    let key = JSKey(did)
    if let running = learning[key] { return await running.value }
    let task = Task { @MainActor in
      await self.learnOnce(did)
      self.learning[key] = nil
    }
    learning[key] = task
    await task.value
  }

  func learnOnce(_ did: String) async {
    guard let token = token(did) else { return }
    let res = await BackendClient.fetchBackendSession(backendUrl: env.backendUrl, token: token, transport: env.transport)
    // Signed in again (or out) while it ran: the answer was about another token.
    guard self.token(did).jsEquals(token) else { return }
    if res.ok, let data = res.data, data["success"].truthy != nil {
      if case .string(let scope)? = data["scope"], !(find(did)?.scope).jsEquals(scope) {
        Accounts.updateAccount(env.storage, did) { $0.scope = scope }
        refreshRows()
      }
      if case .string(let pds)? = data["pds"] {
        let remember = env.rememberPdsUrl
        Task { await remember(did, pds) }
      }
      let missing = data["oauthSessionMissing"].truthy != nil
      if missing { grantGone.insert(JSKey(did)) } else { grantGone.remove(JSKey(did)) }
      setStatus(did, missing ? .unknown : .ready)
    } else if res.status == 401 {
      // About the token (the full check answers a lost grant with a 200):
      // the lite check's rules decide whether it has gone.
      Task { await self.backendChecker.check(did, force: true) }
    }
  }

  /// Fill in names and pictures from the public profile, for rows that lack
  /// them (and the open one, once).
  func refreshDisplay() async {
    let list = rows().filter { !refreshed.contains(JSKey($0.did)) && (Accounts.needsRefresh($0) || Optional($0.did).jsEquals(active.did)) }
    for account in list {
      refreshed.insert(JSKey(account.did))
      do {
        guard let p = try await env.getProfile(account.did), p.isTruthy else { continue }
        // `p.handle && p.handle !== 'handle.invalid' ? p.handle : account.handle`:
        // a handle that isn't a string is written, and cleanRow then drops it.
        var handle = account.handle
        if let h = p["handle"].truthy, !(h.stringValue.map { $0.jsEquals("handle.invalid") } ?? false) { handle = h.stringValue }
        var displayName: String?
        if let name = p["displayName"], !name.isNull {
          // `p.displayName?.trim()`: a name that isn't a string can't be trimmed.
          guard case .string(let text) = name else { throw JSError(name: "TypeError", message: "p.displayName?.trim is not a function") }
          displayName = text.jsTrimmed().isEmpty ? nil : text.jsTrimmed()
        }
        let avatar = p["avatar"].truthy?.stringValue
        Accounts.updateAccount(env.storage, account.did) { row in
          // An account whose handle no longer points at it reads as
          // "handle.invalid", which is no name to keep.
          row.handle = handle
          row.displayName = displayName
          row.avatar = avatar
        }
      } catch {
        refreshed.remove(JSKey(account.did))
      }
    }
    if !list.isEmpty { refreshRows() }
  }

  /// `open(account)`: publish its triple in one update.
  @discardableResult
  func open(_ account: AccountRow) async throws -> ActiveSession {
    let next = try await build(account)
    publish(next)
    Accounts.writeActiveDid(env.storage, account.did)
    Accounts.touchAccount(env.storage, account.did, now: now)
    agents[JSKey(account.did)] = nil
    refreshRows()
    if next.mode == "backend" { Task { await self.learnBackendSession(account.did) } }
    Task { await self.refreshDisplay() }
    return next
  }

  /// Open the next account that works, starting with the first; or none.
  @discardableResult
  func openFirstWorking(_ candidates: [AccountRow]) async -> ActiveSession? {
    for account in candidates {
      do {
        return try await open(account)
      } catch {
        if Accounts.isReauthRequiredError(error) {
          markNeedsSignIn(account.did, discovered: false)
        } else {
          setStatus(account.did, .unknown)
        }
      }
    }
    return nil
  }

  func leave(_ did: String) async {
    let others = Accounts.signedInAccounts(rows()).filter { !$0.did.jsEquals(did) && statusOf($0.did) != .needsSignIn }
    if let first = others.first { set.switching(first.did) }
    if await openFirstWorking(others) == nil {
      publish(Self.noActive)
      Accounts.writeActiveDid(env.storage, nil)
    }
    set.switching(nil)
  }

  /// `usable(did)`: whether `did` can be opened without a sign-in, as far
  /// as this device knows.
  func usable(_ did: String?) -> Bool {
    guard let did, let account = find(did), !account.isSignedOut else { return false }
    return account.mode != "backend" || token(did) != nil
  }

  /// Whether a sign-in that just came back should leave the account that
  /// was open before it open. Signing another account back in is for that
  /// account's sake: it doesn't switch the app to it.
  func keepsOpen(_ intent: JSONValue?, _ did: String, _ openBefore: String?) -> Bool {
    guard intent?.stringValue == "reauth", let openBefore, !openBefore.jsEquals(did) else { return false }
    return usable(openBefore)
  }

  /// End a long-session token this device no longer holds, keeping the
  /// account's grant: the token may come from a sign-in this device never
  /// asked for, and the grant is what the account's scheduled posts and
  /// timers run on. Only a sign-out the reader asks for ends the grant.
  func dropToken(_ token: String?) {
    guard let token, !token.isEmpty else { return }
    let env = self.env
    Task {
      _ = await BackendClient.backendSignOut(backendUrl: env.backendUrl, token: token, transport: env.transport, clock: env.clock, keepGrant: true)
    }
  }
}

/// A weak reference to the controller, for the agent's fetch handler.
final class WeakController: @unchecked Sendable {
  weak var value: SessionController?
  init(_ value: SessionController) { self.value = value }
}

/// The long session's fetch handler: BackendFetchHandler, with the 401s and
/// the answers that came back through the grant told to the controller
/// before the call returns (the web calls them synchronously, inside the
/// fetch handler).
struct SessionFetchHandler: XRPCFetchHandler {
  enum Heard: Sendable {
    case unauthorized(JSONValue?)
    case authorized
  }

  var backendUrl: String?
  var did: String
  var secrets: (any SecretStore)?
  var transport: any HTTPTransport
  var controller: WeakController

  func handle(_ request: XRPCHandlerRequest) async throws -> HTTPResponse {
    let heard = Locked<[Heard]>([])
    let secrets = self.secrets
    let did = self.did
    let inner = BackendFetchHandler(
      backendUrl: backendUrl,
      token: { Accounts.readBackendToken(secrets, did) },
      did: did,
      transport: transport,
      onUnauthorized: { _, code in heard.withLock { $0.append(.unauthorized(code)) } },
      onAuthorized: { _ in heard.withLock { $0.append(.authorized) } })
    let response: HTTPResponse
    do {
      response = try await inner.handle(request)
    } catch {
      await deliver(heard.wrappedValue)
      throw error
    }
    await deliver(heard.wrappedValue)
    return response
  }

  func deliver(_ events: [Heard]) async {
    guard !events.isEmpty else { return }
    let controller = self.controller
    let did = self.did
    await MainActor.run {
      guard let target = controller.value else { return }
      for event in events {
        switch event {
        case .unauthorized(let code): target.onUnauthorized(did, code)
        case .authorized: target.onAuthorized(did)
        }
      }
    }
  }
}
