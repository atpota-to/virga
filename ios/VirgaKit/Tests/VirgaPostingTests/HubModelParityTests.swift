// pages/hubModel.js held to scheduling.hubModel: the posting overview's
// figures, in several zones and locales.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct HubModelParity {
  static let f = "scheduling.hubModel"
  static let did = "did:plc:mira"

  static func locale(_ c: ParityCase) -> String { c["locale"].stringValue ?? "en-US" }

  @Test func countPhrase() throws {
    for c in try cases(Self.f, "countPhrase") {
      check(
        .string(HubModel.countPhrase(c.input["n"], c.string("one") ?? "", c.string("many"), locale: Self.locale(c))), c)
    }
  }

  @Test func scheduledOverview() throws {
    for c in try cases(Self.f, "scheduledOverview") {
      let input = c.input.objectValue ?? [:]
      let limit: Double = input.keys.contains("limit") ? (c.input["limit"]?.doubleValue ?? .nan) : 4
      check(HubModel.scheduledOverview(c.input["rows"], limit: limit, timeZone: ComposerFixtures.zone(c)).json, c)
    }
  }

  @Test func scheduledSnippet() throws {
    for c in try cases(Self.f, "scheduledSnippet") {
      check(.string(HubModel.scheduledSnippet(c.input["row"], max: c.input["max"]?.intValue ?? 120)), c)
    }
  }

  @Test func draftRows() throws {
    for c in try cases(Self.f, "draftRows") {
      let rows = HubModel.draftRows(
        c.input["drafts"], deviceId: c.string("deviceId"), limit: c.input["limit"]?.doubleValue,
        timeZone: ComposerFixtures.zone(c))
      check(.array(rows), c, strictNulls: true)
    }
  }

  @Test func postRows() throws {
    for c in try cases(Self.f, "rowFromPostView") {
      check(HubModel.rowFromPostView(c.input["view"], Self.did, timeZone: ComposerFixtures.zone(c)) ?? .null, c)
    }
    for c in try cases(Self.f, "mergePostRows") {
      let merged = HubModel.mergePostRows(
        c.input["archive"]?.arrayValue, c.input["feed"]?.arrayValue, removed: c.input["removed"]?.arrayValue ?? [],
        timeZone: ComposerFixtures.zone(c))
      check(.array(merged), c)
    }
  }

  @Test func timersOverview() throws {
    for c in try cases(Self.f, "timersOverview") {
      check(HubModel.timersOverview(c.input["rows"], timeZone: ComposerFixtures.zone(c)).json, c)
    }
  }

  @Test func whenLabel() throws {
    for c in try cases(Self.f, "whenLabel") {
      check(
        .string(
          HubModel.whenLabel(
            c.input["iso"], now: c.input["now"]?.doubleValue ?? .nan, weekday: c.input["weekday"]?.boolValue ?? true,
            locale: Self.locale(c), timeZone: ComposerFixtures.zone(c))), c)
    }
  }
}
