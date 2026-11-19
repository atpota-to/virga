// JavaScript's string and number semantics, for ports that must compute what
// the web app computes.
//
// A JavaScript string is a sequence of UTF-16 code units: `length`, indexes,
// `slice`, `indexOf` and regex match offsets all count code units, and a
// facet's byte offsets are worked out from them. A port that indexes by
// Character or by Unicode scalar gives different answers for emoji and
// other astral characters, so ports that index use these.

import Foundation

extension String {
  /// `str.length`: the length in UTF-16 code units.
  public var jsLength: Int { utf16.count }

  /// The UTF-16 code units, for index-faithful ports.
  public var jsUnits: [UInt16] { Array(utf16) }

  /// A string from UTF-16 code units. Lone surrogates become U+FFFD, as
  /// they do when JavaScript encodes a string to UTF-8.
  public init(jsUnits units: some Collection<UInt16>) {
    self = String(decoding: Array(units), as: UTF16.self)
  }

  private func clampedRange(_ start: Int, _ end: Int?) -> Range<Int> {
    let length = jsLength
    func resolve(_ index: Int) -> Int {
      index < 0 ? Swift.max(0, length + index) : Swift.min(index, length)
    }
    let from = resolve(start)
    let to = end.map(resolve) ?? length
    return from..<Swift.max(from, to)
  }

  /// `str.slice(start, end)`, negative indexes counting from the end.
  public func jsSlice(_ start: Int, _ end: Int? = nil) -> String {
    let range = clampedRange(start, end)
    let units = utf16
    let lower = units.index(units.startIndex, offsetBy: range.lowerBound)
    let upper = units.index(units.startIndex, offsetBy: range.upperBound)
    return String(jsUnits: units[lower..<upper])
  }

  /// `str.substring(start, end)`: negative indexes are 0 and the two are
  /// swapped when `start > end`.
  public func jsSubstring(_ start: Int, _ end: Int? = nil) -> String {
    let length = jsLength
    var from = Swift.min(Swift.max(0, start), length)
    var to = Swift.min(Swift.max(0, end ?? length), length)
    if from > to { swap(&from, &to) }
    return jsSlice(from, to)
  }

  /// `str.indexOf(search, from)` in UTF-16 code units, or -1.
  public func jsIndexOf(_ search: String, from: Int = 0) -> Int {
    let haystack = jsUnits
    let needle = search.jsUnits
    let start = Swift.max(0, from)
    if needle.isEmpty { return Swift.min(start, haystack.count) }
    guard haystack.count >= needle.count, start <= haystack.count - needle.count else { return -1 }
    for i in start...(haystack.count - needle.count) where haystack[i] == needle[0] {
      if haystack[i..<(i + needle.count)].elementsEqual(needle) { return i }
    }
    return -1
  }

  /// `str.lastIndexOf(search)` in UTF-16 code units, or -1.
  public func jsLastIndexOf(_ search: String) -> Int {
    let haystack = jsUnits
    let needle = search.jsUnits
    if needle.isEmpty { return haystack.count }
    guard haystack.count >= needle.count else { return -1 }
    for i in stride(from: haystack.count - needle.count, through: 0, by: -1) where haystack[i] == needle[0] {
      if haystack[i..<(i + needle.count)].elementsEqual(needle) { return i }
    }
    return -1
  }

  /// `str[i]` / `str.charAt(i)`: the single code unit at `i` as a string
  /// ("" when out of range). Half a surrogate pair comes back as U+FFFD.
  public func jsCharAt(_ index: Int) -> String {
    guard index >= 0, index < jsLength else { return "" }
    return jsSlice(index, index + 1)
  }

  /// `str.charCodeAt(i)`, or nil when out of range (JavaScript's NaN).
  public func jsCharCodeAt(_ index: Int) -> UInt16? {
    guard index >= 0, index < jsLength else { return nil }
    return utf16[utf16.index(utf16.startIndex, offsetBy: index)]
  }

  /// The UTF-8 byte offset of a UTF-16 index: what a facet's byteStart is
  /// for a match found at `index`.
  public func utf8Offset(ofUTF16 index: Int) -> Int {
    jsSlice(0, index).utf8.count
  }

  /// `str.trim()`: JavaScript's whitespace and line terminators, which
  /// differ from Foundation's (U+FEFF is trimmed, U+0085 is not).
  public func jsTrimmed() -> String {
    jsTrimmingStart().jsTrimmingEnd()
  }

  /// `str.trimStart()`.
  public func jsTrimmingStart() -> String {
    let scalars = unicodeScalars
    guard let first = scalars.firstIndex(where: { !JSWhitespace.contains($0) }) else { return "" }
    return String(scalars[first...])
  }

  /// `str.trimEnd()`.
  public func jsTrimmingEnd() -> String {
    let scalars = unicodeScalars
    guard let last = scalars.lastIndex(where: { !JSWhitespace.contains($0) }) else { return "" }
    return String(scalars[...last])
  }
}

