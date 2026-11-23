// JavaScript's `Number(value)`, for ports whose web code coerces loosely
// typed input (`Number(hour)`, `Number(n) || 0`, `Number(cursor)`): what a
// string, a boolean, null or an array becomes as a number.
// ios/parity/cases/core.jscompat.js holds it to Node.

import Foundation

extension JSNumber {
  /// `Number(string)`: JavaScript's StringToNumber. Surrounding whitespace
  /// (JavaScript's, `JSWhitespace`) is ignored; the empty string is 0;
  /// `0x`, `0o` and `0b` integers and `Infinity` are read; anything else
  /// that isn't a decimal literal is NaN.
  public static func toNumber(_ string: String) -> Double {
    let text = string.jsTrimmed()
    if text.isEmpty { return 0 }
    let bytes = Array(text.utf8)
    // Radix prefixes, unsigned only.
    if bytes.count > 2, bytes[0] == 0x30 {
      let radix: Int?
      switch bytes[1] {
      case 0x78, 0x58: radix = 16
      case 0x6F, 0x4F: radix = 8
      case 0x62, 0x42: radix = 2
      default: radix = nil
      }
      if let radix {
        var value: Double = 0
        for byte in bytes[2...] {
          guard let digit = digitValue(byte), digit < radix else { return .nan }
          value = value * Double(radix) + Double(digit)
        }
        return value
      }
    }
    var index = 0
    var negative = false
    if bytes[0] == 0x2B || bytes[0] == 0x2D {
      negative = bytes[0] == 0x2D
      index = 1
    }
    let rest = bytes[index...]
    if rest.elementsEqual("Infinity".utf8) { return negative ? -.infinity : .infinity }
    // StrUnsignedDecimalLiteral: digits [. digits] [e [+-] digits], at least
    // one digit before the exponent.
    var sawDigit = false
    var i = rest.startIndex
    while i < rest.endIndex, isDigit(rest[i]) { sawDigit = true; i += 1 }
    if i < rest.endIndex, rest[i] == 0x2E {
      i += 1
      while i < rest.endIndex, isDigit(rest[i]) { sawDigit = true; i += 1 }
    }
    guard sawDigit else { return .nan }
    if i < rest.endIndex, rest[i] == 0x65 || rest[i] == 0x45 {
      i += 1
      if i < rest.endIndex, rest[i] == 0x2B || rest[i] == 0x2D { i += 1 }
      var expDigit = false
      while i < rest.endIndex, isDigit(rest[i]) { expDigit = true; i += 1 }
      guard expDigit else { return .nan }
    }
    guard i == rest.endIndex else { return .nan }
    guard let magnitude = Double(String(decoding: rest, as: UTF8.self)) else { return .nan }
    return negative ? -magnitude : magnitude
  }

  private static func isDigit(_ byte: UInt8) -> Bool { byte >= 0x30 && byte <= 0x39 }

  private static func digitValue(_ byte: UInt8) -> Int? {
    switch byte {
    case 0x30...0x39: return Int(byte - 0x30)
    case 0x61...0x7A: return Int(byte - 0x61 + 10)
    case 0x41...0x5A: return Int(byte - 0x41 + 10)
    default: return nil
    }
  }
}

extension JSONValue {
  /// `Number(value)`: null is 0, booleans 0 and 1, strings as
  /// `JSNumber.toNumber`, an array as its joined string, an object NaN.
  public var jsNumber: Double {
    switch self {
    case .null: return 0
    case .bool(let value): return value ? 1 : 0
    case .number(let value): return value
    case .string(let value): return JSNumber.toNumber(value)
    case .array: return JSNumber.toNumber(jsString)
    case .object: return .nan
    }
  }
}

extension Optional where Wrapped == JSONValue {
  /// `Number(value)` where an absent value is `undefined`: NaN.
  public var jsNumber: Double {
    switch self {
    case .none: return .nan
    case .some(let value): return value.jsNumber
    }
  }
}

extension String {
  /// The string as `JSON.stringify` writes it: in double quotes, with `"`,
  /// `\` and the control characters escaped (\b \t \n \f \r, the rest as
  /// lower-case \u00xx), and everything else, U+2028 included, as it is.
  /// For ports that must store exactly the JSON text the web stores.
  public var jsJSONQuoted: String {
    var out = "\""
    out.reserveCapacity(utf8.count + 2)
    for scalar in unicodeScalars {
      switch scalar.value {
      case 0x08: out += "\\b"
      case 0x09: out += "\\t"
      case 0x0A: out += "\\n"
      case 0x0C: out += "\\f"
      case 0x0D: out += "\\r"
      case 0x22: out += "\\\""
      case 0x5C: out += "\\\\"
      case 0..<0x20:
        let hex = String(scalar.value, radix: 16)
        out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
      default: out.unicodeScalars.append(scalar)
      }
    }
    return out + "\""
  }
}
