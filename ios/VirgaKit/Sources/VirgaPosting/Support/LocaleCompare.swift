// `String.prototype.localeCompare`, for the ports that sort by it (the
// template shelf and the template service's list).
//
// Foundation's locale-aware compare is ICU's collator, as V8's is, so the
// order is the same; this only works around where Foundation's result
// differs from ICU's own: Foundation tells a string from the same string
// with a completely ignorable character (U+200B, U+2060, a variation
// selector, a NUL) at its end, which ICU treats as equal. Ending both
// strings with a tab, the non-ignorable character with the lowest weight at
// every level, gives ICU's answer: a difference anywhere before it decides
// as it did, and a difference only in trailing ignorables vanishes.
// Differentially tested against Node (en-US) over 53,600 random pairs of
// letters, marks, punctuation, emoji, CJK and controls at base strength,
// and 40,000 ASCII pairs at the default strength.
//
// The default (tertiary) strength doesn't tell compatibility variants apart
// as ICU does (fullwidth "ａ", the ligature "ﬁ", circled digits); the ports
// use it only for record keys, which are ASCII.

import Foundation
import VirgaCore

enum LocaleCompare {
  enum Sensitivity {
    /// `{ sensitivity: 'base' }`: letters only, not case or accents.
    case base
    /// The default: case and accents count.
    case variant
  }

  /// `a.localeCompare(b, locale, { sensitivity })` as -1, 0 or 1. `locale`
  /// nil is the active locale (the web passes `undefined`, the runtime's).
  static func compare(_ a: String, _ b: String, locale: String? = nil, sensitivity: Sensitivity = .variant) -> Int {
    let options: String.CompareOptions = sensitivity == .base ? [.caseInsensitive, .diacriticInsensitive, .widthInsensitive] : []
    let tag = locale ?? AppLocale.activeLocale()
    let result = (a + "\t").compare(b + "\t", options: options, range: nil, locale: Locale(identifier: tag))
    switch result {
    case .orderedAscending: return -1
    case .orderedSame: return 0
    case .orderedDescending: return 1
    }
  }

  /// `a < b`, by UTF-16 code unit.
  static func codeUnitLess(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
  }
}
