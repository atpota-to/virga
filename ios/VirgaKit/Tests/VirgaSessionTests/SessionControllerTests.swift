// src/session/sessionController.test.js, as SessionController's behaviour:
// one published account at a time ({ did, agent, session } in one update),
// a switch that leaves the old account up until the new one is ready,
// sign-out that falls to the next account, a long session that is only
// marked dead after the server has said so three times.
//
// Every web test is here. The browser-session ones run against FakeBrowser,
// the driver's interface the controller keeps (the app passes
// NoBrowserSessions). Where the web hands a sign-in an AbortSignal, these
// cancel the task.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaSession

private let mira = People.mira
private let lab = People.lab
private let third = People.third
private let token = People.token
private let token2 = People.token2

private let invalid: MockTransport.Response = .failure("FRONTEND_SESSION_INVALID", status: 401)

@MainActor
@Suite struct StartingUp {
  @Test func opensTheRememberedAccountItsAgentActingAsIt() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "browser", at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets) { _, _ in
      .json(["success": true, "authenticated": true, "scope": .string(AppConfig.oauthScope)])
    }
    await w.ctrl.startOnce()
    #expect(w.state.active.did == mira)
    #expect(w.state.active.agent?.did == mira)
    #expect(w.state.active.session?.sub == mira)
    #expect(w.state.active.session?.did == mira)
    #expect(w.state.active.session?.mode == "backend")
    #expect(w.state.active.session?.oauth == nil)
    #expect(w.state.active.mode == "backend")
    #expect(w.state.activeLog == [mira])
    #expect(s.storage.getItem(SessionHint.sessionHintKey) == "1")
  }

  @Test func runsOnceHoweverOftenItsAsked() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(storage: s.storage, secrets: s.secrets)
    async let a: Void = w.ctrl.startOnce()
    async let b: Void = w.ctrl.startOnce()
    _ = await (a, b)
    #expect(w.state.activeLog == [mira])
    #expect(w.browser.state.wrappedValue.onDeletedCalls == 1)
  }

  @Test func takesAReturnFromVirgasServerTheTokenTheAccountAndItOpens() async {
    let s = Stores()
    s.remember(lab, "browser")
    Accounts.writeActiveDid(s.storage, lab)
    let w = World(
      storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [lab]),
      backendReturn: sessionReturn(mira, token, intent: "add"))
    await w.ctrl.startOnce()
    #expect(w.token(mira) == token)
    #expect(s.storage.getItem(Accounts.activeKey) == mira)
    #expect(w.state.active.did == mira)
    let rows = Accounts.readAccounts(s.storage).map { [$0.did, $0.mode] }
    #expect(rows == [[mira, "backend"], [lab, "browser"]])
  }

  @Test func endsTheBrowserSessionOfAnAccountThatMovedToALongOne() async {
    let s = Stores()
    s.remember(mira, "browser")
    let w = World(storage: s.storage, secrets: s.secrets, backendReturn: sessionReturn(mira, token, intent: "reauth"))
    await w.ctrl.startOnce()
    #expect(await eventually { w.browser.state.wrappedValue.signOuts.contains { $0.did == mira && $0.session == nil } })
  }

  @Test func showsAReturnThatCameBackWithAnErrorAndChangesNothing() async {
    let declined = errorReturn("access_denied")
    let w = World(backendReturn: declined)
    await w.ctrl.startOnce()
    guard case .error(let expected, _) = declined else {
      Issue.record("not an error return")
      return
    }
    #expect(w.state.error as? BackendClient.ReturnError == expected)
    #expect(w.state.active.did == nil)
    #expect(w.state.active.agent == nil)
    #expect(w.storage.getItem(Accounts.accountsKey) == nil)
  }

  @Test func finishesABrowserSignInOnTheCallbackAndMakesItTheOpenAccount() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(
      storage: s.storage, secrets: s.secrets, browser: FakeBrowser(callback: (lab, "add")), onCallbackPath: true)
    await w.ctrl.startOnce()
    #expect(w.state.active.did == lab)
    #expect(w.row(lab)?.mode == "browser")
    #expect(w.row(lab)?.scope == AppConfig.oauthScope)
    // The other account is still signed in, as a second one.
    #expect(w.token(mira) == token)
  }

  @Test func recordsTheAccountOfABrowserThatSignedInBeforeTheAccountList() async {
    let s = Stores()
    try? s.storage.setItem(SessionHint.sessionHintKey, "1")
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira], legacy: mira))
    await w.ctrl.startOnce()
    #expect(w.state.active.did == mira)
    #expect(Accounts.readAccounts(s.storage).first?.did == mira)
    #expect(Accounts.readAccounts(s.storage).first?.mode == "browser")
  }

  @Test func movesOnToTheNextAccountWhenTheRememberedOneHasSignedOutQuietly() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    s.remember(lab, "backend", token: token, at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    #expect(w.state.active.did == lab)
    #expect(w.row(mira)?.signedOut == true)
    #expect(w.ctrl.statusOf(mira) == .needsSignIn)
    // Not discovered while in use, so nobody is sent off to sign in.
    #expect(w.state.events.isEmpty)
  }

  @Test func keepsAnAccountItCouldntCheckRatherThanOpeningAnotherBehindItsBack() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    s.remember(lab, "backend", token: token, at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let browser = FakeBrowser()
    browser.state.withLock { $0.restoreError = BrowserRestoreError(restoreFailure: "unknown", message: "Failed to fetch") }
    let w = World(storage: s.storage, secrets: s.secrets, browser: browser)
    await w.ctrl.startOnce()
    #expect(browser.restores.count == 2)
    #expect(w.heard.waits.wrappedValue == [1_500])
    #expect(w.state.active.did == nil)
    #expect(w.state.activeLog.isEmpty)
    #expect(w.ctrl.statusOf(mira) == .unknown)
    #expect(w.row(mira)?.signedOut == nil)
  }
}

@MainActor
@Suite struct Switching {
  private func twoAccounts() async -> World {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    return w
  }

  @Test func publishesTheNewAccountInOneUpdateWithTheOldOneUpUntilThen() async throws {
    let w = await twoAccounts()
    let before = w.state.active.agent
    try await w.ctrl.switchAccount(lab)
    // While it switched, the switching DID was up with the old account
    // still published; then the new one came in one update.
    #expect(w.state.switchingLog == [lab, nil])
    #expect(w.state.activeWhenSwitching == [mira, lab])
    #expect(w.state.activeLog == [mira, lab])
    #expect(before?.did == mira)
    #expect(w.state.active.did == lab)
    #expect(w.state.active.agent?.did == lab)
    #expect(w.state.switching == nil)
    #expect(w.storage.getItem(Accounts.activeKey) == lab)
    #expect(Accounts.readAccounts(w.storage).first?.did == lab)
  }

  @Test func neverPairsOneAccountsAgentWithAnothersDid() async throws {
    let w = await twoAccounts()
    for did in [lab, mira, lab] {
      try await w.ctrl.switchAccount(did)
      #expect(w.state.active.did == did)
      #expect(w.state.active.agent?.did == did)
      #expect(w.state.active.session?.sub == did)
    }
  }

