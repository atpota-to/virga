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
    try Self.check("describeAllow") { .string(FakeServer.describeAllow($0.input["entries"]?.arrayValue)) }
  }

  @Test func parseEffects() throws {
    try Self.check("parseEffects") { FakeServer.parseEffects($0.input["raw"]).json }
  }

  @Test func parseConditions() throws {
    try Self.check("parseConditions") { FakeServer.parseConditions($0.input["raw"]).json }
  }

  @Test func timerBucket() throws {
    try Self.check("timerBucket") {
      .string(FakeServer.timerBucket(conditions: $0.input["conditions"], effects: $0.input["effects"]))
    }
  }

  @Test func evaluateConditions() throws {
    try Self.check("evaluateConditions") { try FakeServer.evaluateConditions($0.input["conditions"], $0["counts"]).json }
  }

  @Test func analyzePost() throws {
    try Self.check("analyzePost") {
      FakeServer.analyzePost(
        text: $0["text"].stringValue ?? "", goals: $0.input["goals"], writingChecks: $0.input["writingChecks"])
    }
  }
}
