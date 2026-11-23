// Small helpers for code that reads text one UTF-16 code unit at a time, as
// the web's string indexing does. Internal to VirgaSession (VirgaNetwork and
// VirgaDefense keep their own).

import Foundation
import VirgaCore

typealias Units = [UInt16]

enum Unit {
  static let tab: UInt16 = 0x09
  static let lf: UInt16 = 0x0A
  static let cr: UInt16 = 0x0D
  static let space: UInt16 = 0x20
  static let bang: UInt16 = 0x21
  static let quote: UInt16 = 0x22
  static let hash: UInt16 = 0x23
  static let apostrophe: UInt16 = 0x27
  static let openParen: UInt16 = 0x28
  static let closeParen: UInt16 = 0x29
  static let star: UInt16 = 0x2A
  static let plus: UInt16 = 0x2B
  static let hyphen: UInt16 = 0x2D
  static let dot: UInt16 = 0x2E
  static let slash: UInt16 = 0x2F
  static let colon: UInt16 = 0x3A
  static let less: UInt16 = 0x3C
  static let greater: UInt16 = 0x3E
  static let at: UInt16 = 0x40
  static let openBracket: UInt16 = 0x5B
  static let backslash: UInt16 = 0x5C
  static let closeBracket: UInt16 = 0x5D
  static let underscore: UInt16 = 0x5F
  static let backtick: UInt16 = 0x60
  static let bar: UInt16 = 0x7C
  static let tilde: UInt16 = 0x7E

  /// JavaScript's `\s` on one code unit (WhiteSpace and LineTerminator).
  static func isWhitespace(_ unit: UInt16) -> Bool {
    guard let scalar = Unicode.Scalar(UInt32(unit)) else { return false }
    return JSWhitespace.contains(scalar)
  }

  /// A character `.` doesn't match (without the `s` flag): \n, \r, U+2028, U+2029.
  static func isLineTerminator(_ unit: UInt16) -> Bool {
    unit == lf || unit == cr || unit == 0x2028 || unit == 0x2029
  }

  /// `[ \t]`.
  static func isSpaceOrTab(_ unit: UInt16) -> Bool { unit == space || unit == tab }

  /// `\d` without the `u` flag: ASCII digits.
  static func isDigit(_ unit: UInt16) -> Bool { (0x30...0x39).contains(unit) }

  /// `[A-Z]`.
  static func isUpper(_ unit: UInt16) -> Bool { (0x41...0x5A).contains(unit) }

  /// `[a-z]`.
  static func isLower(_ unit: UInt16) -> Bool { (0x61...0x7A).contains(unit) }

  /// `\w` without the `u` flag: `[A-Za-z0-9_]`.
  static func isWord(_ unit: UInt16) -> Bool {
    isUpper(unit) || isLower(unit) || isDigit(unit) || unit == underscore
  }

  /// An ASCII letter in lower case; anything else as it is (the `i` flag
  /// without `u` folds only ASCII here).
  static func asciiLower(_ unit: UInt16) -> UInt16 { isUpper(unit) ? unit + 0x20 : unit }
}

extension Array where Element == UInt16 {
  /// The units as a String (well-formed input stays as it is).
  var string: String { String(decoding: self, as: UTF16.self) }

  /// `text.startsWith(prefix)` by code unit, ASCII case folded when `ignoringCase`.
  func hasPrefix(_ prefix: String, ignoringCase: Bool = false) -> Bool {
    let p = Array(prefix.utf16)
    guard p.count <= count else { return false }
    for (index, unit) in p.enumerated() {
      let a = ignoringCase ? Unit.asciiLower(self[index]) : self[index]
      let b = ignoringCase ? Unit.asciiLower(unit) : unit
      if a != b { return false }
    }
    return true
  }

  /// The code unit at `index`, or nil past either end (`text[i]` is undefined).
  func unit(at index: Int) -> UInt16? {
    index >= 0 && index < count ? self[index] : nil
  }
}

extension String {
  var units: Units { Array(utf16) }
}
