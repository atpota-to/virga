// Parity.diff itself: deep values without recursion (a recursive walk
// overflowed the small stacks of Swift concurrency's threads on iOS and took
// the test process down), and the first difference in depth-first order.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport

@Suite struct ParityDiffBehaviour {
  static func nested(_ depth: Int, leaf: JSONValue) -> JSONValue {
    var value = leaf
    for level in 0..<depth { value = level % 2 == 0 ? [value] : ["k": value] }
    return value
  }

  @Test func deepValuesDontRecurse() {
    // Five times the deepest fixture (core.jsjson nests 205 levels); the
    // old recursive walk overflowed iOS's 512 KB thread stacks at about
    // that. Deeper than this, JSONValue itself recurses (an indirect
    // enum's release does), which is no longer Parity.diff's concern.
    let depth = 1_000
    #expect(Parity.diff(Self.nested(depth, leaf: 1), Self.nested(depth, leaf: 1)) == nil)
    let difference = Parity.diff(Self.nested(depth, leaf: 1), Self.nested(depth, leaf: 2))
    #expect(difference?.hasSuffix(": 1.0 ≠ expected 2.0") == true, "\(difference?.suffix(80) ?? "nil")")
  }

  @Test func theFirstDifferenceIsDepthFirst() {
    let actual: JSONValue = ["a": [1, ["x": 1]], "b": 1]
    let expected: JSONValue = ["a": [1, ["x": 2]], "b": 2]
    #expect(Parity.diff(actual, expected) == "$.a[1].x: 1.0 ≠ expected 2.0")
  }

  @Test func oneSidedMembersInKeyOrder() {
    let actual: JSONValue = ["a": 1, "c": 3]
    let expected: JSONValue = ["a": 2, "b": nil, "c": 3]
    #expect(Parity.diff(actual, expected, strictNulls: true) == "$.a: 1.0 ≠ expected 2.0")
    #expect(Parity.diff(["a": 1, "c": 3], ["a": 1, "b": nil, "c": 3], strictNulls: true) == "$.b: present on one side only")
    #expect(Parity.diff(["a": 1, "c": 3], ["a": 1, "b": nil, "c": 3]) == nil, "missing matches null by default")
  }

  @Test func kindsAndCounts() {
    #expect(Parity.diff([1, 2], [1]) != nil)
    #expect(Parity.diff(["a": [1]], ["a": "x"]) == "$.a: [1] ≠ expected \"x\"")
    #expect(Parity.diff(true, false) != nil)
    #expect(Parity.diff(nil, nil) == nil)
    #expect(Parity.diff(.number(0.1 + 0.2), .number(0.3)) == nil, "within a relative 1e-9")
  }
}
