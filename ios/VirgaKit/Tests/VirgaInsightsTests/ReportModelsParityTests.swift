// The report models (src/reports/models.js) held to the web's own output:
// the harness's accounts over every period and option (insights.models), in
// other zones and formats (insights.modelsZones), and hand-made archives at
// the edges with the small pure functions (insights.modelsEdges).

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

/// Runs the model a case names over its archive.
func runModel(_ c: ParityCase) -> JSONValue? {
  guard let archive = ReportFixtures.archive(c) else { return nil }
  let f = c.formats
  if ["listsModel", "followerLogModel", "relationSets"].contains(c.fn) {
    switch c.fn {
    case "listsModel": return .array(ReportModels.listsModel(archive, formats: f).map(\.json))
    case "followerLogModel": return ReportModels.followerLogModel(archive, formats: f).json
    default: return ReportModels.relationSets(archive, formats: f).json
    }
  }
  guard let period = c.period else {
    Issue.record("\(c): the period doesn't decode")
    return nil
  }
  let now = c["nowMs"].doubleValue ?? .nan
  let unit = c.unitOption("unit")
  let kind = c.option("kind")?.stringValue ?? "all"
  switch c.fn {
  case "followersModel": return ReportModels.followersModel(archive, period, now, unit: unit, formats: f).json
  case "blocksModel": return ReportModels.blocksModel(archive, period, now, unit: unit, formats: f).json
  case "postsModel": return ReportModels.postsModel(archive, period, now, unit: unit, formats: f).json
  case "engagementModel":
    return ReportModels.engagementModel(
      archive, period, now, kind: kind, unit: unit, rateUnit: c.unitOption("rateUnit"), formats: f
    ).json
  case "givenModel": return ReportModels.givenModel(archive, period, now, kind: kind, unit: unit, formats: f).json
  case "peopleModel": return ReportModels.peopleModel(archive, period, now, kind: kind, formats: f).json
  case "followBackModel":
    return .array(ReportModels.followBackModel(archive, period, now, formats: f).map(ReportJSON.actor))
  case "atmosphereModel": return ReportModels.atmosphereModel(archive, period, now, unit: unit, formats: f)?.json ?? .null
  case "bestTimeModel":
    return ReportModels.bestTimeModel(archive, period, now, block: c.option("block")?.intValue ?? 2, formats: f).json
  case "contentModel": return ReportModels.contentModel(archive, period, now, formats: f).json
  default:
    Issue.record("\(c): no model \(c.fn)")
    return nil
  }
}

let reportModelNames = [
  "followersModel", "blocksModel", "postsModel", "engagementModel", "givenModel", "peopleModel", "followBackModel",
  "atmosphereModel", "bestTimeModel", "contentModel",
]

@Suite struct ReportModelsParity {
  @Test(arguments: reportModelNames + ["listsModel", "followerLogModel", "relationSets"])
  func harnessAccounts(_ fn: String) throws {
    for c in try Parity.cases("insights.models", fn: fn) {
      if let actual = runModel(c) { expectReport(actual, c) }
    }
  }

  @Test(arguments: ["followersModel", "blocksModel", "postsModel", "engagementModel", "givenModel", "peopleModel", "bestTimeModel", "contentModel"])
  func otherZonesAndFormats(_ fn: String) throws {
    for c in try Parity.cases("insights.modelsZones", fn: fn) {
      if let actual = runModel(c) { expectReport(actual, c) }
    }
  }

  @Test(arguments: reportModelNames + ["listsModel", "followerLogModel", "relationSets"])
  func edges(_ fn: String) throws {
    for c in try Parity.cases("insights.modelsEdges", fn: fn) {
      if let actual = runModel(c) { expectReport(actual, c) }
    }
  }
}

@Suite struct ReportFunctionsParity {
  let fixture = "insights.modelsEdges"

  @Test func median() throws {
    for c in try Parity.cases(fixture, fn: "median") {
      let values = (c["values"].arrayValue ?? []).compactMap(\.doubleValue)
      expectOutput(ReportJSON.number(ReportModels.median(values)), c)
    }
  }

  @Test func hourRange() throws {
    for c in try Parity.cases(fixture, fn: "hourRange") {
      let twelve = ReportFormats.twelveHour(c["locale"].stringValue ?? "en-US")
      let text = ReportModels.hourRange(c["col"].intValue ?? 0, c["block"].intValue ?? 2, twelveHour: twelve)
      expectOutput(.string(text), c)
    }
  }

  @Test func hourColumns() throws {
    for c in try Parity.cases(fixture, fn: "hourColumns") {
      let twelve = ReportFormats.twelveHour(c["locale"].stringValue ?? "en-US")
      expectOutput(.array(ReportModels.hourColumns(c["block"].intValue ?? 2, twelveHour: twelve).map(\.json)), c)
    }
  }

  @Test func weekdayOrder() throws {
    for c in try Parity.cases(fixture, fn: "weekdayOrder") {
      expectOutput(.array(ReportModels.weekdayOrder(c["weekStart"].intValue).map { .number(Double($0)) }), c)
    }
  }

  @Test func formatOf() throws {
    for c in try Parity.cases(fixture, fn: "formatOf") {
      var post = c["post"]
      post["uri"] = "at://x/app.bsky.feed.post/1"
      guard let row = PostRow(json: post) else { continue }
      expectOutput(.string(ReportModels.formatOf(row)), c)
    }
  }

  @Test func contentReady() throws {
    for c in try Parity.cases(fixture, fn: "contentReady") {
      let archive = ReportArchive(did: "did:plc:me", data: ArchiveData(meta: ArchiveMeta(json: c["meta"])))
      expectOutput(.bool(ReportModels.contentReady(archive)), c)
    }
  }

  @Test func contentStandout() throws {
    for c in try Parity.cases(fixture, fn: "contentStandout") {
      let groups = (c["groups"].arrayValue ?? []).map { g in
        ContentGroup(
          key: g["key"]?.stringValue ?? "", label: g["label"]?.stringValue ?? "", posts: g["posts"]?.intValue ?? 0,
          total: g["total"]?.intValue ?? 0, share: g["share"]?.doubleValue ?? 0, typical: g["typical"]?.doubleValue)
      }
      let out = ReportModels.contentStandout(groups, c["overall"].doubleValue, c["against"].stringValue)
      expectOutput(out?.json ?? .null, c)
    }
  }

  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let bands: [JSONValue] = ReportModels.lengthBands.map { b in
      ["key": .string(b.key), "label": .string(b.label), "max": b.max!.isFinite ? .number(b.max!) : "$Infinity"]
    }
    let actual: JSONValue = [
      "WEEKDAYS": .array(ReportModels.weekdays.map(JSONValue.string)),
      "WEEKDAYS_LONG": .array(ReportModels.weekdaysLong.map(JSONValue.string)),
      "BEST_TIME_MIN_POSTS": .number(Double(ReportModels.bestTimeMinPosts)),
      "CONTENT_FORMATS": .array(ReportModels.contentFormats.map(\.json)),
      "LENGTH_BANDS": .array(bands),
      "THREAD_PLACES": .array(ReportModels.threadPlaces.map(\.json)),
      "CONTENT_MIN_POSTS": .number(Double(ReportModels.contentMinPosts)),
      "GIVEN_NOUN": .array(ReportModels.givenNoun.map { [.string($0.kind), .string($0.noun)] }),
    ]
    expectOutput(actual, c, strictNulls: true)
  }
}
