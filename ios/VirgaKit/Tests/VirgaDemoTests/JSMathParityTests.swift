// Parity with V8 for the arithmetic and sorting the demo worlds lean on:
// `x ** y`, `Math.sin` and `array.sort` with comparators that never say
// "equal", against ios/parity/fixtures/demo-world.jsmath.json. Doubles are
// compared as bit patterns.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct JSMathParity {
  static let fixture = "demo-world.jsmath"

  static func double(_ hex: JSONValue?) -> Double {
    Double(bitPattern: UInt64(hex?.stringValue ?? "", radix: 16) ?? 0)
  }

  static func hex(_ x: Double) -> String {
    let s = String(x.bitPattern, radix: 16)
    return String(repeating: "0", count: 16 - s.count) + s
  }

  /// The same double, bit for bit; any NaN is every NaN (JavaScript can't
  /// tell them apart, and V8 doesn't keep a NaN's payload the same way).
  static func same(_ got: Double, _ want: JSONValue) -> Bool {
    let expected = double(want)
    return got.bitPattern == expected.bitPattern || (got.isNaN && expected.isNaN)
  }

  @Test func pow() throws {
    for c in try Parity.cases(Self.fixture, fn: "pow") {
      let pairs = c["pairs"].arrayValue ?? []
      let expected = c.output.arrayValue ?? []
      #expect(pairs.count == expected.count)
      var wrong: [String] = []
      for (pair, want) in zip(pairs, expected) {
        let x = Self.double(pair[0]), y = Self.double(pair[1])
        let got = JSMath.pow(x, y)
        if !Self.same(got, want) { wrong.append("pow(\(x), \(y)) = \(Self.hex(got)), V8 \(want.stringValue ?? "")") }
      }
      #expect(wrong.isEmpty, "\(c): \(wrong.count) differ, e.g. \(wrong.prefix(3))")
    }
  }

  @Test func sin() throws {
    for c in try Parity.cases(Self.fixture, fn: "sin") {
      let xs = c["xs"].arrayValue ?? []
      let expected = c.output.arrayValue ?? []
      #expect(xs.count == expected.count)
      var wrong: [String] = []
      for (x, want) in zip(xs, expected) {
        let value = Self.double(x)
        let got = JSMath.sin(value)
        if !Self.same(got, want) { wrong.append("sin(\(value)) = \(Self.hex(got)), V8 \(want.stringValue ?? "")") }
      }
      #expect(wrong.isEmpty, "\(c): \(wrong.count) differ, e.g. \(wrong.prefix(3))")
    }
  }

  @Test func sort() throws {
    for c in try Parity.cases(Self.fixture, fn: "sort") {
      let n = c["n"].intValue ?? 0
      let mode = c["mode"].stringValue ?? ""
      var rr = World.mulberry(Double(n * 7 + mode.utf16.count))
      let items: [(id: Int, k: Double)] = (0..<n).map { i in
        (i, mode == "random" ? 0 : (rr() * (Double(n) / 4 + 1)).rounded(.down))
      }
      var answers = World.mulberry(Double(n + 1000))
      var calls = 0
      var h: Int32 = 0
      let sorted = items.jsSorted { a, b in
        calls += 1
        h = (h &* 31) &+ Int32(a.id * 100_000 + b.id)
        if mode == "random" {
          let v = answers()
          return v < 0.45 ? -1 : v < 0.55 ? 0 : 1
        }
        if mode == "ties" { return a.k < b.k ? 1 : -1 }
        return a.k < b.k ? -1 : a.k > b.k ? 1 : 0
      }
      let order = JSONValue.array(sorted.map { .number(Double($0.id)) })
      var actual: [String: JSONValue] = ["calls": .number(Double(calls)), "callHash": .number(Double(h))]
      if n <= 200 { actual["order"] = order } else { actual["orderSha256"] = .string(CanonicalJSON.sha256(order)) }
      let d = Exact.diff(.object(actual), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func sortHandlesTheComparatorsSpecialAnswers() {
    // NaN reads as 0 (equal), so the stable order holds.
    let sorted = [3, 1, 2].jsSorted { _, _ in .nan }
    #expect(sorted == [3, 1, 2])
    #expect([Int]().jsSorted { _, _ in 1 } == [])
    var inPlace = [5, 4, 3, 2, 1]
    inPlace.jsSort { a, b in Double(a - b) }
    #expect(inPlace == [1, 2, 3, 4, 5])
  }

  @Test func int32Conversions() {
    #expect(JSMath.toInt32(4_294_967_301) == 5)
    #expect(JSMath.toInt32(-1) == -1)
    #expect(JSMath.toInt32(2_147_483_648) == Int32.min)
    #expect(JSMath.toInt32(.nan) == 0)
    #expect(JSMath.toInt32(.infinity) == 0)
    #expect(JSMath.toInt32(-0.9) == 0)
    #expect(JSMath.toUint8(300) == 44)
    #expect(JSMath.toUint8(-1) == 255)
    #expect(JSMath.min(0, -0.0).sign == .minus)
    #expect(JSMath.max(-0.0, 0).sign == .plus)
    #expect(JSMath.min(1, .nan).isNaN)
  }
}
