// Ports src/session/sessionController.js (what the controller hands out)
//
// Starting up, finishing a sign-in, following another window, switching,
// signing in and out, and the agents and requesters other code acts through.

import Foundation
import VirgaCore
import VirgaNetwork

extension SessionController {
  // MARK: Starting up

  /// `startOnce()`: restore what there is to restore, once however often
  /// it's called. Listens for the browser driver's dropped sessions from
  /// then on.
  public func startOnce() async {
    if started == nil {
      env.browser.onDeleted { [weak self] sub, revoked in self?.onBrowserSessionDropped(sub, revoked: revoked) }
      started = Task { await self.start() }
    }
    await started?.value
  }

  /// What start() does with a return from Virga's server: keep the token,
  /// record the account, and say which account opens. Returns the list.
  @discardableResult
  func applyBackendReturn(_ result: BackendClient.BackendReturn, openBefore: String?, list: [AccountRow]) -> [AccountRow] {
    let store = env.storage
    switch result {
    case .error(let error, let orphanToken):
      set.error(error)
      dropToken(orphanToken)
      return list
    case .session(let did, let token, let intent, _):
      let before = Accounts.findAccount(list, did)
      let replaced = self.token(did)
      Accounts.writeBackendToken(env.secrets, did, token)
      if let replaced, !replaced.jsEquals(token) { dropToken(replaced) }
      // The grant is new: what the row said before (Defense on or off, say)
      // isn't assumed of it. learnBackendSession reads it again.
      let next = Accounts.recordSignIn(store, did: did, mode: "backend", scope: .cleared, now: now)
      if !keepsOpen(intent, did, openBefore) { Accounts.writeActiveDid(store, did) }
      SessionHealth.clearReauthAttempts(env.tabStorage)
      forgetBuilt(did)
      clearStatus(did)
      // The account moved to a long session: end the browser one it had.
      if before?.mode == "browser" {
        let browser = env.browser
        Task { await browser.signOut(did, session: nil) }
      }
      return next
    }
  }

  func start() async {
    let store = env.storage
    var list = rows()
    let openBefore = Accounts.takeOpenAtSignIn(env.tabStorage)

    if let result = env.backendReturn {
      list = applyBackendReturn(result, openBefore: openBefore, list: list)
    }

    if env.onCallbackPath {
      do {
        if let done = try await env.browser.finishCallback() {
          let did = done.session.sub
          let before = Accounts.findAccount(list, did)
          browserSessions[JSKey(did)] = done.session
          let scope = await env.browser.grantedScope(done.session)
          list = Accounts.recordSignIn(store, did: did, mode: "browser", scope: scope.map(SignInScope.granted) ?? .unsaid, now: now)
          if !keepsOpen(.string(done.intent), did, openBefore) { Accounts.writeActiveDid(store, did) }
          clearStatus(did)
          if before?.mode == "backend" {
            let held = token(did)
            Accounts.removeBackendToken(env.secrets, did)
            dropToken(held)
          }
        }
      } catch {
        set.error(error)
      }
    }

    // A device that signed in before Virga kept a list of accounts has only
    // the hint and the library's own idea of who is signed in.
    if list.isEmpty && SessionHint.readSessionHint(store) {
      do {
        if let legacy = try await env.browser.legacySession() {
          browserSessions[JSKey(legacy.sub)] = legacy
          let scope = await env.browser.grantedScope(legacy)
          list = Accounts.recordSignIn(store, did: legacy.sub, mode: "browser", scope: scope.map(SignInScope.granted) ?? .unsaid, now: now)
          Accounts.writeActiveDid(store, legacy.sub)
        }
      } catch {
        // Tried again next time; the hint stays until the list says otherwise.
        set.rows(list)
        return
      }
    }

    refreshRows()
    guard let first = Accounts.pickActiveAccount(list, Accounts.readActiveDid(store)) else {
      Task { await self.refreshDisplay() }
      return
    }
    await openStarting(first, list: list)
  }

