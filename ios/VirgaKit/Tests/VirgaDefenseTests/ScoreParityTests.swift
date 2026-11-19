// src/defense/score.js against the web code (ios/parity/cases/
// defense-early.score.js): the bands, the trust key, the count, the canary,
// the scorer over a scripted AppView, and the summary.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense-early.score"

/// What a ScoreError is recorded as.
func recorded(_ error: any Error) -> JSONValue {
  guard let e = error as? ScoreError else { return ["$error": ["message": .string("\(error)")]] }
  return ["$error": ["name": "ScoreError", "code": .string(e.code.rawValue), "message": .string(e.message)]]
}

@Suite struct ScoreParity {
  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let actual: JSONValue = [
      "BANDS": .array(Score.bands.map { .string($0.rawValue) }),
      "DEFAULT_THRESHOLDS": try JSONValue(encoding: Score.defaultThresholds),
      "PROFILE_BATCH": .number(Double(Score.profileBatch)),
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  @Test func trustScore() throws {
    for c in try Parity.cases(fixture, fn: "trustScore") {
      let f = c["f"]
      // Destructuring defaults apply to an absent value only; Math reads
      // null as 0, and `Number(ageDays) || 0` reads anything.
      func number(_ key: String) -> Double { f[key].map(\.jsNumber) ?? 0 }
      let trust = Score.trustScore(
        vouches: number("vouches"),
        followers: number("followers"),
        ageDays: f["ageDays"].map(\.jsNumber) ?? 0,
        mutual: f["mutual"]?.isTruthy ?? false,
        followsYou: f["followsYou"]?.isTruthy ?? false)
      let actual: JSONValue = trust.isNaN ? .null : .number(trust)
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func assignBand() throws {
    for c in try Parity.cases(fixture, fn: "assignBand") {
      let features = try c["f"].decode(Features.self)
      let band =
        try c.input["thresholds"].map { Score.assignBand(features, try $0.decode(Thresholds.self)) }
        ?? Score.assignBand(features)
      let d = Parity.diff(.string(band.rawValue), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func knownFollowersOf() throws {
    for c in try Parity.cases(fixture, fn: "knownFollowersOf") {
      let actual: JSONValue = Score.knownFollowersOf(c.input["profile"]).map(JSONValue.number) ?? .null
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func findCanary() async throws {
    for c in try Parity.cases(fixture, fn: "findCanary") {
      let fake = ScriptedAppView(c.input)
      var actual: JSONValue
      do {
        let did = try await Score.findCanary(
          ownerDid: c["ownerDid"].stringValue ?? "",
          candidates: c["candidates"].isNull ? nil : c["candidates"].strings,
          getProfiles: fake.getProfiles,
          maxBatches: c["maxBatches"].intValue ?? Score.canaryBatches,
          retryDelaysMs: [0, 0])
        actual = ["did": did.map(JSONValue.string) ?? .null]
      } catch {
        actual = recorded(error)
      }
      actual["asked"] = .array(fake.asked.map { .array($0.map(JSONValue.string)) })
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func score() async throws {
    for c in try Parity.cases(fixture, fn: "score") {
      let fake = ScriptedAppView(c.input)
      let refind: (@Sendable () async throws -> String?)? =
        c.input["refind"].map { value in
          { @Sendable in
            if value.stringValue == "$throws" { throw ScriptedError(httpStatus: 410) }
            return value.stringValue
          }
        }
      let nowMs = c["now"].doubleValue ?? 0
      let scorer = try Score.createScorer(
        ownerDid: c["ownerDid"].stringValue ?? "",
        getProfiles: fake.getProfiles,
        getRelationships: fake.getRelationships,
        canary: c["canary"].stringValue,
        refindCanary: refind,
        protectedSet: Dictionary(
          (c["protectedSet"].arrayValue ?? []).compactMap { pair -> (String, String)? in
            guard let did = pair[0]?.stringValue, let reason = pair[1]?.stringValue else { return nil }
            return (did, reason)
          }, uniquingKeysWith: { _, last in last }),
        selves: c["selves"].strings,
        alreadyListed: Set(c["alreadyListed"].strings),
        blockers: Set(c["blockers"].strings),
        thresholds: try c.input["thresholds"].map { try $0.decode(Thresholds.self) } ?? Score.defaultThresholds,
        retryDelaysMs: c.input["retryDelaysMs"]?.arrayValue?.compactMap(\.doubleValue) ?? [0, 0],
        concurrency: c["concurrency"].intValue ?? Limit.appviewConcurrency,
        now: { Date(ms: nowMs) },
        // The zone the case ran in (the generator's runner is UTC).
        timeZone: c["zone"].stringValue.flatMap(TimeZone.init(identifier:)) ?? utc)
      var actual: JSONValue
      do {
        actual = try JSONValue(encoding: try await scorer.score(c["dids"].strings))
        if c["recordAsks"] != false {
          actual["asked"] = .array(fake.sortedAsked.map { .array($0.map(JSONValue.string)) })
        }
        actual["relationshipCalls"] = .number(Double(fake.relationshipCalls))
      } catch {
        actual = recorded(error)
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func withoutSelves() throws {
    for c in try Parity.cases(fixture, fn: "withoutSelves") {
      let harvest = try c["harvest"].decode(Harvest.self)
      let d = Parity.diff(encoding: Score.withoutSelves(harvest, c["dids"].optionalStrings), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func summarise() throws {
    for c in try Parity.cases(fixture, fn: "summarise") {
      let harvest = try c["harvest"].decode(Harvest.self)
      let scores = try c["scores"].decode([String: AccountScore].self)
      let summary =
        try c.input["vouchCheck"].map { Score.summarise(harvest, scores, vouchCheck: try $0.decode(VouchCheck.self)) }
        ?? Score.summarise(harvest, scores)
      let d = Parity.diff(encoding: summary, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func rowsRoundTrip() throws {
    // A summary decodes and encodes to the JSON it came from, scored rows
    // and unscored alike.
    for c in try Parity.cases(fixture, fn: "summarise") {
      let summary = try c.output.decode(ScanSummary.self)
      let d = Parity.diff(encoding: summary, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
