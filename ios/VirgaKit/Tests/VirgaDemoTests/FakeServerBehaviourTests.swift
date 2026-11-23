// harness/fakeServer.test.js, ported where it covers the routes this port
// has (the sessions, the terms ledger, the fake network's way to the
// server, the address flags), run through the app's own clients
// (BackendClient, VirgaBackend, BackendFetchHandler, TermsService) over
// DemoTransport. The scheduling, timer, adviser and Defense tests wait for
// the port of those routes; here those routes answer 503 in plain words,
// and that is tested instead. Also tested: what this port adds (the proxy
// forwarding to the account's agent, the sign-in's login and trip).

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaDemo

/// fakeServer.test.js's `setup({ terms })`.
struct ServerSetup {
  static let now: Double = JSDate.parse("2026-11-12T12:00:00.000Z", timeZone: .gmt)

  let world: DemoWorld
  let server: DemoServer
  let transport: DemoTransport
  let clock: Locked<Double>

  init(terms: String = "agreed", scope: String = "atproto") {
    let clock = Locked(Self.now)
    self.clock = clock
    world = DemoWorld(now: Self.now, scope: scope)
    let net = NetworkClock(now: { clock.wrappedValue }, sleep: { _ in await Task.yield() })
    server = DemoServer(world: world, terms: terms, now: net.now)
    transport = DemoTransport(world: world, server: server, latency: 0, clock: net)
  }

  var origin: String { FakeServer.serverOrigin }

  func requester(_ did: String, token: String? = nil) -> VirgaBackend {
    let held = token ?? server.mintToken(did)
    return VirgaBackend(backendUrl: origin, token: { held }, did: did, transport: transport)
  }

  func check(_ token: String) async -> SessionCheckResult {
    SessionHealth.interpretLiteSessionResponse(
      await BackendClient.checkBackendSession(backendUrl: origin, token: token, transport: transport))
  }

  func fetch(_ path: String, method: String = "GET", headers: HTTPHeaders = HTTPHeaders(), text: String? = nil) async throws
    -> HTTPResponse
  {
    try await transport.send(
      HTTPRequest(method: method, url: "\(origin)\(path)", headers: headers, body: text.map { Data($0.utf8) }))
  }

  func signedIn(_ did: String, token: String) -> XRPCAgent {
    XRPCAgent(did: did, fetchHandler: BackendFetchHandler(backendUrl: origin, token: token, did: did, transport: transport))
  }
}

func backendError(_ body: () async throws -> Void) async -> BackendError? {
  do {
    try await body()
    return nil
  } catch {
    return error as? BackendError
  }
}

@Suite struct TheServersSessions {
  @Test func answersTheSessionCheckAndSignsOutPerDevice() async throws {
    let s = ServerSetup()
    let one = s.server.mintToken(World.lab.did)
    let two = s.server.mintToken(World.lab.did)
    #expect(BackendClient.isToken(one))
    #expect(await s.check(one).status == .valid)
    #expect(await BackendClient.backendSignOut(backendUrl: s.origin, token: one, transport: s.transport))
    #expect(await s.check(one) == SessionCheckResult(status: .expired, definitive: true))
    #expect(await s.check(two).status == .valid)
  }

  @Test func endsTheGrantOnlyWithTheAccountsLastToken() {
    let s = ServerSetup()
    let one = s.server.mintToken(World.lab.did)
    let two = s.server.mintToken(World.lab.did)
    let first = s.server.signOutToken(one)
    #expect(first.found)
    #expect(first.grantRevoked == false)
    let last = s.server.signOutToken(two)
    #expect(last.found)
    #expect(last.grantRevoked)
    let again = s.server.signOutToken(two)
    #expect(again.found == false)
    #expect(again.grantRevoked == false)
  }