  /// Open the account an app start (or a finished sign-in) settles on; on a
  /// sign-in that has gone, the next that works; on a failure that couldn't
  /// tell, the same account once more in a moment, and never a different one
  /// behind its back.
  func openStarting(_ first: AccountRow, list: [AccountRow]) async {
    let rest = Accounts.signedInAccounts(list).filter { !$0.did.jsEquals(first.did) }
    do {
      try await open(first)
      return
    } catch {
      if Accounts.isReauthRequiredError(error) {
        markNeedsSignIn(first.did, discovered: false)
      } else {
        // Couldn't tell (no network): keep the account as it is, try once
        // more in a moment, and don't open a different one behind its back.
        setStatus(first.did, .unknown)
        await env.clock.sleep(1_500)
        _ = try? await open(first)
        return
      }
    }
    await openFirstWorking(rest)
    Task { await self.refreshDisplay() }
  }

  /// A sign-in that came back to the app: what the page load on the return
  /// path does on the web (start() with BACKEND_RETURN), in the running app.
  /// The account it settles on opens as at a start; one that is already
  /// open and stays so (another account signed back in for its own sake) is
  /// left as it is, where the web's new page would build it afresh. A start
  /// still under way finishes first, so the two never race to open an
  /// account. `finishing` brackets it, as `loading` covers that page load.
  public func completeSignIn(_ result: BackendClient.BackendReturn) async {
    set.finishing(true)
    defer { set.finishing(false) }
    if let started { await started.value }
    let openBefore = Accounts.takeOpenAtSignIn(env.tabStorage)
    let list = applyBackendReturn(result, openBefore: openBefore, list: rows())
    refreshRows()
    guard case .session = result else { return }
    guard let first = Accounts.pickActiveAccount(list, Accounts.readActiveDid(env.storage)) else { return }
    // What start() goes on to do, unless the account it would open is the
    // one open now and wasn't the one that signed in (that one was built
    // again above, as the page load builds every account again).
    if Optional(first.did).jsEquals(active.did) && built[JSKey(first.did)] != nil { return }
    await openStarting(first, list: list)
  }

  /// The address a sign-in came back to
  /// (`https://<server>/oauth/return?n=…#session=…&did=…`), as the web reads
  /// `window.location` when its module loads (BACKEND_RETURN): only on the
  /// return path, against this run's pending sign-in, which is over
  /// whatever came back. A return is finished as `completeSignIn(_:)` does;
  /// an address that holds none changes nothing. Returns whether it held one.
  @discardableResult
  public func completeSignIn(callbackURL: String) async -> Bool {
    guard let url = try? WebURL(callbackURL), url.pathname.units.hasPrefix(AppConfig.oauthReturnPath) else { return false }
    let pending = BackendClient.readSigninPending(env.tabStorage)
    let result = BackendClient.readBackendReturn(BackendClient.ReturnLocation(url), pending, AppConfig.oauthReturnPath)
    BackendClient.clearSigninPending(env.tabStorage)
    guard let result else { return false }
    await completeSignIn(result)
    return true
  }

  /// What signIn shows when the sheet came back to the return path without a
  /// return in the address (the server always sends one): readBackendReturn's
  /// own words for a return without a usable session.
  static let cameBackEmpty: BackendClient.BackendReturn? = BackendClient.readBackendReturn(
    BackendClient.ReturnLocation(
      pathname: AppConfig.oauthReturnPath,
      search: "?error=callback_failed&error_description=\(JSURI.encodeURIComponent("The sign-in came back without a usable session."))"),
    nil, AppConfig.oauthReturnPath)

  func onBrowserSessionDropped(_ sub: String?, revoked: Bool) {
    guard let sub, let account = find(sub), account.mode == "browser" else { return }
    browserSessions[JSKey(sub)] = nil
    agents[JSKey(sub)] = nil
    if signingOut.contains(JSKey(sub)) { return }
    // Already signed out (another window marks the row before it ends the
    // session): reread follows that, and there is nothing to sign in again.
    if account.isSignedOut { return }
    // Signed out on purpose elsewhere: follow it quietly. Anything else (a
    // refresh the server refused) is a session that ended.
    markNeedsSignIn(sub, discovered: !revoked)
    if revoked && Optional(sub).jsEquals(active.did) { Task { await self.leave(sub) } }
  }

