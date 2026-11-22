// Parity for src/posting/lib/publishRecord.js (fixture publish.publishRecord):
// the transient and retriable checks over the web's error objects, the gate
// writes, and every idempotent write's exchanges with the PDS replayed from
// MockTransport, its timeouts on a scripted clock.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct PublishRecordParity {
  static let f = "publish.publishRecord"

  @Test func isTransientNetworkError() throws {
    for c in try cases(Self.f, "isTransientNetworkError") {
      check(outcome { .bool(try PublishRecord.isTransientNetworkError(c.input["err"])) }, c)
    }
  }

  @Test func isRetriablePublishError() throws {
    for c in try cases(Self.f, "isRetriablePublishError") {
      check(outcome { .bool(try PublishRecord.isRetriablePublishError(c.input["err"])) }, c)
    }
  }

  @Test func needsGateRecords() throws {
    for c in try cases(Self.f, "needsThreadgateRecord") {
      check(.bool(PublishRecord.needsThreadgateRecord(c.input["rules"])), c)
    }
    for c in try cases(Self.f, "needsPostgateRecord") {
      check(.bool(PublishRecord.needsPostgateRecord(c.input["rules"])), c)
    }
  }

  @Test func buildGateWrites() throws {
    for c in try cases(Self.f, "buildGateWrites") {
      let writes = PublishRecord.buildGateWrites(
        did: c.string("did") ?? "", rkey: c.string("rkey") ?? "",
        threadgateRules: c.input["threadgateRules"]?.arrayValue, postgateRules: c.input["postgateRules"]?.arrayValue,
        createdAt: c.input["createdAt"], now: PublishFixture.now)
      check(.array(writes.map(\.json)), c)
    }
  }

  @Test func createRecordIdempotent() async throws {
    let record: JSONValue = ["$type": "app.bsky.feed.post", "text": "hi", "createdAt": "2026-07-24T00:00:00.000Z"]
    for c in try cases(Self.f, "createRecordIdempotent") {
      let transport = CountingTransport(replayTransport(c.output))
      let timers = ScriptedTimers(c.output["fired"], transport: transport)
      let tids = FixedTIDs()
      let opts = c.input["opts"] ?? [:]
      let rkey: String? = c.input["mint"] == .bool(true) ? nil : "3m5abcdefgh22"
      let result = await publishOutcome {
        try await PublishRecord.createRecordIdempotent(
          PublishFixture.agent(transport), repo: PublishFixture.me, collection: "app.bsky.feed.post", record: record,
          rkey: rkey, timeoutMs: opts["timeoutMs"]?.doubleValue ?? PublishRecord.defaultTimeoutMs,
          attempts: opts["attempts"]?.intValue ?? PublishRecord.defaultAttempts, clock: timers.clock, mintTid: tids.mint)
      }
      checkReplay(c, sent: transport.requests, result: result, waits: timers.waits)
    }
  }

  @Test func publishWithIdempotentRetry() async throws {
    let record: JSONValue = ["$type": "app.bsky.feed.post", "text": "hi", "createdAt": "2026-07-24T00:00:00.000Z"]
    for c in try cases(Self.f, "publishWithIdempotentRetry") {
      let transport = CountingTransport(replayTransport(c.output))
      let timers = ScriptedTimers(c.output["fired"], transport: transport)
      let agent = PublishFixture.agent(transport)
      let result = await publishOutcome {
        try await PublishRecord.publishWithIdempotentRetry(
          agent, repo: PublishFixture.me, collection: "app.bsky.feed.post", rkey: c.string("rkey"),
          clock: timers.clock
        ) { key in
          try await PublishRecord.applyWrites(
            agent, repo: PublishFixture.me, validate: true,
            writes: [ApplyWritesCreate(collection: "app.bsky.feed.post", rkey: key, value: record)])
        }
      }
      checkReplay(c, sent: transport.requests, result: result, waits: timers.waits)
    }
  }

  @Test func createPostWithGates() async throws {
    let base: JSONValue = ["$type": "app.bsky.feed.post", "text": "hi", "createdAt": "2026-07-24T00:00:00.000Z"]
    for c in try cases(Self.f, "createPostWithGates") {
      let transport = CountingTransport(replayTransport(c.output))
      let timers = ScriptedTimers(c.output["fired"], transport: transport)
      let tids = FixedTIDs()
      let result = await publishOutcome {
        try await PublishRecord.createPostWithGates(
          PublishFixture.agent(transport), repo: PublishFixture.me,
          collection: c.string("collection") ?? "app.bsky.feed.post", record: c.input["record"] ?? base,
          threadgateRules: c.input["threadgateRules"]?.arrayValue, postgateRules: c.input["postgateRules"]?.arrayValue,
          rkey: c.input["mint"] == .bool(true) ? nil : "3m5abcdefgh22", clock: timers.clock, mintTid: tids.mint)
      }
      checkReplay(c, sent: transport.requests, result: result, waits: timers.waits)
    }
  }
}

@Suite struct PublishRecordBehaviour {
  /// publishRecord.test.js: a write under a TID it minted.
  @Test func writesUnderAMintedTid() async throws {
    let transport = MockTransport()
    transport.on(.any) { request in
      let body = (try? JSONValue.parse(request.body ?? Data())) ?? .null
      #expect(TID.isTid(body["rkey"]?.stringValue))
      return .json(["success": true, "data": ["uri": "at://x", "cid": "c"]])
    }
    let data = try await PublishRecord.createRecordIdempotent(
      PublishFixture.agent(transport), repo: "did:plc:me", collection: "app.bsky.feed.post", record: [:],
      clock: .instant(now: PublishFixture.now))
    #expect(data["uri"] == "at://x")
    #expect(transport.requests.count == 1)
  }

  /// A write that loses its race against the clock isn't called off: it
  /// still reaches the PDS after the time is up, as the web's does.
  @Test func aTimedOutWriteRunsToTheEnd() async throws {
    let gate = AsyncGate()
    let finished = AsyncGate()
    let transport = MockTransport()
    transport.on("POST", .any) { _ in
      await gate.wait()
      finished.open()
      return .json(["success": true, "data": ["uri": "at://late", "cid": "c"]])
    }
    transport.on("GET", .any) { _ in .json(["success": false, "error": "Could not locate record", "code": "RecordNotFound"], status: 400) }
    let timers = ScriptedTimers([[30000, 0]])
    let outcome = await publishOutcome {
      try await PublishRecord.createRecordIdempotent(
        PublishFixture.agent(transport), repo: PublishFixture.me, collection: "app.bsky.feed.post", record: [:],
        rkey: "3kabc", attempts: 1, clock: timers.clock)
    }
    #expect(outcome == ["$throws": "Post creation timed out"])
    gate.open()
    await finished.wait()
  }
}

/// A one-shot gate: `wait()` returns once `open()` has been called.
final class AsyncGate: Sendable {
  private let state = Locked<(open: Bool, waiters: [CheckedContinuation<Void, Never>])>((false, []))

  func open() {
    let waiters = state.withLock { state -> [CheckedContinuation<Void, Never>] in
      state.open = true
      defer { state.waiters = [] }
      return state.waiters
    }
    for waiter in waiters { waiter.resume() }
  }

  func wait() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let ready = state.withLock { state -> Bool in
        if state.open { return true }
        state.waiters.append(continuation)
        return false
      }
      if ready { continuation.resume() }
    }
  }
}
