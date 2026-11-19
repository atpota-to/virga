// score.js's scorer, for what a fixture can't hold: how many calls it makes
// as batches run side by side, that one re-pick of the canary is shared,
// that a failure or a cancellation stops the other reads, and the progress
// it reports. Ported from score.test.js.

import Foundation
import Testing
import VirgaCore
@testable import VirgaDefense

private let owner = "did:plc:owner"
private let canary = "did:plc:canary"
private let noWait: [Double] = [0, 0]

private func dids(_ n: Int, _ prefix: String = "p") -> [String] {
  (0..<n).map { "did:plc:\(prefix)\($0)" }
}

/// score.test.js's profile.
private func prof(_ did: String, known: Int = 0) -> JSONValue {
  var viewer: [String: JSONValue] = [:]
  if known > 0 { viewer["knownFollowers"] = ["count": .number(Double(known)), "followers": [["did": "did:plc:someone"]]] }
  return [
    "did": .string(did), "handle": .string("\(did.dropFirst(8)).test"), "followersCount": 10, "followsCount": 5,
    "postsCount": 10, "createdAt": "2024-01-01T00:00:00.000Z", "viewer": .object(viewer),
  ]
}

private let noRelationships: GetRelationships = { _, dids in dids.map { ["did": .string($0)] } }

private struct Refused: HTTPStatusError {
  var httpStatus: Int?
}

/// Counts calls and records each batch.
private final class Calls: Sendable {
  let batches = Locked([[String]]())
  var count: Int { batches.wrappedValue.count }
  func record(_ batch: [String]) { batches.withLock { $0.append(batch) } }
}

@Suite struct ScorerBehaviour {
  @Test func carriesTheCanaryInEveryBatchAsAPassenger() async throws {
    let calls = Calls()
    let scorer = try Score.createScorer(
      ownerDid: owner,
      getProfiles: { batch in
        calls.record(batch)
        return batch.map { prof($0, known: $0 == canary ? 4 : $0 == "did:plc:p0" ? 5 : 0) }
      },
      getRelationships: noRelationships, canary: canary, retryDelaysMs: noWait)
    let result = try await scorer.score(dids(60))
    #expect(result.vouchCheck == .canary)
    #expect(calls.count == 3)
    for batch in calls.batches.wrappedValue {
      #expect(batch.count <= Score.profileBatch)
      #expect(batch.contains(canary))
    }
    #expect(result.scores[canary] == nil)
    #expect(result.scores["did:plc:p0"]?.band == .connected)
  }

  @Test func picksTheCanaryAgainOnceForEveryBatch() async throws {
    let refinds = Locked(0)
    let newCanary = "did:plc:newcanary"
    let scorer = try Score.createScorer(
      ownerDid: owner,
      getProfiles: { batch in batch.map { prof($0, known: $0 == newCanary ? 2 : 0) } },
      getRelationships: noRelationships,
      canary: canary,
      refindCanary: {
        refinds.withLock { $0 += 1 }
        try await Task.sleep(nanoseconds: 2_000_000)
        return newCanary
      },
      retryDelaysMs: noWait)
    let result = try await scorer.score(dids(100))
    #expect(refinds.wrappedValue == 1)
    #expect(result.vouchCheck == .canary)
    #expect(await scorer.activeCanary == newCanary)
    #expect(result.scores.count == 100)
  }

  @Test func stopsReadingProfilesOnceWhoYouFollowHasFailed() async throws {
    let calls = Calls()
    let scorer = try Score.createScorer(
      ownerDid: owner,
      getProfiles: { batch in
        try await Task.sleep(nanoseconds: 5_000_000)
        calls.record(batch)
        return batch.map { prof($0, known: $0 == canary ? 3 : 0) }
      },
      getRelationships: { _, _ in throw Refused(httpStatus: 400) },
      canary: canary, retryDelaysMs: noWait, concurrency: 1)
    await #expect(throws: ScoreError.self) { _ = try await scorer.score(dids(240)) }
    try await Task.sleep(nanoseconds: 30_000_000)
    #expect(calls.count <= 1)
  }