  /// Another window changed the list. Follow what it did to the accounts
  /// built here: one signed out or removed is left (the open one with a
  /// notice, as its archive must not stay on screen), one whose kind of
  /// sign-in changed is built again, and one signed back in loses the
  /// "signed out" this one had for it.
  func followOtherTab(_ list: [AccountRow]) async {
    for account in list where statuses[JSKey(account.did)] == .needsSignIn && usable(account.did) {
      clearStatus(account.did)
      forgetBuilt(account.did)
    }
    for (key, was) in built where !Optional(key.value).jsEquals(active.did) {
      let row = Accounts.findAccount(list, key.value)
      if row == nil || !usable(key.value) || !(row?.mode ?? "").jsEquals(was.mode) { forgetBuilt(key.value) }
    }

    guard let did = active.did, !signingOut.contains(JSKey(did)) else { return }
    let row = Accounts.findAccount(list, did)
    guard let row, usable(did) else {
      // This controller already knows (it found the session had ended, and
      // is sending its reader to sign in again).
      if statuses[JSKey(did)] == .needsSignIn { return }
      forgetBuilt(did)
      clearStatus(did)
      let label = Accounts.reauthNoticeLabel(row ?? AccountRow(did: did))
      env.dispatch(
        AccountCopy.sessionNoticeEvent,
        ["text": .string("\(label) isn’t signed in here any more: another tab signed it out, or its sign-in ended."), "tone": "info"])
      await leave(did)
      return
    }
    let was = built[JSKey(did)]
    if let was, !row.mode.jsEquals(was.mode) {
      // Moved to a long session (or back) elsewhere: the session this
      // controller's agent holds has been ended.
      forgetBuilt(did)
      do {
        try await open(row)
      } catch {
        if Accounts.isReauthRequiredError(error) {
          markNeedsSignIn(did)
        } else {
          setStatus(did, .unknown)
        }
      }
    } else if was?.mode == "backend" {
      let current = token(did)
      if !current.jsEquals(was?.token) {
        // Signed in again elsewhere: the agent reads the new token itself,
        // but what this controller thought of the old one no longer holds.
        built[JSKey(did)] = ("backend", current)
        backendChecker.forget(did)
        lastRecovery[JSKey(did)] = nil
        grantGone.remove(JSKey(did))
        clearStatus(did)
      }
    }
  }

  // MARK: What it hands out

  /// `switchAccount(did)`: publishes the new account in one update, with
  /// the old one up until then.
  public func switchAccount(_ did: String?) async throws {
    guard let did, !did.isEmpty, !Optional(did).jsEquals(active.did) else { return }
    guard let account = find(did) else {
      throw JSError(message: "That account isn’t remembered in this browser.")
    }
    if statusOf(did) == .needsSignIn { throw Accounts.makeReauthRequiredError(did) }
    switchSeq += 1
    let seq = switchSeq
    set.switching(did)
    defer { if seq == switchSeq { set.switching(nil) } }
    do {
      let next = try await build(account)
      if seq != switchSeq { return }
      publish(next)
      Accounts.writeActiveDid(env.storage, did)
      Accounts.touchAccount(env.storage, did, now: now)
      agents[JSKey(did)] = nil
      refreshRows()
      if next.mode == "backend" { Task { await self.learnBackendSession(did) } }
      Task { await self.refreshDisplay() }
    } catch {
      if Accounts.isReauthRequiredError(error) {
        markNeedsSignIn(did, discovered: false)
      } else {
        setStatus(did, .unknown)
      }
      throw error
    }
  }

