// useAtprotoSession.jsx as SessionModel: what the app's views see of the
// session layer. Starting and restoring, signing in through the sheet and
// from a link to the return page, switching, signing out one account and
// all of them, removing an account with and without its data, following
// another window, and the errors a sign-in leaves.

import Foundation
import Observation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaSession

private let mira = People.mira
private let lab = People.lab
private let token = People.token
private let token2 = People.token2

/// Virga's server: a sign-in's address, and a session that holds.
private let virgaServer: World.Answer = { url, _ in
  if url.contains("/api/oauth/login") { return .json(["success": true, "authUrl": "https://bsky.social/oauth/authorize?x=1"]) }
  if url.contains("/api/oauth/session") {
    return .json(["success": true, "authenticated": true, "scope": .string(AppConfig.oauthScope), "pds": "https://pds.example"])
  }
  return .json(["success": true])
}

/// The sheet: comes back to the return path with what `back` says, the
/// pending sign-in's nonce in the address.
private struct Sheet: WebAuthenticator {
  let tabStorage: InMemoryKeyValueStore
  let back: @Sendable (_ base: String, _ nonce: String) -> String

  func authenticate(url: String, callbackHost: String, callbackPath: String) async throws -> String {
    let nonce = BackendClient.readSigninPending(tabStorage)?["nonce"]?.stringValue ?? ""
    return back("https://\(callbackHost)\(callbackPath)", nonce)
  }
}

/// A model over a fake world, as the app makes one: long sessions only.
@MainActor
private struct ModelWorld {
  let model: SessionModel
  let stores: Stores
  let transport: MockTransport
  let heard: Heard

  init(_ stores: Stores = Stores(), authenticator: (any WebAuthenticator)? = nil, backendReturn: BackendClient.BackendReturn? = nil, answer: @escaping World.Answer = virgaServer) {
    let transport = MockTransport()
    transport.on(.any) { request in answer(request.url, request) }
    let heard = Heard()
    let env = SessionEnvironment(
      storage: stores.storage, tabStorage: stores.tabStorage, secrets: stores.secrets, backendUrl: People.server, transport: transport,
      clock: NetworkClock(now: { heard.clock.withLock { $0 += 1; return $0 } }, sleep: { ms in
        heard.waits.withLock { $0.append(ms) }
        await Task.yield()
      }),
      backendReturn: backendReturn,
      getProfile: { did in
        heard.profiles.withLock { $0.append(did) }
        return ["did": .string(did), "handle": .string(did == mira ? "mira.example.com" : "lab.example.org"), "displayName": " Someone "]
      },
      resolvePdsUrl: { _ in "https://pds.example" },
      resetAnalyticsStore: { did in heard.resets.withLock { $0.append(did) } },
      deleteDatabase: { name in
        heard.deleted.withLock { $0.append(name) }
        return true
      },
      dispatch: { _, _ in },
      origin: { People.origin },
      assign: { url in heard.assigned.withLock { $0.append(url) } },
      authenticator: authenticator)
    model = SessionModel(env: env)
    self.stores = stores
    self.transport = transport
    self.heard = heard
  }

  func settle() async {
    let ctrl = model.controller!
    _ = await eventually { ctrl.learning.isEmpty && !ctrl.backendChecker.checking }
    for _ in 0..<20 { await Task.yield() }
  }
}

@MainActor
@Suite struct SessionModelStarting {
  @Test func restoresTheRememberedAccountThenStopsLoading() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    let w = ModelWorld(s)
    #expect(w.model.loading)
    #expect(w.model.did == nil)
    #expect(w.model.rows.map(\.did) == [mira, lab])
    await w.model.start()
    #expect(!w.model.loading)
    #expect(w.model.did == mira)
    #expect(w.model.agent?.did == mira)
    #expect(w.model.session?.sub == mira)
    #expect(w.model.mode == "backend")
    #expect(w.model.authMode == "backend")
    #expect(w.model.switching == nil)
    #expect(w.model.error == nil)
    #expect(w.model.accounts.map(\.did) == [mira, lab])
    #expect(w.model.accounts.map(\.status) == [.ready, .ready])
    // The names come in from the public profile.
    #expect(await eventually { w.model.accounts.first?.displayName == "Someone" })
    #expect(w.model.accounts.first?.handle == "mira.example.com")
  }

  @Test func loadsNothingForSomeoneWhoHasNeverSignedIn() async {
    let w = ModelWorld()
    #expect(!w.model.loading)
    await w.model.start()
    #expect(!w.model.loading)
    #expect(w.model.did == nil)
    #expect(w.model.accounts.isEmpty)
    #expect(w.transport.requests.isEmpty)
    #expect(w.model.controller.started == nil)
  }

  @Test func startsOnceHoweverOftenItIsAsked() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = ModelWorld(s)
    await w.model.start()
    await w.model.start()
    await w.settle()
    #expect(w.transport.requests.filter { $0.url.hasSuffix("/api/oauth/session") }.count == 1)
  }

  @Test func showsAnAccountThatHasToSignInAgain() async {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", at: 1)
    let w = ModelWorld(s)
    await w.model.start()
    #expect(w.model.accounts.map(\.status) == [.ready, .needsSignIn])
    #expect(w.model.capabilitiesFor(lab).canPost == false)
    #expect(w.model.capabilitiesFor(mira).canSchedule)
    #expect(w.model.capabilitiesFor("did:plc:nobody").mode == nil)
    #expect(w.model.backendFor(mira)?.did == mira)
    #expect(w.model.backendFor(lab) == nil)
  }
}

