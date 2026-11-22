// useDefense.js's two hooks as models: DefenseAccountModel (the open
// account, its Defense permissions and the sign-in that asks for more) and
// DefenseListsModel (the account's lists, read again while something
// waits). Over a stand-in session and over a real SessionModel.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
@testable import VirgaDefense

private let server = "https://server.example"
private let token = "vg_" + String(repeating: "0f", count: 32)
private let mira = "did:plc:virgaharnessmira2zq4x"
private let lab = "did:plc:virgaharnesslab7k2pq"

private struct Refused: Error, LocalizedError {
  var errorDescription: String? { "The server said no." }
}

/// A session as the Defense models read it.
@MainActor
private final class FakeSession: DefenseSession {
  var did: String?
  var accounts: [SessionAccount]
  var authMode = "backend"
  var transport = MockTransport()
  var tokens: [String: String] = [:]
  var signIns: [(input: String?, options: SignInOptions)] = []
  var signInError: (any Error)?
  var holdSignIn = false
  private var held: [CheckedContinuation<Void, Never>] = []

  init(did: String?, accounts: [SessionAccount]) {
    self.did = did
    self.accounts = accounts
  }

  func capabilitiesFor(_ did: String?) -> AccountCapabilities {
    let row = accounts.first { $0.did == did }.map { AccountRow(did: $0.did, handle: $0.handle, mode: $0.mode, scope: "atproto") }
    return SessionController.capabilitiesFrom(row, row == nil ? nil : .ready)
  }

  func backendFor(_ did: String?) -> VirgaBackend? {
    guard let did, let account = accounts.first(where: { $0.did == did }), account.mode == "backend", let t = tokens[did] else {
      return nil
    }
    return VirgaBackend(backendUrl: server, token: { t }, did: did, transport: transport)
  }

  func signIn(_ input: String?, _ options: SignInOptions) async throws {
    signIns.append((input, options))
    if holdSignIn { await withCheckedContinuation { held.append($0) } }
    if let signInError { throw signInError }
  }

  func release() {
    let waiting = held
    held = []
    waiting.forEach { $0.resume() }
  }
}

/// The poll's timer, moved on by hand.
private final class Ticker: Sendable {
  private struct State {
    var waiters: [UUID: CheckedContinuation<Void, Never>] = [:]
    var cancelled: Set<UUID> = []
    var asked: [Double] = []
  }

  private let state = Locked(State())

  var asked: [Double] { state.wrappedValue.asked }
  var sleeping: Int { state.wrappedValue.waiters.count }

  var sleep: @Sendable (Double) async -> Void {
    { [self] ms in
      let id = UUID()
      await withTaskCancellationHandler {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
          let now = state.withLock { s -> Bool in
            if s.cancelled.contains(id) { return true }
            s.waiters[id] = c
            s.asked.append(ms)
            return false
          }
          if now { c.resume() }
        }
      } onCancel: {
        let c = state.withLock { s -> CheckedContinuation<Void, Never>? in
          s.cancelled.insert(id)
          return s.waiters.removeValue(forKey: id)
        }
        c?.resume()
      }
    }
  }

  func tick() {
    let waiting = state.withLock { s -> [CheckedContinuation<Void, Never>] in
      let w = Array(s.waiters.values)
      s.waiters = [:]
      return w
    }
    waiting.forEach { $0.resume() }
  }
}

/// Waits (a little at a time, two seconds at most) until `condition` holds.
@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async {
  for _ in 0..<2000 where !condition() {
    try? await Task.sleep(nanoseconds: 1_000_000)
  }
}

private func lists(waiting: Int, name: String = "Pile-on") -> JSONValue {
  [
    "success": true,
    "data": [
      "lists": [["id": 7, "name": .string(name), "waiting": .number(Double(waiting)), "listed": 3]],
      "kept": [], "writes": true,
    ],
  ]
}

@MainActor
@Suite struct DefenseAccountModelBehaviour {
  private let account = SessionAccount(did: mira, handle: "mira.example.com", mode: "backend")