  @Test func refusesAnAccountWhoseSignInHasGoneAndLeavesTheOpenOneAsItWas() async {
    let w = await twoAccounts()
    w.secrets.removeSecret(for: Accounts.backendTokenKey(lab))
    let error = await thrown { try await w.ctrl.switchAccount(lab) }
    #expect(Accounts.isReauthRequiredError(error))
    #expect(w.state.active.did == mira)
    #expect(w.state.switching == nil)
  }

  @Test func doesNothingForTheAccountAlreadyOpen() async throws {
    let w = await twoAccounts()
    try await w.ctrl.switchAccount(mira)
    #expect(w.state.activeLog == [mira])
  }

  @Test func refusesAnAccountThisDeviceDoesntRemember() async {
    let w = await twoAccounts()
    let error = await thrown { try await w.ctrl.switchAccount(third) }
    #expect(error.map(jsMessage) == "That account isn’t remembered in this browser.")
    #expect(w.state.switchingLog.isEmpty)
  }
}

@MainActor
@Suite struct ActingAsAnAccountWithoutSwitching {
  @Test func handsOutTheOpenAgentForTheOpenAccountAndAnotherForTheRest() async throws {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "browser", at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [lab]))
    await w.ctrl.startOnce()
    let open = try await w.ctrl.agentFor(mira)
    #expect(open.did == mira)
    #expect(w.state.active.agent?.did == mira)
    let other = try await w.ctrl.agentFor(lab)
    #expect(other.did == lab)
    _ = try await w.ctrl.agentFor(lab)
    // Built once: one restore for it.
    #expect(w.browser.restores.filter { $0 == lab }.count == 1)
    #expect(w.state.activeLog == [mira])
    let target = try await w.ctrl.targetFor(lab)
    #expect(target.did == lab)
    #expect(target.agent.did == lab)
    #expect(target.pdsUrl == "https://pds.example")
    #expect(w.browser.restores.filter { $0 == lab }.count == 1)
  }

  @Test func neverFallsBackToTheOpenAccountForOneThatHasToSignInAgain() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", at: 1)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    let needsSignIn = await thrown { try await w.ctrl.agentFor(lab) }
    #expect(Accounts.isReauthRequiredError(needsSignIn))
    let nobody = await thrown { try await w.ctrl.agentFor("did:plc:nobodyhere") }
    #expect(Accounts.isReauthRequiredError(nobody))
    let none = await thrown { try await w.ctrl.agentFor(nil) }
    #expect(Accounts.isReauthRequiredError(none))
  }

  @Test func givesARequesterToALongSessionOnlyBoundToItsOwnToken() async throws {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "browser", at: 1)
    let w = World(storage: s.storage, secrets: s.secrets) { _, _ in .json(["success": true, "data": []]) }
    #expect(w.ctrl.backendFor(lab) == nil)
    #expect(w.ctrl.backendFor(third) == nil)
    #expect(w.ctrl.backendFor(nil) == nil)
    let req = try #require(w.ctrl.backendFor(mira))
    #expect(req.did == mira)
    // The same requester while the token holds.
    _ = w.ctrl.backendFor(mira)
    #expect(w.ctrl.requesters.count == 1)
    _ = try await req.request("/api/schedule/list")
    #expect(w.transport.requests.last?.headers.get("authorization") == "Bearer \(token)")
  }

  @Test func givesNoRequesterToASignedOutAccount() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    Accounts.markSignedOut(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets)
    #expect(w.ctrl.backendFor(mira) == nil)
  }
}

@MainActor
@Suite struct SigningOut {
  @Test func endsThisDevicesLongSessionDropsTheTokenAndOpensTheNextAccount() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    await w.ctrl.signOutAccount(mira)
    let logout = w.calls(endingWith: "/api/oauth/logout").first
    #expect(logout?.headers.get("authorization") == "Bearer \(token)")
    #expect(w.keptGrants == [false])
    #expect(w.token(mira) == nil)
    #expect(w.row(mira)?.signedOut == true)
    #expect(w.state.active.did == lab)
    #expect(w.state.switching == nil)
  }

  @Test func fallsToTheFrontPageWhenNoAccountIsLeftAndClearsTheHint() async {
    let s = Stores()
    s.remember(mira, "browser")
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira]))
    await w.ctrl.startOnce()
    await w.ctrl.signOutAccount(mira)
    #expect(w.browser.state.wrappedValue.signOuts.map(\.did) == [mira])
    #expect(w.browser.state.wrappedValue.signOuts.map(\.session) == [mira])
    #expect(w.state.active.did == nil)
    #expect(w.state.active.agent == nil)
    #expect(s.storage.getItem(Accounts.activeKey) == nil)
    #expect(s.storage.getItem(SessionHint.sessionHintKey) == nil)
    // The row stays, to come back to.
    #expect(Accounts.readAccounts(s.storage).count == 1)
  }

  @Test func signsABackgroundAccountOutWithoutTouchingTheOpenOne() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    await w.ctrl.signOutAccount(lab)
    #expect(w.state.active.did == mira)
    #expect(w.state.activeLog == [mira])
    #expect(w.token(mira) == token)
    #expect(w.token(lab) == nil)
  }

  @Test func removesAnAccountFromThisDeviceWithItsDataWhenAsked() async {
    let s = Stores()
    try? s.storage.setItem("virga:dashboards:\(lab)", "[]")
    try? s.storage.setItem("virga:keep:cleanup:\(lab)", "[]")
    try? s.storage.setItem("virga:dashboards:\(mira)", "[]")
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    await w.ctrl.removeAccount(lab, deleteData: true)
    #expect(Accounts.readAccounts(s.storage).map(\.did) == [mira])
    #expect(s.storage.getItem("virga:dashboards:\(lab)") == nil)
    #expect(s.storage.getItem("virga:keep:cleanup:\(lab)") == nil)
    #expect(s.storage.getItem("virga:dashboards:\(mira)") == "[]")
    #expect(w.heard.deleted.wrappedValue == ["virga-analytics:\(lab)", "virga-posting:\(lab)"])
    #expect(w.heard.resets.wrappedValue == [lab])
    #expect(w.token(lab) == nil)
  }

  @Test func keepsTheDataOfAnAccountRemovedWithoutAsking() async {
    let s = Stores()
    try? s.storage.setItem("virga:dashboards:\(lab)", "[]")
    s.remember(lab, "backend", token: token2)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.removeAccount(lab, deleteData: false)
    #expect(s.storage.getItem("virga:dashboards:\(lab)") == "[]")
    #expect(w.heard.deleted.wrappedValue.isEmpty)
    #expect(w.heard.resets.wrappedValue.isEmpty)
    #expect(Accounts.readAccounts(s.storage).isEmpty)
  }

  @Test func removingAnAccountItDoesntRememberDoesNothing() async {
    let w = World()
    await w.ctrl.removeAccount(lab, deleteData: true)
    await w.ctrl.signOutAccount(lab)
    #expect(w.transport.requests.isEmpty)
    #expect(w.heard.deleted.wrappedValue.isEmpty)
  }
}

@MainActor
@Suite(.serialized) struct NoticingThatASignInHasEnded {
  private func openBackend(_ answer: @escaping World.Answer) async -> World {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(storage: s.storage, secrets: s.secrets, answer: answer)
    await w.ctrl.startOnce()
    return w
  }

