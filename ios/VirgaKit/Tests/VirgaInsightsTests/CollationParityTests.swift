// localeCompare with no locale (ios/parity/cases/insights.collation.js):
// pairs and whole lists, compared and sorted by Node's own collator.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct CollationParity {
  let fixture = "insights.collation"

  @Test func pairs() throws {
    var failures: [String] = []
    let cases = try Parity.cases(fixture, fn: "localeCompare")
    for c in cases {
      let a = c["a"].stringValue ?? ""
      let b = c["b"].stringValue ?? ""
      let got = JSCollation.localeCompare(a, b)
      if Double(got) != c.output.doubleValue {
        failures.append("\(a.debugDescription) vs \(b.debugDescription): \(got), expected \(c.output)")
      }
    }
    #expect(failures.isEmpty, "\(failures.count) of \(cases.count):\n\(failures.prefix(40).joined(separator: "\n"))")
  }

  @Test func sortedLists() throws {
    for c in try Parity.cases(fixture, fn: "sort") {
      let list = strings(c["list"])
      let sorted = JSSort.sort(list) { Double(JSCollation.localeCompare($0, $1)) }
      expectOutput(.array(sorted.map(JSONValue.string)), c)
    }
  }
}
