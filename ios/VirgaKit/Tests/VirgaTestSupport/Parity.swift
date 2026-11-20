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
    // An explicit stack, not recursion: fixtures nest deeply (JSON.parse's,
    // DAG-CBOR's), and a recursive walk overflowed the small stacks Swift
    // concurrency's threads have on iOS, taking the whole test process
    // down. Children are pushed in reverse, so the walk is the same
    // depth-first order as a recursive one and the first difference
    // reported is the same.
    enum Item {
      case pair(JSONValue, JSONValue, String)
      case oneSided(String)
    }
    var stack: [Item] = [.pair(actual, expected, path)]
    while let item = stack.popLast() {
      guard case .pair(let actual, let expected, let path) = item else {
        if case .oneSided(let path) = item { return "\(path): present on one side only" }
        continue
      }
      switch (actual, expected) {
      case (.number(let a), .number(let b)):
        if a == b { continue }
        let scale = Swift.max(1, abs(a), abs(b))
        if abs(a - b) > 1e-9 * scale { return "\(path): \(a) ≠ expected \(b)" }
      case (.object(let a), .object(let b)):
        // Dictionary keys match by canonical equivalence; JavaScript's keys
        // by code unit.
        for key in a.keys.sorted() where b[key] != nil {
          if !b.keys.contains(where: { $0.jsEquals(key) }) {
            return "\(path): key \(key.debugDescription) is not, code unit for code unit, the expected key"
          }
        }
        var children: [Item] = []
        for key in Set(a.keys).union(b.keys).sorted() {
          if strictNulls, (a[key] == nil) != (b[key] == nil) {
            children.append(.oneSided("\(path).\(key)"))
          } else {
            children.append(.pair(a[key] ?? .null, b[key] ?? .null, "\(path).\(key)"))
          }
        }
        stack.append(contentsOf: children.reversed())
      case (.array(let a), .array(let b)):
        if a.count != b.count {
          return "\(path): \(a.count) elements ≠ expected \(b.count)\n  actual:   \(short(actual))\n  expected: \(short(expected))"
        }
        for index in a.indices.reversed() {
          stack.append(.pair(a[index], b[index], "\(path)[\(index)]"))
        }
      case (.string(let a), .string(let b)):
        // By UTF-16 code unit, as JavaScript compares strings. Swift's
        // String == is canonical equivalence, which would let an NFC/NFD
        // difference (or the Kelvin sign for K) through.
        if !a.jsEquals(b) { return "\(path): \(short(actual)) ≠ expected \(short(expected))" }
      case (.null, .null):
        continue
      case (.bool(let a), .bool(let b)):
        if a != b { return "\(path): \(short(actual)) ≠ expected \(short(expected))" }
      default:
        // Different kinds of value.
        return "\(path): \(short(actual)) ≠ expected \(short(expected))"
      }
    }
    return nil
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

  /// A preview of `value` for a failure message: JSON, at most 400
  /// characters, written with an explicit stack (a deep value's jsonString
  /// would recurse as deep as it nests).
  private static func short(_ value: JSONValue) -> String {
    enum Token {
      case value(JSONValue)
      case text(String)
    }
    let limit = 400
    var out = ""
    var stack: [Token] = [.value(value)]
    while let token = stack.popLast(), out.count <= limit {
      switch token {
      case .text(let text):
        out += text
      case .value(let value):
        switch value {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let n): out += JSNumber.format(n)
        case .string(let text): out += text.jsJSONQuoted
        case .array(let items):
          out += "["
          stack.append(.text("]"))
          for index in items.indices.reversed() {
            stack.append(.value(items[index]))
            if index > 0 { stack.append(.text(",")) }
          }
        case .object(let members):
          out += "{"
          stack.append(.text("}"))
          let keys = members.keys.sorted()
          for (index, key) in keys.enumerated().reversed() {
            stack.append(.value(members[key]!))
            stack.append(.text(key.jsJSONQuoted + ":"))
            if index > 0 { stack.append(.text(",")) }
          }
        }
      }
    }
    return out.count > limit || !stack.isEmpty ? String(out.prefix(limit)) + "…" : out
  }
}
