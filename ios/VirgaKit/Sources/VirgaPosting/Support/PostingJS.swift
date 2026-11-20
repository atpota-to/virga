// Small pieces of JavaScript's semantics the posting ports lean on that
// VirgaCore doesn't cover: `\s` tests, `split(/\s+/)`, `startsWith` by code
// unit, `Number.isInteger`, a stable sort and UTF-8 decoding as TextDecoder
// does it. (`toLowerCase` is VirgaCore's `jsLowercased`, `Number(x)` its
// `jsNumber`, and the URI functions its `JSURI`.) Internal: the ports call
// these, and the parity fixtures check the results through them.

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

  // MARK: Numbers

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