  @Test func marksALongSessionDeadOnlyAfterThreeDefinitiveAnswers() async {
    let w = await openBackend { url, _ in url.contains("/api/oauth/session") ? invalid : .json(["success": true]) }
    #expect(await w.ctrl.checkAccount(mira) == .expired)
    await w.settle()
    #expect(w.calls(endingWith: "/api/oauth/session?lite=1").count == 3)
    #expect(w.heard.waits.wrappedValue.contains(2_500))
    #expect(w.ctrl.statusOf(mira) == .needsSignIn)
    #expect(w.token(mira) == nil)
    #expect(w.state.events.contains(SessionEvent(name: Accounts.sessionExpiredEvent, detail: ["did": .string(mira)])))
  }

  @Test func neverMarksItDeadForAServerThatLostTheGrantOrAnswered503() async {
    let answers: [MockTransport.Response] = [
      .json(["success": true, "authenticated": true, "oauthSessionMissing": true]),
      .failure("VALIDATION_TRANSIENT_ERROR", status: 503),
      .failure("OAUTH_SESSION_MISSING", status: 401),
    ]
    for answer in answers {
      let w = await openBackend { url, _ in url.contains("/api/oauth/session") ? answer : .json(["success": true]) }
      _ = await w.ctrl.checkAccount(mira)
      await w.settle()
      #expect(w.ctrl.statusOf(mira) != .needsSignIn)
      #expect(w.token(mira) == token)
      #expect(w.state.events.isEmpty)
    }
  }

  @Test func runsTheSameRulesWhenARequestIsRefusedWithA401() async throws {
    let w = await openBackend { url, _ in
      if url.contains("/api/oauth/session?lite=1") { return invalid }
      if url.contains("/api/oauth/proxy") { return .failure("FRONTEND_SESSION_INVALID", status: 401, error: "gone") }
      return .json(["success": true])
    }
    let agent = try #require(w.state.active.agent)
    _ = try? await agent.query("app.bsky.actor.getPreferences")
    #expect(await eventually { w.state.events.contains(SessionEvent(name: Accounts.sessionExpiredEvent, detail: ["did": .string(mira)])) })
    #expect(w.ctrl.statusOf(mira) == .needsSignIn)
  }

  @Test func followsABrowserSessionTheLibraryDroppedQuietlyForASignOutOutLoudForAnExpiry() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    s.remember(lab, "browser", at: 1)
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira, lab]))
    await w.ctrl.startOnce()
    w.browser.drop(lab, revoked: true)
    #expect(w.ctrl.statusOf(lab) == .needsSignIn)
    #expect(w.state.events.isEmpty)
    w.browser.drop(mira, revoked: false)
    #expect(w.state.events == [SessionEvent(name: Accounts.sessionExpiredEvent, detail: ["did": .string(mira)])])
  }

  @Test func ignoresADroppedSessionThatIsntABrowserOne() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    w.browser.drop(mira, revoked: false)
    w.browser.drop(nil, revoked: false)
    w.browser.drop(third, revoked: false)
    #expect(w.ctrl.statusOf(mira) == .ready)
    #expect(w.state.events.isEmpty)
  }

  @Test func learnsALongSessionsGrantAndItsRepoFromTheServer() async {
    let w = await openBackend { url, _ in
      url.hasSuffix("/api/oauth/session")
        ? .json(["success": true, "authenticated": true, "scope": "atproto", "pds": "https://pds.example"]) : .json(["success": true])
    }
    #expect(await eventually { w.row(mira)?.scope == "atproto" })
    #expect(await eventually { w.heard.remembered.wrappedValue == [[mira, "https://pds.example"]] })
    #expect(w.ctrl.statusOf(mira) == .ready)
  }

  @Test func ignoresAGrantLearnedForATokenReplacedWhileItRan() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let swap = Locked(false)
    let secrets = s.secrets
    let w = World(storage: s.storage, secrets: s.secrets) { url, _ in
      guard url.hasSuffix("/api/oauth/session") else { return .json(["success": true]) }
      // Signed in again while the server answered.
      if swap.wrappedValue { Accounts.writeBackendToken(secrets, mira, token2) }
      return .json(["success": true, "authenticated": true, "scope": "atproto", "oauthSessionMissing": .bool(swap.wrappedValue)])
    }
    await w.ctrl.startOnce()
    await w.settle()
    #expect(w.row(mira)?.scope == "atproto")
    Accounts.updateAccount(s.storage, mira) { $0.scope = nil }
    swap.set(true)
    await w.ctrl.learnBackendSession(mira)
    // The answer was about the old token: nothing is taken from it.
    #expect(w.row(mira)?.scope == nil)
    #expect(w.ctrl.statusOf(mira) == .ready)
  }
}

/// `deadGrant`: the grant's row outlives a refresh token that has died, so
/// the lite check (which reads only the row) still answers valid. The full
/// check and the proxy both restore it, and say it's missing.
private func deadGrant(_ url: String) -> MockTransport.Response {
  if url.hasSuffix("/api/oauth/session?lite=1") {
    return .json(["success": true, "authenticated": true, "lite": true, "oauthSessionMissing": false])
  }
  if url.hasSuffix("/api/oauth/session") { return .json(["success": true, "authenticated": true, "oauthSessionMissing": true]) }
  if url.contains("/api/oauth/proxy") { return .failure("OAUTH_SESSION_MISSING", status: 401, error: "Please sign in again") }
  return .json(["success": true])
}

@MainActor
@Suite(.serialized) struct AGrantTheServerCantRestore {
  private func openBackend(_ answer: @escaping World.Answer) async -> World {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(storage: s.storage, secrets: s.secrets, answer: answer)
    await w.ctrl.startOnce()
    return w
  }

  private func preferences(_ w: World) async throws -> XRPCResponse {
    let agent = try #require(w.state.active.agent)
    return try await agent.query("app.bsky.actor.getPreferences")
  }

  @Test func staysUnknownWhichOffersASignInAfterA401WhateverTheLiteCheckSays() async {
    let w = await openBackend { url, _ in deadGrant(url) }
    #expect(await eventually { w.ctrl.statusOf(mira) == .unknown })
    await w.settle()
    _ = try? await preferences(w)
    // The 401 is about the grant, so it is asked of the full check.
    #expect(await eventually { w.calls(endingWith: "/api/oauth/session").count == 2 })
    await w.settle()
    #expect(w.calls(endingWith: "/api/oauth/session?lite=1").isEmpty)
    #expect(await w.ctrl.checkAccount(mira) == .unknown)
    #expect(w.calls(endingWith: "/api/oauth/session?lite=1").count == 1)
    #expect(w.ctrl.statusOf(mira) == .unknown)
    #expect(w.state.events.isEmpty)
  }

  @Test func goesUnknownOnThe401EvenWhenTheFullCheckAtOpeningSaidItHeld() async {
    let grantDied = Locked(false)
    let w = await openBackend { url, _ in
      !grantDied.wrappedValue && url.hasSuffix("/api/oauth/session")
        ? .json(["success": true, "authenticated": true, "oauthSessionMissing": false]) : deadGrant(url)
    }
    #expect(await eventually { w.ctrl.statusOf(mira) == .ready })
    await w.settle()
    grantDied.set(true)
    _ = try? await preferences(w)
    #expect(w.ctrl.statusOf(mira) == .unknown)
    #expect(await w.ctrl.checkAccount(mira) == .unknown)
    await w.settle()
    #expect(w.ctrl.statusOf(mira) == .unknown)
  }