/// JavaScript's WhiteSpace and LineTerminator code points (what `trim()` and
/// `\s` match).
public enum JSWhitespace {
  public static func contains(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A,
      0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
      return true
    default:
      return false
    }
  }
}

extension Double {
  /// `n.toFixed(digits)`, as the spec defines it: the exact value of the
  /// double, rounded to `digits` places with a tie going to the larger
  /// magnitude, and a minus sign whenever the number is below zero (so
  /// -0.0001 is "-0.00").
  public func jsToFixed(_ digits: Int) -> String {
    guard isFinite else { return isNaN ? "NaN" : (self > 0 ? "Infinity" : "-Infinity") }
    if abs(self) >= 1e21 { return JSNumber.format(self) }
    let sign = self < 0 ? "-" : ""
    // printf writes the double's exact binary value; with far more places
    // than needed, the digit after the last kept one decides the rounding.
    let exact = String(format: "%.\(digits + 25)f", abs(self))
    let parts = exact.split(separator: ".", omittingEmptySubsequences: false)
    var whole = Array(parts[0])
    let fraction = parts.count > 1 ? Array(parts[1]) : []
    var kept = Array(fraction.prefix(digits))
    let next = fraction.count > digits ? fraction[digits] : "0"
    if next >= "5" {
      // Carry one into the kept digits, then into the whole part.
      var carry = true
      var index = kept.count - 1
      while carry && index >= 0 {
        if kept[index] == "9" { kept[index] = "0"; index -= 1 } else {
          kept[index] = Character(String(kept[index].wholeNumberValue! + 1)); carry = false
        }
      }
      index = whole.count - 1
      while carry && index >= 0 {
        if whole[index] == "9" { whole[index] = "0"; index -= 1 } else {
          whole[index] = Character(String(whole[index].wholeNumberValue! + 1)); carry = false
        }
      }
      if carry { whole.insert("1", at: 0) }
    }
    let body = digits > 0 ? String(whole) + "." + String(kept) : String(whole)
    return sign + body
  }

  /// `Math.round(n)`: halves round up (toward +∞), unlike Swift's
  /// `.rounded()`, which rounds them away from zero. Exact where `n + 0.5`
  /// would round (0.49999999999999994 is 0), and -0 for anything in
  /// [-0.5, -0], as JavaScript gives (so `Math.round(-0.4).toLocaleString()`
  /// is "-0").
  public var jsRounded: Double {
    guard isFinite, self != 0 else { return self }
    let floor = rounded(.down)
    let result = self - floor >= 0.5 ? floor + 1 : floor
    return result == 0 && self < 0 ? -0.0 : result
  }
}

extension JSONValue {
  /// `String(value)` for the values a port meets: strings as they are,
  /// numbers as JavaScript prints them, null as "null".
  public var jsString: String {
    switch self {
    case .null: return "null"
    case .bool(let value): return value ? "true" : "false"
    case .string(let value): return value
    case .number(let value): return JSNumber.format(value)
    case .array(let values): return values.map { $0.isNull ? "" : $0.jsString }.joined(separator: ",")
    case .object: return "[object Object]"
    }
  }
}

public enum JSNumber {
  /// `String(n)` for a number, as ECMAScript's Number::toString writes it:
  /// the shortest digits that round-trip, in fixed notation from 1e-7 up to
  /// 1e21 and as `2.5e-7` / `1e+21` outside it.
  public static func format(_ value: Double) -> String {
    if value.isNaN { return "NaN" }
    if value.isInfinite { return value > 0 ? "Infinity" : "-Infinity" }
    if value == 0 { return "0" }
    let sign = value < 0 ? "-" : ""
    // Swift's description is also the shortest round-trip form; take its
    // digits and decimal exponent and lay them out JavaScript's way.
    let text = "\(abs(value))"
    var mantissa = text
    var exponent = 0
    if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
      mantissa = String(text[..<e])
      exponent = Int(text[text.index(after: e)...]) ?? 0
    }
    let pieces = mantissa.split(separator: ".", omittingEmptySubsequences: false)
    let intPart = String(pieces[0])
    let fracPart = pieces.count > 1 ? String(pieces[1]) : ""
    var digits = intPart + fracPart
    // n: where the decimal point falls after the first significant digit.
    var n = intPart.count + exponent
    while digits.hasPrefix("0") && digits.count > 1 { digits.removeFirst(); n -= 1 }
    while digits.hasSuffix("0") && digits.count > 1 { digits.removeLast() }
    let k = digits.count
    let chars = Array(digits)
    if k <= n && n <= 21 {
      return sign + digits + String(repeating: "0", count: n - k)
    }
    if 0 < n && n <= 21 {
      return sign + String(chars[0..<n]) + "." + String(chars[n...])
    }
    if -6 < n && n <= 0 {
      return sign + "0." + String(repeating: "0", count: -n) + digits
    }
    let e = n - 1
    let expText = e < 0 ? "-\(-e)" : "+\(e)"
    if k == 1 { return sign + digits + "e" + expText }
    return sign + String(chars[0]) + "." + String(chars[1...]) + "e" + expText
  }
}