  @Test func readsTheOpenAccountAndWhatItsGrantAllows() {
    let session = FakeSession(did: mira, accounts: [account, SessionAccount(did: lab, handle: "lab.example.org")])
    let model = DefenseAccountModel(session: session)
    #expect(model.did == mira)
    #expect(model.account == account)
    #expect(model.caps == session.capabilitiesFor(mira))
    session.did = "did:plc:nobody"
    #expect(model.account == nil)
    session.did = nil
    #expect(model.account == nil)
  }

  @Test func asksForMoreOfDefenseBySigningInAgain() async {
    let session = FakeSession(did: mira, accounts: [account])
    let model = DefenseAccountModel(session: session)
    await model.askFor(.lists)
    #expect(model.asking == nil)
    let asked = session.signIns.first
    #expect(asked?.input == "mira.example.com")
    #expect(asked?.options == SignInOptions(mode: "backend", intent: "reauth", defense: "lists", did: mira))

    await model.askFor(.scan)
    #expect(session.signIns.last?.options.defense == "scan")
    // Giving Defense up is the web's `false`.
    await model.askFor(nil)
    #expect(session.signIns.last?.options.defense == .bool(false))
  }

  @Test func isBusyWhileTheSignInIsUnderWay() async {
    let session = FakeSession(did: mira, accounts: [account])
    session.holdSignIn = true
    let model = DefenseAccountModel(session: session)
    let asking = Task { await model.askFor(.scan) }
    await eventually { !session.signIns.isEmpty }
    #expect(model.asking == .busy)
    session.release()
    let came = await asking.value
    #expect(came)
    #expect(model.asking == nil)
  }

  @Test func saysWhyASignInDidntStart() async {
    let session = FakeSession(did: mira, accounts: [account])
    session.signInError = Refused()
    let model = DefenseAccountModel(session: session)
    await model.askFor(.lists)
    #expect(model.asking == .error(OAuthClient.signInErrorMessage(Refused())))
  }

  @Test func saysNothingOfASignInCalledOff() async {
    // Cancel on the system's sign-in sheet (SessionController's AbortError,
    // code CANCELLED), or the reader coming back from the host: no words,
    // as the rest of the app has none for it.
    let session = FakeSession(did: mira, accounts: [account])
    let model = DefenseAccountModel(session: session)
    session.signInError = BackendError(name: "AbortError", message: "The sign-in was called off", code: "CANCELLED")
    await model.askFor(.scan)
    #expect(model.asking == nil)
    session.signInError = BackendError(name: "Error", message: "User navigated back")
    await model.askFor(nil)
    #expect(model.asking == nil)
    // One that didn't start still says so, and a later cancel clears it.
    session.signInError = Refused()
    await model.askFor(.lists)
    #expect(model.asking == .error(OAuthClient.signInErrorMessage(Refused())))
    session.signInError = BackendError(name: "AbortError", message: "The sign-in was called off", code: "CANCELLED")
    await model.askFor(.lists)
    #expect(model.asking == nil)
  }

  @Test func answersWhetherTheSignInCameBack() async {
    // The scan page drops the account's scan on a yes, as the web's page
    // starts again after its sign-in.
    let session = FakeSession(did: mira, accounts: [account])
    let model = DefenseAccountModel(session: session)
    let came = await model.askFor(.scan)
    #expect(came)
    let turnedOff = await model.askFor(nil)
    #expect(turnedOff)
    session.signInError = BackendError(name: "AbortError", message: "The sign-in was called off", code: "CANCELLED")
    let calledOff = await model.askFor(.scan)
    #expect(!calledOff)
    session.signInError = Refused()
    let refused = await model.askFor(.scan)
    #expect(!refused)
    session.did = nil
    let nobody = await model.askFor(.scan)
    #expect(!nobody)
  }