  @Test func isReadyAgainOnceAnAnswerComesBackThroughTheGrant() async throws {
    let alive = Locked(false)
    let w = await openBackend { url, _ in
      alive.wrappedValue && url.contains("/api/oauth/proxy") ? .json(["success": true, "data": ["preferences": []]]) : deadGrant(url)
    }
    _ = try? await preferences(w)
    #expect(await eventually { w.ctrl.statusOf(mira) == .unknown })
    await w.settle()
    alive.set(true)
    _ = try await preferences(w)
    #expect(w.ctrl.statusOf(mira) == .ready)
    #expect(await w.ctrl.checkAccount(mira) == .valid)
  }

  @Test func isReadyAgainOnceTheFullCheckFindsTheGrant() async {
    let alive = Locked(false)
    let w = await openBackend { url, _ in
      alive.wrappedValue && url.hasSuffix("/api/oauth/session")
        ? .json(["success": true, "authenticated": true, "oauthSessionMissing": false]) : deadGrant(url)
    }
    #expect(await eventually { w.ctrl.statusOf(mira) == .unknown })
    await w.settle()
    alive.set(true)
    // The proxy still refuses, so the 401 asks the full check, which now finds it.
    _ = try? await preferences(w)
    #expect(await eventually { w.calls(endingWith: "/api/oauth/session").count == 2 })
    #expect(await eventually { w.ctrl.statusOf(mira) == .ready })
    #expect(await w.ctrl.checkAccount(mira) == .valid)
  }

  @Test func asksAtMostOnceEveryTenSeconds() async {
    let w = await openBackend { url, _ in deadGrant(url) }
    await w.settle()
    _ = try? await preferences(w)
    await w.settle()
    _ = try? await preferences(w)
    await w.settle()
    // The opening check and the first 401's; the second 401 came too soon.
    #expect(w.calls(endingWith: "/api/oauth/session").count == 2)
  }
}

