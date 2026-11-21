// Parity with src/lib/analytics.js: buckets in every zone and first day of
// the week, the series and comparisons, rates, ranked lists, the shapers
// and the tile formats (fixtures archive.buckets and archive.analytics).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaArchive

/// A picker named in a case: the item's time.
private func pickTime(_ name: String?) -> (JSONValue) -> JSONValue? {
  switch name {
  case "followedAt": return { $0["followedAt"] }
  case "rate": return { $0["atMs"]?.doubleValue.map(JSONValue.number) ?? $0["at"] }
  default: return { $0["at"] }
  }
}

/// A picker named in a case: the item's value, as `Number(value(item))`.
private func pickValue(_ name: String?) -> ((JSONValue) -> Double)? {
  switch name {
  case "likes": return { $0["likes"].jsNumber }
  case "engagement": return { Double(Analytics.engagementOf(PostRow(json: $0), "all")) }
  default: return nil
  }
}

private func unit(_ c: ParityCase) -> AnalyticsUnit { AnalyticsUnit(c["unit"].stringValue) }

private func series(_ points: [SeriesPoint]) -> JSONValue {
  .array(points.map { ["t": js($0.t), "v": js($0.v)] })
}

@Suite struct BucketsParity {
  @Test func buckets() throws {
    try forEachCase("archive.buckets", "buckets") { c in
      let t = markers(c.input["t"] ?? .null)
      let start = Analytics.bucketStartMs(c.input["t"] == nil ? nil : t, unit(c), timeZone: c.zone, weekStart: c.weekStart)
      let next = Analytics.nextBucketMs(c.input["t"] == nil ? nil : t, unit(c), timeZone: c.zone, weekStart: c.weekStart)
      return ["start": js(start), "next": js(next)]
    }
  }

  @Test func bucketSeries() throws {
    try forEachCase("archive.buckets", "bucketSeries") { c in
      let items = c["items"].arrayValue
      let result = Analytics.bucketSeries(
        c.input["items"] == nil ? nil : items, unit: unit(c), t0: c.number("t0"), t1: c.number("t1"),
        timeZone: c.zone, weekStart: c.weekStart, pickTime: pickTime(c["pickTime"].stringValue),
        pickValue: pickValue(c["pickValue"].stringValue))
      return series(result)
    }
  }

  @Test func bucketLabel() throws {
    try forEachCase("archive.buckets", "bucketLabel") { c in
      .string(Analytics.bucketLabel(c.number("t"), unit(c), locale: c.locale, timeZone: c.zone))
    }
  }
}

@Suite struct AnalyticsParity {
  @Test func constants() throws {
    let c = try Parity.cases("archive.analytics", fn: "constants")[0]
    let actual: JSONValue = [
      "POST_ROW_VERSION": .number(Double(Analytics.postRowVersion)),
      "ANALYTICS_PERIODS": encoded(Analytics.analyticsPeriods),
      "ENGAGEMENT_KINDS": encoded(Analytics.engagementKinds),
      "EVENT_KINDS": encoded(Analytics.eventKinds),
    ]
    let d = exactDiff(actual, c.output, strictNulls: true)
    #expect(d == nil, "\(d ?? "")")
  }

  @Test func cumulativeSeries() throws {
    try forEachCase("archive.analytics", "cumulativeSeries") { c in
      let points = c["series"].arrayValue?.map { SeriesPoint(t: num($0["t"]), v: num($0["v"])) }
      return series(Analytics.cumulativeSeries(points, c.optionalNumber("baseline") ?? 0))
    }
  }

  @Test func movingAverage() throws {
    try forEachCase("archive.analytics", "movingAverage") { c in
      let points = c["series"].arrayValue?.map { SeriesPoint(t: num($0["t"]), v: num($0["v"])) }
      return series(Analytics.movingAverage(points, c.has("window") ? c.number("window") : 7))
    }
  }

  @Test func comparePeriods() throws {
    try forEachCase("archive.analytics", "comparePeriods") { c in
      let days: Double? = c.optionalNumber("days")
      let result = Analytics.comparePeriods(
        c["items"].arrayValue, days: days, now: c.number("now"), timeZone: c.zone, pickTime: pickTime(nil),
        pickValue: pickValue(c["pickValue"].stringValue))
      return encoded(result)
    }
  }

  @Test func rateSeries() throws {
    try forEachCase("archive.analytics", "rateSeries") { c in
      let result = Analytics.rateSeries(
        rows(c["posts"]), unit: unit(c), t0: c.number("t0"), t1: c.number("t1"), kind: c["kind"].stringValue ?? "all",
        timeZone: c.zone)
      return encoded(result)
    }
  }

  @Test func rollingRate() throws {
    try forEachCase("archive.analytics", "rollingRate") { c in
      let points = c["series"].arrayValue?.map {
        RatePoint(t: num($0["t"]), v: $0["v"]?.doubleValue, total: num($0["total"]), posts: num($0["posts"]))
      }
      return encoded(Analytics.rollingRate(points, c.has("window") ? c.number("window") : 7))
    }
  }

  @Test func compareRates() throws {
    try forEachCase("archive.analytics", "compareRates") { c in
      encoded(
        Analytics.compareRates(
          rows(c["posts"]), days: c.optionalNumber("days"), now: c.number("now"), kind: c["kind"].stringValue ?? "all",
          timeZone: c.zone))
    }
  }