  @Test func signsInByDidWhenThereIsNoHandleAndKeepsTheAccountsMode() async {
    let bare = SessionAccount(did: lab, handle: nil, mode: "browser")
    let session = FakeSession(did: lab, accounts: [bare])
    let model = DefenseAccountModel(session: session)
    await model.askFor(.scan)
    #expect(session.signIns.first?.input == lab)
    #expect(session.signIns.first?.options.mode == "browser")
  }

  @Test func aModelessAccountTakesTheReauthMode() async {
    let session = FakeSession(did: lab, accounts: [SessionAccount(did: lab, handle: "lab.example.org", mode: "")])
    session.authMode = "browser"
    let model = DefenseAccountModel(session: session)
    await model.askFor(.scan)
    #expect(session.signIns.first?.options.mode == "browser")
  }

  @Test func asksNothingWithoutAnAccount() async {
    let session = FakeSession(did: nil, accounts: [account])
    let model = DefenseAccountModel(session: session)
    await model.askFor(.lists)
    #expect(session.signIns.isEmpty)
    #expect(model.asking == nil)
  }
}

@MainActor
@Suite struct DefenseListsModelBehaviour {
  private func session(token t: String? = token) -> FakeSession {
    let s = FakeSession(
      did: mira,
      accounts: [SessionAccount(did: mira, handle: "mira.example.com", mode: "backend"), SessionAccount(did: lab, mode: "browser")])
    if let t { s.tokens[mira] = t }
    return s
  }

  @Test func readsTheListsThroughTheAccountsRequester() async throws {
    let s = session()
    s.transport.on(.path("/api/defense/lists"), respond: .json(lists(waiting: 0)))
    let model = DefenseListsModel(did: mira, session: s)
    #expect(model.loading)
    await model.start()
    #expect(!model.loading)
    #expect(model.error == nil)
    #expect(model.data?["lists"]?[0]?["name"] == "Pile-on")
    #expect(!model.waiting)
    let sent = try #require(s.transport.requests.first)
    #expect(sent.url == "\(server)/api/defense/lists")
    #expect(sent.headers.get("authorization") == "Bearer \(token)")
  }

  @Test func hasNothingForAnAccountWithoutALongSession() async {
    let s = session()
    let model = DefenseListsModel(did: lab, session: s)
    #expect(!model.loading)
    await model.start()
    #expect(model.data == nil)
    #expect(model.error == nil)
    #expect(s.transport.requests.isEmpty)
    let none = DefenseListsModel(did: nil, session: s)
    #expect(await none.refresh() == nil)
    #expect(none.requester == nil)
  }

  @Test func wordsAFailureAndKeepsWhatItHad() async {
    let s = session()
    s.transport.on(.path("/api/defense/lists"), times: 1, respond: .json(lists(waiting: 0)))
    s.transport.on(.path("/api/defense/lists"), respond: .json(["success": false, "code": "UNAVAILABLE", "error": "x"], status: 503))
    let model = DefenseListsModel(did: mira, session: s)
    await model.start()
    #expect(await model.refresh() == nil)
    #expect(model.error == "Defense isn’t set up on Virga’s server yet.")
    #expect(model.data?["lists"]?[0]?["name"] == "Pile-on")
    #expect(!model.loading)
  }

  @Test func readsAgainWhileSomethingWaitsAndStopsWhenNothingDoes() async {
    let s = session()
    s.transport.on(.path("/api/defense/lists"), times: 2, respond: .json(lists(waiting: 3)))
    s.transport.on(.path("/api/defense/lists"), respond: .json(lists(waiting: 0)))
    let ticker = Ticker()
    let model = DefenseListsModel(did: mira, session: s, sleep: ticker.sleep)
    await model.start()
    #expect(model.waiting)
    await eventually { ticker.sleeping == 1 }
    #expect(ticker.asked == [DefenseListsModel.pollMs])
    ticker.tick()
    await eventually { s.transport.requests.count == 2 && ticker.sleeping == 1 }
    #expect(model.waiting)
    ticker.tick()
    await eventually { s.transport.requests.count == 3 && !model.waiting }
    #expect(!model.waiting)
    // Nothing waits: the timer is gone.
    await eventually { ticker.sleeping == 0 }
    #expect(ticker.sleeping == 0)
    ticker.tick()
    try? await Task.sleep(nanoseconds: 20_000_000)
    #expect(s.transport.requests.count == 3)
  }

