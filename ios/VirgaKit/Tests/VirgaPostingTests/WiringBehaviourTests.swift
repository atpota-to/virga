// The seams wired in Wiring.swift: VirgaBackend as timers' requester, the
// mention resolver over the transport, and the archive's posts-changed
// listener on the posting events bus.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaNetwork
@testable import VirgaPosting

@Suite struct TimerRequesterWiring {
  static func backend(_ mock: MockTransport) -> VirgaBackend {
    VirgaBackend(backendUrl: "https://virga.example", token: { "vg_token" }, did: "did:plc:mira", transport: mock)
  }

  @Test func listsTimersThroughVirgasServer() async throws {
    let mock = MockTransport()
    mock.on("GET", .urlPrefix("https://virga.example/api/self-destruct/list"), respond: .json([
      "data": [["id": "t1", "uri": "at://did:plc:mira/app.bsky.feed.post/1"]], "unavailable": false,
    ]))
    let list = try await TimerService.listTimers(Self.backend(mock), history: true, context: TimerServiceContext())
    #expect(list.rows.count == 1)
    #expect(!list.unavailable)
    let sent = try #require(mock.requests.first)
    #expect(sent.url == "https://virga.example/api/self-destruct/list?history=1")
    #expect(sent.headers.get("authorization") == "Bearer vg_token")
    #expect(sent.body == nil)
  }

  @Test func sendsABodyAndReadsARefusal() async throws {
    let mock = MockTransport()
    mock.on("POST", .urlPrefix("https://virga.example/api/self-destruct/create"), respond: .json(
      ["success": false, "code": "UNAVAILABLE", "error": "Timers are off on this server."], status: 503))
    let req: any TimerRequester = Self.backend(mock)
    #expect(req.did == "did:plc:mira")
    do {
      _ = try await req.request(TimerRequest(path: "/api/self-destruct/create", method: "POST", body: ["uri": "x"]))
      Issue.record("expected a refusal")
    } catch {
      let read = TimerServiceError(error)
      #expect(read.code == "UNAVAILABLE")
      #expect(read.status == 503)
      #expect(TimerService.isTimersUnavailableError(error))
    }
    let sent = try #require(mock.requests.first)
    #expect(sent.method == "POST")
    #expect(sent.headers.get("content-type") == "application/json")
    #expect(String(decoding: sent.body ?? Data(), as: UTF8.self) == #"{"uri":"x"}"#)
  }

  @Test func noAnswerIsANetworkError() async throws {
    let mock = MockTransport()
    mock.on(.any, respond: .networkError("fetch failed"))
    do {
      _ = try await Self.backend(mock).request(TimerRequest(path: "/api/self-destruct/list"))
      Issue.record("expected a failure")
    } catch {
      let read = TimerServiceError(error)
      #expect(read.code == "NETWORK_ERROR")
      #expect(read.status == 0)
    }
  }
}

extension MentionResolverBehaviour {
  @Test func theSharedResolverUsesTheTransport() async throws {
    let mock = MockTransport()
    mock.on(
      .url("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=wired.test"),
      respond: .json(["did": "did:plc:wired"]))
    defer { Mentions.defaultFetch.withLock { $0 = nil } }
    Mentions.useNetwork(transport: mock)
    let resolve = Mentions.createMentionResolver(appview: "https://public.api.bsky.app")
    #expect(try await resolve("wired.test") == "did:plc:wired")
    #expect(mock.requests.count == 1)
  }
}

@Suite struct PostsChangedWiring {
  @Test func theArchiveHearsItsAccountsPosts() throws {
    let bus = PostingEventBus()
    let heard = Locked<[JSONValue]>([])
    let listen = PostingEvents.postsChangedListener(target: bus)
    let stop = listen("did:plc:mira") { detail in heard.withLock { $0.append(detail) } }
    _ = try PostingEvents.emitPostsChanged("did:plc:mira", added: [["uri": "at://did:plc:mira/app.bsky.feed.post/1"]], removed: nil, target: bus)
    _ = try PostingEvents.emitPostsChanged("did:plc:other", added: [["uri": "at://did:plc:other/app.bsky.feed.post/2"]], removed: nil, target: bus)
    #expect(heard.withLock { $0.count } == 1)
    #expect(heard.withLock { $0.first?["did"] } == "did:plc:mira")
    stop()
    _ = try PostingEvents.emitPostsChanged("did:plc:mira", added: nil, removed: ["at://x"], target: bus)
    #expect(heard.withLock { $0.count } == 1)
    // It is what ArchiveEnvironment takes.
    let env = ArchiveEnvironment(files: nil, postsChanged: listen)
    #expect(env.postsChanged != nil)
  }
}