  @Test func answersAnUnknownTokenWithFrontendSessionInvalidEverywhere() async throws {
    let s = ServerSetup()
    let ghost = s.requester(World.me.did, token: "vg_\(String(repeating: "0", count: 64))")
    let error = await backendError { _ = try await ghost.request("/api/schedule/list") }
    #expect(error?.status == 401)
    #expect(error?.codeString == "FRONTEND_SESSION_INVALID")
    let res = try await s.fetch("/api/limits/status")
    #expect(res.status == 401)
    #expect(try res.json()["code"] == "FRONTEND_SESSION_INVALID")
    let session = try await s.fetch(
      BackendClient.BackendPaths.session, headers: ["Authorization": "Bearer vg_\(String(repeating: "1", count: 64))"])
    #expect(session.status == 401)
    #expect(try session.json()["code"] == "FRONTEND_SESSION_INVALID")
  }

  @Test func signsOutAnUnknownTokenOrNoneWithA200AsTheServerDoes() async throws {
    let s = ServerSetup()
    let unknown = try await s.fetch(
      BackendClient.BackendPaths.logout, method: "POST",
      headers: ["Authorization": "Bearer vg_\(String(repeating: "1", count: 64))"], text: "{}")
    #expect(unknown.status == 200)
    let loggedOut: JSONValue = ["success": true, "message": "Logged out successfully", "grantRevoked": false]
    #expect(try unknown.json() == loggedOut)
    let none = try await s.fetch(BackendClient.BackendPaths.logout, method: "POST", text: "{}")
    let nothing: JSONValue = ["success": true, "message": "No session to logout"]
    #expect(try none.json() == nothing)
    #expect(
      await BackendClient.backendSignOut(
        backendUrl: s.origin, token: "vg_\(String(repeating: "2", count: 64))", transport: s.transport))
    // The session check's missing-header 401 carries no code, as session.js.
    let bare = try await s.fetch(BackendClient.BackendPaths.session)
    #expect(bare.status == 401)
    #expect(try bare.json()["code"] == nil)
  }

  @Test func keepsTheGrantForATokenDroppedWithKeepGrant() async throws {
    let s = ServerSetup()
    let token = s.server.mintToken(World.lab.did)
    let out = try await s.fetch(
      BackendClient.BackendPaths.logout, method: "POST", headers: ["Authorization": "Bearer \(token)"],
      text: #"{"keepGrant":true}"#)
    #expect(try out.json()["grantRevoked"] == false)
    #expect(s.server.tokens.isEmpty)
  }

  @Test func readsARefusedGrantAsThereOnTheLiteCheckUntilSomethingHasTriedIt() async throws {
    let s = ServerSetup()
    let token = s.server.mintToken(World.me.did)
    s.server.refuseGrant(World.me.did)
    #expect(await s.check(token) == SessionCheckResult(status: .valid, definitive: false))
    let agent = s.signedIn(World.me.did, token: token)
    do {
      _ = try await agent.query(
        "com.atproto.repo.getRecord", ["repo": .string(World.me.did), "collection": "app.bsky.actor.profile", "rkey": "self"])
      Issue.record("a refused grant answered")
    } catch let error as XRPCError {
      #expect(error.status == 401)
      #expect(error.error == "OAUTH_SESSION_MISSING")
    }
    #expect(await s.check(token) == SessionCheckResult(status: .expired, definitive: false))
    let full = await BackendClient.fetchBackendSession(backendUrl: s.origin, token: token, transport: s.transport)
    #expect(full.data?["oauthSessionMissing"] == true)
    // A new sign-in writes a new grant.
    let again = s.server.mintToken(World.me.did)
    let fresh = await BackendClient.checkBackendSession(backendUrl: s.origin, token: again, transport: s.transport)
    #expect(fresh.data?["oauthSessionMissing"] == false)
  }

  @Test func answersAPreflightWithNoContentAndTheOldPathsNotAtAll() async throws {
    let s = ServerSetup()
    let preflight = try await s.fetch("/api/schedule/list", method: "OPTIONS")
    #expect(preflight.status == 204)
    #expect(preflight.body.isEmpty)
    let token = s.server.mintToken(World.me.did)
    for old in ["/oauth/session", "/virga/oauth/login"] {
      let res = try await s.fetch(old, headers: ["Authorization": "Bearer \(token)"])
      #expect(res.status == 404)
    }
  }
}

