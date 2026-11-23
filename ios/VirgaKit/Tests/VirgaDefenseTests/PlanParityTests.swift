// src/defense/plan.js, historyModel.js, bandWords.js, pace.js and limit.js
// against the web code (ios/parity/cases/defense-early.*.js). Locales are
// passed in, so the active formats are left alone.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDefense

@Suite struct PlanParity {
  private let fixture = "defense-early.plan"

  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let actual: JSONValue = [
      "APPROVABLE_BANDS": try JSONValue(encoding: Plan.approvableBands),
      "DEFAULT_BANDS": try JSONValue(encoding: Plan.defaultBands),
      "PLAN_MAX": .number(Double(Plan.planMax)),
      "NOTE_MAX": .number(Double(Plan.noteMax)),
      "BATCH": .number(Double(Plan.batch)),
      "BATCH_GAP_MS": .number(Double(Plan.batchGapMs)),
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  private func summary(_ c: ParityCase) throws -> ScanSummary? {
    c["summary"].isNull ? nil : try c["summary"].decode(ScanSummary.self)
  }

  @Test func planRows() throws {
    for c in try Parity.cases(fixture, fn: "planRows") {
      let s = try summary(c)
      let listed = Set(c["listed"].strings)
      let rows: [[PlanRow]] = c["ticks"].arrayValue!.map { ticks in
        Plan.planRows(s, ticks.isNull ? nil : ticks.strings.compactMap(Band.named), listed: listed)
      }
      let d = Parity.diff(encoding: rows, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func bandCounts() throws {
    for c in try Parity.cases(fixture, fn: "bandCounts") {
      let s = try summary(c)
      let counts = c["listedSets"].arrayValue!.map { Plan.bandCounts(s, listed: Set($0.strings)) }
      let d = Parity.diff(encoding: counts, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func estimateWrites() throws {
    for c in try Parity.cases(fixture, fn: "estimateWrites") {
      let d = Parity.diff(encoding: Plan.estimateWrites(c["n"].doubleValue ?? .nan), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func estimateWords() throws {
    for c in try Parity.cases(fixture, fn: "estimateWords") {
      let words = Plan.estimateWords(c["n"].doubleValue ?? .nan, locale: c["locale"].stringValue)
      let d = Parity.diff(.string(words), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func cleanNote() throws {
    for c in try Parity.cases(fixture, fn: "cleanNote") {
      let actual: JSONValue = Plan.cleanNote(c.input["text"]?.stringValue).map(JSONValue.string) ?? .null
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }
}

@Suite struct HistoryModelParity {
  private let fixture = "defense-early.historyModel"

  @Test func decisionPhrase() throws {
    for c in try Parity.cases(fixture, fn: "decisionPhrase") {
      let decision = try c["decision"].decode(DefenseDecision.self)
      let d = Parity.diff(.string(HistoryModel.decisionPhrase(decision)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func planOutcome() throws {
    for c in try Parity.cases(fixture, fn: "planOutcome") {
      let plan = c["plan"].isNull ? nil : try c["plan"].decode(DefensePlan.self)
      let outcome = HistoryModel.planOutcome(plan, locale: c["locale"].stringValue)
      let d = Parity.diff(encoding: outcome, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }
}

@Suite struct SmallModulesParity {
  @Test func bandWords() throws {
    let c = try Parity.cases("defense-early.bandWords", fn: "constants")[0]
    func table(_ words: [Band: String]) -> JSONValue {
      .object(Dictionary(uniqueKeysWithValues: words.map { ($0.key.rawValue, JSONValue.string($0.value)) }))
    }
    let actual: JSONValue = [
      "BAND_WORD": table(BandWords.bandWord),
      "BAND_MEANS": table(BandWords.bandMeans),
      "BAND_COUNTED": table(BandWords.bandCounted),
    ]
    let d = Parity.diff(actual, c.output, strictNulls: true)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  @Test func pace() throws {
    let c = try Parity.cases("defense-early.pace", fn: "constants")[0]
    let actual: JSONValue = [
      "BATCH": .number(Double(Pace.batch)),
      "BATCH_GAP_MS": .number(Double(Pace.batchGapMs)),
      "RATE_LIMIT_HOLD_MS": .number(Double(Pace.rateLimitHoldMs)),
      "POINTS_PER_CREATE": .number(Double(Pace.pointsPerCreate)),
      "POINTS_PER_HOUR": .number(Double(Pace.pointsPerHour)),
    ]
    let d = Parity.diff(actual, c.output, strictNulls: true)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  @Test func limit() throws {
    let c = try Parity.cases("defense-early.limit", fn: "constants")[0]
    #expect(Parity.diff(["APPVIEW_CONCURRENCY": .number(Double(Limit.appviewConcurrency))], c.output) == nil)
    for c in try Parity.cases("defense-early.limit", fn: "chunks") {
      let chunks = Limit.chunks(c["items"].arrayValue!, c["size"].intValue!)
      let d = Parity.diff(.array(chunks.map(JSONValue.array)), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