  @Test func stopsAskingAnUncountedBatchOnceTheScoreIsAbandoned() async throws {
    let calls = Calls()
    let scorer = try Score.createScorer(
      ownerDid: owner,
      getProfiles: { batch in
        calls.record(batch)
        // The reader leaves the page while the batch is out.
        withUnsafeCurrentTask { $0?.cancel() }
        return batch.map { prof($0) }
      },
      getRelationships: noRelationships, canary: canary, retryDelaysMs: noWait)
    await #expect(throws: CancellationError.self) { _ = try await scorer.score(dids(3)) }
    #expect(calls.count == 1)
  }

  @Test func doesNotRetryARefusal() async throws {
    let calls = Calls()
    let scorer = try Score.createScorer(
      ownerDid: owner,
      getProfiles: { batch in
        calls.record(batch)
        throw Refused(httpStatus: 403)
      },
      getRelationships: noRelationships, canary: canary, retryDelaysMs: noWait)
    do {
      _ = try await scorer.score(dids(2))
      Issue.record("expected a ScoreError")
    } catch let error as ScoreError {
      #expect(error.code == .read)
      #expect((error.cause as? Refused)?.httpStatus == 403)
      #expect(error.localizedDescription.hasPrefix("Couldn't read profiles"))
    }
    #expect(calls.count == 1)
  }

  @Test func reportsProgressByBatch() async throws {
    let reports = Locked([Scorer.Progress]())
    let scorer = try Score.createScorer(
      ownerDid: owner,
      getProfiles: { batch in batch.map { prof($0, known: $0 == canary ? 1 : 0) } },
      getRelationships: noRelationships, canary: canary, retryDelaysMs: noWait)
    _ = try await scorer.score(dids(70)) { progress in reports.withLock { $0.append(progress) } }
    let seen = reports.wrappedValue
    #expect(seen.count == 3)
    #expect(seen.map(\.total) == [70, 70, 70])
    #expect(seen.map(\.done).sorted() == [24, 48, 70])
  }

  @Test func needsAnOwner() {
    #expect(throws: CreateScorerError.self) {
      _ = try Score.createScorer(ownerDid: "", getProfiles: { _ in [] }, getRelationships: noRelationships)
    }
  }

  @Test func saysWhetherVouchesAreChecked() async throws {
    let with = try Score.createScorer(
      ownerDid: owner, getProfiles: { _ in [] }, getRelationships: noRelationships, canary: canary)
    let without = try Score.createScorer(
      ownerDid: owner, getProfiles: { _ in [] }, getRelationships: noRelationships, canary: "")
    #expect(await with.vouchCheck == .canary)
    #expect(await without.vouchCheck == .unavailable)
  }

  @Test func retriesWhatIsWorthRetrying() {
    struct Plain: Error {}
    #expect(Score.retryable(Plain()))
    #expect(Score.retryable(Refused(httpStatus: nil)))
    #expect(Score.retryable(Refused(httpStatus: 0)))
    for status in [408, 429, 500, 502, 503] { #expect(Score.retryable(Refused(httpStatus: status))) }
    for status in [400, 401, 403, 404, 410] { #expect(!Score.retryable(Refused(httpStatus: status))) }
    #expect(!Score.retryable(CancellationError()))
  }

  @Test func countsAgeFromTheClockItIsGiven() async throws {
    // 2024-01-01 to 2026-03-15 at noon is 804.5 days, which rounds up.
    let scorer = try Score.createScorer(
      ownerDid: owner, getProfiles: { batch in batch.map { prof($0) } }, getRelationships: noRelationships,
      now: { Date(ms: 1_773_576_000_000) }, timeZone: utc)
    let result = try await scorer.score(["did:plc:x"])
    #expect(result.scores["did:plc:x"]?.ageDays == 805)
    #expect(result.vouchCheck == .unavailable)
  }
}
