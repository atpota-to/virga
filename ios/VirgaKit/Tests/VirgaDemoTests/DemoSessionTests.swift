// DemoSession (harness/fakeSession.jsx): the app's own session layer
// (SessionModel over SessionController) on the demo's network, with the
// flags that apply, and the archive's first build for Mira through it.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaDemo

@MainActor
enum DemoSessions {
  static let now = DemoNetwork.now
  static let clock = NetworkClock.instant(now: now)

  static func make(_ options: DemoOptions = DemoOptions()) async -> DemoSession {
    var given = options
    given.now = now
    given.latency = 0
    let session = DemoSession(options: given, clock: clock)
    await session.start()
    return session
  }

  /// Waits for the controller's own tasks (a session read, a profile read)
  /// to land.
  static func eventually(_ condition: () -> Bool) async -> Bool {
    for _ in 0..<2000 {
      if condition() { return true }
      await Task.yield()
    }
    return condition()
  }
}

@MainActor
@Suite struct TheDemoSession {
  @Test func opensMiraWithBothAccountsSignedInAsLongSessions() async throws {
    let session = await DemoSessions.make()
    let model = session.model
    #expect(model.did == World.me.did)
    #expect(model.mode == "backend")
    #expect(model.loading == false)
    #expect(model.accounts.map(\.did) == [World.me.did, World.lab.did])
    #expect(model.accounts.allSatisfy { $0.status == .ready })
    // Each holds a token the server minted, as a sign-in would leave it.
    for did in [World.me.did, World.lab.did] {
      let token = Accounts.readBackendToken(session.secrets, did)
      #expect(token.map(BackendClient.isToken) == true)
      let minted = session.server.tokens.contains { $0.token == token && $0.did == did }
      #expect(minted)
      #expect(Acceptance.readAcceptance(session.storage, did)?.identity == "session")
    }
    let capabilities = model.capabilitiesFor(World.me.did)
    #expect(capabilities.canPost)
    #expect(capabilities.canSchedule)
    #expect(capabilities.canUseAi)
    #expect(capabilities.defense == "missing")
    // The open account's agent reads through Virga's server, as the account.
    let followers = try await #require(model.agent).query("app.bsky.graph.getFollowers", ["limit": 2])
    #expect(followers.data["followers"]?.arrayValue?.count == 2)
    #expect(followers.data["subject"]?["handle"] == "mira.example.com")
    // The full session check names the PDS, which is remembered.
    #expect(try await session.pdsResolver.resolvePdsUrl(World.me.did) == World.pds)
  }

  @Test func opensMiraAloneForOneAccount() async {
    let session = await DemoSessions.make(.read("?accounts=1"))
    #expect(session.model.did == World.me.did)
    #expect(session.model.accounts.map(\.did) == [World.me.did])
  }

  @Test func startsOnTheFrontPageSignedOutWithBothRemembered() async {
    let session = await DemoSessions.make(.read("?signedout"))
    #expect(session.model.did == nil)
    #expect(session.model.accounts.count == 2)
    #expect(session.model.accounts.allSatisfy { $0.status == .needsSignIn })
    #expect(session.server.tokens.isEmpty)
    #expect(Accounts.readBackendToken(session.secrets, World.me.did) == nil)
    #expect(Accounts.readBackendToken(session.secrets, World.lab.did) == nil)
  }

  @Test func startsTheExpiredAccountSignedOutAndOpensTheOther() async {
    let lab = await DemoSessions.make(.read("?expired=lab"))
    #expect(lab.model.did == World.me.did)
    #expect(lab.model.accounts.first { $0.did == World.lab.did }?.status == .needsSignIn)
    let mira = await DemoSessions.make(.read("?expired=mira"))
    #expect(mira.model.did == World.lab.did)
    #expect(mira.model.accounts.first { $0.did == World.me.did }?.status == .needsSignIn)
  }

  @Test func asksForTheTermsWhenNobodyHasAgreed() async throws {
    let session = await DemoSessions.make(.read("?terms=ask"))
    #expect(Acceptance.readAcceptance(session.storage, World.me.did) == nil)
    let requester = try #require(session.model.backendFor(World.me.did))
    #expect(try await TermsService.fetchTermsStatus(requester).accepted == false)
    _ = try await TermsService.recordAcceptance(requester)
    #expect(try await TermsService.fetchTermsStatus(requester).accepted)
  }