@Suite struct TheTermsLedger {
  @Test func startsWithEveryAccountAgreedSoTheAppOpens() async throws {
    let s = ServerSetup()
    let answer = try await TermsService.fetchTermsStatus(s.requester(World.me.did))
    #expect(answer.accepted)
    #expect(answer.version == .number(Double(LegalVersion.termsVersion)))
    #expect(Set(s.server.agreements.map(\.did)) == [World.me.did, World.lab.did])
  }

  @Test func answersTheRealServicesAskedThenRecordedOnceForTheSessionsAccount() async throws {
    let s = ServerSetup(terms: "ask")
    let req = s.requester(World.me.did)
    let asked = TermsStatusAnswer(accepted: false, acceptedAt: .null, version: .number(Double(LegalVersion.termsVersion)))
    #expect(try await TermsService.fetchTermsStatus(req) == asked)
    let first = try await TermsService.recordAcceptance(req)
    #expect(s.server.agreements.map(\.identity) == ["session"])
    let after = try await TermsService.fetchTermsStatus(req)
    #expect(after.accepted)
    #expect(after.acceptedAt == .string(first))
    // Again, from another device: the first agreement is the answer.
    s.clock.withLock { $0 += 60_000 }
    #expect(try await TermsService.recordAcceptance(s.requester(World.me.did)) == first)
    #expect(s.server.agreements.count == 1)
    // The other account has still to agree.
    #expect(try await TermsService.fetchTermsStatus(s.requester(World.lab.did)).accepted == false)
  }

  @Test func takesABrowserSessionsWordForItsDIDAndKeepsItApart() async throws {
    let s = ServerSetup(terms: "ask")
    let reported = try await TermsService.reportAcceptance(did: World.me.did, backendUrl: s.origin, transport: s.transport)
    // Nothing about the row comes back: the caller could be anyone.
    #expect(reported == "claimed")
    #expect(try await TermsService.fetchTermsStatus(s.requester(World.me.did)).accepted == false)
    #expect(s.server.agreements.map(\.identity) == ["claimed"])
  }