  @Test func stopsTheTimerWhenItGoesButNotARead() async {
    let s = session()
    s.transport.on(.path("/api/defense/lists"), respond: .json(lists(waiting: 1)))
    let ticker = Ticker()
    let model = DefenseListsModel(did: mira, session: s, sleep: ticker.sleep)
    await model.start()
    await eventually { ticker.sleeping == 1 }
    model.stop()
    await eventually { ticker.sleeping == 0 }
    #expect(ticker.sleeping == 0)
    #expect(model.error == nil)
  }

  @Test func onlyTheLatestReadSetsTheLists() async {
    let s = session()
    let first = Locked(true)
    s.transport.on(.path("/api/defense/lists")) { _ in
      if first.withLock({ f in defer { f = false }; return f }) {
        try await Task.sleep(nanoseconds: 50_000_000)
        return .json(lists(waiting: 0, name: "Stale"))
      }
      return .json(lists(waiting: 0, name: "Fresh"))
    }
    let model = DefenseListsModel(did: mira, session: s)
    let slow = Task { await model.refresh() }
    await eventually { s.transport.requests.count == 1 }
    await model.refresh()
    let stale = await slow.value
    #expect(stale?["lists"]?[0]?["name"] == "Stale")
    #expect(model.data?["lists"]?[0]?["name"] == "Fresh")
  }

  @Test func setsTheTimerAgainAtOnceForANewRequester() async {
    // useDefenseLists' interval effect runs again at the commit that brings
    // a new requester, before that requester's read comes back.
    let s = session()
    s.tokens[lab] = "vg_lab"
    s.accounts[1].mode = "backend"
    let release = Locked(false)
    s.transport.on(.path("/api/defense/lists")) { request in
      if request.headers.get("authorization") == "Bearer vg_lab" {
        while !release.wrappedValue { try await Task.sleep(nanoseconds: 1_000_000) }
      }
      return .json(lists(waiting: 1))
    }
    let ticker = Ticker()
    let model = DefenseListsModel(did: mira, session: s, sleep: ticker.sleep)
    await model.start()
    await eventually { ticker.sleeping == 1 }
    #expect(ticker.asked.count == 1)
    let switching = Task { await model.update(did: lab) }
    await eventually { ticker.asked.count == 2 && ticker.sleeping == 1 }
    #expect(ticker.asked.count == 2)
    #expect(ticker.sleeping == 1)
    #expect(model.loading)
    release.withLock { $0 = true }
    await switching.value
    #expect(!model.loading)
    #expect(model.waiting)
    // Still waiting: the timer set at the change goes on.
    #expect(ticker.asked.count == 2)
    #expect(ticker.sleeping == 1)
    model.stop()
  }

  @Test func followsTheAccountAndItsToken() async {
    let s = session()
    s.tokens[lab] = "vg_lab"
    s.accounts[1].mode = "backend"
    s.transport.on(.path("/api/defense/lists")) { request in
      .json(lists(waiting: 0, name: request.headers.get("authorization") ?? ""))
    }
    let model = DefenseListsModel(did: mira, session: s)
    await model.start()
    #expect(model.data?["lists"]?[0]?["name"] == .string("Bearer \(token)"))
    // The same account and token: nothing to read again.
    await model.update(did: mira)
    #expect(s.transport.requests.count == 1)
    await model.update(did: lab)
    #expect(model.data?["lists"]?[0]?["name"] == "Bearer vg_lab")
    // A new sign-in, a new token: read again.
    s.tokens[lab] = "vg_lab2"
    await model.update(did: lab)
    #expect(model.data?["lists"]?[0]?["name"] == "Bearer vg_lab2")
    await model.update(did: nil)
    #expect(model.data == nil)
    #expect(s.transport.requests.count == 3)
  }
}

