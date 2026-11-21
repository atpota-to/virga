// Helpers for the archive's tests: reading a case's zone, locale and the
// numbers JSON can't carry, and comparing numbers exactly (epoch
// milliseconds are where an off-by-a-second port would hide inside
// Parity.diff's relative 1e-9).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaArchive

extension ParityCase {
  /// The case's zone (`zone`), UTC by default.
  var zone: TimeZone {
    self["zone"].stringValue.flatMap(TimeZone.init(identifier:)) ?? TimeZone(identifier: "UTC")!
  }

  /// The case's locale (`locale`), en-US by default.
  var locale: String { self["locale"].stringValue ?? "en-US" }

  /// The case's first day of the week (`weekStart`), Monday by default.
  var weekStart: Int { self["weekStart"].intValue ?? 1 }

  /// Whether the input names `key` at all (JSON drops undefined).
  func has(_ key: String) -> Bool { input[key] != nil }

  /// A number argument as the web code got it: '$NaN', '$Infinity' and
  /// '$-Infinity' are those numbers, an absent one is undefined (NaN when
  /// read as a number), and null is null (0 when read as a number).
  func number(_ key: String) -> Double {
    num(input[key])
  }

  /// A number that may be null or absent (`?? fallback`).
  func optionalNumber(_ key: String) -> Double? {
    guard let value = input[key], !value.isNull else { return nil }
    return num(value)
  }
}

/// A number from a case, with the markers read back.
func num(_ value: JSONValue?) -> Double {
  switch value {
  case .none: return .nan
  case .some(.string("$NaN")): return .nan
  case .some(.string("$Infinity")): return .infinity
  case .some(.string("$-Infinity")): return -.infinity
  case .some(.null): return 0
  case .some(let other): return other.jsNumber
  }
}

/// A value with the markers read back (deeply), as the generator hands it
/// to the web code. NaN and ±Infinity stay numbers.
func markers(_ value: JSONValue) -> JSONValue {
  switch value {
  case .string("$NaN"): return .number(.nan)
  case .string("$Infinity"): return .number(.infinity)
  case .string("$-Infinity"): return .number(-.infinity)
  case .array(let items): return .array(items.map(markers))
  case .object(let members): return .object(members.mapValues(markers))
  default: return value
  }
}

/// A Swift number as the fixture writer records it: NaN and ±Infinity as null.
func js(_ value: Double?) -> JSONValue {
  guard let value, value.isFinite else { return .null }
  return .number(value == 0 ? 0 : value)
}

/// A value as the fixture writer records it, deeply (non-finite numbers null).
func recorded(_ value: JSONValue) -> JSONValue {
  switch value {
  case .number(let n): return js(n)
  case .array(let items): return .array(items.map(recorded))
  case .object(let members): return .object(members.mapValues(recorded))
  default: return value
  }
}

/// An Encodable value as JSON, as the fixture writer records it.
func encoded<T: Encodable>(_ value: T) -> JSONValue {
  do {
    return recorded(try JSONValue(encoding: value))
  } catch {
    return ["$encodingFailed": .string("\(error)")]
  }
}

/// `Parity.diff`, then every number compared exactly.
func exactDiff(_ actual: JSONValue, _ expected: JSONValue, strictNulls: Bool = false) -> String? {
  if let loose = Parity.diff(actual, expected, strictNulls: strictNulls) { return loose }
  return numbersDiffer(actual, expected, path: "$")
}

private func numbersDiffer(_ actual: JSONValue, _ expected: JSONValue, path: String) -> String? {
  // An explicit stack: fixtures can nest deeply.
  var stack: [(JSONValue, JSONValue, String)] = [(actual, expected, path)]
  while let (a, b, path) = stack.popLast() {
    switch (a, b) {
    case (.number(let x), .number(let y)):
      if x != y { return "\(path): \(JSNumber.format(x)) ≠ expected \(JSNumber.format(y)) (exactly)" }
    case (.object(let x), .object(let y)):
      for key in Set(x.keys).intersection(y.keys).sorted().reversed() { stack.append((x[key]!, y[key]!, "\(path).\(key)")) }
    case (.array(let x), .array(let y)):
      for (index, pair) in zip(x, y).enumerated().reversed() { stack.append((pair.0, pair.1, "\(path)[\(index)]")) }
    default:
      continue
    }
  }
  return nil
}

/// The outcome of a throwing computation as a fixture records it.
func outcome(_ body: () throws -> JSONValue) -> JSONValue {
  do {
    return try body()
  } catch {
    return ["$throws": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")]
  }
}

/// A row list from a case's JSON.
func rows<T: ArchiveRecord>(_ value: JSONValue?, as type: T.Type = T.self) -> [T]? {
  guard case .array(let items)? = value else { return nil }
  return items.compactMap { T(json: $0) }
}

/// Rows as JSON.
func json<T: ArchiveRecord>(_ rows: [T]) -> JSONValue {
  .array(rows.map(\.json))
}

/// Runs a check over every case of `fn` in `fixture`.
func forEachCase(
  _ fixture: String, _ fn: String, sourceLocation: SourceLocation = #_sourceLocation,
  _ actual: (ParityCase) throws -> JSONValue
) throws {
  for c in try Parity.cases(fixture, fn: fn) {
    let value = outcome { try actual(c) }
    let d = exactDiff(value, c.output)
    #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
  }
}
