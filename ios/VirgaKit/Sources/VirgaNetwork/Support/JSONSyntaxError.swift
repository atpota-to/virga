// The SyntaxError `JSON.parse` throws for text it refuses, with the words
// V8 (Node 22, Chrome) gives it: `res.json()` and the SDK's body parsing
// reject a body that isn't JSON with this error, and its message reaches
// the person (atproto.js's reads, sources.js's publicXrpc, an XRPC call's
// "Failed to parse response body: SyntaxError: …").
//
// VirgaCore's JSONText decides what parses; this only words the refusal. It
// re-reads the text as V8's JsonParser does (json-parser.cc): the first
// token it can't take, the message that token or that place calls for, the
// position in UTF-16 code units, and the line and column ("\r\n" counts as
// one line break). A token that isn't a number or a string is quoted with
// the source around it: all of a short source (under 21 code units), else
// ten code units either side, with "..." where it was cut.

import Foundation
import VirgaCore

/// `JSON.parse`'s SyntaxError.
public struct JSONSyntaxError: Error, Sendable, Hashable, LocalizedError {
  public var message: String
  public var name: String { "SyntaxError" }
  public var errorDescription: String? { message }

  public init(message: String) { self.message = message }

  /// The error V8's `JSON.parse(text)` throws, or nil when it parses.
  public static func v8(_ text: String) -> JSONSyntaxError? {
    V8JSONReader(Array(text.utf16)).firstError().map(JSONSyntaxError.init)
  }

  /// `await new Response(body).json()`: the body as UTF-8 (a byte-order mark
  /// dropped), parsed, or this error with V8's words.
  static func parse(_ body: Data) throws -> JSONValue {
    do {
      return try JSONValue.parse(body)
    } catch {
      var text = String(decoding: body, as: UTF8.self)
      if text.unicodeScalars.first == "\u{FEFF}" { text.unicodeScalars.removeFirst() }
      throw v8(text) ?? JSONSyntaxError(message: jsMessage(error))
    }
  }
}

/// V8's JSON reader, kept only for where and why it stops.
struct V8JSONReader {
  enum Token { case string, number, lbrace, rbrace, lbrack, rbrack, colon, comma, trueLiteral, falseLiteral, nullLiteral, whitespace, illegal, eos }

  /// The JSON.parse messages that name the place.
  enum Place: String {
    case expectedPropNameOrRBrace = "Expected property name or '}'"
    case expectedDoubleQuotedPropertyName = "Expected double-quoted property name"
    case expectedColonAfterPropertyName = "Expected ':' after property name"
    case expectedCommaOrRBrace = "Expected ',' or '}' after property value"
    case expectedCommaOrRBrack = "Expected ',' or ']' after array element"
    case unexpectedNonWhiteSpace = "Unexpected non-whitespace character after JSON"
    case unterminatedString = "Unterminated string"
    case badControlCharacter = "Bad control character in string literal"
    case badEscapedCharacter = "Bad escaped character"
    case badUnicodeEscape = "Bad Unicode escape"
    case noNumberAfterMinusSign = "No number after minus sign"
    case unterminatedFractionalNumber = "Unterminated fractional number"
    case exponentPartMissingNumber = "Exponent part is missing a number"
  }

  struct Stop: Error {
    let message: String
  }

  let units: [UInt16]
  var i = 0

  init(_ units: [UInt16]) { self.units = units }

  static func token(_ unit: UInt16?) -> Token {
    guard let unit else { return .eos }
    switch unit {
    case 0x22: return .string
    case 0x2D, 0x30...0x39: return .number
    case 0x7B: return .lbrace
    case 0x7D: return .rbrace
    case 0x5B: return .lbrack
    case 0x5D: return .rbrack
    case 0x3A: return .colon
    case 0x2C: return .comma
    case 0x74: return .trueLiteral
    case 0x66: return .falseLiteral
    case 0x6E: return .nullLiteral
    case 0x20, 0x09, 0x0A, 0x0D: return .whitespace
    default: return .illegal
    }
  }