  /// `signIn(input, { mode, intent, prompt, defense, did })`: start a
  /// sign-in. `input` is a handle, a DID, or the address of a host
  /// (https://bsky.social): with a host the account is chosen on its page,
  /// and `prompt: 'create'` opens that page on making a new one. Cancelling
  /// the task calls it off.
  ///
  /// `defense` asks for Defense's permissions too: 'scan' (or true) the read
  /// a scan needs, 'lists' that and writing lists, false neither. Unsaid, an
  /// account this device remembers keeps what it has.
  ///
  /// Through Virga's server, with an authenticator, it returns once the
  /// sign-in has come back and been taken (or set as the session's error);
  /// a sign-in called off throws a CANCELLED AbortError.
  public func signIn(_ input: String?, _ options: SignInOptions = SignInOptions()) async throws {
    let mode = options.mode ?? env.authMode
    var handleUnits = (input ?? "").jsTrimmed().units
    if handleUnits.first == Unit.at { handleUnits.removeFirst() }
    let handle = handleUnits.string
    let ask = BackendClient.signInPrompt(options.prompt)
    let remembered = rememberedFor(handle, did: options.did)?.scope
    let withDefense: AppConfig.DefenseLevel?
    if let defense = options.defense, !defense.isNull {
      withDefense = AppConfig.defenseLevel(defense)
    } else {
      withDefense = remembered.flatMap(Self.grantedDefenseLevel)
    }
    Accounts.writeOpenAtSignIn(env.tabStorage, options.intent == "reauth" ? active.did : nil)
    if mode == "backend" {
      let defenseValue: JSONValue = withDefense.map { .string($0.rawValue) } ?? false
      let authUrl = try await BackendClient.startBackendSignIn(
        backendUrl: env.backendUrl, handle: handle, origin: env.origin(), returnPath: AppConfig.oauthReturnPath, mode: mode,
        intent: options.intent, prompt: ask, defense: defenseValue, transport: env.transport, clock: env.clock,
        randomBytes: env.randomBytes, sessionStorage: env.tabStorage, assign: env.assign)
      guard let authenticator = env.authenticator else { return }
      let callback: String
      do {
        let host = (try? WebURL(env.origin()).hostname) ?? ""
        callback = try await authenticator.authenticate(url: authUrl, callbackHost: host, callbackPath: AppConfig.oauthReturnPath)
      } catch {
        // Whatever came back, the pending sign-in is over.
        BackendClient.clearSigninPending(env.tabStorage)
        if error is CancellationError || Task.isCancelled || error as? WebAuthenticationError == .cancelled {
          throw BackendError(name: "AbortError", message: "The sign-in was called off", code: "CANCELLED")
        }
        throw error
      }
      if await completeSignIn(callbackURL: callback) { return }
      // Back on the return path with nothing to take: said as a return
      // without a usable session (on the web the server always sends one).
      BackendClient.clearSigninPending(env.tabStorage)
      if let empty = Self.cameBackEmpty { await completeSignIn(empty) }
      return
    }
    // Marked before the trip, so the launch after it restores.
    SessionHint.writeSessionHint(env.storage)
    try await env.browser.signIn(handle, scope: AppConfig.signInScope(defense: withDefense), intent: options.intent, prompt: ask)
  }

  /// `signOutAccount(did)`: per device; the server keeps other devices'
  /// sessions. Falls to the next account when it was the open one.
  public func signOutAccount(_ did: String) async {
    guard let account = find(did) else { return }
    let store = env.storage
    signingOut.insert(JSKey(did))
    // Marked before the session ends, so another window that has it open
    // follows the sign-out instead of reading the dropped session as one
    // that expired.
    Accounts.markSignedOut(store, did)
    if account.mode == "backend" {
      let held = token(did)
      // The token goes from this device whatever the server said.
      _ = await BackendClient.backendSignOut(backendUrl: env.backendUrl, token: held, transport: env.transport, clock: env.clock)
      Accounts.removeBackendToken(env.secrets, did)
    } else {
      await env.browser.signOut(did, session: browserSessions[JSKey(did)])
    }
    signingOut.remove(JSKey(did))
    forgetBuilt(did)
    clearStatus(did)
    refreshRows()
    if Optional(did).jsEquals(active.did) { await leave(did) }
  }

