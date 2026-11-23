// A card as a picture to post (ios/parity/cases/insights.share.js): the
// spec of every shareable card over the harness's accounts and the hand-
// made archives, its description and the post's first line, and
// descriptions of made-up specs at the edges.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

func shareOptions(_ c: ParityCase) -> ShareOptions {
  let o = c.input["options"]
  return ShareOptions(
    kind: o?["kind"]?.stringValue ?? "all", rows: o?["rows"]?.doubleValue, title: o?["title"]?.stringValue,
    notes: annotationList(o?["notes"]) ?? [])
}

@Suite struct ShareSpecParity {
  let fixture = "insights.share"

  @Test func shareSpec() throws {
    for c in try Parity.cases(fixture, fn: "shareSpec") {
      guard let archive = ReportFixtures.archive(c), let period = c.period else { continue }
      let f = c.formats
      let spec = ShareSpec.shareSpec(c["type"].stringValue ?? "", archive, period, c["nowMs"].doubleValue ?? .nan, shareOptions(c), formats: f)
      let actual: JSONValue = [
        "spec": spec?.json ?? .null, "alt": .string(ShareSpec.shareAltText(spec, formats: f)),
        "post": .string(ShareSpec.sharePostText(spec, period, formats: f)),
      ]
      expectReport(actual, c)
    }
  }

  @Test func canShare() throws {
    for c in try Parity.cases(fixture, fn: "canShare") {
      let type = c["type"].stringValue ?? ""
      if ["constructor", "toString", "__proto__"].contains(type) {
        // Names Object.prototype carries: the web's plain-object lookup says
        // yes (and its shareSpec would then call Object); here they're no type.
        #expect(!ShareSpec.canShare(type), "\(c)")
        continue
      }
      expectOutput(.bool(ShareSpec.canShare(type)), c)
    }
  }

  @Test func shareAltText() throws {
    for c in try Parity.cases(fixture, fn: "shareAltText") {
      let spec = c.input["spec"].flatMap(shareSpecification)
      expectOutput(.string(ShareSpec.shareAltText(spec, formats: c.formats)), c)
    }
  }

  @Test func sharePostText() throws {
    for c in try Parity.cases(fixture, fn: "sharePostText") {
      guard let period = c.period else { continue }
      let spec = c.input["spec"].flatMap { s -> ShareSpecification? in
        s.isNull ? nil : ShareSpecification(kind: .bars, title: s["title"]?.stringValue ?? "", figure: nil)
      }
      expectOutput(.string(ShareSpec.sharePostText(spec, period, formats: c.formats)), c)
    }
  }
}