@MainActor
@Suite struct SigningIn {
  @Test func startsALongSessionThroughVirgasServerComingBackToTheReturnPath() async throws {
    let w = World { _, _ in .json(["success": true, "authUrl": "https://bsky.social/oauth/authorize?x=1"]) }
    try await w.ctrl.signIn("@mira.example.com", SignInOptions(mode: "backend", intent: "add"))
    #expect(w.heard.assigned.wrappedValue == ["https://bsky.social/oauth/authorize?x=1"])
    let url = try WebURL(try #require(w.transport.requests.first).url)
    #expect(url.pathname == "/api/oauth/login")
    #expect(url.searchParams.first { $0.0 == "handle" }?.1 == "mira.example.com")
    let back = url.searchParams.first { $0.0 == "redirect_uri" }?.1 ?? ""
    #expect(back.hasPrefix("https://virga.example/oauth/return?n="))
    #expect(back.dropFirst("https://virga.example/oauth/return?n=".count).allSatisfy { $0.isHexDigit && !$0.isUppercase })
  }

  @Test func startsABrowserSignInWithTheScopeMarkingThatASessionMayExist() async throws {
    let w = World()
    try await w.ctrl.signIn("mira.example.com", SignInOptions(mode: "browser", intent: "reauth"))
    #expect(w.browser.signIns == [.init(input: "mira.example.com", scope: AppConfig.oauthScope, intent: "reauth", prompt: nil)])
    #expect(w.storage.getItem(SessionHint.sessionHintKey) == "1")
  }

  @Test func sendsSomeoneToAHostToMakeAnAccountEitherWayOfSigningIn() async throws {
    let backend = World { _, _ in .json(["success": true, "authUrl": "https://eurosky.social/oauth/authorize?x=2"]) }
    try await backend.ctrl.signIn("https://eurosky.social", SignInOptions(mode: "backend", prompt: "create"))
    #expect(backend.heard.assigned.wrappedValue == ["https://eurosky.social/oauth/authorize?x=2"])
    let asked = try WebURL(try #require(backend.transport.requests.first).url).searchParams
    #expect(asked.first { $0.0 == "handle" }?.1 == "https://eurosky.social")
    #expect(asked.first { $0.0 == "prompt" }?.1 == "create")

    let w = World()
    try await w.ctrl.signIn("https://eurosky.social", SignInOptions(mode: "browser", prompt: "create"))
    #expect(w.browser.signIns == [.init(input: "https://eurosky.social", scope: AppConfig.oauthScope, intent: "add", prompt: "create")])
  }

  @Test func aSignInCalledOffGoesNowhere() async throws {
    let backend = World { _, _ in .json(["success": true, "authUrl": "https://bsky.social/oauth/authorize?x=3"]) }
    let task = Task { @MainActor in
      withUnsafeCurrentTask { $0?.cancel() }
      try await backend.ctrl.signIn("mira.example.com", SignInOptions(mode: "backend"))
    }
    let error = await thrown { try await task.value }
    #expect(JSErrorFields(error)?.codeString == "CANCELLED")
    #expect(backend.heard.assigned.wrappedValue.isEmpty)
    #expect(backend.transport.requests.isEmpty)
  }

  @Test func dropsAPromptASignInHasNoBusinessSending() async throws {
    let w = World()
    try await w.ctrl.signIn("mira.example.com", SignInOptions(mode: "browser", prompt: "none"))
    #expect(w.browser.signIns == [.init(input: "mira.example.com", scope: AppConfig.oauthScope, intent: "add", prompt: nil)])
  }

  @Test func asksForDefensesPermissionOnlyWhenToldToEitherWayOfSigningIn() async throws {
    let w = World()
    try await w.ctrl.signIn("mira.example.com", SignInOptions(mode: "browser", intent: "reauth", defense: true))
    #expect(w.browser.signIns.last == .init(input: "mira.example.com", scope: AppConfig.defenseScope, intent: "reauth", prompt: nil))
    try await w.ctrl.signIn("mira.example.com", SignInOptions(mode: "browser", intent: "reauth", defense: false))
    #expect(w.browser.signIns.last == .init(input: "mira.example.com", scope: AppConfig.oauthScope, intent: "reauth", prompt: nil))

    let backend = World { _, _ in .json(["success": true, "authUrl": "https://bsky.social/oauth/authorize?x=4"]) }
    try await backend.ctrl.signIn("mira.example.com", SignInOptions(mode: "backend", intent: "reauth", defense: true))
    let asked = try WebURL(try #require(backend.transport.requests.first).url).searchParams
    #expect(asked.first { $0.0 == "defense" }?.1 == "1")
    let plain = World { _, _ in .json(["success": true, "authUrl": "https://bsky.social/oauth/authorize?x=5"]) }
    try await plain.ctrl.signIn("mira.example.com", SignInOptions(mode: "backend"))
    let none = try WebURL(try #require(plain.transport.requests.first).url).searchParams
    #expect(!none.contains { $0.0 == "defense" })
  }

  @Test func keepsDefenseForAnAccountThatHasItWhenSigningInAgainAndGivesItToNoOneElse() async throws {
    let storage = InMemoryKeyValueStore()
    Accounts.recordSignIn(storage, did: mira, mode: "browser", handle: "mira.example.com", scope: .granted(AppConfig.defenseScope), now: 2)
    Accounts.recordSignIn(storage, did: lab, mode: "browser", handle: "lab.example.org", scope: .granted(AppConfig.oauthScope), now: 1)
    let w = World(storage: storage)
    try await w.ctrl.signIn("Mira.Example.com", SignInOptions(mode: "browser", intent: "reauth"))
    #expect(w.browser.signIns.last == .init(input: "Mira.Example.com", scope: AppConfig.defenseScope, intent: "reauth", prompt: nil))
    try await w.ctrl.signIn(mira, SignInOptions(mode: "browser", intent: "reauth"))
    #expect(w.browser.signIns.last?.scope == AppConfig.defenseScope)
    try await w.ctrl.signIn("lab.example.org", SignInOptions(mode: "browser", intent: "reauth"))
    #expect(w.browser.signIns.last?.scope == AppConfig.oauthScope)
    try await w.ctrl.signIn("someone.else.example", SignInOptions(mode: "browser"))
    #expect(w.browser.signIns.last?.scope == AppConfig.oauthScope)
    // Turning it off is a sign-in that says so.
    try await w.ctrl.signIn(mira, SignInOptions(mode: "browser", intent: "reauth", defense: false))
    #expect(w.browser.signIns.last?.scope == AppConfig.oauthScope)
  }

  @Test func findsTheAccountByItsDidWhenTheSignInSaysWhichAndTrustsNoHandleTwoAccountsShare() async throws {
    let storage = InMemoryKeyValueStore()
    // Lab once had the handle Mira has now, and still says so here.
    Accounts.recordSignIn(storage, did: lab, mode: "browser", handle: "shared.example", scope: .granted(AppConfig.defenseScope), now: 3)
    Accounts.recordSignIn(storage, did: mira, mode: "browser", handle: "shared.example", scope: .granted(AppConfig.oauthScope), now: 2)
    let w = World(storage: storage)
    try await w.ctrl.signIn("shared.example", SignInOptions(mode: "browser", intent: "reauth", did: mira))
    #expect(w.browser.signIns.last?.scope == AppConfig.oauthScope)
    try await w.ctrl.signIn("shared.example", SignInOptions(mode: "browser", intent: "reauth", did: lab))
    #expect(w.browser.signIns.last?.scope == AppConfig.defenseScope)
    // Without a DID, a handle two rows hold names neither.
    try await w.ctrl.signIn("shared.example", SignInOptions(mode: "browser", intent: "reauth"))
    #expect(w.browser.signIns.last?.scope == AppConfig.oauthScope)
  }

  @Test func keepsTheListsForAnAccountThatHasThemAndAsksForThemWhenToldTo() async throws {
    let storage = InMemoryKeyValueStore()
    Accounts.recordSignIn(storage, did: mira, mode: "browser", handle: "mira.example.com", scope: .granted(AppConfig.listsScope), now: 2)
    let w = World(storage: storage)
    try await w.ctrl.signIn(mira, SignInOptions(mode: "browser", intent: "reauth"))
    #expect(w.browser.signIns.last?.scope == AppConfig.listsScope)
    try await w.ctrl.signIn("lab.example.org", SignInOptions(mode: "browser", defense: "lists"))
    #expect(w.browser.signIns.last?.scope == AppConfig.listsScope)
    try await w.ctrl.signIn(mira, SignInOptions(mode: "browser", intent: "reauth", defense: "scan"))
    #expect(w.browser.signIns.last?.scope == AppConfig.defenseScope)
  }

  @Test func takesTheEnvironmentsModeWhenTheSignInDoesntSay() async throws {
    let w = World(authMode: "backend") { _, _ in .json(["success": true, "authUrl": "https://bsky.social/oauth/authorize?x=6"]) }
    try await w.ctrl.signIn("mira.example.com")
    #expect(w.heard.assigned.wrappedValue == ["https://bsky.social/oauth/authorize?x=6"])
    #expect(w.browser.signIns.isEmpty)
  }

  @Test func wordsASignInThatCouldntStart() async {
    let w = World { _, _ in .json(["success": false, "code": "HANDLE_NOT_FOUND", "error": "Could not resolve handle"], status: 400) }
    let error = await thrown { try await w.ctrl.signIn("nobody.example", SignInOptions(mode: "backend")) }
    #expect(OAuthClient.signInErrorMessage(error).hasPrefix("Couldn’t find that account."))
    #expect(w.heard.assigned.wrappedValue.isEmpty)
    #expect(BackendClient.readSigninPending(w.tabStorage) == nil)
  }
}

@MainActor
@Suite struct CapabilitiesFrom {
  private let old = "atproto repo:app.bsky.graph.follow?action=create&action=delete"

  private func row(_ mode: String, scope: String? = nil) -> AccountRow { AccountRow(did: mira, mode: mode, scope: scope) }

  @Test func letsALongSessionScheduleAndUseTheAdviserABrowserOneNeither() {
    #expect(
      SessionController.capabilitiesFrom(row("backend"), .ready)
        == AccountCapabilities(
          mode: "backend", canPost: true, canSchedule: true, canUseAi: true, defense: "unknown", lists: "unknown", canWriteLists: true,
          missing: []))
    #expect(
      SessionController.capabilitiesFrom(row("browser"), .ready)
        == AccountCapabilities(
          mode: "browser", canPost: true, canSchedule: false, canUseAi: false, defense: "unknown", lists: "unknown", canWriteLists: false,
          missing: []))
    #expect(SessionController.capabilitiesFrom(row("backend"), .unknown).canSchedule)
    let gone = SessionController.capabilitiesFrom(row("backend"), .needsSignIn)
    #expect(!gone.canPost && !gone.canSchedule && !gone.canUseAi)
    let none = SessionController.capabilitiesFrom(nil, .needsSignIn)
    #expect(none.mode == nil && !none.canPost)
  }

  @Test func cantPostFromAGrantWithoutThePostingPermissionsAndSaysWhatsMissing() {
    let caps = SessionController.capabilitiesFrom(row("browser", scope: old), .ready)
    #expect(!caps.canPost)
    for token in AppConfig.postingTokens { #expect(caps.missing.contains(token)) }
    let full = SessionController.capabilitiesFrom(row("browser", scope: AppConfig.oauthScope), .ready)
    #expect(full.canPost && full.missing.isEmpty)
  }

  @Test func saysWhetherTheGrantHoldsDefensesPermissionWithoutCountingItAsMissingFromAnOrdinaryOne() {
    let plain = SessionController.capabilitiesFrom(row("browser", scope: AppConfig.oauthScope), .ready)
    #expect(plain.defense == "missing" && plain.missing.isEmpty)
    let defense = SessionController.capabilitiesFrom(row("browser", scope: AppConfig.defenseScope), .ready)
    #expect(defense.defense == "granted" && defense.missing.isEmpty)
    #expect(SessionController.capabilitiesFrom(row("backend", scope: "atproto \(AppConfig.defenseTokens[0])"), .ready).defense == "granted")
    #expect(SessionController.capabilitiesFrom(row("browser"), .ready).defense == "unknown")
  }

  @Test func saysWhetherTheGrantWritesListsAndLetsOnlyALongSessionHaveThemWritten() {
    let lists = SessionController.capabilitiesFrom(row("backend", scope: AppConfig.listsScope), .ready)
    #expect(lists.defense == "granted" && lists.lists == "granted" && lists.canWriteLists)
    let scan = SessionController.capabilitiesFrom(row("backend", scope: AppConfig.defenseScope), .ready)
    #expect(scan.defense == "granted" && scan.lists == "missing" && !scan.canWriteLists)
    let browser = SessionController.capabilitiesFrom(row("browser", scope: AppConfig.listsScope), .ready)
    #expect(browser.lists == "granted" && !browser.canWriteLists)
    #expect(!SessionController.capabilitiesFrom(row("backend", scope: AppConfig.listsScope), .needsSignIn).canWriteLists)
  }
}

@MainActor
@Suite struct FollowingAnotherWindow {
  @Test func sendsTheTokenAnotherWindowSignedInWithNotTheOneTheAgentWasBuiltWith() async throws {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let seen = Locked<[String]>([])
    let w = World(storage: s.storage, secrets: s.secrets) { url, request in
      let auth = request.headers.get("authorization") ?? ""
      if url.contains("/api/oauth/proxy") { seen.withLock { $0.append(auth) } }
      if url.contains("/api/oauth/session") {
        return .json(["success": true, "authenticated": true, "scope": .string(AppConfig.oauthScope)])
      }
      if auth == "Bearer \(token)" { return .failure("FRONTEND_SESSION_INVALID", status: 401, error: "gone") }
      return .json([
        "success": true,
        "data": ["did": .string(mira), "handle": "mira.example.com", "didDoc": [:], "collections": [], "handleIsCorrect": true],
      ])
    }
    await w.ctrl.startOnce()
    let agent = try #require(w.state.active.agent)
    let requester = try #require(w.ctrl.backendFor(mira))
    Accounts.writeBackendToken(s.secrets, mira, token2)
    await w.ctrl.reread()
    _ = try await agent.query("com.atproto.repo.describeRepo", ["repo": .string(mira)])
    #expect(seen.wrappedValue == ["Bearer \(token2)"])
    _ = try await requester.request("/api/schedule/list")
    await w.settle()
    #expect(w.ctrl.statusOf(mira) == .ready)
  }

  @Test func leavesTheOpenAccountWhenAnotherWindowSignsItOutSayingSo() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    // What the other window's signOutAccount leaves in the stores.
    Accounts.markSignedOut(s.storage, mira)
    s.secrets.removeSecret(for: Accounts.backendTokenKey(mira))
    await w.ctrl.reread()
    #expect(w.state.active.did == lab)
    #expect(w.state.eventNames == [AccountCopy.sessionNoticeEvent])
    let text = w.state.events.first?.detail["text"]?.stringValue ?? ""
    #expect(text.contains("isn’t signed in here any more"))
    #expect(text == "@mira.example.com isn’t signed in here any more: another tab signed it out, or its sign-in ended." || text.hasPrefix(mira))
    #expect(w.state.events.first?.detail["tone"] == "info")
  }

  @Test func fallsToTheFrontPageWhenTheAccountAnotherWindowRemovedWasTheOnlyOne() async {
    let s = Stores()
    s.remember(mira, "browser")
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira]))
    await w.ctrl.startOnce()
    #expect(w.state.active.did == mira)
    Accounts.forgetAccount(s.storage, mira, secrets: s.secrets)
    await w.ctrl.reread()
    #expect(w.state.active.did == nil)
    #expect(w.state.active.agent == nil)
    #expect(w.state.active.session == nil)
    #expect(Accounts.readActiveDid(s.storage) == nil)
    #expect(w.state.events.first?.detail["text"]?.stringValue == "\(mira) isn’t signed in here any more: another tab signed it out, or its sign-in ended.")
  }

  @Test func staysOnAnAccountThisWindowAlreadyFoundHadEndedWhichIsSigningInAgain() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    s.remember(lab, "browser", at: 1)
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira, lab]))
    await w.ctrl.startOnce()
    w.browser.drop(mira, revoked: false)
    await w.ctrl.reread()
    #expect(w.state.active.did == mira)
  }

  @Test func buildsTheOpenAccountAgainWhenAnotherWindowMovedItToALongSession() async {
    let s = Stores()
    s.remember(mira, "browser")
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira]))
    await w.ctrl.startOnce()
    #expect(w.state.active.mode == "browser")
    Accounts.recordSignIn(s.storage, did: mira, mode: "backend", now: 5)
    Accounts.writeBackendToken(s.secrets, mira, token)
    await w.ctrl.reread()
    #expect(w.state.active.did == mira)
    #expect(w.state.active.mode == "backend")
  }

  @Test func forgetsAnAgentBuiltForAnAccountAnotherWindowSignedOut() async throws {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    _ = try await w.ctrl.agentFor(lab)
    Accounts.markSignedOut(s.storage, lab)
    s.secrets.removeSecret(for: Accounts.backendTokenKey(lab))
    await w.ctrl.reread()
    let error = await thrown { try await w.ctrl.agentFor(lab) }
    #expect(Accounts.isReauthRequiredError(error))
  }

  @Test func takesBackTheSignedOutItHadForAnAccountAnotherWindowSignedInAgain() async throws {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "browser", at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser())
    await w.ctrl.startOnce()
    _ = try? await w.ctrl.agentFor(lab)
    #expect(await eventually { w.ctrl.statusOf(lab) == .needsSignIn })
    w.browser.add(lab)
    Accounts.recordSignIn(s.storage, did: lab, mode: "browser", now: 5)
    await w.ctrl.reread()
    #expect(w.ctrl.statusOf(lab) == .ready)
    let agent = try await w.ctrl.agentFor(lab)
    #expect(agent.did == lab)
  }

  @Test func followsABrowserSignOutMadeInAnotherWindowWithoutAskingAnyoneToSignIn() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    s.remember(lab, "browser", at: 1)
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira, lab]))
    await w.ctrl.startOnce()
    // The other window marks the row before it ends the session, so even a
    // drop the library couldn't tell from an expiry changes nothing here.
    Accounts.markSignedOut(s.storage, mira)
    w.browser.drop(mira, revoked: false)
    #expect(!w.state.eventNames.contains(Accounts.sessionExpiredEvent))
    // One it could tell was a sign-out leaves the account.
    w.browser.drop(lab, revoked: true)
    #expect(w.ctrl.statusOf(lab) == .needsSignIn)
    await w.ctrl.reread()
    #expect(w.state.active.did == nil)
    #expect(w.state.active.agent == nil)
    #expect(!w.state.eventNames.contains(Accounts.sessionExpiredEvent))
  }

  @Test func leavesTheOpenAccountWhenItsBrowserSessionIsRevokedFromAnotherWindow() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    s.remember(lab, "browser", at: 1)
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira, lab]))
    await w.ctrl.startOnce()
    w.browser.drop(mira, revoked: true)
    #expect(await eventually { w.state.active.did == lab })
    #expect(w.state.events.isEmpty)
  }

  @Test func marksTheRowSignedOutBeforeItEndsTheSessionForTheOtherWindowsToRead() async {
    let s = Stores()
    s.remember(mira, "browser")
    let browser = FakeBrowser(sessions: [mira])
    let rowWhenEnded = Locked<AccountRow?>(nil)
    let storage = s.storage
    browser.onSignOut.set { did in rowWhenEnded.set(Accounts.findAccount(Accounts.readAccounts(storage), did)) }
    let w = World(storage: s.storage, secrets: s.secrets, browser: browser)
    await w.ctrl.startOnce()
    await w.ctrl.signOutAccount(mira)
    #expect(rowWhenEnded.wrappedValue?.signedOut == true)
  }

  @Test func leavesNothingToFollowWhileTheOpenAccountIsSigningOut() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets)
    await w.ctrl.startOnce()
    w.ctrl.signingOut.insert(JSKey(mira))
    Accounts.markSignedOut(s.storage, mira)
    await w.ctrl.reread()
    #expect(w.state.active.did == mira)
    #expect(w.state.events.isEmpty)
  }
}

