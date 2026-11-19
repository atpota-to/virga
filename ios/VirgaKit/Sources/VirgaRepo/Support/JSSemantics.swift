// JavaScript's rules for reading loosely typed values, for the parts of
// carRepo.js that read decoded blocks without checking their shape: a
// property read (`node.e`), truthiness (`if (!link)`), `String(x)` and a
// template literal, `Number(x)` (inside `slice`), and `for…of`.
//
// A repo's own blocks always have the expected shape. These matter for one
// that doesn't, where the web either carries on in a well-defined way (an
// MST entry whose key prefix length is the string "3") or throws a
// TypeError, whose message the port repeats.
//
// Values are in the data model's JSON form (DagCborValue.jsonValue): a CID
// link or a byte string is an object, as the web's wrapper objects are to
// these rules.

import Foundation
import VirgaCore

enum JS {
  // MARK: Property reads

  /// `base.key`, where nil is `undefined`. Reading from null or undefined
  /// throws as V8 does; any non-object has none of the keys the repo code
  /// reads.
  static func get(_ base: JSONValue?, _ key: String) throws -> JSONValue? {
    guard let base else { throw RepoError.type("Cannot read properties of undefined (reading '\(key)')") }
    switch base {
    case .null: throw RepoError.type("Cannot read properties of null (reading '\(key)')")
    case .object(let members): return members[key]
    default: return nil
    }
  }

  /// `base?.key`.
  static func optionalGet(_ base: JSONValue?, _ key: String) -> JSONValue? {
    guard case .object(let members)? = base else { return nil }
    return members[key]
  }

  /// `value.length`, for the values that have one.
  static func length(_ value: JSONValue) -> JSONValue? {
    switch value {
    case .string(let text): return .number(Double(text.utf16.count))
    case .array(let values): return .number(Double(values.count))
    case .object(let members): return members["length"]
    default: return nil
    }
  }

  // MARK: Conversions

  /// Truthiness, where nil is `undefined`.
  static func truthy(_ value: JSONValue?) -> Bool {
    value?.isTruthy ?? false
  }

  /// `String(value)`, as a template literal also converts. An object with
  /// its own (uncallable) `toString` member has no primitive value, and
  /// converting it throws.
  static func toString(_ value: JSONValue?) throws -> String {
    guard let value else { return "undefined" }
    switch value {
    case .null: return "null"
    case .bool(let flag): return flag ? "true" : "false"
    case .number(let number): return JSNumber.format(number)
    case .string(let text): return text
    case .array(let values):
      // Array.prototype.join: null and undefined elements are empty.
      return try values.map { $0.isNull ? "" : try toString($0) }.joined(separator: ",")
    case .object(let members):
      if members["toString"] != nil { throw RepoError.type("Cannot convert object to primitive value") }
      return "[object Object]"
    }
  }

  /// `Number(value)`.
  static func toNumber(_ value: JSONValue?) throws -> Double {
    guard let value else { return .nan }
    switch value {
    case .null: return 0
    case .bool(let flag): return flag ? 1 : 0
    case .number(let number): return number
    case .string(let text): return stringToNumber(text)
    case .array, .object: return stringToNumber(try toString(value))
    }
  }

  /// ToIntegerOrInfinity.
  static func toIntegerOrInfinity(_ number: Double) -> Double {
    if number.isNaN { return 0 }
    if number.isInfinite { return number }
    return number.rounded(.towardZero) + 0  // -0 → 0
  }

  /// StringToNumber: JavaScript's `Number("…")`. Whitespace around is
  /// ignored; empty is 0; `0x`/`0o`/`0b` integers, `Infinity` and decimal
  /// literals are read; anything else is NaN.
  static func stringToNumber(_ text: String) -> Double {
    let trimmed = text.jsTrimmed()
    if trimmed.isEmpty { return 0 }
    let units = Array(trimmed.utf8)
    if units.count > 2, units[0] == UInt8(ascii: "0") {
      let radix: Int?
      switch units[1] {
      case UInt8(ascii: "x"), UInt8(ascii: "X"): radix = 16
      case UInt8(ascii: "o"), UInt8(ascii: "O"): radix = 8
      case UInt8(ascii: "b"), UInt8(ascii: "B"): radix = 2
      default: radix = nil
      }
      if let radix {
        var value: Double = 0
        for unit in units.dropFirst(2) {
          guard let digit = Character(UnicodeScalar(unit)).hexDigitValue, digit < radix else { return .nan }
          value = value * Double(radix) + Double(digit)
        }
        return value
      }
    }
    var body = Substring(trimmed)
    var sign: Double = 1
    if body.first == "+" || body.first == "-" {
      sign = body.first == "-" ? -1 : 1
      body = body.dropFirst()
    }
    if body == "Infinity" { return sign * .infinity }
    // StrUnsignedDecimalLiteral: digits [. digits] | . digits, then an
    // optional exponent. Checked here, because Double("…") accepts more
    // (hex floats, "nan", "inf").
    let chars = Array(body.utf8)
    var i = 0
    var intDigits = 0
    while i < chars.count, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(chars[i]) { i += 1; intDigits += 1 }
    var fracDigits = 0
    if i < chars.count, chars[i] == UInt8(ascii: ".") {
      i += 1
      while i < chars.count, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(chars[i]) { i += 1; fracDigits += 1 }
    }
    guard intDigits + fracDigits > 0 else { return .nan }
    if i < chars.count, chars[i] == UInt8(ascii: "e") || chars[i] == UInt8(ascii: "E") {
      i += 1
      if i < chars.count, chars[i] == UInt8(ascii: "+") || chars[i] == UInt8(ascii: "-") { i += 1 }
      var expDigits = 0
      while i < chars.count, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(chars[i]) { i += 1; expDigits += 1 }
      guard expDigits > 0 else { return .nan }
    }
    guard i == chars.count else { return .nan }
    var literal = String(body)
    if literal.hasPrefix(".") { literal = "0" + literal }
    if literal.hasSuffix(".") { literal += "0" }
    literal = literal.replacingOccurrences(of: ".e", with: ".0e").replacingOccurrences(of: ".E", with: ".0E")
    guard let value = Double(literal) else { return .nan }
    return sign * value
  }

  // MARK: Iteration

  /// The values `for (const x of value)` visits: an array's elements, a
  /// string's code points. Anything else throws V8's TypeError.
  static func iterate(_ value: JSONValue) throws -> [JSONValue] {
    switch value {
    case .array(let values): return values
    case .string(let text): return text.unicodeScalars.map { .string(String($0)) }
    case .number(let number):
      throw RepoError.type("number \(JSNumber.format(number)) is not iterable (cannot read property Symbol(Symbol.iterator))")
    case .bool(let flag):
      throw RepoError.type("boolean \(flag) is not iterable (cannot read property Symbol(Symbol.iterator))")
    case .object:
      throw RepoError.type("object is not iterable (cannot read property Symbol(Symbol.iterator))")
    case .null:
      throw RepoError.type("object null is not iterable (cannot read property Symbol(Symbol.iterator))")
    }
  }
}
