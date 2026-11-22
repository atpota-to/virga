// TEMPORARY: measures LocaleCompare against core.collation. Deleted before commit.
import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct MeasureLocaleCompareTmp {
  @Test func measure() throws {
    var bad: [String: Int] = [:]
    var total = 0
    var samples: [String] = []
    for c in try Parity.cases("core.collation", fn: "localeCompare") {
      let fam = String(c.id.split(separator: "#")[0])
      let a = c["a"].arrayValue ?? []
      let b = c["b"].arrayValue ?? []
      let variant = c.output["variant"]?.arrayValue ?? []
      let base = c.output["base"]?.arrayValue ?? []
      for i in a.indices {
        let x = a[i].stringValue ?? "", y = b[i].stringValue ?? ""
        total += 1
        for locale in [nil] + AppLocale.localeChoices.map { Optional($0) } {
          let v = LocaleCompare.compare(x, y, locale: locale ?? "en-US")
          let s = LocaleCompare.compare(x, y, locale: locale ?? "en-US", sensitivity: .base)
          if Double(v) != variant[i].doubleValue { bad["\(fam).variant", default: 0] += 1; if samples.count < 60 && locale == nil { samples.append("V \(fam) \(x.debugDescription) \(y.debugDescription) got \(v) want \(variant[i])") } }
          if Double(s) != base[i].doubleValue { bad["\(fam).base", default: 0] += 1; if samples.count < 60 && locale == nil { samples.append("B \(fam) \(x.debugDescription) \(y.debugDescription) got \(s) want \(base[i])") } }
        }
      }
    }
    print("LOCALECOMPARE total pairs \(total) (x7 locales)")
    for (k, v) in bad.sorted(by: { $0.key < $1.key }) { print("LOCALECOMPARE \(k): \(v)") }
    for s in samples { print("LOCALECOMPARE sample \(s)") }
  }
}
