// Canonical JSON and digests, for parity fixtures of values too big to keep
// whole: the Swift side of ios/parity/cases/_canonical.js.
//
// `text` is JSON.stringify's text with every object's keys sorted by UTF-16
// code unit and no whitespace (numbers as JavaScript writes them, strings
// escaped as JSON.stringify escapes them). A part of a big value is recorded
// as its count, the SHA-256 of that text and a few whole items, so a port is
// held to every byte while a failure still shows a readable item.
//
// Iterative, not recursive: a test thread on iOS has 512 KB of stack.

import Foundation
import VirgaCore

public enum CanonicalJSON {
  private enum Item {
    case value(JSONValue)
    case literal(String)
  }

  /// The canonical text of a value.
  public static func text(_ value: JSONValue) -> String {
    var out = ""
    var stack: [Item] = [.value(value)]
    while let item = stack.popLast() {
      switch item {
      case .literal(let text):
        out += text
      case .value(let value):
        switch value {
        case .null: out += "null"
        case .bool(let flag): out += flag ? "true" : "false"
        case .number(let number): out += number.isFinite ? JSNumber.format(number) : "null"
        case .string(let string): out += string.jsJSONQuoted
        case .array(let items):
          out += "["
          stack.append(.literal("]"))
          for (index, element) in items.enumerated().reversed() {
            stack.append(.value(element))
            if index > 0 { stack.append(.literal(",")) }
          }
        case .object(let members):
          out += "{"
          stack.append(.literal("}"))
          let keys = members.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
          for (index, key) in keys.enumerated().reversed() {
            stack.append(.value(members[key]!))
            stack.append(.literal(key.jsJSONQuoted + ":"))
            if index > 0 { stack.append(.literal(",")) }
          }
        }
      }
    }
    return out
  }

  /// SHA-256 of the canonical text, in hex.
  public static func sha256(_ value: JSONValue) -> String {
    SHA256.hex(SHA256.hash(text(value)))
  }

  /// SHA-256 of bytes, in hex.
  public static func sha256(bytes: [UInt8]) -> String {
    SHA256.hex(SHA256.hash(bytes))
  }

  /// Lists whose canonical text is at most this many UTF-16 code units are kept whole.
  public static let wholeLimit = 6000
  static let sampleListLimit = 12

  /// The first two, the middle and the last of a list of `n`.
  public static func sampleIndexes(_ n: Int) -> [Int] {
    var out: [Int] = []
    for i in [0, 1, n / 2, n - 1] where i >= 0 && i < n && !out.contains(i) { out.append(i) }
    return out
  }

  /// A list as a fixture holds it: `{ count, sha256, items }` when short,
  /// `{ count, sha256, samples: [{ index, item }] }` otherwise, as
  /// _canonical.js's `part` writes it.
  public static func part(_ items: [JSONValue]) -> JSONValue {
    let canonical = text(.array(items))
    var out: [String: JSONValue] = [
      "count": .number(Double(items.count)),
      "sha256": .string(SHA256.hex(SHA256.hash(canonical))),
    ]
    if canonical.utf16.count <= wholeLimit {
      out["items"] = .array(items)
    } else {
      out["samples"] = .array(
        sampleIndexes(items.count).map { index in
          ["index": .number(Double(index)), "item": shallow(items[index])]
        })
    }
    return .object(out)
  }

  /// `part` of any encodable list.
  public static func part<T: Encodable>(encoding items: [T]) throws -> JSONValue {
    guard case .array(let values) = try JSONValue(encoding: items) else { return part([]) }
    return part(values)
  }

  private static func shallow(_ item: JSONValue) -> JSONValue {
    guard case .object(let members) = item else { return item }
    return .object(
      members.mapValues { member in
        if case .array(let list) = member, list.count > sampleListLimit { return ["$part": part(list)] }
        return member
      })
  }
}