  /// `removeAccount(did, { deleteData })`: signs it out and forgets it here,
  /// with its data when asked.
  public func removeAccount(_ did: String, deleteData: Bool = false) async {
    guard find(did) != nil else { return }
    await signOutAccount(did)
    let store = env.storage
    Accounts.forgetAccount(store, did, secrets: env.secrets)
    clearStatus(did)
    refreshed.remove(JSKey(did))
    if deleteData {
      Accounts.removeLocalData(store, did)
      // `Promise.all(localDatabases(did).map(deleteDatabase))`: asked in
      // that order (one after the other here, where the web's run side by
      // side; neither waits on the other's answer).
      for name in Accounts.localDatabases(did) { _ = await env.deleteDatabase(name) }
      // The archive keeps one connection per account; the deleted one's has
      // gone, so start them all afresh.
      await env.resetAnalyticsStore(did)
    }
    refreshRows()
  }

  /// `agentFor(did)`: the open agent for the open account, and another,
  /// built once, for the rest. Never falls back to the open account for one
  /// that has to sign in again.
  public func agentFor(_ did: String?) async throws -> XRPCAgent {
    if let did, Optional(did).jsEquals(active.did), let agent = active.agent { return agent }
    guard let did, let account = find(did), statusOf(did) != .needsSignIn else {
      throw Accounts.makeReauthRequiredError(did)
    }
    let key = JSKey(did)
    if agents[key] == nil {
      nextAgentId += 1
      let id = nextAgentId
      let task = Task { @MainActor () throws -> XRPCAgent in
        do {
          guard let agent = try await self.build(account).agent else { throw Accounts.makeReauthRequiredError(did) }
          return agent
        } catch {
          if self.agents[key]?.id == id { self.agents[key] = nil }
          if Accounts.isReauthRequiredError(error) { self.markNeedsSignIn(did) }
          throw error
        }
      }
      agents[key] = (id, task)
    }
    return try await agents[key]!.task.value
  }

  /// `targetFor(did)`: `{ did, agent, pdsUrl }`.
  public func targetFor(_ did: String) async throws -> SessionTarget {
    let resolve = env.resolvePdsUrl
    async let pdsUrl = resolve(did)
    let agent = try await agentFor(did)
    return SessionTarget(did: did, agent: agent, pdsUrl: try await pdsUrl)
  }

  /// `backendFor(did)`: a requester for Virga's server as a long-session
  /// account, bound to its own token, or nil.
  public func backendFor(_ did: String?) -> VirgaBackend? {
    guard let did, let account = find(did), account.mode == "backend", !account.isSignedOut else { return nil }
    guard let current = token(did) else { return nil }
    if let held = requesters[JSKey(did)], held.token.jsEquals(current) { return held.requester }
    let secrets = env.secrets
    let weak = WeakController(self)
    let requester = VirgaBackend(
      backendUrl: env.backendUrl,
      token: { Accounts.readBackendToken(secrets, did) },
      did: did,
      transport: env.transport,
      onUnauthorized: { _, code in
        Task { @MainActor in weak.value?.onUnauthorized(did, code) }
      })
    requesters[JSKey(did)] = (current, requester)
    return requester
  }

  /// `checkAccount(did)`: the same reading settleCheck gives the account's
  /// status: an "expired" the server didn't confirm is unknown, and so is a
  /// grant the server couldn't restore, whatever the lite check says.
  public func checkAccount(_ did: String) async -> SessionCheckStatus {
    guard let account = find(did), !account.isSignedOut else { return .expired }
    let checker = account.mode == "backend" ? backendChecker : browserChecker
    let result = await checker.check(did)
    if result.status == .expired && !result.definitive { return .unknown }
    if result.status == .valid && grantGone.contains(JSKey(did)) { return .unknown }
    return result.status
  }

  /// `reread()`: another window changed the account list: read it again,
  /// and follow it.
  public func reread() async {
    await followOtherTab(refreshRows())
  }
}