@MainActor
@Suite struct DefenseModelsOverTheSession {
  @Test func readTheSessionModelsAccountsAndRequesters() async throws {
    let storage = InMemoryKeyValueStore()
    let secrets = InMemorySecretStore()
    _ = Accounts.writeAccounts(storage, [AccountRow(did: mira, handle: "mira.example.com", mode: "backend", lastUsed: 1, addedAt: 1)])
    _ = Accounts.writeBackendToken(secrets, mira, token)
    let transport = MockTransport()
    transport.on(.path("/api/defense/lists"), respond: .json(lists(waiting: 0)))
    let session = SessionModel(
      env: SessionEnvironment(
        storage: storage, tabStorage: InMemoryKeyValueStore(), secrets: secrets, backendUrl: server, transport: transport))

    let lists = DefenseListsModel(did: mira, session: session)
    #expect(lists.loading)
    await lists.start()
    #expect(lists.data?["writes"] == true)
    #expect(transport.requests.first?.headers.get("authorization") == "Bearer \(token)")

    // Nobody is open until the session has started.
    let account = DefenseAccountModel(session: session)
    #expect(account.did == nil)
    #expect(account.account == nil)
    #expect(account.caps == session.capabilitiesFor(nil))
  }

  @Test func followsTheSessionWhenTheAccountIsSignedOut() async throws {
    // The hook re-renders with the session: once the account is signed out
    // it has no requester, and its lists go, with nothing more asked.
    let storage = InMemoryKeyValueStore()
    let secrets = InMemorySecretStore()
    _ = Accounts.writeAccounts(storage, [AccountRow(did: mira, handle: "mira.example.com", mode: "backend", lastUsed: 1, addedAt: 1)])
    _ = Accounts.writeBackendToken(secrets, mira, token)
    let transport = MockTransport()
    transport.on(.path("/api/defense/lists"), respond: .json(lists(waiting: 0)))
    transport.on(.path("/api/oauth/logout"), respond: .json(["success": true]))
    let session = SessionModel(
      env: SessionEnvironment(
        storage: storage, tabStorage: InMemoryKeyValueStore(), secrets: secrets, backendUrl: server, transport: transport))

    let lists = DefenseListsModel(did: mira, session: session)
    await lists.start()
    #expect(lists.data?["writes"] == true)
    await session.signOutAccount(mira)
    await eventually { lists.data == nil }
    #expect(lists.data == nil)
    #expect(lists.requester == nil)
    #expect(lists.error == nil)
    #expect(transport.requests.filter { $0.url.hasSuffix("/api/defense/lists") }.count == 1)
    lists.stop()
  }

  @Test func followsNothingOnceStopped() async throws {
    let storage = InMemoryKeyValueStore()
    let secrets = InMemorySecretStore()
    _ = Accounts.writeAccounts(storage, [AccountRow(did: mira, handle: "mira.example.com", mode: "backend", lastUsed: 1, addedAt: 1)])
    _ = Accounts.writeBackendToken(secrets, mira, token)
    let transport = MockTransport()
    transport.on(.path("/api/defense/lists"), respond: .json(lists(waiting: 0)))
    transport.on(.path("/api/oauth/logout"), respond: .json(["success": true]))
    let session = SessionModel(
      env: SessionEnvironment(
        storage: storage, tabStorage: InMemoryKeyValueStore(), secrets: secrets, backendUrl: server, transport: transport))

    let lists = DefenseListsModel(did: mira, session: session)
    await lists.start()
    lists.stop()
    await session.signOutAccount(mira)
    try await Task.sleep(nanoseconds: 50_000_000)
    // Unmounted: what it last read stays, as a hook's state goes with it.
    #expect(lists.data?["writes"] == true)
  }
}