  var current: UInt16? { i < units.count ? units[i] : nil }
  var peek: Token { Self.token(current) }

  static func isDigit(_ unit: UInt16?) -> Bool { unit.map { (0x30...0x39).contains($0) } ?? false }
  static func isHex(_ unit: UInt16?) -> Bool {
    guard let unit else { return false }
    return (0x30...0x39).contains(unit) || (0x41...0x46).contains(unit) || (0x61...0x66).contains(unit)
  }
  /// `IsNumberPart`: what may continue a number.
  static func isNumberPart(_ unit: UInt16?) -> Bool {
    guard let unit else { return false }
    return isDigit(unit) || unit == 0x2E || unit == 0x65 || unit == 0x45 || unit == 0x2D || unit == 0x2B
  }

  mutating func skipWhitespace() {
    while peek == .whitespace { i += 1 }
  }

  /// `Check(token)`: past whitespace, takes `token` if it is next.
  mutating func check(_ token: Token) -> Bool {
    skipWhitespace()
    guard peek == token else { return false }
    i += 1
    return true
  }

  /// `ExpectNext(token, message)`.
  mutating func expectNext(_ token: Token, _ place: Place) throws {
    skipWhitespace()
    try expect(token, place)
  }

  /// `Expect(token, message)`.
  mutating func expect(_ token: Token, _ place: Place) throws {
    guard peek == token else { throw stop(peek, place) }
    i += 1
  }

  /// `(line % column %)` of the cursor.
  func location() -> (line: Int, column: Int) {
    var line = 1
    var lastBreak = 0
    var k = 0
    while k < i {
      if units[k] == 0x0D, k < i - 1, units[k + 1] == 0x0A { k += 1 }
      if units[k] == 0x0D || units[k] == 0x0A {
        line += 1
        lastBreak = k + 1
      }
      k += 1
    }
    return (line, 1 + k - lastBreak)
  }

  /// `<words> in JSON at position % (line % column %)`.
  func at(_ words: String, inJSON: Bool = true) -> String {
    let (line, column) = location()
    return "\(words)\(inJSON ? " in JSON" : "") at position \(i) (line \(line) column \(column))"
  }

  /// `ReportUnexpectedToken(token, message)`.
  func stop(_ token: Token, _ place: Place? = nil) -> Stop {
    if let place { return Stop(message: at(place.rawValue, inJSON: place != .unexpectedNonWhiteSpace)) }
    switch token {
    case .eos: return Stop(message: "Unexpected end of JSON input")
    case .number: return Stop(message: at("Unexpected number"))
    case .string: return Stop(message: at("Unexpected string"))
    default:
      let source = String(decoding: units, as: UTF16.self)
      if ["[object Object]", "undefined", "Infinity", "NaN"].contains(where: { source.jsEquals($0) }) {
        return Stop(message: "\"\(source)\" is not valid JSON")
      }
      let character = String(decoding: [units[i]], as: UTF16.self)
      let length = units.count
      let context = 10
      func slice(_ from: Int, _ to: Int) -> String { String(decoding: units[from..<min(to, length)], as: UTF16.self) }
      let quoted: String
      if length < context * 2 + 1 {
        quoted = "\"\(source)\""
      } else if i < context {
        quoted = "\"\(slice(0, i + context))\"..."
      } else if i < length - context {
        quoted = "...\"\(slice(i - context, i + context))\"..."
      } else {
        quoted = "...\"\(slice(i - context, length))\""
      }
      return Stop(message: "Unexpected token '\(character)', \(quoted) is not valid JSON")
    }
  }

  /// `ReportUnexpectedCharacter(c)`.
  func stopAtCharacter() -> Stop {
    guard let unit = current else { return stop(.eos) }
    return stop(unit <= 0xFF ? Self.token(unit) : .illegal)
  }

  /// The message of the first error, or nil when the text is JSON.
  func firstError() -> String? {
    var reader = self
    do {
      try reader.readDocument()
      return nil
    } catch let stop as Stop {
      return stop.message
    } catch {
      return nil
    }
  }

