// What a fixture can't show about the report models: the cache. Each test
// keeps a cache of its own, as the shared one is filled by every parity
// test running at the same time.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct ReportCacheBehaviour {
  func archive(_ did: String = "did:plc:me", rev: Int = 1, now: Double? = 1_794_700_000_000) -> ReportArchive {
    ReportArchive(did: did, nowMs: now, data: ArchiveData(loaded: true, rev: rev))
  }

  @Test func computesOncePerKey() {
    let cache = ReportModels.Cache(limit: 80)
    var runs = 0
    let probe = { (a: ReportArchive, period: AnalyticsPeriod?, options: [(String, JSONValue)], formats: ReportFormats) -> Int in
      ReportModels.cached(in: cache, a, "probe", period, options, formats: formats) { () -> Int in
        runs += 1
        return 7
      }
    }
    let utc = ReportFormats(locale: "en-US", weekStart: 1, timeZone: TimeZone(identifier: "UTC")!)
    for _ in 0..<3 { #expect(probe(archive(), nil, [("x", 1)], utc) == 7) }
    #expect(runs == 1)
    // Another revision, follow revision, now, period, option or set of
    // formats is another key.
    _ = probe(archive(rev: 2), nil, [("x", 1)], utc)
    _ = probe(ReportArchive(did: "did:plc:me", nowMs: 1_794_700_000_000, data: ArchiveData(rev: 1, followRev: 1)), nil, [("x", 1)], utc)
    _ = probe(archive(now: 1), nil, [("x", 1)], utc)
    _ = probe(archive(now: nil), nil, [("x", 1)], utc)
    _ = probe(archive(), Analytics.analyticsPeriods[0], [("x", 1)], utc)
    _ = probe(archive(), nil, [("x", 2)], utc)
    _ = probe(archive(), nil, [("y", 1)], utc)
    _ = probe(archive(), nil, [("x", 1)], ReportFormats(locale: "en-GB", weekStart: 1, timeZone: utc.timeZone))
    _ = probe(archive(), nil, [("x", 1)], ReportFormats(locale: "en-US", weekStart: 0, timeZone: utc.timeZone))
    _ = probe(archive(), nil, [("x", 1)], ReportFormats(locale: "en-US", weekStart: 1, timeZone: TimeZone(identifier: "Asia/Kolkata")!))
    #expect(runs == 11)
    _ = probe(archive(), nil, [("x", 1)], utc)
    #expect(runs == 11)
  }

  @Test func keepsANilResult() {
    let cache = ReportModels.Cache(limit: 80)
    var runs = 0
    for _ in 0..<2 {
      let v: Int? = ReportModels.cached(in: cache, archive(), "probe", nil, []) { () -> Int? in
        runs += 1
        return nil
      }
      #expect(v == nil)
    }
    #expect(runs == 1)
  }

  @Test func forgetsTheOldestPastItsLimit() {
    let cache = ReportModels.Cache(limit: 80)
    var runs = 0
    let probe = { (i: Int) in
      _ = ReportModels.cached(in: cache, archive(), "probe-\(i)", nil, []) { () -> Int in
        runs += 1
        return i
      }
    }
    for i in 0...80 { probe(i) }
    #expect(runs == 81)
    #expect(cache.state.wrappedValue.order.count == 80)
    probe(1)
    #expect(runs == 81, "the second is still there")
    probe(0)
    #expect(runs == 82, "the first went when the 81st came in")
  }

  @Test func theWebsLimit() {
    #expect(ReportModels.cacheLimit == 80)
  }

  @Test func keysOnTheArchivesNowAsTheWebDoes() {
    // The web's key holds the context's now, not the one a model is
    // passed: on one screen they are the same. Two nows over one archive
    // are one key.
    let a = archive()
    let k1 = ReportModels.cacheKey(a, "posts", Analytics.analyticsPeriods[0], [], formats: .active)
    var later = a
    later.nowMs = 1_794_700_000_001
    let k2 = ReportModels.cacheKey(later, "posts", Analytics.analyticsPeriods[0], [], formats: .active)
    #expect(k1 != k2)
    // A custom range is keyed by its own key, which names its days.
    let custom = Periods.customPeriod("2026-10-01", "2026-10-31", 1_794_700_000_000, timeZone: TimeZone(identifier: "UTC")!)
    #expect(ReportModels.cacheKey(a, "posts", custom, [], formats: .active).contains("custom:2026-10-01:2026-10-31"))
  }

  @Test func clearsEverything() {
    let cache = ReportModels.Cache(limit: 80)
    var runs = 0
    _ = ReportModels.cached(in: cache, archive(), "probe", nil, []) { () -> Int in runs += 1; return 1 }
    cache.clear()
    _ = ReportModels.cached(in: cache, archive(), "probe", nil, []) { () -> Int in runs += 1; return 1 }
    #expect(runs == 2)
  }
}