@Suite struct GatesAgentWiring {
  static let post = "at://did:plc:mira/app.bsky.feed.post/3kpost"

  @Test func readsTheAccountsBlueskyDefault() async throws {
    let mock = MockTransport()
    mock.on(
      .path("/xrpc/app.bsky.actor.getPreferences"),
      respond: .json([
        "preferences": [
          [
            "$type": "app.bsky.actor.defs#postInteractionSettingsPref",
            "threadgateAllowRules": [["$type": "app.bsky.feed.threadgate#mentionRule"]],
            "postgateEmbeddingRules": [["$type": "app.bsky.feed.postgate#disableRule"]],
          ]
        ]
      ]))
    let agent = XRPCAgent(service: "https://pds.example", transport: mock)
    let gates = await Gates.readDefaultGates(agent.gatesAgent)
    #expect(gates == PostGates(reply: [.mention], quotes: false))
    #expect(mock.requests.first?.url == "https://pds.example/xrpc/app.bsky.actor.getPreferences")
    // As posting settings resolve a fresh post's defaults.
    let settings = PostingSettingsStore.defaultPostingSettings(language: "en")
    let resolved = await PostingSettingsStore.resolveDefaultGates(settings, agent: agent.gatesAgent)
    #expect(resolved.source == "bluesky")
    #expect(resolved.gates["quotes"] == false)
  }

  @Test func writesAndClearsAPostsGates() async throws {
    let mock = MockTransport()
    // Neither gate exists yet: the lexicon's RecordNotFound reads as none.
    mock.on(
      .path("/xrpc/com.atproto.repo.getRecord"),
      respond: .json(["error": "RecordNotFound", "message": "Could not locate record"], status: 400))
    mock.on(.path("/xrpc/com.atproto.repo.putRecord"), respond: .json(["uri": "x", "cid": "y"]))
    let agent = XRPCAgent(service: "https://pds.example", transport: mock)
    let out = try await Gates.updatePostGates(
      agent.gatesAgent, uri: Self.post, reply: [ReplyRule.follower], quotes: false, now: Date(timeIntervalSince1970: 1_700_000_000))
    #expect(out == PostGates(reply: [.follower], quotes: false))
    let reads = mock.requests.filter { $0.url.contains("getRecord") }.map(\.url)
    #expect(reads.contains(
      "https://pds.example/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Amira&collection=app.bsky.feed.threadgate&rkey=3kpost"))
    let writes = mock.requests.filter { $0.url.hasSuffix("putRecord") }
    #expect(writes.count == 2)
    let first = try JSONValue.parse(String(decoding: writes[0].body ?? Data(), as: UTF8.self))
    #expect(first["repo"] == "did:plc:mira")
    #expect(first["collection"] == "app.bsky.feed.threadgate")
    #expect(first["rkey"] == "3kpost")
    #expect(first["record"]?["post"] == .string(Self.post))
    #expect(writes[0].method == "POST")
  }

  @Test func aRefusedReadIsNotTakenForNone() async throws {
    let mock = MockTransport()
    mock.on(
      .path("/xrpc/com.atproto.repo.getRecord"),
      respond: .json(["error": "InternalServerError", "message": "boom"], status: 500))
    let agent = XRPCAgent(service: "https://pds.example", transport: mock)
    await #expect(throws: XRPCError.self) {
      _ = try await Gates.updatePostGates(
        agent.gatesAgent, uri: Self.post, reply: [ReplyRule]?.none, quotes: true,
        now: Date(timeIntervalSince1970: 1_700_000_000))
    }
    #expect(!mock.requests.contains { $0.url.hasSuffix("putRecord") || $0.url.hasSuffix("deleteRecord") })
    let notFound = XRPCError(statusCode: 400, error: "RecordNotFound", message: "gone")
    #expect((notFound as XRPCErrorDescribing).xrpcError == "RecordNotFound")
  }
}