@MainActor
@Suite struct SigningAnAccountInAgain {
  @Test func signsOutTheTokenAFreshLongSessionReplaces() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(storage: s.storage, secrets: s.secrets, backendReturn: sessionReturn(mira, token2, intent: "reauth"))
    await w.ctrl.startOnce()
    #expect(w.token(mira) == token2)
    #expect(await eventually { w.loggedOut == ["Bearer \(token)"] })
    #expect(w.keptGrants == [true])
  }

  @Test func leavesTheTokenAloneWhenTheSameOneComesBack() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(storage: s.storage, secrets: s.secrets, backendReturn: sessionReturn(mira, token, intent: "reauth"))
    await w.ctrl.startOnce()
    await w.settle()
    #expect(w.loggedOut.isEmpty)
  }

  @Test func signsOutATokenFromAReturnItRefused() async {
    let w = World(backendReturn: errorReturn("unexpected_return", orphanToken: token))
    await w.ctrl.startOnce()
    #expect(await eventually { w.loggedOut == ["Bearer \(token)"] })
    // A sign-in this device didn't start may be someone else's doing: ending
    // its token must not end the account's grant.
    #expect(w.keptGrants == [true])
    #expect(w.token(mira) == nil)
    #expect(JSErrorFields(w.state.error)?.params?["error"] == "unexpected_return")
  }

  @Test func recordsTheOpenAccountWhenAnotherOneLeavesToSignInAgain() async throws {
    let s = Stores()
    s.remember(mira, "browser")
    let w = World(storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira]))
    await w.ctrl.startOnce()
    try await w.ctrl.signIn("lab.example.org", SignInOptions(mode: "browser", intent: "reauth"))
    #expect(s.tabStorage.getItem(Accounts.openAtSignInKey) == mira)
    try await w.ctrl.signIn("third.example.org", SignInOptions(mode: "browser", intent: "add"))
    #expect(s.tabStorage.getItem(Accounts.openAtSignInKey) == nil)
  }

  @Test func keepsTheOpenAccountOpenWhenAnotherOneSignsBackInThroughVirgasServer() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", at: 1)
    Accounts.markSignedOut(s.storage, lab)
    Accounts.writeActiveDid(s.storage, mira)
    try? s.tabStorage.setItem(Accounts.openAtSignInKey, mira)
    let w = World(
      storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets, backendReturn: sessionReturn(lab, token2, intent: "reauth"))
    await w.ctrl.startOnce()
    #expect(w.state.active.did == mira)
    #expect(Accounts.readActiveDid(s.storage) == mira)
    #expect(w.ctrl.statusOf(lab) == .ready)
    #expect(s.tabStorage.getItem(Accounts.openAtSignInKey) == nil)
  }

  @Test func keepsTheOpenAccountOpenWhenAnotherOneSignsBackInInTheBrowser() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    s.remember(lab, "browser", at: 1)
    Accounts.markSignedOut(s.storage, lab)
    Accounts.writeActiveDid(s.storage, mira)
    try? s.tabStorage.setItem(Accounts.openAtSignInKey, mira)
    let w = World(
      storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets,
      browser: FakeBrowser(sessions: [mira, lab], callback: (lab, "reauth")), onCallbackPath: true)
    await w.ctrl.startOnce()
    #expect(w.state.active.did == mira)
    #expect(w.ctrl.statusOf(lab) == .ready)
  }

  @Test func opensTheAccountThatSignedInWhenTheOneOpenBeforeCantBe() async {
    let s = Stores()
    s.remember(mira, "backend", at: 2)
    s.remember(lab, "backend", at: 1)
    Accounts.markSignedOut(s.storage, mira)
    try? s.tabStorage.setItem(Accounts.openAtSignInKey, mira)
    let w = World(
      storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets, backendReturn: sessionReturn(lab, token2, intent: "reauth"))
    await w.ctrl.startOnce()
    #expect(w.state.active.did == lab)
  }

  @Test func opensANewlyAddedAccountWhateverWasOpen() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    Accounts.writeActiveDid(s.storage, mira)
    try? s.tabStorage.setItem(Accounts.openAtSignInKey, mira)
    let w = World(
      storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets, backendReturn: sessionReturn(lab, token2, intent: "add"))
    await w.ctrl.startOnce()
    #expect(w.state.active.did == lab)
  }

  @Test func forgetsTheReauthAttemptsOnceASignInComesBack() async {
    let s = Stores()
    SessionHealth.recordReauthAttempt(s.tabStorage, now: Fixed.now)
    let w = World(
      storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets, backendReturn: sessionReturn(mira, token, intent: "reauth"))
    await w.ctrl.startOnce()
    #expect(s.tabStorage.getItem(SessionHealth.reauthAttemptsKey) == nil)
    // The grant is new: the row's scope is read again from the server.
    #expect(w.row(mira)?.scope == nil)
  }
}

