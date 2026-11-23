// src/defense/pageModel.js against the web code (ios/parity/cases/
// defense.pageModel.js): the posts offered for a scan, every account's
// phrases and lines, a scan's stage line, label, count and bar, and the
// CSV export.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense.pageModel"

/// The rows the cases name, read once.
private func rowTable() throws -> [String: ScanRow] {
  let table = try Parity.cases(fixture, fn: "rows")[0].output
  return try (table.objectValue ?? [:]).mapValues { try $0.decode(ScanRow.self) }
}

private func vouchCheck(_ c: ParityCase) -> VouchCheck {
  VouchCheck(rawValue: c["vouchCheck"].stringValue ?? "") ?? .canary
}

private func state(_ value: JSONValue?) -> ScanState? {
  guard let value, case .object = value else { return nil }
  let progress = value["progress"].flatMap { p -> ScanState.Progress? in
    guard let done = p["done"]?.intValue, let total = p["total"]?.intValue else { return nil }
    return ScanState.Progress(done: done, total: total)
  }
  return ScanState(status: .running, stage: value["stage"]?.stringValue, progress: progress)
}

@Suite struct PageModelParity {
  @Test func postsToScan() throws {
    for c in try Parity.cases(fixture, fn: "postsToScan") {
      let zone = c.input["zone"]?.stringValue.flatMap(TimeZone.init(identifier:)) ?? utc
      let out = PageModel.postsToScan(
        c["posts"].arrayValue, now: date(ms: c["now"].doubleValue ?? 0), days: c.input["days"]?.doubleValue ?? 30,
        limit: c.input["limit"]?.intValue ?? 4, timeZone: zone)
      let d = Parity.diff(.array(out), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func rowPhrases() throws {
    let rows = try rowTable()
    for fn in ["vouchPhrase", "didPhrase", "protectedPhrase", "describeRow", "rowFacts"] {
      for c in try Parity.cases(fixture, fn: fn) {
        let row = try #require(rows[c["row"].stringValue ?? ""], "\(c): no row")
        let locale = c["locale"].stringValue
        let check = vouchCheck(c)
        let actual: JSONValue
        switch fn {
        case "vouchPhrase": actual = .string(PageModel.vouchPhrase(row, check, locale: locale))
        case "didPhrase": actual = .string(PageModel.didPhrase(row))
        case "protectedPhrase": actual = PageModel.protectedPhrase(row).map(JSONValue.string) ?? .null
        case "describeRow": actual = .of(PageModel.describeRow(row, check, locale: locale))
        default: actual = .array(PageModel.rowFacts(row, check, locale: locale).map(JSONValue.string))
        }
        let d = Parity.diff(actual, c.output)
        #expect(d == nil, "\(c): \(d ?? "")")
      }
    }
  }

  @Test func stage() throws {
    for c in try Parity.cases(fixture, fn: "stage") {
      let s = state(c.input["state"])
      let locale = c["locale"].stringValue
      let actual: JSONValue = [
        "line": .string(PageModel.stageLine(s, locale: locale)),
        "label": .string(PageModel.stageLabel(s)),
        "count": .string(PageModel.stageCount(s, locale: locale)),
        "fraction": .number(PageModel.stageFraction(s)),
      ]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func inertCell() throws {
    for c in try Parity.cases(fixture, fn: "inertCell") {
      let d = Parity.diff(PageModel.inertCell(c.input["value"] ?? .null), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func scanCsvRows() throws {
    for c in try Parity.cases(fixture, fn: "scanCsvRows") {
      let given = c["summary"]
      var summary: ScanSummary?
      if case .object = given {
        let rows = try (given["rows"]?.arrayValue ?? []).map { try $0.decode(ScanRow.self) }
        let check = VouchCheck(rawValue: given["vouchCheck"]?.stringValue ?? "") ?? .canary
        summary = ScanSummary(
          uri: "", harvestedAt: nil, truncated: false, unread: [], vouchCheck: check,
          totals: SummaryTotals(participants: rows.count, engagements: [:], byBand: [:], reviewReach: 0, alreadyListed: 0, blocksYou: 0),
          rows: rows, requiresReview: [], autoEligible: [])
      }
      let out = PageModel.scanCsvRows(summary)
      let d = Parity.diff(.array(out.map(JSONValue.array)), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
