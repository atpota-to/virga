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