@MainActor
@Suite struct CheckingAnAccount {
  @Test func answersUnknownNotExpiredWhenTheServerDidntConfirmTheSessionHadEnded() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(storage: s.storage, secrets: s.secrets) { url, _ in
      url.contains("/api/oauth/session?lite=1")
        ? .json(["success": true, "authenticated": true, "oauthSessionMissing": true]) : .json(["success": true])
    }
    await w.ctrl.startOnce()
    await w.settle()
    #expect(await w.ctrl.checkAccount(mira) == .unknown)
    #expect(w.ctrl.statusOf(mira) == .unknown)
  }

  @Test func answersExpiredForAnAccountSignedOutOrUnknown() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    Accounts.markSignedOut(s.storage, mira)
    let w = World(storage: s.storage, secrets: s.secrets)
    #expect(await w.ctrl.checkAccount(mira) == .expired)
    #expect(await w.ctrl.checkAccount(third) == .expired)
    #expect(w.transport.requests.isEmpty)
  }

  @Test func checksABrowserSessionOnceAgainstThisDevicesOwnStore() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    s.remember(lab, "browser", at: 1)
    let w = World(storage: s.storage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira]))
    #expect(await w.ctrl.checkAccount(mira) == .valid)
    // A session the library can't restore is gone, without asking again
    // (one round: the checker still waits its gap before it settles).
    #expect(await w.ctrl.checkAccount(lab) == .expired)
    #expect(w.ctrl.statusOf(lab) == .needsSignIn)
    #expect(w.browser.restores.filter { $0 == lab }.count == 1)
    #expect(w.heard.waits.wrappedValue == [2_500])
  }
}

