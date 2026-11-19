// Small helpers the insights parity tests share.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport

/// A value as JSON, through its Codable conformance.
func encoded<T: Encodable>(_ value: T) -> JSONValue {
  do {
    return try JSONValue(encoding: value)
  } catch {
    Issue.record("could not encode \(value): \(error)")
    return .null
  }
}

/// An optional value as JSON: null for nil.
func encoded<T: Encodable>(_ value: T?) -> JSONValue {
  value.map { encoded($0) } ?? .null
}

/// What a call gives, or `{ "$throws": message }` when it throws, as the
/// generators record a web function that throws.
func outcome(_ body: () throws -> JSONValue) -> JSONValue {
  do {
    return try body()
  } catch {
    return ["$throws": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")]
  }
}

/// The strings of a JSON array.
func strings(_ value: JSONValue) -> [String] {
  (value.arrayValue ?? []).compactMap(\.stringValue)
}

/// Decodes a fixture input, recording a failure (and returning nil) when it
/// doesn't decode.
func decoded<T: Decodable>(_ value: JSONValue, as type: T.Type, _ c: ParityCase) -> T? {
  do {
    return try value.decode(T.self)
  } catch {
    Issue.record("\(c): input doesn't decode as \(T.self): \(error)")
    return nil
  }
}

/// Expects `actual` to be the case's output: `Parity.diff`, and every
/// string the same scalar for scalar (`scalarDiff`).
func expectOutput(
  _ actual: JSONValue, _ c: ParityCase, strictNulls: Bool = false, sourceLocation: SourceLocation = #_sourceLocation
) {
  let d = exactDiff(actual, c.output, strictNulls: strictNulls)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
}

/// `Parity.diff`, then `scalarDiff`.
func exactDiff(_ actual: JSONValue, _ expected: JSONValue, strictNulls: Bool = false) -> String? {
  Parity.diff(actual, expected, strictNulls: strictNulls) ?? scalarDiff(actual, expected)
}

/// Where a string in `actual` differs from the one in the same place in
/// `expected` scalar for scalar, or nil. Swift's `==` on strings (and so on
/// JSONValue) is canonical equivalence: "é" equals "e\u{301}", which
/// JavaScript's === doesn't. Folding, slicing and trimming must give the
/// web's very scalars, so this holds them to it. Only strings are checked;
/// the rest is `Parity.diff`'s.
func scalarDiff(_ actual: JSONValue, _ expected: JSONValue, path: String = "$") -> String? {
  switch (actual, expected) {
  case (.string(let a), .string(let b)):
    if a.unicodeScalars.elementsEqual(b.unicodeScalars) { return nil }
    let hex = { (s: String) in s.unicodeScalars.map { String($0.value, radix: 16) }.joined(separator: " ") }
    return "\(path): scalars \(hex(a)) ≠ expected \(hex(b))"
  case (.array(let a), .array(let b)):
    for (index, pair) in zip(a, b).enumerated() {
      if let d = scalarDiff(pair.0, pair.1, path: "\(path)[\(index)]") { return d }
    }
    return nil
  case (.object(let a), .object(let b)):
    for key in a.keys.sorted() {
      // Dictionary keys match by canonical equivalence too.
      guard let other = b.keys.first(where: { $0 == key }) else { continue }
      if !key.unicodeScalars.elementsEqual(other.unicodeScalars) {
        return "\(path): key \(key.debugDescription) is not, scalar for scalar, the expected \(other.debugDescription)"
      }
      if let d = scalarDiff(a[key]!, b[other]!, path: "\(path).\(key)") { return d }
    }
    return nil
  default:
    return nil
  }
}

@Suite struct ScalarDiffTests {
  @Test func canonicallyEquivalentStringsAreNotTheSame() {
    let composed: JSONValue = .string("caf\u{E9}")
    let decomposed: JSONValue = .string("cafe\u{301}")
    #expect(composed == decomposed, "Swift's == is canonical equivalence")
    #expect(Parity.diff(composed, decomposed) == nil, "so Parity.diff alone lets this through")
    #expect(scalarDiff(composed, decomposed) != nil)
    #expect(scalarDiff(["a": [composed]], ["a": [decomposed]]) != nil)
    #expect(scalarDiff([.string("x")], [.string("x")]) == nil)
    #expect(scalarDiff(["caf\u{E9}": 1], ["cafe\u{301}": 1]) != nil, "keys too")
  }
}
