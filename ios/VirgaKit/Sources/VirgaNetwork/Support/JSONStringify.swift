// `JSON.stringify` for a JSONValue, for request bodies and stored strings:
// numbers as JavaScript prints them (`1`, not `1.0`; non-finite as `null`),
// `/` unescaped, control characters as `\u00XX` in lower-case hex, and the
// short escapes JSON.stringify uses. JSONValue holds an object's members
// unordered, so they are written in key order; where the web's insertion
// order must be kept byte for byte, build the string yourself.

import Foundation
import VirgaCore

public enum JSONStringify {
  /// `JSON.stringify(value)`.
  public static func stringify(_ value: JSONValue) -> String {
    var out = ""
    write(value, into: &out)
    return out
  }

  /// `JSON.stringify(text)`: a string as a JSON string literal.
  public static func quote(_ text: String) -> String {
    var out = ""
    writeString(text, into: &out)
    return out
  }

  static func write(_ value: JSONValue, into out: inout String) {
    switch value {
    case .null: out += "null"
    case .bool(let flag): out += flag ? "true" : "false"
    case .number(let number): out += number.isFinite ? JSNumber.format(number == 0 ? 0 : number) : "null"
    case .string(let text): writeString(text, into: &out)
    case .array(let items):
      out += "["
      for (index, item) in items.enumerated() {
        if index > 0 { out += "," }
        write(item, into: &out)
      }
      out += "]"
    case .object(let members):
      out += "{"
      for (index, key) in members.keys.sorted().enumerated() {
        if index > 0 { out += "," }
        writeString(key, into: &out)
        out += ":"
        write(members[key]!, into: &out)
      }
      out += "}"
    }
  }

  static func writeString(_ text: String, into out: inout String) {
    out += "\""
    for scalar in text.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      default:
        if scalar.value < 0x20 {
          let hex = String(scalar.value, radix: 16)
          out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    out += "\""
  }
}
