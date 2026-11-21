// Ports src/posting/templates/postTemplates.js
//
// The bits of JavaScript the template modules lean on, for loosely typed
// values: `String(v || '')`, `typeof v === 'string' ? v.trim() : ''`,
// `a === b` between values of any type, `(v || [])` as a list, and
// `array.slice(0, n)`. Internal to VirgaPosting.

import Foundation
import VirgaCore

enum TemplateJS {
  /// `String(v || '')`: '' for a falsy value, else its String form.
  static func orEmpty(_ value: JSONValue?) -> String {
    guard let value, value.isTruthy else { return "" }
    return value.jsString
  }

  /// `typeof v === 'string' ? v.trim() : ''`.
  static func clean(_ value: JSONValue?) -> String {
    value?.stringValue?.jsTrimmed() ?? ""
  }

  /// `typeof v === 'string' ? v : ''`.
  static func str(_ value: JSONValue?) -> String {
    value?.stringValue ?? ""
  }

  /// `String(v)`, where an absent value is "undefined".
  static func string(_ value: JSONValue?) -> String {
    value.map(\.jsString) ?? "undefined"
  }

  /// A truthy value as a string: itself, or its String form. nil for a
  /// falsy one. Where the web passes such a value through into text.
  static func text(_ value: JSONValue?) -> String? {
    guard let value, value.isTruthy else { return nil }
    return value.stringValue ?? value.jsString
  }

  /// `a === b`. Absent (undefined) equals only absent; objects and arrays
  /// never equal one another (each JSON value is its own object); strings
  /// by code unit; NaN equals nothing.
  static func strictEquals(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case (.some(.null), .some(.null)): return true
    case (.some(.bool(let x)), .some(.bool(let y))): return x == y
    case (.some(.number(let x)), .some(.number(let y))): return x == y
    case (.some(.string(let x)), .some(.string(let y))): return x.jsEquals(y)
    default: return false
    }
  }

  /// `(v || [])` walked as a list: an array's items. A truthy value of
  /// another type reads as no items (where the web would mostly throw a
  /// TypeError calling `.map` on it, or walk a string's characters to no
  /// effect).
  static func list(_ value: JSONValue?) -> [JSONValue] {
    value?.arrayValue ?? []
  }

  /// `array.slice(0, n)`.
  static func prefix<T>(_ items: [T], _ n: Int) -> [T] {
    let end = n < 0 ? max(0, items.count + n) : min(n, items.count)
    return Array(items[0..<end])
  }

  /// `text.startsWith(prefix)`, by code unit.
  static func startsWith(_ text: String, _ prefix: String) -> Bool {
    text.utf16.starts(with: prefix.utf16)
  }

  /// `text.split(separator)` on a one-code-unit separator.
  static func split(_ text: String, on separator: UInt16) -> [String] {
    var pieces: [String] = []
    var current: [UInt16] = []
    for unit in text.utf16 {
      if unit == separator {
        pieces.append(String(jsUnits: current))
        current = []
      } else {
        current.append(unit)
      }
    }
    pieces.append(String(jsUnits: current))
    return pieces
  }

  /// `String(uri || '').split('/').pop() || ''`.
  static func rkeyOf(_ uri: JSONValue?) -> String {
    split(orEmpty(uri), on: 0x2F).last ?? ""
  }

  /// A JavaScript array index key ("0", "17"; below 2^32 − 1), which an
  /// object lists first, in ascending order.
  static func isArrayIndex(_ key: String) -> Bool {
    let units = Array(key.utf8)
    guard !units.isEmpty, units.count <= 10, units.allSatisfy({ (0x30...0x39).contains($0) }) else { return false }
    if units.count > 1 && units[0] == 0x30 { return false }
    return (UInt64(key) ?? .max) < 4_294_967_295
  }

  /// The match of group `index`, as a string.
  static func group(_ match: JSRegex.Match, _ index: Int, _ units: [UInt16]) -> String? {
    match.group(index, in: units)
  }
}
