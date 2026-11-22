// Parity with harness/harness.js readFlags (readLimits, readAiLimits),
// against ios/parity/fixtures/demo-network.harness.json, and DemoOptions
// read from the same strings.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct HarnessFlagsParity {
  static let fixture = "demo-network.harness"

  @Test func readFlags() throws {
    let cases = try Parity.cases(Self.fixture, fn: "readFlags")
    #expect(cases.count > 60)
    for c in cases {
      let flags = Harness.readFlags(c["search"].stringValue ?? "")
      let d = Exact.diff(try JSONValue(encoding: flags), c.output)
      #expect(d == nil, "\(c) \(c["search"].stringValue ?? ""): \(d ?? "")")
    }
  }

  @Test func demoOptionsTakeTheFlagsThatApply() throws {
    for c in try Parity.cases(Self.fixture, fn: "readFlags") {
      let search = c["search"].stringValue ?? ""
      let flags = Harness.readFlags(search)
      let options = DemoOptions.read(search)
      #expect(options.accounts == flags.accounts, "\(search)")
      #expect(options.signedOut == flags.signedOut, "\(search)")
      #expect(options.expired == flags.expired, "\(search)")
      #expect(options.scope == flags.scope, "\(search)")
      #expect(options.terms == flags.terms, "\(search)")
      #expect(options.latency == flags.latency, "\(search)")
      #expect(options.now == flags.now, "\(search)")
      #expect(options.appview == flags.appview, "\(search)")
      // Long sessions only, and the server's other flags at their defaults.
      let back = options.flags
      #expect(back.mode == "backend", "\(search)")
      #expect(back.limits == Harness.readFlags("").limits && back.ai == "ok" && back.moderator == "on", "\(search)")
    }
  }
}
