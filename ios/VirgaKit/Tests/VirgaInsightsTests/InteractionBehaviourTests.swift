// What the Interaction lookup's fixture can't show: where "now" comes from
// when the archive has none, and kindsLine over a dictionary.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct InteractionBehaviour {
  let utc = ReportFormats(locale: "en-US", weekStart: 1, timeZone: TimeZone(identifier: "UTC")!)

  func archive(nowMs: Double?, rev: Int) -> ReportArchive {
    let like = EngagementEvent(uri: "at://did:plc:ada/app.bsky.feed.like/1", did: "did:plc:ada", kind: "like", at: "2026-01-15T12:00:00.000Z")
    return ReportArchive(
      did: "did:plc:now-\(rev)", nowMs: nowMs, data: ArchiveData(loaded: true, inbound: [like], rev: rev))
  }

  @Test func theTimelineRunsToTheArchivesNow() {
    let m = InteractionModel.interactionModel(archive(nowMs: JSDate.utc(2026, 3, 10), rev: 1), "did:plc:ada", formats: utc)
    #expect(m.timeline?.outbound.count == 4, "January to April")
  }

  @Test func withoutOneItRunsToTheNowGiven() {
    let m = InteractionModel.interactionModel(
      archive(nowMs: nil, rev: 2), "did:plc:ada", nowMs: JSDate.utc(2026, 5, 10), formats: utc)
    #expect(m.timeline?.outbound.count == 6, "January to June")
  }

  @Test func kindsLineOverADictionary() {
    #expect(InteractionModel.kindsLine(["reply": 2, "like": 1, "quote": 0, "mention": 1], locale: "en-US") == "1 like, 2 replies, 1 mention")
    #expect(InteractionModel.kindsLine(["like": 13, "reply": 9, "repost": 22], byCount: true, locale: "en-US") == "22 reposts, 13 likes, 9 replies")
    #expect(InteractionModel.kindsLine(["zap": 1, "follow": 2], locale: "en-US") == "2 follows, 1 zap", "unknown kinds by name")
    #expect(InteractionModel.kindsLine(nil) == "")
  }
}
