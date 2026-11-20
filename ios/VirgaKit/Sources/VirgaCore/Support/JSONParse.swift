// JavaScript's `JSON.parse`, for the web's stored values and network bodies.
//
// Foundation's JSON readers differ from it at the edges, and differently on
// each platform: Swift's JSONDecoder takes a trailing comma (`{"a":1,}`) and
// a byte-order mark, and refuses a lone surrogate escape (`"\ud800"`) and a
// number past Double's range (`1e400`), all of which JSON.parse does the
// other way; and it keeps the first of two equal keys where JSON.parse
// keeps the last. The web reads localStorage with
// `JSON.parse(store.getItem(key) || 'null')` inside a try, so what parses
// decides what a port keeps. This parser is ECMA-404 as JSON.parse reads it:
//
// - whitespace is only tab, line feed, carriage return and space;
// - a number is `-? (0 | [1-9][0-9]*) (. [0-9]+)? ([eE] [+-]? [0-9]+)?`,
//   read to the nearest double (so `1e400` is infinity and `-0` is -0);
// - a string may not hold a raw control character (U+0000 to U+001F); its
//   escapes are \" \\ \/ \b \f \n \r \t and \uXXXX, and a lone surrogate
//   becomes U+FFFD (the only form a Swift String can hold, and what it
//   becomes anyway when JavaScript encodes the string as UTF-8);
// - the last of two equal keys wins;
// - nothing but whitespace may follow the value.
//
// It works with an explicit stack rather than recursion, so a deeply nested
// input can't overflow the call stack. ios/parity/cases/core.jsjson.js holds
// it to Node's own JSON.parse.

import Foundation

/// A text JSON.parse refuses. `position` is the UTF-16 offset where reading
/// stopped, as V8 counts it; the message is this port's, not V8's (the web
/// only ever catches the error, never shows it).
public struct JSONParseError: Error, Equatable, Sendable, CustomStringConvertible, LocalizedError {
  public let message: String
  public let position: Int

  public var description: String { "\(message) in JSON at position \(position)" }
  public var errorDescription: String? { description }
}

public enum JSONText {
  /// `JSON.parse(text)`.
  public static func parse(_ text: String) throws -> JSONValue {
    var parser = Parser(units: Array(text.utf16))
    return try parser.parseDocument()
  }

  /// `await new Response(data).json()`: the bytes decoded as UTF-8 (a
  /// leading byte-order mark dropped, a malformed sequence read as U+FFFD,
  /// as the Encoding Standard's UTF-8 decode does), then `JSON.parse`.
  public static func parse(_ data: Data) throws -> JSONValue {
    var text = String(decoding: data, as: UTF8.self)
    if text.unicodeScalars.first == "\u{FEFF}" { text.unicodeScalars.removeFirst() }
    return try parse(text)
  }

  private struct Parser {
    let units: [UInt16]
    var i = 0

    init(units: [UInt16]) { self.units = units }

    /// The kind of a container being filled.
    enum Kind { case array, object }

    func fail(_ message: String) -> JSONParseError {
      JSONParseError(message: i >= units.count ? "Unexpected end of JSON input" : message, position: i)
    }

    mutating func skipWhitespace() {
      while i < units.count {
        switch units[i] {
        case 0x09, 0x0A, 0x0D, 0x20: i += 1
        default: return
        }
      }
    }

    mutating func expect(_ unit: UInt16, _ message: String) throws {
      guard i < units.count, units[i] == unit else { throw fail(message) }
      i += 1
    }

    mutating func parseDocument() throws -> JSONValue {
      // The containers being filled, innermost last: the kind of each, and,
      // kept apart so each is mutated in place (a frame popped off one stack
      // and rebound would be copied on every insert, which is quadratic),
      // the arrays' items, the objects' members and the key of the value
      // each object is reading.
      var kinds: [Kind] = []
      var arrays: [[JSONValue]] = []
      var objects: [[String: JSONValue]] = []
      var keys: [String] = []
      var value: JSONValue
      readValue: while true {
        skipWhitespace()
        guard i < units.count else { throw fail("Unexpected end of JSON input") }
        switch units[i] {
        case 0x7B:  // {
          i += 1
          skipWhitespace()
          if i < units.count, units[i] == 0x7D {
            i += 1
            value = .object([:])
          } else {
            keys.append(try readKey())
            kinds.append(.object)
            objects.append([:])
            continue readValue
          }
        case 0x5B:  // [
          i += 1
          skipWhitespace()
          if i < units.count, units[i] == 0x5D {
            i += 1
            value = .array([])
          } else {
            kinds.append(.array)
            arrays.append([])
            continue readValue
          }
        case 0x22:  // "
          value = .string(try readString())
        case 0x74: value = try readLiteral("true", .bool(true))
        case 0x66: value = try readLiteral("false", .bool(false))
        case 0x6E: value = try readLiteral("null", .null)
        case 0x2D, 0x30...0x39: value = .number(try readNumber())
        default: throw fail("Unexpected token")
        }
        // A value is complete: hand it to the container it belongs to,
        // closing every container it completes.
        while true {
          guard let kind = kinds.last else {
            skipWhitespace()
            guard i == units.count else { throw fail("Unexpected non-whitespace character after JSON") }
            return value
          }
          skipWhitespace()
          switch kind {
          case .array:
            arrays[arrays.count - 1].append(value)
            guard i < units.count else { throw fail("Unexpected end of JSON input") }
            if units[i] == 0x2C {  // ,
              i += 1
              continue readValue
            }
            guard units[i] == 0x5D else { throw fail("Expected ',' or ']' after array element") }
            i += 1
            kinds.removeLast()
            value = .array(arrays.removeLast())
          case .object:
            objects[objects.count - 1][keys.removeLast()] = value
            guard i < units.count else { throw fail("Unexpected end of JSON input") }
            if units[i] == 0x2C {  // ,
              i += 1
              skipWhitespace()
              keys.append(try readKey())
              continue readValue
            }
            guard units[i] == 0x7D else { throw fail("Expected ',' or '}' after property value") }
            i += 1
            kinds.removeLast()
            value = .object(objects.removeLast())
          }
        }
      }
    }