@MainActor
@Suite struct FinishingASignInInTheApp {
  /// The sheet's stand-in: answers with the address the server would send
  /// the person back to, nonce and all, read off the pending sign-in.
  struct Sheet: WebAuthenticator {
    let tabStorage: InMemoryKeyValueStore
    let did: String
    let token: String
    var outcome: Outcome = .returns

    enum Outcome: Sendable { case returns, declines, closes, empty }

    func authenticate(url: String, callbackHost: String, callbackPath: String) async throws -> String {
      let nonce = BackendClient.readSigninPending(tabStorage)?["nonce"]?.stringValue ?? ""
      let base = "https://\(callbackHost)\(callbackPath)"
      switch outcome {
      case .returns: return "\(base)?n=\(nonce)#session=\(token)&did=\(did)"
      case .declines: return "\(base)?error=access_denied"
      case .empty: return base
      case .closes: throw WebAuthenticationError.cancelled
      }
    }
  }

  private let authorize: World.Answer = { url, _ in
    url.contains("/api/oauth/login")
      ? .json(["success": true, "authUrl": "https://bsky.social/oauth/authorize?x=1"])
      : .json(["success": true, "authenticated": true, "scope": .string(AppConfig.oauthScope)])
  }

  @Test func opensTheAccountOnceTheSheetComesBack() async throws {
    let tab = InMemoryKeyValueStore()
    let w = World(tabStorage: tab, authMode: "backend", authenticator: Sheet(tabStorage: tab, did: mira, token: token), answer: authorize)
    try await w.ctrl.signIn("mira.example.com")
    #expect(w.state.active.did == mira)
    #expect(w.state.active.mode == "backend")
    #expect(w.token(mira) == token)
    #expect(w.row(mira)?.mode == "backend")
    #expect(BackendClient.readSigninPending(tab) == nil)
    #expect(w.state.finishingLog == [true, false])
    #expect(w.state.error == nil)
  }

  @Test func leavesTheOpenAccountOpenWhenAnotherSignsBackInForItsOwnSake() async throws {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", at: 1)
    Accounts.markSignedOut(s.storage, lab)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(
      storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets, authMode: "backend",
      authenticator: Sheet(tabStorage: s.tabStorage, did: lab, token: token2), answer: authorize)
    await w.ctrl.startOnce()
    let before = w.state.activeLog
    try await w.ctrl.signIn("lab.example.org", SignInOptions(intent: "reauth", did: lab))
    #expect(w.state.active.did == mira)
    #expect(w.state.activeLog == before)
    #expect(w.ctrl.statusOf(lab) == .ready)
    #expect(w.token(lab) == token2)
  }

  @Test func buildsTheOpenAccountAgainWhenItIsTheOneSigningBackIn() async throws {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = World(
      storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets, authMode: "backend",
      authenticator: Sheet(tabStorage: s.tabStorage, did: mira, token: token2), answer: authorize)
    await w.ctrl.startOnce()
    try await w.ctrl.signIn("mira.example.com", SignInOptions(intent: "reauth", did: mira))
    #expect(w.state.activeLog == [mira, mira])
    #expect(w.token(mira) == token2)
    #expect(await eventually { w.loggedOut == ["Bearer \(token)"] })
  }

  @Test func showsASignInThatCameBackDeclined() async throws {
    let tab = InMemoryKeyValueStore()
    var sheet = Sheet(tabStorage: tab, did: mira, token: token)
    sheet.outcome = .declines
    let w = World(tabStorage: tab, authMode: "backend", authenticator: sheet, answer: authorize)
    try await w.ctrl.signIn("mira.example.com")
    #expect(OAuthClient.callbackErrorMessage(w.state.error) == "Access wasn’t granted, so you’re not signed in.")
    #expect(w.state.active.did == nil)
    #expect(Accounts.readAccounts(w.storage).isEmpty)
    #expect(BackendClient.readSigninPending(tab) == nil)
  }

  @Test func showsASignInThatCameBackWithNothing() async throws {
    let tab = InMemoryKeyValueStore()
    var sheet = Sheet(tabStorage: tab, did: mira, token: token)
    sheet.outcome = .empty
    let w = World(tabStorage: tab, authMode: "backend", authenticator: sheet, answer: authorize)
    try await w.ctrl.signIn("mira.example.com")
    #expect(JSErrorFields(w.state.error)?.params?["error"] == "callback_failed")
    #expect(jsMessage(try #require(w.state.error)) == "The sign-in came back without a usable session.")
    #expect(BackendClient.readSigninPending(tab) == nil)
  }

  @Test func callsTheSignInOffWhenTheSheetIsClosed() async {
    let tab = InMemoryKeyValueStore()
    var sheet = Sheet(tabStorage: tab, did: mira, token: token)
    sheet.outcome = .closes
    let w = World(tabStorage: tab, authMode: "backend", authenticator: sheet, answer: authorize)
    let error = await thrown { try await w.ctrl.signIn("mira.example.com") }
    #expect(JSErrorFields(error)?.codeString == "CANCELLED")
    #expect(SignInFlow.tripFailureNotice(error, nil) == nil)
    #expect(BackendClient.readSigninPending(tab) == nil)
    #expect(w.state.error == nil)
    #expect(w.state.finishingLog.isEmpty)
  }

  @Test func takesAReturnThatArrivesAsALink() async {
    let tab = InMemoryKeyValueStore()
    BackendClient.writeSigninPending(tab, BackendClient.SigninPending(nonce: "abc123", intent: "add", at: Fixed.now))
    let w = World(tabStorage: tab, answer: authorize)
    // Not the return path, or no return in it: nothing changes, and the
    // pending sign-in stays.
    #expect(await w.ctrl.completeSignIn(callbackURL: "https://virga.example/settings?n=abc123#session=\(token)&did=\(mira)") == false)
    #expect(await w.ctrl.completeSignIn(callbackURL: "not an address") == false)
    #expect(BackendClient.readSigninPending(tab) != nil)
    #expect(await w.ctrl.completeSignIn(callbackURL: "https://virga.example/oauth/return") == false)
    #expect(BackendClient.readSigninPending(tab) == nil)
    BackendClient.writeSigninPending(tab, BackendClient.SigninPending(nonce: "abc123", intent: "add", at: Fixed.now))
    #expect(await w.ctrl.completeSignIn(callbackURL: "https://virga.example/oauth/return?n=abc123#session=\(token)&did=\(mira)"))
    #expect(w.state.active.did == mira)
    #expect(BackendClient.readSigninPending(tab) == nil)
  }

  @Test func waitsForAStartUnderWayBeforeTakingAReturn() async {
    let s = Stores()
    s.remember(mira, "browser", at: 2)
    Accounts.writeActiveDid(s.storage, mira)
    let w = World(
      storage: s.storage, tabStorage: s.tabStorage, secrets: s.secrets, browser: FakeBrowser(sessions: [mira]), answer: authorize)
    let starting = Task { @MainActor in await w.ctrl.startOnce() }
    _ = await eventually { w.ctrl.started != nil }
    await w.ctrl.completeSignIn(sessionReturn(lab, token2, intent: "add"))
    await starting.value
    // The start's account opened first, then the one that signed in, never
    // the other way round.
    #expect(w.state.activeLog == [mira, lab])
    #expect(w.state.active.did == lab)
  }
}