  @Test func isOwnVoicePost() throws {
    try forEachCase("archive.analytics", "isOwnVoicePost") { c in
      .bool(Analytics.isOwnVoicePost(PostRow(json: c["post"]), c["owner"].stringValue))
    }
  }

  @Test func givenEvents() throws {
    try forEachCase("archive.analytics", "givenEvents") { c in
      json(Analytics.givenEvents(rows(c["outbound"]), rows(c["posts"]), c["owner"].stringValue))
    }
  }

  @Test func topPosts() throws {
    try forEachCase("archive.analytics", "topPosts") { c in
      let result = Analytics.topPosts(
        rows(c["posts"]), kind: c["kind"].stringValue ?? "all", t0: c.optionalNumber("t0") ?? -.infinity,
        t1: c.optionalNumber("t1") ?? .infinity, limit: c["limit"].intValue ?? 10, timeZone: c.zone)
      return json(result)
    }
  }

  @Test func topActors() throws {
    try forEachCase("archive.analytics", "topActors") { c in
      let result = Analytics.topActors(
        c["events"].arrayValue, kind: c["kind"].stringValue ?? "all", t0: c.optionalNumber("t0") ?? -.infinity,
        t1: c.optionalNumber("t1") ?? .infinity, limit: c["limit"].intValue ?? 12,
        excludeDid: c["excludeDid"].stringValue, timeZone: c.zone)
      return encoded(result)
    }
  }

  @Test func blockReach() throws {
    try forEachCase("archive.analytics", "blockReach") { c in
      encoded(Analytics.blockReach(rows(c["blocks"]), timeZone: c.zone))
    }
  }

  @Test func engagementOf() throws {
    try forEachCase("archive.analytics", "engagementOf") { c in
      .number(Double(Analytics.engagementOf(PostRow(json: c["post"]), c["kind"].stringValue ?? "all")))
    }
  }

  @Test func didFromAtUri() throws {
    try forEachCase("archive.analytics", "didFromAtUri") { c in
      Analytics.didFromAtUri(c.input["uri"]).map(JSONValue.string) ?? .null
    }
  }

  @Test func linkHost() throws {
    try forEachCase("archive.analytics", "linkHost") { c in
      Analytics.linkHost(c["uri"].stringValue).map(JSONValue.string) ?? .null
    }
  }

  /// A row as the web shapes it: its JSON.
  private func row(_ row: PostRow?) -> JSONValue { row?.json ?? .null }

  @Test func compactPostFromFeedItem() throws {
    try forEachCase("archive.analytics", "compactPostFromFeedItem") { c in
      row(Analytics.compactPostFromFeedItem(c.input["item"], timeZone: c.zone))
    }
  }

  @Test func compactPostFromRecord() throws {
    try forEachCase("archive.analytics", "compactPostFromRecord") { c in
      row(Analytics.compactPostFromRecord(c["uri"].stringValue, c.input["record"], timeZone: c.zone))
    }
  }

  @Test func upgradePostRows() throws {
    try forEachCase("archive.analytics", "upgradePostRows") { c in
      var records: [JSKey: JSONValue]?
      if let pairs = c["records"].arrayValue {
        records = [:]
        for pair in pairs {
          if let uri = pair[0]?.stringValue { records![JSKey(uri)] = pair[1] ?? .null }
        }
      }
      return json(Analytics.upgradePostRows(rows(c["rows"]), records, timeZone: c.zone))
    }
  }

  @Test func inboundFromNotification() throws {
    try forEachCase("archive.analytics", "inboundFromNotification") { c in
      Analytics.inboundFromNotification(c.input["n"], timeZone: c.zone)?.json ?? .null
    }
  }

  @Test func outboundFromRecord() throws {
    try forEachCase("archive.analytics", "outboundFromRecord") { c in
      Analytics.outboundFromRecord(c["kind"].stringValue ?? "", c.input["record"], timeZone: c.zone)?.json ?? .null
    }
  }

  @Test func outboundFromPosts() throws {
    try forEachCase("archive.analytics", "outboundFromPosts") { c in
      json(Analytics.outboundFromPosts(rows(c["posts"])))
    }
  }

  @Test func unitChoices() throws {
    try forEachCase("archive.analytics", "unitChoices") { c in
      let span = c.optionalNumber("span")
      return [
        "choices": .array(Analytics.unitChoicesFor(span).map { .string($0.rawValue) }),
        "default": .string(Analytics.defaultUnitFor(span).rawValue),
      ]
    }
  }

  @Test func fmtCompact() throws {
    try forEachCase("archive.analytics", "fmtCompact") { c in
      .string(Analytics.fmtCompact(c.optionalNumber("n"), locale: c.locale))
    }
  }

  @Test func fmtDelta() throws {
    try forEachCase("archive.analytics", "fmtDelta") { c in
      .string(Analytics.fmtDelta(c.optionalNumber("pct")))
    }
  }

  @Test func oldestEventMs() throws {
    try forEachCase("archive.analytics", "oldestEventMs") { c in
      js(Analytics.oldestEventMs(c["events"].arrayValue, timeZone: c.zone))
    }
  }
}
