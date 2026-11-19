// Behaviour the fixtures can't hold: timing (the resolver's timeout, a
// debounce, the default-gates timeout), requests shared between concurrent
// asks, the shared resolver's injected fetch, and the event bus across
// threads.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct MentionResolverBehaviour {
  static func ok(_ did: String) -> MentionFetchResponse {
    MentionFetchResponse(status: 200, body: Data(#"{"did":"\#(did)"}"#.utf8))
  }

  @Test func concurrentAsksShareOneRequest() async {
    let count = Locked(0)
    let resolve = Mentions.createMentionResolver(fetch: { _ in
      count.withLock { $0 += 1 }
      try await Task.sleep(for: .milliseconds(50))
      return Self.ok("did:plc:shared")
    })
    async let a = resolve("shared.test")
    async let b = resolve("@SHARED.test")
    async let c = resolve("shared.test")
    let answers = try? await [a, b, c]
    #expect(answers == ["did:plc:shared", "did:plc:shared", "did:plc:shared"])
    #expect(count.wrappedValue == 1)
  }

  @Test func aSlowLookupTimesOutToNothingAndIsAskedAgain() async throws {
    let count = Locked(0)
    let resolve = Mentions.createMentionResolver(
      fetch: { _ in
        let n = count.withLock { $0 += 1; return $0 }
        if n == 1 { try await Task.sleep(for: .seconds(3600)) }
        return Self.ok("did:plc:second")
      },
      timeoutMs: 30)
    let started = Date()
    #expect(try await resolve("slow.test") == nil)
    // The lookup would take an hour; the 30 ms timeout ending it is what's
    // checked. The bound is generous because the other suites run at the
    // same time and can hold every thread for a while (CI's simulator took
    // 21 seconds to get to the timer).
    #expect(Date().timeIntervalSince(started) < 120, "the timeout ended the wait")
    #expect(try await resolve("slow.test") == "did:plc:second", "a timeout isn't remembered")
    #expect(count.wrappedValue == 2)
  }

  @Test func theSharedResolverUsesTheInjectedFetch() async throws {
    let handle = "injected\(UInt32.random(in: 0...UInt32.max)).test"
    let previous = Mentions.defaultFetch.wrappedValue
    defer { Mentions.defaultFetch.set(previous) }
    let seen = Locked<[String]>([])
    Mentions.defaultFetch.set({ url in
      seen.withLock { $0.append(url) }
      return Self.ok("did:plc:injected")
    })
    #expect(try await Mentions.resolveMention(handle) == "did:plc:injected")
    #expect(seen.wrappedValue == ["https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=\(handle)"])
  }

  @Test func withoutAFetchEveryLookupIsAFailureNotAnAnswer() async throws {
    let resolve = Mentions.createMentionResolver(fetch: nil)
    let previous = Mentions.defaultFetch.wrappedValue
    defer { Mentions.defaultFetch.set(previous) }
    Mentions.defaultFetch.set(nil)
    #expect(try await resolve("nobody.test") == nil)
  }
}

@Suite struct DebounceBehaviour {
  /// Waits (up to a generous deadline, the suite runs in parallel) until
  /// `calls` holds `count` entries, then a little longer for any stragglers.
  static func settle(_ calls: Locked<[Int]>, count: Int) async throws {
    let deadline = Date().addingTimeInterval(10)
    while calls.wrappedValue.count < count, Date() < deadline {
      try await Task.sleep(for: .milliseconds(20))
    }
    try await Task.sleep(for: .milliseconds(300))
  }

  @Test func onlyTheLastCallInAWindowRuns() async throws {
    let calls = Locked<[Int]>([])
    let debounced = Mentions.debounce({ (n: Int) in calls.withLock { $0.append(n) } }, .milliseconds(80))
    debounced(1)
    debounced(2)
    debounced(3)
    try await Self.settle(calls, count: 1)
    #expect(calls.wrappedValue == [3], "\(calls.wrappedValue)")
    debounced(4)
    try await Self.settle(calls, count: 2)
    #expect(calls.wrappedValue == [3, 4], "\(calls.wrappedValue)")
  }
}

@Suite struct GatesBehaviour {
  @Test func aSlowPreferencesReadIsNilInTime() async {
    let agent = FakeGatesAgent(preferences: {
      try await Task.sleep(for: .seconds(3600))
      return ["preferences": []]
    })
    let started = Date()
    let gates = await Gates.readDefaultGates(agent, timeoutMs: 30)
    #expect(gates == nil)
    // An hour's read, ended by the 30 ms timeout; generous for a busy
    // thread pool (CI's simulator took 11 seconds to get to the timer).
    #expect(Date().timeIntervalSince(started) < 120)
  }

  @Test func readsTheAccountsDefaults() async {
    let agent = FakeGatesAgent(preferences: {
      [
        "preferences": [
          [
            "$type": "app.bsky.actor.defs#postInteractionSettingsPref",
            "threadgateAllowRules": [["$type": "app.bsky.feed.threadgate#followingRule"]],
          ]
        ]
      ]
    })
    #expect(await Gates.readDefaultGates(agent) == PostGates(reply: [.following], quotes: true))
  }

  @Test func typedUpdateWritesTheRules() async throws {
    let agent = FakeGatesAgent()
    let result = try await Gates.updatePostGates(
      agent, uri: "at://did:plc:me/app.bsky.feed.post/3p", reply: [.mention, .list("at://did:plc:me/app.bsky.graph.list/3l")],
      quotes: false, now: Date(timeIntervalSince1970: 0))
    #expect(result == PostGates(reply: [.mention, .list("at://did:plc:me/app.bsky.graph.list/3l")], quotes: false))
    let store = await agent.store
    #expect(store["app.bsky.feed.threadgate"]?["createdAt"] == "1970-01-01T00:00:00.000Z")
    #expect(store["app.bsky.feed.postgate"]?["embeddingRules"]?[0]?["$type"] == "app.bsky.feed.postgate#disableRule")
  }
}

@Suite struct EventBusBehaviour {
  @Test func listenersAreSafeAcrossThreads() async throws {
    let bus = PostingEventBus()
    let heard = Locked(0)
    let off = try PostingEvents.onPostingEvent(PostingEvents.posts, did: "did:plc:a", target: bus) { _ in
      heard.withLock { $0 += 1 }
    }
    await withTaskGroup(of: Void.self) { group in
      for i in 0..<200 {
        group.addTask {
          _ = try? PostingEvents.emitPostsChanged(i.isMultiple(of: 2) ? "did:plc:a" : "did:plc:b", target: bus)
        }
      }
    }
    #expect(heard.wrappedValue == 100)
    off()
    _ = try PostingEvents.emitPostsChanged("did:plc:a", target: bus)
    #expect(heard.wrappedValue == 100)
    #expect(bus.listenerCount(PostingEvents.posts) == 0)
  }

  @Test func errorsCarryTheWebsMessages() {
    #expect(throws: PostingEventError(message: "Not a posting event: virga:nope")) {
      try PostingEvents.emitPostingEvent("virga:nope", ["did": "did:plc:a"])
    }
    #expect(throws: PostingEventError(message: "virga:drafts-changed needs detail.did")) {
      try PostingEvents.emitPostingEvent(PostingEvents.drafts, [:])
    }
  }
}

@Suite struct FacetDetectionBehaviour {
  @Test func distinctHandlesResolveInParallel() async {
    let inFlight = Locked(0)
    let peak = Locked(0)
    let result = await Facets.detectFacets(
      "@one.test @two.test @three.test @one.test",
      DetectFacetsOptions(
        resolveMention: { handle in
          let now = inFlight.withLock { $0 += 1; return $0 }
          peak.withLock { $0 = max($0, now) }
          try await Task.sleep(for: .milliseconds(40))
          inFlight.withLock { $0 -= 1 }
          return "did:plc:\(handle.split(separator: ".")[0])"
        },
        validationCache: MentionValidationCache()))
    #expect(peak.wrappedValue == 3)
    #expect(result.facets.map(\.features) == [
      [.mention(did: "did:plc:one")], [.mention(did: "did:plc:two")], [.mention(did: "did:plc:three")],
      [.mention(did: "did:plc:one")],
    ])
  }
}
