// JSON with each object's members in the order JavaScript would list them.
//
// JSONValue holds an object's members unordered, which is all most ports
// need. But where the web walks `Object.entries(body)` and the order shows
// (a stable sort whose ties keep it, the first N taken), the port needs the
// order JSON.parse gives: integer-like keys ("0", "17") first in ascending
// order, then the other keys in the order they first appear; a repeated key
// keeps its first place and takes its last value.
//
// The text is first read with JSONValue.parse, so what is accepted and what
// each value is stay exactly JSON.parse's; this reader then only recovers
// the order, from text it knows is valid.

import Foundation
import VirgaCore

public indirect enum OrderedJSON: Sendable, Hashable {
  case scalar(JSONValue)
  case array([OrderedJSON])
  /// Members in `Object.entries` order.
  case object([Member])

  public struct Member: Sendable, Hashable {
    public var key: String
    public var value: OrderedJSON
  }

  /// `JSON.parse(text)`, keeping the order.
  public static func parse(_ text: String) throws -> OrderedJSON {
    // JSON.parse decides what is accepted; the walk only keeps the order.
    _ = try JSONValue.parse(text)
    var reader = Reader(units: Array(text.utf16))
    return reader.readValue()
  }

  /// `await response.json()`, keeping the order.
  public static func parse(_ data: Data) throws -> OrderedJSON {
    var text = String(decoding: data, as: UTF8.self)
    if text.unicodeScalars.first == "\u{FEFF}" { text.unicodeScalars.removeFirst() }
    return try parse(text)
  }

  /// A JSONValue's objects in key order (when there is no text to read the
  /// order from), integer-like keys first as JavaScript lists them.
  public init(_ value: JSONValue) {
    switch value {
    case .array(let items): self = .array(items.map(OrderedJSON.init))
    case .object(let members):
      self = .object(Self.entriesOrder(members.keys.sorted()).map { Member(key: $0, value: OrderedJSON(members[$0]!)) })
    default: self = .scalar(value)
    }
  }

  /// The same value without the order.
  public var value: JSONValue {
    switch self {
    case .scalar(let value): return value
    case .array(let items): return .array(items.map(\.value))
    case .object(let members):
      var out: [String: JSONValue] = [:]
      for member in members { out[member.key] = member.value.value }
      return .object(out)
    }
  }

  /// A member of an object.
  public subscript(key: String) -> OrderedJSON? {
    guard case .object(let members) = self else { return nil }
    return members.first { $0.key.jsEquals(key) }?.value
  }

  /// `Object.entries(value)`: an object's members, an array's elements under
  /// their indexes, a string's UTF-16 code units under theirs, nothing for
  /// anything else.
  public var entries: [(String, OrderedJSON)] {
    switch self {
    case .object(let members): return members.map { ($0.key, $0.value) }
    case .array(let items): return items.enumerated().map { (String($0.offset), $0.element) }
    case .scalar(.string(let text)):
      return text.utf16.enumerated().map { (String($0.offset), .scalar(.string(String(jsUnits: [$0.element])))) }
    case .scalar: return []
    }
  }

  /// JavaScript truthiness.
  public var isTruthy: Bool {
    if case .scalar(let value) = self { return value.isTruthy }
    return true
  }

  /// `typeof value === 'object'` for a non-null value.
  public var isObjectLike: Bool {
    switch self {
    case .object, .array: return true
    case .scalar: return false
    }
  }

  /// Whether a key is an array index ("0", or a digit 1–9 then digits,
  /// below 2^32 − 1), which JavaScript lists first, in ascending order.
  static func isArrayIndex(_ key: String) -> Bool {
    let units = Array(key.utf8)
    guard !units.isEmpty, units.count <= 10, units.allSatisfy({ (0x30...0x39).contains($0) }) else { return false }
    if units.count > 1 && units[0] == 0x30 { return false }
    return (UInt64(key) ?? .max) < 4_294_967_295
  }

  /// Keys in `Object.entries` order, from their insertion order.
  static func entriesOrder(_ keys: [String]) -> [String] {
    let indexes = keys.filter(isArrayIndex).sorted { UInt64($0)! < UInt64($1)! }
    return indexes + keys.filter { !isArrayIndex($0) }
  }

  /// Walks text JSON.parse has accepted, keeping each object's key order.
  /// Scalars are read as JSON.parse reads them: numbers to the nearest
  /// double, escapes decoded, a lone surrogate escape as U+FFFD.
  struct Reader {
    let units: [UInt16]
    var i = 0

    mutating func skipWhitespace() {
      while i < units.count, units[i] == 0x20 || units[i] == 0x09 || units[i] == 0x0A || units[i] == 0x0D { i += 1 }
    }

    mutating func readValue() -> OrderedJSON {
      skipWhitespace()
      guard i < units.count else { return .scalar(.null) }
      switch units[i] {
      case 0x5B:  // [
        i += 1
        var out: [OrderedJSON] = []
        skipWhitespace()
        if i < units.count, units[i] == 0x5D {
          i += 1
          return .array([])
        }
        while i < units.count {
          out.append(readValue())
          skipWhitespace()
          if i < units.count, units[i] == 0x2C {
            i += 1
            continue
          }
          i += 1  // ]
          break
        }
        return .array(out)
      case 0x7B:  // {
        i += 1
        // Keys as a JavaScript object holds them: by code unit, so two
        // spellings of "é" are two members.
        var order: [String] = []
        var children: [JSKey: OrderedJSON] = [:]
        skipWhitespace()
        if i < units.count, units[i] == 0x7D {
          i += 1
          return .object([])
        }
        while i < units.count {
          skipWhitespace()
          let key = readString()
          skipWhitespace()
          i += 1  // :
          let child = readValue()
          // A repeated key keeps its first place and its last value.
          if children[JSKey(key)] == nil { order.append(key) }
          children[JSKey(key)] = child
          skipWhitespace()
          if i < units.count, units[i] == 0x2C {
            i += 1
            continue
          }
          i += 1  // }
          break
        }
        return .object(OrderedJSON.entriesOrder(order).map { Member(key: $0, value: children[JSKey($0)]!) })
      case 0x22:
        return .scalar(.string(readString()))
      case 0x74:
        i += 4
        return .scalar(.bool(true))
      case 0x66:
        i += 5
        return .scalar(.bool(false))
      case 0x6E:
        i += 4
        return .scalar(.null)
      default:
        let start = i
        func isNumberUnit(_ u: UInt16) -> Bool { (0x30...0x39).contains(u) || u == 0x2D || u == 0x2B || u == 0x2E || u == 0x45 || u == 0x65 }
        while i < units.count, isNumberUnit(units[i]) { i += 1 }
        let text = String(decoding: units[start..<i].map { UInt8($0) }, as: UTF8.self)
        return .scalar(.number(Double(text) ?? .nan))
      }
    }

    /// Reads a string token, decoding its escapes as JSON.parse does.
    mutating func readString() -> String {
      i += 1  // "
      var out: [UInt16] = []
      while i < units.count, units[i] != 0x22 {
        if units[i] == 0x5C {
          i += 1
          switch units[i] {
          case 0x62: out.append(0x08)
          case 0x66: out.append(0x0C)
          case 0x6E: out.append(0x0A)
          case 0x72: out.append(0x0D)
          case 0x74: out.append(0x09)
          case 0x75:
            let hex = String(utf16CodeUnits: Array(units[(i + 1)...(i + 4)]), count: 4)
            out.append(UInt16(hex, radix: 16) ?? 0xFFFD)
            i += 4
          default: out.append(units[i])
          }
          i += 1
        } else {
          out.append(units[i])
          i += 1
        }
      }
      i += 1  // "
      return String(jsUnits: out)
    }

  }
}