  @Test func refusesAnotherVersionADidThatIsntOneAndATokenThatDoesntHold() async throws {
    let s = ServerSetup(terms: "ask")
    let json: HTTPHeaders = ["Content-Type": "application/json"]
    let current = LegalVersion.termsVersion
    let changed = try await s.fetch(
      "/api/terms/accept", method: "POST", headers: json, text: #"{"version":\#(current + 1),"did":"\#(World.me.did)"}"#)
    #expect(changed.status == 409)
    #expect(try changed.json()["code"] == "TERMS_VERSION_MISMATCH")
    #expect(try changed.json()["version"] == .number(Double(current)))
    let handle = try await s.fetch(
      "/api/terms/accept", method: "POST", headers: json, text: #"{"version":\#(current),"did":"mira.example.com"}"#)
    #expect(handle.status == 400)
    #expect(try handle.json()["code"] == "DID_INVALID")
    let stale = s.requester(World.me.did, token: "vg_\(String(repeating: "0", count: 64))")
    let error = await backendError { _ = try await TermsService.recordAcceptance(stale) }
    #expect(error?.status == 401)
    #expect(error?.codeString == "FRONTEND_SESSION_INVALID")
    #expect(s.server.agreements.isEmpty)
  }

  @Test func canBeDownSoTheScreenHasAnErrorToShow() async throws {
    let s = ServerSetup(terms: "down")
    let req = s.requester(World.me.did)
    #expect(try await TermsService.fetchTermsStatus(req).accepted == false)
    let error = await backendError { _ = try await TermsService.recordAcceptance(req) }
    #expect(error?.status == 503)
    #expect(error?.codeString == "UNAVAILABLE")
    let claimed = await backendError {
      _ = try await TermsService.reportAcceptance(did: World.me.did, backendUrl: s.origin, transport: s.transport)
    }
    #expect(claimed?.status == 503)
  }

  @Test func takesItsFlagFromTheAddress() {
    #expect(Harness.readFlags("").terms == "agreed")
    #expect(Harness.readFlags("?terms=ask").terms == "ask")
    #expect(Harness.readFlags("?terms=down").terms == "down")
    #expect(Harness.readFlags("?terms=whatever").terms == "agreed")
  }
}

@Suite struct TheFakeNetworksWayToTheServer {
  @Test func reachesTheServerAtItsOriginAndOnlyThere() async throws {
    let s = ServerSetup()
    let token = s.server.mintToken(World.me.did)
    let res = try await s.fetch("/api/limits/status", headers: ["Authorization": "Bearer \(token)"])
    #expect(res.status == 200)
    #expect(try res.json()["policy"] == "flat")
    #expect(try await s.fetch("/api/nothing-here").status == 404)
    // The router answers its own origin only.
    #expect(await s.server.route(HTTPRequest(url: "http://127.0.0.1:5701/api/limits/status")) == nil)
  }

  @Test func namesThePageAnAccountSignsInOnAsAPDSDoes() async throws {
    let s = ServerSetup()
    let res = try await s.transport.send(HTTPRequest(url: "https://pds.harness.example/.well-known/oauth-protected-resource"))
    let resource: JSONValue = ["resource": "https://pds.harness.example", "authorization_servers": ["https://pds.harness.example"]]
    #expect(try res.json() == resource)
  }

  @Test func refusesEveryOtherHostLoudly() async throws {
    let s = ServerSetup()
    do {
      _ = try await s.transport.send(HTTPRequest(url: "https://example.com/somewhere"))
      Issue.record("an outside host was answered")
    } catch let error as HTTPTransportError {
      #expect(error == .network("harness: no fixture for example.com"))
    }
    #expect(s.transport.refused.map(\.url) == ["https://example.com/somewhere"])
  }


}

@Suite struct TheAddressFlags {
  @Test func startUnlimitedWithTheServersDefaultAIAllowances() {
    let flags = Harness.readFlags("")
    #expect(flags.limits == HarnessFlags.Limits())
    #expect(flags.aiLimits == HarnessFlags.AILimits(adviser: 30, altText: 15, style: 3))
  }

  @Test func readPerFeatureLimitsABlankOr0LeavingOneUnlimited() {
    #expect(Harness.readFlags("?limits=3,1,1").limits == HarnessFlags.Limits(scheduledPosts: 3, postTimers: 1, conditionalTimers: 1))
    #expect(Harness.readFlags("?limits=,2,0").limits == HarnessFlags.Limits(postTimers: 2))
  }

  @Test func readTheAIAllowancesOrNoneAtAll() {
    #expect(Harness.readFlags("?ailimits=5,2,1").aiLimits == HarnessFlags.AILimits(adviser: 5, altText: 2, style: 1))
    #expect(Harness.readFlags("?ailimits=unlimited").aiLimits == HarnessFlags.AILimits(adviser: nil, altText: nil, style: nil))
    #expect(Harness.readFlags("?ailimits=0").aiLimits == HarnessFlags.AILimits(adviser: 0, altText: 15, style: 3))
  }
}

/// What this port adds: the proxy answers the signed-in calls, and the
/// sign-in's login and trip.
@Suite struct TheProxyAndTheSignIn {
  @Test func forwardsASignedInCallToTheAccountsAgentAsTheTokensAccount() async throws {
    let s = ServerSetup(scope: AppConfig.oauthScope)
    let token = s.server.mintToken(World.me.did)
    let agent = s.signedIn(World.me.did, token: token)
    let profile = try await agent.query(
      "com.atproto.repo.getRecord", ["repo": .string(World.me.did), "collection": "app.bsky.actor.profile", "rkey": "self"])
    #expect(profile.data["value"]?["displayName"] == "Mira Okafor")
    // Writes land in the account's world, whoever the body names.
    let record: JSONValue = ["$type": "app.bsky.feed.post", "text": "Via Virga", "createdAt": .string(World.iso(ServerSetup.now))]
    let created = try await agent.procedure(
      "com.atproto.repo.createRecord",
      input: .json(["repo": .string(World.me.did), "collection": "app.bsky.feed.post", "rkey": "3n2zproxy2222", "record": record]))
    #expect(created.data["uri"]?.stringValue == "at://\(World.me.did)/app.bsky.feed.post/3n2zproxy2222")
    #expect(s.world.world(World.me.did)?.posts.first?.rkey == "3n2zproxy2222")
    // The agent's refusals come back as XRPC errors, word for word.
    do {
      _ = try await agent.query("app.bsky.draft.getDrafts")
      Issue.record("drafts answered without the AppView")
    } catch let error as XRPCError {
      #expect(error.status == 501)
      #expect(error.error == "MethodNotImplemented")
    }
    let drafts = try await agent.withBlueskyAppView().query("app.bsky.draft.getDrafts")
    #expect((drafts.data["drafts"]?.arrayValue?.count ?? 0) > 0)
  }

  @Test func uploadsABlobThroughVirgasServer() async throws {
    // The session's grant covers uploads (Virga's whole scope).
    let s = ServerSetup(scope: AppConfig.oauthScope)
    let token = s.server.mintToken(World.me.did)
    let agent = s.signedIn(World.me.did, token: token)
    let blob = try await Blobs.uploadBlob(agent: agent, data: Data([1, 2, 3]), encoding: "image/png")
    #expect(blob.mimeType == "image/png")
    #expect(s.world.world(World.me.did)?.blobs[blob.ref.link]?.size == 3)
    let read = try await s.transport.send(
      HTTPRequest(url: "\(World.pds)/xrpc/com.atproto.sync.getBlob?did=\(World.me.did)&cid=\(blob.ref.link)"))
    #expect(read.body == Data([1, 2, 3]))
  }

  @Test func startsASignInAndSendsTheSheetBackWithATokenForTheAccount() async throws {
    let s = ServerSetup()
    let pending = InMemoryKeyValueStore()
    let authUrl = try await BackendClient.startBackendSignIn(
      backendUrl: s.origin, handle: "@lab.example.org", origin: s.origin, returnPath: AppConfig.oauthReturnPath,
      defense: "lists", transport: s.transport, randomBytes: { Array(repeating: 7, count: $0) }, sessionStorage: pending)
    #expect(authUrl.hasPrefix("\(s.origin)\(DemoServer.authorizePath)?"))
    let back = try await DemoAuthenticator(server: s.server, clock: .instant(now: ServerSetup.now)).authenticate(
      url: authUrl, callbackHost: "server.harness.invalid", callbackPath: AppConfig.oauthReturnPath)
    let url = try WebURL(back)
    guard
      case .session(let did, let token, _, _)? = BackendClient.readBackendReturn(
        BackendClient.ReturnLocation(url), BackendClient.readSigninPending(pending), AppConfig.oauthReturnPath)
    else {
      Issue.record("no session came back: \(back)")
      return
    }
    #expect(did == World.lab.did)
    let minted = s.server.tokens.contains { $0.token == token && $0.did == World.lab.did }
    #expect(minted)
    #expect(SessionController.grantedDefenseLevel(s.world.grantOf(World.lab.did)) == .lists)
  }

  @Test func refusesASignInForSomeoneTheDemoDoesntHave() async throws {
    let s = ServerSetup()
    let error = await backendError {
      _ = try await BackendClient.startBackendSignIn(
        backendUrl: s.origin, handle: "nobody.example", origin: s.origin, returnPath: AppConfig.oauthReturnPath,
        transport: s.transport, sessionStorage: InMemoryKeyValueStore())
    }
    #expect(error?.status == 400)
    #expect(error?.codeString == "HANDLE_NOT_FOUND")
    #expect(error?.message == "That handle could not be found.")
    let blank = await backendError {
      _ = try await BackendClient.startBackendSignIn(
        backendUrl: s.origin, handle: "  ", origin: s.origin, returnPath: AppConfig.oauthReturnPath, transport: s.transport,
        sessionStorage: InMemoryKeyValueStore())
    }
    #expect(blank?.codeString == "HANDLE_REQUIRED")
    // Anyone else lands as Mira, a host's address included.
    #expect(s.server.accountFor("bsky.social")?.did == World.me.did)
    #expect(s.server.accountFor(World.lab.did)?.did == World.lab.did)
    #expect(s.server.accountFor("NOBODY at all") == nil)
  }
}
