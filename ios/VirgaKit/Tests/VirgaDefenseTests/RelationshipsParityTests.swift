// src/defense/score.js publicRelationships against the web code
// (ios/parity/cases/defense.relationships.js), replayed from the exchanges
// the web made with the public AppView, and one score through it.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense.relationships"

@Suite struct RelationshipsParity {
  @Test func publicRelationships() async throws {
    for c in try Parity.cases(fixture, fn: "publicRelationships") {
      await expectReplay(c) { transport, _ in
        let read =
          c.input["appview"]?.stringValue.map { Score.publicRelationships(appview: $0, transport: transport) }
          ?? Score.publicRelationships(transport: transport)
        let dids = c["dids"].arrayValue?.compactMap(\.stringValue) ?? []
        return .array(try await read(c["ownerDid"].stringValue ?? "", dids))
      }
    }
  }

  @Test func aFailedReadSaysItsStatus() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .status(503))
    let read = Score.publicRelationships(transport: transport)
    do {
      _ = try await read("did:plc:owner", ["did:plc:a"])
      Issue.record("a 503 should throw")
    } catch {
      let status = (error as? any HTTPStatusError)?.httpStatus
      #expect(status == 503)
      #expect(Score.retryable(error))
    }
  }

  @Test func scoresThroughThePublicRelationships() async throws {
    for c in try Parity.cases(fixture, fn: "scoreWithPublicRelationships") {
      let dids = c["dids"].arrayValue?.compactMap(\.stringValue) ?? []
      var profiles: [String: JSONValue] = [:]
      for (i, did) in dids.enumerated() {
        profiles[did] = [
          "did": .string(did), "handle": .string("\(did.jsSlice(8)).test"),
          "followersCount": .number(Double(i * 10)), "viewer": [:],
        ]
      }
      let appView = ScriptedAppView(["profiles": .object(profiles)])
      // The batches are read side by side.
      await expectReplay(c, ordered: false) { transport, _ in
        let scorer = try Score.createScorer(
          ownerDid: c["ownerDid"].stringValue ?? "",
          getProfiles: appView.getProfiles,
          getRelationships: Score.publicRelationships(transport: transport),
          retryDelaysMs: [0, 0],
          now: { date(ms: Fixed.now) },
          timeZone: TimeZone(identifier: "UTC"))
        return .of(try await scorer.score(dids))
      }
    }
  }
}
