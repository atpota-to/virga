// TEMPORARY: measures JSCollation against core.collation. Deleted before commit.
import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct MeasureJSCollationTmp {
  @Test func measure() throws {
    var bad: [String: Int] = [:]
    var total = 0
    var samples: [String] = []
    for c in try Parity.cases("core.collation", fn: "localeCompare") {
      let fam = String(c.id.split(separator: "#")[0])
      let a = c["a"].arrayValue ?? []
      let b = c["b"].arrayValue ?? []
      let variant = c.output["variant"]?.arrayValue ?? []
      for i in a.indices {
        let x = a[i].stringValue ?? "", y = b[i].stringValue ?? ""
        total += 1
        let v = JSCollation.localeCompare(x, y)
        if Double(v) != variant[i].doubleValue { bad[fam, default: 0] += 1; if samples.count < 150 { samples.append("V \(fam) \(x.debugDescription) \(y.debugDescription) got \(v) want \(variant[i])") } }
      }
    }
    print("JSCOLLATION total pairs \(total)")
    for (k, v) in bad.sorted(by: { $0.key < $1.key }) { print("JSCOLLATION \(k): \(v)") }
    for s in samples { print("JSCOLLATION sample \(s)") }
  }
}
