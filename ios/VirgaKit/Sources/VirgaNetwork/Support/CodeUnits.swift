// String tests and edits that count UTF-16 code units, as the web code's
// `startsWith`, `endsWith`, `includes`, `split` and anchored `replace` do.
//
// Swift's `hasPrefix`, `hasSuffix`, `contains`, `split` and `removeLast`
// work on Characters and compare by canonical equivalence: a "/" followed by
// a combining mark is one Character that isn't "/", a prepended Arabic sign
// joins the "/" after it, U+037E (Greek question mark) *is* ";", and so
// `"did:web:\u{301}x".hasPrefix("did:web:")` is false where JavaScript's
// `startsWith` is true. The network ports test strings from outside the app
// (DIDs, endpoints, paths, header values), so they use these instead
// (ios/PORTING.md, "Strings compare by code unit").
//
// Internal on purpose: VirgaDefense and VirgaPosting keep helpers of their
// own, and a public twin here would make their calls ambiguous.

import Foundation
import VirgaCore

extension String {
  /// `str.startsWith(prefix)`.
  func jsStartsWith(_ prefix: String) -> Bool {
    utf16.starts(with: prefix.utf16)
  }

  /// `str.endsWith(suffix)`.
  func jsEndsWith(_ suffix: String) -> Bool {
    utf16.reversed().starts(with: suffix.utf16.reversed())
  }

  /// `str.includes(search)`.
  func jsIncludes(_ search: String) -> Bool {
    jsIndexOf(search) >= 0
  }

  /// The string without its first `count` code units (`str.slice(count)`).
  func jsDropping(first count: Int) -> String {
    String(jsUnits: utf16.dropFirst(count))
  }

  /// `str.replace(prefixRegex, '')` for a literal prefix: the rest when the
  /// string starts with `prefix`, else the string.
  func jsRemovingPrefix(_ prefix: String) -> String {
    jsStartsWith(prefix) ? jsDropping(first: prefix.utf16.count) : self
  }

  /// `str.replace(/\/$/, '')`: one trailing "/" removed.
  func jsRemovingOneTrailingSlash() -> String {
    utf16.last == 0x2F ? String(jsUnits: utf16.dropLast()) : self
  }

  /// `str.replace(/\/+$/, '')`: every trailing "/" removed.
  func jsRemovingTrailingSlashes() -> String {
    var units = Array(utf16)
    while units.last == 0x2F { units.removeLast() }
    return units.count == utf16.count ? self : String(jsUnits: units)
  }

  /// `str.split(separator)[0]`: everything before the first `separator`
  /// code unit.
  func jsBefore(firstUnit separator: UInt16) -> String {
    guard let index = utf16.firstIndex(of: separator) else { return self }
    return String(jsUnits: utf16[..<index])
  }

  /// `str.replace(/<ascii>/gi, replacement)` for an ASCII needle: every
  /// match, ignoring ASCII case only (a regex without the `u` flag never
  /// folds a non-ASCII character onto an ASCII one).
  func jsReplacingASCIICaseInsensitive(_ needle: String, with replacement: String) -> String {
    let units = Array(utf16)
    let pattern = needle.utf16.map(Self.asciiLower)
    guard !pattern.isEmpty, units.count >= pattern.count else { return self }
    var out: [UInt16] = []
    var i = 0
    var changed = false
    while i < units.count {
      if i + pattern.count <= units.count, (0..<pattern.count).allSatisfy({ Self.asciiLower(units[i + $0]) == pattern[$0] }) {
        out.append(contentsOf: replacement.utf16)
        i += pattern.count
        changed = true
      } else {
        out.append(units[i])
        i += 1
      }
    }
    return changed ? String(jsUnits: out) : self
  }

  /// The string with A–Z lowered and every other code unit kept: what a
  /// regex's `i` flag folds, without `u`, for an ASCII pattern.
  var asciiLowercased: String {
    String(jsUnits: utf16.map(Self.asciiLower))
  }

  static func asciiLower(_ unit: UInt16) -> UInt16 {
    (0x41...0x5A).contains(unit) ? unit + 0x20 : unit
  }
}

/// `setTimeout(fn, ms)`'s delay as a browser takes it: WebIDL's `long`
/// conversion (NaN and ±Infinity are 0, a fraction is truncated, a number
/// past 32 bits wraps), then a negative delay is 0.
func jsTimerDelay(_ ms: Double) -> Double {
  guard ms.isFinite else { return 0 }
  let truncated = ms.rounded(.towardZero)
  let wrapped = truncated.truncatingRemainder(dividingBy: 4_294_967_296)
  var int32 = wrapped < 0 ? wrapped + 4_294_967_296 : wrapped
  if int32 >= 2_147_483_648 { int32 -= 4_294_967_296 }
  return max(0, int32)
}

/// A deadline as backendClient.js's `withDeadline(signal, ms)` takes it:
/// none for a falsy `ms` (0 or NaN), else `AbortSignal.timeout(ms)`.
func backendDeadline(_ ms: Double?) -> Double? {
  guard let ms, ms != 0, !ms.isNaN else { return nil }
  return ms
}
