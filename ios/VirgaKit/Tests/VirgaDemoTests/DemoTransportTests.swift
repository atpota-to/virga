// DemoTransport (harness/fakeNetwork.js installFakeNetwork's fetch) and
// DemoHarness (createHarness): the latency each request waits, a cancelled
// request, and one agent per account for the life of the harness.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct TheDemosNetwork {
  static let now = DemoNetwork.now

  /// A clock that notes each wait and returns at once.
  static func noting() -> (NetworkClock, Locked<[Double]>) {
    let waits = Locked<[Double]>([])
    return (NetworkClock(now: { now }, sleep: { ms in waits.withLock { $0.append(ms) } }), waits)
  }

  @Test func waitsTheLatencyForEachRequestAndTheAgentsOwnForSignedInCalls() async throws {
    let (clock, waits) = Self.noting()
    let harness = DemoHarness(flags: Harness.readFlags("?latency=60"), now: Self.now, clock: clock)
    let transport = harness.transport()
    _ = try await transport.send(
      HTTPRequest(url: "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=\(World.me.did)"))
    #expect(waits.wrappedValue == [60])
    let token = harness.server.mintToken(World.me.did)
    let session = await BackendClient.checkBackendSession(backendUrl: FakeServer.serverOrigin, token: token, transport: transport)
    #expect(session.ok)
    #expect(waits.wrappedValue == [60, 60])
    // Through the proxy the agent's own latency counts, as the web's pages
    // wait it calling their agents directly: a read once, a write four times.
    let agent = XRPCAgent(
      did: World.me.did, fetchHandler: BackendFetchHandler(backendUrl: FakeServer.serverOrigin, token: token, transport: transport))
    _ = try await agent.query("app.bsky.graph.getFollowers", ["limit": 1])
    #expect(waits.wrappedValue == [60, 60, 60])
    _ = try await agent.procedure(
      "com.atproto.repo.createRecord",
      input: .json([
        "repo": .string(World.me.did), "collection": "app.bsky.feed.post", "rkey": "3n2zlatency22",
        "record": ["$type": "app.bsky.feed.post", "text": "Slow", "createdAt": .string(World.iso(Self.now))],
      ]))
    #expect(waits.wrappedValue == [60, 60, 60, 240])
  }

  @Test func sendsNothingOnceCancelled() async throws {
    let (clock, waits) = Self.noting()
    let transport = DemoHarness(flags: Harness.readFlags(""), now: Self.now, clock: clock).transport()
    let task = Task {
      withUnsafeCurrentTask { $0?.cancel() }
      return try await transport.send(HTTPRequest(url: "https://plc.directory/\(World.me.did)"))
    }
    await #expect(throws: CancellationError.self) { _ = try await task.value }
    #expect(waits.wrappedValue.isEmpty)
  }

  @Test func keepsOneAgentPerAccountAndRefusesAnAccountItDoesntHave() throws {
    let harness = DemoHarness(flags: Harness.readFlags("?accounts=1"), now: Self.now, clock: .instant(now: Self.now))
    #expect(try harness.agentFor(World.me.did) === harness.agentFor(World.me.did))
    #expect(throws: DemoWorldError.noAccount(World.lab.did)) { _ = try harness.agentFor(World.lab.did) }
    #expect(harness.worlds.map(\.me.did) == [World.me.did])
    #expect(harness.grantOf(World.me.did) == Harness.defaultScope)
    #expect(try harness.regrant(World.me.did, defense: .scan) == Harness.withDefense(Harness.defaultScope, .scan))
  }

  @Test func readsTheGrantAtEachCallAsASignInThatTurnsDefenseOnChangesIt() async throws {
    let harness = DemoHarness(flags: Harness.readFlags(""), now: Self.now, clock: .instant(now: Self.now))
    let agent = try harness.agentFor(World.me.did)
    do {
      _ = try await agent.handle("app.bsky.actor.getProfiles", ["actors": [.string(World.lab.did)]])
      Issue.record("getProfiles answered without Defense's permission")
    } catch let error as HarnessRepo.XrpcError {
      #expect(error.error == "ScopeMissingError")
    }
    try harness.regrant(World.me.did, defense: .scan)
    let res = try await agent.handle("app.bsky.actor.getProfiles", ["actors": [.string(World.lab.did)]])
    #expect(res.data["profiles"]?.arrayValue?.count == 1)
  }

  @Test func endsAndRefusesSessionsByTheStartOfAHandle() async {
    let harness = DemoHarness(flags: Harness.readFlags(""), now: Self.now, clock: .instant(now: Self.now))
    let transport = harness.transport(latency: 0)
    let mira = harness.server.mintToken(World.me.did)
    let lab = harness.server.mintToken(World.lab.did)
    #expect(harness.refuse("mira"))
    let refused = await BackendClient.fetchBackendSession(backendUrl: FakeServer.serverOrigin, token: mira, transport: transport)
    #expect(refused.data?["oauthSessionMissing"] == true)
    #expect(harness.expire("lab"))
    let ended = await BackendClient.checkBackendSession(backendUrl: FakeServer.serverOrigin, token: lab, transport: transport)
    #expect(ended.status == 401)
    #expect(harness.expire("zed") == false)
    #expect(harness.refuse("zed") == false)
  }
}