@MainActor
@Suite struct SessionModelSigningIn {
  @Test func signsInThroughTheSheetAndOpensTheAccount() async throws {
    let s = Stores()
    let tab = s.tabStorage
    let sheet = Sheet(tabStorage: tab) { base, nonce in "\(base)?n=\(nonce)#session=\(token)&did=\(mira)" }
    let w = ModelWorld(s, authenticator: sheet)
    await w.model.start()
    try await w.model.signIn("@Mira.example.com ")
    #expect(!w.model.loading)
    #expect(w.model.did == mira)
    #expect(w.model.accounts.map(\.did) == [mira])
    #expect(w.model.accounts.first?.mode == "backend")
    #expect(s.secrets.secret(for: Accounts.backendTokenKey(mira)) == token)
    let login = try #require(w.transport.requests.first { $0.url.contains("/api/oauth/login") })
    #expect(login.url.contains("handle=Mira.example.com"))
    // The grant is read once the account opens.
    #expect(await eventually { w.model.rows.first?.scope == AppConfig.oauthScope })
  }

  @Test func showsLoadingWhileASignInThatCameBackIsTaken() async throws {
    let s = Stores()
    let changed = Locked(0)
    let sheet = Sheet(tabStorage: s.tabStorage) { base, nonce in "\(base)?n=\(nonce)#session=\(token)&did=\(mira)" }
    let w = ModelWorld(s, authenticator: sheet)
    #expect(!w.model.loading)
    withObservationTracking {
      _ = w.model.loading
    } onChange: {
      changed.withLock { $0 += 1 }
    }
    try await w.model.signIn("mira.example.com")
    // It went up while the return was taken, and came down again.
    #expect(changed.wrappedValue == 1)
    #expect(!w.model.loading)
    #expect(w.model.did == mira)
  }

  @Test func takesAReturnThatArrivesAsALink() async throws {
    let s = Stores()
    let w = ModelWorld(s)
    await w.model.start()
    // Without the sheet, the sign-in hands the address on and stops, as the web's leaves.
    try await w.model.signIn("mira.example.com")
    #expect(w.heard.assigned.wrappedValue == ["https://bsky.social/oauth/authorize?x=1"])
    #expect(w.model.did == nil)
    let nonce = try #require(BackendClient.readSigninPending(s.tabStorage)?["nonce"]?.stringValue)
    #expect(await w.model.completeSignIn(callbackURL: "https://virga.example/oauth/return?n=\(nonce)#session=\(token)&did=\(mira)"))
    #expect(w.model.did == mira)
    #expect(!w.model.loading)
    #expect(BackendClient.readSigninPending(s.tabStorage) == nil)
    // A link that holds no return changes nothing.
    #expect(await w.model.completeSignIn(callbackURL: "https://virga.example/about") == false)
    #expect(w.model.did == mira)
  }

  @Test func takesAReturnTheLaunchCameWith() async {
    let s = Stores()
    let w = ModelWorld(s, backendReturn: sessionReturn(mira, token, intent: "add"))
    #expect(w.model.loading)
    await w.model.start()
    #expect(w.model.did == mira)
    #expect(!w.model.loading)
  }

  @Test func leavesAReturnsErrorToBeShownAndCleared() async throws {
    let s = Stores()
    let sheet = Sheet(tabStorage: s.tabStorage) { base, _ in "\(base)?error=access_denied&error_description=The%20user%20declined" }
    let w = ModelWorld(s, authenticator: sheet)
    await w.model.start()
    try await w.model.signIn("mira.example.com")
    let error = try #require(w.model.error)
    #expect(OAuthClient.callbackErrorMessage(error) == "Access wasn’t granted, so you’re not signed in.")
    #expect(jsMessage(error) == "The user declined")
    #expect(w.model.did == nil)
    #expect(w.model.accounts.isEmpty)
    w.model.clearError()
    #expect(w.model.error == nil)
  }

  @Test func throwsASignInThatCouldntStart() async {
    let w = ModelWorld { url, _ in
      url.contains("/api/oauth/login")
        ? .json(["success": false, "code": "RATE_LIMITED", "error": "Slow down"], status: 429) : .json(["success": true])
    }
    await w.model.start()
    let error = await thrown { try await w.model.signIn("mira.example.com") }
    #expect(OAuthClient.signInErrorMessage(error) == "Too many sign-ins were started from here in the last minute. Wait a minute and try again.")
    #expect(w.model.error == nil)
  }
}

