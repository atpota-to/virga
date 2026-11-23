// Ports harness/world.js, harness/crowd.js, harness/repo.js, harness/views.js:
// the string, array and collection behaviour they lean on, as JavaScript has
// it.
//
// The harness compares and sorts keys with `<` (UTF-16 code units), splits
// URIs with `split('/')`, keeps what the page wrote in a `Map` (insertion
// order, keys equal only code unit for code unit) and slices pages with
// `Array.prototype.slice`, whose arguments may be anything a query string
// gives. Swift's String comparison, `split` and Dictionary differ from each
// of those somewhere (ios/PORTING.md, "Strings compare by code unit"), so
// these do it JavaScript's way.

import Foundation
import VirgaCore

extension String {
  /// `a < b` for strings: by UTF-16 code unit.
  func jsLess(_ other: String) -> Bool {
    utf16.lexicographicallyPrecedes(other.utf16)
  }

  /// `str.startsWith(prefix)`, by code unit.
  func jsHasPrefix(_ prefix: String) -> Bool {
    utf16.starts(with: prefix.utf16)
  }

  /// `str.includes(search)`, by code unit.
  func jsContains(_ search: String) -> Bool {
    jsIndexOf(search) >= 0
  }

  /// `str.split(separator)` for a non-empty string separator: every piece,
  /// empty ones included, cut by code unit.
  func jsSplit(_ separator: String) -> [String] {
    let units = Array(utf16)
    let sep = Array(separator.utf16)
    precondition(!sep.isEmpty, "jsSplit needs a separator")
    var pieces: [String] = []
    var start = 0
    var i = 0
    while i + sep.count <= units.count {
      if units[i] == sep[0] && units[i..<(i + sep.count)].elementsEqual(sep) {
        pieces.append(String(jsUnits: units[start..<i]))
        i += sep.count
        start = i
      } else {
        i += 1
      }
    }
    pieces.append(String(jsUnits: units[start...]))
    return pieces
  }

  /// `str.replace(search, replacement)` with a string pattern: the first
  /// occurrence only. The replacement must not use `$` patterns.
  func jsReplacingFirst(_ search: String, with replacement: String) -> String {
    let at = jsIndexOf(search)
    guard at >= 0 else { return self }
    return jsSlice(0, at) + replacement + jsSlice(at + search.jsLength)
  }

  /// `String(n).padStart(width, '0')` for a non-negative integer.
  static func zeroPadded(_ n: Int, _ width: Int) -> String {
    let s = String(n)
    return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
  }
}

enum JSArray {
  /// ToIntegerOrInfinity: NaN is 0, everything else cut toward zero.
  static func toIntegerOrInfinity(_ x: Double) -> Double {
    if x.isNaN { return 0 }
    if x.isInfinite { return x }
    let t = x.rounded(.towardZero)
    return t == 0 ? 0 : t
  }

  /// `array.slice(start, end)`, with the arguments as numbers (an absent
  /// `end` is the length): negative ones count from the end.
  static func slice<T>(_ array: [T], _ start: Double, _ end: Double? = nil) -> [T] {
    let length = Double(array.count)
    func clamp(_ relative: Double) -> Int {
      if relative == -.infinity { return 0 }
      if relative < 0 { return Int(Swift.max(length + relative, 0)) }
      return Int(Swift.min(relative, length))
    }
    let from = clamp(toIntegerOrInfinity(start))
    let to = end.map { clamp(toIntegerOrInfinity($0)) } ?? array.count
    return from < to ? Array(array[from..<to]) : []
  }
}

/// A JavaScript `Map` with string keys: entries in insertion order (setting
/// an existing key keeps its place; deleting and setting again moves it to
/// the end), and keys equal only code unit for code unit.
///
/// Encodes as a JSON object, as the parity generators' `toJSON` writes a
/// Map with string keys.
public struct JSOrderedMap<Value>: Sendable where Value: Sendable {
  public private(set) var keys: [String] = []
  private var storage: [JSKey: Value] = [:]

  public init() {}

  public init(_ entries: [(String, Value)]) {
    for (key, value) in entries { self[key] = value }
  }

  public var count: Int { keys.count }
  public var isEmpty: Bool { keys.isEmpty }

  /// `map.get(key)`, or `map.set(key, value)` (nil deletes).
  public subscript(key: String) -> Value? {
    get { storage[JSKey(key)] }
    set {
      let k = JSKey(key)
      if let newValue {
        if storage.updateValue(newValue, forKey: k) == nil { keys.append(key) }
      } else if storage.removeValue(forKey: k) != nil {
        keys.removeAll { $0.jsEquals(key) }
      }
    }
  }

