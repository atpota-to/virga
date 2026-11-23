// JSCompat against real JavaScript (ios/parity/cases/core.jscompat.js).

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

@Suite struct JSCompatParity {
  private func check(_ fn: String, _ body: (ParityCase) -> JSONValue) throws {
    for c in try Parity.cases("core.jscompat", fn: fn) {
      let diff = Parity.diff(body(c), c.output)
      #expect(diff == nil, "\(c): \(diff ?? "")")
    }
  }

  @Test func length() throws {
    try check("length") { .number(Double(($0["s"].stringValue ?? "").jsLength)) }
  }

  @Test func slice() throws {
    try check("slice") { c in
      .string((c["s"].stringValue ?? "").jsSlice(c["start"].intValue ?? 0, c["end"].intValue))
    }
  }

  @Test func substring() throws {
    try check("substring") { c in
      .string((c["s"].stringValue ?? "").jsSubstring(c["start"].intValue ?? 0, c["end"].intValue))
    }
  }

  @Test func indexOf() throws {
    try check("indexOf") { c in
      .number(Double((c["s"].stringValue ?? "").jsIndexOf(c["search"].stringValue ?? "", from: c["from"].intValue ?? 0)))
    }
  }

  @Test func lastIndexOf() throws {
    try check("lastIndexOf") { c in
      .number(Double((c["s"].stringValue ?? "").jsLastIndexOf(c["search"].stringValue ?? "")))
    }
  }

  @Test func trim() throws {
    try check("trim") { .string(($0["s"].stringValue ?? "").jsTrimmed()) }
    try check("trimStart") { .string(($0["s"].stringValue ?? "").jsTrimmingStart()) }
    try check("trimEnd") { .string(($0["s"].stringValue ?? "").jsTrimmingEnd()) }
  }

  @Test func utf8Offset() throws {
    try check("utf8Offset") { c in
      .number(Double((c["s"].stringValue ?? "").utf8Offset(ofUTF16: c["index"].intValue ?? 0)))
    }
  }

  @Test func toFixed() throws {
    try check("toFixed") { c in
      .string((c["n"].doubleValue ?? 0).jsToFixed(c["digits"].intValue ?? 0))
    }
  }

  @Test func round() throws {
    try check("round") { .number(($0["n"].doubleValue ?? 0).jsRounded + 0) }
  }

  @Test func numberString() throws {
    try check("numberString") { .string(JSNumber.format($0["n"].doubleValue ?? 0)) }
  }
}
