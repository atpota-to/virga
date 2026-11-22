// Parity with harness/fakeServer.js's pure rules (the timer rules, the
// limits' buckets, the adviser's judgement), against
// ios/parity/fixtures/demo-server.rules.json.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct DemoServerRulesParity {
  static let fixture = "demo-server.rules"

  /// A result, or what it threw, as the generator's `each` records it.
  static func outcome(_ body: () throws -> JSONValue?) -> JSONValue {
    do {
      return try body() ?? .null
    } catch {
      return ["$throws": .string(jsMessage(error))]
    }
  }

  static func check(_ fn: String, _ compute: (ParityCase) throws -> JSONValue?) throws {
    let cases = try Parity.cases(fixture, fn: fn)
    #expect(!cases.isEmpty, "\(fn)")
    for c in cases {
      let got = outcome { try compute(c) }
      let d = Exact.diff(got, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func narrowAllow() throws {
    try Self.check("narrowAllow") { try FakeServer.narrowAllow($0.input["wanted"], $0.input["existing"]).json }
  }

  @Test func describeAllow() throws {
    try Self.check("describeAllow") { .string(try FakeServer.describeAllow($0.input["entries"])) }
  }

  @Test func parseEffects() throws {
    try Self.check("parseEffects") { FakeServer.parseEffects($0.input["raw"]).json }
  }

  @Test func parseConditions() throws {
    try Self.check("parseConditions") { FakeServer.parseConditions($0.input["raw"]).json }
  }

  @Test func timerBucket() throws {
    try Self.check("timerBucket") {
      .string(try FakeServer.timerBucket(conditions: $0.input["conditions"], effects: $0.input["effects"]))
    }
  }

  @Test func evaluateConditions() throws {
    try Self.check("evaluateConditions") { try FakeServer.evaluateConditions($0.input["conditions"], $0["counts"]).json }
  }

  /// validateRepeat's check of a zone (Intl's), and what the zone's clock reads.
  @Test func zone() throws {
    try Self.check("zone") { c in
      let tz = c.input["tz"]
      let ok = ServerRepeat.isZone(tz)
      let walls: JSONValue? =
        ok
        ? .array(
          ["2026-01-15T12:00:00.000Z", "2026-07-15T12:00:00.000Z"].map {
            ServerRepeat.anchoredRepeat(["every": "day"], .string($0), tz)?["anchor"] ?? .null
          }) : nil
      return ["ok": .bool(ok), "walls": walls ?? .null]
    }
  }

  /// The stand-in for repeat.js's anchoredRepeat and nextOccurrence.
  @Test func repeatStandIn() throws {
    try Self.check("repeat") { c in
      let anchored = ServerRepeat.anchoredRepeat(
        c.input["rule"], c.input["at"], c.input["tz"], occurrence: c.input["occurrence"] ?? 1)
      let start = JSDate.parse(c["at"].stringValue ?? "", timeZone: .gmt)
      var next: [JSONValue] = []
      for offset in [-1, 0, 1, 36 * 3_600_000, 9 * 86_400_000, 200 * 86_400_000] as [Double] {
        for from in [1, 2, 7, JSONValue.null] as [JSONValue] {
          let found = ServerRepeat.nextOccurrence(anchored, from, nowMs: start + offset)
          next.append(
            found.map { ["occurrence": .number($0.occurrence), "scheduledFor": .string($0.scheduledFor)] } ?? .null)
        }
      }
      return ["anchored": anchored ?? .null, "next": .array(next)]
    }
  }

  @Test func analyzePost() throws {
    try Self.check("analyzePost") {
      FakeServer.analyzePost(
        text: $0["text"].stringValue ?? "", goals: $0.input["goals"], writingChecks: $0.input["writingChecks"])
    }
  }
}
