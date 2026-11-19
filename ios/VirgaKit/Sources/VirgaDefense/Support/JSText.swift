// JavaScript's string comparisons and the few regular-expression steps the
// Defense modules take, for text nobody here controls (a DM, a pasted link).
//
// Swift compares strings by canonical equivalence: "\u{212A}" (the Kelvin
// sign) == "K", and "e\u{301}" == "é". JavaScript's `===`, `includes`,
// `startsWith` and a Set's membership compare code units. A moderator
// command typed with a look-alike character must read exactly as the web
// reads it, so everything here compares UTF-16 code units. Not a port of a
// web module: these are the operators those modules use.

import Foundation
import VirgaCore

extension String {
  // `jsEquals` (a === b) is VirgaCore's (Support/JSStrings.swift).

  /// `str.startsWith(prefix)`, by code unit.
  func jsStartsWith(_ prefix: String) -> Bool {
    utf16.starts(with: prefix.utf16)
  }

  /// `str.includes(search)`, by code unit.
  func jsIncludes(_ search: String) -> Bool {
    jsIndexOf(search) >= 0
  }

  /// A key that hashes and compares by code unit, for `new Set(strings)`.
  var jsKey: [UInt16] { Array(utf16) }

  /// ASCII letters lowered and nothing else changed: what a JavaScript
  /// regex with the `i` flag (and no `u`) treats as equal to its lower-case
  /// letters. Keeps every code unit's position.
  var asciiLowercased: String {
    String(jsUnits: utf16.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 })
  }

  /// `str.split(/\s+/)`: JavaScript whitespace runs as separators, with the
  /// empty strings a leading or trailing run leaves ("" splits to [""]).
  /// `alsoComma` makes it `split(/[\s,]+/)`.
  func jsSplitWhitespace(alsoComma: Bool = false) -> [String] {
    var out: [String] = []
    var current = String.UnicodeScalarView()
    var inRun = false
    for scalar in unicodeScalars {
      if JSWhitespace.contains(scalar) || (alsoComma && scalar == ",") {
        if !inRun {
          out.append(String(current))
          current = String.UnicodeScalarView()
          inRun = true
        }
      } else {
        inRun = false
        current.append(scalar)
      }
    }
    out.append(String(current))
    return out
  }

  /// `str.replace(/\s+/g, ' ')`.
  func jsCollapsingWhitespace() -> String {
    var out = String.UnicodeScalarView()
    var inRun = false
    for scalar in unicodeScalars {
      if JSWhitespace.contains(scalar) {
        if !inRun { out.append(" ") }
        inRun = true
      } else {
        inRun = false
        out.append(scalar)
      }
    }
    return String(out)
  }

  /// The string without a leading run of `set` (`replace(/^[set]+/, '')`),
  /// for sets of BMP characters.
  func droppingLeading(_ set: Set<Unicode.Scalar>) -> String {
    let scalars = unicodeScalars
    guard let first = scalars.firstIndex(where: { !set.contains($0) }) else { return "" }
    return String(scalars[first...])
  }

  /// The string without a trailing run of `set` (`replace(/[set]+$/, '')`).
  func droppingTrailing(_ set: Set<Unicode.Scalar>) -> String {
    droppingTrailing { set.contains($0) }
  }

  func droppingTrailing(where matches: (Unicode.Scalar) -> Bool) -> String {
    let scalars = unicodeScalars
    guard let last = scalars.lastIndex(where: { !matches($0) }) else { return "" }
    return String(scalars[...last])
  }
}

extension Sequence where Element == String {
  /// `[...new Set(strings)]`: the first of each, in order, compared by code unit.
  func jsUnique() -> [String] {
    var seen = Set<[UInt16]>()
    return filter { seen.insert($0.jsKey).inserted }
  }

  /// `strings.includes(value)`, by code unit.
  func jsContains(_ value: String) -> Bool {
    contains { $0.jsEquals(value) }
  }
}

/// A regular expression run as JavaScript runs it, over UTF-16. Patterns are
/// written for ICU with JavaScript's meanings spelled out: `\s` as
/// `JSRegex.ws`, `\b` as `JSRegex.wordBoundary`, `$` as `\z`, and the `i`
/// flag as matching against `asciiLowercased` (JavaScript's `i` without `u`
/// folds no character outside ASCII onto an ASCII letter, where ICU's
/// case-insensitive matching would fold the Kelvin sign onto "k").
struct JSRegex: @unchecked Sendable {
  /// JavaScript's `\s`.
  static let ws = "[\\t\\n\\x{0B}\\f\\r \\x{A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]"
  /// JavaScript's `\b` without the `u` flag: between an ASCII word character and anything else.
  static let wordBoundary = "(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))"

  private let regex: NSRegularExpression
  private let caseless: Bool

  /// `pattern` in ICU syntax; `caseless` for a JavaScript `i` flag, the
  /// pattern then written in lower case.
  init(_ pattern: String, caseless: Bool = false) {
    // The patterns are constants in this module; one that doesn't compile is a bug here.
    regex = try! NSRegularExpression(pattern: pattern)
    self.caseless = caseless
  }

  /// The first match: its range in UTF-16 code units and its groups (nil
  /// for a group that took no part), the groups read from `text` itself.
  func firstMatch(in text: String) -> (range: Range<Int>, groups: [String?])? {
    let subject = caseless ? text.asciiLowercased : text
    let ns = subject as NSString
    guard let match = regex.firstMatch(in: subject, range: NSRange(location: 0, length: ns.length)) else { return nil }
    let original = text as NSString
    var groups: [String?] = []
    for index in 1..<match.numberOfRanges {
      let r = match.range(at: index)
      groups.append(r.location == NSNotFound ? nil : original.substring(with: r))
    }
    let whole = match.range
    return (whole.location..<(whole.location + whole.length), groups)
  }

  /// `regex.test(text)`.
  func test(_ text: String) -> Bool {
    firstMatch(in: text) != nil
  }

  /// `text.replace(regex, '')` for a non-global regex: the first match cut out.
  func removingFirstMatch(in text: String) -> String {
    guard let match = firstMatch(in: text) else { return text }
    return text.jsSlice(0, match.range.lowerBound) + text.jsSlice(match.range.upperBound)
  }
}

/// `Math.min` and `Math.max`: NaN wins, and -0 is below +0, where Swift's
/// `min` and `max` would return the other operand for a NaN.
enum JSMath {
  static func min(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == 0 && b == 0 { return a.sign == .minus ? a : b }
    return a < b ? a : b
  }

  static func max(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == 0 && b == 0 { return a.sign == .minus ? b : a }
    return a > b ? a : b
  }
}

extension Array {
  /// `array.sort(compare)` as V8 sorts: stable, so elements the comparator
  /// calls equal (0, or NaN, which the spec reads as 0) keep their order.
  func jsSorted(by compare: (Element, Element) -> Double) -> [Element] {
    enumerated()
      .sorted { a, b in
        let c = compare(a.element, b.element)
        if c < 0 { return true }
        if c > 0 { return false }
        return a.offset < b.offset
      }
      .map(\.element)
  }

  /// `array.slice(start, end)`, negative indexes counting from the end.
  func jsSlice(_ start: Int, _ end: Int? = nil) -> [Element] {
    func resolve(_ index: Int) -> Int {
      index < 0 ? Swift.max(0, count + index) : Swift.min(index, count)
    }
    let from = resolve(start)
    let to = Swift.max(from, end.map(resolve) ?? count)
    return Array(self[from..<to])
  }
}