  /// `map.has(key)`.
  public func has(_ key: String) -> Bool { storage[JSKey(key)] != nil }

  /// `map.delete(key)`: whether there was one.
  @discardableResult
  public mutating func delete(_ key: String) -> Bool {
    guard has(key) else { return false }
    self[key] = nil
    return true
  }

  /// `[...map]`: the entries in order.
  public var entries: [(key: String, value: Value)] {
    keys.map { ($0, storage[JSKey($0)]!) }
  }

  public var values: [Value] { keys.map { storage[JSKey($0)]! } }
}

extension JSOrderedMap: Equatable where Value: Equatable {
  public static func == (a: Self, b: Self) -> Bool {
    a.keys.count == b.keys.count
      && zip(a.keys, b.keys).allSatisfy { $0.jsEquals($1) }
      && a.storage == b.storage
  }
}

extension JSOrderedMap: Hashable where Value: Hashable {
  public func hash(into hasher: inout Hasher) {
    hasher.combine(keys.count)
    for key in keys {
      hasher.combine(JSKey(key))
      hasher.combine(storage[JSKey(key)])
    }
  }
}

extension JSOrderedMap: Codable where Value: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: LexiconKey.self)
    self.init()
    for key in container.allKeys {
      self[key.stringValue] = try container.decode(Value.self, forKey: key)
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: LexiconKey.self)
    for (key, value) in entries {
      try container.encode(value, forKey: LexiconKey(key))
    }
  }
}

/// A JavaScript `Set` of strings: insertion order, code-unit equality.
/// Encodes as a JSON array.
public struct JSOrderedSet: Hashable, Sendable, Codable {
  public private(set) var elements: [String] = []
  private var members: Set<JSKey> = []

  public init() {}

  public init(_ elements: [String]) {
    for element in elements { add(element) }
  }

  public var count: Int { elements.count }
  public var isEmpty: Bool { elements.isEmpty }

  /// `set.has(value)`.
  public func has(_ value: String) -> Bool { members.contains(JSKey(value)) }

  /// `set.add(value)`.
  public mutating func add(_ value: String) {
    if members.insert(JSKey(value)).inserted { elements.append(value) }
  }

  /// `set.delete(value)`: whether it was there.
  @discardableResult
  public mutating func delete(_ value: String) -> Bool {
    guard members.remove(JSKey(value)) != nil else { return false }
    elements.removeAll { $0.jsEquals(value) }
    return true
  }

  public static func == (a: Self, b: Self) -> Bool {
    a.elements.count == b.elements.count && zip(a.elements, b.elements).allSatisfy { $0.jsEquals($1) }
  }

  public func hash(into hasher: inout Hasher) {
    hasher.combine(elements.count)
    for element in elements { hasher.combine(JSKey(element)) }
  }

  public init(from decoder: Decoder) throws {
    self.init(try [String](from: decoder))
  }

  public func encode(to encoder: Encoder) throws {
    try elements.encode(to: encoder)
  }
}

extension JSONValue {
  /// `{ ...value }`: an object's own members, an array's or a string's
  /// elements under their indexes, nothing for anything else.
  var jsSpread: [String: JSONValue] {
    switch self {
    case .object(let members): return members
    case .array(let items):
      var out: [String: JSONValue] = [:]
      for (i, item) in items.enumerated() { out[String(i)] = item }
      return out
    case .string(let text):
      var out: [String: JSONValue] = [:]
      for (i, unit) in text.utf16.enumerated() { out[String(i)] = .string(String(jsUnits: [unit])) }
      return out
    default: return [:]
    }
  }

  /// The number as JSON carries it: NaN and ±Infinity are null.
  static func jsNumber(_ value: Double) -> JSONValue {
    value.isFinite ? .number(value) : .null
  }
}

extension Optional where Wrapped == JSONValue {
  /// The value when JavaScript reads it as true, else nil: `value || fallback`
  /// is `value.jsTruthy ?? fallback`. (Not `flatMap { $0.isTruthy ? $0 : nil }`:
  /// that `nil` is JSONValue's nil literal, `.null`, so nothing falls back.)
  var jsTruthy: JSONValue? {
    guard case .some(let value) = self, value.isTruthy else { return Optional<JSONValue>.none }
    return value
  }
}
