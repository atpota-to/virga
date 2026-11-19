// Loads the parity fixtures in ios/parity/fixtures/ and compares JSON.
//
// The fixtures are written by the web app's own code (ios/parity/cases/*.js,
// run with `npm run parity:write`), so a Swift test that passes them computes
// what the web app computes. See ios/parity/README.md.
//
// Not a test target and does not import Testing, so it links anywhere; tests
// turn a non-nil `diff` into a failure with `#expect(diff == nil, ...)`.

import Foundation
import VirgaCore

public struct ParityFixture: Decodable, Sendable {
  public let name: String
  public let sources: [String]
  public let cases: [ParityCase]
}

public struct ParityCase: Decodable, Sendable, CustomStringConvertible {
  public let id: String
  public let fn: String
  public let input: JSONValue
  public let output: JSONValue

  /// A named argument of the input.
  public subscript(key: String) -> JSONValue {
    input[key] ?? .null
  }

  public var description: String { "\(fn) [\(id)]" }
}

public enum ParityError: Error, CustomStringConvertible {
  case missingFixture(String)
  case noCases(fixture: String, fn: String)

  public var description: String {
    switch self {
    case .missingFixture(let path):
      return "No parity fixture at \(path). Run `npm run parity:write` at the repository root."
    case .noCases(let fixture, let fn):
      return "Fixture \(fixture) has no cases for \(fn). Was the case generator renamed?"
    }
  }
}

public enum Parity {
  /// ios/parity/fixtures, found from this file's own path (or
  /// VIRGA_PARITY_DIR). Works under `swift test` on Linux and macOS and in the
  /// iOS Simulator, which shares the Mac's file system.
  public static var fixturesDirectory: URL {
    if let override = ProcessInfo.processInfo.environment["VIRGA_PARITY_DIR"], !override.isEmpty {
      return URL(fileURLWithPath: override, isDirectory: true)
    }
    // .../ios/VirgaKit/Tests/VirgaTestSupport/Parity.swift → .../ios/parity/fixtures
    return URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // VirgaTestSupport
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // VirgaKit
      .deletingLastPathComponent()  // ios
      .appendingPathComponent("parity/fixtures", isDirectory: true)
  }

  /// The fixture written by ios/parity/cases/<name>.js.
  public static func load(_ name: String) throws -> ParityFixture {
    let url = fixturesDirectory.appendingPathComponent("\(name).json")
    guard let data = try? Data(contentsOf: url) else { throw ParityError.missingFixture(url.path) }
    return try JSONDecoder().decode(ParityFixture.self, from: data)
  }

  /// The cases of one function in a fixture. Throws when there are none, so
  /// a renamed generator can't leave a Swift test passing over nothing.
  public static func cases(_ name: String, fn: String) throws -> [ParityCase] {
    let found = try load(name).cases.filter { $0.fn == fn }
    if found.isEmpty { throw ParityError.noCases(fixture: name, fn: fn) }
    return found
  }

  /// Every function name a fixture has cases for.
  public static func functions(_ name: String) throws -> Set<String> {
    Set(try load(name).cases.map(\.fn))
  }

  /// Where `actual` differs from `expected`, or nil when they match.
  ///
  /// - Numbers match within a relative 1e-9 (JavaScript and Swift can round
  ///   the last bit of a float differently).
  /// - Strings match by UTF-16 code unit, as JavaScript's `===` does, not by
  ///   Swift's canonical equivalence.
  /// - A missing member matches `null` (JSON.stringify drops `undefined`,
  ///   and Swift's encoders drop nil), unless `strictNulls` is set.
  public static func diff(
    _ actual: JSONValue,
    _ expected: JSONValue,
    path: String = "$",
    strictNulls: Bool = false
  ) -> String? {
    switch (actual, expected) {
    case (.number(let a), .number(let b)):
      if a == b { return nil }
      let scale = Swift.max(1, abs(a), abs(b))
      return abs(a - b) <= 1e-9 * scale ? nil : "\(path): \(a) ≠ expected \(b)"
    case (.object(let a), .object(let b)):
      // Dictionary keys match by canonical equivalence; JavaScript's keys by
      // code unit.
      for key in a.keys.sorted() where b[key] != nil {
        if !b.keys.contains(where: { $0.jsEquals(key) }) {
          return "\(path): key \(key.debugDescription) is not, code unit for code unit, the expected key"
        }
      }
      for key in Set(a.keys).union(b.keys).sorted() {
        let left = a[key] ?? .null
        let right = b[key] ?? .null
        if strictNulls, (a[key] == nil) != (b[key] == nil) {
          return "\(path).\(key): present on one side only"
        }
        if let difference = diff(left, right, path: "\(path).\(key)", strictNulls: strictNulls) {
          return difference
        }
      }
      return nil
    case (.array(let a), .array(let b)):
      if a.count != b.count {
        return "\(path): \(a.count) elements ≠ expected \(b.count)\n  actual:   \(short(actual))\n  expected: \(short(expected))"
      }
      for (index, pair) in zip(a, b).enumerated() {
        if let difference = diff(pair.0, pair.1, path: "\(path)[\(index)]", strictNulls: strictNulls) {
          return difference
        }
      }
      return nil
    case (.string(let a), .string(let b)):
      // By UTF-16 code unit, as JavaScript compares strings. Swift's String
      // == is canonical equivalence, which would let an NFC/NFD difference
      // (or the Kelvin sign for K) through.
      return a.jsEquals(b) ? nil : "\(path): \(short(actual)) ≠ expected \(short(expected))"
    default:
      return actual == expected ? nil : "\(path): \(short(actual)) ≠ expected \(short(expected))"
    }
  }

  /// `diff` for any Encodable value against a fixture's expected JSON.
  public static func diff<T: Encodable>(
    encoding actual: T,
    _ expected: JSONValue,
    encoder: JSONEncoder = JSONEncoder(),
    strictNulls: Bool = false
  ) -> String? {
    do {
      return diff(try JSONValue(encoding: actual, encoder: encoder), expected, strictNulls: strictNulls)
    } catch {
      return "could not encode actual value: \(error)"
    }
  }

  private static func short(_ value: JSONValue) -> String {
    let text = value.jsonString()
    return text.count > 400 ? String(text.prefix(400)) + "…" : text
  }
}