  enum Frame { case object, array }

  mutating func readDocument() throws {
    var stack: [Frame] = []
    produce: while true {
      // Produce a value.
      skipWhitespace()
      switch peek {
      case .string:
        i += 1
        try readString()
      case .number:
        try readNumber()
      case .lbrace:
        i += 1
        if check(.rbrace) { break }
        stack.append(.object)
        try expectNext(.string, .expectedPropNameOrRBrace)
        try readString()
        try expectNext(.colon, .expectedColonAfterPropertyName)
        continue produce
      case .lbrack:
        i += 1
        if check(.rbrack) { break }
        stack.append(.array)
        continue produce
      case .trueLiteral: try readLiteral("true")
      case .falseLiteral: try readLiteral("false")
      case .nullLiteral: try readLiteral("null")
      case .colon, .comma, .illegal, .rbrace, .rbrack, .eos, .whitespace:
        throw stopAtCharacter()
      }
      // Consume it.
      while let frame = stack.last {
        switch frame {
        case .object:
          if check(.comma) {
            try expectNext(.string, .expectedDoubleQuotedPropertyName)
            try readString()
            try expectNext(.colon, .expectedColonAfterPropertyName)
            continue produce
          }
          try expect(.rbrace, .expectedCommaOrRBrace)
        case .array:
          if check(.comma) { continue produce }
          try expect(.rbrack, .expectedCommaOrRBrack)
        }
        stack.removeLast()
      }
      if !check(.eos) { throw stop(peek, .unexpectedNonWhiteSpace) }
      return
    }
  }

  /// `ScanJsonString`, after the opening quote.
  mutating func readString() throws {
    while true {
      guard let unit = current else { throw stop(.illegal, .unterminatedString) }
      switch unit {
      case 0x22:
        i += 1
        return
      case 0x5C:
        i += 1
        guard let escaped = current, escaped <= 0xFF else { throw stopAtCharacter() }
        switch escaped {
        case 0x22, 0x5C, 0x2F, 0x62, 0x66, 0x6E, 0x72, 0x74:
          i += 1
        case 0x75:
          for _ in 0..<4 {
            i += 1
            guard Self.isHex(current) else { throw stop(.illegal, .badUnicodeEscape) }
          }
          i += 1
        default:
          throw stop(.illegal, .badEscapedCharacter)
        }
      case 0..<0x20:
        throw stop(.illegal, .badControlCharacter)
      default:
        i += 1
      }
    }
  }

  /// `ParseJsonNumber`.
  mutating func readNumber() throws {
    var negative = false
    if current == 0x2D {
      negative = true
      i += 1
    }
    if current == 0x30 {
      i += 1
      if Self.isNumberPart(current) {
        if Self.isDigit(current) { throw stop(.number) }
      } else if !negative {
        return
      }
    } else {
      let start = i
      while Self.isDigit(current) { i += 1 }
      if i == start { throw stop(.illegal, .noNumberAfterMinusSign) }
      if !Self.isNumberPart(current) { return }
    }
    if current == 0x2E {
      i += 1
      guard Self.isDigit(current) else { throw stop(.illegal, .unterminatedFractionalNumber) }
      while Self.isDigit(current) { i += 1 }
    }
    if current == 0x65 || current == 0x45 {
      i += 1
      if current == 0x2D || current == 0x2B { i += 1 }
      guard Self.isDigit(current) else { throw stop(.illegal, .exponentPartMissingNumber) }
      while Self.isDigit(current) { i += 1 }
    }
  }

  /// `ScanLiteral(word)`, at its first letter.
  mutating func readLiteral(_ word: String) throws {
    let letters = Array(word.utf16)
    let remaining = units.count - i
    if remaining >= letters.count, Array(units[i..<(i + letters.count)]) == letters {
      i += letters.count
      return
    }
    i += 1
    for k in 0..<min(letters.count - 1, remaining - 1) {
      if units[i] != letters[1 + k] { throw stopAtCharacter() }
      i += 1
    }
    throw stop(.eos)
  }
}