    /// `"key"` and the `:` after it.
    mutating func readKey() throws -> String {
      guard i < units.count, units[i] == 0x22 else { throw fail("Expected property name or '}'") }
      let key = try readString()
      skipWhitespace()
      try expect(0x3A, "Expected ':' after property name")
      return key
    }

    mutating func readLiteral(_ word: String, _ value: JSONValue) throws -> JSONValue {
      for unit in word.utf16 {
        guard i < units.count, units[i] == unit else { throw fail("Unexpected token") }
        i += 1
      }
      return value
    }

    /// From the opening quote to past the closing one.
    mutating func readString() throws -> String {
      i += 1
      // Most strings have no escape: read them in one piece.
      let start = i
      while i < units.count {
        let unit = units[i]
        if unit == 0x22 {
          i += 1
          return String(decoding: units[start..<(i - 1)], as: UTF16.self)
        }
        if unit == 0x5C || unit < 0x20 { break }
        i += 1
      }
      var out = Array(units[start..<i])
      while i < units.count {
        let unit = units[i]
        switch unit {
        case 0x22:
          i += 1
          return String(decoding: out, as: UTF16.self)
        case 0x5C:
          i += 1
          guard i < units.count else { throw fail("Unterminated string") }
          switch units[i] {
          case 0x22: out.append(0x22)
          case 0x5C: out.append(0x5C)
          case 0x2F: out.append(0x2F)
          case 0x62: out.append(0x08)
          case 0x66: out.append(0x0C)
          case 0x6E: out.append(0x0A)
          case 0x72: out.append(0x0D)
          case 0x74: out.append(0x09)
          case 0x75:
            var code: UInt16 = 0
            for _ in 0..<4 {
              i += 1
              guard i < units.count, let digit = Self.hexValue(units[i]) else { throw fail("Bad Unicode escape") }
              code = code << 4 | digit
            }
            out.append(code)
          default: throw fail("Bad escaped character")
          }
          i += 1
        case 0..<0x20:
          throw fail("Bad control character in string literal")
        default:
          out.append(unit)
          i += 1
        }
      }
      throw fail("Unterminated string")
    }

    static func hexValue(_ unit: UInt16) -> UInt16? {
      switch unit {
      case 0x30...0x39: return unit - 0x30
      case 0x41...0x46: return unit - 0x41 + 10
      case 0x61...0x66: return unit - 0x61 + 10
      default: return nil
      }
    }

    static func isDigit(_ unit: UInt16) -> Bool { unit >= 0x30 && unit <= 0x39 }

    mutating func readNumber() throws -> Double {
      let start = i
      if units[i] == 0x2D { i += 1 }
      guard i < units.count, Self.isDigit(units[i]) else { throw fail("No number after minus sign") }
      if units[i] == 0x30 {
        i += 1
      } else {
        while i < units.count, Self.isDigit(units[i]) { i += 1 }
      }
      if i < units.count, units[i] == 0x2E {
        i += 1
        guard i < units.count, Self.isDigit(units[i]) else { throw fail("Unterminated fractional number") }
        while i < units.count, Self.isDigit(units[i]) { i += 1 }
      }
      if i < units.count, units[i] == 0x65 || units[i] == 0x45 {
        i += 1
        if i < units.count, units[i] == 0x2B || units[i] == 0x2D { i += 1 }
        guard i < units.count, Self.isDigit(units[i]) else { throw fail("Exponent part is missing a number") }
        while i < units.count, Self.isDigit(units[i]) { i += 1 }
      }
      // The lexeme is ASCII; Double reads it correctly rounded, past its
      // range to infinity, as JavaScript's StringToNumber does.
      let lexeme = String(decoding: units[start..<i].map { UInt8(truncatingIfNeeded: $0) }, as: UTF8.self)
      guard let number = Double(lexeme) else { throw fail("Bad number") }
      return number
    }
  }
}
