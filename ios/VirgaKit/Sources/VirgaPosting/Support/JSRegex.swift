// JavaScript regular expressions, for the posting ports.
//
// The web code's regexes are ported to NSRegularExpression (ICU), matched over
// UTF-16, so match offsets are JavaScript's string indexes. ICU and V8 are
// both backtracking engines with the same leftmost, first-alternative-first
// semantics for the constructs used here (classes, lazy and greedy
// quantifiers, lookahead). What differs is written out in each pattern:
//
// - JS `\s` is `JSRegex.space` (ICU's `\s` is another set).
// - JS `\d`, `\w` and `\b` are ASCII-only (ICU's are Unicode), so patterns
//   spell them `[0-9]`, `[A-Za-z0-9_]` and an explicit boundary.
// - JS `$` without the `m` flag is the end of the input; ICU's also matches
//   before a final line terminator, so patterns write `\z`.
// - The `i` flag is written out as explicit classes (`[hH][tT]…`): ICU's
//   case-insensitive matching folds characters JS without `u` doesn't (the
//   long s, the Kelvin sign).

import Foundation

/// A compiled pattern. Immutable and safe to share across threads.
final class JSRegex: @unchecked Sendable {
  /// JavaScript's `\s`, for use inside a character class.
  static let space = #"\t\n\u000B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"#

  let pattern: String
  private let regex: NSRegularExpression

  init(_ pattern: String) {
    self.pattern = pattern
    do {
      regex = try NSRegularExpression(pattern: pattern, options: [])
    } catch {
      preconditionFailure("Invalid regex \(pattern): \(error)")
    }
  }

  /// A match: its range and its capture groups' ranges, in UTF-16 code units.
  struct Match {
    let range: Range<Int>
    let groups: [Range<Int>?]

    /// The text of group `index` (0 is the whole match), or nil when the
    /// group took no part in the match (JavaScript's undefined).
    func group(_ index: Int, in units: [UInt16]) -> String? {
      let r = index == 0 ? range : groups[index - 1]
      guard let r else { return nil }
      return String(jsUnits: units[r])
    }
  }

  /// Every match, as a global regex's `exec` loop finds them (an empty match
  /// moves the search on by one code unit).
  func matches(in text: String, from start: Int = 0) -> [Match] {
    let ns = NSString(string: text)
    guard start <= ns.length else { return [] }
    let found = regex.matches(in: text, options: [], range: NSRange(location: start, length: ns.length - start))
    return found.map(Self.convert)
  }

  /// The first match at or after `start`, as `exec` with `lastIndex = start`.
  func firstMatch(in text: String, from start: Int = 0) -> Match? {
    let ns = NSString(string: text)
    guard start <= ns.length else { return nil }
    return regex.firstMatch(in: text, options: [], range: NSRange(location: start, length: ns.length - start))
      .map(Self.convert)
  }

  /// `regex.test(text)`.
  func test(_ text: String) -> Bool {
    firstMatch(in: text) != nil
  }

  private static func convert(_ result: NSTextCheckingResult) -> Match {
    func range(_ r: NSRange) -> Range<Int>? {
      r.location == NSNotFound ? nil : r.location..<(r.location + r.length)
    }
    let groups = (1..<max(1, result.numberOfRanges)).map { range(result.range(at: $0)) }
    return Match(range: range(result.range)!, groups: groups)
  }
}
