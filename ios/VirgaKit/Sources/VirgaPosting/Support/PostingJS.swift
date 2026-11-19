// Small pieces of JavaScript's semantics the posting ports lean on that
// VirgaCore's JSCompat doesn't cover: `toLowerCase` (with Greek final sigma),
// `split(/\s+/)`, ToNumber, a stable sort and UTF-8 decoding as TextDecoder
// does it. Internal: the ports call these, and the parity fixtures check the
// results through them.

import Foundation
import VirgaCore

enum PostingJS {
  // MARK: Whitespace

  /// Whether a UTF-16 code unit is JavaScript's `\s` (all of which are in the
  /// BMP, so a surrogate half never is).
  static func isSpace(_ unit: UInt16) -> Bool {
    guard let scalar = Unicode.Scalar(UInt32(unit)) else { return false }
    return JSWhitespace.contains(scalar)
  }

  /// Whether `text` is all `\s` and not empty: `/^\s+$/.test(text)`.
  static func isAllSpace(_ text: String) -> Bool {
    !text.isEmpty && text.unicodeScalars.allSatisfy(JSWhitespace.contains)
  }

  /// Whether `text` holds any `\s`: `/\s/.test(text)`.
  static func hasSpace(_ text: String) -> Bool {
    text.unicodeScalars.contains(where: JSWhitespace.contains)
  }

  /// `text.split(/\s+/)`: pieces between runs of whitespace, with an empty
  /// piece at either end when the text starts or ends with whitespace, and
  /// `[""]` for the empty string.
  static func splitOnWhitespace(_ text: String) -> [String] {
    var pieces: [String] = []
    var current = String.UnicodeScalarView()
    var inSpace = false
    for scalar in text.unicodeScalars {
      if JSWhitespace.contains(scalar) {
        if !inSpace {
          pieces.append(String(current))
          current = String.UnicodeScalarView()
          inSpace = true
        }
      } else {
        inSpace = false
        current.append(scalar)
      }
    }
    pieces.append(String(current))
    return pieces
  }

  /// `text.startsWith(prefix)`, by code unit.
  static func hasPrefix(_ units: ArraySlice<UInt16>, _ prefix: String) -> Bool {
    units.starts(with: prefix.utf16)
  }

  /// `text.startsWith(prefix)`, by code unit (Swift's `hasPrefix` compares
  /// whole characters, so a combining mark after the prefix hides it).
  static func hasPrefix(_ text: String, _ prefix: String) -> Bool {
    text.utf16.starts(with: prefix.utf16)
  }

  // MARK: Case

  /// `text.toLowerCase()`: Unicode's full lowercase mapping, with a capital
  /// sigma at the end of a word becoming the final form (ς), as V8 does it.
  static func toLowerCase(_ text: String) -> String {
    let scalars = Array(text.unicodeScalars)
    // ASCII fast path.
    if scalars.allSatisfy({ $0.isASCII }) { return text.lowercased() }
    var out = String.UnicodeScalarView()
    for (index, scalar) in scalars.enumerated() {
      if scalar.value == 0x03A3 {
        out.append(isFinalSigma(scalars, index) ? "\u{03C2}" : "\u{03C3}")
      } else {
        out.append(contentsOf: scalar.properties.lowercaseMapping.unicodeScalars)
      }
    }
    return String(out)
  }

  /// Unicode's Final_Sigma condition: a cased letter before (skipping
  /// case-ignorables) and none after.
  private static func isFinalSigma(_ scalars: [Unicode.Scalar], _ index: Int) -> Bool {
    var before = index - 1
    while before >= 0, scalars[before].properties.isCaseIgnorable { before -= 1 }
    guard before >= 0, scalars[before].properties.isCased else { return false }
    var after = index + 1
    while after < scalars.count, scalars[after].properties.isCaseIgnorable { after += 1 }
    return !(after < scalars.count && scalars[after].properties.isCased)
  }

  // MARK: Numbers

  /// ToNumber of a JSON value: null 0, booleans 0 and 1, strings by
  /// StringToNumber, arrays through their string form, objects NaN.
  static func toNumber(_ value: JSONValue?) -> Double {
    guard let value else { return .nan }
    switch value {
    case .null: return 0
    case .bool(let b): return b ? 1 : 0
    case .number(let n): return n
    case .string(let s): return stringToNumber(s)
    case .array: return stringToNumber(value.jsString)
    case .object: return .nan
    }
  }

  /// StringToNumber: whitespace trimmed, "" is 0, 0x/0o/0b integers,
  /// Infinity, and decimal literals; anything else NaN.
  static func stringToNumber(_ text: String) -> Double {
    let s = text.jsTrimmed()
    if s.isEmpty { return 0 }
    let lower = s.lowercased()
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(prefix) {
      let digits = lower.dropFirst(2)
      guard !digits.isEmpty else { return .nan }
      var value = 0.0
      for ch in digits {
        guard let d = ch.hexDigitValue, d < radix else { return .nan }
        value = value * Double(radix) + Double(d)
      }
      return value
    }
    var body = Substring(s)
    var sign = 1.0
    if body.hasPrefix("+") { body = body.dropFirst() } else if body.hasPrefix("-") { sign = -1; body = body.dropFirst() }
    if body == "Infinity" { return sign * .infinity }
    // A decimal literal: digits, an optional fraction, an optional exponent.
    let chars = Array(body)
    var i = 0
    var sawDigit = false
    while i < chars.count, chars[i].isASCII, chars[i].isNumber { i += 1; sawDigit = true }
    if i < chars.count, chars[i] == "." {
      i += 1
      while i < chars.count, chars[i].isASCII, chars[i].isNumber { i += 1; sawDigit = true }
    }
    guard sawDigit else { return .nan }
    if i < chars.count, chars[i] == "e" || chars[i] == "E" {
      var j = i + 1
      if j < chars.count, chars[j] == "+" || chars[j] == "-" { j += 1 }
      var expDigit = false
      while j < chars.count, chars[j].isASCII, chars[j].isNumber { j += 1; expDigit = true }
      guard expDigit else { return .nan }
      i = j
    }
    guard i == chars.count, let value = Double(String(body)) else { return .nan }
    return sign * value
  }

  /// `Number.isInteger(value)`.
  static func isInteger(_ value: JSONValue?) -> Bool {
    guard case .number(let n)? = value else { return false }
    return n.isFinite && n.rounded(.towardZero) == n
  }

  // MARK: Sorting

  /// `array.sort((a, b) => key(a) - key(b))`: stable, as Array.prototype.sort is.
  static func stableSorted<T>(_ items: [T], by key: (T) -> Double) -> [T] {
    items.enumerated()
      .sorted { lhs, rhs in
        let a = key(lhs.element)
        let b = key(rhs.element)
        // A NaN difference compares equal, as a comparator returning NaN does.
        if a < b { return true }
        if a > b { return false }
        return lhs.offset < rhs.offset
      }
      .map(\.element)
  }

  // MARK: UTF-8

  /// `new TextDecoder().decode(bytes)`: invalid sequences become U+FFFD, a
  /// leading BOM is dropped.
  static func decodeUTF8(_ bytes: some Collection<UInt8>) -> String {
    var array = Array(bytes)
    if array.starts(with: [0xEF, 0xBB, 0xBF]) { array.removeFirst(3) }
    return String(decoding: array, as: UTF8.self)
  }
}
