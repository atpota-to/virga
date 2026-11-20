// Behaviour the fixtures can't hold: timing (the resolver's timeout, a
// debounce, the default-gates timeout), requests shared between concurrent
// asks, the shared resolver's injected fetch, and the event bus across
// threads.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

// Serialized: two of these set the shared resolver's fetch, which a test
// running beside them would read.
@Suite(.serialized) struct MentionResolverBehaviour {
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
        if n == 1 { try await Task.sleep(for: .seconds(600)) }
        return Self.ok("did:plc:second")
      },
      timeoutMs: 30)
    let started = Date()
    #expect(try await resolve("slow.test") == nil)
    // Far under the fetch's ten minutes, with room for a loaded machine (the
    // parity suites run alongside and can hold the threads for seconds).
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

/// Sleeps on a dispatch timer, which no task cancellation reaches: a request
/// that doesn't stop when it is cancelled.
func uncancellableSleep(seconds: Double) async {
  await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
    DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { continuation.resume() }
  }
}

@Suite struct GatesBehaviour {
  @Test func aSlowPreferencesReadIsNilInTime() async {
    let agent = FakeGatesAgent(preferences: {
      try await Task.sleep(for: .seconds(600))
      return ["preferences": []]
    })
    let started = Date()
    let gates = await Gates.readDefaultGates(agent, timeoutMs: 30)
    #expect(gates == nil)
    #expect(Date().timeIntervalSince(started) < 120)
  }

  /// The web races the read against a timer (`Promise.race`), so the answer
  /// is null at the deadline even when the read carries on. A task group
  /// would wait for a read that ignores cancellation.
  @Test func aReadThatIgnoresCancellationStillTimesOut() async {
    let agent = FakeGatesAgent(preferences: {
      await uncancellableSleep(seconds: 300)
      return ["preferences": []]
    })
    let started = Date()
    let gates = await Gates.readDefaultGates(agent, timeoutMs: 50)
    #expect(gates == nil)
    // Far under the read's five minutes, with room for a loaded machine.
    #expect(Date().timeIntervalSince(started) < 120, "returned at the deadline, not when the read ended")
  }

  /// A wait setTimeout can't make (infinite, not a number, negative, past
  /// 2^31 - 1 ms) runs at once, as in a browser and in Node, rather than
  /// trapping in Duration.
  @Test func aTimeoutOutsideTheTimersRangeEndsAtOnce() async {
    for timeoutMs in [Double.infinity, -.infinity, .nan, -5, 1e300] {
      let agent = FakeGatesAgent(preferences: {
        try await Task.sleep(for: .seconds(600))
        return ["preferences": []]
      })
      let started = Date()
      #expect(await Gates.readDefaultGates(agent, timeoutMs: timeoutMs) == nil, "\(timeoutMs)")
      #expect(Date().timeIntervalSince(started) < 120, "\(timeoutMs)")
    }
    #expect(PromiseRace.timerDelay(250) == .milliseconds(250))
    #expect(PromiseRace.timerDelay(2_147_483_647) == .milliseconds(2_147_483_647))
    #expect(PromiseRace.timerDelay(2_147_483_648) == .zero)
  }

  @Test func aFastReadWinsTheRace() async {
    let agent = FakeGatesAgent(preferences: { ["preferences": []] })
    #expect(await Gates.readDefaultGates(agent, timeoutMs: 60_000) == Gates.everyoneGates)
  }

  @Test func aCancelledCallerGetsNil() async {
    let agent = FakeGatesAgent(preferences: {
      await uncancellableSleep(seconds: 300)
      return ["preferences": []]
    })
    let task = Task { await Gates.readDefaultGates(agent, timeoutMs: 600_000) }
    try? await Task.sleep(for: .milliseconds(20))
    task.cancel()
    let started = Date()
    #expect(await task.value == nil)
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

@Suite struct URLSearchParamsBehaviour {
  /// The URL Standard's parser, as browsers run it. Node's differs here (it
  /// keeps the low byte of each code unit once one escape is malformed), so
  /// this can't be a fixture: see ios/parity/cases/posting-text.composeIntent.js.
  @Test func aMalformedEscapeLeavesTheRestDecoded() {
    let params = URLSearchParams("?tags=\u{0661}%41%zz\u{0345}&text=a+b%20c")
    #expect(params.get("tags") == "\u{0661}A%zz\u{0345}")
    #expect(params.get("text") == "a b c")
    #expect(
      ComposeIntent.parseComposeIntent("?text=\u{0661}%41%zz").text == "\u{0661}A%zz",
      "the composer is prefilled with what the browser reads")
  }
}

@Suite struct CodeUnitKeys {
  /// The web's Map of what submits learned: a handle written with the
  /// Kelvin sign is another key, not the same one as "K".
  @Test func theValidationCacheKeysByCodeUnit() {
    let cache = MentionValidationCache()
    cache.set("Kate.test", .init(did: "did:plc:k", timestamp: 1))
    #expect(cache.get("Kate.test")?.did == "did:plc:k")
    #expect(cache.get("\u{212A}ate.test") == nil)
    cache.set("\u{212A}ate.test", .init(did: nil, timestamp: 2))
    #expect(cache.get("Kate.test")?.did == "did:plc:k")
  }

  /// URLSearchParams names are compared as JavaScript compares them.
  @Test func searchParamNamesCompareByCodeUnit() {
    var params = URLSearchParams("caf%C3%A9=1&cafe%CC%81=2&%E2%84%AA=3")
    #expect(params.get("caf\u{E9}") == "1")
    #expect(params.get("cafe\u{301}") == "2")
    #expect(params.get("K") == nil)
    #expect(params.getAll("caf\u{E9}") == ["1"])
    #expect(params.has("\u{212A}"))
    params.set("caf\u{E9}", "9")
    params.delete("cafe\u{301}")
    #expect(params.description == "caf%C3%A9=9&%E2%84%AA=3")
  }

  /// `?` is dropped as one code unit, even with a combining mark after it.
  @Test func theLeadingQuestionMarkIsOneCodeUnit() {
    #expect(URLSearchParams("?\u{301}a=1").pairs.map(\.name) == ["\u{301}a"])
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
