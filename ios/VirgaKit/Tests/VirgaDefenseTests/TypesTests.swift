// The shapes Defense works in: they read and write the web's JSON, and
// compare text as the web does.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDefense

@Suite struct DefenseTypes {
  @Test func bandsAreNamedByCodeUnit() {
    #expect(Band.named("UNKNOWN") == .unknown)
    #expect(Band.named("UN\u{212A}NOWN") == nil)
    #expect(Band(rawValue: "UN\u{212A}NOWN") == .unknown, "Swift's own comparison folds the Kelvin sign")
    #expect(Band.named("unknown") == nil)
    #expect(Score.bands == [.protected, .connected, .peripheral, .notable, .unknown])
  }

  @Test func thresholdsFillWhatIsLeftOut() throws {
    let t = try JSONValue.object(["connectedVouches": 1, "followsYouConnects": true]).decode(Thresholds.self)
    #expect(t.connectedVouches == 1)
    #expect(t.followsYouConnects)
    #expect(t.notableReach == 10000)
    #expect(t.followsYouPeripheral)
  }

  @Test func anUnscoredRowIsUnknownAndNothingElse() throws {
    let row: JSONValue = [
      "did": "did:plc:a", "engagements": ["like": 1], "records": [], "total": 1, "primary": "like", "band": "UNKNOWN",
    ]
    let decoded = try row.decode(ScanRow.self)
    #expect(decoded.score == nil)
    #expect(decoded.band == .unknown)
    #expect(decoded.trust == nil)
    #expect(Parity.diff(encoding: decoded, row, strictNulls: true) == nil)
    var wrong = row
    wrong["band"] = "CONNECTED"
    #expect(throws: DecodingError.self) { _ = try wrong.decode(ScanRow.self) }
  }

  @Test func aScanResultIsTheSummaryWithItsPost() throws {
    let summary = Score.summarise(
      Harvest(
        uri: "at://did:plc:me/app.bsky.feed.post/1", harvestedAt: "2026-11-12T12:00:00.000Z",
        participants: [Participant(did: "did:plc:a", engagements: ["reply": 1], total: 1, primary: "reply")],
        totals: HarvestTotals(participants: 1, engagements: ["reply": 1], records: 1)),
      [:], vouchCheck: .unavailable)
    let result = ScanResult(
      summary: summary, post: ScanPost(uri: summary.uri, authorDid: "did:plc:me"), canary: nil,
      startedAt: "2026-11-12T12:00:00.000Z", finishedAt: "2026-11-12T12:00:02.000Z")
    let json = try JSONValue(encoding: result)
    #expect(json["uri"] == "at://did:plc:me/app.bsky.feed.post/1")
    #expect(json["post"]?["authorDid"] == "did:plc:me")
    #expect(json["totals"]?["byBand"]?["UNKNOWN"] == 1)
    #expect(json["autoEligible"] == [])
    #expect(try json.decode(ScanResult.self) == result)
  }
}