  @Test func grantsReadingOnlyForScopeRead() async throws {
    let session = await DemoSessions.make(.read("?scope=read"))
    #expect(session.model.capabilitiesFor(World.me.did).canPost == false)
    do {
      _ = try await #require(session.model.agent).procedure(
        "com.atproto.repo.createRecord",
        input: .json([
          "repo": .string(World.me.did), "collection": "app.bsky.feed.post",
          "record": ["$type": "app.bsky.feed.post", "text": "nope", "createdAt": .string(World.iso(DemoSessions.now))],
        ]))
      Issue.record("a read-only session wrote a post")
    } catch let error as XRPCError {
      #expect(error.status == 403)
      #expect(Scopes.isMissingScopeError(error))
    }
  }

  @Test func grantsDefenseForDefenseLists() async {
    let session = await DemoSessions.make(.read("?defense=lists"))
    let capabilities = session.model.capabilitiesFor(World.me.did)
    #expect(capabilities.defense == "granted")
    #expect(capabilities.lists == "granted")
  }

  @Test func switchesSignsOutAndSignsBackInThroughTheSheet() async throws {
    let session = await DemoSessions.make()
    let model = session.model
    try await model.switchAccount(World.lab.did)
    #expect(model.did == World.lab.did)
    await model.signOutAccount(World.lab.did)
    #expect(model.did == World.me.did)
    #expect(model.accounts.first { $0.did == World.lab.did }?.status == .needsSignIn)
    #expect(session.server.tokens.contains { $0.did == World.lab.did } == false)
    try await model.signIn("@lab.example.org")
    #expect(model.did == World.lab.did)
    #expect(model.accounts.first { $0.did == World.lab.did }?.status == .ready)
    let token = Accounts.readBackendToken(session.secrets, World.lab.did)
    let minted = session.server.tokens.contains { $0.token == token && $0.did == World.lab.did }
    #expect(minted)
  }

  @Test func turnsDefenseOnWithASignInThatAsksForIt() async throws {
    let session = await DemoSessions.make()
    try await session.model.signIn(World.me.handle, SignInOptions(intent: "reauth", defense: "scan", did: World.me.did))
    #expect(SessionController.grantedDefenseLevel(session.world.grantOf(World.me.did)) == .scan)
    #expect(
      await DemoSessions.eventually { session.model.capabilitiesFor(World.me.did).defense == "granted" })
  }

  @Test func refusesASignInForSomeoneTheDemoDoesntHave() async {
    let session = await DemoSessions.make(.read("?accounts=1"))
    do {
      try await session.model.signIn("lab.example.org")
      Issue.record("signed in an account the demo doesn't have")
    } catch let error as BackendError {
      #expect(error.codeString == "HANDLE_NOT_FOUND")
    } catch {
      Issue.record("\(error)")
    }
    #expect(session.model.did == World.me.did)
  }

  @Test func findsAnAccountWhoseSessionTheServerEnded() async {
    let session = await DemoSessions.make()
    #expect(session.expire("lab"))
    #expect(session.expire("nobody") == false)
    #expect(await session.model.checkAccount(World.lab.did) == .expired)
    #expect(await DemoSessions.eventually { session.model.accounts.first { $0.did == World.lab.did }?.status == .needsSignIn })
    #expect(session.model.did == World.me.did)
  }
}

@MainActor
@Suite struct TheArchiveOnTheDemo {
  /// VirgaArchive's ArchiveModel, the app's first build for Mira, through
  /// the demo session's agent (Virga's server and the fake agent) and its
  /// network (the AppView, the PLC directory, the PDS's repo, Constellation).
  @Test func aFirstBuildForMiraHoldsWhatHerWorldHolds() async throws {
    let session = await DemoSessions.make()
    let world = try #require(session.world.world(World.me.did))
    let archive = ArchiveModel(
      agent: session.model.agent, did: World.me.did, handle: World.me.handle,
      environment: session.archiveEnvironment(files: InMemoryFileStore(), locale: "en-GB"))
    await archive.start()
    #expect(archive.isBuilt == false)
    await archive.runSync()
    #expect(archive.syncError == nil)
    #expect(archive.isBuilt)
    let data = archive.data
    #expect(data.posts.count == world.posts.count)
    #expect(data.followers.count == world.followers.count)
    #expect(data.following.count == world.follows.count)
    // Every notification but the follows, which the follower sweep counts.
    let engagements = try JSONValue(encoding: world.notifications).arrayValue ?? []
    let kept = engagements.compactMap { Analytics.inboundFromNotification($0, timeZone: .gmt) }
    #expect(kept.count == world.notifications.filter { $0.reason != "follow" }.count)
    #expect(data.inbound.count == kept.count)
    #expect(data.outbound.count == world.likes.count + world.reposts.count)
    let directBlocks = data.blocks.filter { $0.source != "list" }
    #expect(directBlocks.count == world.blockers.count)
    #expect(data.meta.lists?.lists?.count == world.lists.count)
    #expect(session.transport.refused.isEmpty)
  }
}