@MainActor
@Suite struct SessionModelAccounts {
  private func two() async -> ModelWorld {
    let s = Stores()
    s.remember(mira, "backend", token: token, at: 2)
    s.remember(lab, "backend", token: token2, at: 1)
    let w = ModelWorld(s)
    await w.model.start()
    await w.settle()
    return w
  }

  @Test func switchesBetweenAccounts() async throws {
    let w = await two()
    try await w.model.switchAccount(lab)
    #expect(w.model.did == lab)
    #expect(w.model.agent?.did == lab)
    #expect(w.model.switching == nil)
    #expect(w.model.accounts.first?.did == lab)
    let agent = try await w.model.agentFor(mira)
    #expect(agent.did == mira)
    let target = try await w.model.targetFor(mira)
    #expect(target.pdsUrl == "https://pds.example")
  }

  @Test func refusesToSwitchToAnAccountItDoesntKnowOrThatHasToSignInAgain() async {
    let w = await two()
    let unknown = await thrown { try await w.model.switchAccount("did:plc:nobody") }
    #expect(unknown.map(jsMessage) == "That account isn’t remembered in this browser.")
    w.stores.secrets.removeSecret(for: Accounts.backendTokenKey(lab))
    let gone = await thrown { try await w.model.switchAccount(lab) }
    #expect(Accounts.isReauthRequiredError(gone))
    #expect(w.model.did == mira)
  }

  @Test func signsOutOneAccountThenTheOtherFallingToNone() async {
    let w = await two()
    await w.model.signOut()
    #expect(w.model.did == lab)
    #expect(w.model.accounts.map(\.status) == [.ready, .needsSignIn])
    await w.model.signOutAccount(lab)
    #expect(w.model.did == nil)
    #expect(w.model.agent == nil)
    #expect(w.model.accounts.map(\.status) == [.needsSignIn, .needsSignIn])
    // The rows stay, to come back to; the hint goes.
    #expect(w.model.rows.count == 2)
    #expect(w.stores.storage.getItem(SessionHint.sessionHintKey) == nil)
    await w.model.signOut()
    #expect(w.model.did == nil)
  }

  @Test func removesAnAccountWithItsData() async {
    let w = await two()
    try? w.stores.storage.setItem("virga:dashboards:\(lab)", "[]")
    await w.model.removeAccount(lab, deleteData: true)
    #expect(w.model.rows.map(\.did) == [mira])
    #expect(w.heard.deleted.wrappedValue == ["virga-analytics:\(lab)", "virga-posting:\(lab)"])
    #expect(w.heard.resets.wrappedValue == [lab])
    #expect(w.stores.storage.getItem("virga:dashboards:\(lab)") == nil)
    #expect(w.model.did == mira)
  }

  @Test func removesTheOpenAccountKeepingItsData() async {
    let w = await two()
    try? w.stores.storage.setItem("virga:dashboards:\(mira)", "[]")
    await w.model.removeAccount(mira)
    #expect(w.model.rows.map(\.did) == [lab])
    #expect(w.model.did == lab)
    #expect(w.heard.deleted.wrappedValue.isEmpty)
    #expect(w.heard.resets.wrappedValue.isEmpty)
    #expect(w.stores.storage.getItem("virga:dashboards:\(mira)") == "[]")
  }

  @Test func followsAnotherWindowWhenTheAccountListChanges() async {
    let w = await two()
    // Another window signs the open account out.
    Accounts.markSignedOut(w.stores.storage, mira)
    w.stores.secrets.removeSecret(for: Accounts.backendTokenKey(mira))
    // A change to another key isn't followed.
    await w.model.storageChanged(key: "virga:preferences")
    #expect(w.model.did == mira)
    await w.model.storageChanged(key: Accounts.accountsKey)
    #expect(w.model.did == lab)
    // A store that was cleared (key nil) is followed too.
    Accounts.markSignedOut(w.stores.storage, lab)
    await w.model.storageChanged(key: nil)
    #expect(w.model.did == nil)
  }

  @Test func showsAStatusChangeToWhatWatchesTheList() async {
    let s = Stores()
    s.remember(mira, "backend", token: token)
    let w = ModelWorld(s) { url, request in
      url.hasSuffix("/api/oauth/session?lite=1")
        ? .json(["success": true, "authenticated": true, "oauthSessionMissing": true]) : virgaServer(url, request)
    }
    await w.model.start()
    await w.settle()
    let changed = Locked(false)
    withObservationTracking {
      _ = w.model.accounts
    } onChange: {
      changed.set(true)
    }
    #expect(await w.model.checkAccount(mira) == .unknown)
    #expect(w.model.accounts.first?.status == .unknown)
    #expect(changed.wrappedValue)
  }
}
